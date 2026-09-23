// THE WORKFLOW VALIDATION GATE — what every write path runs over the bytes it is about to send.
//
// Two oracles, because neither is enough alone:
//
//   ENGINE (offline, this file)  catches what GHL's server lets through. Measured 2026-09-11: the
//                                server answers valid:true on an invented attribute key, a wrong inner
//                                attributes.type, an extra top-level step key, a number out of range,
//                                and a corrupted step type on an AGENT flow.
//   SERVER (live-validate.mjs)   catches what the engine cannot know: assets that do not exist in the
//                                account, enum values, and GHL's own structural and field rules.
//
// Before this, some guards were attached to PATHS, not to the DOCUMENT: the unknown-attribute-key
// guard (checkAttrKeys) and the inner-type rule ran only inside the compiler, so an edit or a repair
// never met them, and modifyStep merges attributes "as given" for seventeen types. The edit path DID
// already refuse dangling step references and parentKeys and run GHL's own field guards on touched
// steps; the gate reports those too and yields to their hatches. It checks the final document,
// whatever produced it.
//
// Every allowlist here was CALIBRATED against 2,602 stored, working steps on two accounts before it
// was allowed to block (observed-step-keys.mjs). The type cards' attrKeys alone would have refused
// every stored if_else; an allowlist from the engine-built account alone would have refused every
// advanced-canvas workflow a human made.
import { loadCatalog } from './catalog.mjs';
import { INNER_ATTRIBUTE_TYPE, requiredKeysFor, isSupplied } from './required-fields.mjs';
import { fires } from './enforce.mjs';
import { checkStepRefs } from './graph-refs.mjs';
import { danglingParentKeys } from './edit.mjs';
import { checkFieldCaps, describeCap } from './field-caps.mjs';
import { ENGINE_ATTR_KEYS } from './compiler.mjs';
import { OBSERVED_TOP_LEVEL_KEYS, OBSERVED_ATTRIBUTE_KEYS, OBSERVED_INNER_TYPES } from './observed-step-keys.mjs';

export const STEP_TOP_LEVEL_KEYS = new Set(OBSERVED_TOP_LEVEL_KEYS);

// Keys a type carries only in one state, so a census can miss them. Each is grounded in the file
// that already handles it: conversationai_objective gains closingMessage (required) and tags the
// moment proceedIfNotMet is true (required-fields.mjs, the asset's conditional fields).
const CONDITIONAL_ATTR_KEYS = { conversationai_objective: ['closingMessage', 'tags'] };

// Keys GHL's SERVER writes onto a step when the document is saved. The author never sends them and
// the builder's front-end source does not contain them, so no model, card or asset lists them — and
// a census taken before the server started writing one cannot have seen it either. Without this the
// gate refuses to PUBLISH a workflow this engine built a minute earlier, calling the server's own
// stamp "an invented key". Found the first time a drip workflow was published through this path
// (live 2026-09-19: sent {batchSize, interval, type}; read back with `configuredAt` added — a key
// absent from all 3,803 steps of the 2026-09-12 census, so GHL began writing it after that).
const SERVER_WRITTEN_ATTR_KEYS = { drip: ['configuredAt'] };

// Step types that only exist as a branching CONTAINER. A linear one (scalar `next`, no transitions)
// saves, validates clean on GHL's server, publishes — and cannot branch at runtime. Calibrated on the
// harvest (2026-09-23): 55 of 55 stored steps of these types carry an array `next` of transition
// children and `cat:'multi-path'`; not one is linear. `convertToMultipath:true` is on every one
// except workflow_split, which never carries it. The multipath WAIT is deliberately absent: it is
// a hybrid that is legitimately linear when its timeout is off.
export const MULTIPATH_TYPES = new Map([
  ['find_opportunity', { convertFlag: true }], ['find_contact', { convertFlag: true }],
  ['lc_merge_contact', { convertFlag: true }], ['workflow_ai_decision_maker', { convertFlag: true }],
  ['conversationai_ai_splitter', { convertFlag: true }], ['conversationai_book_appointment', { convertFlag: true }],
  ['conversationai_services_booking', { convertFlag: true }], ['workflow_split', { convertFlag: false }],
]);

/** What is wrong with a multipath container's wiring, or [] when nothing is. */
export function multipathDefects(t, byId) {
  const spec = MULTIPATH_TYPES.get(t?.type);
  if (!spec) return [];
  const bad = [];
  const attrs = t.attributes ?? {};
  if (t.cat !== 'multi-path') bad.push(`cat is ${JSON.stringify(t.cat ?? null)}, not 'multi-path'`);
  if (spec.convertFlag && attrs.convertToMultipath !== true) bad.push('attributes.convertToMultipath is not true');
  const trs = Array.isArray(attrs.transitions) ? attrs.transitions : [];
  if (!trs.length) bad.push('attributes.transitions is empty');
  if (!Array.isArray(t.next) || !t.next.length) {
    bad.push(`next is ${JSON.stringify(t.next ?? null)}, not an array of branch ids`);
    return bad;
  }
  for (const id of t.next) {
    const child = byId.get(id);
    if (!child) bad.push(`branch '${id}' in next[] is not a step in this workflow`);
    else if (child.type !== 'transition') bad.push(`branch '${id}' is a '${child.type}', not a transition`);
    else if (child.parentKey !== t.id) bad.push(`transition '${child.name ?? id}' has parentKey '${child.parentKey}', not this step`);
  }
  const trIds = new Set(trs.map((x) => x?.id));
  const missing = t.next.filter((id) => !trIds.has(id));
  if (trs.length && missing.length) bad.push(`next[] names ${missing.length} branch(es) that attributes.transitions does not`);
  const unwired = trs.filter((x) => !t.next.includes(x?.id));
  if (unwired.length) bad.push(`attributes.transitions has ${unwired.length} branch(es) next[] does not wire (${unwired.map((x) => `'${x?.name}'`).join(', ')})`);
  return bad;
}

/** Every attribute key this type is known to carry, from every evidence source there is. */
export function knownAttributeKeys(type, card) {
  const model = (card?.modelFields?.fields ?? []).map((f) => f?.name).filter(Boolean);
  return new Set([
    ...(card?.attrKeys ?? []),
    ...(card?.requiredFields ?? []).map((k) => String(k).split(/[.[]/)[0]),
    ...model,
    ...(OBSERVED_ATTRIBUTE_KEYS[type] ?? []),
    ...(CONDITIONAL_ATTR_KEYS[type] ?? []),
    ...(SERVER_WRITTEN_ATTR_KEYS[type] ?? []),
    ...ENGINE_ATTR_KEYS,
  ]);
}

const finding = (check, severity, t, message) => ({
  check, severity, stepId: t?.id ?? null, stepName: t?.name ?? null, type: t?.type ?? null, message,
});

/**
 * The ENGINE oracle over a document's steps. No I/O.
 *
 * @param templates the steps about to be written
 * @param opts.catalog          loadCatalog() by default
 * @param opts.marketplaceTypes Set of marketplace action keys for this location, when known. An
 *   unknown type is only an ERROR once marketplace has been ruled out; without the set it is a
 *   warning, because a marketplace app step is legitimately absent from the native catalogue.
 * @param opts.scope Set of step ids this write changed. Findings on steps OUTSIDE it are reported
 *   as warnings: a pre-existing defect on a step nobody touched must not block an unrelated edit.
 * @returns {errors, warnings, checked}
 */
export function gateDocument(templates = [], { catalog = loadCatalog(), marketplaceTypes = null, scope = null, waive = null } = {}) {
  const out = [];
  for (const t of templates) {
    if (!t || typeof t !== 'object') continue;
    for (const k of Object.keys(t)) {
      if (!STEP_TOP_LEVEL_KEYS.has(k)) out.push(finding('TOP_LEVEL_KEY', 'error', t,
        `unknown top-level step key '${k}' — no stored step on either calibration account carries it`));
    }
    const card = catalog.step(t.type);
    if (t.isMarketplaceAction === true) continue;
    // A LABELLED asset step (first-party or hosted integration) carries `workflowsActionType`
    // INSTEAD of isMarketplaceAction — that is the builder's own shape, not a missing flag. It has no
    // native card to check its keys against; its inputs are checked against the asset schema.
    if (!card && typeof t.workflowsActionType === 'string' && marketplaceTypes?.has(t.type)) continue;
    if (!card) {
      if (marketplaceTypes?.has(t.type)) {
        out.push(finding('MARKETPLACE_FLAG', 'warning', t,
          `'${t.type}' is a marketplace action stored without isMarketplaceAction:true — the rail's complete step shape carries it`));
      } else {
        out.push(finding('STEP_TYPE', marketplaceTypes ? 'error' : 'warning', t,
          `'${t.type}' is not a known step type${marketplaceTypes ? ', native or marketplace' : ' (marketplace types were not available to rule it out)'}. `
          + 'GHL does NOT catch this on an agent flow.'));
      }
      continue;
    }
    const attrs = t.attributes ?? {};
    // attributes.type: the explicit map where the inner spelling differs from the row type, else every
    // value a stored step of this type was seen carrying (plus the source model's union members). A
    // type never observed is not judged — absence of evidence is not a rule.
    const innerAllowed = INNER_ATTRIBUTE_TYPE[t.type]
      ? new Set([INNER_ATTRIBUTE_TYPE[t.type]])
      : (OBSERVED_INNER_TYPES[t.type]
        ? new Set([...OBSERVED_INNER_TYPES[t.type], ...((card.modelFields?.fields ?? []).find((f) => f?.name === 'type')?.members ?? [])])
        : null);
    if (innerAllowed && 'type' in attrs && !innerAllowed.has(attrs.type)) out.push(finding('INNER_TYPE', 'error', t,
      `attributes.type is ${JSON.stringify(attrs.type)}; '${t.type}' stores ${[...innerAllowed].map((v) => `'${v}'`).join(' or ')}. `
      + 'It saves, publishes and round-trips clean, and the builder\'s drawer then cannot bind it. GHL does not catch this.'));
    const known = knownAttributeKeys(t.type, card);
    const bad = Object.keys(attrs).filter((k) => !known.has(k));
    if (bad.length) out.push(finding('ATTRIBUTE_KEY', card.confidence === 'verified-live' ? 'error' : 'warning', t,
      `unknown attribute key(s) [${bad.join(', ')}] — an invented key saves but moves nothing. GHL does not catch this.`));
    const missing = requiredKeysFor(t.type).filter((k) => !isSupplied(t.type, k, attrs));
    if (missing.length) out.push(finding('REQUIRED', 'error', t, `missing required field(s): ${missing.join(', ')}`));
    for (const r of card.enforcement?.throw ?? []) {
      if (fires(r, attrs)) out.push(finding('ENFORCEMENT', 'error', t, `GHL's own guard fires: ${r.field ?? ''} ${r.guard ?? ''}`.trim()));
    }
  }
  const byId = new Map(templates.filter((t) => t && typeof t === 'object').map((t) => [t.id, t]));
  for (const t of templates) {
    const bad = multipathDefects(t, byId);
    if (bad.length) out.push(finding('MULTIPATH_SHAPE', 'error', t,
      `'${t.type}' only works as a branching container, and this one is not wired as one: ${bad.join('; ')}. `
      + 'It saves, validates and publishes clean, and then cannot branch. GHL does not catch this.'));
  }
  for (const f of checkFieldCaps(templates)) {
    out.push({ check: 'FIELD_CAP', severity: 'error', stepId: f.stepId ?? null, stepName: f.step ?? f.stepName ?? null, type: f.type ?? null, message: describeCap(f) });
  }
  for (const d of danglingParentKeys(templates)) {
    out.push({ check: 'PARENT_KEY', severity: 'error', stepId: d.id, stepName: d.name, type: null, message: `parentKey points at '${d.parentKey}', which is not a step in this workflow` });
  }
  try { checkStepRefs(templates); } catch (e) {
    out.push({ check: 'STEP_REF', severity: 'error', stepId: null, stepName: null, type: null, message: String(e.message).split('\n').slice(0, 4).join(' ') });
  }
  // Outside the write's scope, a finding is REPORTED, never blocking.
  for (const f of out) if (scope && f.stepId && !scope.has(f.stepId) && f.severity === 'error') f.severity = 'warning';
  // A check the caller has ALREADY acknowledged with its own, more specific hatch (allowOverCap,
  // allowDanglingStepRefs, allowDanglingParentKeys) is reported, not re-refused. Without this the
  // gate overrode deliberate decisions its callers had made one argument earlier.
  for (const f of out) {
    if (waive?.has(f.check) && f.severity === 'error') { f.severity = 'warning'; f.message += ' (acknowledged by the caller\'s own hatch)'; }
  }
  return {
    errors: out.filter((f) => f.severity === 'error'),
    warnings: out.filter((f) => f.severity !== 'error'),
    checked: templates.length,
  };
}

// The two-oracle gate that used to live here is write-validation.mjs: every write path asks THAT,
// so no path can assemble a shorter list of layers than another. This file is the ENGINE oracle only.
