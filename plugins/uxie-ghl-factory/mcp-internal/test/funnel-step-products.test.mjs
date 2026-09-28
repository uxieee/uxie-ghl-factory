// edit_funnel add-step-product and get_funnel view step-products. The create body is the one the step's Products tab
// sends (captured live, knowledge sniffs/funnels-wave15-actions-2026-09-29); the list read returns product and price
// POPULATED, the create returns them as bare ids — the fake mirrors both shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { planAddStepProduct, stepProductView } from '../core/funnel-ops.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const run = (n, args, deps) => tool(n).handler({ locationId: 'LOC', funnelId: 'F1', ...args }, deps);
const FUNNEL = () => ({ _id: 'F1', name: 'TEST-CONF-FUN-SRC', type: 'funnel', domainId: 'D1',
  steps: [{ id: 'S1', name: 'Order', url: '/order', type: 'optin_funnel_page', pages: ['P1'], sequence: 1 }] });
const PRODUCT = { _id: 'PR1', name: 'Widget' };
const PRICES = [{ _id: 'PC1', name: 'One-off', amount: 1, currency: 'USD', type: 'one_time', product: 'PR1' }];

function fakeDeps({ existing = [], dropOnWrite = false } = {}) {
  const db = { rows: structuredClone(existing) };
  const calls = [];
  return {
    db, calls, state: {}, rereadOptions: { tries: 2, delays: [0, 0] },
    makeGw: () => ({
      uid: 'U1',
      call: async (method, path, body) => {
        calls.push({ method, path, body });
        const j = (json, status = 200) => ({ ok: status < 300, status, json });
        if (method === 'GET' && path.startsWith('/funnels/funnel/fetch/')) return j(FUNNEL());
        if (method === 'GET' && /^\/products\/PR1\/price\?/.test(path)) return j({ prices: structuredClone(PRICES), total: 1 });
        if (method === 'GET' && /^\/products\/PR1\?/.test(path)) return j(structuredClone(PRODUCT));
        if (method === 'GET' && path.startsWith('/funnels/order-form/products/?')) return j({ products: structuredClone(db.rows) });
        if (method === 'POST' && path === '/funnels/order-form/products') {
          const row = { _id: 'SP1', ...body, deleted: false };
          if (!dropOnWrite) db.rows.push({ ...row, product: { ...PRODUCT }, price: { ...PRICES[0] } });
          return j(row, 201);
        }
        return j({ message: `unexpected ${method} ${path}` }, 404);
      },
    }),
  };
}

test('plan: the body is the Products tab\'s own, with the product name and safe defaults', () => {
  const p = planAddStepProduct({ funnel: FUNNEL(), stepId: 'S1', expectName: 'Order', product: PRODUCT, prices: PRICES, existing: [], priceId: 'PC1', locationId: 'LOC' });
  assert.deepEqual(p.body, { locationId: 'LOC', funnel: 'F1', step: 'S1', name: 'Widget', displayText: '', product: 'PR1', price: 'PC1',
    bumpProduct: false, quantity: { max: 1, allowMultiple: false }, authorizeAmount: 0 });
  assert.equal(p.path, '/funnels/order-form/products');
});

test('plan refuses: wrong step name, a price of another product, an identical product+price already on the step', () => {
  const base = { funnel: FUNNEL(), stepId: 'S1', product: PRODUCT, prices: PRICES, existing: [], priceId: 'PC1', locationId: 'LOC' };
  assert.match(planAddStepProduct({ ...base, expectName: 'Thanks' }).refuse, /target check failed/);
  assert.match(planAddStepProduct({ ...base, expectName: 'Order', priceId: 'OTHER' }).refuse, /is not a price of product "Widget"/);
  const dup = [{ _id: 'SP0', product: { _id: 'PR1' }, price: { _id: 'PC1' }, deleted: false }];
  assert.match(planAddStepProduct({ ...base, expectName: 'Order', existing: dup }).refuse, /already lists "Widget"/);
  // control: a DELETED row is not a duplicate
  assert.ok(!planAddStepProduct({ ...base, expectName: 'Order', existing: [{ ...dup[0], deleted: true }] }).refuse);
});

test('preview sends nothing; confirm writes once and reads the step product back by product AND price', async () => {
  const d = fakeDeps();
  const pre = await run('edit_funnel', { op: 'add-step-product', stepId: 'S1', expectName: 'Order', productId: 'PR1', priceId: 'PC1' }, d);
  assert.equal(pre.code, 'CONFIRM_REQUIRED');
  assert.equal(d.calls.filter((c) => c.method !== 'GET').length, 0);
  const r = await run('edit_funnel', { op: 'add-step-product', stepId: 'S1', expectName: 'Order', productId: 'PR1', priceId: 'PC1', confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.stepProductId, 'SP1');
  assert.equal(r.data.readBack.product.name, 'Widget');
  assert.equal(r.data.readBack.price.amount, 1);
  assert.equal(d.calls.filter((c) => c.method === 'POST').length, 1);
});

test('a 201 that never shows on the step is VERIFY_FAILED, not success', async () => {
  const d = fakeDeps({ dropOnWrite: true });
  const r = await run('edit_funnel', { op: 'add-step-product', stepId: 'S1', expectName: 'Order', productId: 'PR1', priceId: 'PC1', confirm: true }, d);
  assert.equal(r.code, 'VERIFY_FAILED');
});

test('get_funnel view step-products lists names beside ids; needs stepId', async () => {
  const d = fakeDeps({ existing: [{ _id: 'SP9', name: 'Widget', product: { ...PRODUCT }, price: { ...PRICES[0] }, quantity: { max: 1, allowMultiple: false }, bumpProduct: false }] });
  const r = await run('get_funnel', { view: 'step-products', stepId: 'S1' }, d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.stepProducts[0].product, { id: 'PR1', name: 'Widget' });
  assert.equal((await run('get_funnel', { view: 'step-products' }, d)).code, 'VALIDATION_FAILED');
  // a by-id row carries bare ids: the view still names the ids
  assert.deepEqual(stepProductView({ _id: 'X', product: 'PR1', price: 'PC1' }).price, { id: 'PC1' });
});
