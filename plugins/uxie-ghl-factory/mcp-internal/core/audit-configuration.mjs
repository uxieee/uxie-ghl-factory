// The two ACCOUNT-SURFACE composites: the complete workflow roster, and the complete
// three-product AI configuration bundle. They exist for the same reason the runtime-window
// collector does — every cheap way of reading these surfaces produces the SAME artifact for
// two opposite facts, "this account has none" and "this read failed" — and they obey the
// same three rules:
//
//   1. EMPTY IS NOT FAILED. A surface that could not be read is `null`, never `[]`. An
//      empty array is a claim, and this rail may not make a claim it did not observe. An
//      empty surface is publishable as complete ONLY after a terminal, schema-valid
//      discovery response. The full server's legacy best-effort entity sweeper answers a
//      403, a 404, a rate limit and an unreadable envelope alike with an empty agent array
//      (a `catch { return {} }` plus an `?? []` fallback), which is exactly why plan line
//      550 forbids reusing it in the audit profile — and why nothing in this file imports,
//      names or delegates to it. That absence is asserted as a SOURCE property by
//      test/audit-configuration.test.mjs, so the prohibition cannot be undone by a later
//      convenience import.
//   2. THE ONLY WAY OUT IS `callCapability`. No raw path, no `gateway.call`, and never a
//      caller-supplied `descriptors` list (Task 2 carry-forward item 7: that parameter
//      exists so tests can reach otherwise-unreachable policy branches; a composite
//      forwarding one would be a runtime policy bypass).
//   3. NOTHING IS TIMED, RANDOM, OR WALL-CLOCKED. Capture times come from the reads
//      themselves (`response.capturedAt`), so two identical runs serialize identically and
//      a receipt can be minted from them.
//
// SPLIT ERROR MODEL (Task 2 carry-forward). The audit gateway reports policy faults by
// THROWING with `.code`, and response faults by RETURNING `ok:false` plus a `failureClass`.
// A composite that models only one half loses the other, and the half it loses becomes an
// empty-but-complete surface. BOTH are handled here: a returned failure degrades exactly one
// component, a thrown policy fault degrades exactly one component (MISSING_AUTH_RAIL is the
// routine one — "no agency token was captured" must not crash a read composite), and only a
// thrown CIRCUIT_OPEN aborts the run — carrying `error.partial`, because everything read
// before the latch is real evidence and a resumer must not re-spend a budget it already paid.
//
// THE PER-COMPONENT SHAPE IS DELIBERATELY NOT TASK 3'S. Task 3 ships a FLAT
// `componentCompleteness` boolean map over facets of ONE workflow read, every one of which is
// always applicable. The components here are INDEPENDENT PAGINATED ACCOUNT SURFACES, each
// with its own page walk, its own route set and its own applicability, so each carries
// `{applicable, complete, detailDenominator, detailsRead, errors, items, pages, sourceRoutes}`.
// Task 11 consumes both shapes; neither may be forced onto the other, because doing so would
// make each of them wrong about the other's subject.
//
// WHY THE TWO WALKS RECONCILE DIFFERENTLY, stated here because the asymmetry looks like an
// oversight and is not. The roster refuses to publish without a reported total: its
// descriptor pins `sortBy`/`sortOrder`, its upstream is known to report one, and without it a
// single short page is indistinguishable from a complete roster. The AI envelopes are
// UNPROVEN, so their terminal is structural — a short page on Agent Studio, the single
// response itself on the two single-shot routes — and a total is reconciled only when one is
// actually PRESENT. Requiring a total there would make every AI read permanently incomplete
// for a reason that is a harness assumption rather than missing evidence, and a fail-closed
// rule that closes on everything is indistinguishable from a broken rail. But present-and-
// contradicted is not the same as absent: a reported total that disagrees with the rows makes
// the surface incomplete on EVERY AI route, single-shot included. "Absent" means absent from
// the WHOLE walk, too, not merely from the page that happened to end it — a total that moves
// between pages, or that is reported and then retracted, is present-and-contradicted, and the
// AI walk keeps a per-component `totalHistory` so it can tell the two apart.
//
// AND WHY BOTH REFUSE TO ANSWER "APPLICABLE" FROM AN UNRECONCILED READ. `applicable` is a
// claim about the ACCOUNT ("this product is not provisioned here"), which only a finished
// enumeration can support. A discovery response that contradicts itself — no rows against its
// own non-zero total — supports no such claim, so it publishes `applicable:'unknown'` and,
// with nothing read, `items:null`. It may never publish `items: []`, which is the shape that
// says "observed, and empty".
import { createHash } from 'node:crypto';
import { AUDIT_CAPABILITIES } from './audit-capabilities.mjs';
import { CODES } from './errors.mjs';

export const AUDIT_CONFIGURATION_CONTRACT_VERSION = '1.0.0';

// Budgets are inputs; page sizes are NOT. Both page sizes below are the maximum the
// descriptor's own numericQueryBounds allow, and both are pinned rather than exposed:
// the walks' notion of "terminal" is stated in terms of the page size, so a caller-chosen
// one would silently redefine what a terminal page means on a per-call basis.
export const ROSTER_MAX_PAGE_SIZE = 100;
export const AI_DISCOVERY_PAGE_SIZE = 100;
export const MAX_PAGE_BUDGET = 1000;

export const ROSTER_DEFAULTS = Object.freeze({ pageSize: 100, maxPages: 100 });
export const AI_BUNDLE_DEFAULTS = Object.freeze({ maxPages: 100 });

// The complete enumerated surface set. Callers cannot omit one (plan line 541) and there is
// no parameter through which they could try: applicability is decided later by the weekly
// auditor's pinned coverage profile plus complete discovery evidence, never by an ad hoc
// caller list (plan line 552). A component missing from the published `components` map is
// the one shape this contract may never produce, so all three are pre-seeded before any
// read and are present even on the partial attached to a thrown CIRCUIT_OPEN.
export const AI_BUNDLE_COMPONENTS = Object.freeze(['conversation_ai', 'voice_ai', 'agent_studio']);

// The closed warning vocabularies. Closed on purpose: an auditor BRANCHES on these codes and
// a free-text reason cannot be branched on. Adding a code is a contract change.
export const ROSTER_WARNINGS = Object.freeze({
  // One 200 carrying TWO readings of itself. Distinct from ROSTER_PAGE_READ_FAILED, which
  // means "no key I know" — this means "more keys than I know what to do with, and they
  // disagree". An auditor branches on them differently: the first is a rail that has fallen
  // behind the API, the second is an upstream response that contradicts itself.
  ROSTER_ENVELOPE_CONFLICT: 'ROSTER_ENVELOPE_CONFLICT',
  ROSTER_DUPLICATE_ID_CONFLICT: 'ROSTER_DUPLICATE_ID_CONFLICT',
  ROSTER_TOTAL_CHANGED: 'ROSTER_TOTAL_CHANGED',
  ROSTER_TOTAL_UNAVAILABLE: 'ROSTER_TOTAL_UNAVAILABLE',
  ROSTER_TOTAL_MISMATCH: 'ROSTER_TOTAL_MISMATCH',
  // The OVER-count, which is a different upstream fault from the under-count above and was
  // previously reported as neither. Before this code existed, a page carrying MORE unique
  // rows than its own reported total fell past the equality terminal, past the short-page
  // test (a full page), past the zero-progress test (it gained rows), and the walk then spent
  // its entire page budget re-asking for rows that were already in hand — finally blaming
  // ROSTER_PAGE_BUDGET_EXHAUSTED for a defect that has nothing to do with the budget. It also
  // left the equality test undefended: relaxing `uniqueCount === reportedTotal` to `>=`
  // survived the whole suite, because no fixture could ever reach the over-count branch.
  ROSTER_TOTAL_OVERCOUNT: 'ROSTER_TOTAL_OVERCOUNT',
  ROSTER_EMPTY_PAGE: 'ROSTER_EMPTY_PAGE',
  ROSTER_NO_UNIQUE_PROGRESS: 'ROSTER_NO_UNIQUE_PROGRESS',
  ROSTER_ROW_MALFORMED: 'ROSTER_ROW_MALFORMED',
  ROSTER_ROW_ID_MISSING: 'ROSTER_ROW_ID_MISSING',
  ROSTER_PAGE_BUDGET_EXHAUSTED: 'ROSTER_PAGE_BUDGET_EXHAUSTED',
  ROSTER_PAGE_READ_FAILED: 'ROSTER_PAGE_READ_FAILED',
  IDENTITY_CONFLICT_QUARANTINE: 'IDENTITY_CONFLICT_QUARANTINE',
  IDENTITY_INSPECTION_INCOMPLETE: 'IDENTITY_INSPECTION_INCOMPLETE',
  RATE_LIMITED: 'RATE_LIMITED',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
});

export const AI_BUNDLE_WARNINGS = Object.freeze({
  AI_DISCOVERY_READ_FAILED: 'AI_DISCOVERY_READ_FAILED',
  AI_DISCOVERY_UNREADABLE: 'AI_DISCOVERY_UNREADABLE',
  // The AI twin of ROSTER_ENVELOPE_CONFLICT, and separate from AI_DISCOVERY_UNREADABLE for
  // the same reason: "no key I recognise" and "two keys that contradict each other" are
  // different upstream faults and an auditor acts on them differently.
  AI_DISCOVERY_ENVELOPE_CONFLICT: 'AI_DISCOVERY_ENVELOPE_CONFLICT',
  AI_DISCOVERY_ROW_MALFORMED: 'AI_DISCOVERY_ROW_MALFORMED',
  AI_DISCOVERY_ROW_ID_MISSING: 'AI_DISCOVERY_ROW_ID_MISSING',
  // The AI twin of ROSTER_DUPLICATE_ID_CONFLICT. Discovery used to collapse two rows sharing
  // an id into whichever arrived first, silently — so a soft-deleted tombstone arriving ahead
  // of a live agent with the same id classified the LIVE agent out of the audit entirely
  // (`detailDenominator: 0`, `complete: true`). The roster has warned on exactly this shape
  // since it shipped; the AI walk merely never looked.
  AI_DISCOVERY_DUPLICATE_ID_CONFLICT: 'AI_DISCOVERY_DUPLICATE_ID_CONFLICT',
  AI_DISCOVERY_PAGE_BUDGET_EXHAUSTED: 'AI_DISCOVERY_PAGE_BUDGET_EXHAUSTED',
  AI_DISCOVERY_NO_UNIQUE_PROGRESS: 'AI_DISCOVERY_NO_UNIQUE_PROGRESS',
  AI_DISCOVERY_TOTAL_MISMATCH: 'AI_DISCOVERY_TOTAL_MISMATCH',
  // The AI twins of ROSTER_TOTAL_CHANGED and (half of) ROSTER_TOTAL_UNAVAILABLE. The AI walk
  // used to read `total` per page and reconcile against ONLY the terminal page's copy, keeping
  // no history at all — so an earlier page's total was discarded in silence. An Agent Studio
  // discovery that announced `total:500` on page 1 and then went quiet on a short page 2, or
  // that said 500 and then 150, published 150 agents as the COMPLETE, APPLICABLE surface with
  // zero warnings. That contradicts this module's own stated AI rule (see the header: a
  // reported total that disagrees with the rows makes the surface incomplete on EVERY AI
  // route) and the roster's ROSTER_TOTAL_CHANGED, which has guarded exactly this since it
  // shipped. Two codes rather than one because an auditor BRANCHES on them and "the number
  // moved" and "the number was retracted" are different upstream faults.
  AI_DISCOVERY_TOTAL_CHANGED: 'AI_DISCOVERY_TOTAL_CHANGED',
  AI_DISCOVERY_TOTAL_DISAPPEARED: 'AI_DISCOVERY_TOTAL_DISAPPEARED',
  AI_DETAIL_READ_FAILED: 'AI_DETAIL_READ_FAILED',
  AI_DETAIL_UNREADABLE: 'AI_DETAIL_UNREADABLE',
  // A detail response that is perfectly readable and describes SOMEBODY ELSE. See
  // readAgentRecord: the record was previously accepted on the strength of carrying an id at
  // all, never on that id being the one the request was issued for.
  AI_DETAIL_IDENTITY_MISMATCH: 'AI_DETAIL_IDENTITY_MISMATCH',
  AI_DELETION_SIGNAL_AMBIGUOUS: 'AI_DELETION_SIGNAL_AMBIGUOUS',
  AI_COMPANY_CONTEXT_UNAVAILABLE: 'AI_COMPANY_CONTEXT_UNAVAILABLE',
  AI_RAIL_UNAVAILABLE: 'AI_RAIL_UNAVAILABLE',
  AI_POLICY_REFUSED: 'AI_POLICY_REFUSED',
  IDENTITY_CONFLICT_QUARANTINE: 'IDENTITY_CONFLICT_QUARANTINE',
  IDENTITY_INSPECTION_INCOMPLETE: 'IDENTITY_INSPECTION_INCOMPLETE',
  RATE_LIMITED: 'RATE_LIMITED',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
});

// The CLOSED error-code vocabulary, which `component.errors[].code` was previously not
// checked against at all (the suite asserted only `typeof === 'string'`). An error code is an
// open union of THREE closed sources — the warning vocabulary above, the gateway's RETURNED
// failure classes, and the policy codes it THROWS — so the union is enumerable even though no
// single one of them enumerates it. `HTTP_<status>` is the one member that is generated
// rather than named, and is admitted by pattern; everything else must be a literal below, so
// a new error code cannot enter a published artifact without a contract edit.
export const AI_BUNDLE_ERROR_CODES = Object.freeze([
  ...new Set([
    // Every warning code EXCEPT CIRCUIT_OPEN, which is re-thrown by absorbThrow before any
    // error can be recorded for it: a latched circuit is a fact about the run, not about a
    // component's read, and admitting it here would advertise a shape this rail never emits.
    ...Object.values(AI_BUNDLE_WARNINGS).filter((code) => code !== AI_BUNDLE_WARNINGS.CIRCUIT_OPEN),
    // RETURNED by the gateway as `failureClass` (Task 2 carry-forward).
    CODES.AUTH_REJECTED, CODES.RATE_LIMITED, CODES.LOCATION_RATE_LIMITED,
    CODES.INVALID_RESPONSE_BODY, CODES.IDENTITY_CONFLICT, CODES.IDENTITY_INSPECTION_CAPPED,
    CODES.IDENTITY_DEPTH_CAPPED, CODES.IDENTITY_UNREADABLE,
    // THROWN by audit policy and absorbed per component by absorbThrow. CIRCUIT_OPEN is
    // deliberately absent: it is re-thrown, never recorded as a component error.
    CODES.UNKNOWN_CAPABILITY, CODES.UNKNOWN_CAPABILITY_HOST, CODES.AMBIGUOUS_CAPABILITY,
    CODES.ABSOLUTE_PATH_REJECTED, CODES.CAPABILITY_TRACE_MISMATCH, CODES.UNAPPROVED_METHOD,
    CODES.MISSING_PATH_BINDING, CODES.INVALID_PATH_BINDING, CODES.UNKNOWN_QUERY_KEY,
    CODES.MISSING_QUERY_KEY, CODES.DUPLICATE_QUERY_KEY, CODES.FIXED_QUERY_VALUE_MISMATCH,
    CODES.DISALLOWED_QUERY_VALUE, CODES.QUERY_BOUND_VIOLATION, CODES.BINDING_MISMATCH,
    CODES.LOCATION_BINDING_MISMATCH, CODES.MISSING_AUTH_RAIL, CODES.TRANSPORT_FAILED,
    CODES.INVALID_CIRCUIT_SCOPE, CODES.IDENTITY_INSPECTION_FAILED,
    // The absorbThrow fallback for an error carrying no `.code` at all.
    CODES.ENGINE_ABORT,
  ].filter((code) => typeof code === 'string')),
].sort());

// `HTTP_<status>` is synthesised from the status line, so it is admitted by shape rather than
// by name. Three digits exactly: a four-digit "status" is not a status.
export const isAiBundleErrorCode = (code) => AI_BUNDLE_ERROR_CODES.includes(code)
  || /^HTTP_\d{3}$/.test(String(code));

// One row per surface, so the sweep is a loop over data rather than three near-copies of the
// same code. `paginated` is a property of the DESCRIPTOR, not a preference: the Conversation
// AI and Voice AI discovery descriptors declare `locationId` as their only query key, so
// there is no page parameter to send and a second call to either is a defect rather than a
// page. Only Agent Studio paginates, and only it binds a company.
const AI_SURFACES = Object.freeze({
  conversation_ai: Object.freeze({
    discoveryCapabilityId: 'conversation_ai_agent_discovery',
    detailCapabilityId: 'conversation_ai_agent_detail',
    paginated: false,
    requiresCompany: false,
  }),
  voice_ai: Object.freeze({
    discoveryCapabilityId: 'voice_ai_agent_discovery',
    detailCapabilityId: 'voice_ai_agent_detail',
    paginated: false,
    requiresCompany: false,
    // The Voice discovery route is the only one on which a soft-deleted tombstone has been
    // observed, and its detail route is forbidden for such a row. The rule is stated for
    // THIS route only: applying it to a product whose deletion schema this rail has never
    // seen would drop a live configuration on the strength of a guess.
    tombstonesApply: true,
  }),
  agent_studio: Object.freeze({
    discoveryCapabilityId: 'agent_studio_agent_discovery',
    detailCapabilityId: 'agent_studio_agent_detail',
    paginated: true,
    requiresCompany: true,
  }),
});

// --- capability versions --------------------------------------------------------
// Each composite hashes ONLY the descriptors it declares. Hashing the whole 16-descriptor
// set meant an edit to an unrelated descriptor invalidated every already-collected artifact
// for a reason that could not possibly have changed what it observed. A receipt must be
// invalidated by a change to the policy it was collected under, and by nothing else.
export const ROSTER_CAPABILITY_IDS = Object.freeze(['workflow_roster_list']);
export const AI_BUNDLE_CAPABILITY_IDS = Object.freeze([
  'conversation_ai_agent_discovery',
  'conversation_ai_agent_detail',
  'voice_ai_agent_discovery',
  'voice_ai_agent_detail',
  'agent_studio_agent_discovery',
  'agent_studio_agent_detail',
]);

// Recursive key-sort then SHA-256. Key order is an artifact of JSON parsing, not of content,
// so hashing the raw serialization would make two identical values hash differently.
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const sha256Canonical = (value) => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

// Derived from the descriptor module rather than hand-written so it cannot drift from the
// policy it claims to describe. A missing descriptor is FATAL, never skipped: a
// silently-dropped id would produce a version hash describing a SMALLER policy than the one
// the composite actually calls under, which is the single failure mode a version exists to
// prevent. Exported as a function purely so that fatal branch is testable — injecting the
// descriptor list is safe here in a way it is NOT at the gateway (Task 2 carry-forward item
// 7), because this list feeds a HASH and never a request.
export function resolveConfigurationDescriptors(capabilityIds, descriptors = AUDIT_CAPABILITIES) {
  return capabilityIds.map((capabilityId) => {
    const descriptor = descriptors.find((candidate) => candidate.capabilityId === capabilityId);
    if (!descriptor) {
      throw new Error(`AUDIT_CONFIGURATION_DESCRIPTOR_MISSING: ${capabilityId} is not in the audit descriptor set`);
    }
    return descriptor;
  });
}
export const ROSTER_CAPABILITY_VERSION = `sha256:${sha256Canonical(resolveConfigurationDescriptors(ROSTER_CAPABILITY_IDS))}`;
export const AI_BUNDLE_CAPABILITY_VERSION = `sha256:${sha256Canonical(resolveConfigurationDescriptors(AI_BUNDLE_CAPABILITY_IDS))}`;

// --- input validation -----------------------------------------------------------
// Separated from collection so the TOOL can reject an illegal request before it constructs a
// gateway: building one first spends a credential read (and, on a caller that logs
// construction, registers a spurious audit trace) for a request that was never legal.

const invalidInput = (detail) => {
  const error = new Error(`${CODES.INVALID_AUDIT_CONFIGURATION_INPUT}: ${detail}`);
  error.code = CODES.INVALID_AUDIT_CONFIGURATION_INPUT;
  error.detail = detail;
  error.remediation = 'Pass a non-empty locationId bound to this audit gateway, an in-range page budget, and (for the AI bundle) a non-empty companyId when Agent Studio must be read.';
  return error;
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

const boundedInteger = (value, { min, max, fallback, name }) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw invalidInput(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

export function validateRosterInput(input = {}) {
  const source = input ?? {};
  if (!isNonEmptyString(source.locationId)) throw invalidInput('locationId must be a non-empty string');
  return {
    locationId: source.locationId,
    pageSize: boundedInteger(source.pageSize, { min: 1, max: ROSTER_MAX_PAGE_SIZE, fallback: ROSTER_DEFAULTS.pageSize, name: 'pageSize' }),
    maxPages: boundedInteger(source.maxPages, { min: 1, max: MAX_PAGE_BUDGET, fallback: ROSTER_DEFAULTS.maxPages, name: 'maxPages' }),
  };
}

export function validateAiBundleInput(input = {}) {
  const source = input ?? {};
  if (!isNonEmptyString(source.locationId)) throw invalidInput('locationId must be a non-empty string');
  // ABSENT is legal, EMPTY is not. A missing companyId is a real operating condition (the
  // agency context was never captured) and is answered locally, per component, by
  // AI_COMPANY_CONTEXT_UNAVAILABLE — see the discovery step. An empty string is a caller
  // bug: it would satisfy every presence check downstream and address nothing.
  if (source.companyId !== undefined && !isNonEmptyString(source.companyId)) {
    throw invalidInput('companyId must be a non-empty string when supplied');
  }
  return {
    locationId: source.locationId,
    companyId: source.companyId ?? null,
    maxPages: boundedInteger(source.maxPages, { min: 1, max: MAX_PAGE_BUDGET, fallback: AI_BUNDLE_DEFAULTS.maxPages, name: 'maxPages' }),
  };
}

// The gateway is bound to exactly one location and is authoritative about it. A disagreement
// is a wiring bug, and letting it through would produce an artifact labelled with one
// location and collected from another.
const bindGateway = (auditGateway, locationId) => {
  if (!auditGateway || typeof auditGateway.callCapability !== 'function') {
    throw invalidInput('an audit gateway exposing callCapability is required');
  }
  const boundLocationId = auditGateway.locationId ?? locationId;
  if (String(boundLocationId) !== locationId) {
    throw invalidInput('the requested locationId is not the location this audit gateway is bound to');
  }
  return String(boundLocationId);
};

// --- payload readers ------------------------------------------------------------
// Envelope shapes are live-verified per route but not guaranteed, so an unrecognised shape
// returns null (= "I could not read this") rather than [] (= "there was nothing"). That
// distinction IS the contract.
//
// TASK 7 CANARY RECONCILIATION (1 of 4) — SETTLED 2026-07-27, AND REMOVED FROM THE CANARY.
// This key list used to be a guess, and on the one route that matters most it was the WRONG
// guess. The observed `/workflow/{locationId}/list` envelope is
// `{rows, count, isLocationRateLimited}` with a NUMERIC `count` — not `{workflows, total}`:
//   - ghl-internal-api-research/docs/03-endpoints.md:167, DISCOVERIES.md:121
//   - ghl-workflow-api-docs/site/public/openapi.json, x-proof "live-runtime" (2026-07-21)
//   - core/tools.mjs:762-763, the shipped and live-exercised reader for the same route
// Against a real account the old list matched NEITHER half: rows fell to
// ROSTER_PAGE_READ_FAILED and the walk published zero workflows, and repairing only the rows
// key would still have left every roster permanently ROSTER_TOTAL_UNAVAILABLE. Both halves
// are read here now, and BOTH key families are accepted rather than trading one bet for
// another — with the keys actually observed recorded on the result (`envelopeShape`), so the
// first live run pins the shape as evidence instead of as this comment's say-so.
//
// Recorded on the result when a page arrived as a BARE ARRAY rather than an envelope, so
// "the shape carried no key" and "no page was ever read" stay distinguishable in the
// evidence. `/workflows/logs/v2` is a bare array upstream, so this is a real GHL shape.
// Declared BEFORE its first textual use: these readers are called long after module
// evaluation, but a reader who has to prove that to themselves has already been slowed down.
const BARE_ARRAY = '<bare-array>';

// Rows and totals are read by the SAME rule: try each candidate in order, and treat two
// candidates that are both present but DISAGREE as a contradiction rather than a preference.
// Silently preferring the first-listed key would let `{rows:[…3 rows…], workflows:[…40
// rows…]}` publish 3 workflows as a complete roster. There is no reading of that response
// this rail can defend, so it makes none — it reports the conflict and reads nothing.
const readRows = (json, keys) => {
  if (Array.isArray(json)) return { rows: json, key: BARE_ARRAY, conflict: null };
  if (!json || typeof json !== 'object') return { rows: null, key: null, conflict: null };
  const present = keys.filter((key) => Array.isArray(json[key]));
  if (present.length === 0) return { rows: null, key: null, conflict: null };
  const [first, ...rest] = present;
  // Hashed, not length-compared: two same-length arrays of DIFFERENT rows are exactly the
  // case a length check waves through, and it is the case that loses rows.
  const canonical = sha256Canonical(json[first]);
  const disagreeing = rest.filter((key) => sha256Canonical(json[key]) !== canonical);
  if (disagreeing.length > 0) return { rows: null, key: null, conflict: [first, ...disagreeing] };
  return { rows: json[first], key: first, conflict: null };
};

// TASK 7 CANARY RECONCILIATION (2 of 4) — the total half of the same settlement. A total is
// still read ONLY from an ALREADY-NUMERIC value: `Number.isFinite` rather than a coercion is
// the whole point, because `count:"240"` coerces to a perfectly plausible 240 and a walk that
// accepted it would reconcile against a number whose type it had merely guessed. Every total
// on every route in the capture corpus is a real number, so the strictness costs nothing that
// has actually been observed.
const readTotalFrom = (json, keys) => {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { total: null, key: null, conflict: null };
  const present = keys.filter((key) => Number.isFinite(json[key]));
  if (present.length === 0) return { total: null, key: null, conflict: null };
  const [first, ...rest] = present;
  const disagreeing = rest.filter((key) => json[key] !== json[first]);
  if (disagreeing.length > 0) return { total: null, key: null, conflict: [first, ...disagreeing] };
  return { total: json[first], key: first, conflict: null };
};

// The candidate key sets, per surface, ordered by observation strength.
//
// ROSTER — `rows`/`count` are the live-observed pair (see above). `workflows`/`data`/`total`
// are retained rather than replaced: dropping a candidate can only ever turn a readable
// envelope into an unreadable one, and this rail has no second chance at a page it refused.
const ROSTER_ROW_KEYS = Object.freeze(['rows', 'workflows', 'data']);
const ROSTER_TOTAL_KEYS = Object.freeze(['count', 'total']);

// AI — `items` + a root numeric `total` is captured on `/agent-studio/agents-with-folders`
// (the route this rail's descriptor actually reads); `employees` + `totalCount` on the
// `/ai-employees` search routes; `agents` on `/agent-studio/agents`.
//
// `count` is DELIBERATELY ABSENT from the AI total keys. On `/ai-employees/employees/search`
// it is reported alongside `totalCount` carrying the SAME value on a single-page response,
// so nothing observed distinguishes "rows on this page" from "rows in the surface" — and a
// page count read as a surface total is a false terminal, which is the one failure this
// module exists to refuse. RESIDUAL, RECORDED: `/agent-studio/agents` nests its total under
// `pagination` rather than at the root. That is not the route read here, and a nested probe
// is not added on the strength of a route this rail never calls; if a descriptor is ever
// pointed at it, the total reads as absent (incomplete, loud) rather than as wrong.
const AI_ROW_KEYS = Object.freeze(['agents', 'employees', 'data', 'items']);
const AI_TOTAL_KEYS = Object.freeze(['total', 'totalCount']);

// The real Mongo/BSON wrappers an id can arrive inside. This list is a deliberate COPY of
// `ID_WRAPPER_KEYS` in core/audit-gateway.mjs — that module's copy is private, and the two are
// asserted identical as a SOURCE property by test/audit-configuration.test.mjs so the copy
// cannot drift. Without the unwrap, `[{_id:{$oid:'b1'}}, {_id:{$oid:'b2'}}]` both stringify to
// "[object Object]": the second row is deduped away as a repeat of the first, and the one
// surviving detail call addresses `/voice-ai/agents/%5Bobject%20Object%5D`. The gateway names
// this shape as REAL and readable, so this rail may not treat it as an absent id.
const ID_WRAPPER_KEYS = ['$oid', '_id', 'id'];
const unwrapId = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return raw;
  if (Array.isArray(raw)) return null;              // an id is never a list
  for (const key of ID_WRAPPER_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const inner = raw[key];
    // ONE level only, exactly as the gateway does it. `{$oid:{$oid:'x'}}` is not a shape this
    // API emits, and unwrapping recursively starts inventing readings for arbitrary nesting.
    return inner !== null && inner !== undefined && typeof inner !== 'object' ? inner : null;
  }
  return null;                                      // an unrecognised object shape is unreadable
};

const idOf = (row) => {
  if (row === null || row === undefined) return null;
  // `_id` first, `id` second, and an UNREADABLE `_id` falls through to `id` rather than
  // condemning the row: the fallback is what the two keys are for.
  for (const key of ['_id', 'id']) {
    const raw = unwrapId(row[key]);
    if (raw === null) continue;
    const value = String(raw);
    // The empty string is not an id. It addresses nothing, it collides with every other
    // empty-id row, and it is one deleted guard away from letting `{_id:''}` reconcile a
    // roster against its own reported total.
    if (value !== '') return value;
  }
  return null;
};

// Ids are normalised to strings BEFORE hashing: `{_id: 5}`, `{_id: '5'}` and `{_id:{$oid:'5'}}`
// are ONE row serialized three ways, and hashing them unnormalised makes them three payloads
// sharing one id — which is precisely the shape of a genuine duplicate-id conflict.
const contentHashOf = (row) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return sha256Canonical(row ?? null);
  const normalized = { ...row };
  for (const key of ['_id', 'id']) {
    if (!Object.hasOwn(normalized, key)) continue;
    const unwrapped = unwrapId(normalized[key]);
    // An UNREADABLE id is left exactly as it arrived: it is not an id this rail can claim to
    // know, so flattening it to a string would merge two rows it cannot tell apart.
    if (unwrapped !== null) normalized[key] = String(unwrapped);
  }
  return sha256Canonical(normalized);
};

// A PER-RESPONSE row keyer. Rows returned by a SINGLE response are provably distinct, so an
// id-less row is keyed by its occurrence index within that response and both copies survive;
// the keyer is constructed fresh per response precisely so those indices RESTART, and a page
// re-served under a repeated offset therefore still dedupes to one copy.
const makeRowKeyer = () => {
  const idlessOccurrences = new Map();
  return (row) => {
    const id = idOf(row);
    if (id !== null) return `id:${id}`;
    const hash = contentHashOf(row);
    const occurrence = idlessOccurrences.get(hash) ?? 0;
    idlessOccurrences.set(hash, occurrence + 1);
    return `noid:${hash}#${occurrence}`;
  };
};

// Accumulates the envelope keys a walk actually met, so `envelopeShape` on the result is an
// observation rather than a restatement of the candidate lists above. A walk that read no
// page at all reports empty arrays — which is why the keys are collected here and not
// derived from the candidate constants.
const makeShapeLog = () => {
  const rowsKeys = new Set();
  const totalKeys = new Set();
  return {
    record: ({ rowsKey, totalKey }) => {
      if (rowsKey !== null && rowsKey !== undefined) rowsKeys.add(rowsKey);
      if (totalKey !== null && totalKey !== undefined) totalKeys.add(totalKey);
    },
    // Sorted so two runs over the same account produce byte-identical evidence.
    read: () => ({ rowsKeys: [...rowsKeys].sort(), totalKeys: [...totalKeys].sort() }),
  };
};

// --- warnings --------------------------------------------------------------------
// ONE WARNING SHAPE, WHATEVER EMITTED IT. Every object carries exactly
// `{code, component, detail, detailSamples, occurrences}`. Task 3 shipped two shapes for a
// while: a consumer walking the array met `occurrences: 3` on some codes and `undefined` on
// the rest, and `sum += w.occurrences` is NaN from the first plain warning onward. A plain
// warning IS a one-occurrence warning, so it says so.
const WARNING_DETAIL_SAMPLES = 3;

function makeWarningLog() {
  const warnings = [];
  const aggregated = new Map();
  return {
    warnings,
    warn(code, component, detail) {
      warnings.push({ code, component, detail, detailSamples: [detail], occurrences: 1 });
    },
    // ROW-SCOPED warnings are AGGREGATED, one object per (code, component). A code that
    // fires per row is unbounded in the size of the account's data, and 20,000 copies of one
    // sentence is not evidence but ballast in an artifact that is serialized over stdio and
    // hashed whole into the proof ledger.
    //
    // The `component` half of the key is LOAD-BEARING HERE, unlike in Task 3 where every
    // call site passed one component and the half was unreachable. This bundle has three
    // independent surfaces, and one aggregated code firing on two of them must produce TWO
    // objects with independent counters — otherwise an auditor reading `occurrences: 3`
    // cannot tell one badly-shaped surface from three.
    warnAggregated(code, component, detail) {
      const key = `${code}::${component}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.occurrences += 1;
        if (existing.detailSamples.length < WARNING_DETAIL_SAMPLES && !existing.detailSamples.includes(detail)) {
          existing.detailSamples.push(detail);
        }
        return;
      }
      const entry = { code, component, detail, detailSamples: [detail], occurrences: 1 };
      aggregated.set(key, entry);
      warnings.push(entry);
    },
  };
}

// Maps a RETURNED failure class onto a warning code. The identity classes keep their own
// codes because "this response provably belongs to somebody else" and "I could not prove
// this response belongs to me" demand different operator responses, even though the verdict
// is identical: not a read.
const warningForFailure = (failureClass, fallbackCode) => {
  if (failureClass === CODES.RATE_LIMITED || failureClass === CODES.LOCATION_RATE_LIMITED) return 'RATE_LIMITED';
  if (failureClass === CODES.IDENTITY_CONFLICT) return 'IDENTITY_CONFLICT_QUARANTINE';
  if (failureClass === CODES.IDENTITY_INSPECTION_CAPPED
    || failureClass === CODES.IDENTITY_DEPTH_CAPPED
    || failureClass === CODES.IDENTITY_UNREADABLE) {
    return 'IDENTITY_INSPECTION_INCOMPLETE';
  }
  return fallbackCode;
};

const failureDetail = (response, capabilityId) => `capability ${response.capabilityId ?? capabilityId} returned `
  + `${response.failureClass ?? 'an unusable response'} (status ${response.status ?? 'unknown'})`;

// --- the workflow roster ----------------------------------------------------------

export async function listWorkflowsComplete({ auditGateway, input } = {}) {
  const config = validateRosterInput(input);
  const boundLocationId = bindGateway(auditGateway, config.locationId);

  const { warnings, warn, warnAggregated } = makeWarningLog();
  const appliedQueries = [];
  const sourceRoutes = [];
  const conflicts = [];
  const bindingMethods = new Set();
  const rateLimit = { limited: false, retryAfterMs: null };
  const pagination = { attempted: 0, fetched: 0, exhausted: false, budget: config.maxPages };
  const totalHistory = [];
  const uniqueProgress = [];
  const shapeLog = makeShapeLog();
  const seenIds = new Map();      // id -> Set of content hashes
  const conflictedIds = new Set();
  let capturedAt = null;
  let quarantined = false;
  let identityIncomplete = false;
  // `null` until a page is READ, never `[]`. A 403 on the first page and an account with no
  // workflows otherwise produce the same JSON, and this rail may not publish an array it
  // never observed.
  let workflows = null;
  let uniqueCount = 0;
  let reportedTotal = null;
  let terminalReason = null;

  const read = async (query) => {
    const response = await auditGateway.callCapability({
      capabilityId: 'workflow_roster_list',
      typedBindings: { locationId: boundLocationId },
      query,
    });
    appliedQueries.push({ capabilityId: 'workflow_roster_list', query });
    sourceRoutes.push({
      capabilityId: 'workflow_roster_list',
      // The gateway resolves the HOST as well as the path, and a receipt reader who only
      // sees the path cannot tell which rail answered.
      host: response.host,
      appliedPath: response.appliedPath,
      appliedQuery: response.appliedQuery,
      status: response.status,
      ok: response.ok,
      failureClass: response.failureClass,
      capturedAt: response.capturedAt,
    });
    // The FIRST response's capture time is the run's: it is the earliest instant any of this
    // evidence was observed, so a consumer comparing a receipt against a later change cannot
    // be told the roster was captured after the change.
    if (capturedAt === null && typeof response.capturedAt === 'string') capturedAt = response.capturedAt;
    const identity = response.identity;
    if (identity && typeof identity === 'object') {
      if (typeof identity.bindingMethod === 'string') bindingMethods.add(identity.bindingMethod);
      for (const conflict of identity.conflicts ?? []) conflicts.push({ capabilityId: 'workflow_roster_list', ...conflict });
      if (identity.inspectionCapped || identity.depthCapped || (identity.unreadable ?? []).length > 0) {
        identityIncomplete = true;
      }
    }
    if (response.quarantined === true) quarantined = true;
    if (response.failureClass === CODES.RATE_LIMITED || response.failureClass === CODES.LOCATION_RATE_LIMITED) {
      rateLimit.limited = true;
      if (typeof response.retryAfterMs === 'number') rateLimit.retryAfterMs = response.retryAfterMs;
    }
    return response;
  };

  const finalize = () => {
    // A throttle produces `complete:false` on its own, whatever tripped it, and the warning
    // is filed here rather than only at the tripping site so `complete:false` always arrives
    // with a stated reason.
    if (rateLimit.limited && !warnings.some((entry) => entry.code === ROSTER_WARNINGS.RATE_LIMITED)) {
      warn(ROSTER_WARNINGS.RATE_LIMITED, 'workflow_roster',
        'a read in this walk was throttled by the account, so the roster is provably less than the whole one');
    }
    // Every code in the vocabulary marks data that is missing, contradicted or unverifiable,
    // so `truncated` below is `!complete` — the two fields are IDENTICAL by construction
    // today, not merely correlated. They are nonetheless kept as separate contract fields
    // because they answer different questions ("may I publish a claim about this roster"
    // versus "is there known-missing data") and a future warning that marks a fully-read
    // roster would separate them; until such a code exists, no consumer should imagine it can
    // learn anything from one that the other does not already tell it. Task 3 carries the
    // same redundancy in the same shape, deliberately.
    //
    // `!rateLimit.limited` is DEFENCE IN DEPTH and is currently unreachable: the block above
    // guarantees a RATE_LIMITED warning whenever the flag is set, so `warnings.length === 0`
    // has already decided it. It stays because the alternative — a throttled walk published as
    // complete — is the single worst artifact this composite can emit, and it would then rest
    // on nothing but the block above continuing to exist. Deleting the term is an EQUIVALENT
    // mutant: no test can kill it, which is exactly why it is documented rather than trusted.
    const complete = warnings.length === 0 && !rateLimit.limited;
    return {
      appliedQueries,
      boundLocationId,
      capabilityVersion: ROSTER_CAPABILITY_VERSION,
      capturedAt,
      complete,
      // The envelope keys each value was actually READ FROM — not every candidate the reader
      // was willing to accept, and not every key that happened to be present. Two keys that
      // agree are ONE reading, so only the key the value came from is named; naming both
      // would imply the walk had two independent observations when it had one.
      //
      // The two halves are recorded SEPARATELY and on purpose: a page whose rows contradicted
      // themselves but whose total read cleanly reports `{rowsKeys:[], totalKeys:['count']}`,
      // so the artifact says WHICH half of the envelope failed rather than only that one did.
      //
      // This is the field that retires canary item 1 of 4: the first live run records
      // `rows`/`count` here as evidence, and if a future GHL release moves either key the
      // change is visible in the artifact instead of surfacing as an unexplained empty
      // roster with a warning that blames the wrong thing.
      envelopeShape: shapeLog.read(),
      locationBinding: {
        // Absence records request-scope binding: a weaker claim than a native match but
        // still evidence. Downgrading absence to a failure would make most of this API
        // unreadable; upgrading it to a native match would claim proof that does not exist.
        bindingMethod: bindingMethods.size === 1 ? [...bindingMethods][0] : bindingMethods.size === 0 ? 'request_scope' : 'mixed',
        quarantined,
        conflicts,
        inspectionIncomplete: identityIncomplete,
      },
      pagination,
      rateLimit,
      reportedTotal,
      sourceRoutes,
      terminalReason,
      totalHistory,
      truncated: !complete,
      uniqueCount,
      uniqueProgress,
      warnings,
      workflows,
    };
  };

  try {
    await walk();
    return finalize();
  } catch (error) {
    if (error && error.code === CODES.CIRCUIT_OPEN) {
      // The throw still propagates — a latched circuit means stop and resume deliberately,
      // not retry. But the pages already read are real evidence, and discarding them made a
      // resumer re-walk offsets it had already paid for with no way to know which.
      warn(ROSTER_WARNINGS.CIRCUIT_OPEN, 'workflow_roster',
        `the audit circuit latched mid-walk (${error.meta?.scope ?? 'unknown scope'}/${error.meta?.reason ?? 'unknown reason'}); everything read before the latch is attached to error.partial`);
      error.partial = finalize();
    }
    throw error;
  }

  async function walk() {
    let offset = 0;
    for (;;) {
      // Checked BEFORE the read: the budget is the only thing between a pathological account
      // and an unbounded walk, so hitting it must be a stated incompleteness rather than a
      // quiet stop — and the page it refuses must never be requested.
      if (pagination.attempted >= pagination.budget) {
        pagination.exhausted = true;
        warn(ROSTER_WARNINGS.ROSTER_PAGE_BUDGET_EXHAUSTED, 'workflow_roster',
          `the roster page budget of ${pagination.budget} was spent with rows still unread`);
        return;
      }
      // Five of the seven required keys are pinned by the descriptor. They are spelled out
      // here rather than defaulted anywhere else so the emitted query and the receipt are
      // the same object.
      const query = {
        type: 'workflow',
        limit: String(config.pageSize),
        offset: String(offset),
        sortBy: 'name',
        sortOrder: 'asc',
        includeCustomObjects: 'true',
        includeObjectiveBuilder: 'true',
      };
      pagination.attempted += 1;
      const response = await read(query);
      if (!response.ok) {
        warn(warningForFailure(response.failureClass, ROSTER_WARNINGS.ROSTER_PAGE_READ_FAILED), 'workflow_roster',
          failureDetail(response, 'workflow_roster_list'));
        return;
      }
      // Read BOTH halves of the envelope before either is used, so a page that contradicts
      // itself on its total is refused before its rows are counted into the walk.
      const rowsRead = readRows(response.json, ROSTER_ROW_KEYS);
      const totalRead = readTotalFrom(response.json, ROSTER_TOTAL_KEYS);
      shapeLog.record({ rowsKey: rowsRead.key, totalKey: totalRead.key });
      if (rowsRead.conflict !== null || totalRead.conflict !== null) {
        // Both conflicts are named in one warning: an auditor reading this needs to know the
        // response disagreed with itself, and which keys did the disagreeing, in one place.
        const parts = [];
        if (rowsRead.conflict !== null) parts.push(`row keys ${rowsRead.conflict.join('/')} carry different lists`);
        if (totalRead.conflict !== null) parts.push(`total keys ${totalRead.conflict.join('/')} report different numbers`);
        warn(ROSTER_WARNINGS.ROSTER_ENVELOPE_CONFLICT, 'workflow_roster',
          `the roster response contradicted itself (${parts.join('; ')}), so no reading of it can be defended`);
        return;
      }
      const rows = rowsRead.rows;
      if (rows === null) {
        // A 200 carrying an envelope this rail cannot read is not an empty roster. It is a
        // read that did not happen, and it is counted as one.
        warn(ROSTER_WARNINGS.ROSTER_PAGE_READ_FAILED, 'workflow_roster',
          'the roster response carried no readable workflow list');
        return;
      }
      pagination.fetched += 1;
      if (workflows === null) workflows = [];

      // NO per-response row keyer here, unlike the AI discovery walk. A roster row that
      // cannot be identified cannot be counted toward the reported total either, so the two
      // id-less cases the keyer exists to separate — "two distinct rows" and "one row echoed
      // by an overlapping page" — are indistinguishable AND equally unusable. They are
      // warned about and excluded rather than keyed.
      let gained = 0;
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          // Perfectly serializable and completely uncountable. A row that is not a record
          // would otherwise pad the unique count until it matched the reported total.
          warnAggregated(ROSTER_WARNINGS.ROSTER_ROW_MALFORMED, 'workflow_roster',
            'a roster row was not an object and cannot be counted toward the reported total');
          continue;
        }
        const id = idOf(row);
        if (id === null) {
          // "This is not a record" and "this record cannot be identified" are different
          // upstream faults, so they get different codes.
          warnAggregated(ROSTER_WARNINGS.ROSTER_ROW_ID_MISSING, 'workflow_roster',
            'a roster row carried neither _id nor id and cannot be counted toward the reported total');
          continue;
        }
        const hash = contentHashOf(row);
        const hashes = seenIds.get(id);
        if (hashes === undefined) {
          seenIds.set(id, new Set([hash]));
          uniqueCount += 1;
          gained += 1;
          workflows.push(row);
          continue;
        }
        if (hashes.has(hash)) continue;   // an identical re-serve across a page boundary
        hashes.add(hash);
        // Both copies are retained: one of them is wrong and this composite cannot tell
        // which, so keeping only the first would turn a contradiction into a confident
        // answer. AGGREGATED per offending id, so `occurrences` is the number of distinct
        // self-contradictory workflows — the number an auditor actually wants.
        workflows.push(row);
        if (!conflictedIds.has(id)) {
          conflictedIds.add(id);
          warnAggregated(ROSTER_WARNINGS.ROSTER_DUPLICATE_ID_CONFLICT, 'workflow_roster',
            `two roster rows share an id but not a content hash (${hashes.size} distinct payloads)`);
        }
      }
      uniqueProgress.push(gained);

      const pageTotal = totalRead.total;
      totalHistory.push(pageTotal);
      if (pageTotal === null) {
        // Without a reported total there is nothing to reconcile against, so a single short
        // page would be indistinguishable from a complete roster. The rows stay as evidence;
        // only the completeness claim is refused.
        warn(ROSTER_WARNINGS.ROSTER_TOTAL_UNAVAILABLE, 'workflow_roster',
          'the roster response reported no total, so the unique count cannot be reconciled against a terminal proof');
        return;
      }
      if (reportedTotal === null) {
        reportedTotal = pageTotal;
      } else if (pageTotal !== reportedTotal) {
        // The reported total IS the terminal proof. If it moves mid-walk there is no fixed
        // target, so "unique count equals the total" stops meaning anything.
        reportedTotal = pageTotal;
        warn(ROSTER_WARNINGS.ROSTER_TOTAL_CHANGED, 'workflow_roster',
          'the reported total changed mid-walk, so no fixed target remains to reconcile the unique count against');
        return;
      }

      // The ONLY terminal proof, and it is an EQUALITY. Reached first so a legitimately empty
      // account (zero rows against a reported zero) is publishable, while a zero-row page
      // below the total falls through to the walk faults below.
      if (uniqueCount === reportedTotal) {
        terminalReason = 'unique_count_equals_reported_total';
        return;
      }
      // The over-count, and the reason the line above may never be relaxed to `>=`. More
      // unique rows than the upstream's own reported total means the total and the collection
      // disagree, so there is no terminal proof to reach — publishing at the moment the count
      // sails past it would publish a roster reconciled against a number it had already
      // contradicted. Reported here, immediately, rather than left to fall through: an
      // over-count is a full page that gains rows, so it passes every remaining test below and
      // the walk used to spend its entire budget before blaming ROSTER_PAGE_BUDGET_EXHAUSTED
      // for a defect that has nothing to do with the budget.
      if (uniqueCount > reportedTotal) {
        warn(ROSTER_WARNINGS.ROSTER_TOTAL_OVERCOUNT, 'workflow_roster',
          `the walk holds ${uniqueCount} unique workflows against a smaller reported total of ${reportedTotal}, so the total is not a terminal proof`);
        return;
      }
      if (rows.length === 0) {
        warn(ROSTER_WARNINGS.ROSTER_EMPTY_PAGE, 'workflow_roster',
          'a zero-row page arrived below the reported total, which is a false terminal rather than the end of the roster');
        return;
      }
      if (gained === 0) {
        // A backend that ignores `offset` re-serves page one forever. Every page is full, so
        // no short-page test ever fires and the walk would spend its whole budget and then
        // blame the budget for a defect that is not a budget defect.
        warn(ROSTER_WARNINGS.ROSTER_NO_UNIQUE_PROGRESS, 'workflow_roster',
          'a page added no unique workflow while the unique count was still below the reported total');
        return;
      }
      if (rows.length < config.pageSize) {
        // The classic silent undercount: the upstream simply stops returning rows before its
        // own total is reached. A short page is terminal ONLY in conjunction with the count
        // reconciliation above, never on its own.
        warn(ROSTER_WARNINGS.ROSTER_TOTAL_MISMATCH, 'workflow_roster',
          `the walk ran out of rows at ${uniqueCount} unique workflows against a reported total of ${reportedTotal}`);
        return;
      }
      // The offset advances by the rows the page ACTUALLY returned, never by the requested
      // page size. At THIS point in the walk the two are provably equal — a short page has
      // already returned above — so the line is currently an identity and its former
      // justification ("advancing by pageSize would skip rows after a short page") described a
      // state this loop cannot be in. It is kept as-is anyway, because the identity is a
      // property of the guards above rather than of this line: reintroduce any path that
      // continues past a short page and `config.pageSize` starts skipping rows, silently, in a
      // walk whose whole output is a count.
      offset += rows.length;
    }
  }
}

// --- the AI configuration bundle --------------------------------------------------

// Tombstone grading, at the granularity the rule is stated in (plan line 548). A row is a
// non-applicable tombstone ONLY when the SCHEMA-VALID row carries BOTH `isDeleted === true`
// AND `agentStatus === "INACTIVE"`. Everything else is graded here rather than at the call
// site so that the three edges stay visible:
//
//   - `deleted` and `status` are three-valued plus absent, because `isDeleted: 'true'` (a
//     string) and `agentStatus: 'inactive'` (lower case) are each ONE loose comparison — a
//     `==` or a `toLowerCase()` — away from qualifying, and each such slip silently drops a
//     live agent's configuration while reporting the surface complete.
//   - ABSENCE OF THE SECOND FIELD IS NOT AGREEMENT WITH THE FIRST. A `??` default supplying
//     the missing half is the same bug wearing a different operator.
//   - AN ABSENT FIELD ON A ROW WITH NEITHER IS AN ORDINARY LIVE AGENT, not an unknown one.
//     This is the edge that matters most: if absence counted as an unknown deletion signal,
//     every ordinary agent would make its component incomplete and the rule would be
//     indistinguishable from "this rail can never read Voice AI".
const signalOf = (row, field, positive, negative) => {
  if (!Object.hasOwn(row, field)) return 'absent';
  if (row[field] === positive) return 'positive';
  if (row[field] === negative) return 'negative';
  return 'unknown';
};

const gradeDeletionSignals = (row) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'unreadable';
  const deleted = signalOf(row, 'isDeleted', true, false);
  const status = signalOf(row, 'agentStatus', 'INACTIVE', 'ACTIVE');
  if (deleted === 'positive' && status === 'positive') return 'tombstone';
  if ((deleted === 'negative' || deleted === 'absent') && (status === 'negative' || status === 'absent')) return 'live';
  return 'ambiguous';
};

// A detail response must carry an identifiable agent record. A 200 whose body is an object
// with no id is the quietest failure available: the gateway says ok:true, so a composite
// reaching for `json.agent ?? {}` would publish a confident empty configuration for an agent
// it never read.
//
// THIS FUNCTION ANSWERS ONLY "IS THERE A RECORD". It deliberately does NOT answer "is it the
// record I asked for" — that comparison needs the requested id and therefore lives at the call
// site, in `detail()`. Before it existed, this rail accepted any body carrying SOME id: a
// request for agent `b1` answered with agent `b2` was published as b1's configuration, with
// `complete:true`, `detailsRead:1` and zero warnings. The gateway cannot cover the gap either,
// because its identity check compares a body field literally named `agentId` and these bodies
// carry `_id`/`id`.
//
// TASK 7 CANARY RECONCILIATION (3 of 4): the `agent|employee|data` envelope key list below is
// UNVERIFIED against a live payload, exactly like `rowsOf`'s. It fails closed (an unknown
// envelope reads as AI_DETAIL_UNREADABLE), but a wrong list makes every detail read on that
// route unreadable, so the canary must confirm the real key per product.
const readAgentRecord = (json) => {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  for (const key of ['agent', 'employee', 'data']) {
    const nested = json[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested) && idOf(nested) !== null) return nested;
  }
  return idOf(json) === null ? null : json;
};

export async function getAiConfigurationBundle({ auditGateway, input } = {}) {
  const config = validateAiBundleInput(input);
  const boundLocationId = bindGateway(auditGateway, config.locationId);

  const { warnings, warn, warnAggregated } = makeWarningLog();
  const appliedQueries = [];
  const conflicts = [];
  const bindingMethods = new Set();
  const rateLimit = { limited: false, retryAfterMs: null };
  let capturedAt = null;
  let quarantined = false;
  let identityIncomplete = false;

  // ALL THREE, pre-seeded before any read. A component that was never attempted — because a
  // circuit latched, or because its rail was never wired — still appears, with
  // `applicable:'unknown'`, `complete:false` and `items:null`. A missing component is the one
  // shape this contract may never produce.
  // The shape logs live BESIDE the published components, not on them: a log is a pair of
  // closures and a component is a serialized artifact, and putting the two in one object is
  // how a `record`/`read` function ends up hashed into the proof ledger as `null`. Each
  // component's `envelopeShape` is read out of here at finalize.
  const shapeLogs = new Map(AI_BUNDLE_COMPONENTS.map((name) => [name, makeShapeLog()]));

  const components = {};
  for (const name of AI_BUNDLE_COMPONENTS) {
    components[name] = {
      applicable: 'unknown',
      complete: false,
      detailDenominator: 0,
      detailsRead: 0,
      errors: [],
      // The envelope keys this component's discovery walk actually met — the per-component
      // twin of the roster's field, and settled by the same 2026-07-27 capture review.
      // `/agent-studio/agents-with-folders` was observed emitting `items` + a root numeric
      // `total`; the `/ai-employees` search routes emit `employees` + `totalCount`. Both were
      // outside the old key lists in one half or the other.
      envelopeShape: { rowsKeys: [], totalKeys: [] },
      items: null,
      pages: {
        attempted: 0,
        fetched: 0,
        exhausted: false,
        // `null`, not `config.maxPages`, on the two SINGLE-SHOT surfaces. Their descriptors
        // declare no page parameter, so the budget is never consulted and never can be:
        // reporting a number there described a limit that does not apply to this surface, and
        // a reader comparing `attempted` against it would conclude there was headroom left
        // when there was never a second page to spend it on.
        budget: AI_SURFACES[name].paginated ? config.maxPages : null,
      },
      sourceRoutes: [],
      // One entry per page READ, `null` where that page reported no total — the roster's
      // `totalHistory`, per component, and published for the same reason: a walk whose whole
      // output is a count must let a reviewer see every number the upstream gave it, not just
      // the last one. `[]` on a component that never read a page is not a claim about totals;
      // `pages.fetched` already says nothing was read.
      totalHistory: [],
    };
  }

  // Errors are AGGREGATED, one object per (code, capabilityId, phase) per component, for the
  // same reason warnings are — and they were not, which was worse: every row-scoped and
  // item-scoped code fires once PER AGENT, so an Agent Studio surface at the default budget
  // whose detail route is failing produced 10,001 error objects alongside 10,001 warnings,
  // 8.46 MB of one repeated sentence, serialized over stdio and hashed whole into the proof
  // ledger. `occurrences` is the number an auditor actually wants; `detailSamples` keeps the
  // first three distinct texts so the aggregate is still diagnosable.
  //
  // Every error object carries the SAME key set, whichever site emitted it, for the reason
  // Task 3 learned about warnings: a consumer summing `occurrences` must never meet undefined.
  const errorIndex = new Map();
  const recordError = (component, code, capabilityId, phase, detail) => {
    const key = `${code}::${capabilityId}::${phase}`;
    let perComponent = errorIndex.get(component);
    if (perComponent === undefined) {
      perComponent = new Map();
      errorIndex.set(component, perComponent);
    }
    const existing = perComponent.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (existing.detailSamples.length < WARNING_DETAIL_SAMPLES && !existing.detailSamples.includes(detail)) {
        existing.detailSamples.push(detail);
      }
      return;
    }
    const entry = { code, capabilityId, phase, detail, detailSamples: [detail], occurrences: 1 };
    perComponent.set(key, entry);
    components[component].errors.push(entry);
  };

  const read = async (component, capabilityId, typedBindings, query) => {
    const response = await auditGateway.callCapability({ capabilityId, typedBindings, query });
    appliedQueries.push({ capabilityId, component, query });
    components[component].sourceRoutes.push({
      capabilityId,
      host: response.host,
      appliedPath: response.appliedPath,
      appliedQuery: response.appliedQuery,
      status: response.status,
      ok: response.ok,
      failureClass: response.failureClass,
      capturedAt: response.capturedAt,
    });
    if (capturedAt === null && typeof response.capturedAt === 'string') capturedAt = response.capturedAt;
    const identity = response.identity;
    if (identity && typeof identity === 'object') {
      if (typeof identity.bindingMethod === 'string') bindingMethods.add(identity.bindingMethod);
      for (const conflict of identity.conflicts ?? []) conflicts.push({ capabilityId, ...conflict });
      if (identity.inspectionCapped || identity.depthCapped || (identity.unreadable ?? []).length > 0) {
        identityIncomplete = true;
      }
    }
    if (response.quarantined === true) quarantined = true;
    if (response.failureClass === CODES.RATE_LIMITED || response.failureClass === CODES.LOCATION_RATE_LIMITED) {
      rateLimit.limited = true;
      if (typeof response.retryAfterMs === 'number') rateLimit.retryAfterMs = response.retryAfterMs;
    }
    return response;
  };

  // A THROWN policy fault degrades ONE surface. Only CIRCUIT_OPEN is allowed past here:
  // BINDING_MISMATCH, TRANSPORT_FAILED, IDENTITY_INSPECTION_FAILED, every query-policy code,
  // and above all MISSING_AUTH_RAIL are single-component facts. Letting them escape would
  // lose the other two surfaces to a fault that had nothing to do with them — and
  // "we could not authenticate the AI rail" is exactly the kind of honest incompleteness the
  // weekly auditor exists to report, not a crash.
  const absorbThrow = (error, component, capabilityId, phase) => {
    if (error && error.code === CODES.CIRCUIT_OPEN) throw error;
    const code = error?.code ?? CODES.ENGINE_ABORT;
    recordError(component, code, capabilityId, phase, error?.detail ?? `capability ${capabilityId} was refused before it reached the wire`);
    warn(
      code === CODES.MISSING_AUTH_RAIL ? AI_BUNDLE_WARNINGS.AI_RAIL_UNAVAILABLE : AI_BUNDLE_WARNINGS.AI_POLICY_REFUSED,
      component,
      `capability ${capabilityId} was refused by audit policy with ${code}`,
    );
  };

  const finalize = () => {
    if (rateLimit.limited && !warnings.some((entry) => entry.code === AI_BUNDLE_WARNINGS.RATE_LIMITED)) {
      warn(AI_BUNDLE_WARNINGS.RATE_LIMITED, 'run',
        'a read in this sweep was throttled by the account, so at least one surface returned less than it would have');
    }
    // Read out of the side logs HERE rather than at each record site, so a component that was
    // never attempted publishes `{rowsKeys:[], totalKeys:[]}` — an empty observation — and a
    // partial attached to a thrown CIRCUIT_OPEN carries whatever shapes were met before the
    // latch. Both go through this one line, so neither can drift from the other.
    for (const name of AI_BUNDLE_COMPONENTS) components[name].envelopeShape = shapeLogs.get(name).read();
    // `truncated` below is `!complete`: the two fields are IDENTICAL by construction today,
    // for the same reason and with the same caveat as on the roster. See that finalize.
    // `!rateLimit.limited` is likewise defence in depth and currently unreachable — the block
    // above guarantees a RATE_LIMITED warning whenever the flag is set — and deleting it is an
    // EQUIVALENT mutant no test can kill. It stays because "throttled but published as
    // complete" is the artifact this whole composite exists to prevent.
    const complete = warnings.length === 0 && !rateLimit.limited;
    return {
      appliedQueries,
      boundLocationId,
      capabilityVersion: AI_BUNDLE_CAPABILITY_VERSION,
      capturedAt,
      companyId: config.companyId,
      complete,
      components,
      contractVersion: AUDIT_CONFIGURATION_CONTRACT_VERSION,
      locationBinding: {
        bindingMethod: bindingMethods.size === 1 ? [...bindingMethods][0] : bindingMethods.size === 0 ? 'request_scope' : 'mixed',
        quarantined,
        conflicts,
        inspectionIncomplete: identityIncomplete,
      },
      rateLimit,
      truncated: !complete,
      warnings,
    };
  };

  try {
    for (const name of AI_BUNDLE_COMPONENTS) await sweep(name);
    return finalize();
  } catch (error) {
    if (error && error.code === CODES.CIRCUIT_OPEN) {
      warn(AI_BUNDLE_WARNINGS.CIRCUIT_OPEN, 'run',
        `the audit circuit latched mid-sweep (${error.meta?.scope ?? 'unknown scope'}/${error.meta?.reason ?? 'unknown reason'}); everything read before the latch is attached to error.partial`);
      error.partial = finalize();
    }
    throw error;
  }

  async function sweep(name) {
    const surface = AI_SURFACES[name];
    const component = components[name];
    const discovered = await discover(name, surface, component);
    // `items` stays null unless at least one discovery page was READ. A surface that could
    // not be read and a surface with no agents are one status code apart and must never
    // serialize identically.
    if (discovered === null) return;
    const { items, reconciled } = discovered;

    // APPLICABILITY IS NEVER DERIVED FROM AN UNRECONCILED READ. `applicable` used to be set
    // from `items.length > 0` the instant discovery returned, BEFORE anything knew whether the
    // enumeration had finished — so an Agent Studio discovery answering `{agents: [], total: 5}`
    // published `applicable:false, complete:false, items:[]`: the sentence "this account has no
    // Agent Studio agents" over evidence that says five exist, in exactly the empty-array shape
    // the whole "empty is not failed" rule forbids. `reconciled` is the only thing that may
    // license the claim, and an unreconciled read with no rows publishes NOTHING (items stays
    // null) rather than an empty list.
    if (!reconciled && items.length === 0) return;

    component.items = items;
    // 'unknown' where the enumeration did not reconcile, even though rows WERE read: the rows
    // are real evidence and are retained, but "some agents, provably not all" cannot answer
    // whether the product is provisioned. Plan line 552: UNKNOWN applicability forces Partial.
    component.applicable = reconciled ? items.length > 0 : 'unknown';
    component.detailDenominator = items.filter((item) => item.tombstone !== true).length;
    await detail(name, surface, component);
    // A component is complete only when it was read end to end AND nothing was recorded
    // against it. Errors are the read failures; warnings additionally carry the gradings
    // (an ambiguous deletion signal is not a failed read, but it is an unknown, and an
    // unknown may not be published as complete).
    //
    // `component.errors.length === 0` is DEFENCE IN DEPTH and is currently unreachable: every
    // recordError call site is paired with a warn/warnAggregated on the same component, so the
    // second term has already decided it. Deleting it is an EQUIVALENT mutant — no test can
    // kill it — and it stays because the pairing is a convention held by a dozen call sites
    // rather than by anything structural, and the failure it would let through is a component
    // published as complete while carrying its own record of what it could not read.
    component.complete = component.errors.length === 0
      && !warnings.some((entry) => entry.component === name);
  }

  async function discover(name, surface, component) {
    const discoveryCapabilityId = surface.discoveryCapabilityId;
    if (surface.requiresCompany && config.companyId === null) {
      // Refused LOCALLY, with zero reads. The Agent Studio discovery descriptor binds
      // `agencyId` to the typed companyId, so without one there is no legal request to make:
      // issuing it anyway would turn a missing input into a thrown policy exception out of a
      // read composite, which is the same verdict with a crash attached. The other two
      // surfaces need no company context and are read regardless.
      recordError(name, AI_BUNDLE_WARNINGS.AI_COMPANY_CONTEXT_UNAVAILABLE, discoveryCapabilityId, 'discovery',
        'the bundle was given no companyId, and this discovery route binds agencyId to it');
      warn(AI_BUNDLE_WARNINGS.AI_COMPANY_CONTEXT_UNAVAILABLE, name,
        `capability ${discoveryCapabilityId} needs the typed company context, which this run does not have`);
      return null;
    }

    const items = [];
    const seen = new Set();
    // id -> the set of distinct content hashes seen under it, exactly as the roster keeps.
    const idHashes = new Map();
    const conflictedIds = new Set();
    let readAny = false;
    // The FIRST non-null total this walk was given, latched and never re-latched, exactly as
    // the roster latches `reportedTotal`. `null` is the only "unset" value, so a legitimately
    // reported `0` latches like any other number.
    let reportedTotal = null;
    // "THE ENUMERATION FINISHED, AND FINISHED IN AGREEMENT WITH WHATEVER THE UPSTREAM SAID
    // ABOUT ITS OWN SIZE." Deliberately NOT "nothing went wrong": a malformed row, a missing
    // row id and an ambiguous deletion signal are facts about a ROW, and none of them changes
    // whether the collection was fully walked. This flag is the only thing that may license an
    // `applicable` claim in sweep(), so it is set on the terminal paths and nowhere else.
    let reconciled = false;

    for (let page = 1; ; page += 1) {
      if (surface.paginated && component.pages.attempted >= component.pages.budget) {
        // Checked BEFORE the read, so the page it refuses is never requested.
        component.pages.exhausted = true;
        recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_PAGE_BUDGET_EXHAUSTED, discoveryCapabilityId, 'discovery',
          `the discovery page budget of ${component.pages.budget} was spent with agents still undiscovered`);
        warn(AI_BUNDLE_WARNINGS.AI_DISCOVERY_PAGE_BUDGET_EXHAUSTED, name,
          `the ${name} discovery page budget of ${component.pages.budget} was spent with agents still undiscovered`);
        break;
      }
      const query = surface.paginated
        ? {
          locationId: boundLocationId,
          agencyId: config.companyId,
          productId: 'superagent',
          page: String(page),
          pageSize: String(AI_DISCOVERY_PAGE_SIZE),
          groupBy: 'foldersFirst',
          sortBy: 'lastUpdated',
          sortOrder: 'desc',
        }
        // SINGLE-SHOT BY DESCRIPTOR, not by choice: `locationId` is the only key these two
        // declare, so any pagination parameter would be refused as UNKNOWN_QUERY_KEY.
        : { locationId: boundLocationId };
      const typedBindings = surface.paginated
        ? { locationId: boundLocationId, companyId: config.companyId }
        : { locationId: boundLocationId };

      component.pages.attempted += 1;
      let response;
      try {
        response = await read(name, discoveryCapabilityId, typedBindings, query);
      } catch (error) {
        absorbThrow(error, name, discoveryCapabilityId, 'discovery');
        break;
      }
      if (!response.ok) {
        recordError(name, response.failureClass ?? CODES.INVALID_RESPONSE_BODY, discoveryCapabilityId, 'discovery',
          failureDetail(response, discoveryCapabilityId));
        warn(warningForFailure(response.failureClass, AI_BUNDLE_WARNINGS.AI_DISCOVERY_READ_FAILED), name,
          failureDetail(response, discoveryCapabilityId));
        break;
      }
      const rowsRead = readRows(response.json, AI_ROW_KEYS);
      const totalRead = readTotalFrom(response.json, AI_TOTAL_KEYS);
      shapeLogs.get(name).record({ rowsKey: rowsRead.key, totalKey: totalRead.key });
      if (rowsRead.conflict !== null || totalRead.conflict !== null) {
        const parts = [];
        if (rowsRead.conflict !== null) parts.push(`row keys ${rowsRead.conflict.join('/')} carry different lists`);
        if (totalRead.conflict !== null) parts.push(`total keys ${totalRead.conflict.join('/')} report different numbers`);
        recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_ENVELOPE_CONFLICT, discoveryCapabilityId, 'discovery',
          `the discovery response contradicted itself (${parts.join('; ')})`);
        warn(AI_BUNDLE_WARNINGS.AI_DISCOVERY_ENVELOPE_CONFLICT, name,
          `capability ${discoveryCapabilityId} answered 200 with a self-contradictory envelope (${parts.join('; ')}), so no reading of it can be defended`);
        break;
      }
      const rows = rowsRead.rows;
      if (rows === null) {
        // UNREADABLE IS NOT EMPTY. This is the scenario the whole "empty is not failed" rule
        // exists for: the gateway says ok:true, so a composite reaching for
        // `json.agents ?? []` publishes a confident empty surface.
        recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_UNREADABLE, discoveryCapabilityId, 'discovery',
          'the discovery response carried no readable agent list');
        warn(AI_BUNDLE_WARNINGS.AI_DISCOVERY_UNREADABLE, name,
          `capability ${discoveryCapabilityId} answered 200 with an envelope this rail cannot read`);
        break;
      }
      component.pages.fetched += 1;
      readAny = true;

      const keyer = makeRowKeyer();
      let gained = 0;
      for (const row of rows) {
        const key = keyer(row);
        const id = idOf(row);
        if (seen.has(key)) {
          // A REPEATED ID IS NOT AUTOMATICALLY A REPEATED ROW. This branch used to `continue`
          // unconditionally, which silently collapsed two different agents sharing an id into
          // whichever arrived first — and if the first was a soft-deleted tombstone, the LIVE
          // agent behind the same id was classified out of the audit with `complete:true`.
          // The rule is the roster's, for the same reason: an identical re-serve is an
          // ordinary artifact of paging a live collection and is dropped, while two rows
          // sharing an id but not a content hash are a contradiction this rail cannot resolve,
          // so BOTH are retained and the id is reported once. Retaining both is what keeps a
          // tombstone from shadowing a live row: each is graded on its own payload, so the
          // live one keeps its place in the denominator and gets its detail call.
          if (id === null) continue;                     // an id-less re-serve, already keyed
          const hash = contentHashOf(row);
          const hashes = idHashes.get(id);
          if (hashes.has(hash)) continue;                // an identical re-serve
          hashes.add(hash);
          if (!conflictedIds.has(id)) {
            conflictedIds.add(id);
            warnAggregated(AI_BUNDLE_WARNINGS.AI_DISCOVERY_DUPLICATE_ID_CONFLICT, name,
              `two ${name} discovery rows share an id but not a content hash (${hashes.size} distinct payloads)`);
            recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_DUPLICATE_ID_CONFLICT, discoveryCapabilityId, 'discovery',
              'two discovery rows share an id but not a content hash');
          }
          // Falls through: the conflicting row is retained as its own item. It is NOT counted
          // as unique progress and NOT counted toward the reported total, because it is not a
          // new agent — it is a second, contradictory account of one.
        } else {
          seen.add(key);
          gained += 1;
          if (id !== null) idHashes.set(id, new Set([contentHashOf(row)]));
        }
        const grade = gradeDeletionSignals(row);
        if (grade === 'unreadable') {
          warnAggregated(AI_BUNDLE_WARNINGS.AI_DISCOVERY_ROW_MALFORMED, name,
            'a discovery row was not an object, so no detail route can ever be addressed for it');
          recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_ROW_MALFORMED, discoveryCapabilityId, 'discovery',
            'a discovery row was not an object');
        } else if (id === null) {
          // Retained rather than dropped: dropping it would shrink the denominator until the
          // component reconciled, and this row's configuration is unreachable BY
          // CONSTRUCTION rather than by a read that failed.
          warnAggregated(AI_BUNDLE_WARNINGS.AI_DISCOVERY_ROW_ID_MISSING, name,
            'a discovery row carried neither _id nor id, so its detail route can never be addressed');
          recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_ROW_ID_MISSING, discoveryCapabilityId, 'discovery',
            'a discovery row carried no id');
        } else if (grade === 'ambiguous') {
          // One signal only. It still gets its detail call — and because a half-signalled row
          // can legitimately 403 there, this is exactly the case Task 2's decision to let a
          // 403 latch NOTHING was made for.
          warnAggregated(AI_BUNDLE_WARNINGS.AI_DELETION_SIGNAL_AMBIGUOUS, name,
            'a discovery row carried one deletion signal without the other, so its lifecycle state is unknown');
        }
        items.push({
          id,
          row,
          // Only the Voice route's tombstones are recognised, and only on a schema-valid row.
          tombstone: surface.tombstonesApply === true && grade === 'tombstone',
          detailRead: false,
          detail: null,
        });
      }

      const pageTotal = totalRead.total;

      // THE TOTAL IS READ ON EVERY SURFACE, INCLUDING THE SINGLE-SHOT ONES. This read used to
      // sit below a `if (!surface.paginated) break;`, so Conversation AI and Voice AI DISCARDED
      // a reported total entirely: `{agents:[3 rows], total:50}` published `complete:true` with
      // 47 agents missed and not one warning. There is no page parameter to follow on those
      // routes, so a mismatch cannot be walked off — but it is still a contradiction, and the
      // roster refuses to publish without reconciling a total for exactly this reason.
      //
      // PARTLY SETTLED 2026-07-27, and still partly open — the honest split:
      //   - `/agent-studio/agents-with-folders` DOES emit a root numeric `total` (captured
      //     2026-07-11, ghl-workflow-api-docs research/ai-agents-internal/captures), so on the
      //     one paginated AI surface these branches are live rather than theoretical.
      //   - `/ai-employees/*` search routes emit `totalCount`, now read (see AI_TOTAL_KEYS).
      //   - `/voice-ai/agents/simple` — STILL UNVERIFIED. Only a row excerpt was ever captured,
      //     never the envelope. Absence reads as "no total", which on a single-shot surface is
      //     tolerated rather than fatal, so this cannot break the canary; it merely leaves the
      //     Voice surface reconciled by row count alone. Capture the envelope when convenient.

      // AND IT IS REMEMBERED ACROSS PAGES, which it previously was not. The walk read
      // `pageTotal` per page and reconciled against ONLY the terminal page's copy, keeping no
      // history, so an earlier page's total was discarded in silence: `total:500` on page 1
      // followed by a short page 2 carrying no total at all published 150 agents as the
      // complete, applicable surface with ZERO warnings, and `total:500` then `total:150` did
      // the same. Both are the shape the roster's ROSTER_TOTAL_CHANGED has refused since it
      // shipped, and both are what the module header means by "a reported total that disagrees
      // with the rows makes the surface incomplete on EVERY AI route". A mid-walk change and a
      // mid-walk retraction each end the walk HERE, before any terminal proof can be claimed:
      // `reconciled` stays false, so `applicable` publishes 'unknown' and the rows already read
      // are retained as the partial evidence they are.
      component.totalHistory.push(pageTotal);
      if (pageTotal === null) {
        // PRESENT-THEN-ABSENT. An absent total is legal on this walk only when it was ALWAYS
        // absent — that is the whole asymmetry with the roster, and the reason a short page is
        // terminal here on its own. Once a total HAS been reported, its disappearance retracts
        // the only terminal proof the walk had, and a retracted proof is not a weaker proof.
        if (reportedTotal !== null) {
          recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_TOTAL_DISAPPEARED, discoveryCapabilityId, 'discovery',
            `a later discovery page stopped reporting the total of ${reportedTotal} this walk had latched`);
          warn(AI_BUNDLE_WARNINGS.AI_DISCOVERY_TOTAL_DISAPPEARED, name,
            `${name} discovery reported a total of ${reportedTotal} and then a later page reported none, so no fixed target remains`);
          break;
        }
      } else if (reportedTotal === null) {
        reportedTotal = pageTotal;
      } else if (pageTotal !== reportedTotal) {
        // The reported total IS the terminal proof. If it moves mid-walk there is no fixed
        // target, so "the discovered count equals the total" stops meaning anything — even when
        // the count happens to agree with one of the two numbers.
        recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_TOTAL_CHANGED, discoveryCapabilityId, 'discovery',
          `the reported total moved from ${reportedTotal} to ${pageTotal} mid-walk`);
        warn(AI_BUNDLE_WARNINGS.AI_DISCOVERY_TOTAL_CHANGED, name,
          `${name} discovery changed its reported total from ${reportedTotal} to ${pageTotal} mid-walk, so no fixed target remains to reconcile against`);
        break;
      }

      const reconcileTotal = () => {
        // Reconciled against the LATCHED total, never this page's copy. At every site that
        // calls this the two are provably equal — the history guards above have already ended
        // the walk on any page whose total disagreed with the latch, and an unlatched walk
        // reconciles nothing — so substituting `pageTotal` here is an EQUIVALENT mutant that no
        // test can kill. It reads `reportedTotal` anyway, because that equality is a property
        // of the guards above rather than of this line: weaken one of them and the difference
        // between "the whole walk's target" and "whatever the last page happened to say" is
        // exactly the defect this block was added to close.
        if (reportedTotal !== null && seen.size !== reportedTotal) {
          recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_TOTAL_MISMATCH, discoveryCapabilityId, 'discovery',
            `discovery ran out of rows at ${seen.size} agents against a reported total of ${reportedTotal}`);
          warn(AI_BUNDLE_WARNINGS.AI_DISCOVERY_TOTAL_MISMATCH, name,
            `${name} discovery ran out of rows at ${seen.size} agents against a reported total of ${reportedTotal}`);
          return;
        }
        reconciled = true;
      };

      if (!surface.paginated) {
        // SINGLE-SHOT BY DESCRIPTOR: one response IS the whole collection, so the response is
        // its own terminal — subject to the total above when one is present.
        reconcileTotal();
        break;
      }

      if (rows.length < AI_DISCOVERY_PAGE_SIZE) {
        // A SHORT PAGE IS TERMINAL ON ITS OWN here, and reconciled against a total only when
        // one is present. See the module header for why this is deliberately weaker than the
        // roster's rule. The reconciliation runs only for a walk that CLAIMED a short-page
        // terminal: budget exhaustion and zero-unique-progress are walk faults reported on
        // their own, and stacking a total mismatch on top of them would describe one defect
        // twice.
        reconcileTotal();
        break;
      }
      if (gained === 0) {
        // A backend that ignores `page` re-serves page one forever. Every page is full so no
        // short-page terminal ever fires, and without this the sweep would spend its whole
        // budget and then blame the budget for a defect that is not a budget defect.
        recordError(name, AI_BUNDLE_WARNINGS.AI_DISCOVERY_NO_UNIQUE_PROGRESS, discoveryCapabilityId, 'discovery',
          'a full discovery page added no new agent, so the page parameter is not advancing the collection');
        warn(AI_BUNDLE_WARNINGS.AI_DISCOVERY_NO_UNIQUE_PROGRESS, name,
          `${name} discovery returned a full page that added no new agent`);
        break;
      }
    }

    // Rows already read stay as evidence even when a later page failed: the surface holds
    // SOME agents and provably not all of them, which is a different artifact from both a
    // complete surface and an unread one. `reconciled` travels with them so the caller can
    // tell the two apart — the rows alone cannot say whether they are all of them.
    return readAny ? { items, reconciled } : null;
  }

  async function detail(name, surface, component) {
    const detailCapabilityId = surface.detailCapabilityId;
    // The seal is an OBJECT keyed by DISCOVERY capability id, and it carries only THIS
    // product's ids. The three products share an id shape, so one flat list would let a
    // Voice id probe the Conversation-AI and Agent-Studio detail routes with a perfectly
    // plausible id — which the gateway refuses, and which this composite must therefore
    // never even construct.
    const discoveredAgentIds = {
      [surface.discoveryCapabilityId]: component.items
        .filter((item) => item.id !== null)
        .map((item) => item.id),
    };
    for (const item of component.items) {
      // A confirmed tombstone is retained as discovery evidence, excluded from the
      // denominator, and given NO detail call: that route is forbidden for a soft-deleted
      // agent, so calling it spends a 403 on a row the rail already understands.
      if (item.tombstone === true) continue;
      // A row with no id (or no shape at all) cannot address a detail route. It stays in the
      // denominator — its configuration IS missing from the bundle — but there is no request
      // to issue for it.
      if (item.id === null) continue;
      let response;
      try {
        response = await read(name, detailCapabilityId, {
          locationId: boundLocationId,
          agentId: item.id,
          discoveredAgentIds,
        }, { locationId: boundLocationId });
      } catch (error) {
        absorbThrow(error, name, detailCapabilityId, 'detail');
        continue;
      }
      if (!response.ok) {
        // Discovery proved the agent exists; a failure on its own detail route proves only
        // that this rail could not read it. Plan line 552 is explicit that proof of a list
        // route is not proof of an unexercised detail route.
        //
        // AGGREGATED, like every other per-item code here: this fires once per agent, so an
        // account whose detail route is down produced one warning object per agent — ballast
        // in an artifact that is serialized over stdio and hashed whole.
        recordError(name, response.failureClass ?? CODES.INVALID_RESPONSE_BODY, detailCapabilityId, 'detail',
          failureDetail(response, detailCapabilityId));
        warnAggregated(warningForFailure(response.failureClass, AI_BUNDLE_WARNINGS.AI_DETAIL_READ_FAILED), name,
          failureDetail(response, detailCapabilityId));
        continue;
      }
      const record = readAgentRecord(response.json);
      if (record === null) {
        recordError(name, AI_BUNDLE_WARNINGS.AI_DETAIL_UNREADABLE, detailCapabilityId, 'detail',
          'the detail response carried no readable agent record');
        warnAggregated(AI_BUNDLE_WARNINGS.AI_DETAIL_UNREADABLE, name,
          `capability ${detailCapabilityId} answered 200 with a body carrying no identifiable agent record`);
        continue;
      }
      // THE READ IS CHECKED AGAINST THE ID IT WAS ISSUED FOR. Without this, a detail response
      // was accepted on the strength of carrying SOME id: discovery finds `b1`, the route
      // answers with `b2`, and the bundle published b2's configuration as b1's with
      // `complete:true`, `detailsRead:1` and zero warnings — the nested `{agent:{_id:'c9'}}`
      // envelope included. Plan Step 3.3 ("verifies response identity and location binding")
      // is vacuous on the agent axis otherwise: the gateway's own identity check compares a
      // body field literally named `agentId`, and these bodies carry `_id`/`id`, so it has
      // nothing to compare and passes. Both ids are unwrapped by `idOf`, so a `{$oid:…}`
      // wrapper on either side is a match rather than a manufactured conflict.
      //
      // TASK 7 CANARY RECONCILIATION (4 of 4), and the one with the widest blast radius. This
      // comparison ASSUMES the detail body's `_id`/`id` is the same value as the discovery
      // row's `_id`/`id`, on all three products — an assumption no captured payload in this
      // repo supports. Where discovery lists one identifier and the detail body reports another
      // (`/ai-employees/agents` rows against `/ai-employees/employees/{agentId}` bodies is the
      // obvious candidate, and `/agent-studio` is no better evidenced), EVERY agent on that
      // product mismatches, EVERY detail is discarded, and that component's whole configuration
      // is dropped while the bundle reports honestly-but-uselessly `complete:false`. It fails
      // closed, which is why it ships, but it is the canary whose answer decides whether this
      // rail can read a real account at all — confirm the id the detail body actually carries,
      // per product, against the id its discovery row carried.
      //
      // The same assumption has a narrower, likelier-to-bite corollary: an envelope whose OUTER
      // object carries a REQUEST id rather than an agent id — `{data:{id:'req-77',
      // agent:{_id:'b1'}}}` — resolves through `readAgentRecord` to `req-77` and produces a
      // FALSE mismatch for an agent that was in fact returned correctly. That too fails closed,
      // and it is deliberately not special-cased here: a nested-envelope rule invented ahead of
      // a live payload is how the record came to be accepted on the strength of carrying SOME
      // id in the first place. Capture the real envelope, then decide.
      const recordId = idOf(record);
      if (recordId !== item.id) {
        recordError(name, AI_BUNDLE_WARNINGS.AI_DETAIL_IDENTITY_MISMATCH, detailCapabilityId, 'detail',
          'the detail response carried a different agent id from the one it was requested for');
        warnAggregated(AI_BUNDLE_WARNINGS.AI_DETAIL_IDENTITY_MISMATCH, name,
          `capability ${detailCapabilityId} answered a request for one agent with a record identifying another`);
        continue;
      }
      item.detailRead = true;
      item.detail = record;
      component.detailsRead += 1;
    }
  }
}
