// Every case here pins a trap that was paid for live on 2026-09-09. They are not shape tests for
// their own sake: each one, if it regressed, produces a page that saves with 201 and then fails —
// in the public renderer, in the builder, or silently in appearance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEMENT_KINDS, ELEMENTS, completeExtra, makeLeaf, makeColumn, makeSection,
  buildPageData, autosaveEnvelope, auditPageData, resetIds, textCss, val, BG_IMAGE,
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
