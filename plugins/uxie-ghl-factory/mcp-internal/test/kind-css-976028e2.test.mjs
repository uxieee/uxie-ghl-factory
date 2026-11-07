// w7-5b (2026-11-07): the kind-CSS re-pin to page builder 976028e2. The per-kind spec, the oracle, the style layer and the factory
// defaults are measured on that chunk; featured-product (case #9, 16 inputs) disagrees with the builder oracle and is recorded
// as unverified; the build_funnel_page preview names every unverified kind it writes, so nobody reads a verified claim it does not
// have. The generic layer writes choose-options-modal-background-color on store-pdp-v2-add-to-cart (the builder's own CSS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND_CSS_SOURCE } from '../core/kind-css-spec.mjs';
import { kindCssUnverifiedKinds } from '../core/kind-css.mjs';
import { FACTORY_SOURCE, KIND_FACTORY_EXTRA, KIND_FACTORY_STYLES } from '../core/kind-factory-defaults.mjs';
import { nodeLayerCss } from '../core/style-layer.mjs';
import { kindCssUnverifiedWarning, makeLeaf } from '../core/funnel-pages.mjs';
import { TOOLS } from '../core/tools.mjs';

test('the per-kind spec and the factory defaults are both pinned to page builder 976028e2 (one chunk, one bundle)', () => {
  assert.equal(KIND_CSS_SOURCE.chunk, 'pageBuilder index.976028e2.js');
  assert.equal(FACTORY_SOURCE.chunk, 'pageBuilder index.976028e2.js');
  assert.equal(KIND_CSS_SOURCE.sha256, FACTORY_SOURCE.sha256);
});

test('featured-product (case #9), store-product-detail and store-pdp-v2-description are verified:false on 976028e2; every other kind is verified', () => {
  assert.deepEqual([...kindCssUnverifiedKinds()].sort(), ['featured-product', 'store-pdp-v2-description', 'store-product-detail']);
  assert.equal(KIND_CSS_SOURCE.checked['featured-product'].verified, false);
  assert.equal(KIND_CSS_SOURCE.checked['store-pdp-v2-description'].verified, false);
});

test('the factory defaults carry the 976028e2 add-to-cart modal default, and the five new kinds have their own extra defaults', () => {
  assert.deepEqual(KIND_FACTORY_STYLES['store-pdp-v2-add-to-cart'].chooseOptionsModalBackgroundColor, { value: 'var(--transparent)' });
  for (const k of ['quiz', 'services', 'rentals', 'order-form', 'blog-comments']) assert.ok(KIND_FACTORY_EXTRA[k], `${k} has factory extras on 976028e2`);
});

test('the generic layer writes choose-options-modal-background-color on the add-to-cart box, as the 976028e2 builder does', () => {
  const node = { id: 'store-pdp-v2-add-to-cart-FX', meta: 'store-pdp-v2-add-to-cart', extra: { nodeId: 'cstore-pdp-v2-add-to-cart-FX' },
    styles: { chooseOptionsModalBackgroundColor: { value: 'var(--transparent)' } } };
  assert.match(nodeLayerCss(node), /\.hl_page-preview--content \.cstore-pdp-v2-add-to-cart-FX\{choose-options-modal-background-color:var\(--transparent\)\}/);
});

test('kindCssUnverifiedWarning names only the unverified kinds on the page, with their ids; a verified kind is not named', () => {
  const page = { sections: [{ id: 'S1', elements: [
    { ...makeLeaf({ meta: 'featured-product' }), id: 'fp-1', type: 'element' },
    { ...makeLeaf({ meta: 'store-pdp-v2-title' }), id: 'tt-1', type: 'element' },
  ] }] };
  const w = kindCssUnverifiedWarning(page);
  assert.deepEqual(w.nodes.map((n) => [n.id, n.kind]), [['fp-1', 'featured-product']]);
  assert.match(w.warning, /not verified on page builder 976028e2/);
  assert.equal(kindCssUnverifiedWarning({ sections: [{ id: 'S2', elements: [{ ...makeLeaf({ meta: 'store-pdp-v2-title' }), type: 'element' }] }] }), null);
});

test('build_funnel_page names an unverified kind in its preview (the tool, not only the helper)', async () => {
  const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
  const STEPS = [{ id: 'SP', name: 'Product details', type: 'store', key: 'store-product-detail', pages: ['P1'] }];
  const deps = {
    state: {},
    makeGw: () => ({ uid: 'U1', call: async (method, path) => {
      if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { _id: 'F1', steps: STEPS } };
      if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { _id: 'P1', locationId: 'LOC', funnelId: 'F1', meta: { title: 'T', language: 'en' } } };
      if (path.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: { sections: [], settings: {}, general: {} } };
      if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
      throw new Error(`unexpected call ${method} ${path}`);
    } }),
  };
  const res = await tool.handler({ locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'SP',
    sections: [{ columns: [{ elements: [{ meta: 'featured-product' }] }] }] }, deps);
  assert.deepEqual(res.data.preview.kindCssUnverified.nodes.map((n) => n.kind), ['featured-product'], JSON.stringify(res).slice(0, 300));
});
