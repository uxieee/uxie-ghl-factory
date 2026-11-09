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
// bl-946: a confirmed deployment is two calls: the first returns the token from the dry run, the second presents it.
const deployConfirmed = async (args, dependencies) => {
  const first = parse(await tool.handler({ ...args, confirm: true }, dependencies));
  if (!first.data?.confirmationToken) return first;
  return parse(await tool.handler({ ...args, confirm: true, confirmationToken: first.data.confirmationToken }, dependencies));
};
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
  const out = await deployConfirmed({ ...ARGS }, d);
  assert.equal(out.ok, true); assert.equal(out.data.written, 'update');
  // bl-946: the two-step flow adds a dry-run read before the write; the write set is what must not change.
  const seq = calls.map((c) => `${c.method} ${c.path.split('?')[0]}`);
  assert.deepEqual(seq.filter((x) => !x.startsWith('GET')), ['PATCH /agent-deployment/routing-config/configs/w1']);
  assert.equal(seq[seq.length - 1].startsWith('GET'), true, 'the last call is the re-read');
  assert.equal(out.data.verification.othersUnchanged, 1);
});

// bl-946 (DECISIONS 2026-11-09, part of w6): a routing write sends the agent live on a channel, so it takes the two-step token gate.
// confirm:true with no token writes nothing; the token from the preview writes once.
test('bl-946: a confirmed deployment with NO token writes nothing; the token from the preview writes once', async () => {
  const { calls, deps: d } = deps([row({ id: 'w1' })]);
  const writes = () => calls.filter((c) => c.method === 'PATCH' || c.method === 'POST').length;
  const first = parse(await tool.handler({ ...ARGS, confirm: true }, d));
  assert.equal(first.code, 'CONFIRM_REQUIRED', JSON.stringify(first));
  assert.equal(writes(), 0, 'the first call must not write');
  assert.equal(typeof first.data.confirmationToken, 'string');
  const second = parse(await tool.handler({ ...ARGS, confirm: true, confirmationToken: first.data.confirmationToken }, d));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(writes(), 1, 'the token writes once');
});

// bl-946 security review (fail-open): once a token is presented, a dry run that errors must NOT fall through to the confirmed write.
test('bl-946: a confirmed deployment whose dry run fails writes nothing (fail closed, not fall through)', async () => {
  const { calls, deps: d } = deps([row({ id: 'w1' })]);
  const origMake = d.makeGw;
  let failNextGets = 0;
  d.makeGw = (o) => {
    const g = origMake(o);
    const call = g.call;
    return { ...g, call: async (m, p, b) => {
      if (failNextGets > 0 && m === 'GET') { failNextGets -= 1; return { ok: false, status: 500, json: { message: 'boom' } }; }
      return call(m, p, b);
    } };
  };
  const writes = () => calls.filter((c) => c.method === 'PATCH' || c.method === 'POST').length;
  const first = parse(await tool.handler({ ...ARGS, confirm: true }, d));
  const token = first.data.confirmationToken;
  failNextGets = 1; // only the dry run fails; the confirmed run's own read would succeed
  const second = parse(await tool.handler({ ...ARGS, confirm: true, confirmationToken: token }, d));
  assert.equal(second.ok, false, JSON.stringify(second));
  assert.equal(writes(), 0, 'a failed dry run must never reach the write');
});
