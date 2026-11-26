// Shapes: the listing {items, folders, total, totalAgents, totalFolders, page, pageSize, hasMore} and a folder's members {agents[], total, page, pageSize, hasMore, traceId}, both as committed (live reads, 2026-09-28). Ids are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentStudioFolders, FOLDERS_FENCES } from '../../skills/create-ghl-workflow/scripts/agent-studio-folders-read.mjs';
const LOC = 'locAAAAAAAAAAAAAAAAA';
const env = (over = {}) => ({ items: [{ id: 'agent-0001' }, { id: 'agent-0002' }], folders: [{ id: 'fold-0001' }], total: 3, totalAgents: 3, totalFolders: 1, page: 1, pageSize: 100, hasMore: false, ...over });
const make = (pages, members = { 'fold-0001': [{ id: 'agent-0003' }] }, over = {}) => ({
  locationId: LOC, judged: ['agent-0001', 'agent-0002', 'agent-0003'],
  get: async (path) => {
    const f = /folderId=([A-Za-z0-9_-]+)&page=(\d+)/.exec(path);
    if (f) { const rows = members[f[1]]; if (!rows) return { ok: false, status: 404 }; const pg = Number(f[2]), slice = rows.slice((pg - 1) * 2, pg * 2); return { ok: true, json: { agents: slice, total: rows.length, page: pg, pageSize: 25, hasMore: pg * 2 < rows.length, traceId: 'trace-0001' } }; }
    const m = /page=(\d+)/.exec(path);
    if (m) return pages[Number(m[1]) - 1] ?? { ok: false, status: 404 };
    return { ok: false, status: 404 };
  }, ...over,
});
test('clean: id union of items and folder members = totalAgents = the judged set', async () => {
  const r = await agentStudioFolders(make([{ ok: true, json: env() }]));
  assert.equal(r.ok, true); assert.equal(r.blocks, false); assert.equal(r.unionIds, 3); assert.equal(r.folders, 1);
});
test('every page is walked to hasMore === false', async () => {
  const p1 = { ok: true, json: env({ items: [{ id: 'agent-0001' }], hasMore: true }) }, p2 = { ok: true, json: env({ items: [{ id: 'agent-0002' }], page: 2, hasMore: false }) };
  assert.equal((await agentStudioFolders(make([p1, p2]))).ok, true);
});
test('block: missing or non-boolean hasMore, wrong page, non-integer totals, missing arrays', async () => {
  for (const over of [{ hasMore: undefined }, { hasMore: 'false' }, { page: 2 }, { totalAgents: '3' }, { totalFolders: undefined }, { items: undefined }, { folders: undefined }]) assert.equal((await agentStudioFolders(make([{ ok: true, json: env(over) }]))).blocks, true, JSON.stringify(Object.keys(over)));
  assert.equal((await agentStudioFolders(make([{ ok: false, status: 500 }]))).blocks, true);
});
test('block: a repeated page never ends (cap), totals that move, ids that are unreadable', async () => {
  const loop = { locationId: LOC, judged: ['agent-0001', 'agent-0002', 'agent-0003'], get: async (path) => ({ ok: true, json: env({ hasMore: true, page: Number(/page=(\d+)/.exec(path)[1]) }) }) };
  assert.match((await agentStudioFolders(loop)).reason, /page cap/);
  const moved = [{ ok: true, json: env({ hasMore: true }) }, { ok: true, json: env({ page: 2, totalAgents: 4 }) }];
  assert.match((await agentStudioFolders(make(moved))).reason, /totals moved/);
  assert.equal((await agentStudioFolders(make([{ ok: true, json: env({ items: [{ id: 5 }] }) }]))).blocks, true);
});
test('block: a folder whose members are unreadable or in a different envelope; folders read differ from totalFolders', async () => {
  assert.equal((await agentStudioFolders(make([{ ok: true, json: env() }], {}))).blocks, true);
  const odd = make([{ ok: true, json: env() }]); const g = odd.get; odd.get = async (p) => (/folderId=/.test(p) ? { ok: true, json: { items: [{ id: 'agent-0003' }], total: 1, page: 1, hasMore: false } } : g(p));
  assert.equal((await agentStudioFolders(odd)).blocks, true, '{items} members envelope blocks');
  assert.match((await agentStudioFolders(make([{ ok: true, json: env({ totalFolders: 2 }) }]))).reason, /differ from totalFolders/);
});
test('block: the union is not exactly totalAgents, or not exactly the judged set', async () => {
  assert.match((await agentStudioFolders(make([{ ok: true, json: env({ totalAgents: 4 }) }]))).reason, /differs from totalAgents/);
  const short = make([{ ok: true, json: env() }]); short.judged = ['agent-0001', 'agent-0002'];
  assert.match((await agentStudioFolders(short)).reason, /not judged/);
  const extra = make([{ ok: true, json: env() }]); extra.judged = ['agent-0001', 'agent-0002', 'agent-0003', 'agent-0009'];
  assert.match((await agentStudioFolders(extra)).reason, /judged but not listed/);
  const dup = make([{ ok: true, json: env() }]); dup.judged = ['agent-0001', 'agent-0001'];
  assert.equal((await agentStudioFolders(dup)).blocks, true);
});
test('fence: only the two read routes; a write verb or another path is refused before any call', async () => {
  const [a, b] = FOLDERS_FENCES(LOC);
  assert.ok(a.test(`/agent-studio/agents/agents-with-folders?locationId=${LOC}&productId=superagent&page=1&pageSize=100`) && b.test(`/agent-studio/super-agent/agents?locationId=${LOC}&folderId=fold-0001&page=1&pageSize=25`));
  for (const p of [`/agent-studio/super-agent/agents/agent-0001?locationId=${LOC}`, `/agent-studio/agents/agents-with-folders?locationId=${LOC}&productId=superagent&page=1&pageSize=7`, '/contacts/abcdef12']) assert.ok(!a.test(p) && !b.test(p), p);
  assert.ok(!a.test(`/agent-studio/agents/agents-with-folders?locationId=otherLocAAAAAAAAAAAA&productId=superagent&page=1&pageSize=100`), 'the fence is built for ONE location');
});
test('folder members are paged: two pages are read, a short total or a missing hasMore blocks', async () => {
  const three = { 'fold-0001': [{ id: 'agent-0003' }, { id: 'agent-0004' }, { id: 'agent-0005' }] };
  const r = await agentStudioFolders({ ...make([{ ok: true, json: env({ totalAgents: 5 }) }], three), judged: ['agent-0001', 'agent-0002', 'agent-0003', 'agent-0004', 'agent-0005'] });
  assert.equal(r.ok, true); assert.equal(r.unionIds, 5);
  const base = make([{ ok: true, json: env() }]), g = base.get;
  base.get = async (p) => { const x = await g(p); return /folderId=/.test(p) && x.ok ? { ok: true, json: { ...x.json, total: 2 } } : x; };
  assert.match((await agentStudioFolders(base)).reason, /total 2 differs/);
  const noMore = make([{ ok: true, json: env() }]), g2 = noMore.get;
  noMore.get = async (p) => { const x = await g2(p); if (/folderId=/.test(p) && x.ok) delete x.json.hasMore; return x; };
  assert.equal((await agentStudioFolders(noMore)).blocks, true);
  const stuck = make([{ ok: true, json: env() }]); stuck.get = async (p) => (/folderId=/.test(p) ? { ok: true, json: { agents: [{ id: 'agent-0003' }], total: 1, page: Number(/page=(\d+)/.exec(p)[1]), pageSize: 25, hasMore: true } } : { ok: true, json: env() });
  assert.match((await agentStudioFolders(stuck)).reason, /members page cap/);
});
test('inputs: a locationId that is not 20 alphanumerics or a pageSize off the list is refused before any call', async () => {
  let calls = 0; const get = async () => { calls += 1; return { ok: false }; };
  for (const bad of ['a.b', 'loc', `${LOC}x`, '.'.repeat(20), undefined]) assert.equal((await agentStudioFolders({ get, locationId: bad, judged: [] })).blocks, true);
  assert.equal((await agentStudioFolders({ get, locationId: LOC, judged: [], pageSize: 7 })).blocks, true);
  assert.equal(calls, 0); assert.throws(() => FOLDERS_FENCES('a.b'));
});
test('a failed read names its http status and closed code in the reason; free text never appears', async () => {
  let r = await agentStudioFolders(make([{ ok: false, status: 401, code: 'TOKEN_EXPIRED' }]));
  assert.equal(r.blocks, true); assert.match(r.reason, /read failed, http 401, code TOKEN_EXPIRED/);
  r = await agentStudioFolders(make([{ ok: false, status: 500, code: 'Server said: bob@example.com 5551234567' }]));
  assert.match(r.reason, /read failed, http 500\)/); assert.ok(!/bob|5551234567|Server said/.test(r.reason));
  r = await agentStudioFolders(make([{ ok: true, json: env({ hasMore: 'false' }) }]));
  assert.ok(!/read failed/.test(r.reason), 'a changed shape is not reported as a failed read');
  r = await agentStudioFolders(make([{ ok: true, json: env() }], {}, {}));
  assert.match(r.reason, /folder members page 1 is not.*read failed, http 404\)/);
});
