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

test('capability-bearing descriptions carry proof labels', () => {
  const withRows = TOOLS.filter(t => t.capabilities.length > 0);
  for (const t of withRows) assert.match(t.description, /proof:/, `${t.name} carries a proof label`);
});

test('read tools declare only GET capabilities', () => {
  const readTools = new Set([
    'list_workflows',
    'get_workflow',
    'export_workflow',
    'get_workflow_logs',
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
