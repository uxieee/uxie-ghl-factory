import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, registerTools } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'get_account_workflow_overview');
function fixture(countFor) {
  const calls = [];
  const gw = { loc: 'L', uid: 'u', call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'POST' && path === '/workflows/trigger/logs/count') return countFor(body);
    if (path.startsWith('/workflows/statistics')) return { status: 200, ok: true, json: { total: 3 } };
    return { status: 200, ok: true, json: [] };
  } };
  return { calls, deps: { state: { tokenFile: '/x' }, makeGw: () => gw } };
}
const counted = (total, matched) => ({ status: 201, ok: true, json: [{ total: String(total), matched: String(matched) }] });

test('OFF by default: no POST is made and triggerCounts is null (control for the opt-in)', async () => {
  const f = fixture(() => counted(9, 9));
  const r = await tool().handler({ locationId: 'L', workflowIds: ['a'] }, f.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.triggerCounts, null);
  assert.equal(f.calls.some((c) => c.method === 'POST'), false);
});

test('ONE CALL PER WORKFLOW — the route sums its id list, so ids are never batched', async () => {
  const f = fixture((body) => (body.workflowId[0] === 'a' ? counted(237, 1) : counted(38, 0)));
  const r = await tool().handler({ locationId: 'L', workflowIds: ['a', 'b'], includeTriggerCounts: true }, f.deps);
  const posts = f.calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => c.body), [{ locationId: 'L', workflowId: ['a'] }, { locationId: 'L', workflowId: ['b'] }]);
  assert.deepEqual(r.data.triggerCounts, [
    { workflowId: 'a', attempted: 237, matched: 1, unmatched: 236, neverMatches: false },
    { workflowId: 'b', attempted: 38, matched: 0, unmatched: 38, neverMatches: true },
  ]);
});

test('neverMatches needs ATTEMPTS: 0/0 is a quiet workflow, not a broken one (control)', async () => {
  const f = fixture(() => counted(0, 0));
  const r = await tool().handler({ locationId: 'L', workflowIds: ['a'], includeTriggerCounts: true }, f.deps);
  assert.deepEqual(r.data.triggerCounts, [{ workflowId: 'a', attempted: 0, matched: 0, unmatched: 0, neverMatches: false }]);
});

test('a failed count is nulls + error on that row, never zeros, and never fatal', async () => {
  const f = fixture(() => ({ status: 500, ok: false, json: {} }));
  const r = await tool().handler({ locationId: 'L', workflowIds: ['a'], includeTriggerCounts: true }, f.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.triggerCounts, [{ workflowId: 'a', attempted: null, matched: null, unmatched: null, neverMatches: false, error: { status: 500 } }]);
});

test('includeTriggerCounts with no workflowIds is an empty list, and the declared capabilities include the POST', async () => {
  const f = fixture(() => counted(1, 1));
  const r = await tool().handler({ locationId: 'L', workflowIds: [], includeTriggerCounts: true }, f.deps);
  assert.deepEqual(r.data.triggerCounts, []);
  assert.ok(tool().capabilities.some((c) => c.method === 'POST' && c.path === '/workflows/trigger/logs/count'));
});

// The guard that makes `includeTriggerCounts` REACHABLE. Every test above calls tool.handler()
// directly, which bypasses validateRegisteredArgs — so deleting the zod line would leave them all
// green while a real MCP caller got VALIDATION_FAILED. This is the only test that goes through
// registerTools, which is the path the server actually uses.
const viaRegistration = (name, deps) => {
  let wrapped;
  registerTools({ registerTool: (_n, _meta, fn) => { wrapped = fn; } }, deps, [tool()]);
  return async (args) => JSON.parse((await wrapped(args)).content[0].text);
};

test('includeTriggerCounts is a DECLARED argument — a real MCP caller can switch it on', async () => {
  const f = fixture(() => counted(5, 1));
  // This tool now declares a POST capability, so registerTools' location-binding guard treats it
  // as a write and needs the target location allowlisted — unrelated to the flag under test.
  f.deps.state.allowedLocations = new Set(['L']);
  const call = viaRegistration('get_account_workflow_overview', f.deps);
  const r = await call({ locationId: 'L', workflowIds: ['a'], includeTriggerCounts: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.triggerCounts, [{ workflowId: 'a', attempted: 5, matched: 1, unmatched: 4, neverMatches: false }]);
  // CONTROL: the unknown-key guard really is running on this path, so the pass above is the
  // schema declaring the key — not the guard being absent.
  const bad = await call({ locationId: 'L', workflowIds: ['a'], includeTriggerCountz: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'VALIDATION_FAILED');
});
