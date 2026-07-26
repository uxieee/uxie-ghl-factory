// RED tests for core/audit-configuration.mjs (Task 4, Steps 1-3 of
// docs/superpowers/plans/2026-07-24-internal-mcp-audit-read-profile.md, plan lines 503-569).
//
// Neither composite exists yet. This file IS the contract:
//
//   export async function listWorkflowsComplete({ auditGateway, input })
//   export async function getAiConfigurationBundle({ auditGateway, input })
//
// Four properties drive every assertion below, and each exists because its opposite is a
// silent, publishable lie:
//
//   1. EMPTY IS NOT FAILED. `list_account_entities` converts a failed or malformed AI read
//      into `agents: []` (skills/create-ghl-workflow/engine/orchestrate.mjs, `catch { return
//      {} }` plus `arrayFrom(...) ?? []`). Plan line 550 forbids that here. Every failure
//      path below is asserted to produce complete:false with items null or with retained
//      evidence — never an empty array standing in for a read that did not happen.
//   2. THE ONLY WAY OUT IS `callCapability`, and never with a caller-supplied `descriptors`
//      list (Task 2 carry-forward item 7). The fake gateway exposes a `call` that throws and
//      refuses any args object carrying `descriptors`.
//   3. THE SPLIT ERROR MODEL HAS TWO HALVES. Policy faults THROW with `.code`; response
//      faults RETURN `ok:false` plus a `failureClass`. A composite that models only one half
//      turns the other into an empty-but-complete surface. Both halves are exercised, and
//      the blast radius of each circuit scope is proven against the REAL audit gateway.
//   4. NOTHING IS TIMED, RANDOM, OR WALL-CLOCKED. Capture times come from the reads
//      themselves, the limiter is injected with a stub clock and a stub sleep, and two
//      identical runs must serialize identically.
//
// THE HARNESS RULE THIS FILE WAS WRITTEN AROUND. Task 3's first fake gateway derived the
// declared enrollment total from the very rows it was about to serve, so every `complete:true`
// rested on a reconciliation that could not fail. Here, declared totals, page counts and
// roster sizes are INDEPENDENT FIXTURE INPUTS written as literals into the JSON — see the
// test named "declared totals are independent fixture inputs, never derived from the served
// rows", which asserts that mechanically rather than by convention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AUDIT_CAPABILITIES } from '../core/audit-capabilities.mjs';
import { makeAuditCircuit, makeAuditGateway, makeAuditLimiter } from '../core/audit-gateway.mjs';
import { AUDIT_TOOL_NAMES } from '../core/audit-profile.mjs';
import { TOOLS, processAuditPacing } from '../core/tools.mjs';
import {
  AI_BUNDLE_CAPABILITY_IDS,
  AI_BUNDLE_CAPABILITY_VERSION,
  AI_BUNDLE_COMPONENTS,
  AI_BUNDLE_DEFAULTS,
  AI_BUNDLE_ERROR_CODES,
  AI_DISCOVERY_PAGE_SIZE,
  AUDIT_CONFIGURATION_CONTRACT_VERSION,
  ROSTER_CAPABILITY_IDS,
  ROSTER_CAPABILITY_VERSION,
  ROSTER_DEFAULTS,
  getAiConfigurationBundle,
  isAiBundleErrorCode,
  listWorkflowsComplete,
  resolveConfigurationDescriptors,
} from '../core/audit-configuration.mjs';

const LOC = 'LOC1';
const COMPANY = 'COMP1';
const CAPTURED_AT = '2026-07-24T00:00:00.000Z';

// --- the closed warning vocabularies -------------------------------------------
// Closed on purpose: an auditor BRANCHES on these codes, and a free-text reason cannot be
// branched on. Anything either composite emits must be one of these.

const ROSTER_WARNING_CODES = Object.freeze([
  // Added 2026-07-27 with the envelope-reader settlement: one 200 carrying two contradictory
  // readings of itself. Distinct from ROSTER_PAGE_READ_FAILED ("no key I know") because an
  // auditor acts on them differently — that one is a rail that has fallen behind the API,
  // this one is an upstream response that disagrees with itself.
  'ROSTER_ENVELOPE_CONFLICT',
  'ROSTER_DUPLICATE_ID_CONFLICT',
  'ROSTER_TOTAL_CHANGED',
  'ROSTER_TOTAL_UNAVAILABLE',
  'ROSTER_TOTAL_MISMATCH',
  // The OVER-count. Added by adversarial review: the equality terminal at
  // `uniqueCount === reportedTotal` survived relaxation to `>=` because no fixture could
  // reach the branch, and the correct code answered an over-count by burning the whole page
  // budget and then blaming the budget.
  'ROSTER_TOTAL_OVERCOUNT',
  'ROSTER_EMPTY_PAGE',
  'ROSTER_NO_UNIQUE_PROGRESS',
  'ROSTER_ROW_MALFORMED',
  'ROSTER_ROW_ID_MISSING',
  'ROSTER_PAGE_BUDGET_EXHAUSTED',
  'ROSTER_PAGE_READ_FAILED',
  'IDENTITY_CONFLICT_QUARANTINE',
  'IDENTITY_INSPECTION_INCOMPLETE',
  'RATE_LIMITED',
  'CIRCUIT_OPEN',
]);

const AI_WARNING_CODES = Object.freeze([
  'AI_DISCOVERY_READ_FAILED',
  'AI_DISCOVERY_UNREADABLE',
  // The AI twin of ROSTER_ENVELOPE_CONFLICT, added with the same settlement and separate from
  // AI_DISCOVERY_UNREADABLE for the same reason.
  'AI_DISCOVERY_ENVELOPE_CONFLICT',
  'AI_DISCOVERY_ROW_MALFORMED',
  'AI_DISCOVERY_ROW_ID_MISSING',
  // Added by adversarial review: discovery silently collapsed two rows sharing an id, so a
  // tombstone arriving first classified a LIVE agent out of the audit with complete:true.
  'AI_DISCOVERY_DUPLICATE_ID_CONFLICT',
  'AI_DISCOVERY_PAGE_BUDGET_EXHAUSTED',
  'AI_DISCOVERY_NO_UNIQUE_PROGRESS',
  'AI_DISCOVERY_TOTAL_MISMATCH',
  // Added by adversarial review: the walk kept no history of the totals it was given, so it
  // reconciled against the terminal page's copy alone. A total of 500 on page 1 followed by a
  // short page reporting 150 — or reporting none at all — published 150 agents as the complete,
  // applicable surface with zero warnings.
  'AI_DISCOVERY_TOTAL_CHANGED',
  'AI_DISCOVERY_TOTAL_DISAPPEARED',
  'AI_DETAIL_READ_FAILED',
  'AI_DETAIL_UNREADABLE',
  // Added by adversarial review: a detail read was never checked against the id it was issued
  // for, so a response about another agent was published as this one's configuration.
  'AI_DETAIL_IDENTITY_MISMATCH',
  'AI_DELETION_SIGNAL_AMBIGUOUS',
  'AI_COMPANY_CONTEXT_UNAVAILABLE',
  'AI_RAIL_UNAVAILABLE',
  'AI_POLICY_REFUSED',
  'IDENTITY_CONFLICT_QUARANTINE',
  'IDENTITY_INSPECTION_INCOMPLETE',
  'RATE_LIMITED',
  'CIRCUIT_OPEN',
]);

// ONE warning shape, whatever emitted it (Task 3 carry-forward). A consumer summing
// `occurrences` across this array must never meet `undefined`.
const WARNING_KEYS = Object.freeze(['code', 'component', 'detail', 'detailSamples', 'occurrences']);

// Asserted as a SET so a field cannot be quietly dropped (a missing `truncated` reads as
// falsy = "nothing was cut") nor a private scratch field leaked into a published artifact.
const ROSTER_RESULT_KEYS = Object.freeze([
  'appliedQueries', 'boundLocationId', 'capabilityVersion', 'capturedAt', 'complete',
  'envelopeShape', 'locationBinding', 'pagination', 'rateLimit', 'reportedTotal',
  'sourceRoutes', 'terminalReason', 'totalHistory', 'truncated', 'uniqueCount',
  'uniqueProgress', 'warnings', 'workflows',
]);

const BUNDLE_RESULT_KEYS = Object.freeze([
  'appliedQueries', 'boundLocationId', 'capabilityVersion', 'capturedAt', 'companyId',
  'complete', 'components', 'contractVersion', 'locationBinding', 'rateLimit', 'truncated',
  'warnings',
]);

// The plan's per-component shape (line 546), plus the three fields the plan's list could not
// express: `errors` is its "stable error metadata"; `detailDenominator` and `detailsRead` are
// what make the tombstone exclusion observable rather than merely asserted in prose.
//
// DELIBERATELY NOT Task 3's flat `componentCompleteness` boolean map (Task 3 carry-forward):
// these components are independent PAGINATED ACCOUNT SURFACES, each with its own page walk
// and route set, any of which may be inapplicable. Task 3's are facets of ONE workflow read,
// every one of which is always applicable. Task 11 consumes both; neither may be forced onto
// the other's shape.
//
// `totalHistory` is the roster's field, per component: one entry per page READ, `null` where
// that page reported no total. It is published rather than kept private because the defect it
// closes is invisible from any other field — a walk that latched 500 and finished with 150 rows
// and a walk that was never told anything are otherwise the same artifact.
const COMPONENT_KEYS = Object.freeze([
  'applicable', 'complete', 'detailDenominator', 'detailsRead', 'envelopeShape', 'errors',
  'items', 'pages', 'sourceRoutes', 'totalHistory',
]);

// --- fixtures -------------------------------------------------------------------

const loadFixture = (file) => JSON.parse(
  readFileSync(new URL(`./fixtures/audit-configuration/${file}.json`, import.meta.url), 'utf8'),
);
const ROSTER_FIXTURES = loadFixture('workflow-roster');
const AI_FIXTURES = loadFixture('ai-configuration');

// `{ generate: {...} }` expands to N rows so a 100-row page costs one readable line.
const expandRows = (page) => {
  if (page?.generate) {
    const { count, idPrefix } = page.generate;
    return Array.from({ length: count }, (_, i) => ({ _id: `${idPrefix}${i}`, name: `${idPrefix}${i}` }));
  }
  return page?.rows ?? [];
};

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

// --- descriptor-enforcing policy check shared by both fake gateways --------------
// The stub validates every call against the REAL descriptors before serving a body. A
// lenient stub is worse than no stub here: five of the roster's seven required query keys
// are pinned to fixed values, so a composite that forgot one, or sent a page size the
// descriptor bounds forbid, would get a plausible page back from a permissive fake and the
// receipt would then claim a request the real gateway would have refused outright.

const capabilityOf = (capabilityId) => {
  const found = AUDIT_CAPABILITIES.find((candidate) => candidate.capabilityId === capabilityId);
  assert.ok(found, `the composite called an unknown capability: ${capabilityId}`);
  return found;
};

const appliedPathFor = (capability, typedBindings) => capability.normalizedPath
  .split('/')
  .map((segment) => {
    if (!(segment.startsWith('{') && segment.endsWith('}'))) return segment;
    const target = capability.pathBindings[segment.slice(1, -1)];
    const value = typedBindings[target];
    assert.notEqual(value, undefined, `${capability.capabilityId} needs a typed ${target}`);
    return encodeURIComponent(String(value));
  })
  .join('/');

function assertDescriptorPolicy({ capabilityId, typedBindings, query }, { locationId }) {
  const capability = capabilityOf(capabilityId);
  const declared = new Set([...capability.requiredQueryKeys, ...capability.optionalQueryKeys]);

  for (const key of Object.keys(query)) {
    assert.ok(declared.has(key), `${capabilityId} does not declare query key ${key} (UNKNOWN_QUERY_KEY)`);
    assert.ok(!Array.isArray(query[key]), `${capabilityId} may not repeat query key ${key} (DUPLICATE_QUERY_KEY)`);
  }
  for (const key of capability.requiredQueryKeys) {
    assert.ok(Object.hasOwn(query, key), `${capabilityId} requires query key ${key} (MISSING_QUERY_KEY)`);
    assert.notEqual(String(query[key]).trim(), '', `${capabilityId} requires a non-empty ${key} (MISSING_QUERY_KEY)`);
  }
  for (const [key, expected] of Object.entries(capability.fixedQueryValues)) {
    if (!Object.hasOwn(query, key)) continue;
    assert.equal(String(query[key]), String(expected), `${capabilityId} pins ${key} (FIXED_QUERY_VALUE_MISMATCH)`);
  }
  for (const [key, allowed] of Object.entries(capability.allowedQueryValues)) {
    if (!Object.hasOwn(query, key)) continue;
    assert.ok(allowed.map(String).includes(String(query[key])), `${capabilityId} disallows that ${key} (DISALLOWED_QUERY_VALUE)`);
  }
  for (const [key, bounds] of Object.entries(capability.numericQueryBounds)) {
    if (!Object.hasOwn(query, key)) continue;
    const raw = String(query[key]);
    assert.match(raw, /^\d+$/, `${capabilityId} needs an unsigned integer ${key} (QUERY_BOUND_VIOLATION)`);
    const numeric = Number(raw);
    if (bounds.min !== undefined) assert.ok(numeric >= bounds.min, `${capabilityId} ${key} below bound`);
    if (bounds.max !== undefined) assert.ok(numeric <= bounds.max, `${capabilityId} ${key} above bound`);
  }
  if (capability.locationBinding === 'query') {
    assert.equal(String(query.locationId), locationId, `${capabilityId} must query the bound location`);
  }
  if (typedBindings.locationId !== undefined) {
    assert.equal(String(typedBindings.locationId), locationId, `${capabilityId} must be typed with the bound location`);
  }
  for (const [key, target] of Object.entries(capability.queryBindings)) {
    if (!Object.hasOwn(query, key)) continue;
    assert.notEqual(typedBindings[target], undefined, `${capabilityId} must type ${target} for ${key} (BINDING_MISMATCH)`);
    assert.equal(String(query[key]), String(typedBindings[target]), `${capabilityId} ${key} must equal the typed ${target}`);
  }
  // The per-product seal. A flat product-agnostic list would let a Voice id probe the
  // Conversation-AI and Agent-Studio detail routes with a perfectly plausible id, so the
  // stub enforces the same OWN-property, per-discovery-capability rule the gateway does.
  if (Object.values(capability.pathBindings).includes('agentId')) {
    const sealed = typedBindings.discoveredAgentIds;
    assert.ok(sealed && typeof sealed === 'object' && !Array.isArray(sealed),
      `${capabilityId} needs discoveredAgentIds keyed by discovery capability id (BINDING_MISMATCH)`);
    assert.ok(Object.hasOwn(sealed, capability.sealedBy),
      `${capabilityId} must be sealed under its OWN discovery capability ${capability.sealedBy}, not another product's`);
    assert.ok(Array.isArray(sealed[capability.sealedBy]), `${capabilityId} seal must be an array of ids`);
    assert.ok(sealed[capability.sealedBy].map(String).includes(String(typedBindings.agentId)),
      `${capabilityId} was asked for an agent outside its sealed discovery result (BINDING_MISMATCH)`);
  }
  return capability;
}

const baseIdentity = (over = {}) => ({
  bindingMethod: 'request_scope',
  checked: [],
  conflicts: [],
  unreadable: [],
  inspectionCapped: false,
  depthCapped: false,
  ...over,
});

// Every fake gateway shares this preamble: it is where "the composite must never forward a
// descriptors list" and "the audit rail is GET-only" are enforced.
function recordCall(calls, args, { locationId }) {
  assert.ok(args && typeof args === 'object', 'callCapability takes an options object');
  assert.equal(Object.hasOwn(args, 'descriptors'), false,
    'a composite must never forward a `descriptors` list to the audit gateway (Task 2 carry-forward item 7)');
  const { capabilityId, typedBindings = {}, query = {}, method = 'GET' } = args;
  assert.equal(method, 'GET', 'the audit rail is GET-only');
  const capability = assertDescriptorPolicy({ capabilityId, typedBindings, query }, { locationId });
  const nth = calls.filter((call) => call.capabilityId === capabilityId).length + 1;
  calls.push({ capabilityId, nth, typedBindings: { ...typedBindings }, query: { ...query } });
  return { capability, nth, typedBindings, query };
}

const respond = (capability, typedBindings, query, json, override = {}) => {
  const { identity: identityOver, ...rest } = override;
  return {
    capabilityId: capability.capabilityId,
    host: capability.host,
    appliedPath: appliedPathFor(capability, typedBindings),
    appliedQuery: { ...query },
    status: 200,
    ok: true,
    json,
    identity: baseIdentity(identityOver ?? {}),
    quarantined: false,
    failureClass: null,
    retryAfterMs: null,
    capturedAt: CAPTURED_AT,
    ...rest,
  };
};

// --- the fake roster gateway -----------------------------------------------------

function makeRosterGateway(spec, { locationId = LOC } = {}) {
  const calls = [];
  const pages = spec.pages ?? [];
  let rawCallAttempts = 0;
  let served = 0;

  return {
    locationId,
    calls,
    get rawCallAttempts() { return rawCallAttempts; },
    // audit-gateway.mjs returns exactly { callCapability, locationId }; there is no raw
    // passthrough by design. This exists purely to catch a composite that reaches for one.
    call() {
      rawCallAttempts += 1;
      throw new Error('RAW_CALL_FORBIDDEN: audit reads must go through callCapability');
    },
    async callCapability(args) {
      const { capability, typedBindings, query } = recordCall(calls, args, { locationId });
      assert.equal(capability.capabilityId, 'workflow_roster_list',
        'listWorkflowsComplete may only read the roster capability');
      const page = pages[served];
      assert.ok(page, `the walk requested page ${served + 1} but the fixture declares only ${pages.length}`);
      served += 1;
      if (page.throwCode) {
        const error = new Error(`${page.throwCode}: injected by fixture`);
        error.code = page.throwCode;
        if (page.meta) error.meta = page.meta;
        throw error;
      }
      // `body` serves a RAW envelope, bypassing the envelope construction below. It exists so
      // an unreadable 200 is reachable on the roster as it already was on the AI gateway:
      // without it, `readRows(...).rows === null` could only ever be a hypothesis, and
      // relaxing it to `readRows(...).rows ?? []` — which turns "I could not read this" into
      // "there was nothing", the exact doctrine this module is built on — survived the whole
      // suite.
      if (Object.hasOwn(page, 'body')) {
        return respond(capability, typedBindings, query, page.body, page.gateway ?? {});
      }
      const rows = expandRows(page);
      // THE DEFAULT IS THE LIVE-OBSERVED ENVELOPE: `{rows, count}`, per
      // ghl-internal-api-research/docs/03-endpoints.md:167 and the openapi.json entry stamped
      // x-proof "live-runtime" (2026-07-21). It used to be `{workflows, total}`, which no
      // captured response has ever carried — so every scenario in this file agreed with a
      // shape the rail would never meet, and the one envelope that actually matters was the
      // one nothing tested. Defaulting here rather than per-scenario is deliberate: it puts
      // all 21 pre-existing scenarios onto the real shape at once. `envelopeKeys` overrides
      // it for the scenarios that exist to prove the legacy keys still read.
      const envelope = page.envelopeKeys ?? spec.envelopeKeys ?? { rowsKey: 'rows', totalKey: 'count' };
      const json = { [envelope.rowsKey]: rows };
      // `total` is an INDEPENDENT fixture input: the scenario's declaredTotal, or an
      // explicit per-page override. It is never computed from `rows`.
      if (!page.omitTotal) json[envelope.totalKey] = page.total ?? spec.declaredTotal;
      // A SECOND, CONTRADICTORY reading of the same response, served under a different key —
      // both literals, never derived, so the contradiction is the fixture's claim and not an
      // artifact of how the harness expanded something.
      if (page.alsoRows) json[page.alsoRows.key] = page.alsoRows.rows;
      if (page.alsoTotal) json[page.alsoTotal.key] = page.alsoTotal.value;
      return respond(capability, typedBindings, query, json, page.gateway ?? {});
    },
  };
}

// --- the fake AI gateway ---------------------------------------------------------

const AI_DISCOVERY_OF = Object.freeze({
  conversation_ai: 'conversation_ai_agent_discovery',
  voice_ai: 'voice_ai_agent_discovery',
  agent_studio: 'agent_studio_agent_discovery',
});
const AI_DETAIL_OF = Object.freeze({
  conversation_ai: 'conversation_ai_agent_detail',
  voice_ai: 'voice_ai_agent_detail',
  agent_studio: 'agent_studio_agent_detail',
});
const COMPONENT_OF_CAPABILITY = Object.freeze(Object.fromEntries([
  ...Object.entries(AI_DISCOVERY_OF).map(([component, id]) => [id, component]),
  ...Object.entries(AI_DETAIL_OF).map(([component, id]) => [id, component]),
]));

function makeAiGateway(spec, { locationId = LOC } = {}) {
  const calls = [];
  const components = spec.components ?? {};
  let rawCallAttempts = 0;

  const discoveryBody = (component, capability, query, nth) => {
    const declared = components[component] ?? {};
    const pages = declared.discovery ?? [];
    // Agent Studio is the only paginated discovery route; the other two descriptors declare
    // locationId as their sole query key, so a second call to them is a defect, not a page.
    const index = component === 'agent_studio' ? Number(query.page) - 1 : 0;
    if (component !== 'agent_studio') {
      assert.equal(nth, 1, `${capability.capabilityId} has no page parameter and may be called only once`);
    }
    const page = pages[index];
    assert.ok(page, `${component} discovery requested page ${index + 1} but the fixture declares only ${pages.length}`);
    if (Object.hasOwn(page, 'body')) return { json: page.body, override: page.gateway ?? {} };
    const rows = expandRows(page);
    // `agents`/`total` remains the DEFAULT because it is what the pre-existing scenarios were
    // written against, but it is no longer the only shape reachable. The captured AI
    // envelopes differ per route and were outside the old key lists in one half or the other:
    // `/agent-studio/agents-with-folders` answers `{items, total, totalAgents, totalFolders}`
    // (captured 2026-07-11) and the `/ai-employees` search routes answer
    // `{employees, totalCount, count}`. `envelopeKeys` on a page selects one.
    const envelope = page.envelopeKeys ?? declared.envelopeKeys ?? { rowsKey: 'agents', totalKey: 'total' };
    const json = { [envelope.rowsKey]: rows };
    // An INDEPENDENT fixture input, and now a PER-PAGE one, exactly as on the roster: the
    // component's declaredTotal, an explicit per-page `total` override, or `omitTotal` to drop
    // it from that page entirely.
    //
    // WHY THE PER-PAGE FORM EXISTS (adversarial review). This used to write the ONE
    // component-level `declaredTotal` onto EVERY page, so no fixture could express a total that
    // MOVES or DISAPPEARS across pages — the harness could not state the defect, let alone
    // catch it, and the AI walk duly reconciled against only the terminal page's copy while
    // discarding every earlier one in silence. That is the Task 3 carry-forward in its purest
    // form: an oracle shaped by what the harness can say rather than by what production can do.
    const total = Object.hasOwn(page, 'total') ? page.total : declared.declaredTotal;
    if (!page.omitTotal && total !== undefined) json[envelope.totalKey] = total;
    // A second, literal, contradictory reading of the same discovery response — the AI twin
    // of the roster harness's alsoRows/alsoTotal, and never derived from `rows`.
    if (page.alsoRows) json[page.alsoRows.key] = page.alsoRows.rows;
    if (page.alsoTotal) json[page.alsoTotal.key] = page.alsoTotal.value;
    return { json, override: page.gateway ?? {} };
  };

  const detailBody = (component, typedBindings) => {
    const id = String(typedBindings.agentId);
    const declared = components[component] ?? {};
    const entry = (declared.details ?? {})[id];
    if (entry && Object.hasOwn(entry, 'body')) return { json: entry.body, override: entry.gateway ?? {} };
    if (entry?.gateway) return { json: null, override: entry.gateway };
    // `detailDefault` fails EVERY detail read on a component without naming ids one by one.
    // It exists for the ballast measurement: a per-item code is unbounded in the size of the
    // account's data, and a corpus large enough to show that cannot be written out by hand.
    if (declared.detailDefault) return { json: null, override: declared.detailDefault };
    return { json: { _id: id, locationId, name: id }, override: {} };
  };

  return {
    locationId,
    calls,
    get rawCallAttempts() { return rawCallAttempts; },
    call() {
      rawCallAttempts += 1;
      throw new Error('RAW_CALL_FORBIDDEN: audit reads must go through callCapability');
    },
    async callCapability(args) {
      const { capability, nth, typedBindings, query } = recordCall(calls, args, { locationId });
      const component = COMPONENT_OF_CAPABILITY[capability.capabilityId];
      assert.ok(component, `getAiConfigurationBundle may only read AI capabilities, got ${capability.capabilityId}`);
      const isDiscovery = AI_DISCOVERY_OF[component] === capability.capabilityId;
      const { json, override } = isDiscovery
        ? discoveryBody(component, capability, query, nth)
        : detailBody(component, typedBindings);
      return respond(capability, typedBindings, query, json, override);
    },
  };
}

// --- shared assertion vocabulary -------------------------------------------------

const callsTo = (gateway, capabilityId) => gateway.calls.filter((call) => call.capabilityId === capabilityId);
const warningCodesOf = (result) => [...new Set((result.warnings ?? []).map((warning) => warning.code))].sort();

function assertUniformWarningShape(result, context) {
  for (const [index, warning] of (result.warnings ?? []).entries()) {
    assert.deepEqual(
      Object.keys(warning).sort(), [...WARNING_KEYS].sort(),
      `${context}.warnings[${index}] (${warning.code}) has a different key set from every other warning`,
    );
    assert.ok(Number.isSafeInteger(warning.occurrences) && warning.occurrences >= 1,
      `${context}.warnings[${index}] (${warning.code}) must carry a real occurrence count`);
    assert.ok(Array.isArray(warning.detailSamples) && warning.detailSamples.length >= 1,
      `${context}.warnings[${index}] (${warning.code}) must carry at least the detail it reported`);
    assert.equal(warning.detailSamples[0], warning.detail,
      `${context}.warnings[${index}] (${warning.code}): detail must stay the first occurrence's text`);
    assert.equal(typeof warning.component, 'string',
      `${context}.warnings[${index}] (${warning.code}) must name the component it is about`);
  }
}

// --- roster: the fixture-driven suite ---------------------------------------------

const runRoster = async (spec, extraInput = {}) => {
  const gateway = makeRosterGateway(spec);
  const input = { locationId: LOC, ...(spec.input ?? {}), ...extraInput };
  const result = await listWorkflowsComplete({ auditGateway: gateway, input });
  return { gateway, result };
};

function assertRosterExpectations(result, gateway, expected) {
  const has = (key) => Object.hasOwn(expected, key);
  const rosterCalls = callsTo(gateway, 'workflow_roster_list');

  if (has('offsets')) {
    assert.deepEqual(rosterCalls.map((call) => Number(call.query.offset)), expected.offsets,
      'the emitted offset sequence does not match; the walk must advance by the rows it actually received');
  }
  if (has('firstQuery')) {
    assert.deepEqual(rosterCalls[0].query, expected.firstQuery,
      'the first roster query must carry exactly the descriptor-declared keys and pinned values');
  }
  if (has('workflowIds')) {
    assert.deepEqual((result.workflows ?? []).map((row) => String(row._id ?? row.id)), expected.workflowIds);
  }
  if (has('workflowsNull')) {
    // null, not []: an empty array is a claim that the account has no workflows, and this
    // rail may not make a claim it did not observe.
    assert.equal(result.workflows, null, 'a roster that never read a page must be null, never []');
  }
  if (has('envelopeShape')) {
    // The keys the walk MET, asserted against a literal. A rail that quietly stopped reading
    // one of the two key families would still reconcile the scenarios that use the other, so
    // the observation itself is pinned rather than only its consequences.
    assert.deepEqual(result.envelopeShape, expected.envelopeShape,
      'the recorded envelope shape must name exactly the keys this walk actually read');
  }
  if (has('uniqueCount')) assert.equal(result.uniqueCount, expected.uniqueCount);
  if (has('reportedTotal')) assert.equal(result.reportedTotal, expected.reportedTotal);
  if (has('totalHistory')) assert.deepEqual(result.totalHistory, expected.totalHistory);
  if (has('uniqueProgress')) assert.deepEqual(result.uniqueProgress, expected.uniqueProgress);
  if (has('pagesFetched')) assert.equal(result.pagination.fetched, expected.pagesFetched);
  if (has('pagesExhausted')) assert.equal(result.pagination.exhausted, expected.pagesExhausted);
  if (has('terminalReason')) assert.equal(result.terminalReason, expected.terminalReason);
  if (has('quarantined')) assert.equal(result.locationBinding.quarantined, expected.quarantined);
  if (has('rateLimited')) assert.equal(result.rateLimit.limited, expected.rateLimited);
  if (has('retryAfterMs')) assert.equal(result.rateLimit.retryAfterMs, expected.retryAfterMs);
  if (has('complete')) assert.equal(result.complete, expected.complete);
  if (has('truncated')) assert.equal(result.truncated, expected.truncated);
  if (has('warningCodes')) assert.deepEqual(warningCodesOf(result), [...expected.warningCodes].sort());

  for (const warning of result.warnings ?? []) {
    assert.ok(ROSTER_WARNING_CODES.includes(warning.code), `unknown roster warning code ${warning.code}`);
  }
  assertUniformWarningShape(result, 'roster');
  assert.equal(result.complete, !result.truncated, 'complete and truncated are exact complements');
  if (result.complete === false) assert.ok(result.warnings.length > 0, 'an incomplete roster must say why');
  if (result.complete === true) {
    assert.equal(result.terminalReason, 'unique_count_equals_reported_total',
      'a complete roster must name the terminal proof it reached');
    assert.equal(result.uniqueCount, result.reportedTotal,
      'a complete roster reconciles its unique count against a STABLE reported total');
  }
  if (result.rateLimit.limited === true) {
    assert.equal(result.complete, false, 'a throttled walk may not be published as complete');
  }
  for (const route of result.sourceRoutes) {
    assert.equal(route.host, 'backend', 'the roster route is on the backend/jwt rail');
  }
}

for (const [name, spec] of Object.entries(ROSTER_FIXTURES.scenarios)) {
  test(`workflow roster: ${name} [${spec.planBullet}]`, async () => {
    const { gateway, result } = await runRoster(spec);
    assert.deepEqual(Object.keys(result).sort(), [...ROSTER_RESULT_KEYS].sort(),
      'the roster result must carry exactly the contract fields');
    assertRosterExpectations(result, gateway, spec.expect);
    assert.equal(gateway.rawCallAttempts, 0, 'the composite must not use a raw call path');
  });
}

// --- AI bundle: the fixture-driven suite -------------------------------------------

const runBundle = async (spec, extraInput = {}) => {
  const gateway = makeAiGateway(spec);
  const input = {
    locationId: LOC,
    ...(spec.omitCompanyId ? {} : { companyId: COMPANY }),
    ...(spec.input ?? {}),
    ...extraInput,
  };
  const result = await getAiConfigurationBundle({ auditGateway: gateway, input });
  return { gateway, result };
};

function assertComponentExpectations(component, expected, label) {
  const has = (key) => Object.hasOwn(expected, key);
  assert.deepEqual(Object.keys(component).sort(), [...COMPONENT_KEYS].sort(),
    `${label} must carry exactly the plan's per-component fields`);
  if (has('applicable')) assert.equal(component.applicable, expected.applicable, `${label}.applicable`);
  if (has('complete')) assert.equal(component.complete, expected.complete, `${label}.complete`);
  if (has('envelopeShape')) {
    // Per component, for the same reason the roster pins its own: the AI products answer on
    // three different routes with three different captured envelopes, so a reader that
    // quietly stopped accepting one family would still satisfy the other two.
    assert.deepEqual(component.envelopeShape, expected.envelopeShape,
      `${label}.envelopeShape must name exactly the keys this discovery walk actually read`);
  }
  if (has('itemsNull')) {
    // The forbidden fallback, stated positively: a component that could not be read is null,
    // never []. `list_account_entities` returns [] for exactly this case.
    assert.equal(component.items, null, `${label}.items must be null, never [] , when the surface could not be read`);
  }
  if (has('itemCount')) {
    assert.ok(Array.isArray(component.items), `${label}.items must be an array here`);
    assert.equal(component.items.length, expected.itemCount, `${label}.items.length`);
  }
  if (has('detailDenominator')) assert.equal(component.detailDenominator, expected.detailDenominator, `${label}.detailDenominator`);
  if (has('detailsRead')) assert.equal(component.detailsRead, expected.detailsRead, `${label}.detailsRead`);
  if (has('pagesFetched')) assert.equal(component.pages.fetched, expected.pagesFetched, `${label}.pages.fetched`);
  if (has('pagesExhausted')) assert.equal(component.pages.exhausted, expected.pagesExhausted, `${label}.pages.exhausted`);
  if (has('totalHistory')) assert.deepEqual(component.totalHistory, expected.totalHistory, `${label}.totalHistory`);
  // One entry per page READ, on every scenario rather than only where it is named: a history
  // shorter than the pages it walked is a total that was silently dropped, which is the exact
  // defect this field exists to make visible.
  assert.equal(component.totalHistory.length, component.pages.fetched,
    `${label}: totalHistory must record one entry per page actually read`);
  if (has('errorCodes')) {
    assert.deepEqual([...new Set(component.errors.map((error) => error.code))].sort(),
      [...expected.errorCodes].sort(), `${label}.errors`);
  }
  if (has('tombstoneIds')) {
    const tombstones = (component.items ?? []).filter((item) => item.tombstone === true).map((item) => String(item.id));
    assert.deepEqual(tombstones.sort(), [...expected.tombstoneIds].sort(), `${label} tombstone rows`);
    for (const item of (component.items ?? [])) {
      if (item.tombstone !== true) continue;
      // Retained as discovery evidence, excluded from the denominator, and given no detail
      // call. All three clauses, or the rule is only two thirds implemented.
      assert.equal(item.detailRead, false, `${label}: a tombstone must receive no detail call`);
      assert.equal(item.detail, null, `${label}: a tombstone carries no detail payload`);
      assert.ok(item.row && typeof item.row === 'object', `${label}: a tombstone is retained as discovery evidence`);
    }
  }
  // The denominator is the applicable rows only, and `detailsRead` can never exceed it.
  if (Array.isArray(component.items)) {
    const tombstones = component.items.filter((item) => item.tombstone === true).length;
    assert.equal(component.detailDenominator, component.items.length - tombstones,
      `${label}: the detail denominator is the discovered rows MINUS the confirmed tombstones`);
    assert.ok(component.detailsRead <= component.detailDenominator,
      `${label}: more details were counted than the denominator allows`);
    if (component.complete === true) {
      assert.equal(component.detailsRead, component.detailDenominator,
        `${label}: a complete component read a detail for every applicable discovered id`);
    }
  }
  for (const error of component.errors) {
    // The error vocabulary is CLOSED, exactly as the warning vocabularies are. It used to be
    // asserted only as `typeof === 'string'`, which is not a contract: `component.errors[].code`
    // mixes the gateway's returned failureClasses, the policy codes it throws, and this
    // module's own warning codes, and an auditor branches on all three.
    assert.ok(isAiBundleErrorCode(error.code),
      `${label}: ${error.code} is not in the closed AI_BUNDLE_ERROR_CODES vocabulary`);
    assert.equal(typeof error.capabilityId, 'string', `${label}: error metadata must name the capability`);
    assert.ok(['discovery', 'detail'].includes(error.phase), `${label}: error metadata must name the phase`);
    // Errors carry the SAME uniform shape as warnings, and for the same reason: they are
    // aggregated per (code, capabilityId, phase), so a consumer summing `occurrences` must
    // never meet undefined.
    assert.deepEqual(Object.keys(error).sort(),
      ['capabilityId', 'code', 'detail', 'detailSamples', 'occurrences', 'phase'],
      `${label}: error metadata must carry the uniform key set`);
    assert.ok(Number.isSafeInteger(error.occurrences) && error.occurrences >= 1,
      `${label}: ${error.code} must carry a real occurrence count`);
    assert.ok(Array.isArray(error.detailSamples) && error.detailSamples.length >= 1
      && error.detailSamples.length <= 3, `${label}: ${error.code} detailSamples is capped at three`);
    assert.equal(error.detailSamples[0], error.detail,
      `${label}: ${error.code} detail must stay the first occurrence's text`);
  }
  // One object per (code, capabilityId, phase). Unbounded ballast is what aggregation exists
  // to prevent, so the de-duplication is asserted rather than assumed.
  const errorKeys = component.errors.map((error) => `${error.code}::${error.capabilityId}::${error.phase}`);
  assert.equal(new Set(errorKeys).size, errorKeys.length, `${label}: errors must be aggregated, one object per key`);
  for (const route of component.sourceRoutes) {
    assert.equal(route.host, 'services', `${label}: every AI capability is on the services/ai rail`);
  }
}

function assertBundleExpectations(result, gateway, expected) {
  const has = (key) => Object.hasOwn(expected, key);

  // ALWAYS all three, whatever happened. Callers cannot omit a surface (plan line 541), so a
  // component missing from the result is the one shape this contract may never produce.
  assert.deepEqual(Object.keys(result.components).sort(), [...AI_BUNDLE_COMPONENTS].sort(),
    'the bundle must always report all three enumerated surfaces');

  if (has('capabilitySequence')) {
    assert.deepEqual(gateway.calls.map((call) => call.capabilityId), expected.capabilitySequence,
      'the emitted capability sequence does not match');
  }
  if (has('capabilityCounts')) {
    for (const [capabilityId, count] of Object.entries(expected.capabilityCounts)) {
      assert.equal(callsTo(gateway, capabilityId).length, count, `call count for ${capabilityId}`);
    }
  }
  if (has('studioPages')) {
    assert.deepEqual(callsTo(gateway, 'agent_studio_agent_discovery').map((call) => Number(call.query.page)),
      expected.studioPages, 'Agent Studio discovery pages by page NUMBER, starting at 1');
  }
  if (has('voiceDetailAgentIds')) {
    assert.deepEqual(callsTo(gateway, 'voice_ai_agent_detail').map((call) => String(call.typedBindings.agentId)),
      expected.voiceDetailAgentIds, 'the exact set of Voice ids given a detail call');
  }
  if (has('components')) {
    for (const [name, componentExpected] of Object.entries(expected.components)) {
      assertComponentExpectations(result.components[name], componentExpected, `components.${name}`);
    }
  }
  if (has('warningOccurrences')) {
    for (const [key, occurrences] of Object.entries(expected.warningOccurrences)) {
      const [code, component] = key.split('::');
      const matching = result.warnings.filter((warning) => warning.code === code && warning.component === component);
      assert.equal(matching.length, 1, `expected exactly one ${code} warning against ${component}`);
      assert.equal(matching[0].occurrences, occurrences, `${code} on ${component} occurrence count`);
    }
  }
  if (has('rateLimited')) assert.equal(result.rateLimit.limited, expected.rateLimited);
  if (has('retryAfterMs')) assert.equal(result.rateLimit.retryAfterMs, expected.retryAfterMs);
  if (has('quarantined')) assert.equal(result.locationBinding.quarantined, expected.quarantined);
  if (has('inspectionIncomplete')) assert.equal(result.locationBinding.inspectionIncomplete, expected.inspectionIncomplete);
  if (has('complete')) assert.equal(result.complete, expected.complete);
  if (has('truncated')) assert.equal(result.truncated, expected.truncated);
  if (has('warningCodes')) assert.deepEqual(warningCodesOf(result), [...expected.warningCodes].sort());

  for (const warning of result.warnings ?? []) {
    assert.ok(AI_WARNING_CODES.includes(warning.code), `unknown AI warning code ${warning.code}`);
  }
  assertUniformWarningShape(result, 'bundle');
  assert.equal(result.complete, !result.truncated, 'complete and truncated are exact complements');
  if (result.complete === false) assert.ok(result.warnings.length > 0, 'an incomplete bundle must say why');
  if (result.complete === true) {
    for (const [name, component] of Object.entries(result.components)) {
      assert.equal(component.complete, true, `complete:true with an incomplete ${name} component`);
    }
  }
  for (const [name, component] of Object.entries(result.components)) {
    // Plan line 552: UNKNOWN applicability forces Partial. `applicable:false` does NOT —
    // an unprovisioned product proven absent by a terminal read is a finding, not a gap.
    if (component.applicable === 'unknown') {
      assert.equal(component.complete, false, `${name}: unknown applicability must force incompleteness`);
      assert.equal(result.complete, false, `${name}: unknown applicability must force a Partial run`);
    }
    // The forbidden fallback, checked on EVERY scenario rather than only where it is named.
    if (component.complete === false && Array.isArray(component.items)) {
      assert.notEqual(component.items.length, 0,
        `${name}: a failed component must be null or carry retained evidence, never an empty array`);
    }
  }
  if (result.rateLimit.limited === true) {
    assert.equal(result.complete, false, 'a throttled bundle may not be published as complete');
  }
}

for (const [name, spec] of Object.entries(AI_FIXTURES.scenarios)) {
  test(`ai configuration bundle: ${name} [${spec.planBullet}]`, async () => {
    const { gateway, result } = await runBundle(spec);
    assert.deepEqual(Object.keys(result).sort(), [...BUNDLE_RESULT_KEYS].sort(),
      'the bundle result must carry exactly the contract fields');
    assertBundleExpectations(result, gateway, spec.expect);
    assert.equal(gateway.rawCallAttempts, 0, 'the composite must not use a raw call path');
  });
}

test('every fixture scenario names the plan bullet it covers and why it exists', () => {
  for (const fixture of [ROSTER_FIXTURES, AI_FIXTURES]) {
    for (const [name, spec] of Object.entries(fixture.scenarios)) {
      assert.equal(typeof spec.planBullet, 'string', `${name} must name the plan bullet it covers`);
      assert.ok(spec.planBullet.length > 10, `${name}'s planBullet must be a real citation`);
      assert.equal(typeof spec.why, 'string', `${name} must say what breaks if it is deleted`);
      assert.ok(spec.why.length > 40, `${name}'s why must be a real sentence`);
      assert.ok(spec.expect && typeof spec.expect === 'object', `${name} must assert something`);
    }
  }
});

// --- the harness rule Task 3 learned the hard way ----------------------------------

test('declared totals are independent fixture inputs, never derived from the served rows', () => {
  // Task 3's first fake gateway computed the declared enrollment total from the rows it was
  // about to serve, so total-vs-roster reconciliation was unfailable by construction and
  // every complete:true rested on a check that could not have fired. An oracle the fixture
  // supplies but production cannot is worse than no oracle.
  //
  // This test asserts the rule MECHANICALLY rather than by convention: the declared totals
  // are literals in the JSON, and the corpus contains scenarios on BOTH sides of the
  // reconciliation, so a composite that ignored the total would pass one group and fail the
  // other, and a composite that always reported incomplete would fail the first.
  const reaching = [];
  const falling = [];
  for (const [name, spec] of Object.entries(ROSTER_FIXTURES.scenarios)) {
    assert.equal(typeof spec.declaredTotal, 'number',
      `${name} must declare its total as a literal fixture input`);
    const uniqueServed = new Set((spec.pages ?? []).flatMap((page) => expandRows(page)
      .filter((row) => row && typeof row === 'object')
      .map((row) => String(row._id ?? row.id)))).size;
    if (uniqueServed === spec.declaredTotal) reaching.push(name);
    else falling.push(name);
  }
  assert.ok(reaching.length >= 3, 'some scenarios must declare a total the rows DO reach');
  assert.ok(falling.length >= 3, 'some scenarios must declare a total the rows do NOT reach');
  // The harness has no code path by which the served rows could become the declared total:
  // makeRosterGateway reads `spec.declaredTotal` / `page.total` and nothing else, and
  // makeAiGateway reads `declared.declaredTotal` and nothing else. Asserted as a source
  // property because a future refactor could reintroduce the derivation silently.
  const harness = readFileSync(new URL('./audit-configuration.test.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(harness, /total:\s*rows\.length/, 'the stub must never derive a total from its own rows');
  assert.doesNotMatch(harness, /total:\s*\w*[Rr]ows\.length/, 'the stub must never derive a total from its own rows');

  for (const [name, spec] of Object.entries(AI_FIXTURES.scenarios)) {
    const studio = spec.components?.agent_studio;
    if (!studio) continue;
    assert.equal(typeof studio.declaredTotal, 'number',
      `${name}'s agent_studio component must declare its total as a literal fixture input`);
  }
});

// --- the split error model ----------------------------------------------------------

const throwingGateway = (code, { locationId = LOC, meta = null, only = null } = {}) => {
  const calls = [];
  const inner = makeAiGateway({
    components: {
      conversation_ai: { discovery: [{ rows: [{ _id: 'ce-1' }] }] },
      voice_ai: { discovery: [{ rows: [{ _id: 'va-1' }] }] },
      agent_studio: { declaredTotal: 1, discovery: [{ rows: [{ _id: 'as-1' }] }] },
    },
  }, { locationId });
  return {
    locationId,
    calls,
    async callCapability(args) {
      calls.push(args.capabilityId);
      if (only === null || args.capabilityId === only) {
        const error = new Error(`${code}: injected`);
        error.code = code;
        if (meta) error.meta = meta;
        throw error;
      }
      return inner.callCapability(args);
    },
  };
};

test('a thrown CIRCUIT_OPEN aborts the bundle but publishes what it already read', async () => {
  // A latched circuit means stop and resume deliberately, not retry. But everything read
  // before the latch is real evidence, and discarding it forces a resumer to re-spend a
  // budget it already paid (Task 3 carry-forward: error.partial).
  const gateway = throwingGateway('CIRCUIT_OPEN', {
    meta: { scope: 'ai', reason: 'RATE_LIMITED' },
    only: 'voice_ai_agent_discovery',
  });
  await assert.rejects(
    () => getAiConfigurationBundle({ auditGateway: gateway, input: { locationId: LOC, companyId: COMPANY } }),
    (error) => {
      assert.equal(error.code, 'CIRCUIT_OPEN');
      assert.ok(error.partial, 'a thrown CIRCUIT_OPEN must carry the reads it already completed');
      assert.equal(error.partial.complete, false);
      assert.deepEqual(Object.keys(error.partial.components).sort(), [...AI_BUNDLE_COMPONENTS].sort(),
        'the partial result still reports all three surfaces');
      assert.equal(error.partial.components.conversation_ai.complete, true,
        'the surface that finished before the latch is real evidence');
      assert.equal(error.partial.components.voice_ai.items, null,
        'a surface the latch prevented reading is null, never []');
      assert.ok(error.partial.warnings.some((warning) => warning.code === 'CIRCUIT_OPEN'));
      return true;
    },
  );
});

test('a thrown CIRCUIT_OPEN aborts the roster walk but publishes what it already read', async () => {
  const gateway = makeRosterGateway({
    declaredTotal: 8,
    pages: [
      { generate: { count: 4, idPrefix: 'p1-' } },
      { throwCode: 'CIRCUIT_OPEN', meta: { scope: 'process', reason: 'RATE_LIMITED' } },
    ],
  });
  await assert.rejects(
    () => listWorkflowsComplete({ auditGateway: gateway, input: { locationId: LOC, pageSize: 4, maxPages: 100 } }),
    (error) => {
      assert.equal(error.code, 'CIRCUIT_OPEN');
      assert.ok(error.partial, 'the roster must attach the pages it already walked');
      assert.equal(error.partial.complete, false);
      assert.equal(error.partial.uniqueCount, 4);
      assert.equal(error.partial.pagination.fetched, 1);
      return true;
    },
  );
});

test('a thrown policy fault on one surface degrades that surface, never the whole run', async () => {
  // BINDING_MISMATCH, TRANSPORT_FAILED and IDENTITY_INSPECTION_FAILED all THROW rather than
  // returning ok:false. A composite that modelled a failed read as ok:false alone would let
  // every one of them escape as an uncaught error and lose the other two surfaces with it.
  for (const code of ['BINDING_MISMATCH', 'TRANSPORT_FAILED', 'IDENTITY_INSPECTION_FAILED', 'UNKNOWN_QUERY_KEY']) {
    const gateway = throwingGateway(code, { only: 'voice_ai_agent_discovery' });
    const result = await getAiConfigurationBundle({
      auditGateway: gateway,
      input: { locationId: LOC, companyId: COMPANY },
    });
    assert.equal(result.components.voice_ai.complete, false, `${code}: the affected surface must be incomplete`);
    assert.equal(result.components.voice_ai.applicable, 'unknown', `${code}: applicability is unknown`);
    assert.equal(result.components.voice_ai.items, null, `${code}: items must be null, never []`);
    assert.deepEqual(result.components.voice_ai.errors.map((error) => error.code), [code],
      `${code}: the thrown code must survive into the component's stable error metadata`);
    assert.equal(result.components.conversation_ai.complete, true, `${code}: the other surfaces stay readable`);
    assert.equal(result.components.agent_studio.complete, true, `${code}: the other surfaces stay readable`);
    assert.equal(result.complete, false, `${code}: the run may not publish as complete`);
    assert.ok(result.warnings.some((warning) => warning.code === 'AI_POLICY_REFUSED'),
      `${code}: a thrown policy fault must be stated`);
  }
});

// --- the real gateway: circuit blast radius -------------------------------------------

const deterministicLimiter = () => makeAuditLimiter({
  minimumDelayMs: 0,
  jitterMs: 0,
  sleepImpl: async () => {},
  randomImpl: () => 0,
  nowImpl: () => 0,
});

// A makeGateway-shaped rail. `callWithMeta` is the surface makeAuditGateway calls, and the
// `rail` tag is what its construction-time AUDIT_RAIL_MISMATCH check reads.
const railStub = (rail, respondTo) => ({
  rail,
  async callWithMeta(method, target, body, options) {
    const [path, search = ''] = String(target).split('?');
    const query = Object.fromEntries(new URLSearchParams(search));
    return {
      status: 200,
      ok: true,
      json: {},
      retryAfterMs: null,
      capturedAt: CAPTURED_AT,
      ...respondTo({ method, path, query, base: options?.base }),
    };
  },
});

const aiRailFor = (byPath) => railStub('ai', ({ path }) => {
  for (const [prefix, response] of Object.entries(byPath)) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return response;
  }
  return { json: { agents: [] } };
});

const backendRosterRail = () => railStub('jwt', () => ({ json: { workflows: [], total: 0 } }));

test('a 403 on one AI surface latches nothing, so the other two stay readable', async () => {
  // Task 2 reversed this deliberately: a 403 is an entitlement refusal about ONE resource,
  // not a dead credential. Under a process-wide latch this single status would have ended
  // the whole account sweep, and per-component incompleteness would be unimplementable.
  const circuit = makeAuditCircuit();
  const auditGateway = makeAuditGateway({
    gateways: {
      backend: backendRosterRail(),
      ai: aiRailFor({ '/voice-ai/agents/simple': { status: 403, ok: false, json: { message: 'no' } } }),
    },
    locationId: LOC,
    limiter: deterministicLimiter(),
    circuit,
  });
  const result = await getAiConfigurationBundle({ auditGateway, input: { locationId: LOC, companyId: COMPANY } });
  assert.equal(result.components.voice_ai.complete, false);
  assert.equal(result.components.voice_ai.items, null);
  assert.equal(result.components.conversation_ai.complete, true, 'conversation_ai must still have been read');
  assert.equal(result.components.agent_studio.complete, true, 'agent_studio must still have been read');
  assert.equal(result.complete, false);
  assert.equal(circuit.isOpen('process'), false, 'a 403 must not latch the process');
  assert.equal(circuit.isOpen('ai'), false, 'a 403 must not latch the rail');
});

test('a 401 latches the AI RAIL only, leaving the backend roster readable on the same circuit', async () => {
  const circuit = makeAuditCircuit();
  const limiter = deterministicLimiter();
  const backend = backendRosterRail();
  const auditGateway = makeAuditGateway({
    gateways: {
      backend,
      ai: aiRailFor({ '/ai-employees': { status: 401, ok: false, json: { message: 'expired' } } }),
    },
    locationId: LOC,
    limiter,
    circuit,
  });
  await assert.rejects(
    () => getAiConfigurationBundle({ auditGateway, input: { locationId: LOC, companyId: COMPANY } }),
    (error) => {
      assert.equal(error.code, 'CIRCUIT_OPEN');
      assert.equal(error.meta.scope, 'ai', 'a 401 latches the credential rail, not the process');
      assert.ok(error.partial, 'the partial evidence must survive the latch');
      return true;
    },
  );
  assert.equal(circuit.isOpen('ai'), true);
  assert.equal(circuit.isOpen('process'), false);
  // The blast radius claim, made positively: the backend rail carries a DIFFERENT credential
  // and a dead AI token must not end a workflow roster walk that has nothing to do with it.
  const roster = await listWorkflowsComplete({
    auditGateway: makeAuditGateway({ gateways: { backend, ai: aiRailFor({}) }, locationId: LOC, limiter, circuit }),
    input: { locationId: LOC },
  });
  assert.equal(roster.complete, true, 'the backend rail must be unaffected by an AI-rail latch');
});

test('a 429 latches the PROCESS, so the backend roster is blocked too', async () => {
  const circuit = makeAuditCircuit();
  const limiter = deterministicLimiter();
  const backend = backendRosterRail();
  const auditGateway = makeAuditGateway({
    gateways: {
      backend,
      ai: aiRailFor({ '/ai-employees': { status: 429, ok: false, json: {}, retryAfterMs: 4000 } }),
    },
    locationId: LOC,
    limiter,
    circuit,
  });
  await assert.rejects(
    () => getAiConfigurationBundle({ auditGateway, input: { locationId: LOC, companyId: COMPANY } }),
    (error) => {
      assert.equal(error.code, 'CIRCUIT_OPEN');
      assert.equal(error.meta.scope, 'process', 'an HTTP throttle is an account-level fact');
      return true;
    },
  );
  assert.equal(circuit.isOpen('process'), true);
  await assert.rejects(
    () => listWorkflowsComplete({
      auditGateway: makeAuditGateway({ gateways: { backend, ai: aiRailFor({}) }, locationId: LOC, limiter, circuit }),
      input: { locationId: LOC },
    }),
    (error) => {
      assert.equal(error.code, 'CIRCUIT_OPEN');
      assert.equal(error.meta.scope, 'process');
      assert.ok(error.partial, 'even a run that read nothing must publish its empty partial honestly');
      assert.equal(error.partial.workflows, null);
      return true;
    },
  );
});

test('a missing AI rail produces per-component incompleteness, not a crashed run', async () => {
  // The "no agency token captured" case. MISSING_AUTH_RAIL throws at call time with zero
  // fetches, so all six AI capabilities are unreachable — but the bundle must still return
  // a publishable artifact naming all three surfaces, because "we could not authenticate the
  // AI rail" is exactly the kind of honest incompleteness the weekly auditor reports on.
  const circuit = makeAuditCircuit();
  const auditGateway = makeAuditGateway({
    gateways: { backend: backendRosterRail() },
    locationId: LOC,
    limiter: deterministicLimiter(),
    circuit,
  });
  const result = await getAiConfigurationBundle({ auditGateway, input: { locationId: LOC, companyId: COMPANY } });
  assert.deepEqual(Object.keys(result.components).sort(), [...AI_BUNDLE_COMPONENTS].sort());
  for (const name of AI_BUNDLE_COMPONENTS) {
    const component = result.components[name];
    assert.equal(component.complete, false, `${name} must be incomplete without its rail`);
    assert.equal(component.applicable, 'unknown', `${name} applicability is unknowable without its rail`);
    assert.equal(component.items, null, `${name}.items must be null, never []`);
    assert.deepEqual(component.errors.map((error) => error.code), ['MISSING_AUTH_RAIL'],
      `${name} must record the missing rail as stable error metadata`);
  }
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some((warning) => warning.code === 'AI_RAIL_UNAVAILABLE'));
  assert.equal(circuit.isOpen('process'), false, 'a wiring gap must not latch the circuit');
});

// --- forbidden fallbacks: the sweep -------------------------------------------------

test('every failure class is an explicit incompleteness, never an empty array', async () => {
  // Plan line 550, asserted as one sweep so a new failure path cannot be added without a
  // decision about which side of this line it falls on. `list_account_entities` answers all
  // seven of these with `agents: []`, which is why it is forbidden in the audit profile.
  const cases = [
    ['malformed success', { discovery: [{ body: { unexpected: true } }] }],
    ['403', { discovery: [{ gateway: { ok: false, status: 403, failureClass: 'AUTH_REJECTED' }, rows: [] }] }],
    ['404', { discovery: [{ gateway: { ok: false, status: 404, failureClass: 'HTTP_404' }, rows: [] }] }],
    ['rate limit', { discovery: [{ gateway: { ok: false, status: 429, failureClass: 'RATE_LIMITED' }, rows: [] }] }],
    ['unusable body', { discovery: [{ gateway: { ok: false, status: 200, failureClass: 'INVALID_RESPONSE_BODY' }, body: 'a challenge page' }] }],
  ];
  for (const [label, voiceSpec] of cases) {
    const { result } = await runBundle({
      components: {
        conversation_ai: { discovery: [{ rows: [] }] },
        voice_ai: voiceSpec,
        agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
      },
    });
    const component = result.components.voice_ai;
    assert.equal(component.complete, false, `${label} must be an explicit incompleteness`);
    assert.equal(component.items, null, `${label} must not publish an empty array for a read that failed`);
    assert.equal(result.complete, false, `${label} must make the run Partial`);
    assert.ok(result.warnings.length > 0, `${label} must state a reason`);
  }

  // A missing DETAIL is the sixth: discovery succeeded, so items is a real array — but it may
  // never be the empty array, and the component may not claim completeness.
  const { result: missingDetail } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: {
        discovery: [{ rows: [{ _id: 'va-1' }] }],
        details: { 'va-1': { gateway: { ok: false, status: 404, failureClass: 'HTTP_404' } } },
      },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  assert.equal(missingDetail.components.voice_ai.complete, false);
  assert.equal(missingDetail.components.voice_ai.items.length, 1, 'the discovered row is retained as evidence');
  assert.equal(missingDetail.components.voice_ai.items[0].detail, null);
  assert.equal(missingDetail.components.voice_ai.detailsRead, 0);

  // And the seventh: unavailable required company context, which never reaches the wire.
  const { gateway, result: noCompany } = await runBundle({
    omitCompanyId: true,
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: { discovery: [{ rows: [] }] },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  assert.equal(callsTo(gateway, 'agent_studio_agent_discovery').length, 0,
    'a request known to be illegal must never be issued');
  assert.equal(noCompany.components.agent_studio.complete, false);
  assert.equal(noCompany.components.agent_studio.items, null);
});

test('an empty surface is complete ONLY after a terminal, schema-valid discovery response', async () => {
  // The two artifacts that must never converge, placed side by side. Both surfaces end with
  // zero agents; only one of them observed that fact.
  const { result: terminal } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: { discovery: [{ rows: [] }] },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  const { result: refused } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ gateway: { ok: false, status: 404, failureClass: 'HTTP_404' }, rows: [] }] },
      voice_ai: { discovery: [{ rows: [] }] },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  assert.deepEqual(terminal.components.conversation_ai.items, [], 'a proven-empty surface publishes []');
  assert.equal(terminal.components.conversation_ai.complete, true);
  assert.equal(terminal.components.conversation_ai.applicable, false);
  assert.equal(refused.components.conversation_ai.items, null, 'a refused surface publishes null');
  assert.equal(refused.components.conversation_ai.complete, false);
  assert.equal(refused.components.conversation_ai.applicable, 'unknown');
  assert.notEqual(
    JSON.stringify(terminal.components.conversation_ai),
    JSON.stringify(refused.components.conversation_ai),
    'a proven-empty surface and a refused one must never serialize identically',
  );
});

// --- the tombstone rule, at its edges -------------------------------------------------

test('the tombstone rule needs BOTH signals, and needs them schema-valid', async () => {
  // One consolidated table so a future loosening (== instead of ===, a toLowerCase, a ??
  // default supplying the missing half) fails on the exact row it would mis-grade rather
  // than on whichever scenario happens to run first.
  const rows = [
    { row: { _id: 'both', isDeleted: true, agentStatus: 'INACTIVE' }, tombstone: true, detailCall: false },
    { row: { _id: 'deleted-active', isDeleted: true, agentStatus: 'ACTIVE' }, tombstone: false, detailCall: true },
    { row: { _id: 'live-inactive', isDeleted: false, agentStatus: 'INACTIVE' }, tombstone: false, detailCall: true },
    { row: { _id: 'no-status', isDeleted: true }, tombstone: false, detailCall: true },
    { row: { _id: 'no-flag', agentStatus: 'INACTIVE' }, tombstone: false, detailCall: true },
    { row: { _id: 'string-flag', isDeleted: 'true', agentStatus: 'INACTIVE' }, tombstone: false, detailCall: true },
    // THE FOUR ROWS THAT ACTUALLY DEFEND `===`. The row above does not: `'true' == true` is
    // FALSE (the string coerces to NaN), so loose equality rejects it exactly as strict does,
    // and swapping `===` for `==` in signalOf survived all 526 tests while the fixture that
    // claimed to guard it looked convincing. These four are the reachable distinguishers —
    // `1 == true`, `'1' == true` and `[1] == true` are all TRUE, so under `==` each of them
    // grades as a tombstone, loses its detail call and drops a live agent's configuration
    // while reporting the surface complete. `0 == false` is the mirror image on the negative
    // side: under `==` it grades an unknown flag as an explicit "not deleted".
    { row: { _id: 'numeric-one-flag', isDeleted: 1, agentStatus: 'INACTIVE' }, tombstone: false, detailCall: true },
    { row: { _id: 'string-one-flag', isDeleted: '1', agentStatus: 'INACTIVE' }, tombstone: false, detailCall: true },
    { row: { _id: 'array-one-flag', isDeleted: [1], agentStatus: 'INACTIVE' }, tombstone: false, detailCall: true },
    { row: { _id: 'numeric-zero-flag', isDeleted: 0, agentStatus: 'ACTIVE' }, tombstone: false, detailCall: true },
    { row: { _id: 'lower-status', isDeleted: true, agentStatus: 'inactive' }, tombstone: false, detailCall: true },
    { row: { _id: 'null-flag', isDeleted: null, agentStatus: 'INACTIVE' }, tombstone: false, detailCall: true },
    { row: { _id: 'plain' }, tombstone: false, detailCall: true },
    { row: { _id: 'explicitly-live', isDeleted: false, agentStatus: 'ACTIVE' }, tombstone: false, detailCall: true },
  ];
  const { gateway, result } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: { discovery: [{ rows: rows.map((entry) => entry.row) }] },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  const component = result.components.voice_ai;
  const byId = new Map(component.items.map((item) => [String(item.id), item]));
  const detailed = new Set(callsTo(gateway, 'voice_ai_agent_detail').map((call) => String(call.typedBindings.agentId)));
  for (const { row, tombstone, detailCall } of rows) {
    const item = byId.get(row._id);
    assert.ok(item, `${row._id} must be retained as discovery evidence whatever its grade`);
    assert.equal(item.tombstone, tombstone, `${row._id} tombstone grade`);
    assert.equal(detailed.has(row._id), detailCall, `${row._id} detail call`);
  }
  assert.equal(component.detailDenominator, rows.length - 1, 'exactly one row leaves the denominator');
  assert.equal(component.complete, false,
    'the ambiguous rows keep the component incomplete even though every detail read succeeded');
  const ambiguous = result.warnings.filter((warning) => warning.code === 'AI_DELETION_SIGNAL_AMBIGUOUS');
  assert.equal(ambiguous.length, 1, 'the ambiguity warning aggregates to one object per component');
  assert.equal(ambiguous[0].component, 'voice_ai');
  // 'plain' and 'explicitly-live' carry no ambiguity: an absent or explicitly-false deletion
  // field is an ordinary live agent, not an unknown one. If they counted, every real account
  // would report Voice AI as permanently unreadable.
  //
  // The count moved from 7 to 11 when the four loose-equality rows were added. It is asserted
  // exactly rather than as a floor because `numeric-zero-flag` is only distinguishable from a
  // `==` mutant by this number: under `==` it grades LIVE (not ambiguous) and still receives a
  // detail call, so the detail-call table above cannot see the difference and the occurrence
  // count is the only witness.
  assert.equal(ambiguous[0].occurrences, 11,
    'exactly the eleven half-signalled rows are ambiguous: the tombstone, the plain row and the explicitly-live row are not');
});

test('a confirmed tombstone never receives a detail call, even when its detail would succeed', async () => {
  // The detail route is FORBIDDEN for a soft-deleted agent, so calling it spends a 403 on a
  // row the rail already understands. The stub would happily serve one; the composite must
  // not ask.
  const { gateway, result } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: {
        discovery: [{ rows: [{ _id: 'va-dead', isDeleted: true, agentStatus: 'INACTIVE' }] }],
        details: { 'va-dead': { body: { _id: 'va-dead', locationId: LOC, secret: 'should never be read' } } },
      },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  assert.equal(callsTo(gateway, 'voice_ai_agent_detail').length, 0);
  assert.equal(result.components.voice_ai.detailDenominator, 0);
  assert.equal(result.components.voice_ai.items.length, 1, 'the tombstone is retained as discovery evidence');
  assert.equal(result.components.voice_ai.items[0].detail, null);
  assert.equal(result.components.voice_ai.complete, true, 'a surface of tombstones is completely read');
});

test('the tombstone rule is Voice-specific evidence, not a licence to skip other products', async () => {
  // The rule is stated for the Voice discovery route. If a Conversation-AI or Agent-Studio
  // row happened to carry the same two fields, skipping its detail would drop a live
  // configuration on the strength of a schema this rail has never observed on that route.
  const deleted = { isDeleted: true, agentStatus: 'INACTIVE' };
  const { gateway } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [{ _id: 'ce-1', ...deleted }] }] },
      voice_ai: { discovery: [{ rows: [] }] },
      agent_studio: { declaredTotal: 1, discovery: [{ rows: [{ _id: 'as-1', ...deleted }] }] },
    },
  });
  assert.equal(callsTo(gateway, 'conversation_ai_agent_detail').length, 1,
    'a Conversation-AI row is not graded by the Voice tombstone rule');
  assert.equal(callsTo(gateway, 'agent_studio_agent_detail').length, 1,
    'an Agent-Studio row is not graded by the Voice tombstone rule');
});

// --- the detail read is checked against the id it was issued for --------------------------

test('a detail response about ANOTHER agent is refused on all three products', async () => {
  // THE CRITICAL FINDING. `readAgentRecord` only ever required the body to carry SOME id, and
  // the call site assigned it with no comparison to the id it had asked for. The gateway
  // cannot cover the gap: its own identity check compares a body field literally named
  // `agentId`, and GHL agent bodies carry `_id`/`id`, so there is nothing for it to compare
  // and it passes. Plan Step 3.3 ("verifies response identity and location binding") was
  // therefore vacuous on the agent axis for all three products.
  //
  // Each product is probed through a DIFFERENT envelope so the check cannot be implemented for
  // the bare shape alone and left broken for the nested ones — which is precisely how it was
  // reproduced for Conversation AI, through `{agent:{_id:'c9'}}`.
  const { gateway, result } = await runBundle(AI_FIXTURES.scenarios['detail-answers-for-another-agent']);
  for (const [name, requested, answered] of [
    ['conversation_ai', 'ce-1', 'c9'],
    ['voice_ai', 'b1', 'b2'],
    ['agent_studio', 'as-1', 'as-9'],
  ]) {
    const component = result.components[name];
    // The read WAS issued — this is not a check that skips the call.
    assert.equal(callsTo(gateway, AI_DETAIL_OF[name]).length, 1, `${name}: the detail read must still be issued`);
    assert.equal(callsTo(gateway, AI_DETAIL_OF[name])[0].typedBindings.agentId, requested);
    // ... and its answer is discarded, not published under the requested agent's id.
    assert.equal(component.items.length, 1, `${name}: the discovered row is retained as evidence`);
    assert.equal(component.items[0].id, requested);
    assert.equal(component.items[0].detail, null,
      `${name}: agent ${answered}'s configuration must never be published as agent ${requested}'s`);
    assert.equal(component.items[0].detailRead, false, `${name}: nothing was read for ${requested}`);
    assert.equal(component.detailsRead, 0, `${name}: a mismatched read is not a read`);
    assert.equal(component.detailDenominator, 1, `${name}: the agent is still owed a configuration`);
    assert.equal(component.complete, false, `${name}: a component missing a detail may not publish as complete`);
    assert.deepEqual(component.errors.map((error) => error.code), ['AI_DETAIL_IDENTITY_MISMATCH'],
      `${name}: the mismatch must survive into stable error metadata`);
  }
  assert.equal(result.complete, false);
  assert.deepEqual(warningCodesOf(result), ['AI_DETAIL_IDENTITY_MISMATCH']);
  // The regression, stated as the artifact it used to produce: before the fix this exact
  // fixture returned complete:true, detailsRead:1 per component and zero warnings.
  assert.ok(result.warnings.length > 0, 'a mismatched identity must be stated, not merely dropped');
});

test('a matching detail id is accepted through every envelope, wrapper included', async () => {
  // The other side of the same check: it must not manufacture a mismatch. The three envelopes
  // above, answering CORRECTLY this time, plus a `{$oid:…}`-wrapped id on both sides — the
  // gateway names that wrapper as a real shape, so `{_id:{$oid:'b1'}}` answering a request for
  // `b1` is a match, not a conflict.
  const { result } = await runBundle({
    components: {
      conversation_ai: {
        discovery: [{ rows: [{ _id: 'ce-1' }] }],
        details: { 'ce-1': { body: { agent: { _id: 'ce-1', locationId: LOC } } } },
      },
      voice_ai: {
        discovery: [{ rows: [{ _id: { $oid: 'b1' } }] }],
        details: { b1: { body: { employee: { id: { $oid: 'b1' }, locationId: LOC } } } },
      },
      agent_studio: {
        declaredTotal: 1,
        // A numeric-vs-string id on the two sides of the comparison is ONE agent serialized two
        // ways, exactly as contentHashOf already treats it — so the fixture SERIALIZES it two
        // ways rather than merely saying so: discovery answers with the string '7', the detail
        // body answers with the number 7, and `idOf` reads both as '7'. Written with `'as-1'`
        // on both sides this comment was a claim no byte of the fixture made.
        discovery: [{ rows: [{ _id: '7' }] }],
        details: { 7: { body: { data: { _id: 7, locationId: LOC } } } },
      },
    },
  });
  for (const name of AI_BUNDLE_COMPONENTS) {
    assert.equal(result.components[name].detailsRead, 1, `${name}: a matching record must be accepted`);
    assert.equal(result.components[name].complete, true, `${name}: nothing here is a fault`);
  }
  assert.equal(result.complete, true);
});

test('the detail identity comparison is EXACT: a different case and a padded id are different agents', async () => {
  // `recordId !== item.id` is a strict comparison of two strings, and BOTH loosenings of it —
  // a `toLowerCase()` on either side, and a `.trim()` on either side — survived the whole suite
  // because every fixture answered with a byte-identical id. Neither loosening is a nicety: an
  // upstream that answers a request for `b1` with `B1` is either a different agent or a route
  // this rail does not understand, and publishing the body under the requested id is the same
  // "somebody else's configuration, filed as yours" the identity check exists to prevent.
  //
  // Both products are probed in ONE run so a fix applied to one comparison site cannot pass by
  // covering the other.
  const { gateway, result } = await runBundle({
    components: {
      conversation_ai: {
        discovery: [{ rows: [{ _id: 'ce-1' }] }],
        details: { 'ce-1': { body: { _id: 'CE-1', locationId: LOC, name: 'case-shifted' } } },
      },
      voice_ai: {
        discovery: [{ rows: [{ _id: 'va-1' }] }],
        details: { 'va-1': { body: { _id: ' va-1 ', locationId: LOC, name: 'whitespace-padded' } } },
      },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  for (const name of ['conversation_ai', 'voice_ai']) {
    assert.equal(callsTo(gateway, AI_DETAIL_OF[name]).length, 1, `${name}: the read must still be issued`);
    const component = result.components[name];
    assert.equal(component.detailsRead, 0, `${name}: an inexactly-identified record is not a read`);
    assert.equal(component.items[0].detail, null, `${name}: nothing may be published under the requested id`);
    assert.equal(component.items[0].detailRead, false);
    assert.equal(component.detailDenominator, 1, `${name}: the agent is still owed a configuration`);
    assert.deepEqual(component.errors.map((error) => error.code), ['AI_DETAIL_IDENTITY_MISMATCH'],
      `${name}: the mismatch must survive into stable error metadata`);
  }
  assert.equal(result.complete, false);
});

test('readAgentRecord reads the NESTED record before the root, and the order is load-bearing', async () => {
  // `{_id:'b1', agent:{_id:'b2'}}` — an envelope whose outer object carries one id and whose
  // nested record carries another. Inverting the search order (root before nested) survived the
  // suite, and it would RE-OPEN the critical finding in weakened form: the root id is the one
  // the request was addressed with, so a root-first reader matches it, accepts the envelope, and
  // publishes agent b2's configuration as b1's — with complete:true and no warning — exactly as
  // the rail did before the identity check existed. Nested-first reads the record the body is
  // actually ABOUT, which is the only thing the comparison can be a comparison of.
  const { result } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: {
        discovery: [{ rows: [{ _id: 'b1' }] }],
        details: { b1: { body: { _id: 'b1', agent: { _id: 'b2', locationId: LOC, name: 'Somebody else' } } } },
      },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  const component = result.components.voice_ai;
  assert.equal(component.detailsRead, 0, 'the nested record identifies another agent, so nothing was read');
  assert.equal(component.items[0].detail, null);
  assert.deepEqual(component.errors.map((error) => error.code), ['AI_DETAIL_IDENTITY_MISMATCH']);
  assert.equal(component.complete, false);
});

// --- aggregation: no unbounded ballast in the proof ledger ---------------------------------

test('errors aggregate per (code, capabilityId, phase), so ONE code on two phases is two objects', async () => {
  // The aggregation key was asserted only through its consequences (one object per repeated
  // failure), so collapsing it to `(code)` survived: a discovery failure and a detail failure
  // sharing a failureClass merged into a single object whose `occurrences` an auditor could not
  // attribute to either phase. Page 1 discovers 100 agents, page 2 is refused 403, and every
  // detail read is refused 403 — one AUTH_REJECTED on discovery, a hundred on detail.
  //
  // WHAT THIS DOES AND DOES NOT KILL, stated because the difference is not visible from the
  // assertion. It kills `(code)`. It does NOT kill `(code, capabilityId)` or `(code, phase)`
  // taken separately, and no fixture can: errors are indexed PER COMPONENT, and within one
  // component the discovery and detail capabilities are one apiece, so capabilityId determines
  // phase and phase determines capabilityId. Those two halves are individually EQUIVALENT
  // mutants today. Both are kept because the equivalence is a property of the surface table
  // (one discovery route and one detail route per product), not of the aggregator — add a
  // second detail route to a product and the key that dropped `capabilityId` starts merging two
  // genuinely different reads.
  const { result } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: { discovery: [{ rows: [] }] },
      agent_studio: {
        declaredTotal: 300,
        discovery: [
          { generate: { count: 100, idPrefix: 'as-agg-' } },
          { gateway: { ok: false, status: 403, failureClass: 'AUTH_REJECTED' }, rows: [] },
        ],
        detailDefault: { ok: false, status: 403, failureClass: 'AUTH_REJECTED' },
      },
    },
  });
  const { errors } = result.components.agent_studio;
  assert.equal(errors.length, 2, 'one code on two phases must not collapse into one object');
  assert.deepEqual(errors.map((error) => error.code), ['AUTH_REJECTED', 'AUTH_REJECTED']);
  assert.deepEqual(
    Object.fromEntries(errors.map((error) => [error.phase, error.occurrences])),
    { discovery: 1, detail: 100 },
    'the occurrence counts must stay attributable to the phase that earned them',
  );
  assert.deepEqual(errors.map((error) => error.capabilityId),
    ['agent_studio_agent_discovery', 'agent_studio_agent_detail']);
});

test('per-item warnings AND errors are aggregated, so neither grows with the account', async () => {
  // MEASURED before the fix: Agent Studio at the default budget with every detail failing
  // produced 10,001 warning objects AND 10,001 error objects — 8.46 MB of one repeated
  // sentence in an artifact that is serialized over stdio and hashed whole into the proof
  // ledger. Warnings were half-aggregated (the detail sites used the plain emitter) and errors
  // were not aggregated at all.
  //
  // 1,000 rows here rather than 10,001 only because the stub's per-call seal check is O(n) in
  // the discovered set, which makes the larger corpus quadratic in the HARNESS. The property
  // is the same: the object counts must not move with the row count.
  const size = 1000;
  const { result } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: {
        discovery: [{ generate: { count: size, idPrefix: 'ballast-' } }],
        detailDefault: { ok: false, status: 500, failureClass: 'HTTP_500' },
      },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  const component = result.components.voice_ai;
  assert.equal(component.items.length, size, 'every row is still retained as evidence');
  assert.equal(component.detailDenominator, size);
  assert.equal(component.detailsRead, 0);
  // ONE warning object and ONE error object for a thousand identical failures.
  assert.equal(result.warnings.length, 1, 'a thousand identical detail failures are ONE warning');
  assert.equal(result.warnings[0].code, 'AI_DETAIL_READ_FAILED');
  assert.equal(result.warnings[0].occurrences, size, 'the count is the number an auditor wants');
  assert.ok(result.warnings[0].detailSamples.length <= 3, 'detailSamples stays capped at three');
  assert.equal(component.errors.length, 1, 'a thousand identical detail failures are ONE error object');
  assert.equal(component.errors[0].code, 'HTTP_500');
  assert.equal(component.errors[0].occurrences, size);
  // Stated as a size bound too, because "one object" is the mechanism and "the artifact does
  // not blow up" is the property. The evidence rows are legitimate; the ledger is not.
  const ledgerBytes = JSON.stringify({ warnings: result.warnings, errors: component.errors }).length;
  assert.ok(ledgerBytes < 4000, `the warning/error ledger grew to ${ledgerBytes} bytes for ${size} rows`);
});

test('the closed error vocabulary admits generated HTTP codes and nothing else', () => {
  assert.ok(Object.isFrozen(AI_BUNDLE_ERROR_CODES), 'a closed vocabulary must be frozen');
  assert.deepEqual([...AI_BUNDLE_ERROR_CODES], [...AI_BUNDLE_ERROR_CODES].sort(), 'kept sorted so a diff is readable');
  for (const code of AI_WARNING_CODES) {
    // Every warning code can also appear as an error code, because the row-level and
    // page-level faults are recorded on both sides. CIRCUIT_OPEN is the exception: it is
    // re-thrown, never recorded against a component.
    if (code === 'CIRCUIT_OPEN') continue;
    assert.ok(AI_BUNDLE_ERROR_CODES.includes(code), `${code} must be an admissible error code`);
  }
  assert.equal(isAiBundleErrorCode('HTTP_404'), true);
  assert.equal(isAiBundleErrorCode('HTTP_500'), true);
  assert.equal(isAiBundleErrorCode('HTTP_4041'), false, 'a four-digit "status" is not a status');
  assert.equal(isAiBundleErrorCode('SOMETHING_NEW'), false, 'the union is closed, not open');
  assert.equal(isAiBundleErrorCode('CIRCUIT_OPEN'), false, 'a latched circuit is thrown, never recorded');
});

// --- the two single-shot surfaces have no page budget ----------------------------------------

test('only the paginated surface reports a page budget', async () => {
  // `pages.budget` used to report `maxPages` on all three components. The two single-shot
  // descriptors declare no page parameter, so the budget is never consulted and never can be:
  // a reader comparing `attempted` against it would conclude there was headroom left when
  // there was never a second page to spend it on.
  const { result } = await runBundle(AI_FIXTURES.scenarios['all-three-products']);
  assert.equal(result.components.agent_studio.pages.budget, 100, 'Agent Studio is the paginated surface');
  for (const name of ['conversation_ai', 'voice_ai']) {
    assert.equal(result.components[name].pages.budget, null, `${name} has no page parameter and no budget`);
    assert.equal(result.components[name].pages.attempted, 1);
    assert.equal(result.components[name].pages.exhausted, false);
  }
});

// --- the id-wrapper vocabulary is the gateway's ------------------------------------------------

test('the id-wrapper vocabulary is a verbatim copy of the gateway\'s, and cannot drift', () => {
  // core/audit-gateway.mjs keeps ID_WRAPPER_KEYS private, so this module carries a copy. A copy
  // that can drift is worse than no copy: the gateway would go on treating `{$oid:…}` as a
  // readable id while this composite deduped every such row into one "[object Object]" and
  // addressed a detail route with the literal string. Asserted as a SOURCE property because
  // there is no export to compare against.
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const extract = (source, label) => {
    const match = source.match(/ID_WRAPPER_KEYS\s*=\s*\[([^\]]*)\]/);
    assert.ok(match, `${label} no longer declares ID_WRAPPER_KEYS as a literal list`);
    return match[1].split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  };
  const gatewayKeys = extract(read('../core/audit-gateway.mjs'), 'the audit gateway');
  const compositeKeys = extract(read('../core/audit-configuration.mjs'), 'the configuration composites');
  assert.deepEqual(compositeKeys, gatewayKeys,
    'the composites unwrap a different set of id wrappers from the gateway that validates them');
  assert.deepEqual(gatewayKeys, ['$oid', '_id', 'id'], 'the wrapper vocabulary itself changed');
});

test('the unwrap goes exactly ONE level, so a doubly-wrapped id is unreadable rather than invented', async () => {
  // The test above pins the wrapper KEY LIST verbatim but says nothing about DEPTH, so a
  // recursive-unwrap mutant survived it. One level is what the gateway's own `readIdentityValue`
  // does, and matching it is the whole point of the copy: `{$oid:{$oid:'x'}}` is not a shape
  // this API emits, so a rail that reads `x` out of it has invented an id — and an invented id
  // is addressable. It would be sealed, sent to a live detail route, and whatever came back
  // would be filed against a row whose real identity this rail never established.
  //
  // Unreadable is therefore the answer, and the row is RETAINED with its detail unreachable by
  // construction: that is the difference between "I could not identify this" and "there was
  // nothing here", which is the doctrine the whole module is built on.
  const { gateway, result } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: { discovery: [{ rows: [{ _id: { $oid: { $oid: 'deep' } }, name: 'wrapped twice' }] }] },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  assert.equal(callsTo(gateway, 'voice_ai_agent_detail').length, 0,
    'a doubly-wrapped id must never be unwrapped into an addressable one');
  const component = result.components.voice_ai;
  assert.equal(component.items.length, 1, 'the row is retained as discovery evidence');
  assert.equal(component.items[0].id, null, 'the id is unreadable, not `deep`');
  assert.equal(component.detailDenominator, 1, 'the row still owes a configuration nobody can fetch');
  assert.equal(component.detailsRead, 0);
  assert.equal(component.complete, false);
  assert.ok(result.warnings.some((warning) => warning.code === 'AI_DISCOVERY_ROW_ID_MISSING'
    && warning.component === 'voice_ai'), 'an unreadable id must be stated, not silently dropped');
});

test('contentHashOf normalizes the id, so ONE agent serialized two ways is one item and no conflict', async () => {
  // Removing the id normalization from `contentHashOf` survived the suite. It is what keeps the
  // duplicate-id CONFLICT rule honest: `{_id:{$oid:'va-1'}}` and `{_id:'va-1'}` are one agent
  // written two ways — `idOf` already reads both as `va-1`, so they collide on the same key —
  // and without normalization their content hashes differ, which is the rail's definition of
  // "two rows sharing an id but not a payload". The result is a manufactured
  // AI_DISCOVERY_DUPLICATE_ID_CONFLICT, a second copy of one agent retained as evidence of a
  // contradiction that never happened, and a surface published incomplete for it.
  //
  // The two rows are served in ONE response deliberately: the per-response keyer is the
  // narrowest place the collision can be observed, so nothing about paging can be credited for
  // the result.
  //
  // BOTH SERIALIZATION PAIRS ARE EXERCISED, and the second one is the whole reason this test
  // is worth keeping. The wrapper pair (`{_id:{$oid:'va-1'}}` vs `{_id:'va-1'}`) is unwrapped
  // to a STRING on both sides by `unwrapId` alone, so it never reaches the `String(...)`
  // coercion in `contentHashOf` — dropping that coercion (`normalized[key] = unwrapped`) left
  // the wrapper pair hashing identically and survived the entire suite. Only a NUMBER-vs-string
  // pair (`{_id:5}` vs `{_id:'5'}`) makes the coercion load-bearing: `idOf` already keys both
  // rows to `id:5`, so without the coercion `5` and `"5"` serialize to different content
  // hashes and the rail manufactures the exact AI_DISCOVERY_DUPLICATE_ID_CONFLICT the line
  // exists to prevent — two items, two detail calls, and the surface published incomplete.
  const { gateway, result } = await runBundle({
    components: {
      conversation_ai: {
        discovery: [{ rows: [{ _id: 5, name: 'One Agent' }, { _id: '5', name: 'One Agent' }] }],
      },
      voice_ai: {
        discovery: [{ rows: [{ _id: { $oid: 'va-1' }, name: 'One Agent' }, { _id: 'va-1', name: 'One Agent' }] }],
      },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  });
  const component = result.components.voice_ai;
  assert.equal(component.items.length, 1, 'one agent serialized two ways is ONE item');
  assert.equal(String(component.items[0].id), 'va-1');
  assert.deepEqual(callsTo(gateway, 'voice_ai_agent_detail').map((call) => String(call.typedBindings.agentId)),
    ['va-1'], 'and it is detail-read exactly once');
  // The numeric-vs-string half, asserted in exactly the same four clauses so neither pair can
  // pass by leaning on the other.
  const numeric = result.components.conversation_ai;
  assert.equal(numeric.items.length, 1, 'a number id and its string serialization are ONE item');
  assert.equal(String(numeric.items[0].id), '5', 'and the id it is keyed by is the string form');
  assert.deepEqual(callsTo(gateway, 'conversation_ai_agent_detail').map((call) => String(call.typedBindings.agentId)),
    ['5'], 'and it too is detail-read exactly once');
  assert.equal(numeric.complete, true);
  assert.deepEqual(warningCodesOf(result), [], 'an identical re-serve is not a conflict');
  assert.equal(component.complete, true);
  assert.equal(result.complete, true);
});

// --- the sealed discovery set ----------------------------------------------------------

test('each detail read carries the seal keyed by its OWN discovery capability', async () => {
  // The sealed set is an OBJECT keyed by discovery capability id, not a flat list: the three
  // products share an id shape, so one flat array would let a Voice id probe the
  // Conversation-AI and Agent-Studio detail routes with a perfectly plausible id.
  const { gateway } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [{ _id: 'ce-1' }] }] },
      voice_ai: { discovery: [{ rows: [{ _id: 'va-1' }] }] },
      agent_studio: { declaredTotal: 1, discovery: [{ rows: [{ _id: 'as-1' }] }] },
    },
  });
  for (const [component, detailId] of Object.entries(AI_DETAIL_OF)) {
    const [call] = callsTo(gateway, detailId);
    assert.ok(call, `${detailId} was never called`);
    const seal = call.typedBindings.discoveredAgentIds;
    assert.ok(seal && typeof seal === 'object' && !Array.isArray(seal),
      `${detailId} must be sealed with an object keyed by discovery capability id`);
    const ownKey = AI_DISCOVERY_OF[component];
    assert.ok(Object.hasOwn(seal, ownKey), `${detailId} must be sealed under ${ownKey}`);
    assert.ok(seal[ownKey].map(String).includes(String(call.typedBindings.agentId)));
    // A cross-product id is refused by the gateway, so the composite must never widen its
    // own seal by merging the other products' discovery results into one key.
    for (const [otherComponent, otherKey] of Object.entries(AI_DISCOVERY_OF)) {
      if (otherComponent === component) continue;
      if (!Object.hasOwn(seal, otherKey)) continue;
      assert.ok(!seal[otherKey].map(String).includes(String(call.typedBindings.agentId)),
        `${detailId} must not appear in ${otherKey}'s sealed set`);
    }
  }
});

test('a detail read is never issued for an id no discovery response returned', async () => {
  // The stub enforces the same seal the gateway does, so an unsealed detail read fails
  // closed here rather than reaching a live account. Discovery returns one id; the fixture
  // declares a body for a second that was never discovered.
  const { gateway } = await runBundle({
    components: {
      conversation_ai: { discovery: [{ rows: [{ _id: 'ce-1' }] }] },
      voice_ai: { discovery: [{ rows: [] }] },
      agent_studio: {
        declaredTotal: 1,
        discovery: [{ rows: [{ _id: 'as-1' }] }],
        details: { 'as-ghost': { body: { _id: 'as-ghost' } } },
      },
    },
  });
  const ids = callsTo(gateway, 'agent_studio_agent_detail').map((call) => String(call.typedBindings.agentId));
  assert.deepEqual(ids, ['as-1'], 'only discovered ids may be detail-read');
});

// --- always three surfaces -------------------------------------------------------------

test('callers cannot omit a surface, however hard they try', async () => {
  // Plan line 541: the bundle always attempts the complete enumerated set. Applicability is
  // decided later by the weekly auditor's pinned coverage profile plus complete discovery
  // evidence, never by an ad hoc caller list (plan line 552).
  assert.deepEqual([...AI_BUNDLE_COMPONENTS], ['conversation_ai', 'voice_ai', 'agent_studio']);
  const spec = {
    components: {
      conversation_ai: { discovery: [{ rows: [] }] },
      voice_ai: { discovery: [{ rows: [] }] },
      agent_studio: { declaredTotal: 0, discovery: [{ rows: [] }] },
    },
  };
  for (const attempt of [
    { components: ['voice_ai'] },
    { surfaces: ['voice_ai'] },
    { skip: ['agent_studio'] },
    { only: 'conversation_ai' },
  ]) {
    const { gateway, result } = await runBundle(spec, attempt);
    assert.deepEqual(Object.keys(result.components).sort(), [...AI_BUNDLE_COMPONENTS].sort(),
      `a caller-supplied ${Object.keys(attempt)[0]} must not narrow the surface set`);
    for (const discoveryId of Object.values(AI_DISCOVERY_OF)) {
      assert.equal(callsTo(gateway, discoveryId).length, 1, `${discoveryId} must still be attempted`);
    }
  }
});

// --- list_account_entities is not reused --------------------------------------------------

test('the audit composites do not reuse list_account_entities or its best-effort fallbacks', () => {
  // `fetchEntities` answers a failed AI read with `catch { return {} }` and an unreadable
  // envelope with `arrayFrom(...) ?? []`. Both are structurally forbidden here (plan line
  // 550), and the tool itself is absent from the audit profile.
  assert.ok(!AUDIT_TOOL_NAMES.includes('list_account_entities'),
    'list_account_entities must not be in the audit profile');
  const source = readFileSync(new URL('../core/audit-configuration.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetchEntities/, 'the audit composites must not call the best-effort sweeper');
  assert.doesNotMatch(source, /orchestrate\.mjs/, 'the audit composites must not import the build engine');
  assert.doesNotMatch(source, /list_account_entities/, 'the audit composites must not delegate to the legacy tool');
  // The legacy sweeper reads the BARE `/voice-ai/agents`; the audit descriptor reads
  // `/voice-ai/agents/simple`, which is a different capability with a different receipt.
  const bundleTool = TOOLS.find((candidate) => candidate.name === 'get_ai_configuration_bundle');
  assert.ok(bundleTool, 'get_ai_configuration_bundle is not registered');
  for (const capability of bundleTool.capabilities) {
    assert.notEqual(capability.path, '/voice-ai/agents',
      'the audit bundle reads the /simple discovery route, never the legacy one');
  }
});

// --- capability versions ------------------------------------------------------------------

test('each composite hashes ONLY the descriptors it declares', async () => {
  // Task 3 carry-forward: hashing all 16 descriptors meant an edit to an unrelated
  // descriptor invalidated every already-collected artifact for a reason that could not
  // possibly have changed what it observed. A receipt must be invalidated by a change to
  // the policy it was collected under, and by nothing else.
  assert.deepEqual([...ROSTER_CAPABILITY_IDS], ['workflow_roster_list']);
  assert.deepEqual([...AI_BUNDLE_CAPABILITY_IDS].sort(), [
    'agent_studio_agent_detail',
    'agent_studio_agent_discovery',
    'conversation_ai_agent_detail',
    'conversation_ai_agent_discovery',
    'voice_ai_agent_detail',
    'voice_ai_agent_discovery',
  ]);
  assert.equal(ROSTER_CAPABILITY_VERSION,
    `sha256:${sha256Canonical(resolveConfigurationDescriptors(ROSTER_CAPABILITY_IDS))}`);
  assert.equal(AI_BUNDLE_CAPABILITY_VERSION,
    `sha256:${sha256Canonical(resolveConfigurationDescriptors(AI_BUNDLE_CAPABILITY_IDS))}`);
  assert.notEqual(ROSTER_CAPABILITY_VERSION, AI_BUNDLE_CAPABILITY_VERSION,
    'two composites reading different descriptor sets may not share one version');
  const wholeSet = `sha256:${sha256Canonical([...AUDIT_CAPABILITIES])}`;
  assert.notEqual(ROSTER_CAPABILITY_VERSION, wholeSet, 'the roster version must be narrowed');
  assert.notEqual(AI_BUNDLE_CAPABILITY_VERSION, wholeSet, 'the bundle version must be narrowed');

  // Narrowing, demonstrated rather than asserted: mutating a descriptor NEITHER composite
  // reads must move NEITHER version, and mutating an AI descriptor must move only one.
  const mutate = (capabilityId, over) => AUDIT_CAPABILITIES
    .map((capability) => (capability.capabilityId === capabilityId ? { ...capability, ...over } : capability));
  const unrelated = mutate('workflow_execution_logs', { optionalQueryKeys: ['contactId'] });
  assert.equal(
    `sha256:${sha256Canonical(resolveConfigurationDescriptors(ROSTER_CAPABILITY_IDS, unrelated))}`,
    ROSTER_CAPABILITY_VERSION,
  );
  assert.equal(
    `sha256:${sha256Canonical(resolveConfigurationDescriptors(AI_BUNDLE_CAPABILITY_IDS, unrelated))}`,
    AI_BUNDLE_CAPABILITY_VERSION,
  );
  const aiEdited = mutate('voice_ai_agent_detail', { optionalQueryKeys: ['expand'] });
  assert.notEqual(
    `sha256:${sha256Canonical(resolveConfigurationDescriptors(AI_BUNDLE_CAPABILITY_IDS, aiEdited))}`,
    AI_BUNDLE_CAPABILITY_VERSION,
  );
  assert.equal(
    `sha256:${sha256Canonical(resolveConfigurationDescriptors(ROSTER_CAPABILITY_IDS, aiEdited))}`,
    ROSTER_CAPABILITY_VERSION,
  );
});

test('a declared capability with no descriptor is fatal, never hashed out of the version', () => {
  // A silently-skipped id produces a version hash describing a SMALLER policy than the one
  // the composite actually calls under, which is the one failure mode a version exists to
  // prevent.
  assert.throws(
    () => resolveConfigurationDescriptors(['workflow_roster_list', 'not_a_capability']),
    /not_a_capability/,
  );
});

test('the declared capability ids match the reads the composites actually issue', async () => {
  const { gateway: rosterGateway } = await runRoster(ROSTER_FIXTURES.scenarios['one-page']);
  assert.deepEqual([...new Set(rosterGateway.calls.map((call) => call.capabilityId))].sort(),
    [...ROSTER_CAPABILITY_IDS].sort());
  const { gateway: aiGateway } = await runBundle(AI_FIXTURES.scenarios['all-three-products']);
  assert.deepEqual([...new Set(aiGateway.calls.map((call) => call.capabilityId))].sort(),
    [...AI_BUNDLE_CAPABILITY_IDS].sort());
  assert.equal(rosterGateway.calls.every((call) => ROSTER_CAPABILITY_IDS.includes(call.capabilityId)), true);
  assert.equal(aiGateway.calls.every((call) => AI_BUNDLE_CAPABILITY_IDS.includes(call.capabilityId)), true);
});

// --- input validation, before any gateway work ---------------------------------------------

test('both composites validate their own input before issuing a read', async () => {
  const explode = { locationId: LOC, callCapability() { throw new Error('a read must not be issued for invalid input'); } };
  for (const bad of [
    {},
    { locationId: '' },
    { locationId: '   ' },
    { locationId: LOC, pageSize: 0 },
    { locationId: LOC, pageSize: 101 },
    { locationId: LOC, pageSize: 1.5 },
    { locationId: LOC, maxPages: 0 },
  ]) {
    await assert.rejects(() => listWorkflowsComplete({ auditGateway: explode, input: bad }),
      (error) => {
        assert.equal(error.code, 'INVALID_AUDIT_CONFIGURATION_INPUT', `input ${JSON.stringify(bad)}`);
        return true;
      });
  }
  for (const bad of [
    {},
    { locationId: '' },
    { locationId: LOC, companyId: '' },
    { locationId: LOC, maxPages: 0 },
    { locationId: LOC, maxPages: 1.5 },
  ]) {
    await assert.rejects(() => getAiConfigurationBundle({ auditGateway: explode, input: bad }),
      (error) => {
        assert.equal(error.code, 'INVALID_AUDIT_CONFIGURATION_INPUT', `input ${JSON.stringify(bad)}`);
        return true;
      });
  }
});

test('a gateway bound to a different location is refused before any read', async () => {
  const other = { locationId: 'OTHER', callCapability() { throw new Error('no read may be issued'); } };
  await assert.rejects(() => listWorkflowsComplete({ auditGateway: other, input: { locationId: LOC } }),
    /INVALID_AUDIT_CONFIGURATION_INPUT/);
  await assert.rejects(() => getAiConfigurationBundle({ auditGateway: other, input: { locationId: LOC, companyId: COMPANY } }),
    /INVALID_AUDIT_CONFIGURATION_INPUT/);
});

// --- receipts and determinism ----------------------------------------------------------------

test('the roster records every page, applied query, unique progress, total history and terminal proof', async () => {
  // Plan line 539's five obligations, asserted together because each is individually
  // droppable and the set is what makes the walk reviewable rather than merely summarized.
  const { gateway, result } = await runRoster(ROSTER_FIXTURES.scenarios['three-pages']);
  assert.equal(result.appliedQueries.length, gateway.calls.length, 'every read must be recorded');
  assert.deepEqual(result.appliedQueries.map((entry) => entry.capabilityId),
    gateway.calls.map((call) => call.capabilityId));
  assert.deepEqual(result.appliedQueries.map((entry) => entry.query.offset),
    gateway.calls.map((call) => call.query.offset));
  assert.equal(result.sourceRoutes.length, gateway.calls.length, 'every response must leave a route record');
  assert.equal(result.uniqueProgress.length, result.pagination.fetched);
  assert.equal(result.totalHistory.length, result.pagination.fetched);
  assert.equal(result.terminalReason, 'unique_count_equals_reported_total');
  assert.equal(result.capturedAt, CAPTURED_AT, 'capture time comes from the reads, never a wall clock');
  assert.equal(result.capabilityVersion, ROSTER_CAPABILITY_VERSION);
});

test('the bundle records per-component pages and source routes for every surface', async () => {
  const { gateway, result } = await runBundle(AI_FIXTURES.scenarios['all-three-products']);
  const routed = Object.values(result.components).flatMap((component) => component.sourceRoutes);
  assert.equal(routed.length, gateway.calls.length, 'every AI read must leave a route record on its own component');
  assert.equal(result.appliedQueries.length, gateway.calls.length);
  for (const entry of result.appliedQueries) {
    assert.ok(AI_BUNDLE_COMPONENTS.includes(entry.component), 'every applied query names its component');
  }
  assert.equal(result.contractVersion, AUDIT_CONFIGURATION_CONTRACT_VERSION);
  assert.equal(result.capabilityVersion, AI_BUNDLE_CAPABILITY_VERSION);
  assert.equal(result.capturedAt, CAPTURED_AT, 'capture time comes from the reads, never a wall clock');
  assert.equal(result.companyId, COMPANY);
  assert.equal(result.boundLocationId, LOC);
});

test('two identical runs produce identical results', async () => {
  for (const name of ['three-pages', 'reordered-rows', 'malformed-rows']) {
    const first = await runRoster(ROSTER_FIXTURES.scenarios[name]);
    const second = await runRoster(ROSTER_FIXTURES.scenarios[name]);
    assert.deepEqual(first.result, second.result, `roster ${name} is not deterministic`);
    assert.equal(JSON.stringify(first.result), JSON.stringify(second.result), `roster ${name} key order drifts`);
  }
  for (const name of ['all-three-products', 'voice-confirmed-tombstone', 'agent-studio-multiple-pages']) {
    const first = await runBundle(AI_FIXTURES.scenarios[name]);
    const second = await runBundle(AI_FIXTURES.scenarios[name]);
    assert.deepEqual(first.result, second.result, `bundle ${name} is not deterministic`);
    assert.equal(JSON.stringify(first.result), JSON.stringify(second.result), `bundle ${name} key order drifts`);
  }
});

// --- the emitted queries, pinned ---------------------------------------------------------------

test('the roster pins every fixed query value the descriptor declares', async () => {
  const { gateway } = await runRoster(ROSTER_FIXTURES.scenarios['three-pages']);
  for (const call of callsTo(gateway, 'workflow_roster_list')) {
    assert.deepEqual(Object.keys(call.query).sort(), [
      'includeCustomObjects', 'includeObjectiveBuilder', 'limit', 'offset', 'sortBy', 'sortOrder', 'type',
    ]);
    assert.equal(call.query.type, 'workflow');
    assert.equal(call.query.sortBy, 'name');
    assert.equal(call.query.sortOrder, 'asc');
    assert.equal(call.query.includeCustomObjects, 'true');
    assert.equal(call.query.includeObjectiveBuilder, 'true');
    assert.equal(call.query.limit, '100');
    // locationId travels in the PATH on this descriptor, so sending it as a query key would
    // be an UNKNOWN_QUERY_KEY rejection at the real gateway.
    assert.equal(Object.hasOwn(call.query, 'locationId'), false);
    assert.equal(String(call.typedBindings.locationId), LOC);
  }
});

test('Agent Studio discovery pins its four fixed values and binds agencyId to the typed company', async () => {
  const { gateway } = await runBundle(AI_FIXTURES.scenarios['agent-studio-multiple-pages']);
  const calls = callsTo(gateway, 'agent_studio_agent_discovery');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.query.productId, 'superagent');
    assert.equal(call.query.groupBy, 'foldersFirst');
    assert.equal(call.query.sortBy, 'lastUpdated');
    assert.equal(call.query.sortOrder, 'desc');
    assert.equal(call.query.pageSize, String(AI_DISCOVERY_PAGE_SIZE));
    assert.equal(call.query.agencyId, COMPANY);
    assert.equal(String(call.typedBindings.companyId), COMPANY,
      'agencyId is bound to the typed companyId, not a free parameter');
    assert.equal(call.query.locationId, LOC);
  }
  assert.deepEqual(calls.map((call) => call.query.page), ['1', '2']);
});

test('the two single-shot discovery routes send exactly one query key and are called once', async () => {
  // Their descriptors declare locationId as their ONLY key, so a composite that tried to
  // paginate them would be refused with UNKNOWN_QUERY_KEY by the real gateway — which is why
  // "multiple pages" in this bundle can only ever mean Agent Studio.
  const { gateway } = await runBundle(AI_FIXTURES.scenarios['agent-studio-multiple-pages']);
  for (const capabilityId of ['conversation_ai_agent_discovery', 'voice_ai_agent_discovery']) {
    const calls = callsTo(gateway, capabilityId);
    assert.equal(calls.length, 1, `${capabilityId} has no page parameter and must be read once`);
    assert.deepEqual(Object.keys(calls[0].query), ['locationId']);
  }
});

test('every detail read carries the location and nothing else', async () => {
  const { gateway } = await runBundle(AI_FIXTURES.scenarios['all-three-products']);
  for (const detailId of Object.values(AI_DETAIL_OF)) {
    for (const call of callsTo(gateway, detailId)) {
      assert.deepEqual(Object.keys(call.query), ['locationId']);
      assert.equal(call.query.locationId, LOC);
      assert.ok(call.typedBindings.agentId, `${detailId} must be typed with the agent it addresses`);
    }
  }
});

// --- tool surface ----------------------------------------------------------------------------

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);

test('both composites are registered as GET-only tools with no confirmation field', () => {
  for (const name of ['list_workflows_complete', 'get_ai_configuration_bundle']) {
    const registered = tool(name);
    assert.ok(registered, `${name} is not registered`);
    assert.ok(registered.capabilities.length > 0, `${name} with no capabilities is an escape hatch`);
    assert.ok(registered.capabilities.every((capability) => capability.method === 'GET'),
      `${name} must be structurally read-only`);
    assert.equal(Object.hasOwn(registered.inputSchema.shape ?? {}, 'confirm'), false,
      `${name} must expose no confirmation field`);
  }
});

test('the tool schemas apply the plan defaults and reject out-of-range budgets', () => {
  const roster = tool('list_workflows_complete').inputSchema;
  const parsedRoster = roster.parse({ locationId: LOC });
  assert.equal(parsedRoster.pageSize, ROSTER_DEFAULTS.pageSize);
  assert.equal(parsedRoster.maxPages, ROSTER_DEFAULTS.maxPages);
  assert.deepEqual(ROSTER_DEFAULTS, { pageSize: 100, maxPages: 100 });
  for (const over of [{ pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 }, { maxPages: 0 }, { maxPages: 1001 }]) {
    assert.equal(roster.safeParse({ locationId: LOC, ...over }).success, false, `accepted ${JSON.stringify(over)}`);
  }

  const bundle = tool('get_ai_configuration_bundle').inputSchema;
  const parsedBundle = bundle.parse({ locationId: LOC, companyId: COMPANY });
  assert.equal(parsedBundle.maxPages, AI_BUNDLE_DEFAULTS.maxPages);
  assert.deepEqual(AI_BUNDLE_DEFAULTS, { maxPages: 100 });
  for (const over of [{ maxPages: 0 }, { maxPages: 1001 }, { maxPages: 2.5 }]) {
    assert.equal(bundle.safeParse({ locationId: LOC, ...over }).success, false, `accepted ${JSON.stringify(over)}`);
  }
  // No surface selector, at the schema level. Callers cannot omit a surface, so there must
  // be no field through which they could try.
  assert.deepEqual(Object.keys(bundle.shape).sort(), ['companyId', 'locationId', 'maxPages']);
});

test('the tools return the stable error contract rather than throwing on bad arguments', async () => {
  for (const name of ['list_workflows_complete', 'get_ai_configuration_bundle']) {
    const result = await tool(name).handler(undefined, undefined);
    assert.equal(typeof result?.ok, 'boolean', `${name} must return the error contract`);
  }
  const explode = () => { throw new Error('a gateway must not be constructed for invalid input'); };
  const rejected = await tool('list_workflows_complete').handler(
    { locationId: '', pageSize: 100, maxPages: 100 },
    { state: { tokenFile: '/x' }, makeGw: explode },
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'INVALID_AUDIT_CONFIGURATION_INPUT');
  assert.equal(typeof rejected.remediation, 'string');
});

// An isolated limiter/circuit pair for the handler tests. Two reasons, both learned the hard
// way. (1) Without it these two tests ran against the PROCESS-wide limiter and spent 760ms and
// 404ms of REAL sleeps; and the moment anybody adds a 429-shaped stub here, the process circuit
// latches and every later test in this file inherits it. (2) The injection point itself needs
// exercising: `deps.auditLimiter ?? pacing.limiter` reduced to `pacing.limiter` kills nothing
// otherwise, and Task 5's stdio-audit driver injects exactly this pair.
const injectedPacing = () => {
  const circuit = makeAuditCircuit();
  let scheduled = 0;
  return {
    circuit,
    get scheduled() { return scheduled; },
    limiter: { schedule: (task) => { scheduled += 1; return task(); } },
  };
};

test('the AI bundle tool builds ONLY the ai rail it actually reads', async () => {
  // REVISED (adversarial review): this test used to assert BOTH rails were built. All six of
  // this bundle's capabilities declare `authRail:'ai'`, and `makeGateway` reads credentials at
  // construction, so the jwt gateway was a credential read this composite could never use —
  // the exact objection `list_workflows_complete` states 46 lines above about building an
  // unused rail. An absent slot fails closed at call time with MISSING_AUTH_RAIL, and no
  // capability here would ever reach the backend slot to trigger it.
  //
  // The rest of the original assertion stands: the shared limiter owns pacing, so leaving the
  // per-gateway throttle on would double-throttle every read (Task 2 carry-forward).
  const built = [];
  const pacing = injectedPacing();
  const result = await tool('get_ai_configuration_bundle').handler(
    { locationId: LOC, companyId: COMPANY, maxPages: 100 },
    {
      state: { tokenFile: '/x' },
      makeGw: (options) => {
        built.push(options);
        return { rail: options.rail === 'ai' ? 'ai' : 'jwt', async callWithMeta() {
          return { status: 200, ok: true, json: { agents: [] }, retryAfterMs: null, capturedAt: CAPTURED_AT };
        } };
      },
      auditLimiter: pacing.limiter,
      auditCircuit: pacing.circuit,
    },
  );
  assert.deepEqual(built.map((options) => options.rail), ['ai'],
    'a rail this composite can never call is a credential read it has no business making');
  for (const options of built) {
    assert.equal(options.throttleMs, 0, 'the shared audit limiter owns pacing');
    assert.equal(options.jitterMs, 0, 'the shared audit limiter owns pacing');
    assert.equal(options.loc, LOC);
  }
  // The bundle still works on one rail: three discovery reads, all served, none refused.
  assert.equal(result.ok, true);
  assert.ok(pacing.scheduled > 0, 'the run must reach the wire, or the injected limiter proves nothing');
});

test('the roster tool builds only the backend rail it actually reads', async () => {
  const built = [];
  const pacing = injectedPacing();
  await tool('list_workflows_complete').handler(
    { locationId: LOC, pageSize: 100, maxPages: 100 },
    {
      state: { tokenFile: '/x' },
      makeGw: (options) => {
        built.push(options);
        return { rail: 'jwt', async callWithMeta() {
          return { status: 200, ok: true, json: { workflows: [], total: 0 }, retryAfterMs: null, capturedAt: CAPTURED_AT };
        } };
      },
      auditLimiter: pacing.limiter,
      auditCircuit: pacing.circuit,
    },
  );
  assert.deepEqual(built.map((options) => options.rail), ['jwt']);
  assert.equal(built[0].throttleMs, 0);
  assert.equal(built[0].jitterMs, 0);
});

test('an injected limiter and circuit win over the process-wide pair, for BOTH audit composites', async () => {
  // Task 3 has exactly this test for the runtime window; without it here, dropping either `??`
  // in tools.mjs kills nothing — and Task 5's stdio-audit.mjs injects ONE shared pair across
  // every audit tool. A dropped `??` there means that tool silently paces against a second
  // limiter and latches a second circuit, so a 429 the driver already absorbed is re-earned.
  for (const [name, args, json] of [
    ['list_workflows_complete', { locationId: LOC, pageSize: 100, maxPages: 100 }, { workflows: [] }],
    ['get_ai_configuration_bundle', { locationId: LOC, companyId: COMPANY, maxPages: 100 }, { agents: [] }],
  ]) {
    const pacing = injectedPacing();
    let fetches = 0;
    let throttleDisabled = false;
    const result = await tool(name).handler(args, {
      state: { tokenFile: '/x' },
      makeGw: (options) => {
        throttleDisabled = options.throttleMs === 0 && options.jitterMs === 0;
        return {
          rail: options.rail,
          async callWithMeta() {
            fetches += 1;
            // A 500 on every read, so the run both reaches the wire and finishes fast.
            return { status: 500, ok: false, json: {}, retryAfterMs: null, capturedAt: CAPTURED_AT };
          },
        };
      },
      auditLimiter: pacing.limiter,
      auditCircuit: pacing.circuit,
    });
    assert.equal(throttleDisabled, true, `${name} must ask for the per-gateway throttle to be disabled`);
    assert.ok(fetches > 0, `${name} must actually reach the wire, or the limiter proves nothing`);
    assert.equal(pacing.scheduled, fetches,
      `${name}: every read must have been paced by the INJECTED limiter, not the process-wide one`);
    // The injected circuit is the one that saw the failures, so the process-wide circuit is
    // untouched and the rest of this file is not poisoned by them.
    assert.equal(processAuditPacing().circuit.isOpen('process'), false);
    assert.equal(typeof result.ok, 'boolean');
  }
});
