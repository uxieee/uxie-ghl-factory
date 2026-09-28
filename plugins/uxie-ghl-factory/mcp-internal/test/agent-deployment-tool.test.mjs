// Handler tests for set_agent_deployment: the routing table is account-wide, so the tool's contract is "write only the
// named agent's row, and prove every other row identical". The engine is tested in engines/ai/deployment.test.mjs;
// this file locks the tool surface: preview = one read, refusals before any call, the confirmed sequence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'set_agent_deployment');
const row = (o) => ({ id: o.id, locationId: 'L', channel: 'WebChat', providerId: 'WebChat', agentId: 'ME', agentProductType: 'conversation_ai',
  enabled: false, allIdentifiers: true, specificIdentifiers: [], includeTags: [], includeTagsOperator: 'AND', excludeTags: [], excludeTagsOperator: 'AND', ...o });
function deps(rows) {
  let table = rows; const calls = [];
  const gw = { loc: 'L', uid: 'u', call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') return { ok: true, status: 200, json: structuredClone(table) };
    if (method === 'PATCH') { const id = path.split('/').pop(); table = table.map((r) => (r.id === id ? { ...r, ...body } : r)); return { ok: true, status: 200, json: table.find((r) => r.id === id) }; }
    if (method === 'POST') { const r = row({ id: 'new', ...body }); table = [...table, r]; return { ok: true, status: 201, json: r }; }
    return { ok: false, status: 405, json: {} };
  } };
  return { calls, deps: { makeGw: () => gw, state: {} } };
}
const parse = (res) => res;
const ARGS = { locationId: 'L', agentId: 'ME', channel: 'WebChat', enabled: false, includeTags: ['probe'] };

test('set_agent_deployment is registered with its three routes', () => {
  assert.ok(tool);
  assert.deepEqual(tool.capabilities.map((c) => c.method), ['GET', 'POST', 'PATCH']);
});

test('preview: one read, no write, and the plan names the action', async () => {
  const { calls, deps: d } = deps([row({ id: 'g1', agentId: 'GROM', channel: 'Live_Chat', providerId: 'Live_Chat', enabled: true })]);
  const out = parse(await tool.handler({ ...ARGS }, d));
  assert.equal(out.code, 'CONFIRM_REQUIRED'); assert.equal(out.data.preview.action, 'create');
  assert.deepEqual(calls.map((c) => c.method), ['GET']);
});

test('refusals happen before any call', async () => {
  const { calls, deps: d } = deps([]);
  const out = parse(await tool.handler({ ...ARGS, includeTags: ['a'], excludeTags: ['a'], confirm: true }, d));
  assert.equal(out.code, 'VALIDATION_FAILED'); assert.equal(calls.length, 0);
});

test('confirmed update: read, PATCH the one row, re-read; others unchanged', async () => {
  const { calls, deps: d } = deps([row({ id: 'w1' }), row({ id: 'g1', agentId: 'GROM', channel: 'Live_Chat', providerId: 'Live_Chat', enabled: true })]);
  const out = parse(await tool.handler({ ...ARGS, confirm: true }, d));
  assert.equal(out.ok, true); assert.equal(out.data.written, 'update');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path.split('?')[0]}`), ['GET /agent-deployment/routing-config/configs', 'PATCH /agent-deployment/routing-config/configs/w1', 'GET /agent-deployment/routing-config/configs']);
  assert.equal(out.data.verification.othersUnchanged, 1);
});
