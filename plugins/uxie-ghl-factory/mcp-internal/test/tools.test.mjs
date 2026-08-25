import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, registerTools } from '../core/tools.mjs';

test('every tool has a name, description, schema, handler and declared capabilities', () => {
  assert.ok(TOOLS.length > 0);
  for (const t of TOOLS) {
    assert.ok(t.name && typeof t.name === 'string', 'name');
    assert.ok(t.description && t.description.length > 10, `${t.name} description`);
    assert.ok(t.inputSchema && typeof t.inputSchema === 'object', `${t.name} schema`);
    assert.equal(typeof t.handler, 'function', `${t.name} handler`);
    assert.ok(Array.isArray(t.capabilities), `${t.name} capabilities`);
  }
});

// A1 changed which LEAD ships, not whether proof status ships. The original contract -- every
// capability-bearing description discloses its proof -- is deliberate and is restored here.
test('capability-bearing descriptions carry proof labels', () => {
  const withRows = TOOLS.filter(t => t.capabilities.length > 0);
  for (const t of withRows) assert.match(t.description, /proof:/, `${t.name} carries a proof label`);
});

test('a stub catalog entry does not shadow the hand-written sentence', () => {
  const logs = TOOLS.find((t) => t.name === 'get_workflow_logs');
  // Shipped as the bare title "Get workflow logs" until A1; this sentence is what routes an agent
  // to the right tool for "what did this run actually do".
  assert.match(logs.description, /executionId/, 'get_workflow_logs keeps its operational sentence');
  assert.match(logs.description, /proof:/, 'and still discloses proof status');
});

test('read tools declare only GET capabilities', () => {
  const readTools = new Set([
    'list_workflows',
    'get_workflow',
    'export_workflow',
    'get_workflow_logs',
    'get_contacts_at_step',
    'list_account_entities',
    'list_courses',
    'raw_request',
  ]);
  for (const t of TOOLS.filter((candidate) => readTools.has(candidate.name))) for (const c of t.capabilities) {
    assert.equal(c.method, 'GET', `${t.name} declares ${c.method}`);
  }
});

test('registerTools registers each tool exactly once', () => {
  const seen = [];
  registerTools({ registerTool: (name) => seen.push(name) }, { state: {}, makeGw: () => {} });
  assert.deepEqual(seen.sort(), TOOLS.map(t => t.name).sort());
});

test('auth errors are returned as the error contract, never thrown', async () => {
  const tool = TOOLS.find(t => t.name === 'list_workflows');
  const res = await tool.handler({ locationId: 'L' }, {
    state: { tokenFile: '/nope/tok.txt' },
    makeGw: () => { const e = new Error('nope'); e.code = 'TOKEN_MISSING'; e.detail = 'no token file'; e.remediation = 'capture'; throw e; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'TOKEN_MISSING');
});

test('SC1: a coded credential throw WITH remediation keeps its code; one without falls back to ENGINE_ABORT', async () => {
  const tool = TOOLS.find((t) => t.name === 'list_workflows');
  const withRemediation = await tool.handler({ locationId: 'L' }, {
    state: {},
    makeGw: () => { const e = new Error('JWT exp is in the past'); e.code = 'TOKEN_EXPIRED'; e.remediation = 're-capture'; throw e; },
  });
  assert.equal(withRemediation.code, 'TOKEN_EXPIRED');
  // Same code, no remediation, non-spec message -> the old misclassification path. This is
  // exactly why the gateway throws now carry a remediation (review SC1).
  const withoutRemediation = await tool.handler({ locationId: 'L' }, {
    state: {},
    makeGw: () => { const e = new Error('JWT exp is in the past'); e.code = 'TOKEN_EXPIRED'; throw e; },
  });
  assert.equal(withoutRemediation.code, 'ENGINE_ABORT');
});

test('SC2: enum-like status/host fields parse any string so the SDK never echoes an invalid value', () => {
  const listWf = TOOLS.find((t) => t.name === 'list_workflows');
  const raw = TOOLS.find((t) => t.name === 'raw_request');
  const jwtish = 'eyJhbGciOiJIUzI1NiJ9.payloadpayloadpayloadpayload.sig';
  assert.doesNotThrow(() => listWf.inputSchema.parse({ locationId: 'L', status: jwtish }));
  assert.doesNotThrow(() => raw.inputSchema.parse({ locationId: 'L', method: 'GET', path: '/x', host: jwtish }));
});

test('SC2: an invalid status/host is rejected in-handler without echoing the value', async () => {
  const listWf = TOOLS.find((t) => t.name === 'list_workflows');
  const raw = TOOLS.find((t) => t.name === 'raw_request');
  const deps = { state: {}, makeGw: () => { throw new Error('gateway must not be constructed'); } };
  const jwtish = 'eyJhbGciOiJIUzI1NiJ9.payloadpayloadpayloadpayload.sig';

  for (const bad of ['archived', jwtish]) {
    const s = await listWf.handler({ locationId: 'L', status: bad }, deps);
    assert.equal(s.ok, false);
    assert.equal(s.code, 'VALIDATION_FAILED');
    assert.doesNotMatch(JSON.stringify(s), /archived|eyJ|payloadpayload/);
    const h = await raw.handler({ locationId: 'L', method: 'GET', path: '/x', host: bad }, deps);
    assert.equal(h.ok, false);
    assert.equal(h.code, 'VALIDATION_FAILED');
    assert.doesNotMatch(JSON.stringify(h), /archived|eyJ|payloadpayload/);
  }
});

test('set_token_file rejects a pasted JWT without echoing it or changing the state', async () => {
  const state = { tokenFile: '/existing/tok.txt' };
  const secret = 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz.signature';
  const tool = TOOLS.find((candidate) => candidate.name === 'set_token_file');
  const result = await tool.handler({ path: secret }, { state });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'TOKEN_MISSING');
  assert.doesNotMatch(JSON.stringify(result), /eyJ/);
  assert.equal(state.tokenFile, '/existing/tok.txt');
});

test('set_token_file and auth_status reject token-id credentials in direct-call arguments', async () => {
  const secret = 'tid-live-secret-123456789';
  const state = { tokenFile: '/existing/tok.txt' };
  const setTokenFile = TOOLS.find((candidate) => candidate.name === 'set_token_file');
  const authStatus = TOOLS.find((candidate) => candidate.name === 'auth_status');

  const setResult = await setTokenFile.handler({ path: `token-id: ${secret}` }, { state });
  const authResult = await authStatus.handler({ extra: { tokenId: secret } }, { state });

  assert.equal(setResult.ok, false);
  assert.equal(setResult.code, 'TOKEN_MISSING');
  assert.equal(authResult.ok, false);
  assert.equal(authResult.code, 'VALIDATION_FAILED');
  assert.equal(state.tokenFile, '/existing/tok.txt');
  assert.doesNotMatch(JSON.stringify({ setResult, authResult }), /tid-live-secret/);
});

// ---------------------------------------------------------------------------
// Task 6: the audit composites' descriptions are FROZEN
// ---------------------------------------------------------------------------
//
// These strings are baked into dist/audit-server.mjs and are what an operator reads at the
// moment they decide how far to trust an audit. They must stay invariant across a canary:
// a bundled description rewritten after a successful live run would turn a per-capability,
// expiring receipt into a blanket claim that no longer matches the proof index.
test('every audit composite carries the frozen proof, risk and canary labels', async () => {
  const { AUDIT_TOOL_NAMES } = await import('../core/audit-profile.mjs');
  const composites = ['get_workflow_runtime_window', 'list_workflows_complete', 'get_ai_configuration_bundle'];
  for (const name of composites) {
    assert.ok(AUDIT_TOOL_NAMES.includes(name), `${name} must be in the audit profile`);
    const tool = TOOLS.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} is not registered`);
    assert.match(tool.description, /proof: external-receipt-required/,
      `${name} must stay external-receipt-required; a canary resolves per capability from the proof index, not by rewriting this string`);
    assert.match(tool.description, /risk: read/, `${name} must declare risk: read`);
    assert.match(tool.description, /Live canary required before Full audit/,
      `${name} must carry the human-gated canary stop line`);
    // The absence of a live claim is the point: nothing here may assert proof the account
    // has not yet given.
    assert.doesNotMatch(tool.description, /LIVE-PROVEN|live-proven|proof: live-runtime/i,
      `${name} claims live proof it does not have`);
  }
});

test('no audit composite description promises an empty result on failure', () => {
  for (const name of ['get_workflow_runtime_window', 'list_workflows_complete', 'get_ai_configuration_bundle']) {
    const tool = TOOLS.find((candidate) => candidate.name === name);
    assert.match(tool.description, /never an empty/i,
      `${name} must state that a failure is never an empty result — that is the whole contract`);
  }
});

// P2 — the NORMAL capability manifest had no freshness guard, only the audit one did. It drifted
// to 137 rows against 158 fresh: 21 real capabilities that tools declare (the whole inbound-webhook
// rail, trigger logs, the account overview reads) were absent from the shipped artefact, with
// nothing failing. Nothing had been REMOVED, so this was pure staleness -- which is exactly the
// kind of gap that stays invisible without a diff.
test('the COMMITTED capability manifest equals a fresh generation', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const { buildCapabilityManifest, MANIFEST_PATH } = await import('../scripts/gen-manifest.mjs');
  const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  assert.deepEqual(
    committed, buildCapabilityManifest(),
    'capability-manifest.json is stale — run `npm run manifest` and commit it',
  );
});
