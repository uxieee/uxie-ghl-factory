// f4b-1: margins, tablet / mobile styles and section styling in compose and edit — stored on the node in the builder's
// shape AND compiled through the generic layer (core/style-layer.mjs) as a builder save writes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { applyPageEdits, verifyEdits } from '../core/page-edit.mjs';
import { makeLeaf, makeColumn, makeSection, resetIds, SECTION_SPEC_KEYS } from '../core/funnel-pages.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const deps = (calls = []) => ({ state: {}, makeGw: () => ({ uid: 'U1', call: async (method, path, body) => {
  calls.push({ method, path, body });
  if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { _id: 'F1', steps: [{ id: 'S1', name: 'One', type: 'optin_funnel_page', pages: ['P1'] }] } };
  throw new Error(`unexpected ${method} ${path}`);
} }) });
const run = (args) => tool.handler({ locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1', ...args }, deps());

test('compose: an element takes wrapper and tablet / mobile maps — stored in the builder shape, compiled as the builder does', async () => {
  const r = await run({ sections: [{ columns: [{ elements: [{ meta: 'divider', wrapper: { marginTop: 24, width: { value: 50, unit: '%' } }, mobileStyles: { paddingTop: 2 }, tabletWrapper: { marginTop: 8 } }] }] }] });
  assert.equal(r.code, 'CONFIRM_REQUIRED', JSON.stringify(r).slice(0, 300));
  resetIds();
  const leaf = makeLeaf({ meta: 'divider', wrapper: { marginTop: 24 }, mobileStyles: { paddingTop: 2 } });
  assert.deepEqual(leaf.wrapper.marginTop, { value: 24, unit: 'px' });
  assert.deepEqual(leaf.mobileStyles, { paddingTop: { value: 2, unit: 'px' } });
});

test('compose: a section takes styles, per-device maps, visibility, custom classes, a background image and an entrance animation', () => {
  resetIds();
  const leaf = makeLeaf({ meta: 'heading', salt: 'a' }); const col = makeColumn({ children: [leaf], widthPct: 100, salt: 'a' });
  const s = makeSection({ columns: [{ col, leaves: [leaf], widthPct: 100 }], salt: 'a', styles: { borderRadius: '12px' }, mobileStyles: { paddingTop: 10 },
    visibility: { hideTablet: true }, customClass: ['hero'], bgImage: { url: 'https://example.com/bg.png', options: 'bgContain' } });
  const m = s.metaData;
  assert.deepEqual(m.styles.borderRadius, { value: 12, unit: 'px' });
  assert.deepEqual(m.extra.visibility.value, { hideDesktop: false, hideTablet: true, hideMobile: false });
  assert.deepEqual(m.extra.customClass.value, ['hero']);
  assert.equal(m.extra.bgImage.value.url, 'https://example.com/bg.png');
  assert.equal(m.extra.bgImage.value.options, 'bgContain');
  assert.match(s.general.sectionStyles, new RegExp(`\\.${s.id}\\{[^}]*border-radius:12px`));
  assert.match(s.general.sectionStyles, /#section-[^>]+>\.inner\{max-width:1170px\}/, 'the builder\'s inner width by default');
  assert.throws(() => makeSection({ columns: [], salt: 'b', bgImage: { url: 'not-a-url' } }), /bgImage must be/);
});

test('compose refuses an unknown section key by name (it used to be dropped silently)', async () => {
  const r = await run({ sections: [{ columns: [], margin: 20 }] });
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.message ?? r.detail, /unknown key\(s\) `margin`/);
  assert.ok(SECTION_SPEC_KEYS.includes('mobileStyles'));
});

test('edit: set wrapper / mobile maps on an element — merged, recompiled, verified by value', () => {
  resetIds();
  const leaf = makeLeaf({ meta: 'divider', salt: 'e' }); const col = makeColumn({ children: [leaf], widthPct: 100, salt: 'e' });
  const s = makeSection({ columns: [{ col, leaves: [leaf], widthPct: 100 }], salt: 'e' });
  const pd = { sections: [s], popupsList: [], settings: {}, general: {} };
  const { pageData, report, errors } = applyPageEdits(pd, [{ op: 'set', nodeId: leaf.id, wrapper: { marginBottom: 30 }, mobileWrapper: { marginBottom: 12 } }]);
  assert.equal(errors.length, 0);
  const css = pageData.sections[0].general.sectionStyles;
  assert.match(css, new RegExp(`\\.${leaf.id}\\{[^}]*margin-bottom:30px`));
  assert.match(css, new RegExp(`max-width:767px\\)\\{\\.hl_page-preview--content \\.${leaf.id}\\{margin-bottom:12px\\}`));
  assert.ok(verifyEdits(pageData, report).every((v) => v.applied));
});

test('builder-native undefined: absent text fields get exactly what the browser computes for the dropped declaration', async () => {
  const { makeLeaf: ml } = await import('../core/funnel-pages.mjs');
  const bp = ml({ meta: 'blog-post' }).extra.blog_style;
  assert.equal(bp.description.textDecoration, 'none', 'text-decoration is not inherited: its initial value');
  assert.equal(bp.publishDate.textTransform, 'inherit', 'text-transform is inherited: inherit');
  assert.equal(bp.description.textStyle, undefined, 'textStyle is left absent: the premium card writes font-style:normal only while it is');
  const mine = ml({ meta: 'blog-post', extra: { blog_style: { title: { fontSize: 20, textTransform: 'uppercase' } } } }).extra.blog_style;
  assert.equal(mine.title.textTransform, 'uppercase', 'an authored field is never overwritten');
  assert.equal(ml({ meta: 'social-share-blog' }).extra.socialShareStyle.labelText.textDecoration, 'none');
});
