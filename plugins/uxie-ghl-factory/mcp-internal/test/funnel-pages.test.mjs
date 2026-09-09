// Every case here pins a trap that was paid for live on 2026-09-09. They are not shape tests for
// their own sake: each one, if it regressed, produces a page that saves with 201 and then fails —
// in the public renderer, in the builder, or silently in appearance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEMENT_KINDS, ELEMENTS, completeExtra, makeLeaf, makeColumn, makeSection,
  buildPageData, autosaveEnvelope, auditPageData, resetIds, textCss, val, BG_IMAGE,
  emptyFor, GO_TO_NEXT_STEP, NEEDS_CONTEXT, NEEDS_STEP_TYPE, TAG_IS_TAGNAME,
} from '../core/funnel-pages.mjs';

const page = (over = {}) => {
  resetIds();
  const leaf = makeLeaf({ meta: 'heading', extra: { text: val('<h1>Hi</h1>') } });
  const col = makeColumn({ children: [leaf], widthPct: 100 });
  const section = makeSection({ columns: [{ col, leaves: [leaf], widthPct: 100 }], pageId: 'P', funnelId: 'F', locationId: 'L',
    elementCss: textCss(leaf.id, { size: 40, color: '#000', font: 'serif' }) });
  return { leaf, col, section, data: buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [section], ...over }) };
};

test('the element vocabulary is the closed set of 60', () => {
  assert.equal(ELEMENT_KINDS.length, 60);
  assert.ok(ELEMENTS['two-setp-order'], 'the misspelling is the stored value and must survive');
  assert.equal(ELEMENTS['two-setp-order'].tagName, 'c-order');
  assert.equal(ELEMENTS['one-step-order'].tagName, 'c-order', 'tagName does not identify a kind');
});

test('an unknown meta is refused at build time — autosave would accept it', () => {
  assert.throws(() => makeLeaf({ meta: 'not-a-real-element' }), /closed set/);
});

test('completeExtra supplies EVERY declared prop, including those with no default', () => {
  // `form` declares five and none has a default. Supplying only defaulted props applied zero and
  // 500'd the page; all five present, even empty, renders.
  const extra = completeExtra('form');
  for (const p of ELEMENTS.form.extraProps) assert.ok(p in extra, `${p} must be present`);
  assert.equal(extra.formId.value, '');
});

test('caller values win over the shaped empties', () => {
  const extra = completeExtra('form', { formId: val('abc') });
  assert.equal(extra.formId.value, 'abc');
});

test('a column carries bgImage as an OBJECT — without it the public page 500s', () => {
  const { col } = page();
  assert.deepEqual(col.extra.bgImage, BG_IMAGE);
  assert.equal(typeof col.extra.bgImage.value, 'object');
});

test('general.general carries fontsToLoad and colors; the auditor refuses a page without them', () => {
  const { data } = page();
  assert.ok(Array.isArray(data.general.general.fontsToLoad));
  assert.ok(Array.isArray(data.general.general.colors));
  assert.deepEqual(auditPageData(data), []);

  const broken = structuredClone(data);
  delete broken.general.general.fontsToLoad;
  assert.match(auditPageData(broken).join(' '), /fontsToLoad is required/);
});

test('child[] holds node IDS — nesting objects saves fine and kills the builder', () => {
  const { data, leaf, col } = page();
  const broken = structuredClone(data);
  const c = broken.sections[0].elements.find((n) => n.id === col.id);
  c.child = [structuredClone(leaf)];
  assert.match(auditPageData(broken).join(' '), /child\[\] must hold node IDS/);
});

test('a dangling child id is caught — it renders as a builder crash, not an error', () => {
  const { data, col } = page();
  const broken = structuredClone(data);
  broken.sections[0].elements.find((n) => n.id === col.id).child = ['heading-DOES-NOT-EXIST'];
  assert.match(auditPageData(broken).join(' '), /does not resolve/);
});

test('nodeId must be c+id — the renderer keys markup on it', () => {
  const { data } = page();
  const broken = structuredClone(data);
  broken.sections[0].elements[0].extra.nodeId = 'wrong';
  assert.match(auditPageData(broken).join(' '), /nodeId must be/);
});

test('the compiled stylesheet must mention the section id, or every rule is orphaned', () => {
  const { data } = page();
  const broken = structuredClone(data);
  broken.sections[0].general.sectionStyles = '.some-other-node{color:red}';
  assert.match(auditPageData(broken).join(' '), /orphaned/);
});

test('a missing declared prop is reported by name', () => {
  const { data } = page();
  const broken = structuredClone(data);
  delete broken.sections[0].elements.find((n) => n.type === 'element').extra.typography;
  const out = auditPageData(broken).join(' ');
  assert.match(out, /missing declared extra props/);
  assert.match(out, /typography/);
});

test('font sizes are emitted only inside breakpoint media queries', () => {
  const css = textCss('heading-X', { size: 40, color: '#000', font: 'serif' });
  assert.match(css, /@media screen and \(min-width:481px\)/);
  assert.match(css, /@media screen and \(min-width:0px\) and \(max-width:480px\)/);
  assert.ok(!/^[^@]*font-size/.test(css.split('@media')[0]), 'no unscoped font-size before the first media query');
});

test('the autosave envelope counts custom-code elements rather than hardcoding 0', () => {
  resetIds();
  const code = makeLeaf({ meta: 'custom-code' });
  const col = makeColumn({ children: [code], widthPct: 100 });
  const section = makeSection({ columns: [{ col, leaves: [code], widthPct: 100 }], pageId: 'P', funnelId: 'F', locationId: 'L' });
  const data = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [section] });
  assert.equal(autosaveEnvelope({ funnelId: 'F', pageData: data }).integrations.customCode, 1);
});

// ── added after the CTA shipped broken and after the shape sweep ──────────────────────────────

test('a wrong action ENUM is refused — presence checks do not catch it', () => {
  // `goToNextStep` is the plausible camelCase guess. autosave stored it with a 201, the page
  // rendered 200, and the button did nothing. The builder's value is 'go-to-next-funnel-step'.
  const { data } = page();
  const broken = structuredClone(data);
  broken.sections[0].elements.find((n) => n.type === 'element').extra.action = { value: 'goToNextStep' };
  const out = auditPageData(broken).join(' ');
  assert.match(out, /is not a known action/);
  assert.match(out, /go-to-next-funnel-step/);
});

test('a valid action passes, and an empty one is not second-guessed', () => {
  const { data } = page();
  for (const v of [GO_TO_NEXT_STEP, 'openPopup', 'url', '']) {
    const probe = structuredClone(data);
    probe.sections[0].elements.find((n) => n.type === 'element').extra.action = { value: v };
    assert.deepEqual(auditPageData(probe), [], `action '${v}' should be accepted`);
  }
});

test('nav-menu takes ARRAY empties even for props named like media', () => {
  // The name says icon/imageProperties; the component iterates them. An object-shaped empty 500s
  // the page exactly as a string does — proven by trying whole-node shape variants per kind.
  assert.deepEqual(emptyFor('icon', 'nav-menu'), { value: [] });
  assert.deepEqual(emptyFor('imageProperties', 'nav-menu-v2'), { value: [] });
  assert.equal(typeof emptyFor('icon', 'heading').value, 'object', 'other kinds keep the name heuristic');
});

test('a kind that needs a particular step type is flagged with that step type', () => {
  resetIds();
  const leaf = makeLeaf({ meta: 'store-cart' });
  const col = makeColumn({ children: [leaf], widthPct: 100 });
  const section = makeSection({ columns: [{ col, leaves: [leaf], widthPct: 100 }], pageId: 'P', funnelId: 'F', locationId: 'L' });
  const data = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [section] });
  assert.match(auditPageData(data).join(' '), /renders only on a step of type 'store'/);
});

// ── the builder-only contract ─────────────────────────────────────────────────
// A page can render perfectly on its public URL and still hang the page BUILDER on a loading
// spinner forever. Both of these pin that failure mode, found live 2026-09-09.
test('buildPageData carries settings.settings.background — without it the BUILDER hangs', () => {
  const p = buildPageData({ pageId: 'p', stepId: 's', funnelId: 'f', locationId: 'l', sections: [] });
  const bg = p.settings.settings.background;
  assert.ok(bg, 'settings.settings.background must exist');
  assert.ok(bg.bgImage && 'value' in bg.bgImage, 'bgStyle() destructures bgImage from it, unguarded');
  assert.ok(bg.backgroundColor && 'value' in bg.backgroundColor);
  assert.ok(p.settings.settings.typography, 'typography must survive alongside it');
});

test('auditPageData reports a missing settings.settings.background', () => {
  const p = buildPageData({ pageId: 'p', stepId: 's', funnelId: 'f', locationId: 'l', sections: [] });
  delete p.settings.settings.background;
  assert.ok(auditPageData(p).some((x) => /settings\.settings\.background/.test(x)));
});

test('every node carries a nested `element` copy — the builder reads that, not the wrapper', () => {
  resetIds();
  const leaf = makeLeaf({ meta: 'heading', extra: { text: val('<h1>Hi</h1>') }, tag: 'h1' });
  const col = makeColumn({ children: [leaf], widthPct: 100 });
  const section = makeSection({ columns: [{ col, leaves: [leaf], widthPct: 100 }], pageId: 'p', funnelId: 'f', locationId: 'l' });
  const p = buildPageData({ pageId: 'p', stepId: 's', funnelId: 'f', locationId: 'l', sections: [section] });
  const s0 = p.sections[0];
  assert.ok(s0.metaData.element, 'section metaData needs element');
  assert.equal(s0.metaData.element._id, s0.metaData.id, 'a section element carries _id');
  for (const n of s0.elements) {
    assert.ok(n.element, `${n.id} (${n.type}) needs element`);
    assert.equal(n.element.id, n.id);
    assert.ok(!('element' in n.element), 'element must not nest itself');
    assert.ok(!('tabletStyles' in n.element), 'element omits the outer-only tablet keys');
  }
  assert.equal(s0.elements.find((n) => n.type === 'col').element.noOfColumns, 1);
});

test('an `icon` prop is a glyph descriptor, not media — a media shape prints "undefined" in the builder', () => {
  const icon = emptyFor('icon', 'heading');
  assert.deepEqual(Object.keys(icon.value).sort(), ['fontFamily', 'name', 'unicode']);
  assert.ok(!('mediaType' in icon.value), 'the media regex must not swallow `icon`');
  // the media branch itself must still work
  assert.ok('mediaType' in emptyFor('imageProperties', 'image-feature').value);
});

test('store and blog kinds carry tag === tagName; everything else stays empty', () => {
  resetIds();
  assert.equal(makeLeaf({ meta: 'store-cart' }).tag, 'c-store-cart');
  assert.equal(makeLeaf({ meta: 'blog-content' }).tag, 'c-blog-content');
  assert.equal(makeLeaf({ meta: 'heading' }).tag, '');
  assert.equal(makeLeaf({ meta: 'heading', tag: 'h2' }).tag, 'h2', 'an explicit tag still wins');
});

test('NEEDS_STEP_TYPE names the step type, and nothing is left unbuilt', () => {
  assert.equal(NEEDS_STEP_TYPE['store-checkout'], 'store');
  assert.equal(NEEDS_STEP_TYPE['blog-content'], 'blog-post');
  assert.deepEqual(Object.keys(NEEDS_CONTEXT), [], 'every leaf kind builds from scratch now');
  for (const k of Object.keys(NEEDS_STEP_TYPE)) assert.ok(!(k in NEEDS_CONTEXT), `${k} is buildable now`);
});

test('social-share-blog: socialShareStyle is RAW, socialShareOption is wrapped', () => {
  const e = completeExtra('social-share-blog');
  assert.ok(!('value' in e.socialShareStyle), 'socialShareStyle must NOT be {value:…} — wrapping it 500s the page');
  assert.ok('value' in e.socialShareOption, 'socialShareOption IS wrapped');
  assert.equal(e.socialShareStyle.socialIcon.iconStyle, 'sqaure', "GHL's own typo is what the renderer matches");
  assert.equal(e.socialShareStyle.background.bgColor, '#ffffff');
});

test('auditPageData catches a RAW prop that was wrapped', () => {
  resetIds();
  const leaf = makeLeaf({ meta: 'social-share-blog', extra: { socialShareStyle: { value: { background: { bgColor: '#fff' } } } } });
  const col = makeColumn({ children: [leaf], widthPct: 100 });
  const section = makeSection({ columns: [{ col, leaves: [leaf], widthPct: 100 }], pageId: 'P', funnelId: 'F', locationId: 'L' });
  const data = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [section] });
  assert.match(auditPageData(data).join(' '), /extra\.socialShareStyle must be a RAW object/);
});

test('nothing is left in NEEDS_CONTEXT — all 57 leaf kinds build', () => {
  assert.deepEqual(Object.keys(NEEDS_CONTEXT), []);
});
