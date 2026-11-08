// fn-3 (2026-11-08): the order-form composer, measured against a GHL-built order-form node (fn1-order-form-node.json, the probe page
// TEST-CONF-FN1, GROM Sandbox, read-only). The composer used to refuse order-form (bl-841: a composed one answered 500 and its
// props were empty strings). Now: the composer writes the GHL shapes (KIND_FACTORY_EXTRA, the node-level keys, the GHL steps
// value), a caller's empty strings never override them, and a step must carry a step product (the zero-amount TEST price).
// The GHL capture is read from the knowledge sniffs when present; ids are templated before comparison. A RED run fails
// at HEAD: the composer refuses order-form, and caller empties win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../core/tools.mjs';
import { makeLeaf, refusedKindProblems } from '../core/funnel-pages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(HERE, '../../../../../knowledge/sniffs/funnels-fn-2026-11-08/fn1-order-form-node.json');
const haveCapture = existsSync(CAPTURE);
const ghl = haveCapture ? JSON.parse(readFileSync(CAPTURE, 'utf8')).orderFormNodes[0] : null;

// Template the ids that differ per node: step ids, field ids are stable; node ids are per element.
const templ = (v) => JSON.parse(JSON.stringify(v).replace(/"step-[A-Za-z0-9_-]+"/g, '"step-<ID>"').replace(/"corder-form-[A-Za-z0-9_-]+"/g, '"corder-form-<ID>"').replace(/"order-form-[A-Za-z0-9_-]+"/g, '"order-form-<ID>"'));
const NODE_LEVEL = ['nodeId', 'visibility', 'customClass', 'termsAndConditions', 'visitWebsite'];

test('the GHL capture is present (fn-3 is measured against it)', { skip: !haveCapture && 'knowledge sniffs funnels-fn-2026-11-08 not checked out next to this plugin' }, () => {
  assert.equal(ghl.type, 'element');
  assert.equal(ghl.meta, 'order-form');
});

test('a composed order-form leaf has every GHL prop, typed as GHL types it, with the five node-level keys', { skip: !haveCapture && 'no GHL capture' }, () => {
  const leaf = makeLeaf({ meta: 'order-form', extra: {} });
  for (const k of Object.keys(ghl.extra)) {
    if (k === 'nodeId') continue; // per element
    assert.ok(k in leaf.extra, `composed order-form lacks ${k}`);
  }
  for (const k of NODE_LEVEL) assert.ok(k in leaf.extra, `composed order-form lacks the node-level key ${k}`);
  // typed as GHL types them (the value shapes, not the values)
  assert.equal(Array.isArray(leaf.extra.steps.value), true);
  assert.equal(Array.isArray(leaf.extra.productOrder.value), true);
  assert.equal(typeof leaf.extra.showOrderBump.value, 'boolean');
  assert.equal(typeof leaf.extra.orderFormTheme.value, 'object');
  assert.equal(leaf.extra.render.value, 'stacked');
  // the steps value is the GHL steps value, ids templated
  assert.deepEqual(templ(leaf.extra.steps.value).map((s) => Object.keys(s).sort()), templ(ghl.extra.steps.value).map((s) => Object.keys(s).sort()));
  assert.equal(leaf.extra.steps.value[0].fields.length, ghl.extra.steps.value[0].fields.length, 'the GHL field list (9 shown) is composed');
});

// fn-3 (QA, 2026-11-08): key presence is not enough. The composed VALUES must be GHL's: deep-equal for the node-level keys, the same value
// type for every other GHL extra prop, and no empty string where GHL stores a value (the bl-841 pattern).
test('every GHL extra prop of a composed order-form carries GHL\'s value: deep-equal for the node-level keys, the same value type for the rest', { skip: !haveCapture && 'no GHL capture' }, () => {
  const leaf = makeLeaf({ meta: 'order-form', extra: {} });
  const vtype = (x) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x);
  for (const k of ['termsAndConditions', 'visibility', 'customClass', 'visitWebsite']) {
    assert.deepEqual(leaf.extra[k], ghl.extra[k], `${k} must be GHL's stored value, got ${JSON.stringify(leaf.extra[k])}`);
  }
  for (const k of Object.keys(ghl.extra)) {
    if (k === 'nodeId' || NODE_LEVEL.includes(k)) continue;
    assert.equal(vtype(leaf.extra[k]?.value), vtype(ghl.extra[k]?.value), `${k}: GHL stores a ${vtype(ghl.extra[k]?.value)}, composed ${vtype(leaf.extra[k]?.value)}`);
    if (ghl.extra[k]?.value !== '') assert.notEqual(leaf.extra[k]?.value, '', `${k} is an empty string, GHL stores a value`);
  }
});

test('a caller-supplied EMPTY STRING for an order-form prop does not override the GHL default (the bl-841 defect)', () => {
  const leaf = makeLeaf({ meta: 'order-form', extra: { steps: '', productOrder: '', bumps: '', orderFormTheme: '', showOrderBump: '', render: '', offerColumnSide: '', saleAction: '' } });
  assert.equal(Array.isArray(leaf.extra.steps.value), true, `steps must be the GHL array, got ${JSON.stringify(leaf.extra.steps)}`);
  assert.equal(Array.isArray(leaf.extra.productOrder.value), true);
  assert.equal(Array.isArray(leaf.extra.bumps.value), true);
  assert.equal(typeof leaf.extra.orderFormTheme.value, 'object');
  assert.equal(typeof leaf.extra.showOrderBump.value, 'boolean');
  assert.equal(leaf.extra.render.value, 'stacked');
  assert.equal(leaf.extra.saleAction.value, 'go-to-next-funnel-step');
});

test('the empty-is-absent rule covers exactly the order-form kind (other kinds keep caller values)', () => {
  const other = makeLeaf({ meta: 'heading', extra: { headlineText: '' } });
  assert.equal(other.extra.headlineText?.value ?? other.extra.headlineText, '', 'a heading keeps an empty caller value');
});

test('an order-form in a composed page is NOT refused (the refusal covered the paths the composer now writes)', () => {
  const page = { sections: [{ id: 'S1', elements: [makeLeaf({ meta: 'order-form', extra: {} })] }] };
  assert.deepEqual(refusedKindProblems(page), [], 'a GHL-shaped order-form must not be refused');
});

test('a STORED order-form in the old composer shape (empty-string props) IS still refused on copy paths', () => {
  const old = makeLeaf({ meta: 'order-form', extra: {} });
  old.extra.steps = { value: '' }; old.extra.productOrder = { value: '' }; old.extra.orderFormTheme = { value: '' };
  const page = { sections: [{ id: 'S1', elements: [old] }] };
  assert.equal(refusedKindProblems(page).length, 1, 'a stored old-shape order-form is refused where it would be copied');
});

test('build_funnel_page writes an order-form on a step that holds a step product, and refuses one without a product before any write', async () => {
  const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
  const writes = [];
  const products = { products: [{ _id: 'SP1', name: 'TEST-CONF-FN1 order item', product: 'P1', price: 'PR0' }] };
  const make = (stepProducts) => ({ uid: 'U', call: async (method, path, body) => {
    if (method !== 'GET') { writes.push({ method, path, body }); return { ok: true, status: 201, json: {} }; }
    if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { _id: 'F1', steps: [{ id: 'ST1', name: 'Probe', pages: ['P1'] }] } };
    if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { _id: 'P1', locationId: 'LOC', funnelId: 'F1', meta: { title: 'T', language: 'en' } } };
    if (path.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: { sections: [], settings: {}, general: {} } };
    if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
    if (path.startsWith('/funnels/order-form/products/')) return { ok: true, status: 200, json: { products: stepProducts } };
    throw new Error(`unexpected ${method} ${path}`);
  } });
  const sections = [{ columns: [{ elements: [{ meta: 'order-form' }] }] }];
  const withProduct = await tool.handler({ locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'ST1', sections, confirm: true }, { state: {}, makeGw: () => make(products.products) });
  assert.equal(withProduct.ok, true, JSON.stringify(withProduct).slice(0, 300));
  const body = JSON.stringify(writes.find((w) => w.path.includes('/funnels/builder/autosave/'))?.body ?? '');
  assert.match(body, /order-form/, 'the order-form node is in the write');
  writes.length = 0;
  const noProduct = await tool.handler({ locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'ST1', sections, confirm: true }, { state: {}, makeGw: () => make([]) });
  assert.equal(noProduct.ok, false, 'no step product: refused');
  assert.match(JSON.stringify(noProduct), /step product/i, 'the refusal names the missing step product');
  assert.equal(writes.length, 0, 'nothing is written when the refusal fires');
});

// fn-3 (QA follow-up, 2026-11-08): an order form inside a POPUP needs a step product on its step as much as one in a section does.
test('an order-form inside a popup is refused without a step product, before any write (popups are page content too)', async () => {
  const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
  const writes = [];
  const make = (stepProducts) => ({ uid: 'U', call: async (method, path, body) => {
    if (method !== 'GET') { writes.push({ method, path, body }); return { ok: true, status: 201, json: {} }; }
    if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { _id: 'F1', steps: [{ id: 'ST1', name: 'Probe', pages: ['P1'] }] } };
    if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { _id: 'P1', locationId: 'LOC', funnelId: 'F1', meta: { title: 'T', language: 'en' } } };
    if (path.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: { sections: [], settings: {}, general: {} } };
    if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
    if (path.startsWith('/funnels/order-form/products/')) return { ok: true, status: 200, json: { products: stepProducts } };
    throw new Error(`unexpected ${method} ${path}`);
  } });
  const sections = [{ columns: [{ elements: [{ meta: 'heading' }] }] }];
  const popups = [{ name: 'Offer', columns: [{ elements: [{ meta: 'order-form' }] }] }];
  const r = await tool.handler({ locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'ST1', sections, popups, confirm: true }, { state: {}, makeGw: () => make([]) });
  assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300));
  assert.match(JSON.stringify(r), /step product/i);
  assert.equal(writes.length, 0, 'nothing is written when the refusal fires');
});
