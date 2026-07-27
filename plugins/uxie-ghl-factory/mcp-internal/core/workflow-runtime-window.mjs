// The composite that turns one workflow's runtime into a single evidence-qualified
// window. It exists because every cheap way of reading this data produces the SAME
// artifact for two opposite facts: a workflow nobody entered, and a read that failed.
// Three rules follow from that, and every design choice below is downstream of one:
//
//   1. EMPTY IS NOT FAILED. Every failure path records a warning from a closed
//      vocabulary and sets `complete:false`. A component that could not be read is
//      `null`, never `[]` — an empty array is a claim, and this rail may not make a
//      claim it did not observe. Where a component must stay an array to be usable
//      (`runtimeEvents`), `componentCompleteness` carries the marker instead, so the
//      claim is never made by omission.
//   2. THE ONLY WAY OUT IS `callCapability`. No raw path, no `gateway.call`, and
//      never a caller-supplied `descriptors` list (Task 2 carry-forward item 7: that
//      parameter exists so tests can reach otherwise-unreachable policy branches; a
//      composite forwarding one would be a runtime policy bypass).
//   3. NOTHING IS TIMED, RANDOM, OR WALL-CLOCKED. Capture times come from the reads
//      themselves (`meta.capturedAt`), so two identical runs produce byte-identical
//      results and a receipt can be minted from them. That invariant is why timestamps
//      are parsed by an explicit UTC grammar rather than `Date.parse`, whose offsetless
//      branch reads the HOST timezone and made the same response retain a row in London
//      and drop it in Manila.
//
// WHAT `complete` DOES AND DOES NOT COVER. `complete` is a claim about RUNTIME EVENT
// COVERAGE for the requested window and nothing else. It deliberately does NOT assert
// that the workflow definition captured here governed those events: no version-history
// capability exists on this rail, so that binding is unprovable on every run, and folding
// it into `complete` would make `complete` a constant false and therefore useless. The
// separate top-level `configurationBinding` field carries that second axis, and no
// consumer may claim the current definition governed historical events without it.
//
// SPLIT ERROR MODEL (Task 2 carry-forward, and the single easiest thing to get
// wrong here): the audit gateway reports policy faults by THROWING with `.code`, and
// response faults by RETURNING `ok:false` plus a `failureClass`. A collector that
// models only one half loses the other, and the half it loses becomes an
// empty-but-complete window. Both halves are handled: a returned failure degrades
// exactly one component, and a throw aborts the run with its code intact — but a thrown
// CIRCUIT_OPEN also carries `error.partial`, because everything already read before the
// latch is real evidence and a resumer needs to know which partitions it already covers.
//
// TWO DIFFERENT "COMPONENT COMPLETENESS" SHAPES EXIST IN THIS AUDIT PROFILE, and Task 11
// consumes BOTH. They are deliberately NOT merged, because they describe different things
// and forcing one shape onto the other would make each of them wrong about the other's
// subject:
//
//   - Task 4's account-sweep composite reports per-component
//     `{applicable, complete, items, pages, sourceRoutes}`. Its "components" are PAGINATED
//     ACCOUNT SURFACES (workflows, pipelines, calendars, …) — independent collections, each
//     with its own page walk and its own route set, any of which may be inapplicable to a
//     given account. `items`/`pages` are meaningful there because a surface IS a list.
//   - Task 3 (this module) ships a FLAT `componentCompleteness` map of booleans. Its
//     "components" are PARTS OF ONE WORKFLOW READ (definition, runtime events, per-step
//     counts, enrollments, step rosters, enrollment totals) — not independent collections
//     but facets of a single window, every one of which is always applicable (there is no
//     workflow for which "did it have runtime events" is an inapplicable question), and
//     several of which are not lists at all. `pages` already lives once, correctly, under
//     the run-level `pagination` block, and `sourceRoutes` is run-level for the same reason:
//     one route sequence produced the whole window, not six independent ones.
//
// A consumer reading both must therefore not expect `componentCompleteness.runtimeEvents`
// to have an `items` count or an `applicable` flag, nor expect a Task 4 surface entry to
// collapse to a bare boolean. If the two ever do need to be read uniformly, the reconciler
// belongs in Task 11 over both published shapes — not in either collector, where it would
// have to invent the field the other one means.
import { createHash } from 'node:crypto';
import { AUDIT_CAPABILITIES } from './audit-capabilities.mjs';
import { CODES, scrubSecrets } from './errors.mjs';

// 2.0.0. The execution-log half of this contract changed shape when the endpoint's real
// parameter surface was captured from the builder UI: the time-partition walk is replaced by
// a cursor walk over a window the server now actually applies (`dateType=custom`), so
// `pagination.logPartitions` becomes `pagination.logPages`, the `LOG_PARTITION_*` and
// `LOG_WINDOW_LOWER_BOUND_UNEXPANDED` warnings are retired, and `pageSize`/`maxLogPartitions`/
// `minPartitionMs` leave the input in favour of `logPageSize`/`maxLogPages`/`maxLogRetries`.
export const RUNTIME_WINDOW_CONTRACT_VERSION = '2.0.0';

// Pinned, not caller-selectable. The partition walk's whole notion of "terminal"
// is "the page came back short", so the page size IS the completeness proof: a
// larger page silently redefines terminal and invalidates every window this
// collector has ever published. Raising it needs a descriptor change, a manifest
// revision, and a live canary that reconciles the larger size against the proven
// 20-row walk — never a parameter.
// The exact top-level key set `collectWorkflowRuntimeWindow` resolves with. Exported so the
// README's documented output list can be diffed against the real contract in BOTH directions
// — a prose list is otherwise free to omit a field or invent one, and a keyword grep over the
// README cannot tell either from a correct list.
export const RUNTIME_WINDOW_RESULT_KEYS = Object.freeze([
  'contractVersion', 'boundLocationId', 'workflowId', 'requestedWindow', 'appliedWindow',
  'appliedQueries', 'filters', 'workflowDefinition', 'runtimeEvents', 'observedEventTypes', 'enrollments',
  'perStepCounts', 'stepRosters', 'enrollmentTotals', 'componentCompleteness', 'pagination',
  'rateLimit', 'locationBinding', 'sourceRoutes', 'capabilityVersion', 'capturedAt',
  'configurationBinding', 'complete', 'truncated', 'warnings',
]);

// The cursor makes page size a throughput knob rather than a correctness one: completeness
// comes from walking to a page with no new ids, at ANY page size. Bounded 1..5000 because
// that is the range measured live — `limit` is honoured exactly up to the true row count and
// then clamps cleanly, with no cap found even at 10,000.
export const LOG_PAGE_SIZE_DEFAULT = 100;
export const LOG_PAGE_SIZE_MAX = 5000;
export const ENROLLMENT_PAGE_SIZE = 20;   // fixedQueryValues.limit = '20' on the enrollment descriptor
export const STEP_ROSTER_PAGE_SIZE = 50;  // numericQueryBounds.limit.max = 50 on details-by-step

// The closed warning vocabulary. It is closed on purpose: an auditor BRANCHES on these
// codes, and a free-text reason cannot be branched on — two components would end up
// disagreeing about what "incomplete" meant. Adding a code is a contract change.
export const RUNTIME_WINDOW_WARNINGS = Object.freeze({
  LOG_DUPLICATE_ID_CONFLICT: 'LOG_DUPLICATE_ID_CONFLICT',
  LOG_EVENT_TIMESTAMP_UNPARSEABLE: 'LOG_EVENT_TIMESTAMP_UNPARSEABLE',
  // A HIGHER-priority timestamp field was present and unreadable, so the event's
  // membership in [fromDate, toDate) rests on a lower-priority proxy for a field that
  // exists and could not be read. That is far closer to the plan's "no parseable time =>
  // incomplete" than it is to the ordinary absent-field fallback, and an auditor must be
  // able to tell "absent, normal for a queued row" from "present and garbage".
  LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE: 'LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE',
  // A retained execution row carried no `_id`/`id`. Such a row can only be deduplicated
  // by content, so two genuinely distinct events with identical payloads are
  // indistinguishable from one event returned twice by overlapping partitions. Rows are
  // retained rather than collapsed (see retainEvent), and the count is declared
  // unprovable rather than silently under- or over-reported.
  LOG_EVENT_ID_MISSING: 'LOG_EVENT_ID_MISSING',
  // The requested window starts at epoch 0, so the mandated one-millisecond lower-bound
  // expansion could not be applied. Upstream boundary semantics are undocumented; if the
  // lower bound is exclusive, an event landing exactly on fromDate is dropped upstream and
  // no local filter can recover it.
  // The cursor walk hit its page ceiling before the server ran out of rows. Replaces
  // LOG_PARTITION_BUDGET_EXHAUSTED; the old code's sibling LOG_PARTITION_SATURATED_AT_FLOOR
  // and LOG_WINDOW_LOWER_BOUND_UNEXPANDED are simply gone. Both described a walk that
  // narrowed a window to find fewer rows — a strategy that could never terminate, because
  // the window it was narrowing was never being applied (no `dateType`), so every page came
  // back identically full however narrow the range got.
  LOG_PAGE_BUDGET_EXHAUSTED: 'LOG_PAGE_BUDGET_EXHAUSTED',
  // A page ended on a row that cannot produce the `referenceId` + `referenceCreatedAt` pair
  // the cursor needs. Continuing on a half-reference is the trap this guards: the server
  // answers 200 and re-serves the SAME page, so a walk would spin against an unchanging
  // cursor and burn its whole budget while believing it was paging.
  LOG_CURSOR_UNUSABLE: 'LOG_CURSOR_UNUSABLE',
  // The enrollment/step-roster equivalents of LOG_EVENT_ID_MISSING. Rows on these two
  // routes were keyed by CONTENT alone, so two identical id-less rows in one page collapsed
  // into one row with no warning at all — the same silent undercount the execution-log walk
  // was fixed for, in the two places the fix was never applied. Both copies are now retained
  // (keyed by occurrence index within the response that returned them, so a page echoed by a
  // repeated cursor still dedupes) and the exact count is declared unprovable, because two
  // genuinely distinct id-less rows returned by two DIFFERENT pages remain indistinguishable
  // from one row echoed twice.
  ENROLLMENT_ROW_ID_MISSING: 'ENROLLMENT_ROW_ID_MISSING',
  STEP_ROSTER_ROW_ID_MISSING: 'STEP_ROSTER_ROW_ID_MISSING',
  ENROLLMENT_CURSOR_MISSING: 'ENROLLMENT_CURSOR_MISSING',
  ENROLLMENT_CURSOR_REPEATED: 'ENROLLMENT_CURSOR_REPEATED',
  ENROLLMENT_NO_UNIQUE_PROGRESS: 'ENROLLMENT_NO_UNIQUE_PROGRESS',
  ENROLLMENT_PAGE_BUDGET_EXHAUSTED: 'ENROLLMENT_PAGE_BUDGET_EXHAUSTED',
  ENROLLMENT_TOTAL_MISMATCH: 'ENROLLMENT_TOTAL_MISMATCH',
  ENROLLMENT_TOTALS_UNAVAILABLE: 'ENROLLMENT_TOTALS_UNAVAILABLE',
  STEP_ROSTER_PAGE_BUDGET_EXHAUSTED: 'STEP_ROSTER_PAGE_BUDGET_EXHAUSTED',
  STEP_ROSTER_UNSEALED: 'STEP_ROSTER_UNSEALED',
  IDENTITY_CONFLICT_QUARANTINE: 'IDENTITY_CONFLICT_QUARANTINE',
  IDENTITY_INSPECTION_INCOMPLETE: 'IDENTITY_INSPECTION_INCOMPLETE',
  COMPONENT_READ_FAILED: 'COMPONENT_READ_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  // Emitted onto the PARTIAL result attached to a thrown CIRCUIT_OPEN. The throw still
  // propagates — a latched circuit means the run must stop and be resumed deliberately —
  // but everything already read is real evidence, and discarding it forced a resumer to
  // re-walk partitions it had already paid for. `error.partial` carries this warning plus
  // the completed `pagination`/`sourceRoutes` so the resumer knows exactly where it got to.
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
});

// Exported so the tool's zod schema can be asserted to agree with them. Two copies of
// the same default in two files is how a schema quietly starts handing the collector a
// budget the collector's own validator would have refused.
export const RUNTIME_WINDOW_DEFAULTS = Object.freeze({
  logPageSize: LOG_PAGE_SIZE_DEFAULT,
  maxLogPages: 200,
  maxLogRetries: 3,
  maxEnrollmentPages: 200,
  maxStepRosterPages: 200,
});

// Inputs the time-partition design owned, which no longer describe anything. They are
// REFUSED rather than ignored, and that distinction is the whole lesson of this rewrite: a
// parameter that is accepted and does nothing is indistinguishable, from the caller's side,
// from one that works — which is exactly how `fromDate` sat on this endpoint for months
// doing nothing at all. A caller still passing `maxLogPartitions` holds a belief about how
// this collector reaches completeness, and that belief is now wrong.
export const RETIRED_RUNTIME_WINDOW_INPUTS = Object.freeze({
  pageSize: 'the execution log is read by cursor now, at any page size; use logPageSize',
  maxLogPartitions: 'there is no time-partition walk — the window is applied by the server via dateType=custom and the pages are walked by cursor; use maxLogPages',
  minPartitionMs: 'there is no time-partition walk, so there is no partition floor to set',
});
const DEFAULTS = RUNTIME_WINDOW_DEFAULTS;

export const MAX_FILTER_ITEMS = 20;

const invalidWindow = (detail) => {
  const error = new Error(`${CODES.INVALID_RUNTIME_WINDOW}: ${detail}`);
  error.code = CODES.INVALID_RUNTIME_WINDOW;
  error.detail = detail;
  error.remediation = 'Pass a half-open [fromDate, toDate) window of non-negative integer epoch milliseconds with fromDate < toDate, the proven page size of 20, and in-range budgets.';
  return error;
};

const isEpochMs = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

// A response worth asking for again. Deliberately narrow: 5xx and transport faults only.
// A 401/403/429 must NOT be retried — the first is a dead credential, the second a refusal,
// and the third is exactly what the circuit breaker exists to latch on. Retrying any of
// those turns one honest failure into a burst against a location that already said no.
const RETRYABLE_FAILURES = new Set(['HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504', 'TRANSPORT_FAILED']);
export const isRetryable = (response) => RETRYABLE_FAILURES.has(response?.failureClass)
  || (Number.isFinite(response?.status) && response.status >= 500);

const boundedInteger = (value, { min, max, fallback, name }) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
    throw invalidWindow(`${name} must be an integer between ${min} and ${max ?? 'the documented maximum'}`);
  }
  return value;
};

const stringList = (value, name) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FILTER_ITEMS) {
    throw invalidWindow(`${name} must be an array of at most ${MAX_FILTER_ITEMS} ids`);
  }
  for (const item of value) {
    if (!isNonEmptyString(item)) throw invalidWindow(`${name} may only contain non-empty string ids`);
  }
  // De-duplicated so a repeated id cannot spend a second partition/roster budget slot
  // while adding no evidence. Order is preserved: the walk order is part of the receipt.
  return [...new Set(value)];
};

// Validation is separated from collection so the TOOL can reject a window before it
// constructs a gateway. Building the gateway first would mean an inverted window costs
// a credential read (and, on a caller that logs construction, a spurious audit trace)
// before anything rejects it.
//
// `fromDate`/`toDate` carry NO numericQueryBounds on the descriptor (Task 2
// carry-forward item 1), so nothing downstream would catch a malformed window: it would
// reach the wire, return SOMETHING, and that something would be recorded as evidence.
export function validateRuntimeWindowInput(input = {}) {
  const source = input ?? {};
  if (!isNonEmptyString(source.locationId)) throw invalidWindow('locationId must be a non-empty string');
  if (!isNonEmptyString(source.workflowId)) throw invalidWindow('workflowId must be a non-empty string');
  if (!isEpochMs(source.fromDate)) throw invalidWindow('fromDate must be a non-negative integer epoch-millisecond value');
  if (!isEpochMs(source.toDate) || source.toDate === 0) throw invalidWindow('toDate must be a positive integer epoch-millisecond value');
  if (source.fromDate >= source.toDate) throw invalidWindow('the window is half-open, so fromDate must be strictly less than toDate');
  for (const [name, reason] of Object.entries(RETIRED_RUNTIME_WINDOW_INPUTS)) {
    if (source[name] !== undefined) throw invalidWindow(`${name} is retired: ${reason}`);
  }
  if (source.contactId !== undefined && !isNonEmptyString(source.contactId)) {
    throw invalidWindow('contactId must be a non-empty string when supplied');
  }
  return {
    locationId: source.locationId,
    workflowId: source.workflowId,
    fromDate: source.fromDate,
    toDate: source.toDate,
    contactId: source.contactId ?? null,
    eventTypes: stringList(source.eventTypes, 'eventTypes'),
    stepIds: stringList(source.stepIds, 'stepIds'),
    logPageSize: boundedInteger(source.logPageSize, { min: 1, max: LOG_PAGE_SIZE_MAX, fallback: DEFAULTS.logPageSize, name: 'logPageSize' }),
    maxLogPages: boundedInteger(source.maxLogPages, { min: 1, max: 2048, fallback: DEFAULTS.maxLogPages, name: 'maxLogPages' }),
    maxLogRetries: boundedInteger(source.maxLogRetries, { min: 0, max: 10, fallback: DEFAULTS.maxLogRetries, name: 'maxLogRetries' }),
    maxEnrollmentPages: boundedInteger(source.maxEnrollmentPages, { min: 1, max: 1000, fallback: DEFAULTS.maxEnrollmentPages, name: 'maxEnrollmentPages' }),
    maxStepRosterPages: boundedInteger(source.maxStepRosterPages, { min: 1, max: 1000, fallback: DEFAULTS.maxStepRosterPages, name: 'maxStepRosterPages' }),
  };
}

// --- canonical hashing ---------------------------------------------------------
// Recursive key-sort then SHA-256. Key order is an artifact of JSON parsing, not of the
// content, so hashing the raw serialization would make two identical definitions hash
// differently and turn "the workflow changed" into a coin flip.
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const sha256Canonical = (value) => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

// Exactly the capabilities this collector reads. The version below hashes ONLY these:
// hashing the whole 16-descriptor set meant a Task 4 edit to an Agent-Studio descriptor
// invalidated every already-collected workflow runtime window for a reason that could not
// possibly have changed what those windows observed. A receipt must be invalidated by a
// change to the policy it was actually collected under, and by nothing else.
export const RUNTIME_WINDOW_CAPABILITY_IDS = Object.freeze([
  'workflow_detail',
  'workflow_triggers',
  'workflow_sticky_notes',
  'workflow_execution_logs',
  'workflow_count_per_step',
  'workflow_enrollment_search',
  'workflow_step_details',
  'workflow_enroll_stats_cache',
  'workflow_enroll_stats',
]);

// Derived from the descriptor module itself rather than hand-written so it cannot drift
// from the policy it claims to describe. A missing descriptor is fatal AT IMPORT: a
// silently-skipped id would produce a version hash that describes a smaller policy than
// the one the collector actually calls under.
//
// EXPORTED as a function purely so the fatal branch is testable. When the resolution ran
// inline at module scope its only input was the real, complete AUDIT_CAPABILITIES, so the
// throw was unreachable from a test and nothing proved a missing descriptor fails loudly
// rather than shrinking the hashed policy by one entry. Injecting the descriptor list is
// safe here in a way it is NOT at the gateway (Task 2 carry-forward item 7): this list
// feeds a HASH, never a request, so a caller-supplied one cannot bypass a runtime policy.
export function resolveRuntimeWindowDescriptors(capabilityIds, descriptors = AUDIT_CAPABILITIES) {
  return capabilityIds.map((capabilityId) => {
    const descriptor = descriptors.find((candidate) => candidate.capabilityId === capabilityId);
    if (!descriptor) {
      throw new Error(`RUNTIME_WINDOW_DESCRIPTOR_MISSING: ${capabilityId} is not in the audit descriptor set`);
    }
    return descriptor;
  });
}
const runtimeWindowDescriptors = resolveRuntimeWindowDescriptors(RUNTIME_WINDOW_CAPABILITY_IDS);
export const AUDIT_CAPABILITY_VERSION = `sha256:${sha256Canonical(runtimeWindowDescriptors)}`;

// --- payload readers -----------------------------------------------------------
// Envelope shapes are LIVE-VERIFIED per route but not guaranteed, so an unrecognised
// shape returns null (= "I could not read this") rather than [] (= "there was nothing").
// That distinction is the whole contract.
const rowsOf = (json, ...keys) => {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return null;
  for (const key of keys) if (Array.isArray(json[key])) return json[key];
  return null;
};

const idOf = (row) => {
  const raw = row?._id ?? row?.id;
  if (raw === undefined || raw === null || String(raw) === '') return null;
  return String(raw);
};

// A PER-RESPONSE row keyer for the two paginated walks (enrollments, step rosters).
//
// The shape this replaced keyed every id-less row as `hash:<content>`, so two identical
// id-less rows inside ONE page silently became one row — the exact undercount the
// execution-log walk was fixed for (see retainEvent), in the two places the fix was never
// applied. Rows returned by a SINGLE response are provably distinct, so an id-less row is
// keyed by its occurrence index within that response and both copies survive. The keyer is
// constructed fresh per response precisely so the indices RESTART: a page echoed by a
// repeated cursor, or a roster page re-served under the same skip, reproduces the same
// indices and therefore still dedupes to one copy. An id-bearing row keeps its `id:` key
// unchanged — it is identified by the upstream, not by this collector, and re-keying it by
// content would have made two serializations of one row (`{_id: 5}` / `{_id: '5'}`) two
// rows.
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

// Ids are normalised to strings BEFORE hashing. `{_id: 5}` and `{_id: '5'}` are one row
// serialized two ways — upstream has returned both — and hashing them unnormalised made
// them two distinct payloads sharing one id, which is exactly the shape of a genuine
// LOG_DUPLICATE_ID_CONFLICT. That failed closed, but it manufactured a contradiction out
// of a serialization detail and would have had an auditor chasing a phantom.
const contentHashOf = (row) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return sha256Canonical(row ?? null);
  const normalized = { ...row };
  for (const key of ['_id', 'id']) {
    if (Object.hasOwn(normalized, key) && normalized[key] !== null && normalized[key] !== undefined) {
      normalized[key] = String(normalized[key]);
    }
  }
  return sha256Canonical(normalized);
};

// Priority order is the plan's: startedExecutionAt, then createdAt, then updatedAt. The
// SUPPLYING field is recorded with the event, because "when did this happen" and "when
// was the row last touched" are different claims and an auditor must be able to tell
// which one it is looking at.
const TIMESTAMP_FIELDS = Object.freeze(['startedExecutionAt', 'createdAt', 'updatedAt']);
const NUMERIC_STRING = /^-?\d+$/;
// A STRICT ISO-8601 subset, not `Date.parse`. Two things were wrong with Date.parse:
// it runs in lenient legacy mode (so the accepted input surface is far wider than ISO and
// undefined between engines), and an offsetless timestamp is interpreted in the HOST
// timezone. `1970-01-01T00:25:00` in the window [1000000, 2000000) was retained under
// TZ=UTC and dropped under TZ=Asia/Manila — the same bytes, two different windows, which
// breaks this file's own byte-identical-runs invariant.
//
// !!! UNVALIDATED AGAINST LIVE DATA — RECONCILE DURING THE TASK 7 CANARY !!!
// No captured `/workflows/logs/v2` payload exists anywhere in this repository. Every
// fixture timestamp in test/fixtures/runtime-window/ is a synthetic numeric epoch, so this
// grammar has never met a real GHL execution-log timestamp and nothing here proves GHL
// serialises one in a form it accepts. The failure mode is deliberately CLOSED: a shape
// this grammar does not recognise becomes `timestamp: null`, which retains the row as
// evidence, refuses to place it in the window, and forces `complete:false` with
// LOG_EVENT_TIMESTAMP_UNPARSEABLE — loud and safe, never a guessed date. But if GHL emits,
// say, `2026-07-24T10:00:00.000+0000` (offset without a colon is accepted) or an RFC-1123
// / Unix-seconds / `.NET` ticks form (all rejected), EVERY window would come back
// incomplete for a reason that is a parser gap and not missing evidence. The Task 7 canary
// MUST capture a real log payload, record the observed timestamp shapes, and reconcile them
// against this grammar before any window collected on it is published.
//
// Lowercase `t` is accepted alongside `T` for the same reason lowercase `z` already was:
// RFC 3339 §5.6 (NOTE) permits both designators in lower case, and accepting one while
// rejecting the other made the grammar's leniency depend on which half of the string an
// upstream happened to lower-case.
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|z|[+-]\d{2}:?\d{2})?)?$/;

const toEpochMs = (raw) => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;
  // Numeric strings are read as epoch ms BEFORE the date grammar, which would read '1700'
  // as the year 1700 and silently date an event to the 18th century.
  if (NUMERIC_STRING.test(text)) return Number(text);
  const match = ISO_8601.exec(text);
  if (match === null) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, offsetText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText ?? '0');
  const minute = Number(minuteText ?? '0');
  const second = Number(secondText ?? '0');
  const millisecond = fractionText === undefined ? 0 : Number(`${fractionText}000`.slice(0, 3));
  // The month/day half is REDUNDANT with the round-trip check below (an out-of-range month
  // or day rolls into a different calendar date, which the round-trip catches) and is kept
  // as a stated grammar rather than an emergent property of Date's rolling. The
  // hour/minute/second half is NOT redundant: a minute of 99 rolls forward one hour and
  // stays inside the same day, so nothing downstream would ever see it.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // setUTCFullYear rather than Date.UTC: Date.UTC maps a two-digit year onto 1900+year,
  // and '0099-01-01' would silently become 1999.
  const moment = new Date(0);
  moment.setUTCFullYear(year, month - 1, day);
  moment.setUTCHours(hour, minute, second, millisecond);
  const utc = moment.getTime();
  if (!Number.isFinite(utc)) return null;
  // A non-existent date (2026-02-31) rolls forward into a different day rather than
  // failing, so it is rejected explicitly instead of dating an event to the wrong month.
  if (moment.getUTCFullYear() !== year || moment.getUTCMonth() !== month - 1 || moment.getUTCDate() !== day) return null;
  // No offset means UTC, stated explicitly here rather than inherited from the host.
  if (offsetText === undefined || offsetText === 'Z' || offsetText === 'z') return utc;
  const digits = offsetText.slice(1).replace(':', '');
  const offsetHours = Number(digits.slice(0, 2));
  const offsetMinutes = Number(digits.slice(2, 4));
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const sign = offsetText[0] === '-' ? -1 : 1;
  return utc - (sign * ((offsetHours * 60) + offsetMinutes) * 60000);
};

// Fields that were PRESENT and unreadable are reported alongside the timestamp that was
// finally used. A present-but-corrupt higher-priority field falling through silently is
// indistinguishable from the ordinary "absent, so use the next one" case, and the two
// demand opposite operator responses.
const readEventTime = (row) => {
  if (!row || typeof row !== 'object') {
    return { timestamp: null, timestampField: null, unreadableTimestampFields: [] };
  }
  const unreadableTimestampFields = [];
  for (const field of TIMESTAMP_FIELDS) {
    if (!Object.hasOwn(row, field)) continue;
    const timestamp = toEpochMs(row[field]);
    if (timestamp !== null) return { timestamp, timestampField: field, unreadableTimestampFields };
    unreadableTimestampFields.push(field);
  }
  return { timestamp: null, timestampField: null, unreadableTimestampFields };
};

// --- the collector -------------------------------------------------------------

export async function collectWorkflowRuntimeWindow({ auditGateway, input } = {}) {
  const config = validateRuntimeWindowInput(input);
  if (!auditGateway || typeof auditGateway.callCapability !== 'function') {
    throw invalidWindow('an audit gateway exposing callCapability is required');
  }
  // The gateway is bound to exactly one location and is authoritative about it. A
  // disagreement is a wiring bug, and letting it through would produce a window labelled
  // with one location and collected from another.
  const boundLocationId = auditGateway.locationId ?? config.locationId;
  if (String(boundLocationId) !== config.locationId) {
    throw invalidWindow('the requested locationId is not the location this audit gateway is bound to');
  }

  const { workflowId } = config;
  const appliedQueries = [];
  const sourceRoutes = [];
  const warnings = [];
  const conflicts = [];
  const bindingMethods = new Set();
  const rateLimit = { limited: false, retryAfterMs: null };
  let quarantined = false;
  let identityIncomplete = false;
  let capturedAt = null;

  // ONE WARNING SHAPE, WHATEVER EMITTED IT. Every object in `warnings` carries exactly
  // `{code, component, detail, occurrences, detailSamples}` — the aggregated emitter below
  // and this one produce structurally identical objects, and there is no second shape to
  // discover.
  //
  // It used to have two. `warnAggregated` added `occurrences`/`detailSamples`; plain `warn`
  // did not, so a consumer walking one array met `occurrences: 3` on three codes and
  // `undefined` on the other nineteen. `undefined` is not `1`: `w.occurrences > 1` is false
  // for a genuine single firing AND for a missing field alike, and `sum += w.occurrences`
  // is NaN from the first plain warning onward. Task 11 branches on this array, so a shape
  // that depends on which emitter fired is a defect surface, not a detail.
  //
  // A plain warning IS a one-occurrence warning, so it says so: `occurrences: 1` and a
  // one-element `detailSamples`. `detail` keeps its existing meaning on both emitters — the
  // FIRST occurrence's text — so nothing about the readable field changed.
  //
  // The `extra` spread this used to take is GONE, and its absence is the guarantee: it was
  // passed by no caller, and any caller that ever did could have widened one warning's key
  // set past every other one's. Uniformity is now structural rather than conventional.
  const warn = (code, component, detail) => {
    warnings.push({ code, component, detail, occurrences: 1, detailSamples: [detail] });
  };

  // ROW-SCOPED warnings are AGGREGATED, one object per (code, component), carrying the
  // number of times the condition fired.
  //
  // Three codes used to push one object per offending ROW or PARTITION and were therefore
  // unbounded in the size of the account's data: LOG_EVENT_TIMESTAMP_UNPARSEABLE,
  // LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE and LOG_PARTITION_SATURATED_AT_FLOOR. Measured on a
  // 20,380-row untimed corpus that is 41,270 warning objects carrying 5 distinct detail
  // strings — 7.19 MB of warnings inside a 10.78 MB result, serialized over stdio and hashed
  // whole into the Task 7 proof ledger, where a duplicated string is not evidence but
  // ballast. Nothing is lost: an auditor branches on the CODE, and "how many rows" is a
  // number, not 20,380 copies of one sentence. The module already had a one-object idiom
  // (`idlessWarned`); these three simply never got it.
  //
  // A FOURTH code has since joined them — LOG_DUPLICATE_ID_CONFLICT, whose `conflictedIds`
  // guard bounded the ROW count and not the OBJECT count. See the exclusion rationale below,
  // which is where that correction is recorded in full.
  //
  // `detail` stays the first occurrence's text so every warning object has the same readable
  // shape, and `detailSamples` keeps a hard-capped set of DISTINCT details — the saturation
  // warning names the partition width, which differs per firing and is the one thing worth
  // seeing more than one of.
  //
  // What this emitter adds over `warn` is only the COLLAPSING: the KEY SET is the same on
  // both.
  //
  // LOG_DUPLICATE_ID_CONFLICT ROUTES THROUGH HERE TOO, and the rationale that used to
  // exclude it was simply wrong. It read: "re-guarding them by (code, component) would
  // silently merge per-id conflicts into one counter". There was never anything per-id to
  // merge. `conflictedIds` fires the warning exactly once per OFFENDING ID, but the detail
  // it emits — `two execution rows share an id but not a content hash (N distinct payloads)`
  // — CARRIES NO ID, so every object it produced was byte-identical. That guard therefore
  // bounded the ROW count, never the object count, and this was the one warning the
  // aggregation pass left unbounded in the size of the account's data: the ceiling is
  // `maxLogPartitions × LOG_PAGE_SIZE` — 5,120 objects at the default budget, 40,960 at the
  // 2,048 maximum. Measured on a 16,384-row corpus of in-flight execution rows re-served by
  // overlapping partitions after their `updatedAt` ticked: 8,192 warning objects,
  // 2,170,881 bytes, EXACTLY ONE distinct detail string — 35% of a 6.2 MB result, in the
  // object that is serialized over stdio and hashed WHOLE into the Task 7 proof ledger,
  // where a duplicated sentence is not evidence but ballast.
  //
  // Aggregating STRENGTHENS the warning rather than weakening it. `conflictedIds` still
  // admits each id exactly once, so `occurrences` here is precisely THE NUMBER OF DISTINCT
  // CONFLICTING IDS — the number an auditor actually wants ("how much of this window is
  // self-contradictory"), and one no consumer could read off thousands of identical copies
  // without counting them itself. Nothing about WHICH warnings fire changes: the same ids
  // trip the same guard and file the same code against the same component.
  //
  // LOG_EVENT_ID_MISSING STAYS ON `warn`, and not because its detail varies — it does not,
  // it is one fixed sentence with no id in it either. Its guard `idlessWarned` is a
  // RUN-LEVEL BOOLEAN rather than a per-id set, so it already emits exactly ONE object
  // however many id-less rows arrive: it is bounded by the vocabulary today, has nothing to
  // collapse, and routing it through here would produce a byte-identical object. Making its
  // `occurrences` count id-less ROWS would mean deleting that guard, which changes what the
  // field means on a code whose verdict is already proven — a separate contract decision,
  // not part of this fix. The two row-id twins on the enrollment and step-roster walks
  // (`enrollmentIdlessWarned`, `rosterIdlessWarned`) are run-level booleans for the same
  // reason and stay for the same reason.
  const WARNING_DETAIL_SAMPLES = 3;
  const aggregatedWarnings = new Map();
  const warnAggregated = (code, component, detail) => {
    // The `component` half of this key is UNREACHABLE TODAY: every `warnAggregated` call
    // site passes `'runtime_events'`, so no test can distinguish this key from a bare `code`
    // and none does. It is kept because a code that ever fires on two components must not
    // silently share one counter — but a future aggregated code on a different component
    // must NOT be assumed covered by the existing tests, which have only ever exercised the
    // single-component case.
    const key = `${code}::${component}`;
    const existing = aggregatedWarnings.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (existing.detailSamples.length < WARNING_DETAIL_SAMPLES && !existing.detailSamples.includes(detail)) {
        existing.detailSamples.push(detail);
      }
      return;
    }
    const entry = { code, component, detail, occurrences: 1, detailSamples: [detail] };
    aggregatedWarnings.set(key, entry);
    warnings.push(entry);
  };

  // Everything the finalizer needs, held in ONE mutable place. It exists because a thrown
  // CIRCUIT_OPEN must still be able to publish what was already read: with the components
  // living in `const`s spread down the function body, a throw at read 6 left reads 1-5 in
  // the temporal dead zone and unreachable, so the only publishable artifact was nothing.
  const progress = {
    workflowDefinition: null,
    runtimeEvents: null,
    enrollments: null,
    perStepCounts: null,
    stepRosters: null,
    enrollmentTotals: null,
    logPages: null,
    enrollmentPages: null,
    stepRosterPages: null,
    definitionComplete: false,
    enrollmentsComplete: false,
    // LOOP-REACHED markers, and the reason componentCompleteness can be trusted on a
    // PARTIAL result. `runtimeEvents` and `stepRosters` are published into `progress`
    // BEFORE their loops run (they have to be — the loops push into those very arrays, and
    // a CIRCUIT_OPEN mid-walk must still be able to publish what was already collected), so
    // `!== null` says only "the array exists", never "the walk ran". Without these two
    // flags a circuit latching on the FIRST execution-log read published
    // `runtimeEvents: []` under `componentCompleteness.runtimeEvents: true`, and a latch on
    // the first step-roster read published `stepRosters: []` under `stepRosters: true` — the
    // exact empty-versus-failed collapse this module exists to prevent, made worse by
    // sitting on a result a Task 5 resumer reads to decide what it may SKIP. The CIRCUIT_OPEN
    // warning is filed against component `'run'`, so componentClean() cannot see it either.
    // These are the same idiom as definitionComplete/enrollmentsComplete, which never had
    // the problem only because their components are assigned after their reads.
    runtimeEventsWalkFinished: false,
    stepRosterLoopFinished: false,
  };

  // Every read in this file goes through here. Recording the applied query and the
  // resolved route for EVERY response — successful or not — is what lets a reviewer
  // reconstruct exactly what was asked and what came back, which is the difference
  // between an audit artifact and a summary.
  const read = async (capabilityId, typedBindings, query) => {
    const response = await auditGateway.callCapability({ capabilityId, typedBindings, query });
    appliedQueries.push({ capabilityId, query });
    sourceRoutes.push({
      capabilityId,
      // The gateway resolves the HOST (backend vs services) as well as the path, and a
      // receipt reader that only sees the path cannot tell which rail answered.
      host: response.host,
      appliedPath: response.appliedPath,
      appliedQuery: response.appliedQuery,
      status: response.status,
      ok: response.ok,
      failureClass: response.failureClass,
      capturedAt: response.capturedAt,
    });
    // The FIRST response's capture time is the run's, deliberately: it is the earliest
    // instant any of this evidence was observed, so a consumer comparing a receipt against
    // a later change cannot be told the window was captured after the change.
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
    // A throttle is a run-level fact, so it is recorded wherever it lands. It is also an
    // incompleteness input in its OWN right (see finalize): the account asked this process
    // to back off mid-run, which means some read somewhere returned less than it would
    // have, regardless of which route happened to trip it.
    if (response.failureClass === CODES.RATE_LIMITED || response.failureClass === CODES.LOCATION_RATE_LIMITED) {
      rateLimit.limited = true;
      if (typeof response.retryAfterMs === 'number') rateLimit.retryAfterMs = response.retryAfterMs;
    }
    return response;
  };

  // Maps a RETURNED failure class onto the warning vocabulary. The identity classes get
  // their own codes because "this response provably belongs to somebody else" and "I could
  // not prove this response belongs to me" demand different operator responses, even
  // though both verdicts are the same: not a read.
  const warnForFailure = (response, component) => {
    const failureClass = response.failureClass;
    const detail = `capability ${response.capabilityId ?? component} returned ${failureClass ?? 'an unusable response'} (status ${response.status ?? 'unknown'})`;
    if (failureClass === CODES.RATE_LIMITED || failureClass === CODES.LOCATION_RATE_LIMITED) {
      warn(RUNTIME_WINDOW_WARNINGS.RATE_LIMITED, component, detail);
      return;
    }
    if (failureClass === CODES.IDENTITY_CONFLICT) {
      warn(RUNTIME_WINDOW_WARNINGS.IDENTITY_CONFLICT_QUARANTINE, component, detail);
      return;
    }
    if (failureClass === CODES.IDENTITY_INSPECTION_CAPPED
      || failureClass === CODES.IDENTITY_DEPTH_CAPPED
      || failureClass === CODES.IDENTITY_UNREADABLE) {
      warn(RUNTIME_WINDOW_WARNINGS.IDENTITY_INSPECTION_INCOMPLETE, component, detail);
      return;
    }
    warn(RUNTIME_WINDOW_WARNINGS.COMPONENT_READ_FAILED, component, detail);
  };

  const componentClean = (component) => !warnings.some((entry) => entry.component === component);

  const finalize = () => {
    // A throttle must produce `complete:false` on its own, whatever tripped it — a
    // LOCATION_RATE_LIMITED 200 can land on a route whose own failure handling is a
    // designed fallback, and relying on Task 2's circuit to latch first is an undocumented
    // cross-module coupling that does not hold when the throttled read is the last one.
    // The warning is added here rather than only at the tripping site so `complete:false`
    // always arrives with a stated reason.
    if (rateLimit.limited && !warnings.some((entry) => entry.code === RUNTIME_WINDOW_WARNINGS.RATE_LIMITED)) {
      warn(RUNTIME_WINDOW_WARNINGS.RATE_LIMITED, 'run',
        'a read in this run was throttled by the account, so at least one component returned less than it would have');
    }
    // Every code in the vocabulary marks data that is missing, contradicted, or
    // unverifiable, so `complete` and `truncated` are exact complements of "no warnings".
    // They remain SEPARATE contract fields because they answer different questions —
    // `complete` is "may I publish a claim about this window", `truncated` is "is there
    // known-missing data" — and a consumer branching on only one of them must not silently
    // get the other's failures wrong.
    //
    // `!rateLimit.limited` IS DEFENCE IN DEPTH, NOT A LOAD-BEARING TERM, and the comment
    // that used to sit here implied otherwise. The backstop directly above guarantees a
    // RATE_LIMITED warning whenever `rateLimit.limited` is set, so `warnings.length === 0`
    // already implies `!rateLimit.limited` and this conjunct cannot change the verdict.
    // It is UNREACHABLE in production for a second, independent reason: `rateLimit.limited`
    // is only ever set from a response whose `failureClass` is RATE_LIMITED or
    // LOCATION_RATE_LIMITED, the Task 2 gateway contract makes such a response `ok:false`,
    // and every one of the nine reads in this collector routes `!response.ok` through
    // `warnForFailure` — which files the same warning again. Two independent guarantees have
    // to fail before this term does anything.
    // It is RETAINED anyway because both guarantees live in OTHER code: the backstop is
    // eight lines up and could be edited or reordered, and the ok/failureClass invariant is
    // a cross-module coupling to audit-gateway.mjs that this file cannot enforce. The cost
    // of the term is one boolean AND; the cost of its absence is a throttled run published
    // as complete, which is precisely the class of silent lie this module exists to refuse.
    // The test that covers it ("a throttle makes the window incomplete even if no component
    // warned about it") has to FEED the collector a state the gateway contract says cannot
    // occur (`ok:true` with a throttling failureClass) in order to reach it at all.
    const complete = warnings.length === 0 && !rateLimit.limited;

    return {
      contractVersion: RUNTIME_WINDOW_CONTRACT_VERSION,
      boundLocationId,
      workflowId,
      requestedWindow: { fromDate: config.fromDate, toDate: config.toDate, boundaries: '[)' },
      // The window sent upstream is now the REQUESTED one, unexpanded. The old
      // one-millisecond lower-bound expansion hedged against undocumented boundary
      // semantics; those are documented now by measurement — BOTH bounds are inclusive on
      // `createdAt`, proven to the exact millisecond — so the hedge is replaced by a stated
      // fact. The half-open analytical filter is still applied locally on top, which is why
      // a row landing exactly on `toDate` is fetched and then dropped.
      appliedWindow: {
        fromDate: config.fromDate,
        toDate: config.toDate,
        queryBoundaries: '[] inclusive on createdAt (measured)',
        analyticalFilter: '[)',
        dateType: 'custom',
        serverFiltered: true,
      },
      appliedQueries,
      filters: { contactId: config.contactId, eventTypes: config.eventTypes, stepIds: config.stepIds },
      workflowDefinition: progress.workflowDefinition,
      runtimeEvents: progress.runtimeEvents,
      // WHAT THIS WINDOW ACTUALLY CONTAINS, counted from the retained rows.
      //
      // Free — these rows are already held — and it exists because the alternative was a
      // hard-coded allow-list that would have been WRONG. The obvious source for the log's
      // step-type vocabulary is the builder's 383-entry step catalog; the two are different
      // languages. The catalog says `wait`, these rows say `wait_time`, and the endpoint
      // answers a wrong slug with a clean empty page — so a catalog-derived list would have
      // produced a confident "no wait steps ever ran".
      //
      // Derived per account, per window, from observation, it cannot drift from the data it
      // describes. `type` is the step that ran; `status` is what happened to it (the two
      // vocabularies overlap — `wait_finished` appears in both — which is its own trap).
      observedEventTypes: progress.runtimeEvents === null ? null : (() => {
        const byType = {};
        const byStatus = {};
        for (const { event } of progress.runtimeEvents) {
          const type = typeof event?.type === 'string' ? event.type : '(absent)';
          const status = typeof event?.status === 'string' ? event.status : '(absent)';
          byType[type] = (byType[type] ?? 0) + 1;
          byStatus[status] = (byStatus[status] ?? 0) + 1;
        }
        // Key-sorted so two identical runs serialize identically — this result is hashed
        // whole into the proof ledger, and insertion order is an artifact of row order.
        const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
        return { byType: sorted(byType), byStatus: sorted(byStatus) };
      })(),
      enrollments: progress.enrollments,
      perStepCounts: progress.perStepCounts,
      stepRosters: progress.stepRosters,
      enrollmentTotals: progress.enrollmentTotals,
      // Per-component completeness. `runtimeEvents` has to stay an array to be usable, so
      // it cannot express "not read" by being null the way its siblings do; without this
      // block a total log-read failure published `[]`, which is the exact "empty vs failed"
      // collapse this whole module exists to prevent. A component that was never reached
      // (a run that threw) is false here, not true-by-absence-of-warnings — and that is
      // what the two `…Finished` flags buy: `runtimeEvents` and `stepRosters` are the only
      // two components published into `progress` before their loops run, so for them alone
      // `!== null` is satisfied by a walk that never happened. Everything here is an AND of
      // three independent things: the component EXISTS, its loop RAN TO THE END, and
      // nothing warned against it.
      //
      // ONE THROW-PATH GAP REMAINS, and it is stated here rather than fixed because the fix
      // would change the verdict. `enrollments` is cross-checked against the totals routes by
      // the ENROLLMENT_TOTAL_MISMATCH rule, which runs AFTER them (step 6 below). A thrown
      // CIRCUIT_OPEN on `workflow_enroll_stats_cache` therefore skips that check entirely,
      // and this map reports `enrollments: true` where a run that COMPLETED over identical
      // data would have reported `false`. It is not silent — the same artifact carries
      // `enrollmentTotals: null`, `componentCompleteness.enrollmentTotals: false`, a
      // CIRCUIT_OPEN warning and `complete: false` — so the consumer rule is exactly this:
      //
      //   A RESUMER MUST NOT TREAT `enrollments: true` AS SKIPPABLE UNLESS
      //   `enrollmentTotals: true` ALSO HOLDS.
      //
      // Read on its own, `enrollments: true` is a claim that the roster was walked, never a
      // claim that it was reconciled.
      componentCompleteness: {
        workflowDefinition: progress.workflowDefinition !== null && progress.definitionComplete && componentClean('workflow_definition'),
        runtimeEvents: progress.runtimeEvents !== null && progress.runtimeEventsWalkFinished && componentClean('runtime_events'),
        perStepCounts: progress.perStepCounts !== null && componentClean('per_step_counts'),
        enrollments: progress.enrollments !== null && progress.enrollmentsComplete && componentClean('enrollments'),
        stepRosters: progress.stepRosters !== null && progress.stepRosterLoopFinished && progress.stepRosters.every((roster) => roster.complete) && componentClean('step_rosters'),
        enrollmentTotals: progress.enrollmentTotals !== null && progress.enrollmentTotals.total !== null && componentClean('enrollment_totals'),
      },
      pagination: {
        logPages: progress.logPages,
        enrollmentPages: progress.enrollmentPages,
        stepRosterPages: progress.stepRosterPages,
      },
      rateLimit,
      locationBinding: {
        // Absence records request-scope binding: a weaker claim than a native match, but
        // still evidence. Downgrading absence to a failure would make most of this API
        // unreadable; upgrading it to a native match would claim proof that does not exist.
        bindingMethod: bindingMethods.size === 1 ? [...bindingMethods][0] : bindingMethods.size === 0 ? 'request_scope' : 'mixed',
        quarantined,
        conflicts,
        inspectionIncomplete: identityIncomplete,
      },
      sourceRoutes,
      capabilityVersion: AUDIT_CAPABILITY_VERSION,
      capturedAt,
      // The SECOND axis, kept out of `complete` on purpose. Nothing on this rail proves
      // the captured definition was the one in force while these events ran, and that is
      // true of EVERY run — folding it into `complete` would pin `complete` to false
      // forever and make it useless for its actual job (runtime event coverage). Task 11
      // consumes this field as a publication gate: no consumer may state or imply that the
      // current configuration governed historical events on this evidence.
      configurationBinding: {
        definitionGovernedRuntimeEvents: 'unproven',
        provenBy: null,
        publishableAsGoverning: false,
        detail: 'The audit rail exposes no workflow version-history capability, so nothing here proves the captured definition was in force during the requested window.',
      },
      complete,
      truncated: !complete,
      warnings,
    };
  };

  try {
    return await collect();
  } catch (error) {
    if (error && error.code === CODES.CIRCUIT_OPEN) {
      // The throw still propagates — a latched circuit means stop and resume deliberately
      // (plan Step 3), not retry. But the reads that already completed are real evidence,
      // and throwing them away made a resumer re-walk every partition it had already paid
      // for with no way to know which ones those were.
      warn(RUNTIME_WINDOW_WARNINGS.CIRCUIT_OPEN, 'run',
        `the audit circuit latched mid-run (${error.meta?.scope ?? 'unknown scope'}/${error.meta?.reason ?? 'unknown reason'}); everything read before the latch is attached to error.partial`);
      error.partial = finalize();
    }
    throw error;
  }

  async function collect() {
    const entityBindings = { locationId: boundLocationId, workflowId };

    // --- 1. definition -----------------------------------------------------------
    // Definition FIRST, and not for cosmetic reasons: the step roster's optional seal
    // (discoveredStepIds) is derived from the definition, so a roster read issued before it
    // would be unsealed — and an unsealed roster cannot tell a typo'd step id apart from a
    // legitimately empty step.
    const detail = await read('workflow_detail', entityBindings, { includeScheduledPauseInfo: 'true' });
    if (!detail.ok) warnForFailure(detail, 'workflow_definition');
    const triggersResponse = await read('workflow_triggers', entityBindings, { workflowId });
    if (!triggersResponse.ok) warnForFailure(triggersResponse, 'workflow_definition');
    const notesResponse = await read('workflow_sticky_notes', entityBindings, { workflowId, locationId: boundLocationId });
    if (!notesResponse.ok) warnForFailure(notesResponse, 'workflow_definition');

    const workflow = detail.ok ? detail.json : null;
    const triggers = triggersResponse.ok ? rowsOf(triggersResponse.json, 'triggers', 'data') : null;
    const stickyNotes = notesResponse.ok ? rowsOf(notesResponse.json, 'data', 'notes') : null;
    const definitionComplete = workflow !== null && triggers !== null && stickyNotes !== null;
    progress.definitionComplete = definitionComplete;
    if (detail.ok && workflow === null) warnForFailure(detail, 'workflow_definition');
    if (triggersResponse.ok && triggers === null) warn(RUNTIME_WINDOW_WARNINGS.COMPONENT_READ_FAILED, 'workflow_definition', 'the trigger response carried no readable trigger list');
    if (notesResponse.ok && stickyNotes === null) warn(RUNTIME_WINDOW_WARNINGS.COMPONENT_READ_FAILED, 'workflow_definition', 'the sticky-note response carried no readable note list');

    const discoveredStepIds = (workflow?.workflowData?.templates ?? [])
      .map((template) => template?.id ?? template?._id)
      .filter((id) => id !== undefined && id !== null && String(id) !== '')
      .map(String);

    progress.workflowDefinition = {
      workflow,
      triggers,
      stickyNotes,
      version: workflow?.version ?? null,
      hashAlgorithm: 'sha256',
      // Hashed only when all three components read cleanly: a hash over a partial
      // definition would compare unequal to itself on the next run for reasons that have
      // nothing to do with the workflow changing — and Task 7 binds a receipt to this
      // hash, so a partial definition hashing to a complete-looking value would bind a
      // receipt to evidence that was never collected.
      canonicalHash: definitionComplete ? sha256Canonical({ workflow, triggers, stickyNotes }) : null,
      // THE HASH A CLIENT CAN ACTUALLY CHECK. `canonicalHash` above is computed over the
      // definition as it arrived from GHL, but this whole result then leaves through `ok()`
      // (core/tools.mjs) → `scrubSecrets` (core/errors.mjs), which is LOSSY and NOT
      // invertible: it rewrites Bearer tokens, JWT-shaped strings and `token:`/`apiKey=`/
      // `password:` labelled values, and replaces the ENTIRE subtree under any key in
      // SECRET_KEYS with '<redacted>'. So no consumer can reproduce `canonicalHash` from the
      // bytes it received — and webhook and custom-code steps are precisely where those
      // values live, which makes it the common case rather than a corner one.
      //
      // Publishing BOTH is the fix, rather than replacing the pre-scrub digest: the pre-scrub
      // hash is the one that identifies the definition GHL actually served (two definitions
      // differing only inside a redacted subtree share a post-scrub hash and must not be
      // mistaken for the same workflow), and the post-scrub hash is the one a client holding
      // the transcript can verify. They answer different questions, so both are stated and
      // named for what they cover.
      //
      // Computed over `scrubSecrets(...)` of the same triple, in the same key order, so the
      // only difference between the two digests is the scrub itself.
      canonicalHashScrubbed: definitionComplete
        ? sha256Canonical(scrubSecrets({ workflow, triggers, stickyNotes }))
        : null,
      // Which digest covers what the caller is holding. A client that verifies the wrong one
      // reports a definition mismatch that is really a scrub, so this is stated rather than
      // left to be inferred from field names.
      hashCoverage: {
        canonicalHash: 'pre-scrub upstream bytes; NOT reproducible from this response',
        canonicalHashScrubbed: 'post-scrub bytes; reproducible from this response',
      },
      capturedAt: detail.capturedAt ?? null,
      // The quietest lie available to this collector is reading a definition TODAY and
      // reporting runtime from last week as though those contacts went through it. Nothing
      // on the audit rail proves an effective interval — there is no version-history
      // capability — so the claim is refused outright rather than approximated from the
      // requested window. See `configurationBinding` for the run-level statement of it.
      validity: {
        effectiveFrom: null,
        effectiveTo: null,
        source: null,
        provenEffectiveInterval: false,
        appliesToRequestedWindow: 'unproven',
      },
    };

    // --- 2. execution-log partition walk -----------------------------------------
    // No cursor is sent to /workflows/logs/v2 (Global Constraint line 20: the YAML
    // documents none). Completeness comes from TIME instead: query, and if the page came
    // back full — meaning the window is saturated and rows may be hidden behind it — split
    // the range and ask again until every partition returns short.
    const logPages = {
      pages: 0, streams: 0, limit: config.logPageSize, rowsReturned: 0,
      exhausted: false, budget: config.maxLogPages, retries: 0, terminatedCleanly: false,
    };
    progress.logPages = logPages;
    const events = [];
    progress.runtimeEvents = events;
    const eventKeys = new Set();
    const hashesById = new Map();
    const conflictedIds = new Set();
    let logWalkStopped = false;
    let idlessWarned = false;

    const retainEvent = (row, contentHash, occurrence, timestamp, timestampField, unreadableTimestampFields) => {
      const id = idOf(row);
      // The id is PART of the hashed content, so an id-bearing row is fully identified by
      // its content hash alone; a composite `id::hash` key was dead weight (and its
      // id-dropping mutant was equivalent). An ID-LESS row is different: content is the
      // only thing it has, so two genuinely distinct events with identical payloads are
      // indistinguishable from one event echoed by overlapping partitions. Within a single
      // response they are PROVABLY distinct, so they are keyed by their occurrence index
      // and both retained; across responses the same index recurs, so the overlap still
      // dedupes. The count is declared unprovable via LOG_EVENT_ID_MISSING either way.
      const key = id === null ? `noid:${contentHash}#${occurrence}` : `content:${contentHash}`;
      if (eventKeys.has(key)) return;
      eventKeys.add(key);
      if (id === null && !idlessWarned) {
        idlessWarned = true;
        warn(RUNTIME_WINDOW_WARNINGS.LOG_EVENT_ID_MISSING, 'runtime_events',
          'an execution row carried neither _id nor id, so its event count can only be deduplicated by content and cannot be proven');
      }
      if (id !== null) {
        const hashes = hashesById.get(id) ?? new Set();
        hashes.add(contentHash);
        hashesById.set(id, hashes);
        // Both copies are retained. One of them is wrong and this collector cannot tell
        // which, so keeping the first would turn a contradiction into a confident answer.
        // AGGREGATED. `conflictedIds` bounds this to one firing per OFFENDING ID, not to one
        // OBJECT: the detail carries no id, so every object was byte-identical and the count
        // rose with the corpus (16,384 rows of in-flight re-serves => 8,192 identical
        // objects, 2.17 MB). Collapsed, `occurrences` IS the number of distinct conflicting
        // ids — see warnAggregated for the measurement and the corrected rationale.
        if (hashes.size > 1 && !conflictedIds.has(id)) {
          conflictedIds.add(id);
          warnAggregated(RUNTIME_WINDOW_WARNINGS.LOG_DUPLICATE_ID_CONFLICT, 'runtime_events', `two execution rows share an id but not a content hash (${hashes.size} distinct payloads)`);
        }
      }
      if (timestamp === null) {
        // Retained as evidence (dropping it loses a real row) but never dated from the
        // query window (that would manufacture a membership proof). The requested window is
        // incomplete because local [fromDate, toDate) membership cannot be established.
        // AGGREGATED: this fires once per offending ROW, so a corpus with 20,380 undated
        // rows emitted 20,380 identical objects. See warnAggregated.
        warnAggregated(RUNTIME_WINDOW_WARNINGS.LOG_EVENT_TIMESTAMP_UNPARSEABLE, 'runtime_events', 'an execution row carried no parseable startedExecutionAt, createdAt or updatedAt');
      }
      if (unreadableTimestampFields.length > 0) {
        warnAggregated(RUNTIME_WINDOW_WARNINGS.LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE, 'runtime_events',
          `an execution row carried an unreadable ${unreadableTimestampFields.join(', ')} ahead of the field its timestamp was finally taken from`);
      }
      events.push({ id, timestamp, timestampField, unreadableTimestampFields, event: row });
    };

    // ONE page read, with a bounded retry. Wide windows on this endpoint intermittently
    // answer HTTP 500 and then serve the identical request cleanly moments later — measured
    // repeatedly, including 500/500/200/200 on four back-to-back identical calls. The shape
    // is consistent with an expensive cold query timing out and then hitting a warm cache.
    // Retrying is therefore not papering over a fault, it IS the documented contract; a
    // walk that abandoned the window on the first 500 would report a partial audit for a
    // workflow that is perfectly readable.
    const readLogPage = async (query) => {
      let response = await read('workflow_execution_logs', entityBindings, query);
      for (let attempt = 1; attempt <= config.maxLogRetries && !response.ok && isRetryable(response); attempt += 1) {
        logPages.retries += 1;
        response = await read('workflow_execution_logs', entityBindings, query);
      }
      return response;
    };

    const walkStream = async (eventType) => {
      // The reference pair carried between pages. BOTH halves are load-bearing: with
      // `referenceId` alone the server returns page 1 again, forever, with no error — a
      // silent non-advance that a page-count guard reads as healthy progress.
      let reference = null;

      while (!logWalkStopped) {
        if (logPages.pages >= logPages.budget) {
          logPages.exhausted = true;
          logWalkStopped = true;
          warn(RUNTIME_WINDOW_WARNINGS.LOG_PAGE_BUDGET_EXHAUSTED, 'runtime_events',
            `the log page budget of ${logPages.budget} was spent before the cursor exhausted itself`);
          return;
        }
        const query = {
          workflowId,
          locationId: boundLocationId,
          limit: String(config.logPageSize),
          // Pinned by the descriptor too, and sent explicitly so the receipt records the
          // mode the window was read under rather than leaving it to be inferred.
          dateType: 'custom',
          // Both bounds are inclusive upstream; the half-open analytical filter is applied
          // locally below, so a row landing exactly on toDate is fetched and then dropped.
          fromDate: String(config.fromDate),
          toDate: String(config.toDate),
          action: reference === null ? 'first' : 'next',
        };
        if (reference !== null) {
          query.referenceId = reference.id;
          query.referenceCreatedAt = reference.createdAt;
        }
        if (config.contactId !== null) query.contactId = config.contactId;
        if (eventType !== null) query.eventType = eventType;

        logPages.pages += 1;
        const response = await readLogPage(query);
        if (!response.ok) {
          warnForFailure(response, 'runtime_events');
          logWalkStopped = true;
          return;
        }
        const rows = rowsOf(response.json, 'logs', 'data', 'rows');
        if (rows === null) {
          warn(RUNTIME_WINDOW_WARNINGS.COMPONENT_READ_FAILED, 'runtime_events', 'the execution-log response carried no readable row list');
          logWalkStopped = true;
          return;
        }
        logPages.rowsReturned += rows.length;

        const before = eventKeys.size;
        const idlessOccurrences = new Map();
        for (const row of rows) {
          const { timestamp, timestampField, unreadableTimestampFields } = readEventTime(row);
          const contentHash = contentHashOf(row);
          let occurrence = 0;
          if (idOf(row) === null) {
            occurrence = idlessOccurrences.get(contentHash) ?? 0;
            idlessOccurrences.set(contentHash, occurrence + 1);
          }
          // The window is re-checked HERE even though the server applied it. That is not
          // redundancy: the server filter is a claim, and the whole reason this module
          // exists is that a claim about a filter was believed for months without anyone
          // testing the rows. Membership in [fromDate, toDate) is decided on the row's own
          // timestamp, so a server that quietly widened or ignored the window cannot
          // smuggle rows into the published set.
          if (timestamp === null) retainEvent(row, contentHash, occurrence, null, null, unreadableTimestampFields);
          else if (timestamp >= config.fromDate && timestamp < config.toDate) {
            retainEvent(row, contentHash, occurrence, timestamp, timestampField, unreadableTimestampFields);
          }
        }

        // TERMINATION. Every page re-serves the previous page's last row, so the last page
        // of a walk is a degenerate one-row echo — `rows.length === 0` NEVER happens and a
        // loop waiting for it runs until the budget kills it. "No new ids" is the only
        // honest end condition, and it is also the completeness proof: the cursor was
        // followed until it had nothing further to give.
        if (rows.length === 0 || eventKeys.size === before) break;
        const last = rows[rows.length - 1];
        const nextId = idOf(last);
        const nextCreatedAt = last?.createdAt ?? null;
        // A page whose final row cannot supply BOTH halves of the reference pair cannot be
        // continued. Sending a half-reference would silently re-read the same page, so the
        // walk stops and says so rather than looping on an unchanging cursor.
        if (nextId === null || nextCreatedAt === null || String(nextCreatedAt) === '') {
          warn(RUNTIME_WINDOW_WARNINGS.LOG_CURSOR_UNUSABLE, 'runtime_events',
            'a log page ended on a row carrying no usable id/createdAt pair, so the cursor cannot be advanced and the remaining pages are unread');
          logWalkStopped = true;
          return;
        }
        reference = { id: String(nextId), createdAt: String(nextCreatedAt) };
      }
      // Reaching here means the loop exited via the terminal `break` above — the cursor
      // gave back a page with nothing new on it. EVERY other exit (budget spent, failed
      // read, unreadable envelope, unusable cursor) `return`s early and leaves this false,
      // which is what makes the flag a completeness proof rather than a lap counter.
      logPages.terminatedCleanly = true;
    };

    // `eventType` is optional but NOT repeatable on the descriptor, so N requested event
    // types cost N independent cursor walks, drawing on one shared page budget.
    const streams = config.eventTypes.length > 0 ? config.eventTypes : [null];
    logPages.streams = streams.length;
    // `terminatedCleanly` is an AND across every stream, not a snapshot of the last one: a
    // run where stream 1 exhausted its budget and stream 2 walked out cleanly has not seen
    // the whole log, and a flag that only remembered stream 2 would say it had.
    logPages.terminatedCleanly = true;
    for (const eventType of streams) {
      if (logWalkStopped) break;
      const before = logPages.terminatedCleanly;
      logPages.terminatedCleanly = false;
      await walkStream(eventType);
      logPages.terminatedCleanly = before && logPages.terminatedCleanly;
    }
    // Ascending by instant with the unplaceable rows last. Array.prototype.sort is stable,
    // so rows sharing an instant keep first-seen order and two identical runs agree.
    events.sort((left, right) => {
      if (left.timestamp === null && right.timestamp === null) return 0;
      if (left.timestamp === null) return 1;
      if (right.timestamp === null) return -1;
      return left.timestamp - right.timestamp;
    });
    // The walk was REACHED and ran to its end. Not "it succeeded" — a failed or exhausted
    // walk sets logWalkStopped and has already warned on `runtime_events`, which
    // componentClean() catches. This flag exists solely to distinguish that from a walk a
    // thrown CIRCUIT_OPEN prevented from running at all, which `progress.runtimeEvents !==
    // null` cannot, because the array is published before the first page is read.
    progress.runtimeEventsWalkFinished = true;

    // --- 3. per-step counts -------------------------------------------------------
    // SHAPE SETTLED 2026-07-27 by parking a contact on GROM AU (the account had none, so the
    // row key could not be read off an empty array — a send-free probe workflow was built,
    // one fabricated contact parked at a 30-day wait, and everything deleted after; ledger in
    // README.md). The response is a BARE ARRAY of `{total, currentStepId}` — the step key is
    // `currentStepId`, NOT `stepId` and NOT `_id`, and the count key is `total`, not `count`.
    //
    // Nothing here consumes that key, deliberately: `perStepCounts` is published VERBATIM, and
    // `discoveredStepIds` (the roster seal) comes from the DEFINITION's `workflowData.templates`
    // rather than from these rows. So the live key can never silently mismatch a reader that
    // does not exist. A CONSUMER walking `perStepCounts`, however, must read `currentStepId`;
    // a fixture-derived guess of `stepId` returns undefined for every row.
    const countsResponse = await read('workflow_count_per_step', entityBindings, { workflowId, locationId: boundLocationId });
    if (!countsResponse.ok) {
      warnForFailure(countsResponse, 'per_step_counts');
    } else {
      progress.perStepCounts = rowsOf(countsResponse.json, 'counts', 'data', 'rows');
      if (progress.perStepCounts === null) {
        warn(RUNTIME_WINDOW_WARNINGS.COMPONENT_READ_FAILED, 'per_step_counts', 'the count-per-step response carried no readable count list');
      }
    }

    // --- 4. enrollment cursor walk ------------------------------------------------
    // This route DOES document a cursor (action=first/next), so completeness here is a
    // cursor problem rather than a time problem. The window sent is the REQUESTED one: the
    // one-millisecond expansion is a property of the log walk's unproven boundary
    // semantics, and leaking it here would widen the enrollment set on every audit.
    const enrollmentRows = [];
    const enrollmentKeys = new Set();
    const enrollmentPages = { fetched: 0, exhausted: false, budget: config.maxEnrollmentPages };
    progress.enrollmentPages = enrollmentPages;
    let enrollmentsComplete = true;
    let enrollmentIdlessWarned = false;
    const seenCursors = new Set();
    let cursor = null;
    let action = 'first';

    for (;;) {
      const query = {
        workflowId,
        locationId: boundLocationId,
        action,
        limit: String(ENROLLMENT_PAGE_SIZE),
        fromDate: String(config.fromDate),
        toDate: String(config.toDate),
      };
      if (config.contactId !== null) query.contactId = config.contactId;
      // Cursor keys are OPTIONAL on the descriptor, so the gateway's non-empty-required-value
      // rule does not cover them: `referenceSid=` would reach the wire as an empty value and
      // quietly change the query the receipt claims was made. Absent means ABSENT.
      if (cursor !== null) Object.assign(query, cursor);

      const response = await read('workflow_enrollment_search', entityBindings, query);
      if (!response.ok) {
        warnForFailure(response, 'enrollments');
        enrollmentsComplete = false;
        break;
      }
      const batch = rowsOf(response.json, 'rows', 'statuses', 'data');
      if (batch === null) {
        warn(RUNTIME_WINDOW_WARNINGS.COMPONENT_READ_FAILED, 'enrollments', 'the enrollment response carried no readable row list');
        enrollmentsComplete = false;
        break;
      }
      enrollmentPages.fetched += 1;
      let added = 0;
      // A FRESH keyer per response: id-less occurrence indices must restart so a page
      // echoed by a repeated cursor still dedupes to one copy (see makeRowKeyer).
      const keyOf = makeRowKeyer();
      for (const row of batch) {
        const key = keyOf(row);
        if (enrollmentKeys.has(key)) continue;
        enrollmentKeys.add(key);
        enrollmentRows.push(row);
        added += 1;
        if (idOf(row) === null && !enrollmentIdlessWarned) {
          enrollmentIdlessWarned = true;
          warn(RUNTIME_WINDOW_WARNINGS.ENROLLMENT_ROW_ID_MISSING, 'enrollments',
            'an enrollment row carried neither _id nor id, so its roster count can only be deduplicated by content and cannot be proven');
        }
      }
      if (batch.length < ENROLLMENT_PAGE_SIZE) break;   // a short page is the documented terminal signal
      if (added === 0) {
        // The cursor advanced but the CONTENT did not. Tuple-repeat detection alone misses
        // this, and without it the walk pages forever over one page of rows and calls the
        // result complete.
        warn(RUNTIME_WINDOW_WARNINGS.ENROLLMENT_NO_UNIQUE_PROGRESS, 'enrollments', 'an enrollment page advanced the cursor but contributed no new rows');
        enrollmentsComplete = false;
        break;
      }
      if (enrollmentPages.fetched >= enrollmentPages.budget) {
        enrollmentPages.exhausted = true;
        warn(RUNTIME_WINDOW_WARNINGS.ENROLLMENT_PAGE_BUDGET_EXHAUSTED, 'enrollments', `the enrollment page budget of ${enrollmentPages.budget} was spent before the roster ended`);
        enrollmentsComplete = false;
        break;
      }
      const next = cursorFromRow(batch[batch.length - 1]);
      if (next === null) {
        // Nothing to advance on. Continuing would re-request page one forever; stopping
        // quietly would publish a truncated roster as the whole roster.
        warn(RUNTIME_WINDOW_WARNINGS.ENROLLMENT_CURSOR_MISSING, 'enrollments', 'the terminal row of a full enrollment page carried neither an id nor a sid to page on');
        enrollmentsComplete = false;
        break;
      }
      const token = JSON.stringify(next);
      if (seenCursors.has(token)) {
        warn(RUNTIME_WINDOW_WARNINGS.ENROLLMENT_CURSOR_REPEATED, 'enrollments', 'an enrollment page ended on a cursor tuple that had already been used');
        enrollmentsComplete = false;
        break;
      }
      seenCursors.add(token);
      cursor = next;
      action = 'next';
    }
    // The walk is ALWAYS window-scoped: fromDate/toDate are mandatory on this composite,
    // so there is no such thing as an all-time roster here. Recorded explicitly so a
    // reader can never read `enrollmentTotals.total` as "the number of rows above".
    progress.enrollments = {
      rows: enrollmentRows,
      complete: enrollmentsComplete,
      windowScoped: true,
      contactFiltered: config.contactId !== null,
    };
    progress.enrollmentsComplete = enrollmentsComplete;

    // --- 5. requested step rosters -------------------------------------------------
    const stepRosters = [];
    progress.stepRosters = stepRosters;
    const stepRosterPages = { fetched: 0, exhausted: false, budget: config.maxStepRosterPages };
    progress.stepRosterPages = stepRosterPages;
    const sealedSteps = new Set(discoveredStepIds);
    let rosterIdlessWarned = false;
    for (const stepId of config.stepIds) {
      if (!sealedSteps.has(stepId)) {
        // Refused LOCALLY. An empty discoveredStepIds array alongside a typed stepId THROWS
        // at the gateway (Task 2 carry-forward item 5), so asking anyway would turn a
        // definition with no steps into a policy exception out of a read composite. The gap
        // is recorded instead, which is the same verdict without the crash. `contacts` is
        // null, not []: no roster was read, and an empty array would claim the step has
        // nobody in it.
        warn(RUNTIME_WINDOW_WARNINGS.STEP_ROSTER_UNSEALED, 'step_rosters', 'a requested step is not in the step set the workflow definition declares, so no roster read was issued');
        stepRosters.push({ stepId, contacts: null, total: null, complete: false, pages: 0 });
        continue;
      }
      const roster = { stepId, contacts: [], total: null, complete: true, pages: 0 };
      const rosterKeys = new Set();
      let skip = 0;
      for (;;) {
        if (stepRosterPages.fetched >= stepRosterPages.budget) {
          stepRosterPages.exhausted = true;
          roster.complete = false;
          warn(RUNTIME_WINDOW_WARNINGS.STEP_ROSTER_PAGE_BUDGET_EXHAUSTED, 'step_rosters', `the step-roster page budget of ${stepRosterPages.budget} was spent before step ${stepId} reached its reported total`);
          break;
        }
        const response = await read(
          'workflow_step_details',
          // discoveredStepIds is an OPTIONAL seal, and it is supplied because honouring it
          // costs nothing and stops a typo'd step id from being read as an empty roster.
          { ...entityBindings, stepId, discoveredStepIds },
          {
            workflowId,
            locationId: boundLocationId,
            currentStepId: stepId,
            skip: String(skip),
            limit: String(STEP_ROSTER_PAGE_SIZE),
            showTotalCount: 'true',
          },
        );
        if (!response.ok) {
          warnForFailure(response, 'step_rosters');
          roster.complete = false;
          break;
        }
        const rows = rowsOf(response.json, 'rows', 'data');
        if (rows === null) {
          warn(RUNTIME_WINDOW_WARNINGS.COMPONENT_READ_FAILED, 'step_rosters', 'a step-roster response carried no readable row list');
          roster.complete = false;
          break;
        }
        stepRosterPages.fetched += 1;
        roster.pages += 1;
        const reported = Number(response.json?.totalCount);
        if (Number.isFinite(reported) && reported >= 0) roster.total = reported;
        // A FRESH keyer per response, for the same reason as the enrollment walk: the same
        // skip re-served must dedupe, two identical id-less rows in one page must not.
        const keyOf = makeRowKeyer();
        for (const row of rows) {
          const key = keyOf(row);
          if (rosterKeys.has(key)) continue;
          rosterKeys.add(key);
          roster.contacts.push(row);
          if (idOf(row) === null && !rosterIdlessWarned) {
            rosterIdlessWarned = true;
            warn(RUNTIME_WINDOW_WARNINGS.STEP_ROSTER_ROW_ID_MISSING, 'step_rosters',
              'a step-roster row carried neither _id nor id, so the roster count can only be deduplicated by content and cannot be proven');
          }
        }
        // showTotalCount is pinned to true precisely so the roster can be reconciled: a
        // truncated roster must not be able to read as a complete one.
        if (roster.total !== null && roster.contacts.length >= roster.total) break;
        if (rows.length < STEP_ROSTER_PAGE_SIZE) {
          if (roster.total === null) break;   // nothing to reconcile against; a short page is terminal
          // A short page that lands BELOW the reported total is the undercount this whole
          // showTotalCount pin exists to catch. Treating it as terminal would publish
          // "80 contacts at this step" for a step the upstream says holds 120.
          warn(RUNTIME_WINDOW_WARNINGS.COMPONENT_READ_FAILED, 'step_rosters', `step ${stepId} ran out of rows at ${roster.contacts.length} of a reported ${roster.total}`);
          roster.complete = false;
          break;
        }
        skip += rows.length;
      }
      stepRosters.push(roster);
    }
    // The roster loop was REACHED and every requested step was visited. Without this,
    // `stepRosters !== null` was satisfied by the empty array published before the loop, so
    // a circuit latching on the first roster read reported `stepRosters: true` next to `[]`
    // for two requested steps — and `[].every(...)` is vacuously true, so the per-roster
    // completeness check could not catch it either.
    progress.stepRosterLoopFinished = true;

    // --- 6. enrollment totals, cache first ------------------------------------------
    // Cardinality 1 by spec (plan line 313): one call per workflow. Batching would ask for a
    // differently-shaped result than the one-workflow read the receipt claims and would drag
    // other workflows' rows through this location's identity guard.
    const cacheResponse = await read('workflow_enroll_stats_cache', entityBindings, {
      'workflowIds[]': workflowId,
      locationId: boundLocationId,
    });
    // A CODED failure is never a "cache miss". A 429, a 403, a quarantining identity
    // conflict and an unreadable identity all used to vanish here, and because this is the
    // LAST read of the run there was nothing downstream to catch them: the window came back
    // complete:true, truncated:false, warnings:[]. "Cache miss" means a READABLE body with
    // no usable total, and only that.
    if (!cacheResponse.ok) warnForFailure(cacheResponse, 'enrollment_totals');
    let stats = cacheResponse.ok ? pickStats(cacheResponse.json, workflowId) : null;
    let statsSource = stats === null ? null : 'workflow_enroll_stats_cache';
    if (stats === null) {
      // The legacy route is a DESIGNED fallback for a readable-but-empty cache, so a cache
      // MISS is not itself a warning. Always calling both would double the read cost of
      // every workflow in the account.
      const legacyResponse = await read('workflow_enroll_stats', entityBindings, { workflowId, locationId: boundLocationId });
      if (!legacyResponse.ok) warnForFailure(legacyResponse, 'enrollment_totals');
      stats = legacyResponse.ok ? pickStats(legacyResponse.json, workflowId) : null;
      statsSource = stats === null ? null : 'workflow_enroll_stats';
      if (stats === null) {
        // Never a 0 total: that reads as a reconciled empty workflow and could be published
        // as "this workflow enrolled nobody".
        warn(RUNTIME_WINDOW_WARNINGS.ENROLLMENT_TOTALS_UNAVAILABLE, 'enrollment_totals', 'neither the enrollment-totals cache nor the legacy totals route returned a usable total');
      }
    }
    const enrollmentTotals = {
      total: stats?.total ?? null,
      finished: stats?.finished ?? null,
      source: statsSource,
      // The totals routes report the workflow's LIFETIME figure. Stating the scope is the
      // whole point: without it, `total` sitting next to a window-scoped roster invites
      // exactly the subtraction nobody is entitled to make.
      scope: 'workflow_all_time',
    };
    progress.enrollmentTotals = enrollmentTotals;
    // Only a PROVABLE contradiction warns. The old rule warned whenever the all-time total
    // differed from the window-filtered roster, which is the normal arithmetic of every
    // real window (total 500 vs 3 in-window rows) — so `complete` was false on essentially
    // every production run and a genuine LOG_PARTITION_BUDGET_EXHAUSTED became
    // indistinguishable from expected subtraction. A window-scoped roster that EXCEEDS the
    // all-time total is a different thing entirely: it cannot be true under any scoping.
    if (enrollmentTotals.total !== null && enrollmentRows.length > enrollmentTotals.total) {
      warn(RUNTIME_WINDOW_WARNINGS.ENROLLMENT_TOTAL_MISMATCH, 'enrollments', `the enrollment roster walked ${enrollmentRows.length} unique rows inside the requested window against a reported all-time total of ${enrollmentTotals.total}`);
      progress.enrollments.complete = false;
      progress.enrollmentsComplete = false;
    }

    // --- 7. verdict -----------------------------------------------------------------
    return finalize();
  }
}

// The complete cursor tuple, including referenceSequence — which the pre-existing walk
// dropped, silently truncating a key the upstream orders by. Rows are not guaranteed to
// name the fields the query does, so each key accepts the row-side name first and the
// query-side echo second.
function cursorFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const usable = (value) => value !== undefined && value !== null && String(value).trim() !== '';
  const first = (...candidates) => candidates.find(usable);
  const cursor = {};
  const referenceId = first(row._id, row.id, row.referenceId);
  const referenceCreatedAt = first(row.createdAt, row.referenceCreatedAt);
  const referenceSid = first(row.sid, row.referenceSid);
  const referenceSequence = first(row.sequence, row.referenceSequence);
  if (usable(referenceId)) cursor.referenceId = String(referenceId);
  if (usable(referenceCreatedAt)) cursor.referenceCreatedAt = String(referenceCreatedAt);
  if (usable(referenceSid)) cursor.referenceSid = String(referenceSid);
  if (usable(referenceSequence)) cursor.referenceSequence = String(referenceSequence);
  // An id or a sid is what the upstream actually pages on; a bare createdAt cannot
  // advance the walk, so a tuple without either is no cursor at all.
  return cursor.referenceId === undefined && cursor.referenceSid === undefined ? null : cursor;
}

// A totals row without a readable `total` is not a total. Returning `{total: 0}` for one
// would be indistinguishable from a workflow nobody entered.
function pickStats(json, workflowId) {
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(json?.stats) ? json.stats
      : Array.isArray(json?.data) ? json.data
        : (json && typeof json === 'object' ? [json] : []);
  const mine = rows.find((row) => row && String(row.workflowId) === String(workflowId)) ?? rows[0] ?? null;
  if (!mine || typeof mine !== 'object') return null;
  const total = Number(mine.total);
  if (!Number.isFinite(total)) return null;
  const finished = Number(mine.finished);
  return { total, finished: Number.isFinite(finished) ? finished : null };
}
