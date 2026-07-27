// RED tests for core/audit-gateway.mjs plus gateway.callWithMeta (Task 2, Step 1).
// Every adversary here must be rejected BEFORE any fetch, with a machine-branchable
// `.code` and a message that never echoes a credential-looking value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeGateway } from '../core/gateway.mjs';
import { containsSecrets } from '../core/errors.mjs';
import { AUDIT_CAPABILITIES } from '../core/audit-capabilities.mjs';
import {
  isSafePathSegment, makeAuditCircuit, makeAuditGateway, makeAuditLimiter,
} from '../core/audit-gateway.mjs';

const BACKEND = 'https://backend.leadconnectorhq.com';
const SERVICES = 'https://services.leadconnectorhq.com';
const LOC = 'LOC1';
const WF = 'wf-1';
const STEP = 'step-1';
const COMPANY = 'company-1';
const FIXED_NOW = 1_800_000_000_000;
// Shaped like a JWT so errors.containsSecrets flags it if a message echoes it back.
const CREDENTIAL_LOOKING = 'eyJhbGciOiJIUzI1NiJ9.QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo.sig';

// --- JWT fixture helper (same pattern as test/gateway.test.mjs) ---
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `eyJhbGciOiJIUzI1NiJ9.${b64({ authClassId: 'u-1', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const tokenId = `eyJhbGciOiJIUzI1NiJ9.${b64({ iss: 'securetoken.google.com/highlevel-backend', role: 'admin', type: 'agency', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
function fixture({ bearer = jwt, token = tokenId } = {}) {
  const p = join(mkdtempSync(join(tmpdir(), 'audit-gw-')), 'tok.txt');
  writeFileSync(p, `Bearer ${bearer}\n${token ? `token-id: ${token}\n` : ''}`);
  return p;
}

// --- deterministic fetch stub with headers ---
// Each recorded call is tagged with the credential rail whose gateway issued it, so a
// test can assert not just WHERE a read went but WHICH gateway sent it.
const stubFetch = (calls, responses = {}, rail = 'jwt') => async (url, init) => {
  const index = calls.length;
  calls.push({ url, init, rail });
  const raw = typeof responses === 'function'
    ? responses(index)
    : (Array.isArray(responses) ? responses[Math.min(index, responses.length - 1)] : responses);
  const { status = 200, ok = status < 400, body = '{"records":[]}', headers = {} } = raw ?? {};
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v]));
  return {
    status,
    ok,
    headers: { get: (name) => (Object.hasOwn(lower, String(name).toLowerCase()) ? lower[String(name).toLowerCase()] : null) },
    text: async () => body,
  };
};

// A shared mutable clock: sleepImpl advances it, nowImpl reads it. No real timers.
const makeClock = (start = FIXED_NOW) => {
  let value = start;
  return {
    now: () => value,
    sleep: async (ms) => { value += Math.max(0, Number(ms) || 0); await Promise.resolve(); },
  };
};

const realGateway = ({ calls, responses, rail = 'jwt', nowImpl = () => FIXED_NOW, sleepImpl = async () => {} }) => makeGateway({
  tokenFile: fixture(),
  loc: LOC,
  rail,
  fetchImpl: stubFetch(calls, responses, rail),
  sleepImpl,
  randomImpl: () => 0,
  nowImpl,
});

const passthroughLimiter = () => makeAuditLimiter({
  minimumDelayMs: 0,
  jitterMs: 0,
  sleepImpl: async () => {},
  randomImpl: () => 0,
  nowImpl: () => FIXED_NOW,
});

// Default harness: one REAL gateway per credential rail + stub fetch, so "rejected before
// fetch" is literal and the rail a read travels on is observable. The two rails share one
// `calls` array so ordering and totals stay assertable across both.
const harness = ({
  responses,
  circuit = makeAuditCircuit(),
  limiter = passthroughLimiter(),
  slots = ['backend', 'ai'],
  locationId = LOC,
} = {}) => {
  const calls = [];
  const gateways = {};
  if (slots.includes('backend')) gateways.backend = realGateway({ calls, responses, rail: 'jwt' });
  if (slots.includes('ai')) gateways.ai = realGateway({ calls, responses, rail: 'ai' });
  return {
    calls,
    circuit,
    limiter,
    gateways,
    audit: makeAuditGateway({ gateways, locationId, limiter, circuit }),
  };
};

async function rejectsWithCode(run, code, { calls } = {}) {
  await assert.rejects(run(), (error) => {
    assert.ok(error instanceof Error, 'expected an Error instance');
    assert.ok(
      error.code === code || String(error.message).startsWith(code),
      `expected ${code}, got code=${error.code} message=${error.message}`,
    );
    return true;
  });
  if (calls) assert.equal(calls.length, 0, 'validation must reject before any fetch');
}

// --- query builders (required keys per the plan's descriptor block) ---
const rosterQuery = (over = {}) => ({
  type: 'workflow',
  limit: 100,
  offset: 0,
  sortBy: 'name',
  sortOrder: 'asc',
  includeCustomObjects: 'true',
  includeObjectiveBuilder: 'true',
  ...over,
});
// `dateType` and `action` are REQUIRED here now. Without `dateType=custom` the endpoint
// silently ignores the window and serves its own 30-day default, so the descriptor pins the
// switch and a query that omits it cannot be built at all.
const logsQuery = (over = {}) => ({
  workflowId: WF, locationId: LOC, limit: 100, dateType: 'custom',
  fromDate: 0, toDate: 10, action: 'first', ...over,
});
const stepQuery = (over = {}) => ({
  workflowId: WF, locationId: LOC, currentStepId: STEP, skip: 0, limit: 50, showTotalCount: 'true', ...over,
});
const studioQuery = (over = {}) => ({
  locationId: LOC,
  agencyId: COMPANY,
  productId: 'superagent',
  page: 1,
  pageSize: 100,
  groupBy: 'foldersFirst',
  sortBy: 'lastUpdated',
  sortOrder: 'desc',
  ...over,
});

// One minimal LEGAL request per descriptor, in descriptor order. Four capabilities
// (sticky notes and the three non-Voice AI reads) previously never traversed
// callCapability at all, so their host, path, and query were asserted nowhere.
const MINIMAL_REQUESTS = {
  workflow_roster_list: {
    capabilityId: 'workflow_roster_list',
    typedBindings: { locationId: LOC },
    query: rosterQuery(),
  },
  workflow_detail: {
    capabilityId: 'workflow_detail',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { includeScheduledPauseInfo: 'true' },
  },
  workflow_triggers: {
    capabilityId: 'workflow_triggers',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF },
  },
  workflow_sticky_notes: {
    capabilityId: 'workflow_sticky_notes',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  },
  workflow_execution_logs: {
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  },
  workflow_count_per_step: {
    capabilityId: 'workflow_count_per_step',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  },
  workflow_enrollment_search: {
    capabilityId: 'workflow_enrollment_search',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC, action: 'first', limit: 20 },
  },
  workflow_step_details: {
    capabilityId: 'workflow_step_details',
    typedBindings: { locationId: LOC, workflowId: WF, stepId: STEP },
    query: stepQuery(),
  },
  workflow_enroll_stats_cache: {
    capabilityId: 'workflow_enroll_stats_cache',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { 'workflowIds[]': [WF], locationId: LOC },
  },
  workflow_enroll_stats: {
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  },
  voice_ai_agent_discovery: {
    capabilityId: 'voice_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  },
  voice_ai_agent_detail: {
    capabilityId: 'voice_ai_agent_detail',
    typedBindings: {
      locationId: LOC,
      agentId: 'agent-1',
      discoveredAgentIds: { voice_ai_agent_discovery: ['agent-1'] },
    },
    query: { locationId: LOC },
  },
  conversation_ai_agent_discovery: {
    capabilityId: 'conversation_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  },
  conversation_ai_agent_detail: {
    capabilityId: 'conversation_ai_agent_detail',
    typedBindings: {
      locationId: LOC,
      agentId: 'agent-1',
      discoveredAgentIds: { conversation_ai_agent_discovery: ['agent-1'] },
    },
    query: { locationId: LOC },
  },
  agent_studio_agent_discovery: {
    capabilityId: 'agent_studio_agent_discovery',
    typedBindings: { locationId: LOC, companyId: COMPANY },
    query: studioQuery(),
  },
  agent_studio_agent_detail: {
    capabilityId: 'agent_studio_agent_detail',
    typedBindings: {
      locationId: LOC,
      agentId: 'agent-1',
      discoveredAgentIds: { agent_studio_agent_discovery: ['agent-1'] },
    },
    query: { locationId: LOC },
  },
};

const queryString = (url) => String(url).split('?').slice(1).join('?');
const sortedEntries = (url) => [...new URLSearchParams(queryString(url)).entries()]
  .map(([k, v]) => `${k}=${v}`).sort();

// ---------------------------------------------------------------------------
// Route + method policy
// ---------------------------------------------------------------------------

test('a non-GET descriptor-shaped capability is refused by the validator', async () => {
  const { audit, calls } = harness();
  // The audit rail is GET-only: a POST-shaped capability request never reaches fetch.
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      method: 'POST',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery(),
    }),
    'UNAPPROVED_METHOD',
    { calls },
  );
});

test('an unknown capabilityId is UNKNOWN_CAPABILITY and never fetches', async () => {
  const { audit, calls } = harness();
  await rejectsWithCode(
    () => audit.callCapability({ capabilityId: 'workflow_delete_everything', typedBindings: { locationId: LOC }, query: {} }),
    'UNKNOWN_CAPABILITY',
    { calls },
  );
});

test('absolute URLs and host overrides in a path binding are refused', async () => {
  for (const workflowId of ['https://evil.example/x', '//evil.example', 'gopher://evil.example', 'x://y']) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'workflow_detail',
        typedBindings: { locationId: LOC, workflowId },
        query: { includeScheduledPauseInfo: 'true' },
      }),
      'INVALID_PATH_BINDING',
      { calls },
    );
  }
});

test('encoded traversal and multi-segment path bindings are refused', async () => {
  for (const workflowId of ['..', '%2e%2e', '%2E%2E', '%2F', '%2f', 'a/b', '../../etc/passwd', 'wf%2F1']) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'workflow_detail',
        typedBindings: { locationId: LOC, workflowId },
        query: { includeScheduledPauseInfo: 'true' },
      }),
      'INVALID_PATH_BINDING',
      { calls },
    );
  }
});

test('an absent typed value for a path variable is MISSING_PATH_BINDING', async () => {
  const { audit, calls } = harness();
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_detail',
      typedBindings: { locationId: LOC },
      query: { includeScheduledPauseInfo: 'true' },
    }),
    'MISSING_PATH_BINDING',
    { calls },
  );
});

// ---------------------------------------------------------------------------
// Query policy
// ---------------------------------------------------------------------------

test('an unknown query key is refused before fetch', async () => {
  const { audit, calls } = harness();
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      // `actionType` is a REAL, working GHL filter that this descriptor deliberately does
      // not declare, because its value enum cannot be established from any available source
      // and an unrecognised value returns a silent empty page. Undeclared means unsendable.
      query: logsQuery({ actionType: 'email' }),
    }),
    'UNKNOWN_QUERY_KEY',
    { calls },
  );
});

test('a missing required query key is refused before fetch', async () => {
  const { audit, calls } = harness();
  const query = logsQuery();
  delete query.dateType;
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query,
    }),
    'MISSING_QUERY_KEY',
    { calls },
  );
});

test('a repeated non-repeatable query key is DUPLICATE_QUERY_KEY', async () => {
  const { audit, calls } = harness();
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery({ eventType: ['sent', 'failed'] }),
    }),
    'DUPLICATE_QUERY_KEY',
    { calls },
  );
});

test('a wrong locationId in the query is LOCATION_BINDING_MISMATCH', async () => {
  const { audit, calls } = harness();
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery({ locationId: 'LOC-EVIL' }),
    }),
    'LOCATION_BINDING_MISMATCH',
    { calls },
  );
});

test('duplicate locationId values are DUPLICATE_QUERY_KEY, not a silent first-value pass', async () => {
  const { audit, calls } = harness();
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery({ locationId: [LOC, 'LOC-EVIL'] }),
    }),
    'DUPLICATE_QUERY_KEY',
    { calls },
  );
});

test('validation reads every value (URLSearchParams.getAll semantics), so a duplicate cannot bypass it', async () => {
  const { audit, calls } = harness();
  const params = new URLSearchParams();
  params.append('workflowId', WF);
  params.append('locationId', LOC);
  params.append('locationId', 'LOC-EVIL');
  params.append('limit', '100');
  params.append('dateType', 'custom');
  params.append('fromDate', '0');
  params.append('toDate', '10');
  params.append('action', 'first');
  // .get() would return LOC and pass; .getAll() sees the smuggled second value.
  assert.equal(params.get('locationId'), LOC);
  assert.deepEqual(params.getAll('locationId'), [LOC, 'LOC-EVIL']);
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: params,
    }),
    'DUPLICATE_QUERY_KEY',
    { calls },
  );
});

test('a fixed query value cannot be changed', async () => {
  const cases = [
    ['workflow_execution_logs', { locationId: LOC, workflowId: WF }, logsQuery({ dateType: 'all' })],
    ['workflow_roster_list', { locationId: LOC }, rosterQuery({ type: 'campaign' })],
    ['workflow_roster_list', { locationId: LOC }, rosterQuery({ sortOrder: 'desc' })],
    ['workflow_step_details', { locationId: LOC, workflowId: WF, stepId: STEP }, stepQuery({ showTotalCount: 'false' })],
    ['agent_studio_agent_discovery', { locationId: LOC, companyId: COMPANY }, studioQuery({ productId: 'workflows' })],
  ];
  for (const [capabilityId, typedBindings, query] of cases) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({ capabilityId, typedBindings, query }),
      'FIXED_QUERY_VALUE_MISMATCH',
      { calls },
    );
  }
});

test('a value outside the allowed set is refused', async () => {
  const cases = [
    ['workflow_roster_list', { locationId: LOC }, rosterQuery({ status: 'archived' })],
    ['workflow_enrollment_search', { locationId: LOC, workflowId: WF },
      { workflowId: WF, locationId: LOC, action: 'previous', limit: 20 }],
  ];
  for (const [capabilityId, typedBindings, query] of cases) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({ capabilityId, typedBindings, query }),
      'DISALLOWED_QUERY_VALUE',
      { calls },
    );
  }
});

test('numeric bounds are enforced at both ends', async () => {
  const cases = [
    // The log limit is BOUNDED, not pinned — the cursor makes page size a throughput knob.
    ['workflow_execution_logs', { locationId: LOC, workflowId: WF }, logsQuery({ limit: 5001 })],
    ['workflow_execution_logs', { locationId: LOC, workflowId: WF }, logsQuery({ limit: 0 })],
    ['workflow_roster_list', { locationId: LOC }, rosterQuery({ limit: 101 })],
    ['workflow_roster_list', { locationId: LOC }, rosterQuery({ limit: 0 })],
    ['workflow_roster_list', { locationId: LOC }, rosterQuery({ offset: -1 })],
    ['workflow_step_details', { locationId: LOC, workflowId: WF, stepId: STEP }, stepQuery({ limit: 51 })],
    ['workflow_step_details', { locationId: LOC, workflowId: WF, stepId: STEP }, stepQuery({ skip: -1 })],
    ['agent_studio_agent_discovery', { locationId: LOC, companyId: COMPANY }, studioQuery({ page: 0 })],
    ['agent_studio_agent_discovery', { locationId: LOC, companyId: COMPANY }, studioQuery({ pageSize: 101 })],
  ];
  for (const [capabilityId, typedBindings, query] of cases) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({ capabilityId, typedBindings, query }),
      'QUERY_BOUND_VIOLATION',
      { calls },
    );
  }
});

// ---------------------------------------------------------------------------
// Typed-binding policy
// ---------------------------------------------------------------------------

test('a query value that contradicts its typed binding is refused before fetch', async () => {
  const cases = [
    // wrong workflow binding
    ['workflow_execution_logs', { locationId: LOC, workflowId: WF }, logsQuery({ workflowId: 'wf-other' })],
    ['workflow_triggers', { locationId: LOC, workflowId: WF }, { workflowId: 'wf-other' }],
    // wrong workflowIds[] contents. REWRITTEN (I4): the two-value case used to live here
    // and assert BINDING_MISMATCH, which only held while the key was declared repeatable.
    // With `repeatableQueryKeys: []` a second value is refused one rule EARLIER, as
    // DUPLICATE_QUERY_KEY, so it is asserted in the M7 block below instead. What belongs
    // here is the single WRONG value, which is a binding fault at any cardinality.
    ['workflow_enroll_stats_cache', { locationId: LOC, workflowId: WF },
      { 'workflowIds[]': ['wf-other'], locationId: LOC }],
    // wrong currentStepId
    ['workflow_step_details', { locationId: LOC, workflowId: WF, stepId: STEP },
      stepQuery({ currentStepId: 'step-other' })],
    // wrong agencyId (company)
    ['agent_studio_agent_discovery', { locationId: LOC, companyId: COMPANY },
      studioQuery({ agencyId: 'company-other' })],
  ];
  for (const [capabilityId, typedBindings, query] of cases) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({ capabilityId, typedBindings, query }),
      'BINDING_MISMATCH',
      { calls },
    );
  }
});

test('a detail agentId outside the sealed discovery set is refused before fetch', async () => {
  const { audit, calls } = harness();
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'voice_ai_agent_detail',
      // discoveredAgentIds is the sealed discovery result the composite hands down,
      // keyed by the discovery capability that produced it.
      typedBindings: {
        locationId: LOC,
        agentId: 'agent-9',
        discoveredAgentIds: { voice_ai_agent_discovery: ['agent-1', 'agent-2'] },
      },
      query: { locationId: LOC },
    }),
    'BINDING_MISMATCH',
    { calls },
  );
});

test('a detail agentId inside the sealed discovery set is allowed through', async () => {
  const { audit, calls } = harness();
  const result = await audit.callCapability({
    capabilityId: 'voice_ai_agent_detail',
    typedBindings: {
      locationId: LOC,
      agentId: 'agent-1',
      discoveredAgentIds: { voice_ai_agent_discovery: ['agent-1', 'agent-2'] },
    },
    query: { locationId: LOC },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${SERVICES}/voice-ai/agents/agent-1?locationId=${LOC}`);
  assert.equal(result.capabilityId, 'voice_ai_agent_detail');
});

// I10: the three AI products share an id shape, so a flat product-agnostic seal lets a
// Voice id probe the Conversation-AI and Agent-Studio detail routes with a plausible id.
test('a sealed id from one AI product cannot authorize another product detail route', async () => {
  const crossProduct = [
    ['conversation_ai_agent_detail', 'voice_ai_agent_discovery'],
    ['agent_studio_agent_detail', 'voice_ai_agent_discovery'],
    ['voice_ai_agent_detail', 'conversation_ai_agent_discovery'],
    ['voice_ai_agent_detail', 'agent_studio_agent_discovery'],
  ];
  for (const [capabilityId, wrongSealKey] of crossProduct) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId,
        typedBindings: {
          locationId: LOC,
          agentId: 'agent-1',
          discoveredAgentIds: { [wrongSealKey]: ['agent-1'] },
        },
        query: { locationId: LOC },
      }),
      'BINDING_MISMATCH',
      { calls },
    );
  }
});

test('a seal that is absent, a bare array, or a non-array under the right key fails closed', async () => {
  const badSeals = [
    undefined,
    null,
    ['agent-1'],                                        // the old flat shape is no longer a seal
    'agent-1',
    {},                                                 // right shape, missing this product's key
    { voice_ai_agent_discovery: 'agent-1' },            // right key, not an array
    { voice_ai_agent_discovery: null },
  ];
  for (const discoveredAgentIds of badSeals) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'voice_ai_agent_detail',
        typedBindings: { locationId: LOC, agentId: 'agent-1', discoveredAgentIds },
        query: { locationId: LOC },
      }),
      'BINDING_MISMATCH',
      { calls },
    );
  }
});

test('each AI detail route accepts its OWN product seal', async () => {
  const pairs = [
    ['voice_ai_agent_detail', 'voice_ai_agent_discovery', `${SERVICES}/voice-ai/agents/agent-1?locationId=${LOC}`],
    ['conversation_ai_agent_detail', 'conversation_ai_agent_discovery', `${SERVICES}/ai-employees/employees/agent-1?locationId=${LOC}`],
    ['agent_studio_agent_detail', 'agent_studio_agent_discovery', `${SERVICES}/agent-studio/super-agent/agents/agent-1?locationId=${LOC}`],
  ];
  for (const [capabilityId, sealKey, expectedUrl] of pairs) {
    const { audit, calls } = harness();
    const result = await audit.callCapability({
      capabilityId,
      typedBindings: { locationId: LOC, agentId: 'agent-1', discoveredAgentIds: { [sealKey]: ['agent-1'] } },
      query: { locationId: LOC },
    });
    assert.equal(result.ok, true, `${capabilityId} should have been allowed`);
    assert.equal(calls[0].url, expectedUrl);
  }
});

test('rejection messages never echo a credential-looking value', async () => {
  const first = harness();
  await assert.rejects(
    first.audit.callCapability({
      capabilityId: 'workflow_detail',
      typedBindings: { locationId: LOC, workflowId: `${CREDENTIAL_LOOKING}/x` },
      query: { includeScheduledPauseInfo: 'true' },
    }),
    (error) => {
      assert.ok(!String(error.message).includes(CREDENTIAL_LOOKING), 'message leaked the raw value');
      assert.ok(!containsSecrets(String(error.message)), `message looks credential-bearing: ${error.message}`);
      return true;
    },
  );
  assert.equal(first.calls.length, 0);

  const second = harness();
  await assert.rejects(
    second.audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery({ authorization: `Bearer ${CREDENTIAL_LOOKING}` }),
    }),
    (error) => {
      assert.ok(!String(error.message).includes(CREDENTIAL_LOOKING), 'message leaked the raw value');
      assert.ok(!containsSecrets(String(error.message)), `message looks credential-bearing: ${error.message}`);
      return true;
    },
  );
  assert.equal(second.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Exact emitted request shapes
// ---------------------------------------------------------------------------

test('details-by-step emits currentStepId plus the fixed showTotalCount=true', async () => {
  const { audit, calls } = harness();
  const result = await audit.callCapability({
    capabilityId: 'workflow_step_details',
    typedBindings: { locationId: LOC, workflowId: WF, stepId: STEP },
    query: stepQuery(),
  });
  assert.equal(calls.length, 1);
  const url = calls[0].url;
  assert.ok(url.startsWith(`${BACKEND}/workflows/status/search/details-by-step?`), `unexpected url ${url}`);
  assert.deepEqual(sortedEntries(url), [
    `currentStepId=${STEP}`,
    'limit=50',
    `locationId=${LOC}`,
    'showTotalCount=true',
    'skip=0',
    `workflowId=${WF}`,
  ]);
  assert.ok(queryString(url).includes(`currentStepId=${STEP}`));
  assert.ok(queryString(url).includes('showTotalCount=true'));
  assert.equal(result.appliedPath, '/workflows/status/search/details-by-step');
  assert.deepEqual(result.appliedQuery, {
    workflowId: WF,
    locationId: LOC,
    currentStepId: STEP,
    skip: '0',
    limit: '50',
    showTotalCount: 'true',
  });
});

test('enroll-stats-cache emits the LITERAL workflowIds[] key, not percent-encoded brackets', async () => {
  const { audit, calls } = harness();
  const result = await audit.callCapability({
    capabilityId: 'workflow_enroll_stats_cache',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { 'workflowIds[]': [WF], locationId: LOC },
  });
  assert.equal(calls.length, 1);
  const url = calls[0].url;
  assert.ok(url.includes(`workflowIds[]=${WF}`), `expected a literal workflowIds[] key in ${url}`);
  assert.ok(!url.includes('%5B'), `brackets must not be percent-encoded: ${url}`);
  assert.ok(!url.includes('%5D'), `brackets must not be percent-encoded: ${url}`);
  assert.ok(url.includes(`locationId=${LOC}`));
  // REWRITTEN (I4): this used to assert `[WF]`, an ARRAY, which was only the shape because
  // the key was declared repeatable. The literal-bracket emission is handled by the key
  // ENCODER and is independent of that declaration — which is the point of this test — so
  // it must keep working now that the key is single-valued. The receipt records the single
  // value it actually sent.
  assert.equal(result.appliedQuery['workflowIds[]'], WF);
  assert.ok(!Array.isArray(result.appliedQuery['workflowIds[]']));
});

test('/voice-ai/agents/simple traces the discovery capability, never the {agentId} detail', async () => {
  const { audit, calls } = harness();
  const result = await audit.callCapability({
    capabilityId: 'voice_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  });
  assert.equal(calls[0].url, `${SERVICES}/voice-ai/agents/simple?locationId=${LOC}`);
  assert.equal(result.appliedPath, '/voice-ai/agents/simple');
  // This descriptor is its own most-specific match, so it proves the matcher PREFERS the
  // static route — it does NOT prove receipts are minted from the resolved trace rather
  // than the claimed id (both are 'voice_ai_agent_discovery' here). The
  // CAPABILITY_TRACE_MISMATCH tests below are what exercise resolution.
  assert.equal(result.capabilityId, 'voice_ai_agent_discovery');
  assert.notEqual(result.capabilityId, 'voice_ai_agent_detail');
  assert.equal(result.host, 'services');
});

// C3: the ONLY tests where the claimed id and the resolved trace id can disagree. Before
// this, `traced` was computed and thrown away and the receipt echoed the caller's claim.
test('a typed id that collides with a static route segment is CAPABILITY_TRACE_MISMATCH', async () => {
  // 'simple' as an agentId would turn the detail route into the discovery route.
  const voice = harness();
  await rejectsWithCode(
    () => voice.audit.callCapability({
      capabilityId: 'voice_ai_agent_detail',
      typedBindings: {
        locationId: LOC,
        agentId: 'simple',
        discoveredAgentIds: { voice_ai_agent_discovery: ['simple'] },
      },
      query: { locationId: LOC },
    }),
    'CAPABILITY_TRACE_MISMATCH',
    { calls: voice.calls },
  );

  // 'list' and 'trigger' as a workflowId would turn the detail route into the roster and
  // trigger routes respectively.
  for (const workflowId of ['list', 'trigger']) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'workflow_detail',
        typedBindings: { locationId: LOC, workflowId },
        query: { includeScheduledPauseInfo: 'true' },
      }),
      'CAPABILITY_TRACE_MISMATCH',
      { calls },
    );
  }
});

test('a successful capability call returns exactly the audit result contract', async () => {
  const { audit, calls } = harness({ responses: { status: 200, body: '{"records":[{"id":"e1"}]}' } });
  const result = await audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'appliedPath', 'appliedQuery', 'capabilityId', 'capturedAt', 'failureClass',
    'host', 'identity', 'json', 'ok', 'quarantined', 'retryAfterMs', 'status',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { records: [{ id: 'e1' }] });
  assert.equal(result.retryAfterMs, null);
  assert.equal(result.capturedAt, FIXED_NOW);
  assert.equal(result.capabilityId, 'workflow_execution_logs');
  assert.equal(result.host, 'backend');
  assert.equal(result.appliedPath, '/workflows/logs/v2');
  assert.equal(result.failureClass, null);
  assert.equal(result.quarantined, false);
  // The identity receipt's shape is contract too: each incompleteness flag is what lets a
  // caller tell "checked and clean" from "not fully checked", and a flag that can be
  // dropped without a test is a flag that will be.
  assert.deepEqual(Object.keys(result.identity).sort(), [
    'bindingMethod', 'checked', 'conflicts', 'depthCapped', 'inspectionCapped', 'unreadable',
  ]);
  assert.equal(result.identity.inspectionCapped, false);
  assert.equal(result.identity.depthCapped, false);
  assert.deepEqual(result.identity.unreadable, []);
  assert.ok(calls[0].url.startsWith(`${BACKEND}/workflows/logs/v2?`));
});

// M10: plan line 312 requires composites to call `callCapability`, not a raw path method.
// A stray `call`/`callWithMeta`/`gateway` on this surface would silently reopen that door.
test('the audit gateway surface is exactly callCapability plus the bound location', () => {
  const { audit } = harness();
  assert.deepEqual(Object.keys(audit).sort(), ['callCapability', 'locationId']);
  assert.equal(typeof audit.callCapability, 'function');
  assert.equal(audit.locationId, LOC);
  for (const escape of ['call', 'callWithMeta', 'request', 'stream', 'gateway', 'gateways', 'fetch']) {
    assert.equal(audit[escape], undefined, `audit gateway must not expose ${escape}`);
  }
});

test('a path-bound location capability puts the bound location in the path', async () => {
  const { audit, calls } = harness();
  const result = await audit.callCapability({
    capabilityId: 'workflow_roster_list',
    typedBindings: { locationId: LOC },
    query: rosterQuery(),
  });
  assert.equal(result.appliedPath, `/workflow/${LOC}/list`);
  assert.ok(calls[0].url.startsWith(`${BACKEND}/workflow/${LOC}/list?`));
  assert.ok(!queryString(calls[0].url).includes('locationId='));
});

// ---------------------------------------------------------------------------
// One shared limiter
// ---------------------------------------------------------------------------

test('concurrent callCapability calls respect one global minimum spacing', async () => {
  const clock = makeClock();
  const grants = [];
  const calls = [];
  const inner = stubFetch(calls);
  const gateway = makeGateway({
    tokenFile: fixture(),
    loc: LOC,
    // The gateway's own throttle must not move the clock: this test measures the
    // limiter's spacing alone.
    sleepImpl: async () => {},
    randomImpl: () => 0,
    nowImpl: clock.now,
    fetchImpl: async (url, init) => { grants.push(clock.now()); return inner(url, init); },
  });
  const limiter = makeAuditLimiter({
    minimumDelayMs: 300,
    jitterMs: 0,
    sleepImpl: clock.sleep,
    randomImpl: () => 0,
    nowImpl: clock.now,
  });
  const audit = makeAuditGateway({ gateways: { backend: gateway }, locationId: LOC, limiter, circuit: makeAuditCircuit() });
  const one = () => audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });

  await Promise.all([one(), one(), one()]);

  assert.equal(grants.length, 3);
  const ordered = [...grants].sort((a, b) => a - b);
  assert.deepEqual(grants, ordered, 'grants must be issued in a serialized order');
  for (let i = 1; i < ordered.length; i += 1) {
    assert.ok(ordered[i] - ordered[i - 1] >= 300, `grants ${i - 1}->${i} only ${ordered[i] - ordered[i - 1]}ms apart`);
  }
});

test('two audit gateways sharing one limiter still serialize', async () => {
  const clock = makeClock();
  const grants = [];
  const limiter = makeAuditLimiter({
    minimumDelayMs: 300,
    jitterMs: 0,
    sleepImpl: clock.sleep,
    randomImpl: () => 0,
    nowImpl: clock.now,
  });
  const circuit = makeAuditCircuit();
  const build = () => {
    const calls = [];
    const inner = stubFetch(calls);
    const gateway = makeGateway({
      tokenFile: fixture(),
      loc: LOC,
      sleepImpl: async () => {},
      randomImpl: () => 0,
      nowImpl: clock.now,
      fetchImpl: async (url, init) => { grants.push(clock.now()); return inner(url, init); },
    });
    return makeAuditGateway({ gateways: { backend: gateway }, locationId: LOC, limiter, circuit });
  };
  const first = build();
  const second = build();
  const one = (audit) => audit.callCapability({
    capabilityId: 'workflow_count_per_step',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });

  await Promise.all([one(first), one(second), one(first), one(second)]);

  assert.equal(grants.length, 4);
  const ordered = [...grants].sort((a, b) => a - b);
  for (let i = 1; i < ordered.length; i += 1) {
    assert.ok(ordered[i] - ordered[i - 1] >= 300, `cross-gateway grants ${i - 1}->${i} only ${ordered[i] - ordered[i - 1]}ms apart`);
  }
});

// ---------------------------------------------------------------------------
// Retry-After parsing (gateway.callWithMeta)
// ---------------------------------------------------------------------------

test('numeric Retry-After becomes milliseconds', async () => {
  const calls = [];
  const gw = realGateway({ calls, responses: { status: 429, body: '{}', headers: { 'retry-after': '2' } } });
  const meta = await gw.callWithMeta('GET', '/workflows/logs/v2', undefined, { base: BACKEND });
  assert.equal(meta.retryAfterMs, 2000);
  assert.equal(meta.status, 429);
  assert.equal(meta.ok, false);
});

test('an HTTP-date Retry-After is measured against the injected clock', async () => {
  const calls = [];
  const future = new Date(FIXED_NOW + 30_000).toUTCString();
  const gw = realGateway({ calls, responses: { status: 429, body: '{}', headers: { 'retry-after': future } } });
  const meta = await gw.callWithMeta('GET', '/workflows/logs/v2', undefined, { base: BACKEND });
  // toUTCString() truncates to whole seconds, so allow the sub-second floor.
  assert.ok(meta.retryAfterMs > 0, `expected a positive delay, got ${meta.retryAfterMs}`);
  assert.ok(meta.retryAfterMs <= 30_000 && meta.retryAfterMs >= 29_000, `unexpected delay ${meta.retryAfterMs}`);
});

test('a past HTTP-date Retry-After clamps to zero', async () => {
  const calls = [];
  const past = new Date(FIXED_NOW - 60_000).toUTCString();
  const gw = realGateway({ calls, responses: { status: 429, body: '{}', headers: { 'retry-after': past } } });
  const meta = await gw.callWithMeta('GET', '/workflows/logs/v2', undefined, { base: BACKEND });
  assert.equal(meta.retryAfterMs, 0);
});

test('a malformed Retry-After is null, and so is an absent one', async () => {
  const malformed = realGateway({ calls: [], responses: { status: 429, body: '{}', headers: { 'retry-after': 'soon' } } });
  assert.equal((await malformed.callWithMeta('GET', '/workflows/logs/v2', undefined, { base: BACKEND })).retryAfterMs, null);

  const absent = realGateway({ calls: [], responses: { status: 200, body: '{}' } });
  assert.equal((await absent.callWithMeta('GET', '/workflows/logs/v2', undefined, { base: BACKEND })).retryAfterMs, null);
});

test('gateway.call() stays exactly {status, ok, json} while callWithMeta adds metadata', async () => {
  const calls = [];
  const gw = realGateway({ calls, responses: { status: 200, body: '{"a":1}', headers: { 'retry-after': '5' } } });

  const plain = await gw.call('GET', '/workflow/LOC1/list');
  assert.deepEqual(Object.keys(plain).sort(), ['json', 'ok', 'status']);
  assert.deepEqual(plain, { status: 200, ok: true, json: { a: 1 } });

  const meta = await gw.callWithMeta('GET', '/workflow/LOC1/list', undefined, { base: BACKEND });
  assert.deepEqual(Object.keys(meta).sort(), ['capturedAt', 'json', 'ok', 'retryAfterMs', 'status']);
  assert.equal(meta.status, 200);
  assert.equal(meta.ok, true);
  assert.deepEqual(meta.json, { a: 1 });
  assert.equal(meta.retryAfterMs, 5000);
  assert.equal(meta.capturedAt, FIXED_NOW);
});

// ---------------------------------------------------------------------------
// Fail-closed + circuit
// ---------------------------------------------------------------------------

// REVERSED DELIBERATELY, TWICE. The original test pinned "403 leaves the circuit closed".
// The previous pass replaced it with "401 AND 403 both latch a PROCESS-WIDE circuit",
// reading core/errors.mjs's shared 401/403 -> TOKEN_EXPIRED mapping as proof that both
// mean "dead credential". That reading was wrong on both halves:
//   * 403 is an ENTITLEMENT refusal about one resource (an unprovisioned product, a
//     soft-deleted agent), not a dead credential. Task 4's tombstone rule (plan line ~541)
//     only skips rows with BOTH isDeleted:true AND agentStatus:"INACTIVE", so a
//     half-signalled row still gets a detail call and can still 403 — under a process-wide
//     latch that single row would end the entire run, and per-component completeness
//     would be unimplementable.
//   * even a genuine 401 is a RAIL fact. The two audit rails carry independent
//     credentials, so an expired AI token-id must not kill an untouched backend audit.
// Both statuses still fail closed at the RESULT level, which is what stops a refusal from
// ever being recorded as an empty read.
test('401 latches only its own rail; 403 latches nothing, and both fail closed', async () => {
  for (const status of [401, 403]) {
    const { audit, calls, circuit } = harness({ responses: { status, body: '{"message":"forbidden"}' } });
    const result = await audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    assert.deepEqual(result.json, { message: 'forbidden' });
    assert.equal(result.failureClass, 'AUTH_REJECTED');
    assert.equal(calls.length, 1, 'a refused read must not be retried');

    // Neither status may ever stop the whole process.
    assert.equal(circuit.isOpen('process'), false, `${status} must not latch the process scope`);

    if (status === 401) {
      assert.equal(circuit.isOpen('backend'), true, '401 must latch the rail it was refused on');
      assert.equal(circuit.state('backend').reason, 'AUTH_REJECTED');
      assert.equal(circuit.state('backend').scope, 'backend');
      assert.equal(circuit.state('backend').meta.status, 401);
      assert.equal(circuit.isOpen('ai'), false, 'the other credential rail is untouched');

      await rejectsWithCode(
        () => audit.callCapability({
          capabilityId: 'workflow_enroll_stats',
          typedBindings: { locationId: LOC, workflowId: WF },
          query: { workflowId: WF, locationId: LOC },
        }),
        'CIRCUIT_OPEN',
      );
      assert.equal(calls.length, 1, 'no further read on a rail with a dead credential');
    } else {
      assert.equal(circuit.isOpen('backend'), false, '403 must not latch any scope');
      assert.equal(circuit.isOpen('ai'), false);

      // The very next capability on the same rail is still readable.
      const next = await audit.callCapability({
        capabilityId: 'workflow_enroll_stats',
        typedBindings: { locationId: LOC, workflowId: WF },
        query: { workflowId: WF, locationId: LOC },
      });
      assert.equal(next.status, 403, 'the stub answers 403 again, but the read was ATTEMPTED');
      assert.equal(calls.length, 2, 'a 403 must not stop the run');
    }
  }
});

test('a 403 on the ai rail leaves BOTH rails usable', async () => {
  // The exact Task 4 case: a Voice row carrying only one deletion signal is not a
  // confirmed tombstone, so it still gets a detail call, and that call may be forbidden.
  // Under the previous process-wide latch this single row killed the backend rail too.
  const { audit, calls, circuit } = harness({
    responses: [
      { status: 403, body: '{"message":"forbidden"}' },
      { status: 200, body: '{"agents":[]}' },
      { status: 200, body: '{"records":[]}' },
    ],
  });
  const forbidden = await audit.callCapability({
    capabilityId: 'voice_ai_agent_detail',
    typedBindings: { locationId: LOC, agentId: 'agent-1', discoveredAgentIds: { voice_ai_agent_discovery: ['agent-1'] } },
    query: { locationId: LOC },
  });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.failureClass, 'AUTH_REJECTED');
  assert.equal(circuit.isOpen('process'), false);
  assert.equal(circuit.isOpen('ai'), false);
  assert.equal(circuit.isOpen('backend'), false);

  const aiAgain = await audit.callCapability({
    capabilityId: 'voice_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  });
  assert.equal(aiAgain.ok, true, 'the ai rail must survive a per-resource refusal');

  const backend = await audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });
  assert.equal(backend.ok, true, 'the backend rail was never involved');
  assert.equal(calls.length, 3);
});

test('a 401 on the ai rail blocks the ai rail only', async () => {
  const { audit, calls, circuit } = harness({
    responses: [
      { status: 401, body: '{"message":"unauthorized"}' },
      { status: 200, body: '{"records":[]}' },
    ],
  });
  const refused = await audit.callCapability({
    capabilityId: 'voice_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.failureClass, 'AUTH_REJECTED');
  assert.equal(circuit.isOpen('ai'), true);
  assert.equal(circuit.state('ai').reason, 'AUTH_REJECTED');
  assert.equal(circuit.isOpen('process'), false);
  assert.equal(circuit.isOpen('backend'), false);

  // Every further ai read is refused without a fetch...
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'conversation_ai_agent_discovery',
      typedBindings: { locationId: LOC },
      query: { locationId: LOC },
    }),
    'CIRCUIT_OPEN',
  );
  assert.equal(calls.length, 1);

  // ...while the backend rail, which carries a different credential, still reads.
  const backend = await audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });
  assert.equal(backend.ok, true);
  assert.equal(calls.length, 2);
});

test('a 429 on either rail blocks BOTH rails', async () => {
  // A location-level throttle is an account fact, not a credential fact: continuing on
  // the other rail keeps pushing the account that just said stop.
  for (const first of ['ai', 'backend']) {
    const { audit, calls, circuit } = harness({ responses: { status: 429, body: '{}', headers: { 'retry-after': '2' } } });
    const request = first === 'ai'
      ? { capabilityId: 'voice_ai_agent_discovery', typedBindings: { locationId: LOC }, query: { locationId: LOC } }
      : { capabilityId: 'workflow_enroll_stats', typedBindings: { locationId: LOC, workflowId: WF }, query: { workflowId: WF, locationId: LOC } };
    const throttled = await audit.callCapability(request);
    assert.equal(throttled.ok, false);
    assert.equal(circuit.isOpen('process'), true, `429 on ${first} must latch the process scope`);
    assert.equal(circuit.isOpen('ai'), true);
    assert.equal(circuit.isOpen('backend'), true);

    for (const other of [
      { capabilityId: 'voice_ai_agent_discovery', typedBindings: { locationId: LOC }, query: { locationId: LOC } },
      { capabilityId: 'workflow_enroll_stats', typedBindings: { locationId: LOC, workflowId: WF }, query: { workflowId: WF, locationId: LOC } },
    ]) {
      await rejectsWithCode(() => audit.callCapability(other), 'CIRCUIT_OPEN');
    }
    assert.equal(calls.length, 1, 'no read on either rail once the process circuit is latched');
  }
});

test('a location-throttled 200 on one rail also blocks both rails', async () => {
  const { audit, calls, circuit } = harness({ responses: { status: 200, body: '{"isLocationRateLimited":true}' } });
  await audit.callCapability({
    capabilityId: 'voice_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  });
  assert.equal(circuit.state('process').reason, 'LOCATION_RATE_LIMITED');
  assert.equal(circuit.isOpen('backend'), true);
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_enroll_stats',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: { workflowId: WF, locationId: LOC },
    }),
    'CIRCUIT_OPEN',
  );
  assert.equal(calls.length, 1);
});

test('a transport failure latches its own rail, not the process', async () => {
  // A rail is 1:1 with a host, so an unreachable host is a rail-level fact and says
  // nothing about the other rail's host.
  const boom = new Error('socket hang up');
  const calls = [];
  const circuit = makeAuditCircuit();
  const audit = makeAuditGateway({
    gateways: {
      backend: realGateway({ calls, responses: { status: 200, body: '{"records":[]}' }, rail: 'jwt' }),
      ai: makeGateway({
        tokenFile: fixture(), loc: LOC, rail: 'ai',
        fetchImpl: async () => { throw boom; },
        sleepImpl: async () => {}, randomImpl: () => 0, nowImpl: () => FIXED_NOW,
      }),
    },
    locationId: LOC,
    limiter: passthroughLimiter(),
    circuit,
  });

  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'voice_ai_agent_discovery',
      typedBindings: { locationId: LOC },
      query: { locationId: LOC },
    }),
    'TRANSPORT_FAILED',
  );
  assert.equal(circuit.isOpen('ai'), true);
  assert.equal(circuit.state('ai').reason, 'TRANSPORT_FAILED');
  assert.equal(circuit.isOpen('process'), false);
  assert.equal(circuit.isOpen('backend'), false);

  const backend = await audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });
  assert.equal(backend.ok, true, 'a dead AI host must not stop the backend rail');
});

test('CIRCUIT_OPEN names the scope that blocked the read', async () => {
  const { audit } = harness({ responses: { status: 401, body: '{}' } });
  await audit.callCapability({
    capabilityId: 'voice_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  });
  await assert.rejects(
    audit.callCapability({
      capabilityId: 'conversation_ai_agent_discovery',
      typedBindings: { locationId: LOC },
      query: { locationId: LOC },
    }),
    (error) => {
      assert.equal(error.code, 'CIRCUIT_OPEN');
      assert.equal(error.meta.scope, 'ai', 'a resumer must know WHICH scope to clear');
      assert.equal(error.meta.reason, 'AUTH_REJECTED');
      return true;
    },
  );
});

test('the circuit refuses an unknown scope rather than latching something nothing checks', () => {
  const circuit = makeAuditCircuit();
  for (const bad of ['services', 'jwt', '', 'PROCESS', null]) {
    assert.throws(() => circuit.open(bad, 'REASON'), (error) => {
      assert.equal(error.code, 'INVALID_CIRCUIT_SCOPE');
      return true;
    });
    assert.throws(() => circuit.isOpen(bad), (error) => error.code === 'INVALID_CIRCUIT_SCOPE');
    assert.throws(() => circuit.state(bad), (error) => error.code === 'INVALID_CIRCUIT_SCOPE');
  }
  // An omitted scope is not a bad scope: isOpen()/state() with no argument mean "is the
  // whole run stopped", while `open` has no default because a latch must say what it is.
  assert.throws(() => circuit.open(undefined, 'REASON'), (error) => error.code === 'INVALID_CIRCUIT_SCOPE');
  assert.equal(circuit.isOpen(), false);
  assert.deepEqual(circuit.state(), { open: false, scope: null, reason: null, meta: null });
  circuit.open('process', 'RATE_LIMITED');
  assert.equal(circuit.isOpen(), true);
});

test('429 fails closed AND opens the shared circuit', async () => {
  const { audit, calls, circuit } = harness({
    responses: { status: 429, body: '{"message":"rate limited"}', headers: { 'retry-after': '2' } },
  });
  const result = await audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(result.retryAfterMs, 2000);
  assert.equal(calls.length, 1);
  assert.equal(circuit.isOpen(), true);
  assert.equal(circuit.state().open, true);
  // M3: the latch reason is the same CODES value as the result's failureClass. It used to
  // be the template string `HTTP_429` while failureClass said RATE_LIMITED, so a resumer
  // branching on the reason matched nothing.
  assert.equal(result.failureClass, 'RATE_LIMITED');
  assert.equal(circuit.state().reason, 'RATE_LIMITED');
  assert.equal(circuit.state().scope, 'process');
});

test('a 200 body carrying isLocationRateLimited:true fails closed and opens the circuit', async () => {
  const { audit, calls, circuit } = harness({
    responses: { status: 200, body: '{"isLocationRateLimited":true,"records":[]}' },
  });
  const result = await audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });
  assert.equal(result.ok, false, 'a location-rate-limited body is never a success');
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(circuit.isOpen(), true);
});

test('an open circuit throws CIRCUIT_OPEN, makes no further fetch, and never auto-retries', async () => {
  const { audit, calls, circuit } = harness({ responses: { status: 429, body: '{}' } });
  const first = await audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });
  assert.equal(first.ok, false);
  assert.equal(calls.length, 1, 'the 429 itself must not be retried');
  assert.equal(circuit.isOpen(), true);

  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_count_per_step',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: { workflowId: WF, locationId: LOC },
    }),
    'CIRCUIT_OPEN',
  );
  assert.equal(calls.length, 1, 'no additional fetch is permitted once the circuit is open');
});

test('a circuit opened by one audit gateway blocks another sharing it', async () => {
  const circuit = makeAuditCircuit();
  const limiter = passthroughLimiter();
  const first = harness({ responses: { status: 429, body: '{}' }, circuit, limiter });
  const second = harness({ responses: { status: 200, body: '{}' }, circuit, limiter });

  await first.audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });
  assert.equal(circuit.isOpen(), true);

  await rejectsWithCode(
    () => second.audit.callCapability({
      capabilityId: 'workflow_enroll_stats',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: { workflowId: WF, locationId: LOC },
    }),
    'CIRCUIT_OPEN',
    { calls: second.calls },
  );
});

test('a fresh circuit reports closed state and opens with a scope, reason, plus metadata', () => {
  const circuit = makeAuditCircuit();
  assert.equal(circuit.isOpen(), false);
  assert.equal(circuit.state().open, false);
  circuit.open('process', 'RATE_LIMITED', { capabilityId: 'workflow_execution_logs', status: 429 });
  assert.equal(circuit.isOpen(), true);
  assert.equal(circuit.state().open, true);
  assert.equal(circuit.state().scope, 'process');
  assert.equal(circuit.state().reason, 'RATE_LIMITED');
  assert.deepEqual(circuit.state().meta, { capabilityId: 'workflow_execution_logs', status: 429 });

  // The first reason per scope wins, and a later rail latch cannot rewrite it.
  circuit.open('process', 'LOCATION_RATE_LIMITED', { capabilityId: 'other', status: 200 });
  assert.equal(circuit.state().reason, 'RATE_LIMITED');
});

test('a rail latch blocks only that rail, and a process latch outranks it', () => {
  const circuit = makeAuditCircuit();
  circuit.open('ai', 'AUTH_REJECTED', { capabilityId: 'voice_ai_agent_discovery', status: 401 });
  assert.equal(circuit.isOpen('ai'), true);
  assert.equal(circuit.state('ai').scope, 'ai');
  assert.equal(circuit.isOpen('backend'), false);
  assert.equal(circuit.isOpen('process'), false, 'a rail fact is not a process fact');

  circuit.open('process', 'RATE_LIMITED', { status: 429 });
  assert.equal(circuit.isOpen('backend'), true, 'a process latch blocks every scope');
  // The broader, earlier fact is what a resumer must clear first, so it is reported even
  // when the rail carries its own latch.
  assert.equal(circuit.state('ai').scope, 'process');
  assert.equal(circuit.state('ai').reason, 'RATE_LIMITED');
});

// m5: `state(scope)` reports the BLOCKER, and a process latch outranks a rail latch there
// — which meant that once the process latched, the fact that a rail had ALSO latched
// became unrecoverable from the circuit. A checkpoint written after both could only record
// the throttle, so a resumer would clear it and walk straight back into the dead AI
// credential. Per-scope reasons must stay independently readable, and the whole set must
// be enumerable for Task 3/5 checkpoint metadata.
test('m5: a rail latch stays readable after the process latches, and every latch is enumerable', () => {
  const circuit = makeAuditCircuit();
  assert.deepEqual(circuit.latches(), [], 'a fresh circuit has no latches to record');
  assert.deepEqual(circuit.latchOf('ai'), { open: false, scope: 'ai', reason: null, meta: null });

  circuit.open('ai', 'AUTH_REJECTED', { capabilityId: 'voice_ai_agent_discovery', status: 401 });
  circuit.open('process', 'RATE_LIMITED', { capabilityId: 'workflow_execution_logs', status: 429 });

  // The blocker view is unchanged: the broader fact still outranks.
  assert.equal(circuit.state('ai').scope, 'process');
  // The per-scope view survives it. This is the fact that used to be lost.
  assert.equal(circuit.latchOf('ai').open, true);
  assert.equal(circuit.latchOf('ai').reason, 'AUTH_REJECTED');
  assert.deepEqual(circuit.latchOf('ai').meta, { capabilityId: 'voice_ai_agent_discovery', status: 401 });
  // A scope that never latched still reads as closed even while it is blocked.
  assert.equal(circuit.isOpen('backend'), true, 'backend is BLOCKED by the process latch');
  assert.equal(circuit.latchOf('backend').open, false, 'but backend itself never latched');

  // Both must be recoverable together, in scope order, so a checkpoint can record the
  // complete set of things an operator has to clear.
  assert.deepEqual(circuit.latches(), [
    { scope: 'process', reason: 'RATE_LIMITED', meta: { capabilityId: 'workflow_execution_logs', status: 429 } },
    { scope: 'ai', reason: 'AUTH_REJECTED', meta: { capabilityId: 'voice_ai_agent_discovery', status: 401 } },
  ]);

  // The scope guard applies to the new readers too: a mistyped scope must be loud rather
  // than silently reporting "nothing latched here".
  for (const reader of ['latchOf', 'unusableBodyRun']) {
    assert.throws(() => circuit[reader]('backend-rail'), (error) => {
      assert.equal(error.code, 'INVALID_CIRCUIT_SCOPE');
      return true;
    }, `${reader} must reject an unknown scope`);
  }
});

// ---------------------------------------------------------------------------
// C1: auth rails are ENFORCED, not merely declared
// ---------------------------------------------------------------------------

test('a swapped rail map is rejected at construction, before any read can be attempted', () => {
  const backendGateway = realGateway({ calls: [], rail: 'jwt' });
  const aiGateway = realGateway({ calls: [], rail: 'ai' });
  const limiter = passthroughLimiter();
  const circuit = makeAuditCircuit();

  // ai gateway in the backend slot: it would refuse every backend base with the untyped
  // AI_RAIL_HOST_INVALID throw, outside the audit taxonomy entirely.
  assert.throws(
    () => makeAuditGateway({ gateways: { backend: aiGateway, ai: backendGateway }, locationId: LOC, limiter, circuit }),
    (error) => error.code === 'AUDIT_RAIL_MISMATCH',
  );
  // jwt gateway in the ai slot alone: it would send the location Bearer to the services
  // host with no token-id and look like a plain 401.
  assert.throws(
    () => makeAuditGateway({ gateways: { ai: backendGateway }, locationId: LOC, limiter, circuit }),
    (error) => error.code === 'AUDIT_RAIL_MISMATCH',
  );
  assert.throws(
    () => makeAuditGateway({ gateways: { backend: aiGateway }, locationId: LOC, limiter, circuit }),
    (error) => error.code === 'AUDIT_RAIL_MISMATCH',
  );
  // The legacy token-id rail is not either audit rail.
  const tokenIdGateway = realGateway({ calls: [], rail: 'token-id' });
  assert.throws(
    () => makeAuditGateway({ gateways: { backend: tokenIdGateway }, locationId: LOC, limiter, circuit }),
    (error) => error.code === 'AUDIT_RAIL_MISMATCH',
  );
  // The correct wiring constructs cleanly.
  assert.ok(makeAuditGateway({ gateways: { backend: backendGateway, ai: aiGateway }, locationId: LOC, limiter, circuit }));
});

test('a services capability with no ai rail supplied fails closed with zero fetches', async () => {
  const { audit, calls } = harness({ slots: ['backend'] });
  for (const capabilityId of ['voice_ai_agent_discovery', 'conversation_ai_agent_discovery', 'agent_studio_agent_discovery']) {
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId,
        typedBindings: { locationId: LOC, companyId: COMPANY },
        query: capabilityId === 'agent_studio_agent_discovery' ? studioQuery() : { locationId: LOC },
      }),
      'MISSING_AUTH_RAIL',
      { calls },
    );
  }
  // The backend rail it DOES hold still works, so the failure is rail-scoped.
  const ok = await audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });
  assert.equal(ok.ok, true);
  assert.equal(calls.length, 1);
});

test('a backend capability with no backend rail supplied fails closed with zero fetches', async () => {
  const { audit, calls } = harness({ slots: ['ai'] });
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery(),
    }),
    'MISSING_AUTH_RAIL',
    { calls },
  );
});

test('each rail carries its own capabilities to its own host with its own credentials', async () => {
  const { audit, calls } = harness();

  await audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });
  await audit.callCapability({
    capabilityId: 'conversation_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  });

  assert.equal(calls.length, 2);
  const [backendCall, aiCall] = calls;

  assert.equal(backendCall.rail, 'jwt', 'a backend capability must travel the jwt-rail gateway');
  assert.ok(backendCall.url.startsWith(`${BACKEND}/workflows/status/enroll-stats?`), backendCall.url);
  assert.equal(backendCall.init.headers.authorization, `Bearer ${jwt}`);
  assert.equal(backendCall.init.headers['token-id'], undefined,
    'the agency token-id must never ride a backend read');

  assert.equal(aiCall.rail, 'ai', 'a services capability must travel the ai-rail gateway');
  assert.equal(aiCall.url, `${SERVICES}/ai-employees/employees/search?locationId=${LOC}`);
  assert.equal(aiCall.init.headers.authorization, `Bearer ${jwt}`);
  assert.equal(aiCall.init.headers['token-id'], tokenId, 'the ai rail must send token-id');
});

test('every descriptor rail is routed to the host its descriptor declares', async () => {
  const { audit, calls } = harness();
  for (const capability of AUDIT_CAPABILITIES) {
    const before = calls.length;
    const request = MINIMAL_REQUESTS[capability.capabilityId];
    await audit.callCapability(request);
    const issued = calls[before];
    assert.equal(issued.rail, capability.authRail === 'ai' ? 'ai' : 'jwt', `${capability.capabilityId}: wrong rail`);
    assert.ok(
      issued.url.startsWith(capability.host === 'services' ? SERVICES : BACKEND),
      `${capability.capabilityId}: went to ${issued.url}`,
    );
  }
});

// ---------------------------------------------------------------------------
// I12: no implicit location
// ---------------------------------------------------------------------------

test('an audit gateway cannot be constructed without a real bound location', () => {
  const gateways = { backend: realGateway({ calls: [], rail: 'jwt' }) };
  const limiter = passthroughLimiter();
  const circuit = makeAuditCircuit();
  for (const locationId of [undefined, null, '', '   ', 123, {}, []]) {
    assert.throws(
      () => makeAuditGateway({ gateways, locationId, limiter, circuit }),
      (error) => error.code === 'INVALID_AUDIT_LOCATION',
      `locationId ${JSON.stringify(locationId)} must be refused`,
    );
  }
});

test('a missing location can no longer be matched by an undefined typed location', async () => {
  // Before the construction guard, String(undefined) === 'undefined' became the bound
  // location and typedBindings.locationId === undefined then compared EQUAL to it.
  assert.throws(
    () => makeAuditGateway({
      gateways: { backend: realGateway({ calls: [], rail: 'jwt' }) },
      limiter: passthroughLimiter(),
      circuit: makeAuditCircuit(),
    }),
    (error) => error.code === 'INVALID_AUDIT_LOCATION',
  );
  // And a gateway bound to the literal string 'undefined' still rejects a real location.
  const { audit, calls } = harness({ locationId: 'undefined' });
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery(),
    }),
    'LOCATION_BINDING_MISMATCH',
    { calls },
  );
});

// ---------------------------------------------------------------------------
// C2: BOTH location guards, for path-bound AND query-bound capabilities
// ---------------------------------------------------------------------------

test('a path-bound capability refuses a wrong location in the path', async () => {
  // The three locationBinding:'path' capabilities. Nothing drove a wrong location through
  // any of them, so the path-side guard was deletable with every test still green.
  const cases = [
    ['workflow_roster_list', { locationId: 'LOC-EVIL' }, rosterQuery()],
    ['workflow_detail', { locationId: 'LOC-EVIL', workflowId: WF }, { includeScheduledPauseInfo: 'true' }],
    ['workflow_triggers', { locationId: 'LOC-EVIL', workflowId: WF }, { workflowId: WF }],
  ];
  for (const [capabilityId, typedBindings, query] of cases) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({ capabilityId, typedBindings, query }),
      'LOCATION_BINDING_MISMATCH',
      { calls },
    );
  }
});

test('a wrong typed locationId is refused for path-bound and query-bound capabilities alike', async () => {
  // The typed-location guard (typedBindings.locationId vs the bound location) was never
  // driven either: no test ever passed a location the gateway was not bound to.
  const cases = [
    // path-bound
    ['workflow_roster_list', { locationId: 'LOC-EVIL' }, rosterQuery()],
    ['workflow_detail', { locationId: 'LOC-EVIL', workflowId: WF }, { includeScheduledPauseInfo: 'true' }],
    ['workflow_triggers', { locationId: 'LOC-EVIL', workflowId: WF }, { workflowId: WF }],
    // query-bound: the typed value is wrong even though the emitted query says LOC
    ['workflow_execution_logs', { locationId: 'LOC-EVIL', workflowId: WF }, logsQuery()],
    ['workflow_sticky_notes', { locationId: 'LOC-EVIL', workflowId: WF }, { workflowId: WF, locationId: LOC }],
    ['workflow_count_per_step', { locationId: 'LOC-EVIL', workflowId: WF }, { workflowId: WF, locationId: LOC }],
    ['workflow_step_details', { locationId: 'LOC-EVIL', workflowId: WF, stepId: STEP }, stepQuery()],
    ['voice_ai_agent_discovery', { locationId: 'LOC-EVIL' }, { locationId: LOC }],
    ['agent_studio_agent_discovery', { locationId: 'LOC-EVIL', companyId: COMPANY }, studioQuery()],
  ];
  for (const [capabilityId, typedBindings, query] of cases) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({ capabilityId, typedBindings, query }),
      'LOCATION_BINDING_MISMATCH',
      { calls },
    );
  }
});

test('a wrong query locationId is refused across every query-bound capability', async () => {
  const cases = [
    ['workflow_sticky_notes', { locationId: LOC, workflowId: WF }, { workflowId: WF, locationId: 'LOC-EVIL' }],
    ['workflow_count_per_step', { locationId: LOC, workflowId: WF }, { workflowId: WF, locationId: 'LOC-EVIL' }],
    ['workflow_enroll_stats', { locationId: LOC, workflowId: WF }, { workflowId: WF, locationId: 'LOC-EVIL' }],
    ['workflow_enroll_stats_cache', { locationId: LOC, workflowId: WF }, { 'workflowIds[]': [WF], locationId: 'LOC-EVIL' }],
    ['workflow_step_details', { locationId: LOC, workflowId: WF, stepId: STEP }, stepQuery({ locationId: 'LOC-EVIL' })],
    ['voice_ai_agent_discovery', { locationId: LOC }, { locationId: 'LOC-EVIL' }],
    ['conversation_ai_agent_discovery', { locationId: LOC }, { locationId: 'LOC-EVIL' }],
    ['agent_studio_agent_discovery', { locationId: LOC, companyId: COMPANY }, studioQuery({ locationId: 'LOC-EVIL' })],
  ];
  for (const [capabilityId, typedBindings, query] of cases) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({ capabilityId, typedBindings, query }),
      'LOCATION_BINDING_MISMATCH',
      { calls },
    );
  }
});

// ---------------------------------------------------------------------------
// I9: every capability traverses callCapability at least once
// ---------------------------------------------------------------------------

test('the minimal-request table covers every descriptor, in descriptor order', () => {
  assert.deepEqual(
    Object.keys(MINIMAL_REQUESTS),
    AUDIT_CAPABILITIES.map((capability) => capability.capabilityId),
  );
});

test('every capability emits exactly the host, path, and query its descriptor declares', async () => {
  const expected = {
    workflow_roster_list: [`${BACKEND}/workflow/${LOC}/list`, [
      'includeCustomObjects=true', 'includeObjectiveBuilder=true', 'limit=100', 'offset=0',
      'sortBy=name', 'sortOrder=asc', 'type=workflow',
    ]],
    workflow_detail: [`${BACKEND}/workflow/${LOC}/${WF}`, ['includeScheduledPauseInfo=true']],
    workflow_triggers: [`${BACKEND}/workflow/${LOC}/trigger`, [`workflowId=${WF}`]],
    workflow_sticky_notes: [`${BACKEND}/workflows/sticky-notes-all`, [`locationId=${LOC}`, `workflowId=${WF}`]],
    workflow_execution_logs: [`${BACKEND}/workflows/logs/v2`, [
      'action=first', 'dateType=custom', 'fromDate=0', 'limit=100', `locationId=${LOC}`,
      'toDate=10', `workflowId=${WF}`,
    ]],
    workflow_count_per_step: [`${BACKEND}/workflows/status/search/count-per-step`, [`locationId=${LOC}`, `workflowId=${WF}`]],
    workflow_enrollment_search: [`${BACKEND}/workflows/status/search/workflow-with-filter`, [
      'action=first', 'limit=20', `locationId=${LOC}`, `workflowId=${WF}`,
    ]],
    workflow_step_details: [`${BACKEND}/workflows/status/search/details-by-step`, [
      `currentStepId=${STEP}`, 'limit=50', `locationId=${LOC}`, 'showTotalCount=true', 'skip=0', `workflowId=${WF}`,
    ]],
    workflow_enroll_stats_cache: [`${BACKEND}/workflows/status/search/enroll-stats-cache`, [
      `locationId=${LOC}`, `workflowIds[]=${WF}`,
    ]],
    workflow_enroll_stats: [`${BACKEND}/workflows/status/enroll-stats`, [`locationId=${LOC}`, `workflowId=${WF}`]],
    voice_ai_agent_discovery: [`${SERVICES}/voice-ai/agents/simple`, [`locationId=${LOC}`]],
    voice_ai_agent_detail: [`${SERVICES}/voice-ai/agents/agent-1`, [`locationId=${LOC}`]],
    conversation_ai_agent_discovery: [`${SERVICES}/ai-employees/employees/search`, [`locationId=${LOC}`]],
    conversation_ai_agent_detail: [`${SERVICES}/ai-employees/employees/agent-1`, [`locationId=${LOC}`]],
    agent_studio_agent_discovery: [`${SERVICES}/agent-studio/agents/agents-with-folders`, [
      `agencyId=${COMPANY}`, 'groupBy=foldersFirst', `locationId=${LOC}`, 'page=1', 'pageSize=100',
      'productId=superagent', 'sortBy=lastUpdated', 'sortOrder=desc',
    ]],
    agent_studio_agent_detail: [`${SERVICES}/agent-studio/super-agent/agents/agent-1`, [`locationId=${LOC}`]],
  };

  for (const capability of AUDIT_CAPABILITIES) {
    const id = capability.capabilityId;
    const { audit, calls } = harness();
    const result = await audit.callCapability(MINIMAL_REQUESTS[id]);
    assert.equal(calls.length, 1, `${id}: expected exactly one fetch`);
    const [base, entries] = expected[id];
    const url = calls[0].url;
    assert.equal(url.split('?')[0], base, `${id}: wrong host or path`);
    assert.deepEqual(sortedEntries(url), entries, `${id}: wrong emitted query`);
    assert.equal(result.capabilityId, id, `${id}: receipt traced to the wrong capability`);
    assert.equal(result.host, capability.host, `${id}: wrong recorded host`);
    assert.equal(result.appliedPath, base.replace(capability.host === 'services' ? SERVICES : BACKEND, ''));
    assert.equal(result.ok, true, `${id}: expected a successful minimal read`);
  }
});

// ---------------------------------------------------------------------------
// I1: response-side identity validation
// ---------------------------------------------------------------------------

const logsRead = async (body, over = {}) => {
  const { audit, calls } = harness({ responses: { status: 200, body } });
  const result = await audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF, ...over },
    query: logsQuery(),
  });
  return { result, calls };
};

test('a record whose identity matches the request records native binding', async () => {
  const { result } = await logsRead(JSON.stringify({ locationId: LOC, workflowId: WF, events: [] }));
  assert.equal(result.identity.bindingMethod, 'native');
  assert.deepEqual(result.identity.checked, ['locationId', 'workflowId']);
  assert.deepEqual(result.identity.conflicts, []);
  assert.equal(result.quarantined, false);
  assert.equal(result.ok, true);
});

test('a record with no identity at all records request-scope binding and still succeeds', async () => {
  const { result } = await logsRead('{"events":[]}');
  assert.equal(result.identity.bindingMethod, 'request_scope');
  assert.deepEqual(result.identity.checked, []);
  assert.deepEqual(result.identity.conflicts, []);
  assert.equal(result.quarantined, false);
  assert.equal(result.ok, true);
});

test('a native identity conflict quarantines the collection and fails the read', async () => {
  for (const body of [
    JSON.stringify({ locationId: 'LOC-OTHER' }),
    JSON.stringify({ workflowId: 'wf-other' }),
  ]) {
    const { result } = await logsRead(body);
    assert.equal(result.quarantined, true, `expected quarantine for ${body}`);
    assert.equal(result.ok, false, 'a quarantined collection is never a successful read');
    assert.equal(result.status, 200);
    assert.equal(result.failureClass, 'IDENTITY_CONFLICT');
    assert.equal(result.identity.conflicts.length, 1);
  }
});

test('identity is walked in a top-level array as well as a top-level object', async () => {
  const clean = await logsRead(JSON.stringify([{ locationId: LOC }, { locationId: LOC }]));
  assert.equal(clean.result.identity.bindingMethod, 'native');
  assert.equal(clean.result.quarantined, false);

  const dirty = await logsRead(JSON.stringify([{ locationId: LOC }, { locationId: 'LOC-OTHER' }]));
  assert.equal(dirty.result.quarantined, true);
  assert.equal(dirty.result.ok, false);
  assert.deepEqual(dirty.result.identity.conflicts, [{ field: 'locationId', expected: LOC, actual: 'LOC-OTHER' }]);
});

test('identity is walked one envelope level under data, rows, statuses, and logs', async () => {
  for (const key of ['data', 'rows', 'statuses', 'logs']) {
    const clean = await logsRead(JSON.stringify({ [key]: [{ workflowId: WF, locationId: LOC }] }));
    assert.equal(clean.result.identity.bindingMethod, 'native', `${key}: expected native binding`);
    assert.equal(clean.result.quarantined, false);

    const dirty = await logsRead(JSON.stringify({ [key]: [{ workflowId: 'wf-other' }] }));
    assert.equal(dirty.result.quarantined, true, `${key}: a conflict inside the envelope must quarantine`);
    assert.equal(dirty.result.ok, false);

    // The envelope may also be a single object rather than an array.
    const single = await logsRead(JSON.stringify({ [key]: { locationId: 'LOC-OTHER' } }));
    assert.equal(single.result.quarantined, true, `${key}: object envelope must be walked too`);
  }
});

test('absence never downgrades or overrides a native conflict', async () => {
  const { result } = await logsRead(JSON.stringify({ data: [{ workflowId: 'wf-other' }, { note: 'no identity' }] }));
  assert.equal(result.identity.bindingMethod, 'mixed');
  assert.equal(result.quarantined, true, 'a record without identity must not neutralize the conflicting one');
  assert.equal(result.ok, false);
  assert.deepEqual(result.identity.conflicts, [{ field: 'workflowId', expected: WF, actual: 'wf-other' }]);
});

test('an empty envelope is request-scope, not native and not a conflict', async () => {
  const { result } = await logsRead('{"data":[]}');
  assert.equal(result.identity.bindingMethod, 'request_scope');
  assert.equal(result.quarantined, false);
  assert.equal(result.ok, true);
});

test('step, company, and agent identity are checked alongside location and workflow', async () => {
  const stepConflict = harness({ responses: { status: 200, body: JSON.stringify({ data: [{ currentStepId: 'step-other' }] }) } });
  const stepResult = await stepConflict.audit.callCapability({
    capabilityId: 'workflow_step_details',
    typedBindings: { locationId: LOC, workflowId: WF, stepId: STEP },
    query: stepQuery(),
  });
  assert.equal(stepResult.quarantined, true);
  assert.deepEqual(stepResult.identity.conflicts, [{ field: 'currentStepId', expected: STEP, actual: 'step-other' }]);

  const stepOk = harness({ responses: { status: 200, body: JSON.stringify({ data: [{ stepId: STEP }] }) } });
  const stepOkResult = await stepOk.audit.callCapability({
    capabilityId: 'workflow_step_details',
    typedBindings: { locationId: LOC, workflowId: WF, stepId: STEP },
    query: stepQuery(),
  });
  assert.deepEqual(stepOkResult.identity.checked, ['stepId']);
  assert.equal(stepOkResult.quarantined, false);

  const companyConflict = harness({ responses: { status: 200, body: JSON.stringify({ companyId: 'company-other' }) } });
  const companyResult = await companyConflict.audit.callCapability({
    capabilityId: 'agent_studio_agent_discovery',
    typedBindings: { locationId: LOC, companyId: COMPANY },
    query: studioQuery(),
  });
  assert.equal(companyResult.quarantined, true);
  assert.deepEqual(companyResult.identity.conflicts, [{ field: 'companyId', expected: COMPANY, actual: 'company-other' }]);

  const agentConflict = harness({ responses: { status: 200, body: JSON.stringify({ agentId: 'agent-other' }) } });
  const agentResult = await agentConflict.audit.callCapability({
    capabilityId: 'voice_ai_agent_detail',
    typedBindings: { locationId: LOC, agentId: 'agent-1', discoveredAgentIds: { voice_ai_agent_discovery: ['agent-1'] } },
    query: { locationId: LOC },
  });
  assert.equal(agentResult.quarantined, true);
  assert.deepEqual(agentResult.identity.conflicts, [{ field: 'agentId', expected: 'agent-1', actual: 'agent-other' }]);
});

// m8: an object-valued identity field used to be SKIPPED silently (`typeof actual ===
// 'object'` → continue), which downgraded the record to request_scope and let the response
// pass. `{locationId:{$oid:'OTHER'}}` is the real Mongo wire shape for an id, so this was
// not a hypothetical: another location's row read as a clean, request-scope-bound one.
test('m8: a wrapped identity id is READ and compared, not skipped', async () => {
  for (const wrapper of ['$oid', '_id', 'id']) {
    const conflict = await logsRead(JSON.stringify({ data: [{ locationId: { [wrapper]: 'OTHER' } }] }));
    assert.equal(conflict.result.quarantined, true, `{${wrapper}} wrapper must be unwrapped and compared`);
    assert.equal(conflict.result.ok, false);
    assert.equal(conflict.result.failureClass, 'IDENTITY_CONFLICT');
    assert.deepEqual(conflict.result.identity.conflicts, [{ field: 'locationId', expected: LOC, actual: 'OTHER' }]);

    // The matching case must read as NATIVE binding, not as an identity-free record: a
    // wrapper is the id, so the walk must not also census it as a nested leaf.
    const clean = await logsRead(JSON.stringify({ data: [{ locationId: { [wrapper]: LOC }, workflowId: WF }] }));
    assert.equal(clean.result.ok, true, `{${wrapper}} wrapper carrying the right id must pass`);
    assert.equal(clean.result.identity.bindingMethod, 'native');
    assert.deepEqual(clean.result.identity.checked, ['locationId', 'workflowId']);
  }
});

test('m8: an identity field whose shape cannot be read fails CLOSED rather than passing as request-scope', async () => {
  for (const value of [
    ['OTHER'],                    // an id is never a list
    { $oid: { deep: 'OTHER' } },  // a wrapper whose payload is itself an object
    { region: 'eu', name: 'x' },  // an object that is not an id wrapper at all
    {},                           // an empty object
  ]) {
    const { result } = await logsRead(JSON.stringify({ data: [{ locationId: value }] }));
    assert.equal(result.ok, false, `${JSON.stringify(value)}: an unreadable identity cannot prove binding`);
    assert.equal(result.failureClass, 'IDENTITY_UNREADABLE');
    assert.deepEqual(result.identity.unreadable, [{ field: 'locationId', expected: LOC }]);
    // It is recorded as UNREADABLE, never as a conflict: the walker did not read a wrong
    // value, it failed to read a value at all, and those demand different operator action.
    assert.equal(result.quarantined, false);
    assert.deepEqual(result.identity.conflicts, []);
    // And it must not count as identity either way, so it cannot manufacture a native
    // binding claim out of a field nobody could read.
    assert.ok(!result.identity.checked.includes('locationId'));
  }

  // An ABSENT identity is still absence, not unreadability: null/undefined stay clean.
  const absent = await logsRead(JSON.stringify({ data: [{ locationId: null }] }));
  assert.equal(absent.result.ok, true, 'a null id is absence, which is request-scope evidence');
  assert.deepEqual(absent.result.identity.unreadable, []);
  assert.equal(absent.result.identity.bindingMethod, 'request_scope');
});

// m9: a throwing getter on a response object escaped callCapability as an UNCODED Error —
// indistinguishable to a caller branching on `.code` from a bug in its own handler, and
// never recorded as a failed read.
test('m9: a body that throws while being inspected becomes a CODED failure, not a raw Error', async () => {
  const hostile = {
    data: [{
        get locationId() { throw new TypeError('nope'); },
    }],
  };
  // The throw has to come from the identity walk, so the body is injected after JSON
  // parsing — a real JSON.parse result cannot carry a getter.
  const calls = [];
  const gateway = realGateway({ calls, rail: 'jwt' });
  const inspected = {
    ...gateway,
    callWithMeta: async () => ({ status: 200, ok: true, json: hostile, retryAfterMs: null, capturedAt: FIXED_NOW }),
  };
  const audit = makeAuditGateway({
    gateways: { backend: inspected },
    locationId: LOC,
    limiter: passthroughLimiter(),
    circuit: makeAuditCircuit(),
  });

  await assert.rejects(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery(),
    }),
    (error) => {
      assert.equal(error.code, 'IDENTITY_INSPECTION_FAILED', 'the throw must carry a branchable code');
      assert.ok(error.remediation, 'a coded audit error names the next action');
      // The original is retained for debugging but must never be serialized into a tool
      // result or the MCP transcript.
      assert.ok(error.cause instanceof TypeError);
      assert.equal(Object.propertyIsEnumerable.call(error, 'cause'), false);
      assert.equal(containsSecrets({ detail: error.detail, remediation: error.remediation }), false);
      return true;
    },
  );
});

test('an identity field with nothing typed to check against is neither checked nor a conflict', async () => {
  // workflow_roster_list is typed with a location only, so a row's workflowId cannot be
  // proven wrong and must not be invented as a conflict.
  const { audit } = harness({ responses: { status: 200, body: JSON.stringify({ data: [{ workflowId: 'wf-anything', locationId: LOC }] }) } });
  const result = await audit.callCapability({
    capabilityId: 'workflow_roster_list',
    typedBindings: { locationId: LOC },
    query: rosterQuery(),
  });
  assert.deepEqual(result.identity.checked, ['locationId']);
  assert.deepEqual(result.identity.conflicts, []);
  assert.equal(result.quarantined, false);
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// I2: a 200 that is not a record set
// ---------------------------------------------------------------------------

test('a 200 carrying an HTML challenge page fails closed instead of reading as empty', async () => {
  const { result } = await logsRead('<!doctype html><html><body>Checking your browser…</body></html>');
  assert.equal(result.ok, false, 'a challenge page is not a successful read');
  assert.equal(result.status, 200);
  assert.equal(result.failureClass, 'INVALID_RESPONSE_BODY');
  assert.equal(typeof result.json, 'string', 'the raw body is preserved as evidence');
});

test('a 200 with an empty body fails closed', async () => {
  const { result } = await logsRead('');
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, 'INVALID_RESPONSE_BODY');
});

test('a 200 whose body is a bare JSON scalar fails closed', async () => {
  for (const body of ['null', '"ok"', '42', 'true']) {
    const { result } = await logsRead(body);
    assert.equal(result.ok, false, `body ${body} is not a record set`);
    assert.equal(result.failureClass, 'INVALID_RESPONSE_BODY');
  }
  // An empty ARRAY is a legitimate record set and must still succeed.
  const empty = await logsRead('[]');
  assert.equal(empty.result.ok, true);
  assert.equal(empty.result.failureClass, null);
});

// ---------------------------------------------------------------------------
// I4: a thrown transport
// ---------------------------------------------------------------------------

test('a thrown fetch becomes a coded TRANSPORT_FAILED and latches the circuit', async () => {
  const boom = new Error('socket hang up');
  boom.code = 'ECONNRESET';
  const gateway = makeGateway({
    tokenFile: fixture(),
    loc: LOC,
    fetchImpl: async () => { throw boom; },
    sleepImpl: async () => {},
    randomImpl: () => 0,
    nowImpl: () => FIXED_NOW,
  });
  const circuit = makeAuditCircuit();
  const audit = makeAuditGateway({ gateways: { backend: gateway }, locationId: LOC, limiter: passthroughLimiter(), circuit });

  await assert.rejects(
    audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery(),
    }),
    (error) => {
      assert.equal(error.code, 'TRANSPORT_FAILED');
      assert.equal(error.cause, boom, 'the original error must be preserved');
      assert.equal(
        Object.propertyIsEnumerable.call(error, 'cause'),
        false,
        'cause must be non-enumerable so it is never serialized into a tool result',
      );
      assert.deepEqual(Object.keys({ ...error }).filter((k) => k === 'cause'), []);
      return true;
    },
  );
  // Scoped to the rail whose host is unreachable (see the cross-rail test above), so the
  // process scope stays closed and the other rail keeps its budget.
  assert.equal(circuit.isOpen('backend'), true, 'a transport failure must latch its rail');
  assert.equal(circuit.state('backend').reason, 'TRANSPORT_FAILED');
  assert.equal(circuit.isOpen('process'), false);

  // Fail closed, never silent retry: the next read is refused outright.
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_enroll_stats',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: { workflowId: WF, locationId: LOC },
    }),
    'CIRCUIT_OPEN',
  );
});

test('a CIRCUIT_OPEN raised inside the limiter is not re-labelled as a transport failure', async () => {
  const circuit = makeAuditCircuit();
  circuit.open('process', 'RATE_LIMITED', { capabilityId: 'workflow_execution_logs', status: 429, retryAfterMs: 1000 });
  const { audit, calls } = harness({ circuit });
  await rejectsWithCode(
    () => audit.callCapability({
      capabilityId: 'workflow_execution_logs',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: logsQuery(),
    }),
    'CIRCUIT_OPEN',
    { calls },
  );
});

// ---------------------------------------------------------------------------
// I6: CIRCUIT_OPEN carries resume metadata
// ---------------------------------------------------------------------------

test('CIRCUIT_OPEN carries machine-readable resume metadata', async () => {
  const { audit } = harness({
    responses: { status: 429, body: '{}', headers: { 'retry-after': '7' } },
  });
  await audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });
  await assert.rejects(
    audit.callCapability({
      capabilityId: 'workflow_enroll_stats',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: { workflowId: WF, locationId: LOC },
    }),
    (error) => {
      assert.equal(error.code, 'CIRCUIT_OPEN');
      assert.equal(error.meta.open, true);
      assert.equal(error.meta.reason, 'RATE_LIMITED');
      assert.equal(error.meta.scope, 'process');
      assert.equal(error.meta.meta.capabilityId, 'workflow_execution_logs');
      assert.equal(error.meta.meta.status, 429);
      assert.equal(error.retryAfterMs, 7000, 'a resumer needs the delay without re-parsing prose');
      return true;
    },
  );
});

test('CIRCUIT_OPEN retryAfterMs is null when the upstream gave no delay', async () => {
  const circuit = makeAuditCircuit();
  circuit.open('backend', 'TRANSPORT_FAILED', { capabilityId: 'workflow_execution_logs', status: null, retryAfterMs: null });
  const { audit } = harness({ circuit });
  await assert.rejects(
    audit.callCapability({
      capabilityId: 'workflow_enroll_stats',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: { workflowId: WF, locationId: LOC },
    }),
    (error) => {
      assert.equal(error.retryAfterMs, null);
      assert.equal(error.meta.reason, 'TRANSPORT_FAILED');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// I7: the POST-limiter-grant circuit re-check
// ---------------------------------------------------------------------------

test('reads already queued when the circuit opens are refused after their limiter grant', async () => {
  // The pre-queue check cannot catch these: all four pass it in the same tick, before the
  // first fetch has even happened. Only the re-check after the grant stops reads 2-4.
  const { audit, calls, circuit } = harness({ responses: { status: 429, body: '{}', headers: { 'retry-after': '3' } } });
  const one = () => audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });

  const settled = await Promise.allSettled([one(), one(), one(), one()]);

  assert.equal(calls.length, 1, 'exactly one fetch may happen before the circuit latches');
  assert.equal(settled[0].status, 'fulfilled');
  assert.equal(settled[0].value.ok, false);
  assert.equal(settled[0].value.status, 429);
  for (const outcome of settled.slice(1)) {
    assert.equal(outcome.status, 'rejected', 'every queued read must be refused');
    assert.equal(outcome.reason.code, 'CIRCUIT_OPEN');
    assert.equal(outcome.reason.retryAfterMs, 3000);
  }
  assert.equal(circuit.isOpen(), true);
});

// ---------------------------------------------------------------------------
// I8: the location-throttle flag in every place it has been seen
// ---------------------------------------------------------------------------

test('a nested data.isLocationRateLimited fails closed and opens the circuit', async () => {
  const { audit, calls, circuit } = harness({
    responses: { status: 200, body: '{"data":{"isLocationRateLimited":true,"records":[]}}' },
  });
  const result = await audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });
  assert.equal(result.ok, false, 'a nested throttle flag is never a success');
  assert.equal(result.status, 200);
  assert.equal(result.failureClass, 'LOCATION_RATE_LIMITED');
  assert.equal(calls.length, 1);
  assert.equal(circuit.isOpen(), true);
  assert.equal(circuit.state().reason, 'LOCATION_RATE_LIMITED');
});

test('a top-level array carrying the throttle flag on a record also fails closed', async () => {
  const { audit, circuit } = harness({
    responses: { status: 200, body: '[{"id":"a"},{"isLocationRateLimited":true}]' },
  });
  const result = await audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, 'LOCATION_RATE_LIMITED');
  assert.equal(circuit.isOpen(), true);
});

// ---------------------------------------------------------------------------
// I11: applied echoes are scrubbed on the SUCCESS path too
// ---------------------------------------------------------------------------

test('appliedQuery and appliedPath are scrubbed on success, not only on rejection', async () => {
  const { audit } = harness({ responses: { status: 200, body: '{"workflows":[]}' } });
  const result = await audit.callCapability({
    capabilityId: 'workflow_roster_list',
    typedBindings: { locationId: LOC },
    // `search` is free text the caller controls; a pasted credential must not survive
    // into the receipt or the MCP transcript just because the request was legal.
    query: rosterQuery({ search: CREDENTIAL_LOOKING }),
  });
  assert.equal(result.ok, true);
  assert.ok(!String(result.appliedQuery.search).includes(CREDENTIAL_LOOKING), 'appliedQuery leaked the raw value');
  assert.equal(containsSecrets(result), false, `result looks credential-bearing: ${JSON.stringify(result)}`);
  // The scrub does not mangle ordinary values.
  assert.equal(result.appliedQuery.type, 'workflow');
  assert.equal(result.appliedPath, `/workflow/${LOC}/list`);
});

// ---------------------------------------------------------------------------
// I13: the per-gateway throttle is optional, and its defaults are unchanged
// ---------------------------------------------------------------------------

test('makeGateway throttle defaults are exactly the established 300/150 constants', async () => {
  const delays = [];
  const base = makeGateway({
    tokenFile: fixture(), loc: LOC, fetchImpl: stubFetch([]),
    sleepImpl: async (ms) => delays.push(ms), randomImpl: () => 0,
  });
  await base.call('GET', '/a');
  assert.deepEqual(delays, [300], 'base delay must still be 300ms');

  const jittered = [];
  const maxJitter = makeGateway({
    tokenFile: fixture(), loc: LOC, fetchImpl: stubFetch([]),
    sleepImpl: async (ms) => jittered.push(ms), randomImpl: () => 0.999999,
  });
  await maxJitter.call('GET', '/a');
  assert.deepEqual(jittered, [449], 'jitter ceiling must still be 150ms');
});

test('throttleMs:0 and jitterMs:0 perform no sleep at all', async () => {
  // The audit rail constructs its gateways this way because the shared makeAuditLimiter
  // already owns pacing; stacking both cost 600-900ms per read instead of 300-450ms.
  const delays = [];
  const calls = [];
  const gateway = makeGateway({
    tokenFile: fixture(),
    loc: LOC,
    fetchImpl: stubFetch(calls),
    sleepImpl: async (ms) => delays.push(ms),
    randomImpl: () => 0.999999,
    nowImpl: () => FIXED_NOW,
    throttleMs: 0,
    jitterMs: 0,
  });
  await gateway.call('GET', '/a');
  await gateway.callWithMeta('GET', '/b', undefined, { base: BACKEND });
  assert.deepEqual(delays, [], 'a disabled throttle must not even sleep for 0ms');
  assert.equal(calls.length, 2, 'the calls themselves still happen');

  // And it composes: an audit gateway built on an unthrottled gateway still pays the
  // shared limiter exactly once per read.
  const limiterSleeps = [];
  const limiter = makeAuditLimiter({
    minimumDelayMs: 300,
    jitterMs: 0,
    sleepImpl: async (ms) => { limiterSleeps.push(ms); },
    randomImpl: () => 0,
    nowImpl: () => FIXED_NOW,
  });
  const audit = makeAuditGateway({ gateways: { backend: gateway }, locationId: LOC, limiter, circuit: makeAuditCircuit() });
  await audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });
  await audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });
  assert.deepEqual(delays, [], 'the per-gateway throttle stays disabled under the audit rail');
  assert.deepEqual(limiterSleeps, [300], 'only the shared limiter paces the second read');
});

// ---------------------------------------------------------------------------
// I5 + I14: Retry-After parsing
// ---------------------------------------------------------------------------

const retryAfterOf = async (headers) => {
  const gw = realGateway({ calls: [], responses: { status: 429, body: '{}', headers } });
  return (await gw.callWithMeta('GET', '/workflows/logs/v2', undefined, { base: BACKEND })).retryAfterMs;
};

test('Retry-After accepts only delta-seconds or a strict HTTP-date shape', async () => {
  // `-5` and `1e3` are the dangerous ones: V8 reads each as a bare YEAR, lands in the
  // distant past, and the past-date clamp then emits 0 — the exact "retry immediately"
  // value this reader exists to never produce.
  assert.equal(await retryAfterOf({ 'retry-after': '-5' }), null);
  assert.equal(await retryAfterOf({ 'retry-after': '1e3' }), null);
  assert.equal(await retryAfterOf({ 'retry-after': '+30' }), null);
  assert.equal(await retryAfterOf({ 'retry-after': '120, 60' }), null);
  assert.equal(await retryAfterOf({ 'retry-after': 'soon' }), null);
  assert.equal(await retryAfterOf({ 'retry-after': '  ' }), null);
  assert.equal(await retryAfterOf({}), null);

  // Legal delta-seconds, including a leading-zero form.
  assert.equal(await retryAfterOf({ 'retry-after': '0' }), 0);
  assert.equal(await retryAfterOf({ 'retry-after': '010' }), 10_000);
  assert.equal(await retryAfterOf({ 'retry-after': '30' }), 30_000);

  // Clamped to 24h so a checkpoint consumer cannot be told to sleep for millennia.
  assert.equal(await retryAfterOf({ 'retry-after': '99999999999' }), 86_400_000);

  // HTTP-date, measured against the injected clock.
  const future = new Date(FIXED_NOW + 30_000).toUTCString();
  const futureMs = await retryAfterOf({ 'retry-after': future });
  assert.ok(futureMs > 0 && futureMs <= 30_000, `unexpected delay ${futureMs}`);
  assert.equal(await retryAfterOf({ 'retry-after': new Date(FIXED_NOW - 60_000).toUTCString() }), 0);
  // A far-future HTTP-date is clamped by the same ceiling.
  assert.equal(await retryAfterOf({ 'retry-after': new Date(FIXED_NOW + 10 * 86_400_000).toUTCString() }), 86_400_000);
});

// m6: the RFC 850 shape guard required 6-9 letters before the literal `day`, so it matched
// `Wednesday` and NOTHING ELSE. Six weekday names out of seven fell through to `null`
// (unknown delay) on a header Date.parse reads perfectly — a checkpoint that could have
// resumed at a known time was instead told it had no idea, six days a week.
test('m6: an RFC 850 Retry-After is accepted for ALL SEVEN weekday names, not just Wednesday', async () => {
  // 21-Oct-15 07:29:00 GMT, read against a clock parked 60s earlier, is a 60s delay.
  const at = Date.UTC(2015, 9, 21, 7, 29, 0);
  const capturedAt = at - 60_000;
  const gatewayAt = (header) => {
    const gw = makeGateway({
      tokenFile: fixture(), loc: LOC, sleepImpl: async () => {}, randomImpl: () => 0,
      nowImpl: () => capturedAt,
      fetchImpl: async () => ({ status: 429, ok: false, headers: { 'retry-after': header }, text: async () => '{}' }),
    });
    return gw.callWithMeta('GET', '/x', undefined, { base: BACKEND });
  };

  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
    const meta = await gatewayAt(`${day}, 21-Oct-15 07:29:00 GMT`);
    assert.equal(meta.retryAfterMs, 60_000, `${day}: a legal RFC 850 date must not read as an unknown delay`);
  }

  // The guard must still be a SHAPE guard, not a rubber stamp. What it gates is the DATE
  // shape — the weekday token is not load-bearing (Date.parse ignores it entirely, so
  // `Funday, 21-Oct-15 …` parses to the same instant and always did, under the old bound
  // too). Widening 6-9 to 3-6 therefore admits the six missing weekday NAMES without
  // admitting a single new date shape.
  for (const bogus of [
    'Wed, 21-Oct-15 07:29:00 GMT',               // no `day` suffix: this is IMF-fixdate's stem, not RFC 850's
    'Extraordinaryday, 21-Oct-15 07:29:00 GMT',  // stem far outside the weekday range
    'day, 21-Oct-15 07:29:00 GMT',               // no stem at all
    'Monday 21-Oct-15 07:29:00 GMT',             // missing comma
    'Monday, 21-Oct-2015 07:29:00 GMT',          // 4-digit year is not the RFC 850 form
    'Monday, 21 Oct 15 07:29:00 GMT',            // spaces instead of the RFC 850 hyphens
  ]) {
    const meta = await gatewayAt(bogus);
    assert.equal(meta.retryAfterMs, null, `${bogus} must not produce a delay`);
  }
});

test('Retry-After is read case-insensitively from a plain-object header bag and a real Headers', async () => {
  // A capture or stub written as `Retry-After` used to read as ABSENT, silently turning a
  // known delay into "unknown" at exactly the moment the delay matters.
  const plainLower = makeGateway({
    tokenFile: fixture(), loc: LOC, sleepImpl: async () => {}, randomImpl: () => 0, nowImpl: () => FIXED_NOW,
    fetchImpl: async () => ({ status: 429, ok: false, headers: { 'retry-after': '7' }, text: async () => '{}' }),
  });
  assert.equal((await plainLower.callWithMeta('GET', '/x', undefined, { base: BACKEND })).retryAfterMs, 7000);

  const plainCanonical = makeGateway({
    tokenFile: fixture(), loc: LOC, sleepImpl: async () => {}, randomImpl: () => 0, nowImpl: () => FIXED_NOW,
    fetchImpl: async () => ({ status: 429, ok: false, headers: { 'Retry-After': '7' }, text: async () => '{}' }),
  });
  assert.equal((await plainCanonical.callWithMeta('GET', '/x', undefined, { base: BACKEND })).retryAfterMs, 7000);

  const plainShouty = makeGateway({
    tokenFile: fixture(), loc: LOC, sleepImpl: async () => {}, randomImpl: () => 0, nowImpl: () => FIXED_NOW,
    fetchImpl: async () => ({ status: 429, ok: false, headers: { 'RETRY-AFTER': '7' }, text: async () => '{}' }),
  });
  assert.equal((await plainShouty.callWithMeta('GET', '/x', undefined, { base: BACKEND })).retryAfterMs, 7000);

  const real = makeGateway({
    tokenFile: fixture(), loc: LOC, sleepImpl: async () => {}, randomImpl: () => 0, nowImpl: () => FIXED_NOW,
    fetchImpl: async () => ({ status: 429, ok: false, headers: new Headers({ 'Retry-After': '7' }), text: async () => '{}' }),
  });
  assert.equal((await real.callWithMeta('GET', '/x', undefined, { base: BACKEND })).retryAfterMs, 7000);
});

// ---------------------------------------------------------------------------
// M2 + M8 + M12: path-segment safety
// ---------------------------------------------------------------------------

test('M2: a value that is still encoded after the decode budget fails CLOSED', () => {
  // Eight encoding layers against a five-pass budget. Flipping the loop's trailing
  // `return false` to `return true` would accept a value nobody has fully decoded.
  let deep = '%41';
  for (let layer = 0; layer < 8; layer += 1) deep = encodeURIComponent(deep);
  assert.ok(deep.includes('%'), 'fixture must still be encoded');
  assert.equal(isSafePathSegment(deep), false, 'budget exhaustion must fail closed');

  // Within budget, a benign multi-encoded value resolves and is accepted by this helper.
  assert.equal(isSafePathSegment(encodeURIComponent('%41')), true);
  assert.equal(isSafePathSegment('wf-1'), true);
});

test('M12: a scheme with no separator is caught by the scheme guard alone', () => {
  // Every previous vector also contained a `/`, so the separator check masked this guard
  // entirely and it could be deleted with all tests green. These carry no separator.
  for (const value of ['javascript:alert', 'mailto:x', 'x:y', 'data:abc']) {
    assert.equal(/[/\\?#]/.test(value), false, `${value} must not contain a separator`);
    assert.equal(value.includes('%'), false, `${value} must not contain a percent`);
    assert.equal(isSafePathSegment(value), false, `${value} must be refused by the scheme guard`);
  }
});

test('M8: any percent in a path binding is refused outright', async () => {
  // `wf%201` used to be double-encoded to `wf%25201` and addressed a DIFFERENT resource
  // than the one that was validated. GHL ids are ObjectId-shaped, so a percent is never
  // data — rejecting it subsumes the whole encoded-separator class.
  for (const workflowId of ['wf%201', 'wf%2D1', '%41', 'wf%']) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'workflow_detail',
        typedBindings: { locationId: LOC, workflowId },
        query: { includeScheduledPauseInfo: 'true' },
      }),
      'INVALID_PATH_BINDING',
      { calls },
    );
  }
  // A scheme-bearing id with no separator is refused through the same public path.
  const scheme = harness();
  await rejectsWithCode(
    () => scheme.audit.callCapability({
      capabilityId: 'workflow_detail',
      typedBindings: { locationId: LOC, workflowId: 'javascript:alert' },
      query: { includeScheduledPauseInfo: 'true' },
    }),
    'INVALID_PATH_BINDING',
    { calls: scheme.calls },
  );
});

// ---------------------------------------------------------------------------
// M5 + M6: numeric query values
// ---------------------------------------------------------------------------

test('M5/M6: numeric-bounded keys accept only unsigned integer literals', async () => {
  // The bounds were checked through Number(), but the RAW string reached the wire and the
  // receipt: ' 50 ', '0x10', '1e2', '1.5', '+5' and '50\n' are all finite, and
  // Number('') === 0 let an EMPTY offset pass a min:0 bound.
  const vectors = ['abc', ' 50 ', '0x10', '1e2', '1.5', '+5', '50\n', '', 'NaN', 'Infinity', '-0', '5e0'];
  for (const limit of vectors) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'workflow_roster_list',
        typedBindings: { locationId: LOC },
        query: rosterQuery({ limit }),
      }),
      'QUERY_BOUND_VIOLATION',
      { calls },
    );
  }
  for (const offset of ['', ' 0 ', '+0', '0.0', '1e1']) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'workflow_roster_list',
        typedBindings: { locationId: LOC },
        query: rosterQuery({ offset }),
      }),
      'QUERY_BOUND_VIOLATION',
      { calls },
    );
  }
  // The legal forms still pass.
  const { audit, calls } = harness();
  const result = await audit.callCapability({
    capabilityId: 'workflow_roster_list',
    typedBindings: { locationId: LOC },
    query: rosterQuery({ limit: '50', offset: '0' }),
  });
  assert.equal(result.ok, true);
  assert.ok(queryString(calls[0].url).includes('limit=50'));
});

// ---------------------------------------------------------------------------
// M7: workflowIds[] cardinality
// ---------------------------------------------------------------------------

// REWRITTEN (I4). This test used to assert BINDING_MISMATCH for every multi-value case,
// which pinned the descriptor's now-withdrawn `repeatableQueryKeys: ['workflowIds[]']`:
// only a key DECLARED repeatable survives the duplicate check long enough to reach the
// bound-key cardinality rule. With the declaration corrected to `[]` — plan line 313 pins
// this key to exactly one workflow, so batching is not authorized — the same requests are
// refused one rule earlier, as DUPLICATE_QUERY_KEY. The BEHAVIOUR under test is unchanged
// and is what matters: `workflowIds[]` can never address more than the typed workflow, and
// it still never reaches the wire. Only the code it is refused with moved.
test('M7: workflowIds[] must contain EXACTLY the typed workflow, once', async () => {
  const cases = [
    [WF, WF],                 // N identical repeats used to pass the equality-only check
    [WF, WF, WF],
    [WF, 'wf-other'],
    ['wf-other', WF],
  ];
  for (const workflowIds of cases) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'workflow_enroll_stats_cache',
        typedBindings: { locationId: LOC, workflowId: WF },
        query: { 'workflowIds[]': workflowIds, locationId: LOC },
      }),
      'DUPLICATE_QUERY_KEY',
      { calls },
    );
  }
  // A single WRONG value is still a binding fault at any cardinality.
  const wrongOne = harness();
  await rejectsWithCode(
    () => wrongOne.audit.callCapability({
      capabilityId: 'workflow_enroll_stats_cache',
      typedBindings: { locationId: LOC, workflowId: WF },
      query: { 'workflowIds[]': ['wf-other'], locationId: LOC },
    }),
    'BINDING_MISMATCH',
    { calls: wrongOne.calls },
  );

  // Exactly one matching value is still allowed, and reaches the wire.
  const { audit, calls } = harness();
  const result = await audit.callCapability({
    capabilityId: 'workflow_enroll_stats_cache',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { 'workflowIds[]': [WF], locationId: LOC },
  });
  assert.equal(result.ok, true);
  assert.equal(result.appliedQuery['workflowIds[]'], WF);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes(`workflowIds[]=${WF}`), 'the literal bracket key survives the cardinality change');
});

// I4: `repeatableQueryKeys` is now EMPTY on every shipped descriptor, so the branch that
// ALLOWS a repeat has no positive coverage against the real set — exactly the situation
// that let the mechanism rot into dead policy in the first place. The mechanism is kept
// (a future descriptor may need it, and its presence in every manifest row means a
// non-empty value cannot appear without a manifest diff), so it is proven here through
// the injectable descriptor list, the same way AMBIGUOUS_CAPABILITY is covered.
const REPEATABLE_PROBE = ({ repeatableQueryKeys = [], queryBindings = {} } = {}) => [{
  capabilityId: 'synthetic_repeatable',
  host: 'backend',
  authRail: 'backend',
  method: 'GET',
  normalizedPath: '/synthetic/{locationId}/things',
  pathBindings: { locationId: 'locationId' },
  queryBindings,
  requiredQueryKeys: ['tag'],
  optionalQueryKeys: [],
  repeatableQueryKeys,
  fixedQueryValues: {},
  allowedQueryValues: {},
  numericQueryBounds: {},
  locationBinding: 'path',
  sealedBy: null,
}];

const probeCall = (descriptors, query, typedBindings = { locationId: LOC }) => {
  const calls = [];
  const audit = makeAuditGateway({
    gateways: { backend: realGateway({ calls, rail: 'jwt' }) },
    locationId: LOC,
    limiter: passthroughLimiter(),
    circuit: makeAuditCircuit(),
    descriptors,
  });
  return {
    calls,
    run: () => audit.callCapability({ capabilityId: 'synthetic_repeatable', typedBindings, query }),
  };
};

test('I4: repeatableQueryKeys still ALLOWS a declared repeat, and refuses one it does not declare', async () => {
  // Declared repeatable and UNBOUND: both values are accepted, both reach the wire, and the
  // receipt records the array rather than silently dropping the second value.
  const allowed = probeCall(REPEATABLE_PROBE({ repeatableQueryKeys: ['tag'] }), { tag: ['a', 'b'] });
  const result = await allowed.run();
  assert.equal(result.ok, true);
  assert.deepEqual(result.appliedQuery.tag, ['a', 'b']);
  assert.deepEqual(sortedEntries(allowed.calls[0].url), ['tag=a', 'tag=b']);

  // The SAME request against the SAME descriptor with the declaration removed is refused,
  // so it is the declaration doing the work and not the shape of the query.
  const refused = probeCall(REPEATABLE_PROBE({}), { tag: ['a', 'b'] });
  await rejectsWithCode(refused.run, 'DUPLICATE_QUERY_KEY', { calls: refused.calls });
});

// The bound-key CARDINALITY rule ("a bound key carries exactly one value") became
// unreachable against the shipped descriptors the moment `repeatableQueryKeys` went empty
// everywhere: a duplicate is now refused one rule earlier, as DUPLICATE_QUERY_KEY. That is
// the same dead-policy trap I4 was about, so the rule is covered through the same
// injectable path rather than left to rot — it is precisely the guard that stops a future
// descriptor from being declared repeatable AND bound, which is the combination that made
// `workflowIds[]` unusable in the first place.
test('I4: a key that is BOTH repeatable and bound is still refused by the cardinality rule', async () => {
  const descriptors = REPEATABLE_PROBE({ repeatableQueryKeys: ['tag'], queryBindings: { tag: 'workflowId' } });
  const typed = { locationId: LOC, workflowId: WF };

  // The duplicate check passes (the key IS declared repeatable), so the cardinality rule
  // is what refuses it — including the N-identical-repeats case an equality-only check
  // would wave through.
  for (const tag of [[WF, WF], [WF, 'wf-other']]) {
    const attempt = probeCall(descriptors, { tag }, typed);
    await rejectsWithCode(attempt.run, 'BINDING_MISMATCH', { calls: attempt.calls });
  }

  // Exactly one matching value still passes, so the rule is about cardinality and not
  // about the presence of a binding.
  const single = probeCall(descriptors, { tag: [WF] }, typed);
  const result = await single.run();
  assert.equal(result.ok, true);
  assert.equal(single.calls.length, 1);
});

// ---------------------------------------------------------------------------
// M11: the optional step seal
// ---------------------------------------------------------------------------

test('M11: discoveredStepIds is optional, but is honoured when supplied', async () => {
  // Absent is still allowed — the plan does not require a step seal.
  const absent = harness();
  const allowed = await absent.audit.callCapability({
    capabilityId: 'workflow_step_details',
    typedBindings: { locationId: LOC, workflowId: WF, stepId: STEP },
    query: stepQuery(),
  });
  assert.equal(allowed.ok, true);
  assert.equal(absent.calls.length, 1);

  // Supplied and containing the step: allowed.
  const sealed = harness();
  const sealedOk = await sealed.audit.callCapability({
    capabilityId: 'workflow_step_details',
    typedBindings: { locationId: LOC, workflowId: WF, stepId: STEP, discoveredStepIds: ['step-0', STEP] },
    query: stepQuery(),
  });
  assert.equal(sealedOk.ok, true);

  // Supplied and NOT containing the step, or supplied as a non-array: refused.
  for (const discoveredStepIds of [['step-0'], [], 'step-1', {}]) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'workflow_step_details',
        typedBindings: { locationId: LOC, workflowId: WF, stepId: STEP, discoveredStepIds },
        query: stepQuery(),
      }),
      'BINDING_MISMATCH',
      { calls },
    );
  }
});

// ---------------------------------------------------------------------------
// R1: the identity walker is GENERIC, not a hand-maintained envelope allowlist
// ---------------------------------------------------------------------------

// The old allowlist was ['data','rows','statuses','logs'], which omitted `counts`,
// `agents`, and `triggers` — all three read by this codebase from these exact routes
// (core/tools.mjs reads `counts.json?.counts` and `recordsFrom(json,'triggers','data')`;
// the orchestrate engine reads `agS?.agents`). On those responses the location guard was
// a NO-OP.

test('R1: a wrong-location agents roster is quarantined instead of being sealed as discovery', async () => {
  // The worst case of the allowlist gap: these ids get sealed into discoveredAgentIds and
  // then AUTHORIZE detail reads — for another location's agents.
  const { audit } = harness({
    responses: { status: 200, body: JSON.stringify({ agents: [{ id: 'a1', locationId: 'SOME-OTHER-LOC' }] }) },
  });
  const result = await audit.callCapability({
    capabilityId: 'voice_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  });
  assert.equal(result.quarantined, true, 'another location\'s roster must never read as this location\'s');
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, 'IDENTITY_CONFLICT');
  assert.deepEqual(result.identity.conflicts, [{ field: 'locationId', expected: LOC, actual: 'SOME-OTHER-LOC' }]);
});

test('R1: counts and triggers envelopes are walked like any other', async () => {
  const countsDirty = harness({ responses: { status: 200, body: JSON.stringify({ counts: [{ workflowId: 'wf-other' }] }) } });
  const countsResult = await countsDirty.audit.callCapability({
    capabilityId: 'workflow_count_per_step',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });
  assert.equal(countsResult.quarantined, true, '{counts:[…]} must be walked');
  assert.equal(countsResult.failureClass, 'IDENTITY_CONFLICT');

  const countsClean = harness({ responses: { status: 200, body: JSON.stringify({ counts: [{ workflowId: WF, locationId: LOC }] }) } });
  const cleanResult = await countsClean.audit.callCapability({
    capabilityId: 'workflow_count_per_step',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });
  assert.equal(cleanResult.ok, true);
  assert.equal(cleanResult.identity.bindingMethod, 'native');

  const triggers = harness({ responses: { status: 200, body: JSON.stringify({ triggers: [{ workflowId: 'wf-other' }] }) } });
  const triggerResult = await triggers.audit.callCapability({
    capabilityId: 'workflow_triggers',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF },
  });
  assert.equal(triggerResult.quarantined, true, '{triggers:[…]} must be walked');
});

test('R1: nested {data:{data:[…]}} and arrays-of-arrays are walked', async () => {
  const nested = await logsRead(JSON.stringify({ data: { data: [{ locationId: 'LOC-OTHER' }] } }));
  assert.equal(nested.result.quarantined, true, 'a nested envelope must not hide a conflict');
  assert.equal(nested.result.failureClass, 'IDENTITY_CONFLICT');

  const nestedClean = await logsRead(JSON.stringify({ data: { data: [{ locationId: LOC, workflowId: WF }] } }));
  assert.equal(nestedClean.result.ok, true);
  assert.equal(nestedClean.result.identity.bindingMethod, 'native');

  const jagged = await logsRead(JSON.stringify([[{ locationId: 'LOC-OTHER' }]]));
  assert.equal(jagged.result.quarantined, true, 'an array of arrays must not hide a conflict');

  const jaggedEnvelope = await logsRead(JSON.stringify({ rows: [[{ workflowId: 'wf-other' }]] }));
  assert.equal(jaggedEnvelope.result.quarantined, true);
});

// REWRITTEN (m7). This test used to assert `ok:true, quarantined:false` for a payload
// nested past the bound — i.e. it PINNED the depth bound as silent. That made a response
// the walker never looked at indistinguishable from one it looked at and found clean,
// which is the one distinction this whole rail exists to preserve. The bound itself is
// unchanged; what changed is that reaching it is now recorded and fails closed.
test('R1/m7: the walk is depth-bounded, and reaching the bound fails closed instead of passing silently', async () => {
  // REWRITTEN AGAIN 2026-07-27, when the bound moved 3 -> 32 after the first live canary run.
  // The previous version hardcoded four-deep literals to trip a bound of three, so it broke
  // the moment the bound became realistic — and worse, it had baked the OLD justification
  // into a comment ("anything deeper is not payload this API emits"), which live traffic
  // disproved: a real 43-step workflow body nests to 15, with genuine identity fields at
  // depth 11 the old bound never looked at.
  //
  // So the payloads are now built RELATIVE to the bound rather than written out. The claim
  // under test has nothing to do with any particular number: whatever the bound is, reaching
  // it must be recorded and must fail closed, and stopping short of it must not.
  const nest = (levels, leaf) => {
    let node = leaf;
    for (let i = 0; i < levels; i += 1) node = { nested: node };
    return node;
  };

  // Comfortably INSIDE the bound: the conflict is found, and nothing is left unlooked-at.
  // This is also the case the raise strengthened — at a bound of 3 this payload was capped
  // and the wrong location was never noticed at all.
  const inside = await logsRead(JSON.stringify(nest(6, [{ locationId: 'LOC-OTHER' }])));
  assert.equal(inside.result.quarantined, true, 'a conflict inside the bound must still quarantine');
  assert.equal(inside.result.identity.depthCapped, false, 'nothing was left unlooked-at');

  // BEYOND any sane bound. Fails closed: recorded, not ok, and explicitly NOT a conflict —
  // the walker never read the field, so it has proven nothing about it. "I could not check"
  // and "I checked and it is wrong" stay distinct, which is the whole point of the flag.
  const beyond = await logsRead(JSON.stringify(nest(64, { locationId: 'OTHER' })));
  assert.equal(beyond.result.identity.depthCapped, true, 'the walk must SAY it stopped early');
  assert.equal(beyond.result.ok, false, 'an incomplete check is not a successful read');
  assert.equal(beyond.result.failureClass, 'IDENTITY_DEPTH_CAPPED');
  assert.equal(beyond.result.quarantined, false);
  assert.deepEqual(beyond.result.identity.conflicts, []);

  // A response that simply ENDS inside the bound is not capped: the flag tracks payload
  // actually left unvisited, never merely reaching a depth.
  const exact = await logsRead(JSON.stringify(nest(4, { locationId: LOC })));
  assert.equal(exact.result.identity.depthCapped, false);
  assert.equal(exact.result.ok, true);
});

test('the identity bound is deep enough for a real GHL workflow body', async () => {
  // The regression this pins is the one that cost the first canary run: the bound must clear
  // the nesting of an actual payload, not just the nesting of an envelope. Measured on GROM
  // AU 2026-07-27 across 20 workflow bodies — deepest was 15, identity fields at depth 11.
  // 16 here is that observed reality; if someone lowers the bound back toward envelope depth,
  // this fails with the reason attached rather than surfacing as a mystery incomplete audit.
  const deepButReal = await logsRead(JSON.stringify(nestForTest(15, { locationId: LOC })));
  assert.equal(deepButReal.result.identity.depthCapped, false,
    'a body nested as deeply as a real 43-step workflow must be fully inspected');
  assert.equal(deepButReal.result.ok, true);

  // And the identity at that depth is genuinely CHECKED, not merely walked past.
  const deepConflict = await logsRead(JSON.stringify(nestForTest(15, { locationId: 'LOC-OTHER' })));
  assert.equal(deepConflict.result.quarantined, true,
    'an identity at real-payload depth must still be compared, or the walk is theatre');
});

function nestForTest(levels, leaf) {
  let node = leaf;
  for (let i = 0; i < levels; i += 1) node = { nested: node };
  return node;
}

// REWRITTEN (C1). This test used to assert only that `inspectionCapped` was RECORDED, and
// the previous pass deliberately let a capped inspection still return `ok:true`. That was
// wrong for two compounding reasons, both measured:
//   1. The counter incremented for every visited OBJECT, not every record, so the real
//      headroom was ~4 nested objects per row. A 100-row page (the descriptors' OWN
//      maximum) with 5 nested objects per row hit the cap at row 83 and silently stopped
//      checking — with the receipt still claiming the location was verified.
//   2. Because the cap was reachable inside a legal page, "capped" was a routine outcome,
//      not a pathological one, so passing it as ok:true was a silent completeness lie.
// The unit is now RECORDS, and reaching the cap fails closed.
test('C1: the record budget counts RECORDS, not every visited object', async () => {
  // 100 rows — the descriptors' maximum legal page — each carrying `nested` identity-free
  // sub-objects. Under the old object-counter these cost 1 + 100*(1+nested) budget; under
  // the record-counter they cost 100, because a nested wrapper is structure, not a record.
  const page = (nested) => JSON.stringify({
    data: Array.from({ length: 100 }, (_, index) => {
      const row = { id: `r${index}` };
      for (let n = 0; n < nested; n += 1) row[`n${n}`] = { note: `n${n}` };
      // The conflict is on the LAST row, so it is only found if every row is inspected.
      if (index === 99) row.locationId = 'OTHER-LOC';
      return row;
    }),
  });

  for (const nested of [3, 4, 5]) {
    const { result } = await logsRead(page(nested));
    assert.equal(result.identity.inspectionCapped, false,
      `${nested} nested objects per row: a legal 100-row page must never exhaust the record budget`);
    assert.equal(result.quarantined, true,
      `${nested} nested objects per row: the last row's conflict must still be found`);
    assert.equal(result.ok, false);
    assert.equal(result.failureClass, 'IDENTITY_CONFLICT');
  }
});

test('C1: an exhausted record budget fails CLOSED, because a capped check is an unfinished one', async () => {
  const rows = (count, conflictAt) => JSON.stringify({
    data: Array.from({ length: count }, (_, index) => (
      index === conflictAt ? { locationId: 'OTHER-LOC' } : { id: `r${index}` }
    )),
  });

  const under = await logsRead(rows(400, null));
  assert.equal(under.result.identity.inspectionCapped, false, 'an honest page is never truncated');
  assert.equal(under.result.ok, true);

  // 600 rows with the conflict at #599: the walker provably cannot reach it, so it must
  // not report a clean read. Under the old rule this returned ok:true — the exact silent
  // pass the cap was supposed to prevent.
  const over = await logsRead(rows(600, 598));
  assert.equal(over.result.identity.inspectionCapped, true,
    'a payload larger than any legal page must say so rather than claim a complete check');
  assert.equal(over.result.ok, false, 'a capped inspection is a provably incomplete check');
  assert.equal(over.result.failureClass, 'IDENTITY_INSPECTION_CAPPED');
  assert.equal(over.result.status, 200, 'the evidence is preserved even though the read failed');
});

// ---------------------------------------------------------------------------
// R2: identity validation is scoped to the entities the CAPABILITY addresses
// ---------------------------------------------------------------------------

// Checking every typed binding in the bag produced FALSE quarantines that destroyed real
// evidence. A log row naming the step that emitted it, or the bot that authored it, is a
// perfectly legitimate page — the request never addressed a step or an agent.

test('R2: a log page naming its own step and author is NOT a conflict', async () => {
  const { result } = await logsRead(
    JSON.stringify({ logs: [{ workflowId: WF, stepId: 'step-A' }, { workflowId: WF, stepId: 'step-B' }] }),
    // stepId/agentId/companyId left in the bag by an earlier call on the same composite.
    { stepId: STEP, agentId: 'agent-1', companyId: COMPANY },
  );
  assert.equal(result.ok, true, 'a legitimate log page must survive');
  assert.equal(result.quarantined, false);
  assert.deepEqual(result.identity.conflicts, []);
  assert.deepEqual(result.identity.checked, ['workflowId'], 'only the addressed entities are checkable');
});

test('R2: an unaddressed agentId or companyId in a log row is ignored', async () => {
  for (const body of [
    JSON.stringify({ logs: [{ workflowId: WF, agentId: 'bot-9' }] }),
    JSON.stringify({ logs: [{ workflowId: WF, companyId: 'company-other' }] }),
  ]) {
    const { result } = await logsRead(body, { agentId: 'agent-1', companyId: COMPANY, stepId: STEP });
    assert.equal(result.ok, true, `expected no conflict for ${body}`);
    assert.equal(result.quarantined, false);
  }
});

test('R2: the entities a capability DOES address still quarantine', async () => {
  // The scoping must not become a blanket amnesty: /workflows/logs/v2 addresses the
  // location and the workflow, and both are still enforced.
  const wrongLocation = await logsRead(JSON.stringify({ logs: [{ locationId: 'LOC-OTHER' }] }), { stepId: STEP, agentId: 'agent-1' });
  assert.equal(wrongLocation.result.quarantined, true);
  const wrongWorkflow = await logsRead(JSON.stringify({ logs: [{ workflowId: 'wf-other' }] }), { stepId: STEP, agentId: 'agent-1' });
  assert.equal(wrongWorkflow.result.quarantined, true);

  // And a capability that DOES address a step is still checked on it (both spellings).
  const stepRoute = harness({ responses: { status: 200, body: JSON.stringify({ data: [{ stepId: 'step-other' }] }) } });
  const stepResult = await stepRoute.audit.callCapability({
    capabilityId: 'workflow_step_details',
    typedBindings: { locationId: LOC, workflowId: WF, stepId: STEP },
    query: stepQuery(),
  });
  assert.equal(stepResult.quarantined, true, 'details-by-step addresses a step, so stepId is checkable there');
});

// ---------------------------------------------------------------------------
// M1: a required query key needs a VALUE, not merely a presence
// ---------------------------------------------------------------------------

test('M1: an empty required value is refused before fetch', async () => {
  // `params.has('fromDate')` is true for `fromDate=`, so the request went to the wire as
  // `&fromDate=&toDate=` — an UNBOUNDED window — while the receipt would have claimed a
  // bounded one.
  for (const over of [{ fromDate: '' }, { toDate: '' }, { fromDate: '   ' }, { workflowId: '' }]) {
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'workflow_execution_logs',
        typedBindings: { locationId: LOC, workflowId: WF },
        query: logsQuery(over),
      }),
      'MISSING_QUERY_KEY',
      { calls },
    );
  }
  // An OPTIONAL key may still be empty: it narrows nothing and claims nothing. Exercised on
  // `contactId` rather than `eventType`, because `eventType` is ALLOW-LISTED now (the closed
  // IWorkflowLogStatus enum) and an empty string is not in that set, so it earns the more
  // specific DISALLOWED_QUERY_VALUE instead — which is the correct, stricter answer.
  const { audit, calls } = harness();
  const result = await audit.callCapability({
    capabilityId: 'workflow_execution_logs',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: logsQuery({ contactId: '' }),
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// M2: the discovery seal is read as an OWN property
// ---------------------------------------------------------------------------

test('M2: a prototype-borne seal cannot authorize a detail read', async () => {
  const forged = [
    { __proto__: { voice_ai_agent_discovery: ['agent-1'] } },
    Object.create({ voice_ai_agent_discovery: ['agent-1'] }),
  ];
  for (const discoveredAgentIds of forged) {
    assert.deepEqual(Object.keys(discoveredAgentIds), [], 'fixture must have no own keys');
    const { audit, calls } = harness();
    await rejectsWithCode(
      () => audit.callCapability({
        capabilityId: 'voice_ai_agent_detail',
        typedBindings: { locationId: LOC, agentId: 'agent-1', discoveredAgentIds },
        query: { locationId: LOC },
      }),
      'BINDING_MISMATCH',
      { calls },
    );
  }
});

// ---------------------------------------------------------------------------
// M4: a rail that keeps answering with unusable bodies latches
// ---------------------------------------------------------------------------

test('M4: three consecutive unusable bodies latch the rail, and the other rail survives', async () => {
  const challenge = { status: 200, body: '<!doctype html><html><body>Checking your browser…</body></html>' };
  const { audit, calls, circuit } = harness({ responses: challenge });
  const read = () => audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });

  const first = await read();
  assert.equal(first.failureClass, 'INVALID_RESPONSE_BODY');
  assert.equal(circuit.isOpen('backend'), false, 'one interstitial can be a blip');
  await read();
  assert.equal(circuit.isOpen('backend'), false, 'two is still not a pattern');
  await read();
  assert.equal(circuit.isOpen('backend'), true, 'three in a row is a front door, not a blip');
  assert.equal(circuit.state('backend').reason, 'INVALID_RESPONSE_BODY');
  assert.equal(circuit.state('backend').meta.consecutive, 3);
  assert.equal(circuit.isOpen('process'), false, 'the challenge belongs to one host');

  await rejectsWithCode(read, 'CIRCUIT_OPEN');
  assert.equal(calls.length, 3, 'the page budget stops being spent on challenge pages');

  const ai = await audit.callCapability({
    capabilityId: 'voice_ai_agent_discovery',
    typedBindings: { locationId: LOC },
    query: { locationId: LOC },
  });
  assert.equal(ai.status, 200, 'the other rail has its own front door');
});

// I2: the consecutive-unusable-body counter lives on the CIRCUIT, keyed by scope, not on
// each gateway. It used to be per-gateway state feeding a per-process circuit, so the real
// threshold was 3 x (number of gateways) and each gateway reset the others' evidence away.
test('I2: the unusable-body run is counted per RAIL across every gateway sharing the circuit', async () => {
  const challenge = { status: 200, body: '<html>nope</html>' };
  const circuit = makeAuditCircuit();
  const limiter = passthroughLimiter();
  // Two audit gateways, same shared circuit and limiter — exactly the Task 5 shape, where
  // one process fans out across surfaces.
  const first = harness({ responses: challenge, circuit, limiter });
  const second = harness({ responses: challenge, circuit, limiter });

  const read = (which) => which.audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });

  await read(first);
  assert.equal(circuit.unusableBodyRun('backend'), 1);
  await read(second);
  assert.equal(circuit.unusableBodyRun('backend'), 2, 'the second gateway continues the SAME run');
  assert.equal(circuit.isOpen('backend'), false, 'two is still not a pattern');

  // The THIRD unusable body across BOTH gateways latches. Measured before this fix: two
  // gateways took 5, because each kept its own count of 3.
  await read(first);
  assert.equal(circuit.isOpen('backend'), true, 'three in a row on one rail is a front door, whoever saw them');
  assert.equal(circuit.state('backend').reason, 'INVALID_RESPONSE_BODY');
  assert.equal(circuit.state('backend').meta.consecutive, 3);

  // And the latch is shared, so the OTHER gateway is stopped too rather than spending its
  // own budget discovering the same wall.
  await rejectsWithCode(() => read(second), 'CIRCUIT_OPEN');
  assert.equal(first.calls.length + second.calls.length, 3, 'exactly three reads were spent');
});

// I3: a 403/404/500 with a JSON error body is `bodyUsable`, so it used to RESET the run.
// An alternating front door therefore never latched at all: `bad, bad, 403, bad, bad, 403,
// …` walked the entire page budget against a wall with every read recorded in isolation.
test('I3: only a genuinely successful read breaks the unusable-body run, not any parseable body', async () => {
  const challenge = { status: 200, body: '<html>nope</html>' };
  const jsonRefusal = { status: 403, ok: false, body: '{"message":"Forbidden"}' };
  // The exact measured sequence. It must latch, and it must latch before the sequence ends.
  const { audit, calls, circuit } = harness({
    responses: [challenge, challenge, jsonRefusal, challenge, challenge, jsonRefusal, challenge, challenge],
  });
  const read = () => audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });

  await read();
  await read();
  assert.equal(circuit.unusableBodyRun('backend'), 2);

  // The JSON-bodied 403 is parseable, but it is not evidence the front door opened — it is
  // the front door saying no in a different format. It must neither reset nor increment.
  const refusal = await read();
  assert.equal(refusal.ok, false);
  assert.equal(refusal.failureClass, 'AUTH_REJECTED');
  assert.equal(circuit.unusableBodyRun('backend'), 2, 'a parseable REFUSAL is not a successful read');
  assert.equal(circuit.isOpen('backend'), false, 'and it is not a latch on its own either');

  await read();
  assert.equal(circuit.isOpen('backend'), true, 'the third unusable body latches through the refusal');
  await rejectsWithCode(read, 'CIRCUIT_OPEN');
  assert.equal(calls.length, 4, 'the budget stops being spent on an alternating front door');
});

test('M4: any usable response resets the consecutive count', async () => {
  const challenge = { status: 200, body: '<html>nope</html>' };
  const usable = { status: 200, body: '{"records":[]}' };
  const { audit, calls, circuit } = harness({ responses: [challenge, challenge, usable, challenge, challenge, challenge] });
  const read = () => audit.callCapability({
    capabilityId: 'workflow_enroll_stats',
    typedBindings: { locationId: LOC, workflowId: WF },
    query: { workflowId: WF, locationId: LOC },
  });

  await read();
  await read();
  const recovered = await read();
  assert.equal(recovered.ok, true, 'the third response is a real record set');
  assert.equal(circuit.isOpen('backend'), false);

  await read();
  await read();
  assert.equal(circuit.isOpen('backend'), false, 'the run restarted after the good response');
  await read();
  assert.equal(circuit.isOpen('backend'), true, 'and a fresh run of three still latches');
  assert.equal(calls.length, 6);
});

// ---------------------------------------------------------------------------
// M5: two behaviours that survived deletion
// ---------------------------------------------------------------------------

test('M5: an ENVELOPE-level location conflict quarantines even when the rows are clean', async () => {
  // The wrapper carries the identity and the rows carry none. Skipping the wrapper scan
  // made this exact response read as a successful, request-scope-bound empty window.
  const { result } = await logsRead(JSON.stringify({ locationId: 'OTHER-LOC', data: [{ note: 'no identity' }] }));
  assert.equal(result.quarantined, true, 'the envelope is evidence too');
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, 'IDENTITY_CONFLICT');
  assert.deepEqual(result.identity.conflicts, [{ field: 'locationId', expected: LOC, actual: 'OTHER-LOC' }]);
});

test('M5: appliedPath is scrubbed, not only appliedQuery', async () => {
  // A JWT-shaped id is a legal path segment: it has no `/`, `%`, or `:`, so it passes
  // isSafePathSegment and lands in the receipt and the MCP transcript verbatim.
  const { audit } = harness({ responses: { status: 200, body: '{"records":[]}' } });
  const result = await audit.callCapability({
    capabilityId: 'workflow_detail',
    typedBindings: { locationId: LOC, workflowId: CREDENTIAL_LOOKING },
    query: { includeScheduledPauseInfo: 'true' },
  });
  assert.ok(!String(result.appliedPath).includes(CREDENTIAL_LOOKING), 'appliedPath leaked the raw value');
  assert.equal(containsSecrets(result), false, `result looks credential-bearing: ${JSON.stringify(result)}`);
});

// ---------------------------------------------------------------------------
// R4: asctime Retry-After is GMT, in every deployment timezone
// ---------------------------------------------------------------------------

// RFC 9110 §5.6.7 defines asctime as GMT, but it is the one HTTP-date shape carrying no
// zone token, so Date.parse read it as LOCAL time. `Wed Oct 21 07:29:00 2015` captured at
// 07:28:00 GMT (a legal 60s delay) produced 0 under TZ=Asia/Makassar — the exact "retry
// immediately" value this reader exists to never produce — and 14460000 under
// TZ=America/New_York. The suite is run under several TZ values to keep this honest.
const ASCTIME_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ASCTIME_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const asctime = (ms) => {
  const at = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${ASCTIME_DAYS[at.getUTCDay()]} ${ASCTIME_MONTHS[at.getUTCMonth()]} `
    + `${String(at.getUTCDate()).padStart(2, ' ')} `
    + `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} ${at.getUTCFullYear()}`;
};

test('R4: an asctime Retry-After is parsed as GMT, independent of the process timezone', async () => {
  // Exact, not a range: the delay is a whole number of seconds measured from an injected
  // UTC clock, so any local-time reading shifts it by the process offset and fails here.
  assert.equal(await retryAfterOf({ 'retry-after': asctime(FIXED_NOW + 60_000) }), 60_000);
  assert.equal(await retryAfterOf({ 'retry-after': asctime(FIXED_NOW + 3_600_000) }), 3_600_000);
  assert.equal(await retryAfterOf({ 'retry-after': asctime(FIXED_NOW) }), 0);
  assert.equal(await retryAfterOf({ 'retry-after': asctime(FIXED_NOW - 60_000) }), 0, 'a past date still clamps to zero');
  assert.equal(await retryAfterOf({ 'retry-after': asctime(FIXED_NOW + 10 * 86_400_000) }), 86_400_000, 'and the 24h ceiling still applies');
});

test('R4: all three legal HTTP-date shapes agree on the same instant', async () => {
  const target = FIXED_NOW + 120_000;
  // IMF-fixdate (what toUTCString emits) and asctime name the SAME moment, so they must
  // produce the same delay. Before the fix these differed by the process UTC offset.
  assert.equal(await retryAfterOf({ 'retry-after': new Date(target).toUTCString() }), 120_000);
  assert.equal(await retryAfterOf({ 'retry-after': asctime(target) }), 120_000);
  assert.equal(await retryAfterOf({ 'retry-after': '120' }), 120_000);
});

test('R4: a space-padded asctime day is legal; a rolled-over or bogus one is null', async () => {
  // ' 5' is the RFC's single-digit day form.
  const fifth = Date.UTC(2027, 0, 5, 12, 0, 0);
  const gw = makeGateway({
    tokenFile: fixture(), loc: LOC, sleepImpl: async () => {}, randomImpl: () => 0, nowImpl: () => fifth,
    fetchImpl: async () => ({ status: 429, ok: false, headers: { 'retry-after': 'Tue Jan  5 12:00:30 2027' }, text: async () => '{}' }),
  });
  assert.equal((await gw.callWithMeta('GET', '/x', undefined, { base: BACKEND })).retryAfterMs, 30_000);

  // Date.UTC silently rolls over out-of-range fields; a rolled-over date is not a delay.
  assert.equal(await retryAfterOf({ 'retry-after': 'Wed Feb 31 07:29:00 2027' }), null);
  assert.equal(await retryAfterOf({ 'retry-after': 'Wed Jan 15 25:00:00 2027' }), null);
  assert.equal(await retryAfterOf({ 'retry-after': 'Wed Foo 15 07:29:00 2027' }), null);
});
