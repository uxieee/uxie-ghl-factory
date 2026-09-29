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

// wave26: triggerCountFilter — the Overview page's filter bar as ONE call (measured live 2026-09-29, GROM sandbox:
// knowledge sniffs/workflows-wave1-2026-09-25/live-W26-trigger-count-filters.json).
const NOW = Date.parse('2026-09-29T12:00:00Z');
const filtered = async (triggerCountFilter, countFor = () => counted(12, 1)) => {
  const f = fixture(countFor);
  const r = await tool().handler({ locationId: 'L', triggerCountFilter }, { ...f.deps, now: NOW });
  return { f, r, posts: f.calls.filter((c) => c.method === 'POST') };
};

test('triggerCountFilter sends ONE POST: filters combine, dates are epoch-ms STRINGS, and the array answer is read', async () => {
  const { r, posts } = await filtered({ workflowId: ['w1'], recordId: ['c1'], days: 25 }, () => counted(9, 1));
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { locationId: 'L', dateType: 'custom', fromDate: String(NOW - 25 * 86_400_000), toDate: String(NOW), workflowId: ['w1'], recordId: ['c1'] });
  assert.equal(typeof posts[0].body.fromDate, 'string', 'numeric dates got an empty answer from GHL');
  assert.deepEqual([r.data.triggerCountsFiltered.attempted, r.data.triggerCountsFiltered.matched, r.data.triggerCountsFiltered.unmatched], [9, 1, 8]);
  assert.deepEqual(r.data.triggerCountsFiltered.filters, { workflowId: ['w1'], recordId: ['c1'] });
});

test('triggerCountFilter defaults to 30 days and never sends the account-wide (unfiltered) count', async () => {
  const { posts } = await filtered({ triggerType: ['contact_tag'] });
  assert.equal(posts[0].body.fromDate, String(NOW - 30 * 86_400_000));
  const none = await filtered({});
  assert.equal(none.r.ok, false); assert.equal(none.r.code, 'VALIDATION_FAILED'); assert.equal(none.posts.length, 0);
});

test('CONTROL: entityId is refused BY NAME unless triggerType is form_submission / survey_submission — nothing is sent', async () => {
  for (const bad of [{ entityId: ['f1'] }, { entityId: ['f1'], triggerType: ['contact_tag'] }, { entityId: ['f1'], triggerType: ['form_submission', 'contact_tag'] }]) {
    const { r, posts } = await filtered(bad);
    assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal(r.code, 'VALIDATION_FAILED'); assert.match(r.error ?? r.message ?? JSON.stringify(r), /FORM or SURVEY id/); assert.equal(posts.length, 0);
  }
  const good = await filtered({ entityId: ['f1'], triggerType: ['form_submission', 'survey_submission'] });
  assert.equal(good.posts.length, 1); assert.deepEqual(good.posts[0].body.entityId, ['f1']);
});

test('CONTROL: a window beyond 31 days is refused BY NAME in the handler itself (no schema in the way), nothing sent', async () => {
  for (const days of [32, 40, 0, 1.5]) {
    const { r, posts } = await filtered({ triggerType: ['contact_tag'], days });
    assert.equal(r.ok, false, `days ${days}`); assert.equal(r.code, 'VALIDATION_FAILED'); assert.equal(posts.length, 0);
  }
});

test('a failed filtered count is nulls + error, never zeros', async () => {
  const failed = await filtered({ triggerType: ['contact_tag'] }, () => ({ status: 500, ok: false, json: {} }));
  assert.equal(failed.r.ok, true);
  assert.deepEqual([failed.r.data.triggerCountsFiltered.attempted, failed.r.data.triggerCountsFiltered.error], [null, { status: 500 }]);
});

test('through the real MCP server: the filter is declared, 31 days passes, 40 is refused, a misspelt filter key is refused', async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const f = fixture(() => counted(12, 1));
  f.deps.state.allowedLocations = new Set(['L']);
  const server = new McpServer({ name: 't', version: '0' }); const client = new Client({ name: 'c', version: '0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  registerTools(server, f.deps, [tool()]);
  await server.connect(st); await client.connect(ct);
  const run = async (triggerCountFilter) => {
    const res = await client.callTool({ name: 'get_account_workflow_overview', arguments: { locationId: 'L', triggerCountFilter } });
    const text = res.content?.[0]?.text ?? '';
    try { return { isError: res.isError === true, json: JSON.parse(text) }; } catch { return { isError: res.isError === true, json: null, text }; }
  };
  try {
    const good = await run({ triggerType: ['contact_tag'], days: 31 });
    assert.equal(good.isError, false, JSON.stringify(good).slice(0, 300));
    assert.equal(good.json.data.triggerCountsFiltered.attempted, 12);
    const over = await run({ triggerType: ['contact_tag'], days: 40 });
    assert.equal(over.isError, true, '40 days must be refused by the schema');
    const stray = await run({ triggerType: ['contact_tag'], contactId: 'c1' });
    assert.equal(stray.isError, true, 'a misspelt filter key must be refused, not dropped into a broader count');
    assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1, 'only the good call reached GHL');
  } finally { await client.close(); }
});

test('OFF by default: without triggerCountFilter there is no triggerCountsFiltered key and no POST (control)', async () => {
  const f = fixture(() => counted(1, 1));
  const r = await tool().handler({ locationId: 'L' }, f.deps);
  assert.equal('triggerCountsFiltered' in r.data, false); assert.equal(f.calls.some((c) => c.method === 'POST'), false);
});
