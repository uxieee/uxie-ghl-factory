// Product-page blocks (store-pdp-v2-*): the pdpStyling warning on every run that writes them (they render unstyled
// until a builder save — bl-298, knowledge sniffs/funnels-wave29-kinds-2026-09-29), and edit mode's append-section held
// to the same placement rules as compose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const STEPS = [
  { id: 'SP', name: 'Product details', type: 'store', key: 'store-product-detail', pages: ['P1'] },
  { id: 'SC', name: 'Cart', type: 'store', key: 'store-cart', pages: ['P2'] },
];
const P = (k) => ({ meta: `store-pdp-v2-${k}` });
const PDP_SECTION = { pdp: true, columns: [{ elements: [P('images')] }, { elements: [P('title'), P('price'), P('add-to-cart')] }] };
const HEADING_SECTION = { columns: [{ elements: [{ meta: 'heading', html: 'Hi' }] }] };

const deps = (calls = []) => ({
  state: {},
  makeGw: () => ({ uid: 'U1', call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { _id: 'F1', steps: STEPS } };
    if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { _id: 'P1', locationId: 'LOC', funnelId: 'F1', meta: { title: 'T', language: 'en' } } };
    if (path.startsWith('/funnels/builder/page/data')) {
      const save = [...calls].reverse().find((c) => c.path.startsWith('/funnels/builder/autosave/'));
      return { ok: true, status: 200, json: save ? save.body.pageData : { sections: [{ id: 'section-X', elements: [{ id: 'heading-X', type: 'element', meta: 'heading', extra: {}, styles: {}, child: [] }], general: { sectionStyles: '' } }], settings: {}, general: {} } };
    }
    if (path.startsWith('/funnels/builder/autosave/')) return { ok: true, status: 201, json: {} };
    if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
    throw new Error(`unexpected call ${method} ${path}`);
  } }),
});
const run = (args, d = deps()) => tool.handler({ locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'SP', ...args }, d);

test('compose: the product-page blocks carry their per-kind CSS (f4b-2), so neither the preview nor the result asks for a builder save', async () => {
  const pre = await run({ sections: [PDP_SECTION, HEADING_SECTION] });
  assert.equal(pre.code, 'CONFIRM_REQUIRED');
  assert.equal(pre.data.preview.pdpStyling, undefined);
  assert.equal(pre.data.preview.builderStyling, undefined);
  const calls = [];
  const res = await run({ sections: [PDP_SECTION, HEADING_SECTION], confirm: true }, deps(calls));
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
  assert.equal(res.data.pdpStyling, undefined);
  const save = calls.find((c) => c.path.startsWith('/funnels/builder/autosave/'));
  const css = save.body.pageData.sections.map((sec) => sec.general.sectionStyles).join('');
  for (const rule of ['.pdp-v2-title__name', '.pdp-v2-images', '.pdp-v2-add-to-cart__btn', '.pdp-v2-price__amount']) assert.ok(css.includes(rule), `${rule} is in the section's stylesheet`);
});

test('edit: append-section with product-page blocks is refused off a product-detail step or outside a pdp section, nothing sent', async () => {
  for (const [args, re] of [[{ stepId: 'SC', pageId: 'P2', stepName: 'Cart' }, /'store-cart'/], [{ stepName: 'Product details', section: { ...PDP_SECTION, pdp: undefined } }, /pdpV2Section/]]) {
    const calls = [];
    const res = await run({ stepName: args.stepName, stepId: args.stepId ?? 'SP', pageId: args.pageId ?? 'P1', edits: [{ op: 'append-section', section: args.section ?? PDP_SECTION }], confirm: true }, deps(calls));
    assert.equal(res.code, 'VALIDATION_FAILED');
    assert.match(JSON.stringify(res.data.problems), re);
    assert.ok(!calls.some((c) => c.path.startsWith('/funnels/builder/autosave/')), 'nothing written');
  }
});

test('edit: an appended pdp section on the product-detail step needs no builder save any more (f4b-2 compiles the blocks)', async () => {
  const pre = await run({ stepName: 'Product details', edits: [{ op: 'append-section', section: PDP_SECTION }] });
  assert.equal(pre.code, 'CONFIRM_REQUIRED');
  assert.equal(pre.data.preview.pdpStyling, undefined);
  assert.equal(pre.data.preview.builderStyling, undefined);
  const other = await run({ stepName: 'Product details', edits: [{ op: 'set', nodeId: 'heading-X', extra: { text: { value: 'b' } } }] });
  assert.equal(other.data.preview.pdpStyling, undefined);
});

test('builderStyling: only the kinds still compiled by the builder alone (sections and popups); the pdp blocks are compiled here', async () => {
  const res = await run({ sections: [PDP_SECTION, { columns: [{ elements: [{ meta: 'nav-menu-v2' }, { meta: 'heading', html: 'x' }] }] }] });
  const b = res.data.preview.builderStyling;
  assert.deepEqual(b.nodes.map((n) => n.kind), ['nav-menu-v2']);
  assert.match(b.warning, /render differently until the page is saved once in the page builder, which compiles their CSS/);
  assert.equal(res.data.preview.pdpStyling, undefined, 'the product-page subset is empty: every pdp block is compiled here');
  const pop = await run({ sections: [HEADING_SECTION], popups: [{ name: 'P', columns: [{ elements: [{ meta: 'faq' }] }] }] });
  assert.deepEqual(pop.data?.preview?.builderStyling?.nodes.map((n) => n.kind), ['faq'], JSON.stringify(pop).slice(0, 300));
  const plain = await run({ sections: [HEADING_SECTION] });
  assert.equal(plain.data.preview.builderStyling, undefined);
});

test('builderStyling in edit mode names only what the call appends', async () => {
  const pre = await run({ stepName: 'Product details', edits: [{ op: 'append-section', section: { columns: [{ elements: [{ meta: 'divider' }] }] } }] });
  assert.deepEqual(pre.data.preview.builderStyling.nodes.map((n) => n.kind), ['divider']);
  const other = await run({ stepName: 'Product details', edits: [{ op: 'set', nodeId: 'heading-X', extra: { text: { value: 'b' } } }] });
  assert.equal(other.data.preview.builderStyling, undefined);
});
