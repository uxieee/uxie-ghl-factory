// GHL's router BRANCH model, ported for the two halves of validateRouterConditions that read it: an
// unfinished branch (incompleteBranchViolation) and two branches routing on the same conditions
// (duplicatePairViolation). Sources (recovered 2026-09-11): models/conditions/RouterBranch.ts,
// Branch.ts, Segment.ts, router-rules.ts, router-branch-conditions-equality.ts.
//
// GHL runs these over HYDRATED branches, and its Condition constructor rewrites a stored condition
// first: it migrates contact_detail date conditions saved before value operators existed
// (beforeInit → mapOldDateData), puts subtypes into their canonical bracketed form, and reads the
// account's custom-field types (isDateTimeCustomField). This port reads the stored fields. The
// consequence runs one way: a duplicate GHL finds only after one of those rewrites is MISSED here,
// never invented. The date migration cannot make this port refuse what GHL accepts, because a router
// cannot hold pre-migration data: routers post-date it (2026-09-11).

const CONDITIONLESS = ['always_run', 'fallback'];
const NO_VALUE_OPERATORS = ['has_value', 'has_no_value', 'timeout'];
const DATE_WORDS = ['today', 'yesterday', 'tomorrow'];
const ABSOLUTE_DATE_OPERATORS = ['on', 'between', 'afterDate', 'beforeDate'];

/** RouterBranch: a stored branch with no type is a custom one. */
export const isConditionless = (branch) => CONDITIONLESS.includes(branch?.branchType ?? 'custom');

/** utils/validation.ts isWithinLimits(field) with its defaults (0, 100]. */
const isWithinLimits = (field, low = 0, high = 100) => Boolean(field) && field.length > low && field.length <= high;

/** Segment.isValidValue. A null value throws inside GHL (null.length); here it counts as missing. */
function isValidValue(c) {
  if (DATE_WORDS.includes(c.conditionValueOperator)) return true;
  if (c.conditionValueOperator && !ABSOLUTE_DATE_OPERATORS.includes(c.conditionValueOperator) && !c.conditionValueUnit) return false;
  if (c.conditionValue == null || c.conditionValue.length === 0) return false;
  return true;
}

/** Segment.isValidCondition */
function isValidCondition(c) {
  if (!c?.conditionType || !c.conditionSubType || !c.conditionOperator) return false;
  if (NO_VALUE_OPERATORS.includes(c.conditionOperator)) return true;
  return isValidValue(c);
}

/** Segment.hasErrors — some condition is not valid. An EMPTY segment is valid (`every` over []). */
const segmentHasErrors = (s) => !(s?.conditions ?? []).every(isValidCondition);

/** RouterBranch.hasIncompleteConditions */
export function hasIncompleteConditions(branch) {
  if (isConditionless(branch)) return false;
  const segments = branch?.segments ?? [];
  return !segments.length || segments.some(segmentHasErrors);
}

/**
 * RouterBranch.violation, as GHL's English copy: the name first, then the conditions. A missing name
 * throws inside GHL (undefined.trim()); here it reads as empty.
 */
export function branchViolation(branch) {
  const name = typeof branch?.name === 'string' ? branch.name : '';
  if (!name.trim().length) return 'Branch name cannot be empty!';
  if (!isWithinLimits(name)) return 'Branch name should be less than 100 characters';
  if (hasIncompleteConditions(branch)) return 'Add at least one complete condition to every branch';
  return undefined;
}

/** router-rules.ts incompleteBranchViolation — the first branch that needs work, "{name}: {message}". */
export function incompleteBranchViolation(branches) {
  for (const b of branches ?? []) {
    const v = branchViolation(b);
    if (v) return `${b?.name ?? ''}: ${v}`;
  }
  return undefined;
}

// ── router-branch-conditions-equality.ts, line for line ────────────────────────────────────────
const ROUTING_CONDITION_FIELDS = ['conditionType', 'conditionSubType', 'conditionOperator', 'conditionValue', 'conditionValueOperator', 'conditionValueUnit'];

function canonicalFieldValue(value) {
  if (value === undefined || value === null) return JSON.stringify(null);
  if (Array.isArray(value)) return JSON.stringify(value.map(canonicalFieldValue).sort());
  return JSON.stringify(String(value));
}

/** Condition.showConditionValueOptions */
const showConditionValueOptions = (c) => !(c.conditionOperator && NO_VALUE_OPERATORS.includes(c.conditionOperator));

/** Condition.valueOperatorType, without isDateTimeCustomField (account state; see the header). */
function valueOperatorType(c) {
  if (!c.conditionValueOperator) return null;
  if (DATE_WORDS.includes(c.conditionValueOperator)) return null;
  if (['on', 'afterDate', 'beforeDate'].includes(c.conditionValueOperator)) return 'datepicker';
  return 'relative';
}

function routingConditionFields(c) {
  const { conditionType, conditionSubType, conditionOperator, conditionValue, conditionValueOperator, conditionValueUnit } = c;
  if (showConditionValueOptions(c) === false) {
    return { conditionType, conditionSubType, conditionOperator, conditionValue: undefined, conditionValueOperator: undefined, conditionValueUnit: undefined };
  }
  if (conditionValueOperator && valueOperatorType(c) === null) {
    return { conditionType, conditionSubType, conditionOperator, conditionValue: undefined, conditionValueOperator, conditionValueUnit: undefined };
  }
  return { conditionType, conditionSubType, conditionOperator, conditionValue, conditionValueOperator, conditionValueUnit };
}

function canonicalCondition(c) {
  const fields = routingConditionFields(c);
  return JSON.stringify(ROUTING_CONDITION_FIELDS.map((field) => canonicalFieldValue(fields[field])));
}

function groupNode(operator, children) {
  const flattened = children.flatMap((child) => (child.kind === 'group' && child.operator === operator ? child.children : [child]));
  if (!flattened.length) return undefined;
  if (flattened.length === 1) return flattened[0];
  return { kind: 'group', operator, children: flattened };
}

function serializeCanonicalNode(node) {
  if (node.kind === 'condition') return JSON.stringify(['condition', node.condition]);
  return JSON.stringify(['group', node.operator, node.children.map(serializeCanonicalNode).sort()]);
}

const canonicalSegmentNode = (segment) =>
  groupNode(segment?.operator, (segment?.conditions ?? []).map((condition) => ({ kind: 'condition', condition: canonicalCondition(condition) })));

/** What a branch routes on, as a string two branches share only when they match the same executions. */
export function canonicalRouterBranchConditions(branch) {
  if (isConditionless(branch) || hasIncompleteConditions(branch)) return '';
  const segments = (branch.segments ?? []).map(canonicalSegmentNode).filter((node) => node !== undefined);
  const root = groupNode(branch.operator, segments);
  return root ? serializeCanonicalNode(root) : '';
}

/** The earliest pair routing on the same conditions: { branch (the later), original }. */
export function firstDuplicateRouterBranchPair(branches) {
  const seen = new Map();
  for (const branch of branches ?? []) {
    const canonical = canonicalRouterBranchConditions(branch);
    if (!canonical) continue;
    const original = seen.get(canonical);
    if (!original) { seen.set(canonical, branch); continue; }
    if (original.id === branch.id) continue;
    return { branch, original };
  }
  return undefined;
}

/** router-rules.ts duplicatePairViolation, as GHL's save-time copy. */
export function duplicatePairViolation(branches) {
  const pair = firstDuplicateRouterBranchPair(branches);
  if (!pair) return undefined;
  return `${pair.branch.name} has the same conditions as ${pair.original.name}. Change one of them so the router knows which path to take.`;
}
