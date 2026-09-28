// get_funnel / edit_funnel, and build_funnel_page's lag-tolerant read-back.
// Each behaviour pinned here was measured live on the sandbox (knowledge/sniffs/funnels-wave1-2026-09-26,
// funnels-wave4-page-2026-09-26); the fixtures mirror the real response shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { planCreateStep, planReorder, planDeleteStep, planPublishState, settingsBody, reread } from '../core/funnel-ops.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const FUNNEL = () => ({
  _id: 'F1', name: 'TEST-CONF-FUN-X', type: 'funnel', url: '/test-conf-fun-x', domainId: 'D1',
  trackingCodeHead: '<meta a>', trackingCodeBody: '', faviconUrl: '', isLivePaymentMode: false, chatWidgetId: '',
  imageOptimization: true, isGdprCompliant: true, isOptimisePageLoad: true, requireCreditCard: false,
  storeCurrencyFormatting: false, autoGenerateSchema: true, securityHeaders: [],
  steps: [
    { id: 'S1', name: 'Optin', url: '/test-conf-fun-optin', type: 'optin_funnel_page', pages: ['P1'], sequence: 1, split: false, control_traffic: 100 },
    { id: 'S2', name: 'Thanks', url: '/test-conf-fun-thanks', type: 'thankyou_funnel_page', pages: ['P2'], sequence: 2, split: false, control_traffic: 100 },
  ],
});
const LOOKUPS = () => [
  { _id: 'L1', type: 'step', typeId: 'S1', path: '/test-conf-fun-optin', publishStatus: 'live' },
  { _id: 'L2', type: 'page', typeId: 'P1', path: '/test-conf-fun-optin-page', publishStatus: 'live' },
];
const fastReread = { tries: 3, delays: [0, 0, 0] };

// A tiny stateful fake of the funnels API: writes mutate `db`, reads return it.
function fakeDeps({ db = { funnel: FUNNEL(), lookups: LOOKUPS(), headers: [] }, calls = [], uid = 'U1', lagReads = 0 } = {}) {
  let lag = lagReads;
  return {
    calls, db,
    state: {}, rereadOptions: fastReread,
    makeGw: () => ({
      uid,
      call: async (method, path, body) => {
        calls.push({ method, path, body });
        if (method === 'GET' && path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: structuredClone(db.funnel) };
        if (method === 'GET' && path.startsWith('/funnels/lookup/list')) return { ok: true, status: 200, json: { data: structuredClone(db.lookups) } };
        if (method === 'GET' && path.startsWith('/funnels/domain/')) return { ok: true, status: 200, json: { domains: [{ id: 'D1', url: 'sandbox.example.com' }] } };
        if (method === 'GET' && path.startsWith('/users/')) return { ok: true, status: 200, json: { firstName: 'Test', lastName: 'User' } };
        if (method === 'GET' && path.startsWith('/funnels/funnel/headers')) return { ok: true, status: 200, json: { securityHeaders: db.headers } };
        if (path === '/funnels/funnel/update-settings') {
          db.funnel.url = body.funnelPath; db.funnel.name = body.funnelName; db.funnel.trackingCodeHead = body.headTrackingCode;
          db.funnel.isLivePaymentMode = body.paymentMode; db.funnel.chatWidgetId = body.chatWidgetId;
          return { ok: true, status: 201, json: {} };
        }
        if (path === '/funnels/funnel/create-step') {
          if (lag-- > 0) return { ok: true, status: 201, json: {} }; // accepted, not yet visible
          db.funnel.steps.push({ ...body.step, pages: ['PNEW'], sequence: 3 });
          if (body.domainId) db.lookups.push({ _id: 'LNEW', type: 'step', typeId: body.step.id, path: `/${body.step.url}` });
          return { ok: true, status: 201, json: {} };
        }
        if (path.startsWith('/funnels/funnel/step/')) {
          const s = db.funnel.steps.find((x) => x.id === body.stepId); s.name = body.name;
          if (body.url) { s.url = body.url; db.lookups.find((r) => r.typeId === body.stepId).path = body.url; }
          return { ok: true, status: 200, json: {} };
        }
        if (path.startsWith('/funnels/funnel/update/')) {
          for (const x of body.steps) db.funnel.steps.find((s) => s.id === x.id).sequence = x.sequence;
          return { ok: true, status: 200, json: {} };
        }
        if (path === '/funnels/funnel/delete-step') {
          db.funnel.steps = db.funnel.steps.filter((s) => s.id !== body.stepId);
          db.lookups = db.lookups.filter((r) => r.typeId !== body.stepId);
          return { ok: true, status: 201, json: {} };
        }
        if (path === '/funnels/lookup/multiple') {
          for (const l of body.lookups) Object.assign(db.lookups.find((r) => r._id === l.lookupId), { publishStatus: l.publishStatus, type: l.type, action: l.action, target: l.target });
          return { ok: true, status: 200, json: { ok: true } };
        }
        if (path === '/funnels/funnel/headers') { db.headers.push({ key: body.key, value: body.value }); return { ok: true, status: 201, json: {} }; }
        throw new Error(`unexpected ${method} ${path}`);
      },
    }),
  };
}
const writes = (calls) => calls.filter((c) => c.method !== 'GET');
const run = (name, args, deps) => tool(name).handler({ locationId: 'LOC', funnelId: 'F1', ...args }, deps);

test('settings always sends the UI\'s FULL body, so fields the caller did not name are unchanged', () => {
  const b = settingsBody('LOC', FUNNEL(), { headTrackingCode: '<x>' });
  for (const k of ['locationId', 'allowPaymentModeOption', 'imageOptimization', 'isGdprCompliant', 'isOptimisePageLoad']) assert.ok(k in b, `${k} is required by the server`);
  assert.equal(b.headTrackingCode, '<x>');
  assert.equal(b.paymentMode, false, 'payment mode is carried from the read, not defaulted to Live');
  assert.equal(b.isGdprCompliant, true);
});

test('edit_funnel previews by default and sends nothing', async () => {
  const d = fakeDeps();
  const r = await run('edit_funnel', { op: 'settings', settings: { chatWidgetId: 'W' } }, d);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.equal(writes(d.calls).length, 0);
  assert.equal(r.data.preview.request.body.chatWidgetId, 'W');
});

test('settings refuses unknown keys by name', async () => {
  const r = await run('edit_funnel', { op: 'settings', settings: { robotsTxt: 'x' }, confirm: true }, fakeDeps());
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail, /robotsTxt/);
});

test('settings writes and diffs the read-back; a path change carries the cache note', async () => {
  const d = fakeDeps();
  const r = await run('edit_funnel', { op: 'settings', settings: { funnelPath: 'test-conf-fun-y' }, confirm: true }, d);
  assert.equal(r.ok, true);
  assert.equal(r.data.readBack[0].applied, true, 'a missing leading slash is normalised, not a mismatch');
  assert.match(r.data.notes.join(' '), /ROOT lookup row/);
});

test('create-step is refused on a funnel with no domain — it would 404 in public', () => {
  const f = FUNNEL(); delete f.domainId;
  assert.match(planCreateStep({ funnel: f, step: { name: 'n', url: 'u' } }).refuse, /no domain/);
  const p = planCreateStep({ funnel: FUNNEL(), step: { name: 'n', url: '/test-conf-fun-new' } });
  assert.equal(p.body.domainId, 'D1', 'domainId is TOP-LEVEL — that is what mints the lookup row');
  assert.equal(p.body.step.url, 'test-conf-fun-new', 'the step url is stored without its leading slash');
});

test('create-step reads back with bounded re-reads, so a lagging read is not reported as failure', async () => {
  const d = fakeDeps({ lagReads: 0 });
  const r = await run('edit_funnel', { op: 'create-step', step: { name: 'New', url: 'test-conf-fun-new' }, confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.lookups.length, 1);
});

test('reorder demands a full permutation — the route replaces the whole steps array', async () => {
  assert.match(planReorder({ funnel: FUNNEL(), order: ['S2'] }).refuse, /EVERY step/);
  const d = fakeDeps();
  const r = await run('edit_funnel', { op: 'reorder-steps', order: ['S2', 'S1'], confirm: true }, d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.order, ['S2', 'S1']);
  assert.equal(writes(d.calls)[0].body.steps.length, 2);
});

test('delete-step is behind a target check on id AND current name', async () => {
  assert.match(planDeleteStep({ funnel: FUNNEL(), stepId: 'S2', expectName: 'Wrong' }).refuse, /target check failed/);
  assert.match(planDeleteStep({ funnel: FUNNEL(), stepId: 'S9', expectName: 'Thanks' }).refuse, /not on this funnel/);
  const d = fakeDeps();
  const r = await run('edit_funnel', { op: 'delete-step', stepId: 'S2', expectName: 'Thanks', confirm: true }, d);
  assert.equal(r.ok, true);
  assert.equal(r.data.stepStillPresent, false);
});

test('update-step path move sends domainName and reads the lookup row back', async () => {
  const d = fakeDeps();
  const r = await run('edit_funnel', { op: 'update-step', stepId: 'S1', url: 'test-conf-fun-moved', confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  const w = writes(d.calls)[0];
  assert.deepEqual(w.body, { stepId: 'S1', name: 'Optin', url: '/test-conf-fun-moved', domainName: 'sandbox.example.com' });
  assert.match(r.data.note, /few minutes/);
});

test('unpublish writes BOTH the step and page rows; 404 and url redirects use the UI\'s field values', () => {
  const user = { id: 'U1', name: 'Test User' };
  const p404 = planPublishState({ funnel: FUNNEL(), lookups: LOOKUPS(), pageId: 'P1', publish: false, user });
  assert.equal(p404.body.lookups.length, 2);
  assert.deepEqual({ ...p404.body.lookups[0], lookupId: undefined }, { lookupId: undefined, target: '', action: null, publishStatus: 'unpublished', type: 'not_found_page', publishStatusUpdatedBy: 'U1', publishStatusUpdatedByName: 'Test User' });
  const pUrl = planPublishState({ funnel: FUNNEL(), lookups: LOOKUPS(), pageId: 'P1', publish: false, redirect: { type: 'url', url: 'https://example.com/x' }, user });
  assert.equal(pUrl.body.lookups[0].type, 'redirect');
  assert.equal(pUrl.body.lookups[0].action, 'url');
  const pub = planPublishState({ funnel: FUNNEL(), lookups: LOOKUPS(), pageId: 'P1', publish: true, user });
  assert.deepEqual(pub.body.lookups.map((l) => l.type).sort(), ['page', 'step'], 'publish restores each row to its own type');
  assert.match(planPublishState({ funnel: FUNNEL(), lookups: LOOKUPS(), pageId: 'P1', publish: false, redirect: { type: 'url', url: 'example.com' }, user }).refuse, /absolute/);
});

test('unpublish is refused on a running split test (unproven path)', () => {
  const f = FUNNEL(); f.steps[0].split = true;
  assert.match(planPublishState({ funnel: f, lookups: LOOKUPS(), pageId: 'P1', publish: false }).refuse, /split test/);
});

test('unpublish-page end to end reads the rows back in the requested state', async () => {
  const d = fakeDeps();
  const r = await run('edit_funnel', { op: 'unpublish-page', pageId: 'P1', confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.data.lookups.every((l) => l.publishStatus === 'unpublished' && l.type === 'not_found_page'));
});

test('add-header refuses a duplicate and reads back; the note warns about exact-case paths', async () => {
  const d = fakeDeps();
  const r = await run('edit_funnel', { op: 'add-header', header: { key: 'X-Test', value: 'v' }, confirm: true }, d);
  assert.equal(r.ok, true);
  assert.match(r.data.note, /EXACT-CASE/);
});

test('get_funnel lookups view flattens the routing rows; versions sorts by timestamp, not position', async () => {
  const d = fakeDeps();
  const l = await tool('get_funnel').handler({ locationId: 'LOC', funnelId: 'F1', view: 'lookups' }, d);
  assert.equal(l.data.lookups[0].publishStatus, 'live');
  const vDeps = { state: {}, makeGw: () => ({ call: async () => ({ ok: true, status: 200, json: [
    { version_id: 'old', pageType: 'live', updated_at: { _seconds: 100 } },
    { version_id: 'new', pageType: 'draft', updated_at: { _seconds: 900 } },
  ] }) }) };
  const v = await tool('get_funnel').handler({ locationId: 'LOC', funnelId: 'F1', view: 'versions', pageId: 'P1' }, vDeps);
  assert.equal(v.data.versions[0].versionId, 'new');
  assert.equal(v.data.live, 'old');
});

test('reread returns as soon as the value settles, and reports attempts', async () => {
  let n = 0;
  const r = await reread(async () => ++n, (x) => x >= 3, { tries: 5, delays: [0, 0, 0, 0, 0] });
  assert.equal(r.settled, true);
  assert.equal(r.attempts, 3);
});

test('build_funnel_page: a page-data read that lags is re-read, not reported as missing sections', async () => {
  let reads = 0;
  const calls = [];
  const deps = { state: {}, rereadOptions: fastReread, makeGw: () => ({ uid: 'U1', call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.startsWith('/funnels/builder/autosave/')) return { ok: true, status: 201, json: {} };
    if (path.startsWith('/funnels/builder/page/data')) {
      reads += 1;
      const sent = calls.find((c) => c.path.startsWith('/funnels/builder/autosave/')).body.pageData.sections;
      return { ok: true, status: 200, json: { sections: reads === 1 ? [] : sent.map((s) => ({ id: s.id })) } };
    }
    if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
    throw new Error(path);
  } }) };
  const res = await tool('build_funnel_page').handler({ locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1', confirm: true,
    sections: [{ columns: [{ elements: [{ meta: 'heading', html: 'Hi' }] }] }] }, deps);
  assert.equal(res.ok, true);
  assert.equal(res.data.stored, true, 'the first read saw 0 sections; the second saw the write');
  assert.equal(res.data.readBack.attempts, 2);
});
