// create_funnel folderId (parentId) and find_ghl_site folders / folderId. Shapes measured on the sandbox, knowledge
// sniffs/funnels-wave45-f8-2026-09-30: `category=all` returns the folders as rows {category:'folder', type} of the tab; a document filed in a
// folder carries `parentId`; the Websites tab and the Funnels tab do not share folders; POST /funnels/funnel/create takes `parentId`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { planCreateFunnel, listFolders } from '../core/funnel-create.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const fast = { tries: 3, delays: [0, 0, 0] };
const FOLDERS = [{ _id: 'FF1', name: 'Funnel folder', type: 'funnel', category: 'folder' }, { _id: 'WF1', name: 'Web folder', type: 'website', category: 'folder' }];
const DOCS = [{ _id: 'D1', name: 'In folder', type: 'funnel', parentId: 'FF1', steps: [] }, { _id: 'D2', name: 'Loose', type: 'funnel', steps: [] }, { _id: 'D3', name: 'Site', type: 'website', parentId: 'WF1', steps: [] }];

function deps(extra = []) {
  const calls = []; let doc = null;
  return { calls, state: {}, rereadOptions: fast, makeGw: () => ({ uid: 'U', call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.startsWith('/funnels/funnel/list')) {
      const u = new URL(`https://x${path}`); const t = u.searchParams.get('type'); const all = u.searchParams.get('category') === 'all';
      const rows = [...DOCS, ...extra, ...(doc ? [doc] : [])];
      const list = t ? [...(all ? FOLDERS.filter((f) => f.type === t) : []), ...rows.filter((r) => r.type === t)] : rows;
      return { ok: true, status: 200, json: { funnels: list, count: list.length } };
    }
    if (path === '/funnels/funnel/create') { doc = { _id: 'NEW', name: body.name, type: body.type, parentId: body.parentId, steps: [] }; return { ok: true, status: 201, json: { ok: true, id: 'NEW' } }; }
    if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { data: structuredClone(doc) } };
    throw new Error(`unexpected ${method} ${path}`);
  } }) };
}
const cf = (args, d) => tool('create_funnel').handler({ locationId: 'LOC', ...args }, d);
const writes = (c) => c.filter((x) => x.method !== 'GET');

test('planCreateFunnel adds parentId for a funnel or website and refuses folderId for the other kinds', () => {
  assert.deepEqual(planCreateFunnel({ kind: 'funnel', name: 'A', locationId: 'L', folderId: 'FF1' }).body, { locationId: 'L', name: 'A', type: 'funnel', parentId: 'FF1' });
  assert.equal(planCreateFunnel({ kind: 'funnel', name: 'A', locationId: 'L' }).body.parentId, undefined, 'no folder, no key');
  for (const kind of ['store', 'webinar', 'blog']) assert.match(planCreateFunnel({ kind, name: 'A', locationId: 'L', folderId: 'FF1' }).refuse, /folder scoping .* not measured/);
});

test('listFolders returns only the tab\'s own folders', async () => {
  const gw = deps().makeGw();
  assert.deepEqual((await listFolders(gw, 'L', 'funnel')).rows, [{ id: 'FF1', name: 'Funnel folder', type: 'funnel' }]);
  assert.deepEqual((await listFolders(gw, 'L', 'website')).rows, [{ id: 'WF1', name: 'Web folder', type: 'website' }]);
});

test('create_funnel into a folder: previews the parentId, verifies it on the read-back; a wrong-tab or unknown folder is refused before any write', async () => {
  const d = deps();
  const p = await cf({ kind: 'funnel', name: 'Fresh', folderId: 'FF1' }, d);
  assert.equal(p.code, 'CONFIRM_REQUIRED');
  assert.equal(p.data.preview.request.body.parentId, 'FF1');
  assert.equal(writes(d.calls).length, 0);
  const r = await cf({ kind: 'funnel', name: 'Fresh', folderId: 'FF1', confirm: true }, d);
  assert.equal(r.ok, true);
  assert.equal(r.data.readBack.folderId, 'FF1');
  assert.equal(r.data.readBack.folder, 'Funnel folder');
  for (const bad of [{ kind: 'website', folderId: 'FF1' }, { kind: 'funnel', folderId: 'WF1' }, { kind: 'funnel', folderId: 'NOPE' }]) {
    const d2 = deps();
    const x = await cf({ ...bad, name: 'Other', confirm: true }, d2);
    assert.equal(x.ok, false);
    assert.match(x.detail, /is not a (funnel|website) folder/);
    assert.equal(writes(d2.calls).length, 0);
  }
});

test('create_funnel fails the verification when the document did not land in the folder', async () => {
  const d = deps();
  const gw = d.makeGw;
  d.makeGw = () => { const g = gw(); return { ...g, call: async (m, p, b) => (p === '/funnels/funnel/create' ? g.call(m, p, { ...b, parentId: undefined }) : g.call(m, p, b)) }; };
  const r = await cf({ kind: 'funnel', name: 'Fresh', folderId: 'FF1', confirm: true }, d);
  assert.equal(r.ok, false);
  assert.match(r.detail, /did not read back as created/);
});

const fs = (args, d) => tool('find_ghl_site').handler({ locationId: 'LOC', list: true, ...args }, d);

test('find_ghl_site list folders:true returns the folders of both tabs with their document counts; folderId scopes the documents', async () => {
  const r = await fs({ folders: true }, deps());
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.folders.map((f) => [f.id, f.type, f.documents]), [['FF1', 'funnel', 1], ['WF1', 'website', 1]]);
  const s = await fs({ folderId: 'FF1' }, deps());
  assert.deepEqual(s.data.documents.map((x) => x.id), ['D1']);
  assert.equal(s.data.documents[0].folderId, 'FF1');
  const none = await fs({ folderId: 'NOPE' }, deps());
  assert.match(none.data.warning, /not a folder/);
  assert.equal((await fs({}, deps())).data.folders, undefined, 'no folders key unless asked');
});

test('find_ghl_site route resolves the owner of one exact URL and reports an absent route as found:false, not an error', async () => {
  const rows = { '/f10': { _id: 'R1', domain: 'd.example.com', funnelId: 'FN', path: '/f10', type: 'page', typeId: 'PG', publishStatus: 'live', action: null, target: '' },
    '/redir': { _id: 'R2', domain: 'd.example.com', funnelId: 'FN', path: '/redir', type: 'step', typeId: 'ST', publishStatus: 'unpublished', action: 'funnel', target: 'ST2' } };
  const calls = [];
  const d = { state: {}, makeGw: () => ({ call: async (m, p) => {
    calls.push(p);
    if (p.startsWith('/funnels/lookup/domain-and-path')) { const u = new URL(`https://x${p}`); const row = rows[u.searchParams.get('path')]; return row ? { ok: true, status: 200, json: { data: row } } : { ok: false, status: 404, json: { message: 'Lookup does not exist' } }; }
    if (p.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { data: { name: 'My funnel', type: 'funnel', steps: [{ id: 'ST', name: 'Step one', pages: ['PG'] }] } } };
    throw new Error(`unexpected ${p}`);
  } }) };
  const h = tool('find_ghl_site').handler;
  const a = await h({ locationId: 'LOC', route: { domain: 'https://d.example.com/', path: 'f10' } }, d);
  assert.equal(a.ok, true);
  assert.match(calls[0], /domain=d\.example\.com&path=%2Ff10/, 'scheme stripped, leading slash added');
  assert.deepEqual([a.data.found, a.data.route.type, a.data.route.publishStatus, a.data.owner.funnel, a.data.owner.step.name, a.data.owner.pageId], [true, 'page', 'live', 'My funnel', 'Step one', 'PG']);
  const b = await h({ locationId: 'LOC', route: { domain: 'd.example.com', path: '/redir' } }, d);
  assert.deepEqual([b.data.route.action, b.data.route.target, b.data.route.publishStatus], ['funnel', 'ST2', 'unpublished']);
  const c = await h({ locationId: 'LOC', route: { domain: 'd.example.com', path: '/nope' } }, d);
  assert.deepEqual([c.ok, c.data.found], [true, false]);
});

test('find_ghl_site countdownTimers lists the assets (deleted ones out) and countdownTimerId reads one; a missing one is found:false', async () => {
  const T = [{ _id: 'T1', name: 'Sale', templateId: 'simple', timerType: 'fixed', status: 'draft', endDate: '2026-01-01T00:00:00.000Z', timezone: 'UTC', deleted: false },
    { _id: 'T2', name: 'Loop', timerType: 'recurring', deleted: false }, { _id: 'T3', name: 'Gone', deleted: true }];
  const d = { state: {}, nowMs: () => Date.parse('2026-09-30T00:00:00Z'), makeGw: () => ({ call: async (m, p) => {
    if (p.startsWith('/countdown-timer/?')) return { ok: true, status: 200, json: { countdownTimers: T, total: [{ total: 3 }] } };
    const id = p.split('/').pop(); const t = T.find((x) => x._id === id);
    return t ? { ok: true, status: 200, json: { ...t, designMeta: { counterFontSize: 50 } } } : { ok: false, status: 404, json: {} };
  } }) };
  const h = tool('find_ghl_site').handler;
  const l = await h({ locationId: 'LOC', countdownTimers: true }, d);
  assert.deepEqual(l.data.timers.map((t) => [t.id, t.expired]), [['T1', true], ['T2', undefined]]);
  assert.equal(l.data.total, 3, 'the aggregate row [{total}] is unwrapped');
  const one = await h({ locationId: 'LOC', countdownTimerId: 'T1' }, d);
  assert.deepEqual([one.data.found, one.data.timer.name, one.data.timer.design.counterFontSize], [true, 'Sale', 50]);
  assert.equal((await h({ locationId: 'LOC', countdownTimerId: 'NOPE' }, d)).data.found, false);
});
