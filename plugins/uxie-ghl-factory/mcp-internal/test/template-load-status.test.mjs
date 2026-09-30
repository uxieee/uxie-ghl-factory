// create_funnel store / webinar: a template load answers 201 whatever its progress; only data.status 'completed' is an install
// (the New store screen's own rule — funnels bundle: processing / partial-completed show data.err and do not open the store).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { templateLoadOutcome, STORE_BLANK_STEP_COUNT } from '../core/funnel-create.mjs';

const cf = (args, d) => TOOLS.find((t) => t.name === 'create_funnel').handler({ locationId: 'LOC', ...args }, d);
const step = (i) => ({ id: `S${i}`, name: `Step ${i}`, type: 'store', url: `/s${i}`, pages: [] });

// A stateful fake: the load answers `loadJson`; the document then reads back with `stepsAt(readNo)` steps.
function deps(loadJson, stepsAt) {
  const calls = []; let doc = null; let reads = 0;
  return { calls, state: {}, rereadOptions: { tries: 3, delays: [0, 0, 0] }, makeGw: () => ({ uid: 'U', call: async (m, p, b) => {
    calls.push({ m, p, b });
    if (p.startsWith('/funnels/funnel/list')) return { ok: true, status: 200, json: { funnels: doc ? [doc] : [], count: doc ? 1 : 0 } };
    if (p === '/templates/template/load') { doc = { _id: 'ST1', name: b.extras.name, type: 'website', isStoreActive: true, steps: [] }; return { ok: true, status: 201, json: loadJson }; }
    if (p.startsWith('/funnels/funnel/fetch/')) {
      const n = stepsAt(reads++);
      return { ok: true, status: 200, json: { data: { ...structuredClone(doc), steps: Array.from({ length: n }, (_, i) => step(i)) } } };
    }
    throw new Error(`unexpected ${m} ${p}`);
  } }) };
}
const load = (status, extra = {}) => ({ status: 'ok', data: { status, target: { asset: 'funnels', assetId: 'ST1', pageId: 'P1' }, ...extra } });

test('templateLoadOutcome: only "completed" is complete; err is carried; a missing status is not complete', () => {
  assert.deepEqual(templateLoadOutcome(load('completed')), { status: 'completed', complete: true, err: null });
  assert.deepEqual(templateLoadOutcome(load('partial-completed', { err: 'assets failed' })), { status: 'partial-completed', complete: false, err: 'assets failed' });
  assert.equal(templateLoadOutcome({}).complete, false);
  assert.equal(templateLoadOutcome(load('error')).complete, false);
});

test('create_funnel store: completed + all steps → ok, and the load status is reported', async () => {
  const r = await cf({ kind: 'store', name: 'S', confirm: true }, deps(load('completed'), () => STORE_BLANK_STEP_COUNT));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.templateLoad.status, 'completed');
});

test('create_funnel store: partial-completed is a VERIFY_FAILED that names the status and err, never a success', async () => {
  const r = await cf({ kind: 'store', name: 'S', confirm: true }, deps(load('partial-completed', { err: 'some pages failed' }), () => 3));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VERIFY_FAILED');
  assert.match(r.detail, /partial-completed/);
  assert.match(r.detail, /some pages failed/);
  assert.match(r.detail, /3 step\(s\) read back/);
  assert.equal(r.data.funnelId, 'ST1');
});

test('create_funnel store: processing that settles to a whole store is ok; one that never settles is not', async () => {
  const settles = await cf({ kind: 'store', name: 'S', confirm: true }, deps(load('processing'), (n) => (n < 3 ? 2 : STORE_BLANK_STEP_COUNT)));
  assert.equal(settles.ok, true, JSON.stringify(settles));
  assert.equal(settles.data.templateLoad.settled, true);
  const stuck = await cf({ kind: 'store', name: 'S', confirm: true }, deps(load('processing'), () => 2));
  assert.equal(stuck.code, 'VERIFY_FAILED');
  assert.match(stuck.detail, /'processing'/);
});

test('create_funnel store: a completed answer with too few steps read back is still refused', async () => {
  const r = await cf({ kind: 'store', name: 'S', confirm: true }, deps(load('completed'), () => 4));
  assert.equal(r.code, 'VERIFY_FAILED');
  assert.match(r.detail, /4 of the 7 steps/);
});

// ── remove a store: Sites → Stores → Delete sends /funnels/funnel/delete-store, which removes the STORE STEPS and keeps the document (live, wave46) ──
import { planDeleteFunnel, planDeleteStore } from '../core/funnel-ops.mjs';
const SD = { _id: 'S1', name: 'TEST-CONF-STORE', type: 'website', isStoreActive: true, steps: [
  { id: 'a', name: 'Cart', type: 'store', url: '/cart' }, { id: 'b', name: 'Home', type: 'optin_funnel_page', url: '/home' }, { id: 'c', name: 'PDP', type: 'optin_funnel_page', key: 'store-custom-product-detail', url: '/pdp' }] };

test('planDeleteStore: the modal\'s body; says which steps go and which stay; refuses a wrong name, a non-store, no user id', () => {
  const p = planDeleteStore({ funnel: SD, expectName: 'TEST-CONF-STORE', locationId: 'L', userId: 'U' });
  assert.equal(p.path, '/funnels/funnel/delete-store');
  assert.deepEqual(p.body, { funnelId: 'S1', locationId: 'L', userId: 'U' });
  assert.deepEqual(p.target.removes.map((x) => x.id), ['a']);
  assert.deepEqual(p.target.keeps.map((x) => x.id), ['b', 'c']);
  assert.match(planDeleteStore({ funnel: SD, expectName: 'other', locationId: 'L', userId: 'U' }).refuse, /target check/);
  assert.match(planDeleteStore({ funnel: { ...SD, isStoreActive: false }, expectName: 'TEST-CONF-STORE', locationId: 'L', userId: 'U' }).refuse, /no store/);
  assert.match(planDeleteStore({ funnel: SD, expectName: 'TEST-CONF-STORE', locationId: 'L' }).refuse, /no user id/);
  // deleting the DOCUMENT is still /funnel/delete, store or not
  assert.equal(planDeleteFunnel({ funnel: SD, lookups: [], expectName: 'TEST-CONF-STORE', locationId: 'L', userId: 'U' }).path, '/funnels/funnel/delete');
});

test('edit_funnel delete-store: verifies isStoreActive false + no store steps + every other step kept; reports the document stayed', async () => {
  let done = false;
  const deps = { state: {}, rereadOptions: { tries: 2, delays: [0, 0] }, makeGw: () => ({ uid: 'U', call: async (m, p, b) => {
    if (p.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { data: done ? { ...SD, isStoreActive: false, steps: SD.steps.filter((x) => x.type !== 'store') } : SD } };
    if (p === '/funnels/funnel/delete-store') { done = true; return { ok: true, status: 201, json: {} }; }
    if (p.startsWith('/funnels/lookup/list')) return { ok: true, status: 200, json: { lookups: [] } };
    throw new Error(`unexpected ${m} ${p}`);
  } }) };
  const ef = (a) => TOOLS.find((t) => t.name === 'edit_funnel').handler({ locationId: 'LOC', funnelId: 'S1', op: 'delete-store', expectName: 'TEST-CONF-STORE', ...a }, deps);
  assert.equal((await ef({})).code, 'CONFIRM_REQUIRED');
  assert.equal(done, false);
  const r = await ef({ confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.remaining.map((x) => x.id), ['b', 'c']);
  assert.match(r.data.note, /NOT deleted/);
});

test('get_funnel store-setup: reads the location checklist for a store, refuses a non-store', async () => {
  const mk = (isStoreActive) => ({ state: {}, makeGw: () => ({ uid: 'U', call: async (m, p) => {
    if (p.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { data: { _id: 'S1', name: 'Shop', type: 'website', isStoreActive, steps: [] } } };
    if (p.startsWith('/store/setup/progress?altId=LOC&altType=location')) return { ok: true, status: 200, json: { data: { stores: true, connectedDomains: true, products: false, paymentProviders: true, shipping: false, orders: false }, status: true } };
    throw new Error(`unexpected ${m} ${p}`);
  } }) });
  const gf = (d) => TOOLS.find((t) => t.name === 'get_funnel').handler({ locationId: 'LOC', funnelId: 'S1', view: 'store-setup' }, d);
  const r = await gf(mk(true));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.todo, ['products', 'shipping', 'orders']);
  assert.equal(r.data.scope, 'location');
  assert.equal((await gf(mk(false))).code, 'VALIDATION_FAILED');
});

// ── custom product details page (live-ui-cap.store-pdp-page.BLOCKED.json) ──
import { planAddProductPage } from '../core/funnel-ops.mjs';
const STORE = { _id: 'S1', name: 'Shop', type: 'website', isStoreActive: true, steps: [{ id: 'a', name: 'Cart', url: '/cart' }] };
const P1 = [{ id: 'PR1', name: 'Widget' }];

test('planAddProductPage: the modal\'s body — path without its slash, key store-custom-product-detail, products — and its refusals', () => {
  const p = planAddProductPage({ funnel: STORE, locationId: 'L', name: 'PDP', url: '/my-pdp', products: P1 });
  assert.equal(p.path, '/funnels/funnel/create-custom-product-detail-page');
  assert.deepEqual(Object.keys(p.body).sort(), ['funnelId', 'locationId', 'step']);
  assert.deepEqual({ ...p.body.step, id: 'X' }, { id: 'X', name: 'PDP', url: 'my-pdp', pages: [], type: 'optin_funnel_page', split: false, control_traffic: 100, products: ['PR1'], key: 'store-custom-product-detail' });
  assert.equal(p.stepId, p.body.step.id);
  const bad = (o) => planAddProductPage({ funnel: STORE, locationId: 'L', name: 'PDP', url: 'x', products: P1, ...o }).refuse;
  assert.match(bad({ funnel: { ...STORE, type: 'funnel' } }), /website STORE/);
  assert.match(bad({ funnel: { ...STORE, isStoreActive: false } }), /website with no store/);
  assert.match(bad({ products: [] }), /at least one product/);
  assert.match(bad({ products: [...P1, ...P1] }), /twice/);
  assert.match(bad({ url: '/cart' }), /already the path of step "Cart"/);
  assert.match(bad({ url: '/a/product/b' }), /reserved/);
  assert.match(bad({ name: ' ' }), /needs a name/);
});

test('edit_funnel add-product-page: reads each product, sends the body, verifies key + products + a page of store-pdp-v2 blocks', async () => {
  let step = null; const calls = [];
  const deps = { state: {}, rereadOptions: { tries: 2, delays: [0, 0] }, makeGw: () => ({ uid: 'U', call: async (m, p, b) => {
    calls.push({ m, p, b });
    if (p.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { data: { ...STORE, steps: [...STORE.steps, ...(step ? [step] : [])] } } };
    if (p.startsWith('/products/PR1')) return { ok: true, status: 200, json: { name: 'Widget' } };
    if (p === '/funnels/funnel/create-custom-product-detail-page') { step = { ...b.step, pages: ['PG1'], sequence: 8 }; return { ok: true, status: 201, json: { pageDetails: { _id: 'PG1' } } }; }
    if (p.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: { sections: [{ elements: [{ meta: 'store-pdp-v2-title' }, { meta: 'store-pdp-v2-price' }, { meta: 'paragraph' }] }] } };
    if (p.startsWith('/funnels/lookup/list')) return { ok: true, status: 200, json: { lookups: [] } };
    throw new Error(`unexpected ${m} ${p}`);
  } }) };
  const ef = (a) => TOOLS.find((t) => t.name === 'edit_funnel').handler({ locationId: 'LOC', funnelId: 'S1', op: 'add-product-page', name: 'PDP', url: 'my-pdp', productIds: ['PR1'], ...a }, deps);
  const pre = await ef({});
  assert.equal(pre.code, 'CONFIRM_REQUIRED');
  assert.equal(calls.filter((c) => c.m === 'POST').length, 0, 'the preview sent nothing');
  const r = await ef({ confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.key, r.data.pdpBlocks], ['store-custom-product-detail', ['store-pdp-v2-title', 'store-pdp-v2-price']]);
});
