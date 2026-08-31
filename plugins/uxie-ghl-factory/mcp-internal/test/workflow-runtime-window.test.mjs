// RED tests for core/workflow-runtime-window.mjs (Task 3, Steps 1-3 of
// docs/superpowers/plans/2026-07-24-internal-mcp-audit-read-profile.md).
//
// The collector under test does not exist yet. This file IS the contract:
//
//   export async function collectWorkflowRuntimeWindow({ auditGateway, input })
//
// Three properties drive every assertion here, and each one exists because its
// opposite is a silent, publishable lie:
//
//   1. An EMPTY window and a FAILED window must never be the same result. Every
//      failure path below is asserted to produce complete:false, not [].
//   2. The collector may only reach the network through `auditGateway.callCapability`.
//      The fake gateway exposes a `call` that throws, so a raw-path read is a test
//      failure rather than a code-review finding.
//   3. Nothing is timed, random, or wall-clocked. Capture times come from the gateway
//      (as they do in production - audit-gateway.mjs returns meta.capturedAt), so a
//      collector reaching for Date.now() fails the determinism test at the bottom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AUDIT_CAPABILITIES } from '../core/audit-capabilities.mjs';
import { makeAuditCircuit } from '../core/audit-gateway.mjs';
// The REAL contract boundary, not a stand-in for it. The definition-hash test below has to
// scrub exactly the way a shipped response does, so it calls the same `ok()` core/tools.mjs
// calls; a local copy of the scrub would prove only that the copy agreed with itself.
import { ok } from '../core/errors.mjs';
import { TOOLS, makeGatewayFactory, processAuditPacing } from '../core/tools.mjs';
import {
  AUDIT_CAPABILITY_VERSION,
  RUNTIME_WINDOW_CAPABILITY_IDS,
  RUNTIME_WINDOW_DEFAULTS,
  collectWorkflowRuntimeWindow,
  resolveRuntimeWindowDescriptors,
} from '../core/workflow-runtime-window.mjs';

const LOC = 'LOC1';
const WF = 'wf-1';
const CAPTURED_AT = '2026-07-24T00:00:00.000Z';
const LOG_PAGE_SIZE = 100;       // RUNTIME_WINDOW_DEFAULTS.logPageSize; bounded 1..5000
const STEP_PAGE_SIZE = 50;       // details-by-step numericQueryBounds.limit max

// An INDEPENDENT fixture input, not a figure derived from the rows the stub is about to
// serve. The harness used to compute the reported enrollment total from the very roster it
// then returned, which made total-vs-roster reconciliation unfailable by construction:
// every `complete:true` in every fixture rested on a check that could not have fired. This
// is what a real totals route reports — the workflow's ALL-TIME figure, unrelated to the
// window-filtered roster sitting next to it.
const DECLARED_ALL_TIME_ENROLLMENT_TOTAL = 500;

// The warning vocabulary this contract requires. Anything the collector emits must be
// one of these: a free-text warning cannot be branched on by the auditor, and a code
// nobody agreed on is how two components end up disagreeing about what "incomplete" meant.
const WARNING_CODES = Object.freeze([
  'LOG_DUPLICATE_ID_CONFLICT',
  'LOG_EVENT_TIMESTAMP_UNPARSEABLE',
  'LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE',
  'LOG_EVENT_ID_MISSING',
  'LOG_PAGE_BUDGET_EXHAUSTED',
  'LOG_CURSOR_UNUSABLE',
  // The enrollment/step-roster twins of LOG_EVENT_ID_MISSING. Rows on those two routes were
  // keyed by content alone, so two identical id-less rows in one page silently became one.
  'ENROLLMENT_ROW_ID_MISSING',
  'STEP_ROSTER_ROW_ID_MISSING',
  'ENROLLMENT_CURSOR_MISSING',
  'ENROLLMENT_CURSOR_REPEATED',
  'ENROLLMENT_NO_UNIQUE_PROGRESS',
  'ENROLLMENT_PAGE_BUDGET_EXHAUSTED',
  'ENROLLMENT_TOTAL_MISMATCH',
  'ENROLLMENT_TOTALS_UNAVAILABLE',
  'STEP_ROSTER_PAGE_BUDGET_EXHAUSTED',
  'STEP_ROSTER_UNSEALED',
  'IDENTITY_CONFLICT_QUARANTINE',
  'IDENTITY_INSPECTION_INCOMPLETE',
  'COMPONENT_READ_FAILED',
  'RATE_LIMITED',
  'CIRCUIT_OPEN',
]);

// The plan's exact result object, lines 452-481. Asserted as a SET so a field cannot be
// quietly dropped (a missing `truncated` reads as falsy = "nothing was cut") or a private
// scratch field leaked into a published audit artifact.
// `componentCompleteness` and `configurationBinding` are ADDITIONS to the plan's field
// list, and both exist because the plan's shape could not express something true:
//   - runtimeEvents must stay an array to be usable, so it cannot say "not read" by being
//     null the way every sibling does. It published [] on a total read failure, which is
//     the exact empty-versus-failed collapse this module exists to prevent.
//   - workflowDefinition.validity.appliesToRequestedWindow is 'unproven' on EVERY run (no
//     version-history capability exists), so it coexisted permanently with complete:true.
//     Folding it into `complete` would pin `complete` to false forever; it needs its own
//     axis, and Task 11 consumes it as a publication gate.
const RESULT_KEYS = Object.freeze([
  'appliedQueries', 'appliedWindow', 'boundLocationId', 'capabilityVersion', 'capturedAt',
  'complete', 'componentCompleteness', 'configurationBinding', 'contractVersion',
  'enrollmentTotals', 'enrollments', 'filters',
  'locationBinding', 'pagination', 'perStepCounts', 'rateLimit', 'requestedWindow',
  'runtimeEvents', 'observedEventTypes', 'sourceRoutes', 'stepRosters', 'truncated', 'warnings',
  'workflowDefinition', 'workflowId',
]);

// Concrete paths, so `sourceRoutes` can be checked against something real rather than
// against whatever the collector happens to echo back.
const CAPABILITY_PATHS = Object.freeze({
  workflow_detail: `/workflow/${LOC}/${WF}`,
  workflow_triggers: `/workflow/${LOC}/trigger`,
  workflow_sticky_notes: '/workflows/sticky-notes-all',
  workflow_execution_logs: '/workflows/logs/v2',
  workflow_count_per_step: '/workflows/status/search/count-per-step',
  workflow_enrollment_search: '/workflows/status/search/workflow-with-filter',
  workflow_step_details: '/workflows/status/search/details-by-step',
  workflow_enroll_stats_cache: '/workflows/status/search/enroll-stats-cache',
  workflow_enroll_stats: '/workflows/status/enroll-stats',
});

const DEFAULT_DEFINITION = Object.freeze({
  workflow: {
    _id: WF,
    name: 'Runtime WF',
    status: 'published',
    version: 7,
    workflowData: { templates: [{ id: 'step-1' }, { id: 'step-2' }] },
  },
  triggers: { triggers: [{ id: 'trg-1', type: 'contact_created' }] },
  stickyNotes: { data: [{ id: 'note-1', text: 'note' }], count: 1 },
});

const DEFAULT_COUNTS = Object.freeze({
  counts: [{ stepId: 'step-1', count: 3 }, { stepId: 'step-2', count: 1 }],
});

// --- fixtures -----------------------------------------------------------------

const loadFixture = (file) => JSON.parse(
  readFileSync(new URL(`./fixtures/runtime-window/${file}.json`, import.meta.url), 'utf8'),
);
const LOG_FIXTURES = loadFixture('execution-log-windows');
const ENROLLMENT_FIXTURES = loadFixture('enrollment-walk');
const ROSTER_FIXTURES = loadFixture('step-roster-and-totals');
const IDENTITY_FIXTURES = loadFixture('identity-binding');
const ALL_FIXTURES = [LOG_FIXTURES, ENROLLMENT_FIXTURES, ROSTER_FIXTURES, IDENTITY_FIXTURES];

const scenario = (fixture, name) => {
  const found = fixture.scenarios[name];
  assert.ok(found, `missing fixture scenario ${name}`);
  return found;
};

// `{ generate: {...} }` expands to N rows so a 20-row page costs one readable line.
const expandRows = (specs) => specs.flatMap((spec) => {
  if (!spec?.generate) return [spec];
  const { count, idPrefix, tStart = 0, tStep = 0 } = spec.generate;
  // `createdAt` is emitted as well as `startedExecutionAt` because the CURSOR needs it:
  // `referenceCreatedAt` is load-bearing upstream, and a row that cannot supply it stalls
  // the walk. Live rows from this endpoint carry `createdAt` and, in fact, never carry
  // `startedExecutionAt` at all.
  return Array.from({ length: count }, (_, i) => ({
    _id: `${idPrefix}${i}`,
    _t: tStart + (i * tStep),
    createdAt: tStart + (i * tStep),
    startedExecutionAt: tStart + (i * tStep),
  }));
});

const expandEnrollmentPage = (page) => {
  const generated = page.generate
    ? Array.from({ length: page.generate.count }, (_, i) => ({
      _id: `${page.generate.idPrefix}${i}`,
      contactId: `${page.generate.idPrefix}c${i}`,
      createdAt: page.generate.createdAtStart + i,
      sid: `${page.generate.sidPrefix}${i}`,
      sequence: page.generate.sequenceStart + i,
    }))
    : [];
  return [...generated, ...(page.rows ?? [])];
};

const expandContactRows = (page) => (page.generate
  ? Array.from({ length: page.generate.count }, (_, i) => ({
    _id: `${page.generate.idPrefix}${i}`,
    contactId: `${page.generate.idPrefix}c${i}`,
  }))
  : (page.rows ?? []));

const rowKey = (row) => row?._id ?? row?.id ?? JSON.stringify(row);

// --- canonical hashing (the contract the collector must mirror) ----------------

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const sha256Canonical = (value) => createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

// --- the fake audit gateway ----------------------------------------------------

const baseIdentity = (over = {}) => ({
  bindingMethod: 'request_scope',
  checked: [],
  conflicts: [],
  unreadable: [],
  inspectionCapped: false,
  depthCapped: false,
  ...over,
});

function makeFakeAuditGateway(spec, { locationId = LOC } = {}) {
  const calls = [];
  const counters = new Map();
  let rawCallAttempts = 0;

  const definition = { ...DEFAULT_DEFINITION, ...(spec.definition ?? {}) };
  const descending = spec.order === 'desc';
  // Fixed, not Date.now(): the default-window path must be reproducible byte-for-byte, and
  // this module's whole contract is that two identical runs produce identical results.
  const defaultWindowNow = spec.defaultWindowNow ?? 4_000;
  const corpus = expandRows(spec.corpus ?? []);
  const streams = spec.streams ?? null;
  const enrollmentPages = (spec.enrollment?.pages ?? []).map(expandEnrollmentPage);
  const stepDetails = spec.stepDetails ?? {};
  const overrides = spec.overrides ?? [];
  const identityOver = spec.identity ?? {};

  // A scenario that does not pin its own totals gets the fixed all-time figure above,
  // NEVER a number derived from the rows this stub is about to serve. See
  // DECLARED_ALL_TIME_ENROLLMENT_TOTAL.
  const declaredTotal = DECLARED_ALL_TIME_ENROLLMENT_TOTAL;
  const statsCache = spec.statsCache ?? [{ workflowId: WF, total: declaredTotal, finished: 0 }];
  const legacyStats = spec.stats ?? { workflowId: WF, total: declaredTotal, finished: 0 };

  // THE LOG STUB MODELS THE REAL ENDPOINT, INCLUDING ITS TRAPS. Three properties are
  // deliberate, and each one exists because the live server has it:
  //
  //   1. **The window only applies when `dateType=custom` is present.** Without it the real
  //      server discards `fromDate`/`toDate` and serves its own recent-slice default. The
  //      previous stub filtered by time unconditionally, which is precisely why the whole
  //      fixture suite agreed with a collector that could never work: it simulated a server
  //      that windows when asked, and the real one does not.
  //   2. **Bounds are INCLUSIVE on both ends** (measured to the exact millisecond), so the
  //      collector's own half-open retention stays observable — a row at exactly `toDate`
  //      comes back over the wire and must be dropped locally.
  //   3. **Cursor pages re-serve the reference row.** Every `action=next` page begins with
  //      the row the cursor pointed at, so a collector that does not dedupe double-counts
  //      every boundary, and one that waits for an empty page never terminates.
  const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const logsBody = (query) => {
    const windowed = query.dateType === 'custom';
    const from = windowed ? Number(query.fromDate) : (defaultWindowNow - DEFAULT_WINDOW_MS);
    const to = windowed ? Number(query.toDate) : defaultWindowNow;
    const source = query.eventType === undefined
      ? corpus
      : expandRows(streams?.[query.eventType] ?? []);
    const timed = [];
    const untimed = [];
    source.forEach((row, index) => {
      const t = row._t;
      if (t === null || t === undefined) untimed.push({ row, index });
      else if (t >= from && t <= to) timed.push({ row, index });
    });
    timed.sort((a, b) => (a.row._t - b.row._t) || (a.index - b.index));
    if (descending) timed.reverse();
    // Undatable rows lead rather than trail. Their position is arbitrary — they carry no
    // orderable key — but trailing them made every page END on a row that cannot supply the
    // cursor reference, which is its own (separately covered) scenario rather than a
    // property of "a row had no timestamp".
    const ordered = [...untimed, ...timed];

    // Cursor: resume AT the reference row (inclusive) so it is re-served, exactly as the
    // live endpoint does. `referenceCreatedAt` is load-bearing upstream; a request carrying
    // only `referenceId` re-serves page 1, which this reproduces by ignoring the cursor.
    let start = 0;
    if (query.action === 'next' && query.referenceId !== undefined && query.referenceCreatedAt !== undefined) {
      const at = ordered.findIndex(({ row }) => String(row._id ?? row.id) === String(query.referenceId));
      if (at >= 0) start = at;
    }
    const page = ordered
      .slice(start, start + Number(query.limit))
      .map(({ row }) => {
        const { _t, ...rest } = row;
        return rest;
      });
    return { logs: page };
  };

  const enrollmentBody = (nth) => ({ rows: enrollmentPages[nth - 1] ?? [] });

  const stepDetailsBody = (query) => {
    const stepSpec = stepDetails[String(query.currentStepId)];
    if (!stepSpec) return { totalCount: 0, rows: [] };
    const contacts = (stepSpec.pages ?? []).flatMap(expandContactRows);
    const skip = Number(query.skip);
    const limit = Number(query.limit);
    return { totalCount: stepSpec.totalCount, rows: contacts.slice(skip, skip + limit) };
  };

  const bodyFor = (capabilityId, query, nth) => {
    switch (capabilityId) {
      case 'workflow_detail': return definition.workflow;
      case 'workflow_triggers': return definition.triggers;
      case 'workflow_sticky_notes': return definition.stickyNotes;
      case 'workflow_execution_logs': return logsBody(query);
      case 'workflow_count_per_step': return spec.countPerStep ?? DEFAULT_COUNTS;
      case 'workflow_enrollment_search': return enrollmentBody(nth);
      case 'workflow_step_details': return stepDetailsBody(query);
      case 'workflow_enroll_stats_cache': return statsCache;
      case 'workflow_enroll_stats': return legacyStats;
      default: throw new Error(`UNSTUBBED_CAPABILITY: ${capabilityId}`);
    }
  };

  return {
    locationId,
    calls,
    get rawCallAttempts() { return rawCallAttempts; },
    // audit-gateway.mjs returns exactly `{ callCapability, locationId }` - there is no raw
    // `call` passthrough by design. This one exists purely to catch a collector that
    // reaches for one anyway.
    call() {
      rawCallAttempts += 1;
      throw new Error('RAW_CALL_FORBIDDEN: audit reads must go through callCapability');
    },
    async callCapability(args) {
      assert.ok(args && typeof args === 'object', 'callCapability takes an options object');
      // Task 2 carry-forward item 7: forwarding a caller-supplied descriptor set to the
      // gateway is a runtime policy bypass. A composite must never send one.
      assert.equal(
        Object.hasOwn(args, 'descriptors'), false,
        'a composite must never forward a `descriptors` list to the audit gateway',
      );
      const { capabilityId, typedBindings = {}, query = {}, method = 'GET' } = args;
      assert.equal(method, 'GET', 'the audit rail is GET-only');
      const nth = (counters.get(capabilityId) ?? 0) + 1;
      counters.set(capabilityId, nth);
      calls.push({
        capabilityId,
        method,
        nth,
        typedBindings: { ...typedBindings },
        query: { ...query },
      });

      const override = overrides.find((o) => o.capabilityId === capabilityId && o.nth === nth);
      if (override?.throwCode) {
        const error = new Error(`${override.throwCode}: injected by fixture`);
        error.code = override.throwCode;
        error.detail = 'injected by fixture';
        error.remediation = 'Stop the run and resume from the last checkpoint.';
        if (override.meta) error.meta = override.meta;
        if (override.retryAfterMs !== undefined) error.retryAfterMs = override.retryAfterMs;
        throw error;
      }

      // json and identity are pulled out of the override so a PARTIAL identity override
      // (the common case in the fixtures) merges onto the full gateway-shaped block
      // instead of replacing it with a half-populated one.
      const overrideResponse = override?.response ?? {};
      const { json: overrideJson, identity: overrideIdentity, ...restOverride } = overrideResponse;
      const json = Object.hasOwn(overrideResponse, 'json')
        ? overrideJson
        : bodyFor(capabilityId, query, nth);
      const identity = baseIdentity({ ...identityOver, ...(overrideIdentity ?? {}) });
      return {
        capabilityId,
        host: 'backend',
        appliedPath: CAPABILITY_PATHS[capabilityId],
        appliedQuery: { ...query },
        status: 200,
        ok: true,
        json,
        identity,
        quarantined: false,
        failureClass: null,
        retryAfterMs: null,
        capturedAt: CAPTURED_AT,
        ...restOverride,
      };
    },
  };
}

const runScenario = async (spec, extraInput = {}) => {
  const gateway = makeFakeAuditGateway(spec);
  const input = { locationId: LOC, workflowId: WF, ...(spec.input ?? {}), ...extraInput };
  const result = await collectWorkflowRuntimeWindow({ auditGateway: gateway, input });
  return { gateway, result, input };
};

// --- assertion vocabulary shared by the fixture-driven tests -------------------

const callsTo = (gateway, capabilityId) => gateway.calls.filter((c) => c.capabilityId === capabilityId);
const warningCodesOf = (result) => [...new Set((result.warnings ?? []).map((w) => w.code))].sort();

// ONE warning shape, whatever emitted it. The collector has two emitters (a plain one and
// an aggregating one) plus four codes that dedup by their own guards, and a consumer of
// `warnings` cannot see which of them fired. If the key set varied by emitter, `w.occurrences
// > 1` would read false for a genuine single firing AND for a missing field alike, and
// summing the field would be NaN from the first plain warning onward — a silent
// mishandling of every warning that happened not to come from the aggregator.
const WARNING_KEYS = Object.freeze(['code', 'component', 'detail', 'detailSamples', 'occurrences']);

const assertUniformWarningShape = (result, context = 'result') => {
  for (const [index, warning] of (result.warnings ?? []).entries()) {
    assert.deepEqual(
      Object.keys(warning).sort(), [...WARNING_KEYS].sort(),
      `${context}.warnings[${index}] (${warning.code}) has a different key set from every other warning`,
    );
    assert.ok(Number.isSafeInteger(warning.occurrences) && warning.occurrences >= 1,
      `${context}.warnings[${index}] (${warning.code}) must carry a real occurrence count, got ${warning.occurrences}`);
    assert.ok(Array.isArray(warning.detailSamples) && warning.detailSamples.length >= 1,
      `${context}.warnings[${index}] (${warning.code}) must carry at least the detail it reported`);
    assert.equal(warning.detailSamples[0], warning.detail,
      `${context}.warnings[${index}] (${warning.code}): detail must stay the first occurrence's text`);
  }
};
const eventIdsOf = (result) => (result.runtimeEvents ?? [])
  .map((e) => e.id)
  .filter((id) => id !== null && id !== undefined)
  .map(String)
  .sort();

function assertExpectations(result, gateway, expected) {
  const has = (key) => Object.hasOwn(expected, key);

  if (has('logQueryWindows')) {
    assert.deepEqual(
      callsTo(gateway, 'workflow_execution_logs').map((c) => [Number(c.query.fromDate), Number(c.query.toDate)]),
      expected.logQueryWindows,
      'the emitted log query windows do not match',
    );
  }
  if (has('logQueryActions')) {
    assert.deepEqual(
      callsTo(gateway, 'workflow_execution_logs').map((c) => c.query.action),
      expected.logQueryActions,
      'the cursor action sequence does not match',
    );
  }
  if (has('logQueryEventTypes')) {
    assert.deepEqual(
      callsTo(gateway, 'workflow_execution_logs').map((c) => c.query.eventType),
      expected.logQueryEventTypes,
    );
  }
  if (has('eventIds')) assert.deepEqual(eventIdsOf(result), expected.eventIds);
  if (has('eventCount')) assert.equal(result.runtimeEvents.length, expected.eventCount);
  if (has('eventTimestamps')) {
    assert.deepEqual(result.runtimeEvents.map((e) => e.timestamp), expected.eventTimestamps);
  }
  // The receipt must state the expansion it ACTUALLY applied. Reporting expansionMs:1
  // while Math.max(0, fromDate - 1) clamped it away at fromDate 0 was an internally
  // contradictory receipt, and it hid the only window where the clamp can lose an event.
  if (has('expansionMs')) assert.equal(result.appliedWindow.expansionMs, expected.expansionMs);
  if (has('appliedFromDate')) assert.equal(result.appliedWindow.fromDate, expected.appliedFromDate);
  if (has('definitionCanonicalHashNull')) {
    assert.equal(result.workflowDefinition.canonicalHash, null,
      'a definition that did not read cleanly must not produce a hash shaped like a complete one');
  }
  if (has('complete')) assert.equal(result.complete, expected.complete);
  if (has('truncated')) assert.equal(result.truncated, expected.truncated);
  if (has('warningCodes')) assert.deepEqual(warningCodesOf(result), [...expected.warningCodes].sort());
  if (has('logPages')) {
    for (const [key, value] of Object.entries(expected.logPages)) {
      assert.equal(result.pagination.logPages[key], value, `pagination.logPages.${key}`);
    }
  }
  if (has('enrollmentActions')) {
    assert.deepEqual(callsTo(gateway, 'workflow_enrollment_search').map((c) => c.query.action), expected.enrollmentActions);
  }
  if (has('enrollmentPages')) assert.equal(result.pagination.enrollmentPages.fetched, expected.enrollmentPages);
  if (has('enrollmentCount')) assert.equal(result.enrollments.rows.length, expected.enrollmentCount);
  if (has('enrollmentComplete')) assert.equal(result.enrollments.complete, expected.enrollmentComplete);
  if (has('rateLimited')) assert.equal(result.rateLimit.limited, expected.rateLimited);
  if (has('retryAfterMs')) assert.equal(result.rateLimit.retryAfterMs, expected.retryAfterMs);
  if (has('stepRosterSkips')) {
    assert.deepEqual(callsTo(gateway, 'workflow_step_details').map((c) => Number(c.query.skip)), expected.stepRosterSkips);
  }
  if (has('stepRosterPages')) assert.equal(result.pagination.stepRosterPages.fetched, expected.stepRosterPages);
  if (has('stepRosterCalls')) assert.equal(callsTo(gateway, 'workflow_step_details').length, expected.stepRosterCalls);
  if (has('stepRosterContacts')) {
    for (const [stepId, count] of Object.entries(expected.stepRosterContacts)) {
      const roster = result.stepRosters.find((r) => r.stepId === stepId);
      assert.ok(roster, `no roster collected for ${stepId}`);
      assert.equal(roster.contacts.length, count);
    }
  }
  if (has('stepRosterComplete')) {
    for (const [stepId, complete] of Object.entries(expected.stepRosterComplete)) {
      assert.equal(result.stepRosters.find((r) => r.stepId === stepId)?.complete, complete);
    }
  }
  if (has('stepRosterTotals')) {
    for (const [stepId, total] of Object.entries(expected.stepRosterTotals)) {
      assert.equal(result.stepRosters.find((r) => r.stepId === stepId)?.total, total);
    }
  }
  if (has('stepRosterContactsNull')) {
    for (const stepId of expected.stepRosterContactsNull) {
      // A roster that was never read carries null, not []: an empty array is a claim that
      // the step holds nobody, which is the module's own "empty is not failed" doctrine.
      assert.equal(result.stepRosters.find((r) => r.stepId === stepId)?.contacts, null);
    }
  }
  if (has('statsSource')) assert.equal(result.enrollmentTotals.source, expected.statsSource);
  if (has('enrollmentTotal')) assert.equal(result.enrollmentTotals.total, expected.enrollmentTotal);
  if (has('enrollmentTotalsScope')) assert.equal(result.enrollmentTotals.scope, expected.enrollmentTotalsScope);
  if (has('enrollmentWindowScoped')) assert.equal(result.enrollments.windowScoped, expected.enrollmentWindowScoped);
  if (has('legacyStatsCalls')) assert.equal(callsTo(gateway, 'workflow_enroll_stats').length, expected.legacyStatsCalls);
  if (has('bindingMethod')) assert.equal(result.locationBinding.bindingMethod, expected.bindingMethod);
  if (has('quarantined')) assert.equal(result.locationBinding.quarantined, expected.quarantined);
  if (has('inspectionIncomplete')) assert.equal(result.locationBinding.inspectionIncomplete, expected.inspectionIncomplete);
  if (has('perStepCountsNull')) assert.equal(result.perStepCounts, null);
  if (has('componentCompleteness')) {
    for (const [component, isComplete] of Object.entries(expected.componentCompleteness)) {
      assert.equal(result.componentCompleteness[component], isComplete, `componentCompleteness.${component}`);
    }
  }

  // UNIVERSAL: every execution-log query carries `dateType=custom`, and none carries
  // `actionType`. Asserted on EVERY scenario rather than in one dedicated test, because
  // dropping the mode switch is the regression that silently returns a 30-day default
  // instead of the requested window — a 200 with plausible rows and no error anywhere.
  for (const call of callsTo(gateway, 'workflow_execution_logs')) {
    assert.equal(call.query.dateType, 'custom',
      'a log query went out without dateType=custom, so its window would be silently ignored');
    assert.equal(Object.hasOwn(call.query, 'actionType'), false,
      'actionType is deliberately undeclared: its value enum is unknown and a wrong value returns a silent empty page');
    // A cursor page must carry BOTH reference halves or none. The id alone re-serves the
    // same page forever, with no error to notice.
    const hasId = Object.hasOwn(call.query, 'referenceId');
    const hasAt = Object.hasOwn(call.query, 'referenceCreatedAt');
    assert.equal(hasId, hasAt, 'a half-reference cursor cannot advance and must never be sent');
  }

  // Universal invariants, checked on every scenario rather than per-fixture: an
  // unrecognised warning code cannot be branched on, and "incomplete" must always be
  // accompanied by a stated reason.
  for (const warning of result.warnings ?? []) {
    assert.ok(WARNING_CODES.includes(warning.code), `unknown warning code ${warning.code}`);
  }
  // …and an unrecognised warning SHAPE cannot be branched on either. Checked here so every
  // fixture-driven scenario in the file contributes coverage of it, not only the dedicated
  // test below.
  assertUniformWarningShape(result);
  if (result.complete === false) {
    assert.ok(result.warnings.length > 0, 'an incomplete result must say why');
  }
  // A throttle is an incompleteness input in its own right, whichever route trips it. It
  // used to depend on the tripping component happening to warn, so a LOCATION_RATE_LIMITED
  // 200 on the one read whose failure was never routed through warnForFailure produced a
  // complete window with rateLimit.limited:true sitting inside it.
  if (result.rateLimit.limited === true) {
    assert.equal(result.complete, false, 'a throttled run may not be published as complete');
  }
  // The per-component markers are not decoration: a window may only be complete if every
  // component it reports actually read. Without this, `runtimeEvents: []` after a total log
  // failure could sit under `complete:true` again.
  if (result.complete === true) {
    for (const [component, isComplete] of Object.entries(result.componentCompleteness)) {
      assert.equal(isComplete, true, `complete:true with an incomplete ${component} component`);
    }
  }
  // The configuration-to-runtime binding is unproven on every run and must never be
  // upgraded by a component that happened to read cleanly.
  assert.equal(result.configurationBinding.definitionGovernedRuntimeEvents, 'unproven');
  assert.equal(result.configurationBinding.publishableAsGoverning, false);
}

// Registers one test per fixture scenario so a failure names the plan bullet it broke.
function registerFixtureSuite(fixture, label) {
  for (const [name, spec] of Object.entries(fixture.scenarios)) {
    test(`${label}: ${name} [${spec.planBullet}]`, async () => {
      const { gateway, result } = await runScenario(spec);
      assertExpectations(result, gateway, spec.expect);
      assert.equal(gateway.rawCallAttempts, 0, 'the collector must not use a raw call path');
    });
  }
}

registerFixtureSuite(LOG_FIXTURES, 'execution log window');
registerFixtureSuite(ENROLLMENT_FIXTURES, 'enrollment walk');
registerFixtureSuite(ROSTER_FIXTURES, 'step roster and totals');
registerFixtureSuite(IDENTITY_FIXTURES, 'identity binding');

test('every fixture scenario names the plan bullet it covers and why it exists', () => {
  let counted = 0;
  for (const fixture of ALL_FIXTURES) {
    for (const [name, spec] of Object.entries(fixture.scenarios)) {
      assert.equal(typeof spec.planBullet, 'string', `${name} has no planBullet`);
      assert.ok(spec.planBullet.length > 0, `${name} has an empty planBullet`);
      assert.ok(String(spec.why ?? '').length > 20, `${name} does not say why it exists`);
      assert.ok(spec.expect && typeof spec.expect === 'object', `${name} asserts nothing`);
      counted += 1;
    }
  }
  assert.ok(counted >= 40, `expected at least 40 scenarios, found ${counted}`);
});

// --- input validation, before any gateway work --------------------------------

const rejectingGateway = () => ({
  locationId: LOC,
  calls: [],
  call() { throw new Error('RAW_CALL_FORBIDDEN'); },
  async callCapability() { throw new Error('VALIDATION_MUST_PRECEDE_ANY_READ'); },
});

async function assertRejectedBeforeAnyRead(input) {
  const gateway = makeFakeAuditGateway({ corpus: [] });
  await assert.rejects(
    () => collectWorkflowRuntimeWindow({ auditGateway: gateway, input: { locationId: LOC, workflowId: WF, ...input } }),
    (error) => {
      assert.equal(error.code, 'INVALID_RUNTIME_WINDOW', `expected INVALID_RUNTIME_WINDOW, got ${error.code}`);
      assert.equal(typeof error.remediation, 'string');
      return true;
    },
  );
  assert.equal(gateway.calls.length, 0, 'window validation must precede every read');
}

test('an inverted or empty window is rejected before any read', async () => {
  // Plan line 381. The gateway descriptors carry NO numericQueryBounds on fromDate/toDate
  // (Task 2 carry-forward item 1), so nothing downstream will catch this - and an inverted
  // window that reaches the wire returns SOMETHING, which would be recorded as evidence.
  await assertRejectedBeforeAnyRead({ fromDate: 2000, toDate: 1000 });
  await assertRejectedBeforeAnyRead({ fromDate: 1000, toDate: 1000 });
});

test('a non-integer, negative or non-finite window bound is rejected before any read', async () => {
  for (const input of [
    { fromDate: 1.5, toDate: 2000 },
    { fromDate: 0, toDate: 2000.25 },
    { fromDate: -1, toDate: 2000 },
    { fromDate: 0, toDate: -5 },
    { fromDate: Number.NaN, toDate: 2000 },
    { fromDate: 0, toDate: Number.POSITIVE_INFINITY },
    { fromDate: '0', toDate: 2000 },
    { fromDate: 0, toDate: null },
    { fromDate: undefined, toDate: 2000 },
  ]) {
    await assertRejectedBeforeAnyRead(input);
  }
});

test('every retired partition input is REFUSED, never silently ignored', async () => {
  // The lesson of this whole rewrite, applied to the collector's own front door. A
  // parameter that is accepted and does nothing is indistinguishable, from the caller's
  // side, from one that works — which is exactly how `fromDate` sat on this endpoint doing
  // nothing for months. A caller still passing `maxLogPartitions` holds a belief about how
  // completeness is reached here, and that belief is now wrong.
  for (const retired of ['pageSize', 'maxLogPartitions', 'minPartitionMs']) {
    await assertRejectedBeforeAnyRead({ fromDate: 0, toDate: 1000, [retired]: 20 });
  }
});

test('logPageSize is caller-selectable within the range that was measured', async () => {
  // Bounded, not pinned. `pageSize` had to be pinned because the OLD completeness test — "a
  // short page is terminal" — was an argument about one page size. The cursor's test ("a
  // page contributed no new ids") is sound at every page size.
  await assertRejectedBeforeAnyRead({ fromDate: 0, toDate: 1000, logPageSize: 5001 });
  await assertRejectedBeforeAnyRead({ fromDate: 0, toDate: 1000, logPageSize: 0 });
  const { gateway } = await runScenario({ input: { fromDate: 1000, toDate: 2000, logPageSize: 5000 }, corpus: [] });
  assert.equal(Number(callsTo(gateway, 'workflow_execution_logs')[0].query.limit), 5000);
});

test('a missing location or workflow id is rejected before any read', async () => {
  const gateway = rejectingGateway();
  for (const input of [
    { locationId: '', workflowId: WF, fromDate: 0, toDate: 1 },
    { locationId: LOC, workflowId: '', fromDate: 0, toDate: 1 },
  ]) {
    await assert.rejects(() => collectWorkflowRuntimeWindow({ auditGateway: gateway, input }));
  }
});

// --- the shape of the result ---------------------------------------------------

const happy = () => ({
  input: { fromDate: 1000, toDate: 2000, stepIds: ['step-1'] },
  corpus: [
    { _id: 'ev-1', _t: 1100, startedExecutionAt: 1100, eventType: 'added_to_workflow' , createdAt: 1100 },
    { _id: 'ev-2', _t: 1200, startedExecutionAt: 1200, eventType: 'email' , createdAt: 1200 },
  ],
  enrollment: { pages: [{ rows: [{ _id: 'enr-1', contactId: 'c1', createdAt: 1, sid: 's1', sequence: 1 }] }] },
  stepDetails: { 'step-1': { totalCount: 2, pages: [{ rows: [{ _id: 'r1', contactId: 'c1' }, { _id: 'r2', contactId: 'c2' }] }] } },
});

test('the result carries exactly the plan-specified fields and contract version', async () => {
  const { result } = await runScenario(happy());
  assert.deepEqual(Object.keys(result).sort(), [...RESULT_KEYS].sort());
  assert.equal(result.contractVersion, '2.0.0');
  assert.equal(result.boundLocationId, LOC);
  assert.equal(result.workflowId, WF);
  assert.equal(result.capturedAt, CAPTURED_AT, 'capture time must come from the reads, not a wall clock');
  assert.equal(typeof result.capabilityVersion, 'string');
  assert.ok(result.capabilityVersion.length > 0);
});

test('the applied window equals the requested one and records that the SERVER filtered it', async () => {
  const { result } = await runScenario(happy());
  assert.deepEqual(result.requestedWindow, { fromDate: 1000, toDate: 2000, boundaries: '[)' });
  // No expansion. The old one-millisecond lower-bound nudge hedged against undocumented
  // upstream boundary semantics; those are measured now — both bounds inclusive on
  // `createdAt` — so the server is asked for exactly the window that was requested and the
  // half-open filter is applied locally on top.
  assert.equal(result.appliedWindow.fromDate, 1000);
  assert.equal(result.appliedWindow.toDate, 2000);
  assert.equal(result.appliedWindow.analyticalFilter, '[)');
  assert.equal(result.appliedWindow.dateType, 'custom');
  assert.equal(result.appliedWindow.serverFiltered, true);
  assert.equal(Object.hasOwn(result.appliedWindow, 'expansionMs'), false,
    'there is no upstream expansion left to report');
});

test('epoch zero is an ORDINARY lower bound, with no clamp and no warning', async () => {
  // This test used to assert the opposite. The collector expanded every window by a
  // millisecond at the lower bound; `Math.max(0, fromDate - 1)` clamped that away at epoch
  // 0, so a fromDate:0 window was declared incomplete because a row at exactly t=0 could
  // not be proven present. The hedge is gone with its subject: upstream bounds are
  // INCLUSIVE (measured to the millisecond), so a row sitting exactly on fromDate arrives
  // and is retained by the local `>=` test, at every fromDate including 0.
  const { gateway, result } = await runScenario({
    input: { fromDate: 0, toDate: 500 },
    corpus: [{ _id: 'at-zero', _t: 0, createdAt: 0, startedExecutionAt: 0 }],
  });
  assert.equal(result.appliedWindow.fromDate, 0);
  assert.deepEqual(result.runtimeEvents.map((e) => e.id), ['at-zero']);
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
  for (const call of callsTo(gateway, 'workflow_execution_logs')) {
    assert.equal(Number(call.query.fromDate), 0, 'the raw bound goes out unexpanded');
  }
});

test('the collector reads capabilities in one fixed order, definition first', async () => {
  // Definition first is not cosmetic: the step roster's optional seal (discoveredStepIds)
  // is derived from the definition, so a roster read issued before it would be unsealed.
  const { gateway } = await runScenario(happy());
  assert.deepEqual(gateway.calls.map((c) => c.capabilityId), [
    'workflow_detail',
    'workflow_triggers',
    'workflow_sticky_notes',
    // TWO log reads, not one: page 1 opens the cursor and page 2 CONFIRMS it is exhausted.
    // The confirming read is deliberate — inferring "that was everything" from a short page
    // is exactly the reasoning that published 37 of 433 rows as a complete window.
    'workflow_execution_logs',
    'workflow_execution_logs',
    'workflow_count_per_step',
    'workflow_enrollment_search',
    'workflow_step_details',
    'workflow_enroll_stats_cache',
  ]);
});

test('every read is typed with the bound location and workflow', async () => {
  const { gateway } = await runScenario(happy());
  for (const call of gateway.calls) {
    assert.equal(call.typedBindings.locationId, LOC, `${call.capabilityId} lost its typed location`);
    assert.equal(call.typedBindings.workflowId, WF, `${call.capabilityId} lost its typed workflow`);
  }
});

test('appliedQueries and sourceRoutes record every read, in order', async () => {
  const { gateway, result } = await runScenario(happy());
  assert.deepEqual(
    result.appliedQueries,
    gateway.calls.map((c) => ({ capabilityId: c.capabilityId, query: c.query })),
  );
  assert.equal(result.sourceRoutes.length, gateway.calls.length);
  assert.deepEqual(result.sourceRoutes[0], {
    capabilityId: 'workflow_detail',
    // The gateway resolves the HOST as well as the path (backend vs services rail) and it
    // was being dropped, so a receipt reader could not tell which rail answered — plan line
    // 447 asks for the EXACT source routes.
    host: 'backend',
    appliedPath: CAPABILITY_PATHS.workflow_detail,
    appliedQuery: result.appliedQueries[0].query,
    status: 200,
    ok: true,
    failureClass: null,
    capturedAt: CAPTURED_AT,
  });
});

test('filters echo what was asked for and are forwarded to both runtime routes', async () => {
  const { gateway, result } = await runScenario(happy(), { contactId: 'c9' });
  assert.deepEqual(result.filters, { contactId: 'c9', eventTypes: [], stepIds: ['step-1'] });
  for (const capabilityId of ['workflow_execution_logs', 'workflow_enrollment_search']) {
    for (const call of callsTo(gateway, capabilityId)) {
      assert.equal(call.query.contactId, 'c9', `${capabilityId} dropped the contact filter`);
    }
  }
});

test('the enrollment roster is filtered by the REQUESTED window, not the expanded one', async () => {
  // The 1ms expansion is a property of the log partition walk (it exists because
  // /workflows/logs/v2 boundary semantics are unproven). Leaking it into the roster query
  // would silently widen the enrollment set by a millisecond on every audit.
  const { gateway } = await runScenario(happy());
  const [first] = callsTo(gateway, 'workflow_enrollment_search');
  assert.equal(Number(first.query.fromDate), 1000);
  assert.equal(Number(first.query.toDate), 2000);
});

// --- execution-log specifics ---------------------------------------------------

const CURSOR_KEYS = ['action', 'referenceId', 'referenceCreatedAt', 'referenceSid', 'referenceSequence'];

test('the cursor is driven with BOTH reference halves, or not at all', async () => {
  // INVERTED from "no cursor key is ever sent". The endpoint's cursor is real — it was
  // judged inert only because it had been tested without `action`. What must never happen
  // now is a HALF reference: supply `referenceId` without `referenceCreatedAt` and the
  // server answers 200 with page 1 again, so the walk makes no progress and reports no
  // error. `referenceSid`/`referenceSequence` stay unsent: measured inert, and an
  // undeclared key cannot reach the wire.
  for (const spec of [happy(), scenario(LOG_FIXTURES, 'cursor-walks-multiple-pages'), scenario(LOG_FIXTURES, 'multiple-event-type-streams')]) {
    const { gateway } = await runScenario(spec);
    const calls = callsTo(gateway, 'workflow_execution_logs');
    assert.ok(calls.length > 0);
    for (const [index, call] of calls.entries()) {
      for (const key of ['referenceSid', 'referenceSequence']) {
        assert.equal(Object.hasOwn(call.query, key), false, `logs query carried an unproven ${key}`);
      }
      // Stream-agnostic, because each eventType stream restarts its own cursor: the first
      // call of EVERY stream is `first`, not just the first call of the run.
      assert.ok(['first', 'next'].includes(call.query.action), `call ${index}`);
      assert.equal(
        Object.hasOwn(call.query, 'referenceId'),
        Object.hasOwn(call.query, 'referenceCreatedAt'),
        'a half-reference silently re-reads the same page and must never be sent',
      );
      // The reference and the action must agree: `first` opens a stream with no cursor,
      // `next` continues one and therefore always carries both halves.
      assert.equal(Object.hasOwn(call.query, 'referenceId'), call.query.action === 'next', `call ${index}`);
    }
  }
});

test('every log query carries the mode switch, the limit, and only declared keys', async () => {
  const { gateway } = await runScenario(scenario(LOG_FIXTURES, 'multiple-event-type-streams'));
  // `actionType` is absent from this set deliberately — it is a REAL working filter that
  // this rail refuses to declare, because its value enum cannot be established and an
  // unrecognised value returns a silent empty page.
  const declared = new Set(['workflowId', 'locationId', 'limit', 'dateType', 'fromDate', 'toDate',
    'action', 'contactId', 'eventType', 'referenceId', 'referenceCreatedAt']);
  for (const call of callsTo(gateway, 'workflow_execution_logs')) {
    assert.equal(call.query.dateType, 'custom', 'without the mode switch the window is silently ignored');
    assert.equal(String(call.query.limit), String(LOG_PAGE_SIZE));
    for (const key of Object.keys(call.query)) {
      assert.ok(declared.has(key), `undeclared log query key ${key}`);
    }
  }
});

test('event time is parsed by field priority and the supplying field is recorded', async () => {
  const { result } = await runScenario({
    input: { fromDate: 1, toDate: 10000 },
    corpus: [
      { _id: 'all-three', _t: 100, startedExecutionAt: 100, createdAt: 200, updatedAt: 300 },
      { _id: 'created-and-updated', _t: 400, createdAt: 400, updatedAt: 500 },
      { _id: 'updated-only', _t: 600, updatedAt: 600 },
      { _id: 'iso-string', _t: 700, startedExecutionAt: new Date(700).toISOString() , createdAt: 700 },
    ],
  });
  const by = Object.fromEntries(result.runtimeEvents.map((e) => [e.id, e]));
  assert.equal(by['all-three'].timestampField, 'startedExecutionAt');
  assert.equal(by['all-three'].timestamp, 100);
  assert.equal(by['created-and-updated'].timestampField, 'createdAt');
  assert.equal(by['created-and-updated'].timestamp, 400);
  assert.equal(by['updated-only'].timestampField, 'updatedAt');
  assert.equal(by['updated-only'].timestamp, 600);
  assert.equal(by['iso-string'].timestampField, 'startedExecutionAt');
  assert.equal(by['iso-string'].timestamp, 700, 'an ISO timestamp must be normalised to epoch ms');
});

test('an offsetless ISO timestamp is read as UTC, not as the host timezone', async () => {
  // Date.parse reads an offsetless ISO string in the LOCAL zone. `1970-01-01T00:25:00`
  // (= 1500000 UTC) inside the window [1000000, 2000000) was therefore RETAINED under
  // TZ=UTC and silently DROPPED under TZ=Asia/Manila and TZ=America/Los_Angeles — with
  // complete:true in all three cases. That breaks this module's own stated invariant that
  // two identical runs produce byte-identical results, and it makes the window a function
  // of which machine collected it. The suite is run under four timezones for this test.
  const { result } = await runScenario({
    input: { fromDate: 1000000, toDate: 2000000 },
    corpus: [
      { _id: 'offsetless', _t: 1500000, startedExecutionAt: '1970-01-01T00:25:00' , createdAt: 1500000 },
      { _id: 'zulu', _t: 1500001, startedExecutionAt: '1970-01-01T00:25:00.001Z' , createdAt: 1500001 },
      // Same instant as `offsetless`, written with an explicit +08:00 offset, so the
      // offset arithmetic is proven rather than assumed.
      { _id: 'offset-plus', _t: 1500002, startedExecutionAt: '1970-01-01T08:25:00.002+08:00' , createdAt: 1500002 },
      { _id: 'offset-minus', _t: 1500003, startedExecutionAt: '1969-12-31T16:25:00.003-08:00' , createdAt: 1500003 },
      { _id: 'space-separated', _t: 1500004, startedExecutionAt: '1970-01-01 00:25:00.004' , createdAt: 1500004 },
    ],
  });
  const by = Object.fromEntries(result.runtimeEvents.map((e) => [e.id, e]));
  assert.equal(by.offsetless.timestamp, 1500000);
  assert.equal(by.zulu.timestamp, 1500001);
  assert.equal(by['offset-plus'].timestamp, 1500002);
  assert.equal(by['offset-minus'].timestamp, 1500003);
  assert.equal(by['space-separated'].timestamp, 1500004);
  assert.equal(result.complete, true, 'five well-formed timestamps must not make the window incomplete');
});

test('RFC 3339 lowercase designators are accepted on BOTH halves of the timestamp', async () => {
  // The grammar already accepted a lowercase `z` zone designator but rejected a lowercase
  // `t` separator. RFC 3339 §5.6 permits both in lower case, so the split made the parser's
  // leniency depend on which half of the string an upstream happened to lower-case: an
  // emitter producing `…t…Z` was read, `…T…z` was read, and `…t…z` — the same instant — was
  // declared unparseable and forced the whole window incomplete. `_t` and the timestamp
  // must agree, so a rejected row would fall out of the window and change the count.
  const { result } = await runScenario({
    input: { fromDate: 1000000, toDate: 2000000 },
    corpus: [
      { _id: 'lower-t-upper-z', _t: 1500000, startedExecutionAt: '1970-01-01t00:25:00Z' , createdAt: 1500000 },
      { _id: 'lower-t-lower-z', _t: 1500001, startedExecutionAt: '1970-01-01t00:25:00.001z' , createdAt: 1500001 },
      { _id: 'upper-t-lower-z', _t: 1500002, startedExecutionAt: '1970-01-01T00:25:00.002z' , createdAt: 1500002 },
      { _id: 'lower-t-offset', _t: 1500003, startedExecutionAt: '1970-01-01t08:25:00.003+08:00' , createdAt: 1500003 },
    ],
  });
  assert.deepEqual(result.runtimeEvents.map((e) => e.timestamp), [1500000, 1500001, 1500002, 1500003]);
  assert.equal(result.complete, true, 'a case difference in a designator is not missing evidence');
});

test('a timestamp outside the accepted grammar is unparseable, not leniently guessed', async () => {
  // Date.parse also runs in lenient legacy mode, so its accepted surface is far wider than
  // ISO and undefined between engines: 'Jan 1 1970' and '2026-02-31' both produce a number.
  // A row dated by a guess is worse than a row that cannot be dated, because the guess
  // silently decides window membership. Anything outside the grammar forces incompleteness.
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [
      { _id: 'legacy-format', _t: null, startedExecutionAt: 'Jan 1 1970 00:00:01 GMT' },
      { _id: 'impossible-date', _t: null, startedExecutionAt: '2026-02-31T00:00:00Z' },
      { _id: 'month-13', _t: null, startedExecutionAt: '2026-13-01T00:00:00Z' },
      // A rolled-over MINUTE stays inside the same calendar day, so the day round-trip
      // check cannot see it — only the explicit field-range guard can.
      { _id: 'minute-99', _t: null, startedExecutionAt: '2026-01-01T00:99:00Z' },
      { _id: 'second-99', _t: null, startedExecutionAt: '2026-01-01T00:00:99Z' },
      { _id: 'garbage', _t: null, startedExecutionAt: 'not-a-date' },
    ],
  });
  // The count is asserted FIRST: a guessed date does not merely mislabel the row, it moves
  // it OUT of [fromDate, toDate) entirely (2026-02-31 rolls forward to 2026-03-03), so a
  // loop over whatever survived would pass while three of the four rows had vanished.
  assert.equal(result.runtimeEvents.length, 6, 'every row must be retained as evidence, undated');
  for (const event of result.runtimeEvents) {
    assert.equal(event.timestamp, null, `${event.id} was dated by a guess`);
    assert.equal(event.timestampField, null);
  }
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some((w) => w.code === 'LOG_EVENT_TIMESTAMP_UNPARSEABLE'));
});

test('a four-digit year below 100 is that year, not 1900 + it', async () => {
  // Date.UTC maps a year argument of 0-99 onto 1900 + year, so '0099-01-01T00:00:00Z'
  // becomes 1999 — a 1900-year error that lands the row inside a plausible-looking window.
  // The window here brackets the WRONG answer, so the correct parse produces zero events
  // and the buggy one produces a retained row.
  const nineteenNinetyNine = Date.UTC(99, 0, 1);
  const { result } = await runScenario({
    input: { fromDate: nineteenNinetyNine - 1000, toDate: nineteenNinetyNine + 1000 },
    corpus: [{ _id: 'year-99', _t: nineteenNinetyNine, startedExecutionAt: '0099-01-01T00:00:00Z' }],
  });
  assert.equal(result.runtimeEvents.length, 0,
    'a year-99 timestamp must not be read as 1999 and retained inside a 1999 window');
});

test('a numeric string is epoch ms, never a year', async () => {
  // The NUMERIC_STRING guard runs BEFORE the date grammar. Without it '1700' reaches the
  // date parser (which now rejects it outright, so the row would become unplaceable) —
  // and under the original Date.parse it became the year 1700, silently dating an
  // execution to the 18th century and dropping it from every window ever asked for.
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [{ _id: 'numeric-string', _t: 1700, startedExecutionAt: '1700' , createdAt: 1700 }],
  });
  assert.equal(result.runtimeEvents.length, 1);
  assert.equal(result.runtimeEvents[0].timestamp, 1700);
  assert.equal(result.runtimeEvents[0].timestampField, 'startedExecutionAt');
  assert.equal(result.complete, true);
});

test('a present-but-corrupt higher-priority timestamp field is named, not silently skipped', async () => {
  const { result } = await runScenario(scenario(LOG_FIXTURES, 'corrupt-higher-priority-timestamp-field'));
  const corrupt = result.runtimeEvents.find((e) => e.id === 'corrupt');
  assert.equal(corrupt.timestampField, 'createdAt');
  assert.equal(corrupt.timestamp, 1500);
  assert.deepEqual(corrupt.unreadableTimestampFields, ['startedExecutionAt']);
  const clean = result.runtimeEvents.find((e) => e.id === 'clean');
  assert.deepEqual(clean.unreadableTimestampFields, [], 'a normal row must not be tarred with the same flag');
  assert.equal(result.complete, false);
});

test('an id-less execution row is retained rather than collapsed into its twin', async () => {
  // Two distinct events with no _id/id and identical content used to become ONE event with
  // complete:true and no warning at all. Within a single response they are provably two
  // rows, so both survive; across overlapping partitions the occurrence index recurs, so
  // the dedup still holds. Either way the count is declared unprovable.
  const { result } = await runScenario(scenario(LOG_FIXTURES, 'repeated-rows'));
  const idless = result.runtimeEvents.filter((e) => e.id === null);
  assert.equal(idless.length, 3, 'two identical id-less rows plus one distinct one');
  assert.equal(idless.filter((e) => e.event.eventType === 'email').length, 2);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some((w) => w.code === 'LOG_EVENT_ID_MISSING'));
});

test('an id-less row echoed by overlapping partitions is still counted once', async () => {
  // The other half of the occurrence rule. The saturated parent and both children return
  // the same untimed id-less row; position-keying it UNCONDITIONALLY would triple it.
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [
      ...Array.from({ length: 19 }, (_, i) => ({ _id: `e-${i}`, _t: 1000 + (i * 50), startedExecutionAt: 1000 + (i * 50) })),
      { _t: null, eventType: 'orphan' },
    ],
  });
  assert.equal(result.runtimeEvents.filter((e) => e.id === null).length, 1);
});

// A row whose `_t` places it in a window (so the STUB pages it out across many partitions)
// but whose `startedExecutionAt` is garbage (so the COLLECTOR cannot date it). Each such row
// used to push TWO warning objects: LOG_EVENT_TIMESTAMP_UNPARSEABLE and
// LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE.
const undatableCorpus = (count) => Array.from({ length: count }, (_, i) => ({
  _id: `undatable-${i}`, _t: 1000 + i, startedExecutionAt: 'not-a-date', createdAt: 'not-a-date',
}));

const warningsByCode = (result) => {
  const grouped = new Map();
  for (const warning of result.warnings) grouped.set(warning.code, [...(grouped.get(warning.code) ?? []), warning]);
  return grouped;
};

test('the warnings array is bounded by the VOCABULARY, not by the number of offending rows', async () => {
  // Measured before the fix, on a 20,380-row untimed corpus: 41,270 warning objects carrying
  // 5 distinct `detail` strings — 7.19 MB of warnings inside a 10.78 MB result. That result
  // is serialized over stdio and hashed whole into the Task 7 proof ledger, where 20,380
  // copies of one sentence are not evidence, they are ballast. Three codes fired per-ROW or
  // per-PARTITION with no dedup at all (LOG_EVENT_TIMESTAMP_UNPARSEABLE,
  // LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE, LOG_PARTITION_SATURATED_AT_FLOOR) while the module
  // already had the one-object idiom twice over (`idlessWarned`, `conflictedIds`).
  //
  // Nothing is lost by aggregating: an auditor branches on the CODE, and "how many rows" is
  // a number. So the count now rides on the single object as `occurrences`.
  const window = { fromDate: 1000, toDate: 3000, logPageSize: 5000 };
  const small = await runScenario({ input: window, corpus: undatableCorpus(200) });
  const large = await runScenario({ input: window, corpus: undatableCorpus(2000) });

  assert.ok(large.result.runtimeEvents.length > small.result.runtimeEvents.length,
    'the large corpus must actually retain more rows, or this proves nothing');

  for (const { result } of [small, large]) {
    const grouped = warningsByCode(result);
    for (const code of ['LOG_EVENT_TIMESTAMP_UNPARSEABLE', 'LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE']) {
      const objects = grouped.get(code) ?? [];
      assert.equal(objects.length, 1, `${code} emitted ${objects.length} objects instead of one`);
      assert.ok(Number.isSafeInteger(objects[0].occurrences) && objects[0].occurrences >= 1,
        `${code} must carry the count it collapsed`);
      assert.ok(objects[0].detailSamples.length <= 3, 'the distinguishing-detail sample must be capped');
    }
    // The whole array is bounded by the size of the vocabulary, not by the data.
    assert.ok(result.warnings.length <= WARNING_CODES.length,
      `warnings must be bounded by the ${WARNING_CODES.length}-code vocabulary, got ${result.warnings.length}`);
  }

  // The strongest form of the property: TEN TIMES the rows, byte-for-byte the same number of
  // warning objects. A per-row push cannot satisfy this.
  assert.equal(large.result.warnings.length, small.result.warnings.length,
    'the warning COUNT must not scale with the row count');
  // …and the counts still differ, so aggregation did not throw the information away.
  const occurrencesOf = (result, code) => (warningsByCode(result).get(code) ?? [])[0]?.occurrences ?? 0;
  assert.ok(
    occurrencesOf(large.result, 'LOG_EVENT_TIMESTAMP_UNPARSEABLE') > occurrencesOf(small.result, 'LOG_EVENT_TIMESTAMP_UNPARSEABLE'),
    'occurrences must still report how many rows fired the condition',
  );
  assert.equal(
    occurrencesOf(large.result, 'LOG_EVENT_TIMESTAMP_UNPARSEABLE'),
    large.result.runtimeEvents.length,
    'every retained row here is undatable, so the occurrence count must equal the row count',
  );
});

// N execution rows, each id served TWICE with a different payload. That is the in-flight
// shape the ballast measurement came from: overlapping partitions re-serve a row whose
// `updatedAt` ticked between the parent read and the child read, so the id recurs with a
// different content hash and trips the duplicate-id conflict guard. Rows are DENSE at one
// per millisecond so no partition can saturate at the floor (a 1ms window returns 3 rows,
// never a full page) and every row is therefore provably walked.
const conflictingPairCorpus = (idCount, t0 = 1000) => Array.from({ length: idCount }, (_, i) => [
  { _id: `exec-${i}`, _t: t0 + (i * 2), createdAt: t0 + (i * 2), startedExecutionAt: t0 + (i * 2), payload: 'a' },
  { _id: `exec-${i}`, _t: t0 + (i * 2) + 1, createdAt: t0 + (i * 2) + 1, startedExecutionAt: t0 + (i * 2) + 1, payload: 'b' },
]).flat();

test('LOG_DUPLICATE_ID_CONFLICT is bounded by the VOCABULARY, and its count IS the number of conflicting ids', async () => {
  // The one warning the aggregation pass left unbounded in ROW COUNT rather than in
  // vocabulary. `conflictedIds` fires it exactly once per offending id — but the detail it
  // emits, `two execution rows share an id but not a content hash (N distinct payloads)`,
  // CARRIES NO ID, so every object was byte-identical and the object count rose with the
  // corpus. The ceiling is `maxLogPartitions × LOG_PAGE_SIZE`: 5,120 objects at the default
  // budget, 40,960 at the 2,048 maximum. Measured on a 16,384-row corpus of exactly this
  // shape: 8,192 warning objects, 2,170,881 bytes, EXACTLY ONE distinct detail string — 35%
  // of a 6.2 MB result, in the object serialized over stdio and hashed whole into the
  // Task 7 proof ledger.
  //
  // Aggregating it loses nothing and adds something: `occurrences` becomes precisely the
  // number of DISTINCT CONFLICTING IDS, which is what an auditor wants and what thousands of
  // identical copies never said without being counted.
  const walk = async (idCount) => {
    const corpus = conflictingPairCorpus(idCount);
    const { result } = await runScenario({
      input: {
        fromDate: 1000,
        toDate: 1000 + (idCount * 2),
        // Generous on purpose: a walk that ran out of budget would see only some of the ids,
        // and `occurrences` would then be measuring the budget rather than the data.
        logPageSize: 5000,
      },
      corpus,
    });
    assert.equal(result.pagination.logPages.exhausted, false,
      `the ${idCount}-id walk must complete, or the occurrence count measures the budget`);
    assert.equal(result.runtimeEvents.length, idCount * 2,
      'both payloads of every id must be retained — one of them is wrong and the collector cannot tell which');
    return result;
  };

  // 2,048 conflicting ids. Before this fix that was 2,048 warning objects of one repeated
  // sentence; a per-object emission cannot pass the assertions below at any corpus size.
  const large = await walk(2048);
  const small = await walk(128);

  for (const [label, result, idCount] of [['large', large, 2048], ['small', small, 128]]) {
    const objects = (warningsByCode(result).get('LOG_DUPLICATE_ID_CONFLICT') ?? []);
    assert.equal(objects.length, 1,
      `${label}: LOG_DUPLICATE_ID_CONFLICT emitted ${objects.length} objects instead of one`);
    assert.equal(objects[0].occurrences, idCount,
      `${label}: occurrences must be the number of DISTINCT CONFLICTING IDS, got ${objects[0].occurrences}`);
    // The detail carries no id, so there is exactly one distinct string however many ids
    // conflicted — which is precisely why collapsing them loses nothing.
    assert.deepEqual(objects[0].detailSamples, [objects[0].detail],
      `${label}: the conflict detail is id-free, so one sample is the whole vocabulary of it`);
    assert.ok(result.warnings.length <= WARNING_CODES.length,
      `${label}: warnings must be bounded by the ${WARNING_CODES.length}-code vocabulary, got ${result.warnings.length}`);
    assertUniformWarningShape(result, `${label} duplicate-id run`);
  }

  // The strongest form: SIXTEEN TIMES the conflicting ids, byte-for-byte the same number of
  // warning objects, and a count that still tells them apart.
  assert.equal(large.warnings.length, small.warnings.length,
    'the warning COUNT must not scale with the number of conflicting ids');
  assert.ok(
    warningsByCode(large).get('LOG_DUPLICATE_ID_CONFLICT')[0].occurrences
      > warningsByCode(small).get('LOG_DUPLICATE_ID_CONFLICT')[0].occurrences,
    'collapsing must not throw the count away',
  );
  // The conflict must still make the window incomplete. Aggregation changes the SHAPE of
  // the warning, never the verdict it produces.
  assert.equal(large.complete, false);
  assert.equal(large.componentCompleteness.runtimeEvents, false);
});

test('LOG_EVENT_ID_MISSING is already bounded at one object by a run-level guard', async () => {
  // The sibling code, re-checked at the same time and deliberately LEFT on the plain
  // emitter. Its detail is id-free too — but its guard `idlessWarned` is a run-level
  // BOOLEAN, not a per-id set, so it emits exactly ONE object however many id-less rows
  // arrive. There is nothing to collapse: routing it through the aggregating emitter would
  // produce a byte-identical object. Making `occurrences` count id-less ROWS would mean
  // DELETING that guard, which changes what the field means on a proven verdict.
  //
  // This test is the guard on that reasoning: if the row count ever starts driving the
  // object count here, it fails the same way the duplicate-id test above would have.
  const idlessCorpus = (count) => Array.from({ length: count }, (_, i) => ({
    _t: 1000 + i, createdAt: 1000 + i, startedExecutionAt: 1000 + i, note: `idless-${i}`,
  }));
  const walk = async (count) => {
    const { result } = await runScenario({
      input: { fromDate: 1000, toDate: 1000 + count, logPageSize: 5000 },
      corpus: idlessCorpus(count),
    });
    const objects = warningsByCode(result).get('LOG_EVENT_ID_MISSING') ?? [];
    assert.equal(objects.length, 1, `${count} id-less rows produced ${objects.length} warning objects`);
    assert.equal(objects[0].occurrences, 1,
      'the run-level boolean fires once, so the honest count is 1 — not a silently-wrong row count');
    assert.deepEqual(objects[0].detailSamples, [objects[0].detail]);
    assertUniformWarningShape(result, `${count}-row id-less run`);
    return result;
  };
  const large = await walk(1024);
  const small = await walk(16);
  assert.equal(large.warnings.length, small.warnings.length,
    'the id-less warning count must not scale with the row count either');
});

test('the budget-exhaustion warning is one object however many streams hit the ceiling', async () => {
  // The aggregated-warning contract, re-anchored. It used to be demonstrated on the
  // saturation warning, which named a partition width; that code is gone with the walk it
  // described. LOG_PAGE_BUDGET_EXHAUSTED inherits the property — several event-type streams
  // draw on ONE page budget, so several can hit the ceiling in a single run.
  const streamNames = ['added_to_workflow', 'email', 'sms'];
  const streams = Object.fromEntries(streamNames.map((name) => [
    name,
    Array.from({ length: 30 }, (_, i) => ({
      _id: `${name}-${i}`, _t: 1000 + i, createdAt: 1000 + i, startedExecutionAt: 1000 + i, eventType: name,
    })),
  ]));
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000, eventTypes: streamNames, logPageSize: 5, maxLogPages: 2 },
    streams,
  });
  const objects = warningsByCode(result).get('LOG_PAGE_BUDGET_EXHAUSTED') ?? [];
  assert.equal(objects.length, 1, 'one object per code, however many streams ran out');
  assert.equal(objects[0].detail, objects[0].detailSamples[0],
    'the readable `detail` field must stay the shape every other warning has');
  assert.equal(result.pagination.logPages.exhausted, true);
  assert.equal(result.pagination.logPages.terminatedCleanly, false);
  assert.equal(result.complete, false);
});

test('every warning object has the SAME key set, whichever emitter produced it', async () => {
  // The aggregation fix above introduced a SECOND warning shape. `warnAggregated` attached
  // `occurrences`/`detailSamples`; plain `warn` did not — so one array carried two
  // structurally different objects and nothing said which code had which. Task 11 branches
  // on this array: `w.occurrences > 1` reads false for a genuine single firing and for a
  // missing field alike, and `sum += w.occurrences` is NaN from the first plain warning
  // onward. Both are silent.
  //
  // ONE run drives all three emitter classes at once, because the defect only exists
  // BETWEEN them — a per-class test passes on a codebase where each class is internally
  // consistent and mutually incompatible:
  //
  //   aggregated    LOG_EVENT_TIMESTAMP_UNPARSEABLE, LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE
  //                 (collapsed by `aggregatedWarnings`), and LOG_DUPLICATE_ID_CONFLICT,
  //                 which MOVED onto the aggregating emitter — its `conflictedIds` guard
  //                 bounded the ROW count, not the object count, so it emitted one
  //                 byte-identical object per conflicting id. This scenario has exactly ONE
  //                 conflicting id, so it still reports `occurrences: 1` below; the
  //                 many-ids case is proved by its own test.
  //   self-deduping LOG_EVENT_ID_MISSING (`idlessWarned`) — one object by a run-level
  //                 boolean, not by the map
  //   plain         STEP_ROSTER_UNSEALED — fired once, guarded by nothing at all
  //
  // The corpus is built to fire them together:
  //   - `stepIds: ['ghost-step']` is not in the definition's template set  (plain)
  //   - id-less rows with a garbage `startedExecutionAt` => unparseable + field-unreadable
  //     (aggregated, twice over) and an id-less retained row  (self-deduping)
  //   - two rows sharing `_id: 'dup'` with different payloads               (self-deduping)
  const { result } = await runScenario({
    input: { fromDate: 0, toDate: 2000, stepIds: ['ghost-step'] },
    corpus: [
      // Same id, two different payloads: both are retained (one of them is wrong and the
      // collector cannot tell which), and the second one trips the conflict guard.
      { _id: 'dup', _t: 10, startedExecutionAt: 10, payload: 'a' , createdAt: 10 },
      { _id: 'dup', _t: 11, startedExecutionAt: 11, payload: 'b' , createdAt: 11 },
      // Id-less AND undatable, several times over, so the aggregating emitter has something
      // to actually collapse rather than emitting a single object by accident.
      ...Array.from({ length: 6 }, (_, i) => ({
        _t: 100 + i, createdAt: 'not-a-date', startedExecutionAt: 'not-a-date', note: `undatable-${i}`,
      })),
    ],
  });

  const seen = new Set(result.warnings.map((w) => w.code));
  // The coverage gate. Without it this test would still pass on a run that emitted one
  // warning from one emitter, and would then prove nothing about the other two.
  for (const [emitter, codes] of [
    ['aggregated', ['LOG_EVENT_TIMESTAMP_UNPARSEABLE', 'LOG_EVENT_TIMESTAMP_FIELD_UNREADABLE']],
    ['self-deduping', ['LOG_EVENT_ID_MISSING', 'LOG_DUPLICATE_ID_CONFLICT']],
    ['plain', ['STEP_ROSTER_UNSEALED']],
  ]) {
    for (const code of codes) {
      assert.ok(seen.has(code),
        `this scenario must actually fire ${code} (${emitter}) or it proves nothing about that emitter`);
    }
  }

  assertUniformWarningShape(result, 'mixed-emitter run');

  // Stated once, positively, so the contract is readable without unpicking the helper: this
  // exact key set, on every object, with no per-code exceptions.
  for (const warning of result.warnings) {
    assert.deepEqual(Object.keys(warning).sort(), [...WARNING_KEYS].sort(), warning.code);
  }
  // The plain and self-deduping warnings are ONE-occurrence warnings and must say so as a
  // number. `undefined` here is the whole defect; so is a string, and so is 0.
  for (const code of ['STEP_ROSTER_UNSEALED', 'LOG_EVENT_ID_MISSING', 'LOG_DUPLICATE_ID_CONFLICT']) {
    const warning = result.warnings.find((w) => w.code === code);
    assert.equal(warning.occurrences, 1, `${code} fired once and must report the number 1`);
    assert.deepEqual(warning.detailSamples, [warning.detail], `${code} must carry its own detail as its only sample`);
  }
  // …and the aggregated one still counts, so uniformity was bought by giving the plain
  // emitter the field rather than by taking it off the aggregating one.
  const unparseable = result.warnings.find((w) => w.code === 'LOG_EVENT_TIMESTAMP_UNPARSEABLE');
  assert.ok(unparseable.occurrences > 1, `the aggregated warning must still count, got ${unparseable.occurrences}`);

  // Every warning summed and compared is the consumer operation that was broken. It must be
  // a number, and it must exceed the object count (the aggregated one collapsed several).
  const total = result.warnings.reduce((sum, w) => sum + w.occurrences, 0);
  assert.ok(Number.isSafeInteger(total), `summing occurrences across the array must not be NaN, got ${total}`);
  assert.ok(total > result.warnings.length,
    'the aggregated firings must survive the sum, or occurrences is decoration');
});

test('runtime events are emitted in a deterministic ascending order with unplaceable rows last', async () => {
  const { result } = await runScenario(scenario(LOG_FIXTURES, 'missing-timestamp-unsaturated'));
  const timestamps = result.runtimeEvents.map((e) => e.timestamp);
  assert.deepEqual(timestamps, [1010, 1020, null]);
});

test('an unplaceable event is retained as evidence but carries no invented timestamp', async () => {
  // Plan line 427: retained as evidence, and the window is incomplete because local
  // [fromDate, toDate) membership cannot be proven. Dropping it loses evidence; dating it
  // from the query window manufactures it.
  const { result } = await runScenario(scenario(LOG_FIXTURES, 'missing-timestamp-unsaturated'));
  const orphan = result.runtimeEvents.find((e) => e.id === 'no-time');
  assert.ok(orphan, 'the unplaceable event must be retained');
  assert.equal(orphan.timestamp, null);
  assert.equal(orphan.timestampField, null);
  assert.ok(orphan.event, 'the raw row must be preserved as evidence');
});

test('conflicting duplicates are both retained rather than resolved by guesswork', async () => {
  const { result } = await runScenario(scenario(LOG_FIXTURES, 'conflicting-duplicate-ids'));
  assert.equal(result.runtimeEvents.filter((e) => e.id === 'dup').length, 2);
});

test('every log-side incompleteness sets BOTH complete:false and truncated:true', async () => {
  // Plan line 425 lists these five together on purpose: `complete` answers "can I publish a
  // claim about this window" and `truncated` answers "is there known-missing data". A
  // consumer branching on only one of them silently gets the other's failures wrong.
  for (const name of [
    'conflicting-duplicate-ids',
    'page-budget-exhausted',
    'missing-timestamp-unsaturated',
    'repeated-rows',
  ]) {
    const { result } = await runScenario(scenario(LOG_FIXTURES, name));
    assert.equal(result.complete, false, `${name} should be incomplete`);
    assert.equal(result.truncated, true, `${name} should be truncated`);
  }
});

// --- enrollment cursor specifics ------------------------------------------------

test('the first enrollment page carries action=first and no cursor key at all', async () => {
  const { gateway } = await runScenario(scenario(ENROLLMENT_FIXTURES, 'three-page-enrollment'));
  const [first] = callsTo(gateway, 'workflow_enrollment_search');
  assert.equal(first.query.action, 'first');
  for (const key of ['referenceId', 'referenceCreatedAt', 'referenceSid', 'referenceSequence']) {
    assert.equal(Object.hasOwn(first.query, key), false, `action=first carried ${key}`);
  }
});

test('action=next forwards the cursor tuple and NEVER referenceSequence', async () => {
  /*
   * 🔴 The upstream REJECTS this key by name:
   *     HTTP 422 {"message":["property referenceSequence should not exist"]}
   *
   * MEASURED against a live account 2026-07-29 (one workflow, 61 enrollments): page 1
   * returns 200 with 20 rows and every page-2 request carrying `referenceSequence` 422s, with or
   * without the other keys and with `referenceCreatedAt` in ISO or epoch form. Drop that one key
   * and the identical request returns 200 with the next 20 rows.
   *
   * This test previously asserted the OPPOSITE, on the belief that dropping the key silently
   * truncated a sort the upstream ordered by. It truncated every enrollment roster at page one
   * instead, on every workflow busy enough to have a second page, surfacing as
   * COMPONENT_READ_FAILED rather than as a query this code builds wrong.
   */
  const { gateway } = await runScenario(scenario(ENROLLMENT_FIXTURES, 'reference-sequence-forwarding'));
  const [, second] = callsTo(gateway, 'workflow_enrollment_search');
  assert.equal(second.query.action, 'next');
  assert.equal(String(second.query.referenceId), 'seq-19');
  assert.equal(Number(second.query.referenceCreatedAt), 519);
  assert.equal(String(second.query.referenceSid), 'sid-19');
  assert.equal(Object.hasOwn(second.query, 'referenceSequence'), false,
    'referenceSequence is rejected by the upstream and must never be sent');
});

test('a row carrying a sequence still pages, and still does not send it', async () => {
  const { gateway } = await runScenario(scenario(ENROLLMENT_FIXTURES, 'reference-sequence-alias'));
  const [, second] = callsTo(gateway, 'workflow_enrollment_search');
  assert.equal(Object.hasOwn(second.query, 'referenceSequence'), false);
  // The walk still advances: the id is what the upstream actually pages on.
  assert.equal(String(second.query.referenceId), 'alias-last');
});

test('an absent cursor value OMITS the key instead of sending an empty one', async () => {
  // Task 2 carry-forward item 2: the cursor keys are optional on the descriptor, so the
  // gateway's non-empty-required-value rule does not cover them. `referenceSid=` would
  // reach the wire and change the query the receipt claims was made.
  const { gateway } = await runScenario(scenario(ENROLLMENT_FIXTURES, 'omit-absent-cursor-keys'));
  const [, second] = callsTo(gateway, 'workflow_enrollment_search');
  assert.equal(String(second.query.referenceId), 'om-last');
  assert.equal(Number(second.query.referenceCreatedAt), 400);
  assert.equal(Object.hasOwn(second.query, 'referenceSid'), false, 'an absent sid must omit the key');
  assert.equal(Object.hasOwn(second.query, 'referenceSequence'), false, 'an absent sequence must omit the key');
  for (const [key, value] of Object.entries(second.query)) {
    assert.notEqual(String(value).trim(), '', `query key ${key} was sent with an empty value`);
  }
});

test('the enrollment walk stops on a repeated cursor tuple instead of spinning to the page budget', async () => {
  const { gateway, result } = await runScenario(scenario(ENROLLMENT_FIXTURES, 'repeated-enrollment-cursor'));
  assert.equal(callsTo(gateway, 'workflow_enrollment_search').length, 2);
  assert.equal(result.pagination.enrollmentPages.exhausted, false, 'this is a cursor loop, not a budget problem');
});

test('two identical id-less enrollment rows in ONE page are two rows, not one', async () => {
  // The enrollment and step-roster walks keyed every row by `id ?? content-hash`, with no
  // occurrence index — so two id-less rows with identical payloads inside a single response
  // collapsed to one, SILENTLY. That is the exact undercount the execution-row walk was
  // fixed for (retainEvent's `noid:<hash>#<occurrence>` key plus LOG_EVENT_ID_MISSING),
  // applied in one of the three places it was needed. Rows in one response are provably
  // distinct, so both survive; the count is declared unprovable either way, because two
  // distinct id-less rows returned by two DIFFERENT pages are still indistinguishable from
  // one row echoed twice.
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [],
    enrollment: {
      pages: [{
        rows: [
          { _id: 'enr-1', contactId: 'c1', createdAt: 1, sid: 's1', sequence: 1 },
          { contactId: 'anon', status: 'active' },
          { contactId: 'anon', status: 'active' },
        ],
      }],
    },
  });
  assert.equal(result.enrollments.rows.length, 3, 'the twin id-less row was silently dropped');
  assert.ok(result.warnings.some((w) => w.code === 'ENROLLMENT_ROW_ID_MISSING'),
    'and an unprovable roster count must say so');
  assert.equal(result.complete, false);
  assert.equal(result.componentCompleteness.enrollments, false);
});

test('an id-less enrollment row echoed by a repeated page is still counted once', async () => {
  // The other half of the occurrence rule, and the thing a naive positional key breaks:
  // the SAME page served twice must dedupe to one copy of the id-less row. If it did not,
  // `added` would be non-zero on the second page and ENROLLMENT_NO_UNIQUE_PROGRESS — the
  // guard that stops the walk paging forever over one page — would never fire.
  const page = [
    ...Array.from({ length: 18 }, (_, i) => ({ _id: `ep-${i}`, contactId: `c${i}`, createdAt: 300 + i, sid: `sid-${i}`, sequence: i })),
    { contactId: 'anon', status: 'active' },
    { _id: 'ep-last', contactId: 'clast', createdAt: 400, sid: 'sid-last', sequence: 99 },
  ];
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [],
    enrollment: { pages: [{ rows: page }, { rows: page }] },
  });
  assert.equal(result.enrollments.rows.length, 20, 'the echoed page must not double anything');
  assert.ok(result.warnings.some((w) => w.code === 'ENROLLMENT_NO_UNIQUE_PROGRESS'),
    'a page that contributed no new rows must stop the walk');
});

// --- step rosters ---------------------------------------------------------------

test('two identical id-less roster rows in ONE page are two contacts, not one', async () => {
  // Same defect, second site — and here the undercount was not merely silent, it
  // manufactured a SECOND false claim: with the twin collapsed, the roster reported 2
  // contacts against a reported total of 3, tripping the "ran out of rows" reconciliation
  // and blaming the upstream for a row this collector had thrown away.
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000, stepIds: ['step-1'] },
    corpus: [],
    stepDetails: {
      'step-1': {
        totalCount: 3,
        pages: [{ rows: [{ _id: 'r1', contactId: 'c1' }, { contactId: 'anon' }, { contactId: 'anon' }] }],
      },
    },
  });
  const roster = result.stepRosters.find((r) => r.stepId === 'step-1');
  assert.equal(roster.contacts.length, 3, 'the twin id-less contact was silently dropped');
  assert.equal(roster.total, 3);
  assert.ok(
    result.warnings.every((w) => !String(w.detail).includes('ran out of rows')),
    'a roster that DID reach its reported total must not be reported as short',
  );
  assert.ok(result.warnings.some((w) => w.code === 'STEP_ROSTER_ROW_ID_MISSING'));
  assert.equal(result.componentCompleteness.stepRosters, false);
});

test('an id-bearing row repeated across roster pages is still deduplicated', async () => {
  // The guard on the guard: occurrence-keying must not have loosened the dedup that works.
  // A page that re-serves a row already seen under an earlier skip must still contribute it
  // once, or the roster over-counts and sails past its reported total.
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000, stepIds: ['step-1'] },
    corpus: [],
    stepDetails: {
      'step-1': {
        totalCount: 60,
        pages: [
          { generate: { count: 50, idPrefix: 'dup-' } },
          // the same 50 ids again, plus 10 genuinely new ones
          { generate: { count: 50, idPrefix: 'dup-' } },
          { generate: { count: 10, idPrefix: 'fresh-' } },
        ],
      },
    },
  });
  const roster = result.stepRosters.find((r) => r.stepId === 'step-1');
  assert.equal(roster.contacts.length, 60, 'the repeated ids must collapse, the fresh ones must not');
});


test('a step roster is sealed with the step ids the definition actually declares', async () => {
  const { gateway } = await runScenario(scenario(ROSTER_FIXTURES, 'step-roster-pagination'));
  for (const call of callsTo(gateway, 'workflow_step_details')) {
    assert.equal(call.typedBindings.stepId, 'step-1');
    assert.deepEqual(call.typedBindings.discoveredStepIds, ['step-1', 'step-2']);
    assert.equal(String(call.query.currentStepId), 'step-1');
    assert.equal(String(call.query.showTotalCount), 'true');
    assert.equal(Number(call.query.limit), STEP_PAGE_SIZE);
  }
});

test('a workflow with no declared steps never receives a roster read', async () => {
  // Task 2 carry-forward item 5: an EMPTY discoveredStepIds array alongside a typed stepId
  // THROWS at the gateway. The collector must refuse locally and record the gap, so a
  // definition with no steps degrades to incomplete rather than to a policy exception.
  const { gateway, result } = await runScenario(scenario(ROSTER_FIXTURES, 'step-roster-refused-when-step-set-is-empty'));
  assert.equal(callsTo(gateway, 'workflow_step_details').length, 0);
  assert.equal(result.complete, false);
});

test('the enrollment-totals cache is asked for exactly one workflow', async () => {
  // Task 2 carry-forward item 4: workflow_enroll_stats_cache is cardinality-1 by spec.
  // Batching would widen the audit surface and break the identity guard's typing.
  const { gateway } = await runScenario(happy());
  const [cache] = callsTo(gateway, 'workflow_enroll_stats_cache');
  assert.deepEqual(cache.query['workflowIds[]'], WF);
});

// --- definition metadata --------------------------------------------------------

test('the workflow definition is captured with a canonical hash and honest validity metadata', async () => {
  const { result } = await runScenario(happy());
  const definition = result.workflowDefinition;
  assert.deepEqual(definition.workflow, DEFAULT_DEFINITION.workflow);
  assert.deepEqual(definition.triggers, DEFAULT_DEFINITION.triggers.triggers);
  assert.deepEqual(definition.stickyNotes, DEFAULT_DEFINITION.stickyNotes.data);
  assert.equal(definition.version, 7);
  assert.equal(definition.hashAlgorithm, 'sha256');
  assert.equal(definition.capturedAt, CAPTURED_AT);
  assert.equal(definition.canonicalHash, sha256Canonical({
    workflow: DEFAULT_DEFINITION.workflow,
    triggers: DEFAULT_DEFINITION.triggers.triggers,
    stickyNotes: DEFAULT_DEFINITION.stickyNotes.data,
  }));
});

// A definition carrying the two things `scrubSecrets` actually rewrites, in the two places a
// real workflow carries them: a Bearer credential in a webhook header (rewritten in place)
// and a SECRET_KEYS-named field whose WHOLE SUBTREE is replaced by '<redacted>'. Webhook and
// custom-code steps are exactly where these live upstream, which is why this is the common
// case and not a corner one.
const SECRET_BEARING_DEFINITION = Object.freeze({
  workflow: {
    _id: WF,
    name: 'Runtime WF',
    status: 'published',
    version: 7,
    workflowData: {
      templates: [
        { id: 'step-1', type: 'webhook', headers: { Authorization: 'Bearer sk-live-abcdefghijklmnopqrstuvwxyz012345' } },
        { id: 'step-2', type: 'custom_code', credentials: { value: 'sk_live_do_not_leak', region: 'ap-southeast-2' } },
      ],
    },
  },
  triggers: { triggers: [{ id: 'trg-1', type: 'contact_created' }] },
  stickyNotes: { data: [{ id: 'note-1', text: 'note' }], count: 1 },
});

test('the definition hash a client receives is one it can actually reproduce', async () => {
  // THE BUG THIS PINS. `canonicalHash` is computed over the definition as GHL served it, but
  // the whole result then leaves through ok() -> scrubSecrets, which is lossy and NOT
  // invertible. So a consumer holding the transcript could never reproduce `canonicalHash`
  // from the bytes it received, on any workflow containing a credential — and that is most
  // workflows with a webhook or custom-code step. The fix publishes BOTH digests; this test
  // is what stops a later "simplification" from collapsing them back into one.
  const { result } = await runScenario({ ...happy(), definition: SECRET_BEARING_DEFINITION });
  const definition = result.workflowDefinition;

  // The scrub must actually have bitten, or this test proves nothing about either hash.
  const received = ok(result).data.workflowDefinition;
  const templates = received.workflow.workflowData.templates;
  assert.notEqual(templates[0].headers.Authorization, SECRET_BEARING_DEFINITION.workflow.workflowData.templates[0].headers.Authorization,
    'the Bearer credential must have been rewritten, otherwise this scenario is not exercising the scrub');
  assert.equal(templates[1].credentials, '<redacted>',
    'a SECRET_KEYS-named field must lose its whole subtree, otherwise this scenario is not exercising the scrub');

  // THE PROPERTY A CLIENT DEPENDS ON: the scrubbed digest is reproducible from the received
  // bytes. This is computed the way a consumer would compute it — over what arrived, with no
  // access to the pre-scrub definition.
  assert.equal(definition.canonicalHashScrubbed, sha256Canonical({
    workflow: received.workflow,
    triggers: received.triggers,
    stickyNotes: received.stickyNotes,
  }), 'canonicalHashScrubbed must be reproducible from the bytes the client actually receives');

  // And the pre-scrub digest is NOT, which is the whole reason a second one exists. If these
  // two ever agree on a secret-bearing definition, either the scrub stopped working or
  // someone pointed both hashes at the same bytes; both are regressions and both fail here.
  assert.notEqual(definition.canonicalHash, definition.canonicalHashScrubbed,
    'the two digests must differ on a secret-bearing definition, or one of them is not doing its job');
  assert.equal(definition.canonicalHash, sha256Canonical({
    workflow: SECRET_BEARING_DEFINITION.workflow,
    triggers: SECRET_BEARING_DEFINITION.triggers.triggers,
    stickyNotes: SECRET_BEARING_DEFINITION.stickyNotes.data,
  }), 'canonicalHash must still identify the definition GHL actually served');

  // Which digest covers what, stated rather than left to be inferred from field names: a
  // client that verifies the wrong one reports a definition mismatch that is really a scrub.
  assert.deepEqual(definition.hashCoverage, {
    canonicalHash: 'pre-scrub upstream bytes; NOT reproducible from this response',
    canonicalHashScrubbed: 'post-scrub bytes; reproducible from this response',
  });
});

test('both definition digests are refused together when the definition is incomplete', async () => {
  // A partial definition hashing to a complete-looking value would bind a receipt to
  // evidence that was never collected. That rule already governed `canonicalHash`; the
  // second digest must not become a way around it.
  const { result } = await runScenario({
    ...happy(),
    overrides: [{
      capabilityId: 'workflow_triggers',
      nth: 1,
      response: { status: 500, ok: false, json: {}, failureClass: 'HTTP_500' },
    }],
  });
  assert.equal(result.workflowDefinition.canonicalHash, null);
  assert.equal(result.workflowDefinition.canonicalHashScrubbed, null,
    'an incomplete definition must refuse BOTH digests, not just the pre-scrub one');
});

test('the current definition is never claimed to have applied to historical events', async () => {
  // Plan line 443. This is the quietest lie available to this collector: reading a
  // definition today and reporting runtime from last week reads as "this is the workflow
  // those contacts went through". Nothing in the audit rail proves that, so effectiveFrom
  // is null until a version-history source exists.
  const { result } = await runScenario(happy());
  assert.deepEqual(result.workflowDefinition.validity, {
    effectiveFrom: null,
    effectiveTo: null,
    source: null,
    provenEffectiveInterval: false,
    appliesToRequestedWindow: 'unproven',
  });
  assert.notEqual(
    result.workflowDefinition.validity.effectiveFrom,
    result.requestedWindow.fromDate,
    'the requested window must never be reused as a proven effective interval',
  );
});

// --- the split error model ------------------------------------------------------

// audit-gateway.mjs splits its failures in two: POLICY faults THROW with `.code`, and
// RESPONSE faults RETURN ok:false with a `failureClass`. A collector that models only one
// half loses the other, and the half it loses becomes an empty-but-complete window.
async function assertHonestFailure(spec, code) {
  const gateway = makeFakeAuditGateway(spec);
  const input = { locationId: LOC, workflowId: WF, ...(spec.input ?? {}) };
  let result = null;
  let thrown = null;
  try {
    result = await collectWorkflowRuntimeWindow({ auditGateway: gateway, input });
  } catch (error) {
    thrown = error;
  }
  if (thrown) {
    assert.equal(thrown.code, code, 'a thrown failure must keep its machine-branchable code');
    assert.equal(typeof thrown.remediation, 'string', 'a thrown failure must say what to do next');
    return;
  }
  assert.equal(result.complete, false, `${code} produced a complete result`);
  assert.ok(result.warnings.length > 0, `${code} produced no warning`);
}

test('a thrown CIRCUIT_OPEN never becomes an empty-but-complete window', async () => {
  await assertHonestFailure({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [{ _id: 'a', _t: 1010, startedExecutionAt: 1010 , createdAt: 1010 }],
    overrides: [{ capabilityId: 'workflow_execution_logs', nth: 1, throwCode: 'CIRCUIT_OPEN', meta: { scope: 'process', reason: 'RATE_LIMITED' } }],
  }, 'CIRCUIT_OPEN');
});

test('a thrown TRANSPORT_FAILED never becomes an empty-but-complete window', async () => {
  await assertHonestFailure({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [{ _id: 'a', _t: 1010, startedExecutionAt: 1010 , createdAt: 1010 }],
    overrides: [{ capabilityId: 'workflow_execution_logs', nth: 1, throwCode: 'TRANSPORT_FAILED' }],
  }, 'TRANSPORT_FAILED');
});

test('a thrown IDENTITY_INSPECTION_FAILED never becomes an empty-but-complete window', async () => {
  await assertHonestFailure({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [{ _id: 'a', _t: 1010, startedExecutionAt: 1010 , createdAt: 1010 }],
    overrides: [{ capabilityId: 'workflow_execution_logs', nth: 1, throwCode: 'IDENTITY_INSPECTION_FAILED' }],
  }, 'IDENTITY_INSPECTION_FAILED');
});

test('a thrown policy fault on any later component is still an honest failure', async () => {
  for (const capabilityId of [
    'workflow_detail', 'workflow_count_per_step', 'workflow_enrollment_search', 'workflow_enroll_stats_cache',
  ]) {
    await assertHonestFailure({
      input: { fromDate: 1000, toDate: 2000 },
      corpus: [{ _id: 'a', _t: 1010, startedExecutionAt: 1010 , createdAt: 1010 }],
      overrides: [{ capabilityId, nth: 1, throwCode: 'BINDING_MISMATCH' }],
    }, 'BINDING_MISMATCH');
  }
});

test('a returned identity-incompleteness class maps to complete:false, never to empty', async () => {
  for (const name of ['identity-inspection-capped', 'identity-depth-capped']) {
    const { result } = await runScenario(scenario(IDENTITY_FIXTURES, name));
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.notDeepEqual(warningCodesOf(result), [], `${name} recorded no reason`);
  }
});

test('a returned AUTH_REJECTED on one component leaves the others readable and the result honest', async () => {
  const { result } = await runScenario(scenario(IDENTITY_FIXTURES, 'component-auth-refused'));
  assert.equal(result.complete, false);
  assert.equal(result.perStepCounts, null, 'a refused component must be null, never an empty set');
  assert.equal(result.runtimeEvents.length, 1, 'the components that DID read must survive');
});

test('a quarantining identity conflict drops the payload rather than merging it', async () => {
  const { result } = await runScenario(scenario(IDENTITY_FIXTURES, 'record-with-conflicting-location'));
  assert.equal(result.locationBinding.quarantined, true);
  assert.equal(result.runtimeEvents.length, 0);
  assert.ok(
    result.locationBinding.conflicts.some((c) => c.field === 'locationId' && c.actual === 'OTHER-LOC'),
    'the conflict itself must be reported, not just the verdict',
  );
});

test('a thrown CIRCUIT_OPEN carries the reads it already completed on error.partial', async () => {
  // Plan line 331: "Do not auto-retry after an opened circuit; return stable metadata for
  // checkpoint/resume." The throw discarded EVERYTHING — six completed reads including a
  // log partition holding a real event — and the error carried no window, no pagination and
  // no sourceRoutes, so a resumer had no way to know which partitions it had already paid
  // for. The throw still propagates (a latched circuit means stop deliberately), but the
  // evidence now travels with it.
  const gateway = makeFakeAuditGateway({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [{ _id: 'already-read', _t: 1500, startedExecutionAt: 1500 , createdAt: 1500 }],
    overrides: [{
      capabilityId: 'workflow_enrollment_search',
      nth: 1,
      throwCode: 'CIRCUIT_OPEN',
      meta: { scope: 'process', reason: 'RATE_LIMITED' },
    }],
  });
  let thrown = null;
  try {
    await collectWorkflowRuntimeWindow({
      auditGateway: gateway,
      input: { locationId: LOC, workflowId: WF, fromDate: 1000, toDate: 2000 },
    });
  } catch (error) { thrown = error; }

  assert.ok(thrown, 'a latched circuit must still stop the run');
  assert.equal(thrown.code, 'CIRCUIT_OPEN');
  const partial = thrown.partial;
  assert.ok(partial, 'the completed reads must survive on error.partial');
  assert.equal(partial.complete, false);
  assert.equal(partial.truncated, true);
  assert.ok(partial.warnings.some((w) => w.code === 'CIRCUIT_OPEN'),
    'the reserved CIRCUIT_OPEN warning was declared but never emitted anywhere');
  // The things a resumer actually needs.
  assert.deepEqual(partial.requestedWindow, { fromDate: 1000, toDate: 2000, boundaries: '[)' });
  assert.equal(partial.sourceRoutes.length, 6, 'the six reads before the latch — the log cursor costs two');
  // Two log pages: the cursor opened and then confirmed itself exhausted, before the
  // circuit latched on the NEXT component.
  assert.equal(partial.pagination.logPages.pages, 2);
  assert.equal(partial.pagination.logPages.terminatedCleanly, true);
  assert.equal(partial.runtimeEvents.length, 1, 'a real event was read before the latch and must not be thrown away');
  assert.equal(partial.enrollments, null, 'a component that was never reached is null, not empty');
  assert.equal(partial.componentCompleteness.enrollments, false);
  assert.equal(partial.componentCompleteness.runtimeEvents, true);
});

// A dense corpus: every partition comes back FULL, so the walk keeps splitting and a latch
// can be placed at an arbitrary depth inside an unfinished walk.
const DENSE_LOG_CORPUS = Array.from({ length: 400 }, (_, i) => ({
  _id: `dense-${i}`, _t: 1000 + i, createdAt: 1000 + i, startedExecutionAt: 1000 + i,
}));

async function latchAt(spec) {
  const gateway = makeFakeAuditGateway(spec);
  try {
    await collectWorkflowRuntimeWindow({
      auditGateway: gateway,
      input: { locationId: LOC, workflowId: WF, ...spec.input },
    });
  } catch (error) {
    assert.equal(error.code, 'CIRCUIT_OPEN');
    assert.ok(error.partial, 'a latched circuit must still publish what it already read');
    return error.partial;
  }
  throw new Error('the injected circuit did not latch');
}

test('error.partial never claims a component whose loop never ran', async () => {
  // `progress.runtimeEvents` and `progress.stepRosters` are published into the progress
  // object BEFORE their loops run — they have to be, because the loops push into those very
  // arrays and a mid-walk CIRCUIT_OPEN must still be able to publish what was collected. So
  // `!== null` says only "the array exists". componentCompleteness derived from
  // `!== null && componentClean(...)`, and the CIRCUIT_OPEN warning is filed against
  // component 'run', so an abort dirtied NEITHER component. Measured before the fix:
  //
  //   latch on                          reported              actual
  //   1st workflow_execution_logs read  runtimeEvents: true   [] , terminal 0
  //   5th log partition                 runtimeEvents: true   20 of an unbounded walk
  //   1st workflow_step_details read    stepRosters:  true    [] , 2 steps requested
  //   2nd step-roster read              stepRosters:  true    1 of 2 steps read
  //
  // A Task 5 resumer reads exactly this field to decide what it may SKIP, so each of those
  // four is an instruction to publish [] for a window that was never read.
  const logWindow = { fromDate: 1000, toDate: 2000, logPageSize: 20 };
  const rosterWindow = { fromDate: 1000, toDate: 1001, stepIds: ['step-1', 'step-2'] };
  const rosterStubs = {
    'step-1': { totalCount: 1, pages: [{ rows: [{ _id: 'r1' }] }] },
    'step-2': { totalCount: 1, pages: [{ rows: [{ _id: 'r2' }] }] },
  };
  const latch = (capabilityId, nth) => ({
    capabilityId, nth, throwCode: 'CIRCUIT_OPEN', meta: { scope: 'process', reason: 'RATE_LIMITED' },
  });

  const firstLogRead = await latchAt({
    input: logWindow, corpus: DENSE_LOG_CORPUS, overrides: [latch('workflow_execution_logs', 1)],
  });
  assert.deepEqual(firstLogRead.runtimeEvents, []);
  assert.equal(firstLogRead.pagination.logPages.pages, 1);
  assert.equal(firstLogRead.componentCompleteness.runtimeEvents, false,
    'an empty event list from a walk that never read a page is not a complete component');

  // A latch PART-WAY THROUGH the cursor walk. Everything already paged is real evidence and
  // must survive on error.partial — but the component must NOT report itself complete on it,
  // because the cursor never reached a page contributing no new ids.
  const midWalk = await latchAt({
    input: logWindow, corpus: DENSE_LOG_CORPUS, overrides: [latch('workflow_execution_logs', 5)],
  });
  // `pages` is incremented before the read is issued, so the latching page counts.
  assert.equal(midWalk.pagination.logPages.pages, 5, 'four pages completed and the fifth latched');
  assert.equal(midWalk.pagination.logPages.terminatedCleanly, false, 'the cursor never exhausted itself');
  assert.ok(midWalk.runtimeEvents.length > 0, 'the pages that DID complete are real evidence');
  assert.equal(midWalk.componentCompleteness.runtimeEvents, false);

  const firstRosterRead = await latchAt({
    input: rosterWindow, corpus: [], stepDetails: rosterStubs, overrides: [latch('workflow_step_details', 1)],
  });
  assert.deepEqual(firstRosterRead.stepRosters, []);
  assert.equal(firstRosterRead.filters.stepIds.length, 2);
  assert.equal(firstRosterRead.componentCompleteness.stepRosters, false,
    '[].every(r => r.complete) is vacuously true, so the per-roster check cannot catch this');

  const secondRosterRead = await latchAt({
    input: rosterWindow, corpus: [], stepDetails: rosterStubs, overrides: [latch('workflow_step_details', 2)],
  });
  assert.equal(secondRosterRead.stepRosters.length, 1, 'one of the two requested steps was read');
  assert.equal(secondRosterRead.stepRosters[0].complete, true, 'and that one really is complete');
  assert.equal(secondRosterRead.componentCompleteness.stepRosters, false,
    'a roster loop that covered 1 of 2 requested steps is not a complete component');
});

test('observedEventTypes counts what the window actually holds, from the rows themselves', async () => {
  // The point of this field is that it CANNOT be wrong about the account it describes. A
  // hard-coded step-type list would have been: the builder catalog says `wait`, these rows
  // say `wait_time`, and the endpoint answers a wrong slug with a clean empty page — so a
  // catalog-derived allow-list produces a confident "no wait steps ever ran".
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [
      { _id: 'a', _t: 1010, createdAt: 1010, startedExecutionAt: 1010, type: 'email', status: 'success' },
      { _id: 'b', _t: 1020, createdAt: 1020, startedExecutionAt: 1020, type: 'email', status: 'skipped' },
      { _id: 'c', _t: 1030, createdAt: 1030, startedExecutionAt: 1030, type: 'wait_time', status: 'waiting' },
      { _id: 'd', _t: 1040, createdAt: 1040, startedExecutionAt: 1040 },   // neither field present
      // Non-STRING values, not merely absent ones. Without the typeof guard a numeric type
      // becomes the key `42` and a null status becomes `null`, so the histogram would grow
      // keys that are not step types at all — and this field's whole value is that its keys
      // ARE the account's vocabulary.
      { _id: 'e', _t: 1050, createdAt: 1050, startedExecutionAt: 1050, type: 42, status: null },
    ],
  });
  assert.deepEqual(result.observedEventTypes.byType,
    { '(absent)': 2, email: 2, wait_time: 1 });
  assert.deepEqual(result.observedEventTypes.byStatus,
    { '(absent)': 2, skipped: 1, success: 1, waiting: 1 });
  // Counted over RETAINED rows, so the totals reconcile with the published event list rather
  // than with whatever the wire happened to return.
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(total(result.observedEventTypes.byType), result.runtimeEvents.length);
  assert.equal(total(result.observedEventTypes.byStatus), result.runtimeEvents.length);
  // Key-sorted: this result is hashed whole into the proof ledger, so insertion order (an
  // artifact of row order) must not change the bytes.
  for (const bag of [result.observedEventTypes.byType, result.observedEventTypes.byStatus]) {
    assert.deepEqual(Object.keys(bag), [...Object.keys(bag)].sort());
  }
});

test('an EMPTY observedEventTypes is not a claim that the window held nothing', async () => {
  // Same doctrine as every other component here: an empty histogram is a CLAIM that the
  // window held nothing, and this rail may not make a claim it did not observe.
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [{ _id: 'never-seen', _t: 1010, createdAt: 1010, startedExecutionAt: 1010 }],
    overrides: [{ capabilityId: 'workflow_execution_logs', nth: 1, response: { json: { unexpectedEnvelope: true } } }],
  });
  assert.deepEqual(result.observedEventTypes, { byType: {}, byStatus: {} },
    'a failed read publishes an EMPTY histogram over the zero rows it retained — and the '
    + 'component completeness flag, not this field, is what says the read failed');
  assert.equal(result.componentCompleteness.runtimeEvents, false);
  assert.equal(result.complete, false);
});

test('the loop-reached markers are not just constant false', async () => {
  // The contrast case. Without it, IMPORTANT 1 is satisfiable by hard-coding both markers
  // to false, which would make componentCompleteness useless in the opposite direction and
  // pin `complete` to false on every run that requests a step roster.
  const { result } = await runScenario(happy());
  assert.equal(result.componentCompleteness.runtimeEvents, true);
  assert.equal(result.componentCompleteness.stepRosters, true);
  assert.equal(result.complete, true);
});

test('a throttle makes the window incomplete even if no component warned about it', async () => {
  // DEFENCE IN DEPTH, and deliberately fed a state the gateway contract says cannot occur
  // (`ok === true` iff `failureClass === null`). It models the shape of the bug this test
  // file was rewritten for: a read whose failure never reached warnForFailure, with the
  // throttle flag set and nothing turning it into a verdict. Today every one of the nine
  // reads checks `.ok`, so this state is unreachable through the collector — which is
  // exactly why the guard needs its own test rather than riding on a sibling's warning,
  // and why relying on Task 2's circuit having latched first (an undocumented cross-module
  // coupling that does not hold when the throttled read is the LAST one) is not enough.
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [{ _id: 'seen', _t: 1500, startedExecutionAt: 1500 , createdAt: 1500 }],
    overrides: [{
      capabilityId: 'workflow_execution_logs',
      nth: 1,
      response: { ok: true, status: 200, failureClass: 'LOCATION_RATE_LIMITED', retryAfterMs: 9000 },
    }],
  });
  assert.equal(result.rateLimit.limited, true);
  assert.equal(result.rateLimit.retryAfterMs, 9000);
  assert.equal(result.complete, false, 'a throttled run may not be published as complete');
  assert.ok(result.warnings.some((w) => w.code === 'RATE_LIMITED'),
    'and complete:false must still arrive with a stated reason');
});

// --- the second axis: configuration-to-runtime binding ---------------------------

test('complete:true never implies the captured definition governed these events', async () => {
  // `workflowDefinition.validity.appliesToRequestedWindow` is 'unproven' on EVERY run (no
  // version-history capability exists), so it coexisted permanently with complete:true and
  // a consumer reading only `complete` had nothing telling it not to bind the two. Making
  // it force complete:false would pin `complete` to false forever — the same mistake the
  // enrollment total-mismatch rule made — so it gets its own field instead.
  const { result } = await runScenario(happy());
  assert.equal(result.complete, true);
  assert.equal(result.workflowDefinition.validity.appliesToRequestedWindow, 'unproven');
  assert.deepEqual(result.configurationBinding, {
    definitionGovernedRuntimeEvents: 'unproven',
    provenBy: null,
    publishableAsGoverning: false,
    detail: 'The audit rail exposes no workflow version-history capability, so nothing here proves the captured definition was in force during the requested window.',
  });
});

// --- capability version ----------------------------------------------------------

test('capabilityVersion is the hash of exactly the descriptors this tool reads', async () => {
  // Asserting only "a non-empty string" let a mutant freeze it at 'sha256:deadbeef' and
  // survive — and this value is the descriptor-set anchor Task 7 binds receipts to. It is
  // also NARROWED: hashing all 16 descriptors meant a Task 4 edit to an Agent-Studio
  // descriptor invalidated every already-collected workflow runtime window for a reason
  // that could not have changed what those windows observed.
  const subset = RUNTIME_WINDOW_CAPABILITY_IDS
    .map((id) => AUDIT_CAPABILITIES.find((d) => d.capabilityId === id));
  assert.ok(subset.every(Boolean), 'every declared capability id must resolve to a descriptor');
  assert.equal(AUDIT_CAPABILITY_VERSION, `sha256:${sha256Canonical(subset)}`);
  assert.notEqual(
    AUDIT_CAPABILITY_VERSION,
    `sha256:${sha256Canonical(AUDIT_CAPABILITIES)}`,
    'the version must not be derived from descriptors this tool never calls',
  );
  const { result } = await runScenario(happy());
  assert.equal(result.capabilityVersion, AUDIT_CAPABILITY_VERSION);
});

test('a declared capability with no descriptor is fatal, never hashed out of the version', () => {
  // The RUNTIME_WINDOW_DESCRIPTOR_MISSING throw had NO test. It ran inline at module scope
  // over the real, complete AUDIT_CAPABILITIES, so its only input could never trigger it and
  // nothing proved that removing a descriptor fails loudly. The silent alternative is the
  // dangerous one: a skipped id yields a version hash describing a SMALLER policy than the
  // one the collector actually calls under, so every receipt Task 7 binds to that hash
  // attests to a policy that was never in force. The resolution is exported as a function
  // purely to make the branch reachable — the injected list feeds a HASH, never a request,
  // so unlike a gateway `descriptors` list it cannot bypass a runtime policy.
  assert.throws(
    () => resolveRuntimeWindowDescriptors(['workflow_detail', 'not_a_real_capability']),
    (error) => {
      assert.match(error.message, /^RUNTIME_WINDOW_DESCRIPTOR_MISSING: not_a_real_capability\b/);
      return true;
    },
  );
  // The realistic shape of the accident: a descriptor deleted from audit-capabilities.mjs
  // while RUNTIME_WINDOW_CAPABILITY_IDS still names it.
  assert.throws(
    () => resolveRuntimeWindowDescriptors(
      RUNTIME_WINDOW_CAPABILITY_IDS,
      AUDIT_CAPABILITIES.filter((d) => d.capabilityId !== 'workflow_execution_logs'),
    ),
    /RUNTIME_WINDOW_DESCRIPTOR_MISSING: workflow_execution_logs/,
  );
  // And the guard is not throw-always: today's real set resolves every declared id, in order.
  const resolved = resolveRuntimeWindowDescriptors(RUNTIME_WINDOW_CAPABILITY_IDS);
  assert.deepEqual(resolved.map((d) => d.capabilityId), [...RUNTIME_WINDOW_CAPABILITY_IDS]);
});

test('the declared capability id set matches the reads the collector actually issues', async () => {
  const { gateway } = await runScenario({
    input: { fromDate: 1000, toDate: 2000, stepIds: ['step-1'] },
    corpus: [],
    stepDetails: { 'step-1': { totalCount: 1, pages: [{ rows: [{ _id: 'r1' }] }] } },
    overrides: [{ capabilityId: 'workflow_enroll_stats_cache', nth: 1, response: { json: { stats: [] } } }],
  });
  const issued = new Set(gateway.calls.map((c) => c.capabilityId));
  assert.deepEqual([...issued].sort(), [...RUNTIME_WINDOW_CAPABILITY_IDS].sort(),
    'a capability the collector calls but does not declare would be hashed out of the version');
});

// --- guards that had no coverage at all ------------------------------------------

test('a gateway bound to a different location is refused before any read', async () => {
  const gateway = makeFakeAuditGateway({ corpus: [] }, { locationId: 'OTHER-LOC' });
  await assert.rejects(
    () => collectWorkflowRuntimeWindow({
      auditGateway: gateway,
      input: { locationId: LOC, workflowId: WF, fromDate: 1000, toDate: 2000 },
    }),
    (error) => error.code === 'INVALID_RUNTIME_WINDOW',
  );
  assert.equal(gateway.calls.length, 0,
    'a window labelled with one location and collected from another must never reach the wire');
});

test('the collector validates its own filter caps and budget bounds', async () => {
  // These live in the collector as well as in the zod schema because the collector is what
  // Task 5's driver will call directly, with no schema in front of it.
  for (const over of [
    { eventTypes: Array.from({ length: 21 }, (_, i) => `e${i}`) },
    { stepIds: Array.from({ length: 21 }, (_, i) => `s${i}`) },
    { eventTypes: ['ok', ''] },
    { stepIds: [null] },
    { eventTypes: 'not-an-array' },
    { maxLogPages: 0 },
    { maxLogPages: 2049 },
    { maxLogRetries: 11 },
    { maxEnrollmentPages: 0 },
    { maxEnrollmentPages: 1001 },
    { maxStepRosterPages: 0 },
    { maxStepRosterPages: 1001 },
    { maxLogPartitions: 1.5 },
    { contactId: '' },
  ]) {
    await assertRejectedBeforeAnyRead({ fromDate: 1000, toDate: 2000, ...over });
  }
});

test('a repeated filter id does not buy a second budget slot', async () => {
  const { gateway } = await runScenario(
    { input: { fromDate: 1000, toDate: 2000 }, corpus: [] },
    { eventTypes: ['email', 'email'] },
  );
  assert.equal(callsTo(gateway, 'workflow_execution_logs').length, 1);
});

test('the step roster pages on the rows it actually received', async () => {
  const { gateway } = await runScenario(scenario(ROSTER_FIXTURES, 'step-roster-pagination'));
  assert.deepEqual(
    callsTo(gateway, 'workflow_step_details').map((c) => Number(c.query.skip)),
    [0, 50, 100],
  );
});

test('capturedAt latches the FIRST response and is never a wall clock', async () => {
  // Pinned either way, because "the earliest instant any of this evidence was observed" and
  // "the last" are different claims and nothing said which one this field made.
  const { result } = await runScenario({
    input: { fromDate: 1000, toDate: 2000 },
    corpus: [],
    overrides: [
      { capabilityId: 'workflow_triggers', nth: 1, response: { capturedAt: '2099-01-01T00:00:00.000Z' } },
      // The LAST read too, so "latches the first" is distinguishable from "keeps
      // overwriting" — with only a middle read differing, both behaviours end on the same
      // value and the assertion proves nothing.
      { capabilityId: 'workflow_enroll_stats_cache', nth: 1, response: { capturedAt: '2098-01-01T00:00:00.000Z' } },
    ],
  });
  assert.equal(result.capturedAt, CAPTURED_AT);
  assert.equal(result.sourceRoutes[1].capturedAt, '2099-01-01T00:00:00.000Z',
    'the per-route capture times must still record what each read actually said');
  assert.equal(result.sourceRoutes.at(-1).capturedAt, '2098-01-01T00:00:00.000Z');
});

// --- determinism ----------------------------------------------------------------

test('two identical runs produce identical results', async () => {
  const first = await runScenario(scenario(LOG_FIXTURES, 'cursor-walks-multiple-pages'));
  const second = await runScenario(scenario(LOG_FIXTURES, 'cursor-walks-multiple-pages'));
  assert.deepEqual(first.result, second.result);
});

// --- tool surface ----------------------------------------------------------------

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);
const deps = (gw) => ({ state: { tokenFile: '/x' }, makeGw: () => gw });

test('get_workflow_runtime_window is registered as a GET-only tool', () => {
  const runtime = tool('get_workflow_runtime_window');
  assert.ok(runtime, 'get_workflow_runtime_window is not registered');
  assert.ok(runtime.capabilities.length > 0, 'an audit tool with no capabilities is an escape hatch');
  assert.ok(runtime.capabilities.every((capability) => capability.method === 'GET'));
});

test('the tool schema applies the plan defaults', () => {
  const parsed = tool('get_workflow_runtime_window').inputSchema.parse({
    locationId: LOC, workflowId: WF, fromDate: 0, toDate: 1000,
  });
  assert.equal(parsed.logPageSize, 100);
  assert.equal(parsed.maxLogPages, 200);
  assert.equal(parsed.maxLogRetries, 3);
  assert.equal(parsed.maxEnrollmentPages, 200);
  assert.equal(parsed.maxStepRosterPages, 200);
  assert.deepEqual(parsed.eventTypes, []);
  assert.deepEqual(parsed.stepIds, []);
});

test('the tool schema rejects an out-of-range page size and budgets', () => {
  const { inputSchema } = tool('get_workflow_runtime_window');
  const base = { locationId: LOC, workflowId: WF, fromDate: 0, toDate: 1000 };
  for (const over of [
    { logPageSize: 5001 },
    { logPageSize: 0 },
    { eventTypes: Array.from({ length: 21 }, (_, i) => `e${i}`) },
    { stepIds: Array.from({ length: 21 }, (_, i) => `s${i}`) },
    { maxLogPages: 0 },
    { maxLogPages: 2049 },
    { maxLogRetries: 11 },
    { maxEnrollmentPages: 1001 },
    { maxStepRosterPages: 0 },
    { fromDate: -1 },
    { toDate: 0 },
    { toDate: 1.5 },
  ]) {
    assert.equal(inputSchema.safeParse({ ...base, ...over }).success, false, `accepted ${JSON.stringify(over)}`);
  }
});

test('the tool rejects an inverted window through the error contract, before any gateway is built', async () => {
  const explode = () => { throw new Error('a gateway must not be constructed for an invalid window'); };
  const result = await tool('get_workflow_runtime_window').handler(
    { locationId: LOC, workflowId: WF, fromDate: 2000, toDate: 1000 },
    { state: { tokenFile: '/x' }, makeGw: explode },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_RUNTIME_WINDOW');
  assert.equal(typeof result.remediation, 'string');
});

test('the tool returns the stable contract rather than throwing on undefined arguments', async () => {
  const result = await tool('get_workflow_runtime_window').handler(undefined, undefined);
  assert.equal(typeof result?.ok, 'boolean');
});

test('the zod schema defaults and the collector DEFAULTS cannot drift apart', async () => {
  // Two copies of the same budget in two files, with nothing asserting they agree, is how
  // a schema quietly starts handing the collector a value the collector would have refused.
  const parsed = tool('get_workflow_runtime_window').inputSchema.parse({
    locationId: LOC, workflowId: WF, fromDate: 1000, toDate: 2000,
  });
  for (const key of Object.keys(RUNTIME_WINDOW_DEFAULTS)) {
    assert.equal(parsed[key], RUNTIME_WINDOW_DEFAULTS[key], `schema default for ${key} disagrees with the collector`);
  }
});

test('the gateway factory forwards every option, including the audit throttle disable', async () => {
  // The stdio entry's factory was `({ loc, rail }) => makeGateway({ tokenFile, loc, rail })`,
  // which silently swallowed the audit tools' `throttleMs: 0, jitterMs: 0` — so the gateway
  // kept its own 300-450ms delay AND the shared audit limiter paced on top of it, the exact
  // double-throttle the Task 2 carry-forward warns about, with the tool's own comment
  // asserting the opposite of what happened.
  const seen = [];
  const factory = makeGatewayFactory({
    state: { tokenFile: '/tok' },
    gatewayImpl: (options) => { seen.push(options); return { rail: options.rail, loc: options.loc }; },
  });
  factory({ loc: LOC, rail: 'jwt', throttleMs: 0, jitterMs: 0 });
  // legacyTokenFileEnv rides along too (0.43.0's migration guard) — undefined here because
  // this state never set it, same as any other option this state didn't declare. `renewer`
  // (0.45.0 auto-renewal) rides on state as well, normalised to null when state has none.
  assert.deepEqual(seen, [{ tokenFile: '/tok', legacyTokenFileEnv: undefined, renewer: null, loc: LOC, rail: 'jwt', throttleMs: 0, jitterMs: 0 }]);
  // And a caller that passes nothing still gets the credential wiring.
  factory();
  assert.deepEqual(seen[1], { tokenFile: '/tok', legacyTokenFileEnv: undefined, renewer: null });
});

test('the stdio entry point wires the factory straight through, with no narrowing wrapper', () => {
  // stdio.mjs connects a transport at import time, so it cannot be imported by a test. A
  // source assertion is the only surface there is — and it is worth having, because the
  // whole option-forwarding fix is defeated by re-wrapping the factory in a
  // `({ loc, rail }) => …` at the call site, which is exactly the shape it had.
  const stdio = readFileSync(new URL('../stdio.mjs', import.meta.url), 'utf8');
  assert.match(stdio, /^const makeGw = makeGatewayFactory\(\{ state \}\);$/m,
    'stdio must hand registerTools the shared factory itself');
  assert.doesNotMatch(stdio, /makeGw\s*=\s*\(\s*\{/,
    'a destructuring wrapper silently drops every option the factory was created to forward');
});

test('one circuit is shared across every call on a single server process', async () => {
  // Nothing in the repo supplies auditLimiter/auditCircuit, so `?? makeAuditCircuit()` was
  // the ONLY reachable branch and every tool call got a fresh circuit: a 429 that latched
  // it on call N was discarded before call N+1, which then re-hammered the very location
  // that had just asked this process to stop.
  //
  // The module is imported under a distinct specifier so this test gets its OWN process-wide
  // pair — the circuit LATCHES by design and has no reset, so latching the one the rest of
  // this file uses would poison every later test.
  const isolated = await import('../core/tools.mjs?process-audit-pacing');
  const runtime = isolated.TOOLS.find((t) => t.name === 'get_workflow_runtime_window');
  const args = { locationId: LOC, workflowId: WF, fromDate: 1000, toDate: 2000 };

  let fetches = 0;
  const throttledGateway = {
    rail: 'jwt',
    loc: LOC,
    uid: 'u',
    callWithMeta: async () => {
      fetches += 1;
      return { status: 429, ok: false, json: { message: 'slow down' }, retryAfterMs: 1000, capturedAt: CAPTURED_AT };
    },
  };
  const gwDeps = { state: { tokenFile: '/x' }, makeGw: () => throttledGateway };

  const first = await runtime.handler(args, gwDeps);
  assert.equal(first.ok, false, 'a 429 must fail closed');
  const fetchesAfterFirst = fetches;
  assert.ok(fetchesAfterFirst >= 1, 'the first call must actually reach the wire');

  const second = await runtime.handler(args, gwDeps);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'CIRCUIT_OPEN',
    'the latch from the first call must still be latched on the second');
  assert.equal(fetches, fetchesAfterFirst,
    'a latched circuit must make ZERO further fetches, not re-hammer the throttled location');

  // The accessor and the handler must be looking at the same object.
  assert.equal(isolated.processAuditPacing().circuit.isOpen('process'), true);
  assert.equal(isolated.processAuditPacing().circuit, isolated.processAuditPacing().circuit);
});

test('one limiter is shared across every call, so pacing survives the call boundary', async () => {
  // The circuit test above cannot see the LIMITER: after a latch nothing else is scheduled.
  // A fresh limiter per call means each call starts with an empty spacing budget, so N tool
  // calls hit the account at N times the rate the limiter promises — which is exactly the
  // account-level throttle the shared limiter exists to avoid. The only way to observe it
  // is ACROSS calls, so this test is deliberately wall-clocked: each call is arranged to
  // make exactly ONE fetch (a 401 latches the injected per-call circuit's rail, so the run
  // stops immediately), and the SECOND call's first fetch must still wait out the first
  // call's spacing.
  const isolated = await import('../core/tools.mjs?process-audit-pacing-limiter');
  const runtime = isolated.TOOLS.find((t) => t.name === 'get_workflow_runtime_window');
  const args = { locationId: LOC, workflowId: WF, fromDate: 1000, toDate: 2000 };
  let fetches = 0;
  const refusing = {
    rail: 'jwt',
    loc: LOC,
    uid: 'u',
    callWithMeta: async () => {
      fetches += 1;
      return { status: 401, ok: false, json: { message: 'nope' }, retryAfterMs: null, capturedAt: CAPTURED_AT };
    },
  };
  // A FRESH circuit per call, so the circuit cannot be what stops the second call — only
  // the shared limiter is left to observe.
  const call = () => runtime.handler(args, {
    state: { tokenFile: '/x' },
    makeGw: () => refusing,
    auditCircuit: makeAuditCircuit(),
  });

  await call();
  assert.equal(fetches, 1, 'a 401 must latch the rail after exactly one fetch');
  const startedAt = Date.now();
  await call();
  const elapsedMs = Date.now() - startedAt;
  assert.equal(fetches, 2);
  assert.ok(elapsedMs >= 200,
    `the second call must be paced by the shared limiter, waited ${elapsedMs}ms`);
});

test('an injected limiter and circuit still win over the process-wide pair', async () => {
  // Task 5's driver owns the pair for a resumable run, and a test needs an isolated one.
  //
  // REWRITTEN. The previous version asserted only the throttle flags and `typeof result.ok`,
  // so it did not test its own name: mutating `deps.auditLimiter ?? pacing.limiter` down to
  // a bare `pacing.limiter` SURVIVED it. The injected limiter was passed and then never
  // observed. Every audit read goes through `limiter.schedule` (audit-gateway.mjs), so the
  // honest proof is that the injected limiter scheduled every fetch that happened — a
  // process-wide limiter would leave this counter at zero while the wire count climbed.
  assert.equal(processAuditPacing().circuit, processAuditPacing().circuit);
  // A genuinely fresh circuit, never a copy of the shared one: the shared circuit's methods
  // close over its own latch map, so a spread would still latch the process-wide pair.
  const injectedCircuit = makeAuditCircuit();
  let usedInjected = false;
  let scheduledByInjectedLimiter = 0;
  let fetches = 0;
  const gw = {
    rail: 'jwt',
    loc: LOC,
    uid: 'u',
    callWithMeta: async () => {
      fetches += 1;
      return { status: 500, ok: false, json: {}, retryAfterMs: null, capturedAt: CAPTURED_AT };
    },
  };
  const result = await tool('get_workflow_runtime_window').handler(
    { locationId: LOC, workflowId: WF, fromDate: 1000, toDate: 2000 },
    {
      state: { tokenFile: '/x' },
      makeGw: (options) => { usedInjected = options.throttleMs === 0 && options.jitterMs === 0; return gw; },
      auditLimiter: { schedule: (task) => { scheduledByInjectedLimiter += 1; return task(); } },
      auditCircuit: injectedCircuit,
    },
  );
  assert.equal(usedInjected, true, 'the audit tool must ask for the per-gateway throttle to be disabled');
  assert.ok(fetches > 0, 'the run must actually reach the wire, or the limiter proves nothing');
  assert.equal(scheduledByInjectedLimiter, fetches,
    'every read must have been paced by the INJECTED limiter, not the process-wide one');
  // The injected circuit is the one that latched, so the process-wide circuit is untouched
  // and the rest of this file is not poisoned.
  assert.equal(processAuditPacing().circuit.isOpen('process'), false);
  assert.equal(typeof result.ok, 'boolean');
});

const CATALOG_ROW_FIELDS = Object.freeze(['rows', 'proofRows', 'proofFloorRows', 'riskRows']);

// The entries this plan ADDED to a catalog that c0566c6 had already reconciled against the
// docs capability matrix. They are the ones that can invent a row id, because everything else
// in the file predates them and IS the reconciliation.
const AUDIT_CATALOG_ENTRIES = Object.freeze([
  'get_workflow_runtime_window',
  'list_workflows_complete',
  'get_ai_configuration_bundle',
]);

test('every row id the tool catalog cites — in EVERY entry — exists in the reconciled vocabulary', () => {
  // GENERALIZED from the runtime-window-only version. c0566c6 established
  // tool-descriptions.json as reconciled against the docs capability matrix. The
  // runtime-window entry shipped `workflow-get`, `workflow-triggers` and
  // `workflow-sticky-notes` — three ids that appear in no other entry and correspond to no
  // matrix row (the real ones are `workflow-read`, `triggers-list` and
  // `workflow-sticky-notes-list`). Nothing validated them. Pinning the check to ONE tool name
  // left the same hole open for every entry added afterwards, and Task 4 walked straight into
  // it: `get_ai_configuration_bundle` cited `entities-voice-ai-agents-list`, the row for
  // list_account_entities's BARE /voice-ai/agents — the very route this bundle disavows.
  const catalog = JSON.parse(readFileSync(new URL('../tool-descriptions.json', import.meta.url), 'utf8'));
  // A tool that reaches NO endpoint cites no rows, and that is correct rather than a gap:
  // search_step_types and describe_step_type read a shipped data file, declare
  // `capabilities: []`, and touch no account. The invariant here is "every row an entry cites
  // must be real" — vacuously satisfied by an entry citing none. The non-empty check assumed
  // every tool has an endpoint, which stopped being true when the step-type catalog landed.
  const ENDPOINTLESS = new Set(['search_step_types', 'describe_step_type']);
  for (const [name, entry] of Object.entries(catalog)) {
    if (ENDPOINTLESS.has(name)) {
      for (const field of CATALOG_ROW_FIELDS) {
        assert.deepEqual(entry[field] ?? [], [], `${name}.${field} must be empty — it reaches no endpoint`);
      }
      continue;
    }
    // The vocabulary for an entry is every row id cited by every OTHER entry — the same
    // relation the original test used, now evaluated per entry.
    const vocabulary = new Set(
      Object.entries(catalog)
        .filter(([other]) => other !== name)
        .flatMap(([, other]) => CATALOG_ROW_FIELDS.flatMap((field) => other[field] ?? [])),
    );
    for (const field of CATALOG_ROW_FIELDS) {
      const rows = entry[field];
      assert.ok(Array.isArray(rows), `${name}.${field} must be a list of row ids`);
      assert.ok(rows.length > 0, `${name}.${field} must be a non-empty list`);
      for (const row of rows) {
        assert.equal(typeof row, 'string', `${name}.${field} cites a non-string row id`);
        // Only the entries this plan added are held to "another entry already cites this".
        // A legacy entry may legitimately be the sole citer of a matrix row it alone reads
        // (`entities-calendars-list` is one), and demoting those to failures would assert a
        // rule the file has never obeyed rather than the one it was reconciled under.
        if (!AUDIT_CATALOG_ENTRIES.includes(name)) continue;
        assert.ok(vocabulary.has(row), `${name}.${field} cites ${row}, which is in no other reconciled catalog entry`);
      }
      // Every narrower list is a subset of `rows`, in every entry. Without this, a row id can
      // be dropped from `rows` and survive in `riskRows`, where nothing would ever look at it.
      if (field === 'rows') continue;
      for (const row of rows) {
        assert.ok((entry.rows ?? []).includes(row), `${name}.${field} cites ${row}, which is missing from ${name}.rows`);
      }
    }
  }
});

test('every audit capability with no matrix row is RECORDED as having none, and none is invented', () => {
  // The honest half of the fix above. Two of the bundle's routes — /voice-ai/agents/simple and
  // /agent-studio/agents/agents-with-folders — are genuinely new to the matrix, and the matrix
  // that defines row ids is NOT in this repository: the README defines none, and a repo-wide
  // grep finds row ids only inside tool-descriptions.json. So the gap is recorded rather than
  // papered over with an invented id, and the record is MACHINE-CHECKED here so Task 6 freezes
  // an honest file and Task 7 cannot mint a receipt implying provenance that does not exist.
  //
  // The check that makes the record load-bearing: cited rows plus recorded gaps must account
  // for EVERY capability the tool declares. A route that is neither cited nor recorded is an
  // undocumented read hiding in a file whose whole purpose is to be verifiable.
  const catalog = JSON.parse(readFileSync(new URL('../tool-descriptions.json', import.meta.url), 'utf8'));
  for (const name of AUDIT_CATALOG_ENTRIES) {
    const entry = catalog[name];
    assert.ok(entry, `${name} must be in the description catalog`);
    const gaps = entry.undocumentedCapabilities;
    assert.ok(Array.isArray(gaps), `${name}.undocumentedCapabilities must be a list, even when empty`);
    const registered = TOOLS.find((candidate) => candidate.name === name);
    assert.ok(registered, `${name} is not a registered tool`);
    const paths = registered.capabilities.map((capability) => capability.path);
    for (const gap of gaps) {
      assert.ok(paths.includes(gap.path), `${name} records a gap for ${gap.path}, which it does not read`);
      assert.equal(typeof gap.reason, 'string', `${name}'s gap for ${gap.path} must say WHY there is no row`);
      assert.ok(gap.reason.length > 40, `${name}'s gap for ${gap.path} must give a real reason`);
    }
    assert.equal(new Set(gaps.map((gap) => gap.path)).size, gaps.length, `${name} records one gap twice`);
    // THE LIMIT OF THIS CHECK, stated so it is not read as more than it is. This is a
    // CARDINALITY argument, not an identity one: it proves the two lists ACCOUNT FOR the
    // declared routes, not that each declared route is individually either cited or recorded. A
    // gap recorded for a path that IS cited, paired with a different path recorded nowhere,
    // satisfies this equality exactly — the loop above only checks that a recorded gap names a
    // path the tool reads, never that the CITED rows do.
    //
    // The identity form is unavailable in this repository, not merely unwritten: proving it
    // needs a row-id -> path map, and the matrix that defines row ids is not here (the README
    // defines none, and a repo-wide grep finds row ids only inside tool-descriptions.json,
    // which is the very file under test). The Task 7 canary is where that map arrives; until it
    // does, this is the strongest honest statement available, and pretending otherwise in a file
    // whose whole purpose is to be verifiable would be the exact failure it exists to catch.
    assert.equal(entry.rows.length + gaps.length, paths.length,
      `${name} cites ${entry.rows.length} rows and records ${gaps.length} gaps for ${paths.length} capabilities: `
      + 'every declared route must be either cited or recorded as having no matrix row');
  }
});

// --- backwards compatibility ------------------------------------------------------

// The audit profile is a SEPARATE entry point (Global Constraints lines 21-22). Adding the
// runtime-window tool must not disturb the tool the normal server's callers already use.
function gwStub(routes = {}) {
  const calls = [];
  return {
    calls,
    loc: 'L',
    uid: 'u',
    call: async (method, path) => {
      calls.push({ method, path });
      for (const [fragment, response] of Object.entries(routes)) {
        if (!path.includes(fragment)) continue;
        return response && typeof response === 'object' && 'ok' in response
          ? response
          : { status: 200, ok: true, json: response };
      }
      return { status: 404, ok: false, json: { message: `no stub for ${path}` } };
    },
  };
}

test('get_workflow_logs keeps its existing single-page response shape', async () => {
  const gw = gwStub({
    'logs/v2': { logs: [{ id: 'l1', eventType: 'added_to_workflow' }] },
    'count-per-step': { counts: [{ stepId: 's1', count: 3 }] },
    'workflow-with-filter': { rows: [{ contactId: 'c1', stepId: 's1' }] },
  });
  const result = await tool('get_workflow_logs').handler({ locationId: 'L', workflowId: 'w1', limit: 20 }, deps(gw));

  assert.equal(result.ok, true);
  assert.equal(result.data.logs.length, 1);
  assert.equal(result.data.perStepCounts.length, 1);
  assert.equal(result.data.enrollments.length, 1);
  assert.equal(result.data.enrollmentsComplete, undefined, 'single-page shape must stay unchanged');
  // The note gained two caveats (lifecycle rows, and what `finished` really means), so this
  // asserts the load-bearing CLAIM survives rather than pinning a whole paragraph — a string
  // equality here means every future caveat is a failing test rather than a passing one.
  assert.match(result.data.note, /added_to_workflow in logs is the ONLY proof a trigger fired/);
  assert.match(result.data.note, /isLifecycleRow/, 'consumers must be told lifecycle rows exist');
  assert.match(result.data.note, /"finished" means the contact LEFT/, 'finished is not completion');
  assert.equal(gw.calls.length, 3, 'the default path must not gain extra reads');
});

test('get_workflow_logs labels GHL lifecycle rows without dropping them', async () => {
  // GHL emits add_to_workflow / added_to_workflow / remove_from_workflow alongside the rows for
  // authored steps. They carry a stepName that reads like a real step and a stepId matching no
  // template, so correlating them to workflowData.templates invents steps. They must survive —
  // added_to_workflow is the only proof a trigger fired — but be distinguishable.
  const gw = gwStub({
    'logs/v2': { logs: [
      { id: 'l1', type: 'added_to_workflow', stepName: 'Add to workflow' },
      { id: 'l2', type: 'add_contact_tag', stepName: 'Harmless tag' },
      { id: 'l3', type: 'remove_from_workflow', stepName: 'Remove from workflow' },
    ] },
    'count-per-step': { counts: [] },
    'workflow-with-filter': { rows: [] },
  });
  const result = await tool('get_workflow_logs').handler({ locationId: 'L', workflowId: 'w1', limit: 20 }, deps(gw));

  assert.equal(result.data.logs.length, 3, 'lifecycle rows are labelled, never dropped');
  const byId = Object.fromEntries(result.data.logs.map((r) => [r.id, r]));
  assert.equal(byId.l1.isLifecycleRow, true);
  assert.equal(byId.l3.isLifecycleRow, true);
  assert.equal(byId.l2.isLifecycleRow, undefined, 'an authored step must NOT be flagged');
});

test('get_workflow_logs flags a no-op opportunity write, and only that', async () => {
  // Live differential (GROM sandbox 2026-08-31, workflow 01): every opportunity row that reached
  // the premium-actions-worker carries a populated meta.actionFrom — even the `skipped` ones,
  // because the skip verdict came FROM the worker. A `success` with an EMPTY actionFrom is the
  // manual-enrolment no-op: "Mark the card LOST" logged success twice and the card never moved.
  // And internal_notification runs successfully with an empty actionFrom, so the label must be
  // scoped to the two premium-action types or it cries wolf on every notification.
  const gw = gwStub({
    'logs/v2': { logs: [
      { id: 'r1', type: 'internal_update_opportunity', status: 'success', meta: { actionFrom: {} } },
      { id: 'r2', type: 'internal_update_opportunity', status: 'success',
        meta: { actionFrom: { channel: 'premium-actions-worker', source: 'internal_update_opportunity' } } },
      { id: 'r3', type: 'internal_create_opportunity', status: 'skipped', meta: { actionFrom: {} } },
      { id: 'r4', type: 'internal_notification', status: 'success', meta: { actionFrom: {} } },
    ] },
    'count-per-step': { counts: [] },
    'workflow-with-filter': { rows: [] },
  });
  const result = await tool('get_workflow_logs').handler({ locationId: 'L', workflowId: 'w1', limit: 20 }, deps(gw));

  const byId = Object.fromEntries(result.data.logs.map((r) => [r.id, r]));
  assert.equal(byId.r1.actionDispatched, false, 'success + empty actionFrom on an opp write is a no-op');
  assert.match(byId.r1.actionDispatchNote, /NO-OP/);
  assert.equal(byId.r2.actionDispatched, undefined, 'a write that reached the worker is untouched');
  assert.equal(byId.r3.actionDispatched, undefined, 'only success rows are flagged — a skipped row already tells the truth');
  assert.equal(byId.r4.actionDispatched, undefined, 'internal_notification legitimately runs with an empty actionFrom');
  assert.equal(result.data.logs.length, 4, 'nothing dropped');
});

test('get_workflow_logs labelling survives the bare-array response shape', async () => {
  // /workflows/logs/v2 returns a bare array, not {logs:[…]}. A consumer reaching for .logs gets
  // undefined and reports no executions for a workflow that ran.
  const gw = gwStub({
    'logs/v2': [{ id: 'l1', type: 'added_to_workflow' }, { id: 'l2', type: 'sms' }],
    'count-per-step': { counts: [] },
    'workflow-with-filter': { rows: [] },
  });
  const result = await tool('get_workflow_logs').handler({ locationId: 'L', workflowId: 'w1', limit: 20 }, deps(gw));
  assert.equal(result.data.logs.length, 2);
  assert.equal(result.data.logs[0].isLifecycleRow, true);
  assert.equal(result.data.logs[1].isLifecycleRow, undefined);
});

test('get_workflow_logs keeps its full enrollment walk and totals behaviour', async () => {
  const pages = [
    { rows: [{ _id: 'a' }, { _id: 'b' }] },
    { rows: [{ _id: 'c' }, { _id: 'd' }] },
    { rows: [{ _id: 'e' }] },
  ];
  let hit = 0;
  const gw = {
    calls: [], loc: 'L', uid: 'u',
    call: async (method, path) => {
      gw.calls.push({ method, path });
      if (path.includes('logs/v2')) return { status: 200, ok: true, json: { logs: [] } };
      if (path.includes('count-per-step')) return { status: 200, ok: true, json: { counts: [] } };
      if (path.includes('enroll-stats-cache')) {
        return { status: 200, ok: true, json: [{ workflowId: 'w1', total: 5, finished: 1 }] };
      }
      if (path.includes('workflow-with-filter')) return { status: 200, ok: true, json: pages[hit++] };
      return { status: 404, ok: false, json: {} };
    },
  };
  const result = await tool('get_workflow_logs').handler(
    { locationId: 'L', workflowId: 'w1', limit: 2, allEnrollments: true, enrollmentTotals: true },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.enrollments.length, 5);
  assert.equal(result.data.enrollmentsComplete, true);
  // FOUR requests for three pages of rows: the walk no longer treats a short page as proof of
  // exhaustion, it spends one more request to see the server return nothing. That is the rule
  // the log walk already follows, and dropping it here is what let a roster stall look complete.
  // The dedupe and re-served-page behaviour this protects is covered in read-tools.test.mjs,
  // against a fake that honours the cursor — this one only pins the totals wiring.
  assert.equal(result.data.enrollmentPages, 4);
  assert.equal(result.data.enrollmentStats.total, 5);
  assert.equal(result.data.enrollmentStats.source, 'enroll-stats-cache');
});

test('get_contacts_at_step keeps walking details-by-step to the reported total', async () => {
  const gw = {
    calls: [], loc: 'L', uid: 'u',
    call: async (method, path) => {
      gw.calls.push({ method, path });
      const skip = Number(new URL(`http://x${path}`).searchParams.get('skip'));
      const rows = skip === 0
        ? [{ _id: 's1', contactId: 'c1' }, { _id: 's2', contactId: 'c2' }]
        : [{ _id: 's3', contactId: 'c3' }];
      return { status: 200, ok: true, json: { totalCount: 3, rows } };
    },
  };
  const result = await tool('get_contacts_at_step').handler(
    { locationId: 'L', workflowId: 'w1', stepId: 'step9', limit: 2 },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.total, 3);
  assert.equal(result.data.contacts.length, 3);
  assert.equal(result.data.complete, true);
});

// The exported key list must equal the one this file already pins against real collector
// results, so README checks built on the export cannot drift from the contract itself.
test('RUNTIME_WINDOW_RESULT_KEYS equals the result contract this file pins', async () => {
  const { RUNTIME_WINDOW_RESULT_KEYS } = await import('../core/workflow-runtime-window.mjs');
  assert.deepEqual([...RUNTIME_WINDOW_RESULT_KEYS].sort(), [...RESULT_KEYS].sort());
});
