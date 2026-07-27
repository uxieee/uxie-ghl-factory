// RED tests for Task 5: the dedicated audit stdio server, its capability manifest, and
// its committed bundle.
//
// Three layers, because no single one of them can carry the claim on its own:
//
//   1. REAL PROTOCOL (in-memory McpServer + Client). Proves the audit registry, the
//      absence of `confirm`, the composite contracts, and argument scrubbing over the
//      actual MCP wire — the mistake test/registration.test.mjs exists to remember is
//      that a mock server validates our calling convention, not the SDK's.
//   2. REAL PROCESS (spawned child over stdio). Proves the COMMITTED artefact behaves,
//      not just the source tree, and that no environment variable can widen it.
//   3. SOURCE CONTRACT (stdio-audit.mjs read as text). The entry point connects a
//      transport at import time, so it cannot be imported for inspection; the wiring
//      invariants the carry-forwards pin (one shared limiter/circuit injected as
//      `deps.auditLimiter`/`deps.auditCircuit`, the spreading gateway factory, no
//      forwarded `descriptors`, no env switch) are asserted structurally and their
//      observable half is asserted behaviourally alongside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TOOLS, registerTools, makeGatewayFactory, processAuditPacing } from '../core/tools.mjs';
import { AUDIT_TOOL_NAMES, toolsForProfile } from '../core/audit-profile.mjs';
import { AUDIT_CAPABILITIES } from '../core/audit-capabilities.mjs';
import { makeAuditCircuit } from '../core/audit-gateway.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const AUDIT_ENTRY = resolve(ROOT, 'stdio-audit.mjs');
const AUDIT_BUNDLE = resolve(ROOT, 'dist/audit-server.mjs');
const AUDIT_MANIFEST_FILE = resolve(ROOT, 'audit-capability-manifest.json');
const NORMAL_ENTRY = resolve(ROOT, 'stdio.mjs');

const LOC = 'loc-audit-1';
const WF = 'wf-audit-1';
const COMPANY = 'company-audit-1';
const CAPTURED_AT = '2026-07-24T00:00:00.000Z';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const JWT_SHAPED = `eyJhbGciOiJIUzI1NiJ9.${b64({ authClassId: 'u', exp: 4102444800 })}.sig`;

// ---------------------------------------------------------------------------
// the in-memory harness
// ---------------------------------------------------------------------------

// Backend + AI rails shaped exactly like makeGateway's return: `callWithMeta` is the
// surface makeAuditGateway drives, and `rail` is what its construction-time
// AUDIT_RAIL_MISMATCH check reads. The REAL audit gateway sits between these stubs and
// the composites, so descriptor policy is exercised rather than bypassed.
const DEFAULT_BODIES = Object.freeze({
  [`/workflow/${LOC}/${WF}`]: {
    _id: WF, name: 'Audit WF', status: 'published', version: 3,
    workflowData: { templates: [{ id: 'step-1' }] },
  },
  [`/workflow/${LOC}/trigger`]: { triggers: [] },
  // The LIVE envelope, captured on GROM AU 2026-07-27: `{rows, count, isLocationRateLimited}`.
  // This used to be `{workflows, total}`, a shape GHL has never returned.
  [`/workflow/${LOC}/list`]: { rows: [], count: 0, isLocationRateLimited: false },
  '/workflows/sticky-notes-all': { data: [], count: 0 },
  '/workflows/logs/v2': { logs: [] },
  '/workflows/status/search/count-per-step': { counts: [] },
  '/workflows/status/search/workflow-with-filter': { rows: [] },
  '/workflows/status/search/details-by-step': { totalCount: 0, rows: [] },
  '/workflows/status/search/enroll-stats-cache': [{ workflowId: WF, total: 0, finished: 0 }],
  '/workflows/status/enroll-stats': { workflowId: WF, total: 0, finished: 0 },
  '/ai-employees/employees/search': { employees: [], totalCount: 0 },
  // Also the live shapes (GROM AU 2026-07-27). `/voice-ai/agents/simple` answers a BARE
  // ARRAY with no envelope and no total at all — which is legal here because the surface is
  // single-shot, so a short page is terminal on its own. `/agent-studio/…/agents-with-folders`
  // answers `{items, folders, total, totalAgents, totalFolders, page, pageSize, hasMore}`.
  '/voice-ai/agents/simple': [],
  '/agent-studio/agents/agents-with-folders': { items: [], folders: [], total: 0, totalAgents: 0, totalFolders: 0 },
});

function auditHarness({ overrides = {} } = {}) {
  const gatewayOptions = [];
  const scheduled = [];
  const railStub = (rail) => ({
    rail,
    async callWithMeta(method, target) {
      const [path] = String(target).split('?');
      const override = overrides[path];
      return {
        status: 200,
        ok: true,
        json: DEFAULT_BODIES[path] ?? {},
        retryAfterMs: null,
        capturedAt: CAPTURED_AT,
        ...(override ?? {}),
      };
    },
  });
  const deps = {
    state: { tokenFile: '/nonexistent/tok.txt', engineVersion: '0.0.0-test' },
    makeGw: (options = {}) => {
      gatewayOptions.push(options);
      return railStub(options.rail === 'ai' ? 'ai' : 'jwt');
    },
    // A sentinel limiter: if the composites stop routing through the INJECTED pacing pair,
    // `scheduled` stays empty and the "stdio-audit supplies them" claim becomes unprovable.
    auditLimiter: { schedule: (task) => { scheduled.push(1); return task(); } },
    auditCircuit: makeAuditCircuit(),
  };
  return { deps, gatewayOptions, scheduled };
}

async function withAuditClient(deps, body) {
  const server = new McpServer({ name: 'audit-test-server', version: '0.0.0' });
  const client = new Client({ name: 'audit-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, deps, toolsForProfile('audit'));
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await body(client);
  } finally {
    await client.close();
  }
}

const contractOf = (result) => JSON.parse(result.content[0].text);

// ---------------------------------------------------------------------------
// 1. real protocol, in-memory
// ---------------------------------------------------------------------------

test('audit tools/list is exactly AUDIT_TOOL_NAMES, in order', async () => {
  const { deps } = auditHarness();
  await withAuditClient(deps, async (client) => {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      [...AUDIT_TOOL_NAMES],
      'the audit profile publishes its exact allowlist in registration order',
    );
  });
});

test('no audit tool publishes a confirm field, and none accepts a descriptors list', async () => {
  const { deps } = auditHarness();
  await withAuditClient(deps, async (client) => {
    const listed = await client.listTools();
    for (const tool of listed.tools) {
      const properties = tool.inputSchema?.properties ?? {};
      assert.equal(
        Object.hasOwn(properties, 'confirm'), false,
        `${tool.name} exposes a confirm field — the audit profile has nothing to confirm`,
      );
      // Task 2 carry-forward item 7: a caller-supplied descriptor list is a runtime policy
      // bypass, so there must be no field through which one could be offered.
      assert.equal(
        Object.hasOwn(properties, 'descriptors'), false,
        `${tool.name} exposes a descriptors field — that is a policy bypass, not an input`,
      );
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} schema type`);
    }
  });
});

test('a descriptors argument is refused before any handler work', async () => {
  const { deps, gatewayOptions } = auditHarness();
  await withAuditClient(deps, async (client) => {
    const contract = contractOf(await client.callTool({
      name: 'list_workflows_complete',
      arguments: { locationId: LOC, descriptors: [] },
    }));
    assert.equal(contract.ok, false);
    assert.equal(contract.code, 'VALIDATION_FAILED');
    assert.equal(gatewayOptions.length, 0, 'a rejected argument must not spend a credential read');
  });
});

test('tools/call get_workflow_runtime_window returns the stable contract through a stub rail', async () => {
  const RESULT_KEYS = [
    'appliedQueries', 'appliedWindow', 'boundLocationId', 'capabilityVersion', 'capturedAt',
    'complete', 'componentCompleteness', 'configurationBinding', 'contractVersion',
    'enrollmentTotals', 'enrollments', 'filters', 'locationBinding', 'observedEventTypes', 'pagination',
    'perStepCounts', 'rateLimit', 'requestedWindow', 'runtimeEvents', 'sourceRoutes',
    'stepRosters', 'truncated', 'warnings', 'workflowDefinition', 'workflowId',
  ];
  const { deps, gatewayOptions, scheduled } = auditHarness();
  await withAuditClient(deps, async (client) => {
    const contract = contractOf(await client.callTool({
      name: 'get_workflow_runtime_window',
      arguments: { locationId: LOC, workflowId: WF, fromDate: 1_000, toDate: 2_000 },
    }));
    assert.equal(contract.ok, true, JSON.stringify(contract).slice(0, 400));
    assert.deepEqual(Object.keys(contract.data).sort(), [...RESULT_KEYS].sort());
    assert.equal(contract.data.contractVersion, '2.0.0');
    assert.equal(contract.data.boundLocationId, LOC);
    assert.equal(contract.data.workflowId, WF);
    assert.deepEqual(contract.data.requestedWindow, { fromDate: 1_000, toDate: 2_000, boundaries: '[)' });
    // The applied window EQUALS the requested one. The old one-millisecond lower-bound
    // expansion hedged against undocumented upstream boundary semantics; those are now
    // measured (both bounds inclusive on `createdAt`), so the hedge is gone and the server
    // is asked for exactly the window that was requested.
    assert.equal(contract.data.appliedWindow.fromDate, 1_000);
    assert.equal(contract.data.appliedWindow.toDate, 2_000);
    assert.equal(contract.data.appliedWindow.dateType, 'custom');
    assert.equal(contract.data.appliedWindow.serverFiltered, true);
    assert.equal(contract.data.complete, true);
    assert.equal(contract.data.truncated, false);
  });
  // CARRY-FORWARD (Task 2 §"Audit gateways ... throttleMs: 0, jitterMs: 0"): the shared
  // limiter owns pacing. Leaving the per-gateway default double-throttles every read.
  assert.ok(gatewayOptions.length > 0, 'the tool must construct at least one gateway');
  for (const options of gatewayOptions) {
    assert.equal(options.throttleMs, 0, 'per-gateway throttling must be disabled on the audit rail');
    assert.equal(options.jitterMs, 0, 'per-gateway jitter must be disabled on the audit rail');
  }
  // CARRY-FORWARD (Task 3 §processAuditPacing): the injected pair must actually be used,
  // otherwise stdio-audit's single shared limiter would be silently discarded.
  assert.ok(scheduled.length > 0, 'every audit read must pass through the injected shared limiter');
});

test('tools/call list_workflows_complete reports an unreconciled walk as incomplete, never as an empty success', async () => {
  const ROSTER_KEYS = [
    'appliedQueries', 'boundLocationId', 'capabilityVersion', 'capturedAt', 'complete',
    'envelopeShape', 'locationBinding', 'pagination', 'rateLimit', 'reportedTotal',
    'sourceRoutes', 'terminalReason', 'totalHistory', 'truncated', 'uniqueCount',
    'uniqueProgress', 'warnings', 'workflows',
  ];
  const clean = auditHarness();
  await withAuditClient(clean.deps, async (client) => {
    const contract = contractOf(await client.callTool({
      name: 'list_workflows_complete',
      arguments: { locationId: LOC },
    }));
    assert.equal(contract.ok, true, JSON.stringify(contract).slice(0, 400));
    assert.deepEqual(Object.keys(contract.data).sort(), [...ROSTER_KEYS].sort());
    assert.equal(contract.data.boundLocationId, LOC);
    assert.equal(contract.data.complete, true, 'a terminal, reconciled, genuinely empty roster is complete');
    assert.equal(contract.data.truncated, false);
  });

  // The distinction the composite exists to make: a page that cannot reach its own
  // reported total is incomplete, and says so with a code.
  const contradicted = auditHarness({
    overrides: { [`/workflow/${LOC}/list`]: { json: { workflows: [], total: 3 } } },
  });
  await withAuditClient(contradicted.deps, async (client) => {
    const contract = contractOf(await client.callTool({
      name: 'list_workflows_complete',
      arguments: { locationId: LOC },
    }));
    assert.equal(contract.ok, true);
    assert.equal(contract.data.complete, false, 'an unreconciled roster must not publish as complete');
    assert.equal(contract.data.truncated, true);
    assert.equal(contract.data.reportedTotal, 3);
    assert.ok(
      contract.data.warnings.length > 0 && contract.data.warnings.every((warning) => typeof warning.code === 'string'),
      'incompleteness must carry a coded warning, not just a false flag',
    );
  });
});

test('tools/call get_ai_configuration_bundle preserves PER-COMPONENT completeness', async () => {
  const BUNDLE_KEYS = [
    'appliedQueries', 'boundLocationId', 'capabilityVersion', 'capturedAt', 'companyId',
    'complete', 'components', 'contractVersion', 'locationBinding', 'rateLimit',
    'truncated', 'warnings',
  ];
  // One surface refused (403 = an entitlement fact about ONE resource, which Task 2
  // deliberately latches nothing for) while the other two read cleanly.
  const { deps } = auditHarness({
    overrides: { '/voice-ai/agents/simple': { status: 403, ok: false, json: { message: 'no' } } },
  });
  await withAuditClient(deps, async (client) => {
    const contract = contractOf(await client.callTool({
      name: 'get_ai_configuration_bundle',
      arguments: { locationId: LOC, companyId: COMPANY },
    }));
    assert.equal(contract.ok, true, JSON.stringify(contract).slice(0, 400));
    assert.deepEqual(Object.keys(contract.data).sort(), [...BUNDLE_KEYS].sort());
    assert.deepEqual(Object.keys(contract.data.components).sort(), ['agent_studio', 'conversation_ai', 'voice_ai']);

    const voice = contract.data.components.voice_ai;
    assert.equal(voice.complete, false, 'a refused surface is incomplete');
    assert.equal(voice.items, null, 'a refused surface must be null items, NEVER an empty agent list');
    assert.ok(voice.errors.length > 0, 'a refused surface carries stable error metadata');
    // The blast-radius claim, made positively.
    assert.equal(contract.data.components.conversation_ai.complete, true);
    assert.equal(contract.data.components.agent_studio.complete, true);
    assert.equal(contract.data.complete, false, 'one incomplete component makes the bundle incomplete');
  });
});

test('credential-looking arguments are refused and never echoed by any audit tool', async () => {
  const tokenIdKey = 'token-id: opaque-token-id-value-123';
  const cases = [
    { label: 'JWT property key', extra: { [JWT_SHAPED]: true }, secret: JWT_SHAPED },
    { label: 'JWT property value', extra: { note: JWT_SHAPED }, secret: JWT_SHAPED },
    { label: 'token-id-like property key', extra: { [tokenIdKey]: true }, secret: tokenIdKey },
  ];
  const { deps, gatewayOptions } = auditHarness();
  await withAuditClient(deps, async (client) => {
    for (const scenario of cases) {
      const result = await client.callTool({
        name: 'get_workflow',
        arguments: { locationId: LOC, workflowId: WF, ...scenario.extra },
      });
      assert.notEqual(result.isError, true, `${scenario.label} became a protocol error that could echo the value`);
      const contract = contractOf(result);
      assert.equal(contract.ok, false, scenario.label);
      assert.equal(contract.code, 'VALIDATION_FAILED', scenario.label);
      assert.ok(!JSON.stringify(result).includes(scenario.secret), `${scenario.label} leaked into the transcript`);
    }
  });
  assert.equal(gatewayOptions.length, 0, 'a credential-bearing argument must not reach a gateway');
});

// ---------------------------------------------------------------------------
// 2. the committed child process
// ---------------------------------------------------------------------------

// The explicit forbidden set, named rather than counted: `tools.length === 6` would still
// pass if a write tool replaced a read one.
const FORBIDDEN_TOOL_NAMES = Object.freeze([
  // token setting
  'set_token_file',
  // raw escape hatch
  'raw_request',
  // writes
  'build_workflow', 'edit_workflow', 'publish_workflow', 'fast_forward_contacts',
  'create_convai_agent', 'create_voiceai_agent', 'create_studio_agent',
  // courses / memberships / communities
  'build_course', 'list_courses',
  // best-effort reads the audit profile forbids (empty-on-failure fallbacks)
  'list_account_entities', 'list_workflows', 'get_workflow_logs', 'get_contacts_at_step',
]);

// A name-shaped net as well as a name list, so a tool added AFTER this test was written
// cannot slip in under a name nobody thought to forbid.
const FORBIDDEN_NAME_PATTERN = /(^|_)(raw|set|build|edit|publish|create|delete|update|send|move|fast)_|course|membership|communit|token/i;

async function withChildClient(entry, { env = {}, name = 'audit-child' } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, GHL_TOK_FILE: '/nonexistent/tok.txt', ...env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  const client = new Client({ name, version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport).catch((error) => {
    assert.fail(`${entry} failed to boot: ${error.message}\n--- stderr ---\n${stderr.slice(0, 1200)}`);
  });
  return { client, stderr: () => stderr };
}

test('committed dist/audit-server.mjs boots over stdio and lists exactly the audit allowlist', async () => {
  const { client } = await withChildClient(AUDIT_BUNDLE, { name: 'audit-bundle-list' });
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), [...AUDIT_TOOL_NAMES]);
  } finally {
    await client.close().catch(() => {});
  }
});

test('the audit bundle exposes no write, raw, course, membership, community, or token-setting tool', async () => {
  const { client } = await withChildClient(AUDIT_BUNDLE, { name: 'audit-bundle-forbidden' });
  try {
    const { tools } = await client.listTools();
    const names = new Set(tools.map((tool) => tool.name));
    for (const forbidden of FORBIDDEN_TOOL_NAMES) {
      assert.equal(names.has(forbidden), false, `the audit bundle exposes forbidden tool ${forbidden}`);
    }
    for (const name of names) {
      assert.equal(
        FORBIDDEN_NAME_PATTERN.test(name), false,
        `${name} matches the forbidden-tool name shape; add it to the audit allowlist deliberately or rename it`,
      );
    }
    for (const tool of tools) {
      assert.equal(
        Object.hasOwn(tool.inputSchema?.properties ?? {}, 'confirm'), false,
        `${tool.name} is confirmation-gated, so it is a write the audit bundle must not carry`,
      );
    }
  } finally {
    await client.close().catch(() => {});
  }
});

test('the audit bundle answers auth_status when the credential file is missing', async () => {
  const { client } = await withChildClient(AUDIT_BUNDLE, { name: 'audit-bundle-auth' });
  try {
    const contract = contractOf(await client.callTool({ name: 'auth_status', arguments: {} }));
    assert.equal(contract.ok, true, 'auth_status must REPORT the missing credential, not fail on it');
    assert.equal(contract.data.jwtClaims.present, false);
    assert.equal(contract.data.error.code, 'TOKEN_MISSING');
    assert.ok(!JSON.stringify(contract).includes('Bearer '), 'auth_status must never echo a credential');
  } finally {
    await client.close().catch(() => {});
  }
});

test('the audit bundle returns TOKEN_MISSING before any network access', async () => {
  // No network is reachable from this test, so the proof that nothing was attempted is the
  // code itself: TOKEN_MISSING is raised at gateway construction, before the first fetch.
  // A collector that reached the wire would surface a transport or HTTP class instead.
  const { client } = await withChildClient(AUDIT_BUNDLE, { name: 'audit-bundle-token' });
  try {
    for (const [name, args] of [
      ['get_workflow_runtime_window', { locationId: LOC, workflowId: WF, fromDate: 1, toDate: 2 }],
      ['list_workflows_complete', { locationId: LOC }],
      ['get_ai_configuration_bundle', { locationId: LOC, companyId: COMPANY }],
    ]) {
      const contract = contractOf(await client.callTool({ name, arguments: args }));
      assert.equal(contract.ok, false, `${name} must not claim success without a credential`);
      assert.equal(contract.code, 'TOKEN_MISSING', `${name} returned ${contract.code}`);
    }
  } finally {
    await client.close().catch(() => {});
  }
});

test('no environment variable flips the audit entry point to the full tool set', async () => {
  // The plan's interface line: "It has no environment switch to expose the full tool set."
  // Tested against the SOURCE entry point so a failure names the entry, not the bundle.
  const hostile = [
    { MCP_PROFILE: 'full' },
    { GHL_MCP_PROFILE: 'full' },
    { PROFILE: 'full' },
    { AUDIT: '0' },
    { AUDIT_PROFILE: 'off' },
    { GHL_MCP_TOOLS: 'all' },
    { MCP_TOOLS: 'all' },
    { NODE_ENV: 'development', DEBUG: '*' },
  ];
  for (const env of hostile) {
    const { client } = await withChildClient(AUDIT_ENTRY, { env, name: 'audit-env' });
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map((tool) => tool.name), [...AUDIT_TOOL_NAMES],
        `env ${JSON.stringify(env)} changed the audit registry`,
      );
    } finally {
      await client.close().catch(() => {});
    }
  }
});

// ---------------------------------------------------------------------------
// 3. the entry-point source contract
// ---------------------------------------------------------------------------

// Comments are stripped before scanning so an explanatory comment naming a forbidden token
// cannot fail the test, and so a rule cannot be satisfied by a comment either.
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

const auditEntrySource = () => {
  let raw;
  try {
    raw = readFileSync(AUDIT_ENTRY, 'utf8');
  } catch (error) {
    assert.fail(`stdio-audit.mjs is missing (${error.code}); Task 5 must create the dedicated audit entry point`);
  }
  return stripComments(raw);
};

test('stdio-audit.mjs always registers toolsForProfile("audit") and never the full registry', () => {
  const code = auditEntrySource();
  const calls = [...code.matchAll(/toolsForProfile\(\s*(['"])([^'"]*)\1\s*\)/g)];
  assert.equal(calls.length, 1, 'the audit entry point selects its registry exactly once');
  assert.equal(calls[0][2], 'audit', 'the profile is a literal, so no value can be substituted at runtime');
  assert.equal(
    countOf(code, 'toolsForProfile('), 1,
    'a second toolsForProfile call — literal or computed — is a second registry',
  );
  assert.match(code, /registerTools\(/, 'the entry point must register the selected tools');
  assert.equal(
    /\bTOOLS\b/.test(code), false,
    'importing the full TOOLS registry into the audit entry point is exactly the escape this profile forbids',
  );
});

test('stdio-audit.mjs reads no environment variable that could switch its profile', () => {
  const code = auditEntrySource();
  const referenced = [...code.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
  for (const name of referenced) {
    assert.equal(
      name, 'GHL_TOK_FILE',
      `stdio-audit.mjs reads process.env.${name}; only the credential file path may come from the environment`,
    );
  }
  assert.equal(
    /process\.env\s*\[/.test(code), false,
    'a computed process.env lookup is an environment switch the static check cannot audit',
  );
  assert.equal(/process\.argv/.test(code), false, 'nor may the profile be selected from argv');
});

test('stdio-audit.mjs creates ONE shared limiter and circuit and injects them as deps', () => {
  const code = auditEntrySource();
  // Either shape is legal: one processAuditPacing() call, or one makeAuditLimiter() plus
  // one makeAuditCircuit(). What is illegal is more than one of either.
  const limiterSites = countOf(code, 'makeAuditLimiter(') + countOf(code, 'processAuditPacing(');
  const circuitSites = countOf(code, 'makeAuditCircuit(') + countOf(code, 'processAuditPacing(');
  assert.equal(limiterSites, 1, 'exactly one limiter is constructed for the whole audit process');
  assert.equal(circuitSites, 1, 'exactly one circuit is constructed for the whole audit process');
  // Tasks 3 and 4 both read `deps.auditLimiter ?? processAuditPacing().limiter`, so the
  // entry point must actually SUPPLY them or the injection seam is decorative.
  assert.match(code, /auditLimiter\s*[,:}\n]/, 'deps.auditLimiter must be supplied by the audit entry point');
  assert.match(code, /auditCircuit\s*[,:}\n]/, 'deps.auditCircuit must be supplied by the audit entry point');
});

test('stdio-audit.mjs uses the spreading gateway factory and forwards no descriptor list', () => {
  const code = auditEntrySource();
  // CARRY-FORWARD (Task 3): the destructuring lambda swallowed `throttleMs: 0, jitterMs: 0`
  // and double-throttled every audit read. makeGatewayFactory spreads every option through.
  assert.match(code, /makeGatewayFactory\(/, 'the audit entry point must build its gateway factory from makeGatewayFactory');
  assert.equal(
    /\bdescriptors\b/.test(code), false,
    'CARRY-FORWARD (Task 2 item 7): forwarding a descriptors list is a runtime policy bypass',
  );
  // Only the names that are not substrings of an ALLOWED tool name, so this stays a real
  // check rather than a trap (`list_workflows` lives inside `list_workflows_complete`).
  for (const forbidden of ['raw_request', 'set_token_file', 'list_courses', 'build_course',
    'edit_workflow', 'publish_workflow', 'fast_forward_contacts', 'list_account_entities']) {
    assert.equal(code.includes(forbidden), false, `stdio-audit.mjs names the forbidden tool ${forbidden}`);
  }
});

test('makeGatewayFactory forwards the audit pacing options the entry point depends on', () => {
  // The behavioural half of the source claim above: the factory the entry point uses is
  // the one that does NOT drop throttleMs/jitterMs.
  const seen = [];
  const factory = makeGatewayFactory({
    state: { tokenFile: '/nonexistent/tok.txt' },
    gatewayImpl: (options) => { seen.push(options); return { rail: options.rail === 'ai' ? 'ai' : 'jwt' }; },
  });
  factory({ loc: LOC, rail: 'jwt', throttleMs: 0, jitterMs: 0 });
  assert.equal(seen[0].throttleMs, 0);
  assert.equal(seen[0].jitterMs, 0);
  assert.equal(seen[0].tokenFile, '/nonexistent/tok.txt');
});

test('processAuditPacing hands out the SAME limiter and circuit for the life of the process', () => {
  const first = processAuditPacing();
  const second = processAuditPacing();
  assert.equal(first.limiter, second.limiter, 'a fresh limiter per call would pace against nothing');
  assert.equal(first.circuit, second.circuit, 'a fresh circuit per call would forget a 429 immediately');
});

// ---------------------------------------------------------------------------
// 4. the normal server is untouched
// ---------------------------------------------------------------------------

test('the full 22-tool registry and the normal stdio entry point are unchanged', () => {
  // 21 -> 22 when this branch merged main at 0.14.0, which added `check_workflow`. The
  // literal list is kept rather than relaxed to a subset check: the claim is that the audit
  // profile takes nothing AWAY, and only an exact list can catch a tool silently disappearing
  // from the full server. A merge that drops one should fail here, loudly, which is why the
  // count moves by hand and never by `TOOLS.length`.
  assert.equal(TOOLS.length, 22, 'the audit profile is ADDITIVE; the full server keeps every tool');
  assert.deepEqual(TOOLS.map((tool) => tool.name), [
    'set_token_file', 'auth_status', 'create_convai_agent', 'create_voiceai_agent',
    'create_studio_agent', 'list_workflows', 'get_workflow', 'check_workflow', 'export_workflow',
    'get_workflow_logs', 'get_workflow_runtime_window', 'list_workflows_complete',
    'get_ai_configuration_bundle', 'get_contacts_at_step', 'list_account_entities',
    'list_courses', 'build_course', 'build_workflow', 'edit_workflow', 'publish_workflow',
    'fast_forward_contacts', 'raw_request',
  ]);
  const normal = stripComments(readFileSync(NORMAL_ENTRY, 'utf8'));
  assert.equal(
    /toolsForProfile|audit-profile/.test(normal), false,
    'stdio.mjs must keep registering the FULL registry; the audit profile is a separate entry point',
  );
  assert.match(normal, /registerTools\(server,\s*\{\s*state,\s*makeGw\s*\}\s*\)/,
    'stdio.mjs must still register every tool (no third argument)');
});

// ---------------------------------------------------------------------------
// 5. the capability manifest
// ---------------------------------------------------------------------------

const MANIFEST_KEY_ORDER = Object.freeze([
  'schemaVersion', 'profile', 'proofModel', 'tools', 'capabilities', 'manifestHash',
]);

// The plan's prose field list (line ~633) plus the two policy-bearing fields it predates.
// Dropping `repeatableQueryKeys` or `sealedBy` would let the checked-in artefact describe a
// WIDER surface than the gateway enforces: without `sealedBy` no reader can tell which
// discovery route may authorize a detail route, and without `repeatableQueryKeys` a future
// non-empty value could be introduced with no manifest diff to review.
const CAPABILITY_ROW_FIELDS = Object.freeze([
  'allowedQueryValues', 'authRail', 'capabilityId', 'fixedQueryValues', 'host',
  'locationBinding', 'method', 'normalizedPath', 'numericQueryBounds', 'optionalQueryKeys',
  'pathBindings', 'queryBindings', 'repeatableQueryKeys', 'requiredQueryKeys', 'sealedBy',
  'tool',
]);

let genManifest = null;
async function loadGenManifest() {
  if (genManifest) return genManifest;
  genManifest = await import('../scripts/gen-manifest.mjs');
  return genManifest;
}

async function requireManifestApi() {
  const module = await loadGenManifest();
  for (const name of ['buildAuditManifest', 'normalizeCapabilityPath', 'auditManifestHash']) {
    assert.equal(
      typeof module[name], 'function',
      `scripts/gen-manifest.mjs must export ${name}() so the manifest is generated from the descriptors, not hand-written`,
    );
  }
  assert.equal(typeof module.AUDIT_MANIFEST_PATH, 'string', 'gen-manifest must export AUDIT_MANIFEST_PATH');
  return module;
}

const throwsWithCode = (fn, code) => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'expected an Error instance');
    assert.ok(
      error.code === code || String(error.message).startsWith(code),
      `expected ${code}, got code=${error.code} message=${error.message}`,
    );
    return true;
  });
};

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

// THE NORMALIZATION RULE. Tool capability rows have always spelled their path templates
// `{loc}`/`{wid}`; the audit descriptors spell the same routes `{locationId}`/`{workflowId}`.
// They address ONE route. A naive textual "descriptor and row differ => fail" check would
// therefore reject every audit capability that carries a path binding at all, so the rule is
// pinned here as data and tested in both directions.
const PLACEHOLDER_ALIASES = Object.freeze({
  loc: 'locationId',
  locationId: 'locationId',
  wid: 'workflowId',
  workflowId: 'workflowId',
  agentId: 'agentId',
});

// An INDEPENDENT implementation of the rule, so the manifest tests below compare the
// generator against the pinned table rather than against itself.
const localNormalize = (path) => path.split('/').map((segment) => {
  if (!(segment.startsWith('{') && segment.endsWith('}'))) return segment;
  const name = segment.slice(1, -1);
  assert.ok(Object.hasOwn(PLACEHOLDER_ALIASES, name), `unknown path placeholder {${name}} in ${path}`);
  return `{${PLACEHOLDER_ALIASES[name]}}`;
}).join('/');

test('normalizeCapabilityPath maps both placeholder vocabularies onto one canonical form', async () => {
  const { normalizeCapabilityPath } = await requireManifestApi();
  for (const [alias, canonicalName] of Object.entries(PLACEHOLDER_ALIASES)) {
    assert.equal(
      normalizeCapabilityPath(`/x/{${alias}}/y`), `/x/{${canonicalName}}/y`,
      `the alias table must be the whole rule: {${alias}} -> {${canonicalName}}`,
    );
  }
  assert.equal(normalizeCapabilityPath('/workflow/{loc}/list'), '/workflow/{locationId}/list');
  assert.equal(normalizeCapabilityPath('/workflow/{locationId}/list'), '/workflow/{locationId}/list');
  assert.equal(normalizeCapabilityPath('/workflow/{loc}/{wid}'), '/workflow/{locationId}/{workflowId}');
  assert.equal(normalizeCapabilityPath('/workflow/{locationId}/{workflowId}'), '/workflow/{locationId}/{workflowId}');
  assert.equal(normalizeCapabilityPath('/voice-ai/agents/{agentId}'), '/voice-ai/agents/{agentId}');
  // Static paths are untouched, so a route with no binding cannot be renamed by the rule.
  assert.equal(normalizeCapabilityPath('/workflows/logs/v2'), '/workflows/logs/v2');
  assert.equal(normalizeCapabilityPath('/voice-ai/agents/simple'), '/voice-ai/agents/simple');

  // The rule is exactly the alias table, and nothing else. An unknown placeholder must be a
  // hard failure, never a silent pass-through that lets a typo match nothing.
  for (const path of ['/workflow/{foo}/list', '/workflow/{location}/list', '/agents/{id}']) {
    throwsWithCode(() => normalizeCapabilityPath(path), 'AUDIT_MANIFEST_UNKNOWN_PLACEHOLDER');
  }
  // And normalization must not collapse genuinely different routes.
  assert.notEqual(
    normalizeCapabilityPath('/workflow/{loc}/list'),
    normalizeCapabilityPath('/workflow/{loc}/lists'),
  );
});

test('the generated audit manifest has the exact planned shape', async () => {
  const { buildAuditManifest, auditManifestHash } = await requireManifestApi();
  const manifest = buildAuditManifest();
  assert.deepEqual(Object.keys(manifest), [...MANIFEST_KEY_ORDER], 'manifest key order is part of the artefact');
  assert.equal(manifest.schemaVersion, '1.0');
  assert.equal(manifest.profile, 'audit');
  assert.equal(manifest.proofModel, 'external_capability_receipts_v1');
  assert.deepEqual(manifest.tools, [...AUDIT_TOOL_NAMES]);
  assert.ok(Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0);

  // The hash covers the canonical manifest with `manifestHash` OMITTED (not blanked): a
  // hash over a manifest containing its own placeholder could never be recomputed.
  const { manifestHash, ...withoutHash } = manifest;
  const expected = createHash('sha256').update(JSON.stringify(canonical(withoutHash))).digest('hex');
  assert.equal(auditManifestHash(manifest), `sha256:${expected}`);
  assert.equal(manifestHash, `sha256:${expected}`, 'the emitted manifestHash must cover the manifest without itself');
});

test('every capability row carries the full policy field set, including repeatableQueryKeys and sealedBy', async () => {
  const { buildAuditManifest } = await requireManifestApi();
  const manifest = buildAuditManifest();
  const auditTools = toolsForProfile('audit');

  // One row per (tool, capability) pair, in tool-registration order and then in the tool's
  // own declared capability order — deterministic, so the manifest hash is stable.
  const expectedPairs = auditTools.flatMap((tool) => tool.capabilities.map((capability) => [tool.name, capability.path]));
  assert.deepEqual(
    manifest.capabilities.map((row) => [row.tool, row.normalizedPath]),
    expectedPairs.map(([toolName, path]) => [toolName, localNormalize(path)]),
  );

  for (const row of manifest.capabilities) {
    assert.deepEqual(Object.keys(row).sort(), [...CAPABILITY_ROW_FIELDS],
      `${row.tool}/${row.capabilityId}: row field set drifted from the descriptor contract`);
    assert.equal(row.method, 'GET');
    assert.ok(['backend/backend', 'services/ai'].includes(`${row.host}/${row.authRail}`),
      `${row.capabilityId}: illegal host/rail pair`);
    assert.ok(['path', 'query', 'request_scope'].includes(row.locationBinding));
    assert.ok(Array.isArray(row.repeatableQueryKeys), `${row.capabilityId}: repeatableQueryKeys must be carried`);
    assert.ok(row.sealedBy === null || typeof row.sealedBy === 'string',
      `${row.capabilityId}: sealedBy must be carried, even when null`);
  }

  // Every descriptor the gateway enforces must be described by the artefact, or the
  // artefact is not a manifest of the audit surface.
  assert.deepEqual(
    [...new Set(manifest.capabilities.map((row) => row.capabilityId))].sort(),
    AUDIT_CAPABILITIES.map((capability) => capability.capabilityId).sort(),
  );
});

test('the committed audit-capability-manifest.json is in sync with the descriptors', async () => {
  const { buildAuditManifest } = await requireManifestApi();
  let committed;
  try {
    committed = JSON.parse(readFileSync(AUDIT_MANIFEST_FILE, 'utf8'));
  } catch (error) {
    assert.fail(`audit-capability-manifest.json is missing or unreadable (${error.code ?? error.message}); run \`npm run manifest\` and commit it`);
  }
  assert.deepEqual(committed, buildAuditManifest(),
    'audit-capability-manifest.json is stale — run `npm run manifest` and commit it');
});

test('manifest generation fails closed on every disqualifying condition', async () => {
  const { buildAuditManifest } = await requireManifestApi();
  const auditTools = toolsForProfile('audit');
  const rosterTool = auditTools.find((tool) => tool.name === 'list_workflows_complete');
  const replace = (name, over) => auditTools.map((tool) => (tool.name === name ? { ...tool, ...over } : tool));

  // 1. a method that is not GET.
  throwsWithCode(
    () => buildAuditManifest({
      tools: replace('list_workflows_complete', {
        capabilities: [{ method: 'POST', path: '/workflow/{loc}/list' }],
      }),
    }),
    'AUDIT_MANIFEST_METHOD_NOT_GET',
  );

  // 2. a host/rail pair that is not exactly backend/backend or services/ai.
  throwsWithCode(
    () => buildAuditManifest({
      descriptors: AUDIT_CAPABILITIES.map((capability) => (
        capability.capabilityId === 'voice_ai_agent_discovery'
          ? { ...capability, authRail: 'backend' }
          : capability
      )),
    }),
    'AUDIT_MANIFEST_ILLEGAL_HOST_RAIL',
  );
  throwsWithCode(
    () => buildAuditManifest({
      descriptors: AUDIT_CAPABILITIES.map((capability) => (
        capability.capabilityId === 'workflow_roster_list'
          ? { ...capability, host: 'services' }
          : capability
      )),
    }),
    'AUDIT_MANIFEST_ILLEGAL_HOST_RAIL',
  );

  // 3. a forbidden tool is present.
  for (const forbidden of ['raw_request', 'set_token_file', 'list_courses', 'edit_workflow']) {
    const smuggled = TOOLS.find((tool) => tool.name === forbidden);
    assert.ok(smuggled, `fixture error: ${forbidden} is not in TOOLS`);
    throwsWithCode(
      () => buildAuditManifest({ tools: [...auditTools, smuggled] }),
      'AUDIT_MANIFEST_FORBIDDEN_TOOL',
    );
  }

  // 4. a registered audit tool is absent from the manifest.
  throwsWithCode(
    () => buildAuditManifest({ tools: auditTools.filter((tool) => tool.name !== 'export_workflow') }),
    'AUDIT_MANIFEST_TOOL_MISSING',
  );
  throwsWithCode(
    () => buildAuditManifest({
      tools: auditTools.map((tool) => (tool.name === 'get_workflow' ? { ...tool, name: 'get_workflow_x' } : tool)),
    }),
    'AUDIT_MANIFEST_TOOL_MISSING',
  );

  // 5. a gateway descriptor and a capability row differ. `/workflow/{loc}/lists` normalizes
  // to `/workflow/{locationId}/lists`, which no descriptor declares — so this is the case
  // the normalization rule must still catch after it has stopped rejecting `{loc}` itself.
  throwsWithCode(
    () => buildAuditManifest({
      tools: replace('list_workflows_complete', {
        capabilities: [{ method: 'GET', path: '/workflow/{loc}/lists' }],
      }),
    }),
    'AUDIT_MANIFEST_DESCRIPTOR_MISMATCH',
  );
  throwsWithCode(
    () => buildAuditManifest({
      tools: replace('get_workflow', {
        capabilities: [{ method: 'GET', path: '/workflows/logs/v3' }],
      }),
    }),
    'AUDIT_MANIFEST_DESCRIPTOR_MISMATCH',
  );

  // The control: the real inputs generate cleanly, so every failure above is the injected
  // fault and not a generator that refuses everything.
  assert.doesNotThrow(() => buildAuditManifest({ tools: auditTools, descriptors: AUDIT_CAPABILITIES }));
  assert.ok(rosterTool.capabilities[0].path.includes('{loc}'),
    'fixture error: the roster row must still use the {loc} vocabulary for the normalization case to be real');
});

// ---------------------------------------------------------------------------
// 6. the second lock, and the guards the first review found deletable-while-green
// ---------------------------------------------------------------------------

test('toolsForProfile rejects a tool that declares any non-GET capability', () => {
  // The guard the whole read-only claim rests on. Without this test it can be deleted with
  // the suite still green, because the OTHER assertions only prove that today's real tools
  // happen to be all-GET — a property of the data, not of the guard.
  const auditTools = toolsForProfile('audit');
  const poisoned = auditTools.map((tool) => (tool.name === 'get_workflow'
    ? { ...tool, capabilities: [{ method: 'POST', path: '/workflow/{loc}/{wid}' }] }
    : tool));
  assert.throws(() => toolsForProfile('audit', poisoned), /UNAPPROVED_AUDIT_TOOL/);

  const mixed = auditTools.map((tool) => (tool.name === 'export_workflow'
    ? { ...tool, capabilities: [...tool.capabilities, { method: 'DELETE', path: '/workflow/{loc}/{wid}' }] }
    : tool));
  assert.throws(() => toolsForProfile('audit', mixed), /UNAPPROVED_AUDIT_TOOL/,
    'ONE non-GET capability among many is still a write surface');
});

test('toolsForProfile refuses an unknown profile rather than ignoring the argument', () => {
  for (const profile of ['full', '', 'AUDIT', null, undefined]) {
    assert.throws(() => toolsForProfile(profile), /UNKNOWN_TOOL_PROFILE/, `profile ${String(profile)}`);
  }
});

test('the audit gateway wrapper blocks every non-GET, body-bearing, or off-host request', async () => {
  const { readOnlyGateway } = await import('../core/audit-readonly.mjs');
  const { AUDIT_HOSTS } = await import('../core/audit-capabilities.mjs');
  const seen = [];
  const inner = {
    rail: 'jwt',
    uid: 'u-1',
    call: async (...args) => { seen.push(['call', ...args]); return { status: 200, ok: true, json: {} }; },
    callWithMeta: async (...args) => { seen.push(['callWithMeta', ...args]); return { status: 200, ok: true, json: {} }; },
    stream: async () => { seen.push(['stream']); return {}; },
  };
  const gw = readOnlyGateway(inner);

  // Pass-through properties survive: makeAuditGateway reads `rail` at construction to refuse
  // a swapped rail map, so losing it here would break the FIRST lock while adding the second.
  assert.equal(gw.rail, 'jwt');
  assert.equal(gw.uid, 'u-1');

  const rejects = async (promise, label) => {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, 'AUDIT_WRITE_BLOCKED', label);
      return true;
    }, label);
  };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'get', '']) {
    await rejects(gw.call(method, '/x', undefined, AUDIT_HOSTS.backend), `call ${method}`);
    await rejects(gw.callWithMeta(method, '/x', undefined, AUDIT_HOSTS.backend), `callWithMeta ${method}`);
  }
  await rejects(gw.call('GET', '/x', { any: 'body' }, AUDIT_HOSTS.backend), 'GET carrying a body');
  await rejects(gw.call('GET', '/x', undefined, 'https://evil.example'), 'off-host origin');
  await rejects(gw.callWithMeta('GET', '/x', undefined, { base: 'https://evil.example' }), 'off-host base option');
  await rejects(gw.stream('GET', '/x'), 'stream is a build channel, never a read');
  assert.equal(seen.length, 0, 'a blocked request must never reach the real gateway');

  // The control: an approved GET still goes through, on both hosts and both surfaces.
  for (const base of Object.values(AUDIT_HOSTS)) {
    assert.equal((await gw.call('GET', '/x', undefined, base)).ok, true);
    assert.equal((await gw.callWithMeta('GET', '/x', undefined, { base })).ok, true);
  }
  assert.equal(seen.length, 4, 'approved reads must still reach the real gateway');
});

test('stdio-audit.mjs installs the read-only gateway wrapper as its second lock', () => {
  const code = auditEntrySource();
  assert.match(code, /readOnlyGateway\(/, 'the audit entry point must wrap every gateway it builds');
  assert.match(code, /gatewayImpl\s*:/, 'the wrapper is installed through makeGatewayFactory’s injection seam');
});

test('manifest generation rejects a non-GET DESCRIPTOR, not just a non-GET tool row', async () => {
  // row.method is COPIED FROM the descriptor, so checking only the tool row would ship a
  // manifest asserting a non-GET audit capability while generation reported success.
  const { buildAuditManifest } = await requireManifestApi();
  for (const method of ['POST', 'DELETE', 'PUT']) {
    throwsWithCode(
      () => buildAuditManifest({
        descriptors: AUDIT_CAPABILITIES.map((capability) => (
          capability.capabilityId === 'workflow_detail' ? { ...capability, method } : capability
        )),
      }),
      'AUDIT_MANIFEST_METHOD_NOT_GET',
    );
  }
});

test('manifest generation rejects two descriptors that normalize to one path', async () => {
  // Tool capability rows carry no host, so a row is bound to a descriptor by path alone. A
  // collision would silently hand an existing row the wrong host AND the wrong credential rail.
  const { buildAuditManifest } = await requireManifestApi();
  const detail = AUDIT_CAPABILITIES.find((capability) => capability.capabilityId === 'workflow_detail');
  throwsWithCode(
    () => buildAuditManifest({
      descriptors: [...AUDIT_CAPABILITIES, { ...detail, capabilityId: 'shadow', host: 'services', authRail: 'ai' }],
    }),
    'AUDIT_MANIFEST_PATH_COLLISION',
  );
});

test('the legal host/rail pairs are exactly backend/backend and services/ai', async () => {
  // Pinned as a value, not merely applied: adding backend/ai — the cross-rail smuggle the
  // constant exists to stop — would otherwise pass every existing assertion.
  const { buildAuditManifest } = await requireManifestApi();
  for (const [host, authRail] of [['backend', 'ai'], ['services', 'backend'], ['services', 'services'], ['backend', 'jwt']]) {
    throwsWithCode(
      () => buildAuditManifest({
        descriptors: AUDIT_CAPABILITIES.map((capability) => (
          capability.capabilityId === 'workflow_detail' ? { ...capability, host, authRail } : capability
        )),
      }),
      'AUDIT_MANIFEST_ILLEGAL_HOST_RAIL',
    );
  }
});

test('importing scripts/gen-manifest.mjs writes nothing', async () => {
  // The module used to write on import, so a test that merely inspected the generator
  // rewrote two committed artefacts as a side effect — and a stale one would have been
  // silently REPAIRED instead of failing its own staleness gate.
  //
  // Compared by mtime, not by content: regeneration is byte-identical, so a content hash
  // cannot see the write at all. (Measured — a hash-based version of this test let the
  // "always write" mutant survive.)
  const files = [AUDIT_MANIFEST_FILE, resolve(ROOT, 'capability-manifest.json')];
  const before = files.map((file) => statSync(file).mtimeMs);
  await import(`../scripts/gen-manifest.mjs?probe=${before.join('-')}`);
  const after = files.map((file) => statSync(file).mtimeMs);
  assert.deepEqual(after, before, 'importing the generator must not touch a committed artefact');
});
