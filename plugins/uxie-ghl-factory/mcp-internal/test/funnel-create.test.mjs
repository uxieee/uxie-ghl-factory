// create_funnel, edit_funnel delete-funnel / split-test / update-step page rename, and the
// find_ghl_site walk. Bodies and responses mirror the sandbox captures in
// knowledge/sniffs/funnels-wave1-2026-09-26 and funnels-wave10-e-plan-2026-09-28.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { planCreateFunnel, createdId, listAllDocuments, BLANK_TEMPLATES, webinarStartUtc } from '../core/funnel-create.mjs';
import { planDeleteFunnel, planSplit, splitStamp } from '../core/funnel-ops.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const fast = { tries: 3, delays: [0, 0, 0] };

// ── the list walk ──────────────────────────────────────────────────────────────────────────────
const DOCS = Array.from({ length: 7 }, (_, i) => ({ _id: `F${i}`, name: `Doc ${i}`, type: i === 6 ? 'blog' : 'funnel', steps: [] }));
const pagedList = (docs, calls = []) => ({ call: async (m, p) => {
  calls.push(p);
  const u = new URL(`https://x${p}`);
  const limit = Number(u.searchParams.get('limit')), offset = Number(u.searchParams.get('offset'));
  return { ok: true, status: 200, json: { funnels: docs.slice(offset, offset + limit), count: docs.length } };
} });

test('listAllDocuments walks offset pages until it holds `count` distinct documents', async () => {
  const calls = [];
  const got = await listAllDocuments(pagedList(DOCS, calls), 'LOC', { pageSize: 3 });
  assert.equal(got.rows.length, 7);
  assert.equal(got.count, 7);
  assert.equal(calls.length, 3, 'three pages of 3/3/1, then stop on count');
  assert.match(calls[2], /offset=6/);
});

test('listAllDocuments stops on a page that adds nothing (a server ignoring offset is not walked forever)', async () => {
  const calls = [];
  const same = { call: async (m, p) => { calls.push(p); return { ok: true, status: 200, json: { funnels: DOCS.slice(0, 2) } }; } };
  const got = await listAllDocuments(same, 'LOC', { pageSize: 2 });
  assert.equal(got.rows.length, 2);
  assert.equal(calls.length, 2);
});

test('find_ghl_site resolves a document past the first page (the old single limit=100 call missed it)', async () => {
  const many = Array.from({ length: 130 }, (_, i) => ({ _id: `F${i}`, name: `Site ${i}`, url: `/site-${i}` }));
  const deps = { state: {}, makeGw: () => ({ call: async (m, p) => (p.startsWith('/vibe-ai') ? { ok: true, status: 200, json: [] } : pagedList(many).call(m, p)) }) };
  const r = await tool('find_ghl_site').handler({ locationId: 'L1', site: 'Site 125' }, deps);
  assert.equal(r.ok, true);
  assert.equal(r.data.surface, 'funnel', 'document 126 of 130 is found');
});

test('find_ghl_site list:true returns every document, filtered by type and name', async () => {
  const docs = [...DOCS, { _id: 'S1', name: 'Shop', type: 'website', isStoreActive: true, steps: [{}, {}] }];
  const deps = { state: {}, makeGw: () => pagedList(docs) };
  const all = await tool('find_ghl_site').handler({ locationId: 'L1', list: true }, deps);
  assert.equal(all.data.returned, 8);
  const stores = await tool('find_ghl_site').handler({ locationId: 'L1', list: true, type: 'store' }, deps);
  assert.deepEqual(stores.data.documents.map((d) => d.id), ['S1']);
  const q = await tool('find_ghl_site').handler({ locationId: 'L1', list: true, search: 'doc 6' }, deps);
  assert.deepEqual(q.data.documents.map((d) => d.type), ['blog']);
  const bad = await tool('find_ghl_site').handler({ locationId: 'L1' }, deps);
  assert.equal(bad.code, 'VALIDATION_FAILED', 'site is required unless list:true');
});

// ── create_funnel ──────────────────────────────────────────────────────────────────────────────
test('planCreateFunnel sends each kind exactly as its New screen does', () => {
  assert.deepEqual(planCreateFunnel({ kind: 'funnel', name: ' A ', locationId: 'L' }).body, { locationId: 'L', name: 'A', type: 'funnel' });
  assert.equal(planCreateFunnel({ kind: 'website', name: 'A', locationId: 'L' }).body.type, 'website');
  assert.deepEqual(planCreateFunnel({ kind: 'blog', name: 'B', locationId: 'L', description: 'd' }), { method: 'POST', path: '/blogs/site', body: { locationId: 'L', title: 'B', description: 'd' } });
  const st = planCreateFunnel({ kind: 'store', name: 'S', locationId: 'L' });
  assert.deepEqual(st.body, { templateId: BLANK_TEMPLATES.store, locationId: 'L', product: 'stores', extras: { name: 'S' } });
  const w = { timezone: 'Asia/Manila', date: '2026-10-01T10:00:00+08:00', startTime: '10:00', endTime: '11:00', formId: 'FORM1' };
  const wb = planCreateFunnel({ kind: 'webinar', name: 'W', locationId: 'L', companyId: 'C', webinar: w, formName: 'Reg' });
  assert.equal(wb.body.templateId, BLANK_TEMPLATES.webinar);
  assert.equal(wb.body.subProduct, 'live');
  assert.deepEqual([wb.body.extras.webinarProperties.endDate, wb.body.extras.webinarProperties.endTime, wb.body.extras.webinarProperties.webinarEndTime], ['2026-10-01T02:00:00Z', '10:00', '11:00'],
    'the wizard stores the START as endDate/endTime and the END as webinarEndTime; endDate is that start in UTC');
  assert.match(planCreateFunnel({ kind: 'webinar', name: 'W', locationId: 'L', companyId: 'C', webinar: { ...w, formId: '' } }).refuse, /formId/);
  assert.match(planCreateFunnel({ kind: 'webinar', name: 'W', locationId: 'L', companyId: 'C', webinar: { ...w, startTime: '9am' } }).refuse, /HH:mm/);
  assert.match(planCreateFunnel({ kind: 'nope', name: 'x' }).refuse, /kind/);
});

test('createdId reads each route\'s own response shape', () => {
  assert.equal(createdId('funnel', { ok: true, id: 'F9' }), 'F9');
  assert.equal(createdId('store', { status: 'ok', data: { status: 'completed', target: { asset: 'funnels', assetId: 'S9' } } }), 'S9');
  assert.equal(createdId('blog', {}), null);
});

function createDeps({ existing = [], created = null, forms = { FORM1: 'Reg' }, sessionStart = null } = {}) {
  const calls = [];
  let doc = null;
  return {
    calls, state: {}, rereadOptions: fast,
    makeGw: () => ({ uid: 'U1', call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.startsWith('/funnels/funnel/list')) return { ok: true, status: 200, json: { funnels: [...existing, ...(doc ? [doc] : [])], count: existing.length + (doc ? 1 : 0) } };
      if (path.startsWith('/forms/')) { const id = path.split('/')[2]; return forms[id] ? { ok: true, status: 200, json: { form: { name: forms[id] } } } : { ok: false, status: 401, json: { message: 'Access Forbidden' } }; }
      if (path.startsWith('/locations/')) return { ok: true, status: 200, json: { location: { companyId: 'C1' }, companyId: 'C1' } };
      if (path === '/funnels/funnel/create') { doc = { _id: 'NEW', name: body.name, type: body.type, steps: [] }; return { ok: true, status: 201, json: { ok: true, id: 'NEW', name: body.name } }; }
      if (path === '/funnels/funnel/webinar/sessions') { const e = sessionStart ?? doc?.endDate; return { ok: true, status: 201, json: { webinarSessions: e ? [{ sessionStart: new Date(Date.parse(e)).toISOString(), sessionEnd: null, timezone: doc?.tz }] : [] } }; }
      if (path === '/templates/template/load') { doc = { endDate: body.extras.webinarProperties?.endDate, tz: body.extras.webinarProperties?.timezone, _id: 'NEW', name: body.extras.name, type: body.product === 'stores' ? 'website' : 'webinar', isStoreActive: body.product === 'stores', steps: [{ id: 's', name: 'x', pages: ['p'] }] }; return { ok: true, status: 201, json: { status: 'ok', data: { status: 'completed', target: { asset: 'funnels', assetId: 'NEW' } } } }; }
      if (path === '/blogs/site') { doc = { _id: 'NEWB', name: body.title, type: 'blog', steps: [] }; return { ok: true, status: 201, json: {} }; }
      if (path.startsWith('/funnels/funnel/blog/list/')) return { ok: true, status: 200, json: { data: doc ? [doc] : [] } };
      if (path.startsWith('/funnels/funnel/fetch/')) return doc && path.includes(doc._id) ? { ok: true, status: 200, json: structuredClone(created ?? doc) } : { ok: false, status: 400, json: { message: 'Funnel does not exist or is deleted' } };
      throw new Error(`unexpected ${method} ${path}`);
    } }),
  };
}
const cf = (args, deps) => tool('create_funnel').handler({ locationId: 'LOC', ...args }, deps);
const writes = (calls) => calls.filter((c) => c.method !== 'GET');

test('create_funnel previews by default and refuses a name already on the location (any kind, any case)', async () => {
  const d = createDeps({ existing: [{ _id: 'B', name: 'My Blog', type: 'blog' }] });
  const p = await cf({ kind: 'funnel', name: 'New One' }, d);
  assert.equal(p.code, 'CONFIRM_REQUIRED');
  assert.equal(writes(d.calls).length, 0);
  const clash = await cf({ kind: 'funnel', name: 'my blog', confirm: true }, d);
  assert.equal(clash.code, 'VALIDATION_FAILED');
  assert.equal(clash.data.existing[0].type, 'blog');
  assert.equal(writes(d.calls).length, 0);
});

test('create_funnel creates each kind and verifies it on a separate read', async () => {
  for (const kind of ['funnel', 'website', 'store', 'blog']) {
    const d = createDeps();
    const r = await cf({ kind, name: `TEST ${kind}`, confirm: true }, d);
    assert.equal(r.ok, true, `${kind}: ${r.detail}`);
    assert.equal(r.data.readBack.name, `TEST ${kind}`);
    if (kind === 'store') { assert.equal(r.data.readBack.store, true); assert.match(r.data.note, /Contact Us/); }
    if (kind === 'blog') assert.equal(r.data.blogList.id, 'NEWB');
  }
  const w = { timezone: 'Asia/Manila', date: '2026-10-01T10:00:00+08:00', startTime: '10:00', endTime: '11:00', formId: 'FORM1' };
  const d = createDeps();
  const r = await cf({ kind: 'webinar', name: 'TEST web', webinar: w, confirm: true }, d);
  assert.equal(r.ok, true, r.detail);
  assert.equal(writes(d.calls)[0].body.extras.webinarProperties.formName, 'Reg', 'the form name is read from the form, not trusted from the caller');
  const foreign = await cf({ kind: 'webinar', name: 'TEST web2', webinar: { ...w, formId: 'OTHER' }, confirm: true }, createDeps());
  assert.equal(foreign.code, 'VALIDATION_FAILED', 'a form that does not read on this location is refused before any write');
});

test('create_funnel fails loudly when the document reads back as the wrong type', async () => {
  const d = createDeps({ created: { _id: 'NEW', name: 'TEST x', type: 'website', steps: [] } });
  const r = await cf({ kind: 'funnel', name: 'TEST x', confirm: true }, d);
  assert.equal(r.code, 'VERIFY_FAILED');
});

// ── delete-funnel ──────────────────────────────────────────────────────────────────────────────
const F = () => ({ _id: 'F1', name: 'TEST-CONF-FUN-DEL', type: 'funnel', steps: [{ id: 'S1', name: 'A', pages: ['P1'] }] });

test('planDeleteFunnel: target check on name, refuses while a page still serves, names the paths', () => {
  assert.match(planDeleteFunnel({ funnel: F(), lookups: [], expectName: 'other', locationId: 'L', userId: 'U' }).refuse, /target check/);
  const live = planDeleteFunnel({ funnel: F(), lookups: [{ type: 'step', path: '/a', domain: 'd.example.com', publishStatus: null }], expectName: 'TEST-CONF-FUN-DEL', locationId: 'L', userId: 'U' });
  assert.match(live.refuse, /d\.example\.com\/a/, 'publishStatus null still serves (measured: a fresh step answers 200)');
  const done = planDeleteFunnel({ funnel: F(), lookups: [{ type: 'not_found_page', path: '/a', publishStatus: 'unpublished' }], expectName: 'TEST-CONF-FUN-DEL', locationId: 'L', userId: 'U' });
  assert.deepEqual(done.body, { funnelId: 'F1', locationId: 'L', userId: 'U' });
});

function editDeps({ funnel = F(), lookups = [] } = {}) {
  const calls = []; const db = { funnel, lookups, deleted: false, pages: { P1: { name: 'A' } } };
  return {
    calls, db, state: {}, rereadOptions: fast,
    makeGw: () => ({ uid: 'U1', call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.startsWith('/funnels/funnel/fetch/')) return db.deleted ? { ok: false, status: 400, json: { message: 'Funnel does not exist or is deleted' } } : { ok: true, status: 200, json: structuredClone(db.funnel) };
      if (path.startsWith('/funnels/lookup/list')) return { ok: true, status: 200, json: { data: structuredClone(db.lookups) } };
      if (path.startsWith('/funnels/domain/')) return { ok: true, status: 200, json: { domains: [{ id: 'D1', url: 'sandbox.example.com' }] } };
      if (path === '/funnels/funnel/delete') { db.deleted = true; return { ok: true, status: 201, json: { domains: [], paths: [] } }; }
      if (path === '/funnels/lookup/exists') return { ok: true, status: 201, json: { exists: db.lookups.some((r) => r.path === body.path) } };
      if (path === '/funnels/funnel/clone-control-page/') return { ok: true, status: 201, json: { pageId: 'PV' } };
      if (path === '/funnels/lookup/create') { db.lookups.push({ _id: 'LV', type: 'page', typeId: body.typeId, path: body.path }); return { ok: true, status: 201, json: {} }; }
      if (path === '/funnels/funnel/update-funnel-and-page') { Object.assign(db.funnel.steps[0], { pages: body.funnelStepDetails.pages, split: false }); db.lookups = db.lookups.filter((r) => r.typeId !== body.archivePageId); return { ok: true, status: 201, json: { ok: true } }; }
      if (path.startsWith('/funnels/funnel/step/')) { const s = db.funnel.steps.find((x) => x.id === body.stepId); if (body.pages) s.pages = body.pages; if ('split' in body) { s.split = body.split; s.controlTraffic = body.control_traffic; } if (body.name) s.name = body.name; return { ok: true, status: 200, json: { ok: true } }; }
      if (path.startsWith('/funnels/funnel/funnel-page/')) { db.pages[path.split('/').pop()].name = body.name; return { ok: true, status: 201, json: {} }; }
      if (path.startsWith('/funnels/page/')) { const id = path.split('/')[3].split('?')[0]; return { ok: true, status: 200, json: { _id: id, ...db.pages[id] } }; }
      throw new Error(`unexpected ${method} ${path}`);
    } }),
  };
}
const ef = (args, deps) => tool('edit_funnel').handler({ locationId: 'LOC', funnelId: 'F1', ...args }, deps);

test('edit_funnel delete-funnel deletes after the target check and proves it gone', async () => {
  const d = editDeps();
  const pre = await ef({ op: 'delete-funnel', expectName: 'TEST-CONF-FUN-DEL' }, d);
  assert.equal(pre.code, 'CONFIRM_REQUIRED');
  const r = await ef({ op: 'delete-funnel', expectName: 'TEST-CONF-FUN-DEL', confirm: true }, d);
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.data.readBack.fetchStatus, 400);
  const live = editDeps({ lookups: [{ _id: 'L1', type: 'page', typeId: 'P1', path: '/a', publishStatus: 'live' }] });
  const refused = await ef({ op: 'delete-funnel', expectName: 'TEST-CONF-FUN-DEL', confirm: true }, live);
  assert.equal(refused.code, 'VALIDATION_FAILED');
  assert.equal(writes(live.calls).length, 0);
});

// ── split-test ─────────────────────────────────────────────────────────────────────────────────
test('planSplit: add-variation needs a free path; start needs two pages; declare-winner archives the other', () => {
  const funnel = F();
  assert.match(planSplit({ funnel, stepId: 'S1', action: 'add-variation', domainName: 'd', locationId: 'L' }).refuse, /variationPath/);
  assert.match(planSplit({ funnel, stepId: 'S1', action: 'start', controlTraffic: 50 }).refuse, /add-variation first/);
  const two = F(); two.steps[0].pages = ['P1', 'PV'];
  const st = planSplit({ funnel: two, stepId: 'S1', action: 'start', controlTraffic: 30, now: new Date(2026, 8, 28, 20, 55, 19) });
  assert.deepEqual({ ...st.body, split_started_at: undefined }, { stepId: 'S1', split: true, control_traffic: 30, split_started_at: undefined, split_ended_at: null, route_all_requests: true, additional_routes: [] });
  assert.match(st.body.split_started_at, /^September 28, 2026 at 8:55:19 PM UTC[+-]\d\d:\d\d$/, 'the UI\'s display string');
  const dw = planSplit({ funnel: two, stepId: 'S1', action: 'declare-winner', winnerPageId: 'PV', locationId: 'L' });
  assert.equal(dw.body.archivePageId, 'P1');
  assert.deepEqual(dw.body.funnelStepDetails.pages, ['PV']);
  assert.match(planSplit({ funnel: two, stepId: 'S1', action: 'declare-winner', winnerPageId: 'X' }).refuse, /one of this step/);
});

test('edit_funnel split-test runs the three add-variation calls with the clone\'s id, then declare-winner', async () => {
  const d = editDeps({ funnel: { ...F(), domainId: 'D1' } });
  const taken = await ef({ op: 'split-test', stepId: 'S1', action: 'add-variation', variationPath: '/a', confirm: true },
    editDeps({ funnel: { ...F(), domainId: 'D1' }, lookups: [{ _id: 'L1', type: 'step', typeId: 'S1', path: '/a' }] }));
  assert.equal(taken.code, 'VALIDATION_FAILED', 'a taken path is refused before anything is written');
  const r = await ef({ op: 'split-test', stepId: 'S1', action: 'add-variation', variationPath: 'a-var', confirm: true }, d);
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(writes(d.calls).map((c) => c.path), ['/funnels/lookup/exists', '/funnels/funnel/clone-control-page/', '/funnels/funnel/step/F1', '/funnels/lookup/create']);
  assert.deepEqual(d.db.funnel.steps[0].pages, ['P1', 'PV']);
  assert.equal(writes(d.calls)[3].body.typeId, 'PV');
  const s = await ef({ op: 'split-test', stepId: 'S1', action: 'start', controlTraffic: 50, confirm: true }, d);
  assert.equal(s.ok, true, s.detail);
  const w = await ef({ op: 'split-test', stepId: 'S1', action: 'declare-winner', winnerPageId: 'P1', confirm: true }, d);
  assert.equal(w.ok, true, w.detail);
  assert.deepEqual(d.db.funnel.steps[0].pages, ['P1']);
});

test('update-step renames the page record too, as the UI does, and verifies it', async () => {
  const d = editDeps();
  const r = await ef({ op: 'update-step', stepId: 'S1', name: 'B', confirm: true }, d);
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(r.data.pageRecord, { pageId: 'P1', name: 'B', matches: true });
  assert.ok(d.calls.some((c) => c.path === '/funnels/funnel/funnel-page/P1' && c.body.name === 'B'));
});

test('splitStamp is the UI\'s display format', () => {
  assert.match(splitStamp(new Date(2026, 0, 2, 0, 5, 9)), /^January 2, 2026 at 12:05:09 AM UTC[+-]\d\d:\d\d$/);
});

test('declare-winner tolerates the archived page\'s lookup row lingering for one read (measured live)', async () => {
  const two = F(); two.steps[0].pages = ['P1', 'PV']; two.steps[0].split = true;
  const d = editDeps({ funnel: two, lookups: [{ _id: 'LV', type: 'page', typeId: 'PV', path: '/v', publishStatus: 'live' }] });
  const inner = d.makeGw;
  let lingering = 0;
  d.makeGw = (...a) => { const g = inner(...a); return { ...g, call: async (m, p, b) => {
    if (p === '/funnels/funnel/update-funnel-and-page') { Object.assign(d.db.funnel.steps[0], { pages: b.funnelStepDetails.pages, split: false }); lingering = 1; return { ok: true, status: 201, json: { ok: true } }; }
    if (p.startsWith('/funnels/lookup/list') && lingering) { if (lingering-- === 0) d.db.lookups = []; const r = await g.call(m, p, b); if (lingering === 0) d.db.lookups = []; return r; }
    return g.call(m, p, b);
  } }; };
  const w = await ef({ op: 'split-test', stepId: 'S1', action: 'declare-winner', winnerPageId: 'P1', confirm: true }, d);
  assert.equal(w.ok, true, w.detail);
  assert.equal(w.data.archivedPageLookupLeft, false);
});

// Rule 47 (knowledge funnels/40-rules/silent-failures.md): GHL's one-off wizard stores the start with the BROWSER's
// offset, so a Manila machine creating "10:00 New York" got a 02:00Z session. The tool converts in webinar.timezone.
test('webinar start: the calendar day + startTime are converted in webinar.timezone, whatever the caller\'s offset', () => {
  const ny = { timezone: 'America/New_York', startTime: '10:00' };
  assert.equal(webinarStartUtc({ ...ny, date: '2026-10-01' }).utc, '2026-10-01T14:00:00Z', 'EDT: UTC-4');
  assert.equal(webinarStartUtc({ ...ny, date: '2026-12-01' }).utc, '2026-12-01T15:00:00Z', 'EST: UTC-5');
  assert.equal(webinarStartUtc({ ...ny, date: '2026-10-01T10:00:00-04:00' }).utc, '2026-10-01T14:00:00Z', 'an instant whose offset agrees is accepted');
  // control: the exact shape GHL's wizard sends from a UTC+8 browser is refused, naming the day to send instead
  assert.match(webinarStartUtc({ ...ny, date: '2026-10-01T10:00:00+08:00' }).refuse, /disagrees with the webinar timezone.*"2026-10-01"/);
  assert.equal(webinarStartUtc({ timezone: 'Asia/Manila', startTime: '10:00', date: '2026-10-01' }).utc, '2026-10-01T02:00:00Z');
  assert.match(webinarStartUtc({ ...ny, date: '2027-03-14', startTime: '02:30' }).refuse, /daylight-saving gap/);
  assert.match(webinarStartUtc({ ...ny, timezone: 'Nope/X', date: '2026-10-01' }).refuse, /IANA/);
  assert.match(webinarStartUtc({ ...ny, date: 'Oct 1' }).refuse, /YYYY-MM-DD/);
});

test('create_funnel webinar: sends the UTC start, reads the SESSION back, and fails loudly when it runs at another time', async () => {
  const w = { timezone: 'America/New_York', date: '2026-10-01', startTime: '10:00', endTime: '11:00', formId: 'FORM1' };
  const d = createDeps();
  const r = await cf({ kind: 'webinar', name: 'TEST ny', webinar: w, confirm: true }, d);
  assert.equal(r.ok, true, r.detail);
  assert.equal(writes(d.calls)[0].body.extras.webinarProperties.endDate, '2026-10-01T14:00:00Z');
  assert.equal(r.data.sessions[0].start, '2026-10-01T14:00:00.000Z');
  const shifted = await cf({ kind: 'webinar', name: 'TEST ny2', webinar: w, confirm: true }, createDeps({ sessionStart: '2026-10-01T02:00:00Z' }));
  assert.equal(shifted.code, 'VERIFY_FAILED', 'a session at another instant is not success');
  assert.equal(shifted.data.sessionStart.sent, '2026-10-01T14:00:00Z');
});
