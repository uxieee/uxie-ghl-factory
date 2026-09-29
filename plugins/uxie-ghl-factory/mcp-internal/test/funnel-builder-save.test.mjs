// f1 (2026-09-29): what a tool-composed page must carry so that a BUILDER save recompiles the same page.
// Each case pins a defect a real builder save exposed (knowledge sniffs/funnels-wave19-tool-drift-2026-09-29
// ui-cap.builder-save.json: 64 × `font-size:undefined`) or the completeness sweep found by reading the builder
// (sniffs/funnels-completeness-2026-09-29 notes-A D10, D12, D15; a-defaults-diff.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEMENT_KINDS, makeLeaf, resetIds, buildPageData, auditPageData, elementSizeCss, builderTextSizeCss, builderButtonSizeCss,
  routeClickAction, clickActionOf, applyPalette, BUILDER_PALETTE, completeExtra, nodeExtraFromCss,
} from '../core/funnel-pages.mjs';
import { popupRefProblems } from '../core/page-popup.mjs';
import { applyPageEdits } from '../core/page-edit.mjs';
import { KIND_BUILDER_EXTRA } from '../core/kind-builder-defaults.mjs';

const SIZE = /FontSize$/;

test('no composed leaf carries a size prop the builder would compile to "undefined"', () => {
  for (const meta of ELEMENT_KINDS) {
    if (['section', 'row', 'col', 'hl_main_popup'].includes(meta)) continue;
    resetIds();
    let leaf; try { leaf = makeLeaf({ meta }); } catch { continue; }
    for (const [k, v] of Object.entries(leaf.extra)) {
      if (!SIZE.test(k)) continue;
      // `${value}${unit}` — a {value:""} prop is truthy, so the builder prints "undefined"
      assert.ok(v && v.value !== '' && v.value !== undefined && v.unit, `${meta}.extra.${k} = ${JSON.stringify(v)}`);
    }
  }
});

test('every text kind and the button compile with no "undefined" when composed bare', () => {
  for (const meta of ['heading', 'sub-heading', 'paragraph', 'rich-text', 'bulletList', 'button']) {
    resetIds();
    const css = elementSizeCss(makeLeaf({ meta }));
    assert.ok(css.length > 0, meta);
    assert.ok(!/undefined|\[object Object\]/.test(css), `${meta}: ${css}`);
  }
});

test('the size compiler is the builder\'s: a node written by the builder compiles the same rules', () => {
  // desktopFontSize/mobileFontSize {value,unit} and fontWeight {desktop, mobile} — the stored shapes of a GHL-saved node
  const node = { id: 'paragraph-1', meta: 'paragraph', extra: { desktopFontSize: { value: 14, unit: 'px' }, mobileFontSize: { value: 12, unit: 'px' } },
    styles: { fontWeight: { value: 'medium', desktop: '400' } } };
  const css = builderTextSizeCss(node);
  assert.match(css, /max-width:767px\)\{[^{]*\{font-size:12px!important;font-weight:400\}/, 'mobile falls back to the desktop weight');
  assert.match(css, /min-width:768px\) and \(max-width:10000px\)\{[^{]*\{font-size:14px!important;font-weight:400\}/);
  assert.ok(!/1024px/.test(css), 'no tablet block unless a tablet value is set');
  const tab = builderTextSizeCss({ ...node, extra: { ...node.extra, tabletFontSize: { value: 13, unit: 'px' } } });
  assert.match(tab, /min-width:768px\) and \(max-width:1024px\)\{[^{]*\{font-size:13px!important\}/);
  const rich = builderTextSizeCss({ ...node, meta: 'rich-text' });
  assert.match(rich, /\.paragraph-1\.text-output h1,/, 'rich text weights its headings separately');
});

test('a css-styled button carries its size on the node and all four sub-text sizes resolve', () => {
  resetIds();
  const b = makeLeaf({ meta: 'button', extra: nodeExtraFromCss('button', { size: 22 }) });
  assert.deepEqual(b.extra.desktopFontSize, { value: 22, unit: 'px' });
  assert.deepEqual(b.extra.mobileFontSize, { value: 22, unit: 'px' });
  const css = builderButtonSizeCss(b);
  assert.equal((css.match(/font-size:22px/g) ?? []).length, 3, 'desktop, tablet, mobile');
  assert.ok(!/undefined/.test(css));
});

test('defaults come from the builder\'s registry, not from the prop name', () => {
  assert.deepEqual(completeExtra('store-product-list').itemsPerPage, { value: 6 });
  assert.deepEqual(completeExtra('store-product-list').enableWishlisting, { value: false });
  for (const meta of ['countdown', 'marketing-countdown', 'minute-timer', 'day-timer']) assert.deepEqual(completeExtra(meta).expireAction, { value: 'url' }, meta);
  assert.deepEqual(completeExtra('button').visitWebsite, { value: { url: '', newTab: false } }, 'not a background-image object');
  assert.deepEqual(completeExtra('button').downloadFile, { value: { fileUrl: '', fileName: '' } });
  assert.deepEqual(completeExtra('image').imageActions, { value: 'none' });
  assert.deepEqual(completeExtra('svg').svgImageActions, { value: 'none' });
  // content is never inherited: no placeholder copy, demo image or subscriber tags
  assert.deepEqual(completeExtra('heading').text, { value: '' });
  for (const k of ['text', 'imageProperties', 'menuItems', 'blogSubscribeTags', 'mapLocation']) {
    for (const [meta, o] of Object.entries(KIND_BUILDER_EXTRA)) assert.ok(!(k in o), `${meta}.${k} must not be a builder default`);
  }
  // the template-proven tables still win over the builder's fresh node
  assert.deepEqual(completeExtra('nav-menu').showSearchbar, completeExtra('nav-menu', {}).showSearchbar);
});

test('an image\'s click action goes where its renderer reads it; svg carries both props', () => {
  assert.deepEqual(routeClickAction('image', { action: { value: 'openPopup' }, popupId: { value: 'p' } }), { imageActions: { value: 'openPopup' }, popupId: { value: 'p' } });
  assert.deepEqual(routeClickAction('svg', { action: { value: 'url' } }), { svgImageActions: { value: 'url' }, imageActions: { value: 'url' } });
  assert.deepEqual(routeClickAction('button', { action: { value: 'url' } }), { action: { value: 'url' } }, 'a button keeps extra.action');
  assert.throws(() => routeClickAction('svg', { action: { value: 'click-to-call' } }), /not one the builder offers/);
  resetIds();
  const img = makeLeaf({ meta: 'image', extra: { action: { value: 'openPopup' }, popupId: { value: 'nope' } } });
  assert.equal(clickActionOf(img), 'openPopup');
  assert.ok(!('action' in img.extra));
  const pd = { sections: [{ elements: [img] }], popupsList: [] };
  assert.equal(popupRefProblems(pd).length, 1, 'a dangling image popup is caught like a button\'s');
});

test('the audit flags an image written with extra.action or an action its menu lacks', () => {
  resetIds();
  const img = makeLeaf({ meta: 'image' });
  const pd = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [] });
  pd.sections = [{ id: 'sec', elements: [{ ...img, extra: { ...img.extra, action: { value: 'url' }, imageActions: { value: 'sell-product' } } }], metaData: { child: [] }, general: { sectionStyles: 'sec' } }];
  const p = auditPageData(pd).join('\n');
  assert.match(p, /extra\.action is not read on this kind/);
  assert.match(p, /imageActions\.value "sell-product" is not one of/);
});

test('an edit routes an image action and recompiles a size change from the node', () => {
  resetIds();
  const img = makeLeaf({ meta: 'image' }); const h = makeLeaf({ meta: 'heading' });
  const page = { sections: [{ id: 's', elements: [img, h], general: { sectionStyles: '' } }], popupsList: [] };
  const { pageData, errors } = applyPageEdits(page, [
    { op: 'set', nodeId: img.id, extra: { action: { value: 'url' }, visitWebsite: { value: { url: 'https://x.test', newTab: false } } } },
    { op: 'set', nodeId: h.id, extra: { desktopFontSize: { value: 30, unit: 'px' } } },
  ], { compileSizes: elementSizeCss });
  assert.deepEqual(errors, []);
  const nodes = pageData.sections[0].elements;
  assert.deepEqual(nodes[0].extra.imageActions, { value: 'url' });
  assert.ok(!('action' in nodes[0].extra));
  assert.match(pageData.sections[0].general.sectionStyles, /font-size:30px!important/);
});

test('the palette is declared the way a GHL page declares it, and never overrides the page\'s own values', () => {
  const pd = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [], colors: [{ label: 'Primary', value: '#123456' }] });
  pd.pageStyles = ':root{--white:#fafafa}.x{}';
  applyPalette(pd);
  assert.equal(pd.general.general.colors.length, BUILDER_PALETTE.length);
  assert.equal(pd.general.general.colors.find((c) => c.label === 'Primary').value, '#123456');
  assert.match(pd.pageStyles, /--primary:#123456/);
  assert.match(pd.pageStyles, /--cobalt:#155eef/);
  assert.match(pd.pageStyles, /--text-color:#000000/);
  assert.equal((pd.pageStyles.match(/--white:/g) ?? []).length, 1, 'an existing declaration is left alone');
  const once = pd.pageStyles; applyPalette(pd); assert.equal(pd.pageStyles, once, 'idempotent');
  // every palette variable a tool default writes is one the palette declares
  const declared = new Set([...pd.pageStyles.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]));
  for (const meta of ELEMENT_KINDS) {
    if (['section', 'row', 'col', 'hl_main_popup'].includes(meta)) continue;
    resetIds(); let leaf; try { leaf = makeLeaf({ meta }); } catch { continue; }
    for (const m of JSON.stringify([leaf.styles, leaf.extra]).matchAll(/var\((--[a-z-]+)\)/g)) {
      if (['--headlinefont', '--contentfont'].includes(m[1])) continue;
      assert.ok(declared.has(m[1]), `${meta} writes var(${m[1]}), which no page declares`);
    }
  }
});

test('a bare button\'s node colours reach the button element, as the builder compiles them', async () => {
  const { buttonColourCss } = await import('../core/funnel-pages.mjs');
  resetIds();
  const b = makeLeaf({ meta: 'button' });
  assert.equal(buttonColourCss(b), `.hl_page-preview--content .c${b.id}{color:var(--white);background-color:var(--cobalt)}`);
});

test('an image carries the boxShadow the builder compiles unguarded', () => {
  resetIds();
  assert.deepEqual(makeLeaf({ meta: 'image' }).styles.boxShadow, { value: 'none' });
});

test('a css button\'s font goes where the builder reads it: extra.typography', () => {
  assert.deepEqual(nodeExtraFromCss('button', { font: 'var(--georgia)' }).typography, { value: 'var(--georgia)' });
  assert.ok(!('typography' in nodeExtraFromCss('button', {})));
});

test('every default weight object carries a mobile value, whatever table it came from', () => {
  for (const meta of ELEMENT_KINDS) {
    if (['section', 'row', 'col', 'hl_main_popup'].includes(meta)) continue;
    resetIds(); let leaf; try { leaf = makeLeaf({ meta }); } catch { continue; }
    for (const [k, w] of Object.entries(leaf.styles)) if (/^fontWeight/.test(k) && w && typeof w === 'object' && w.desktop !== undefined) assert.ok(w.mobile !== undefined, `${meta}.styles.${k}`);
  }
});
