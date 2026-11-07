// w7-2 (bl-490, bl-517): a radius the API writes in CSS is what a builder save undoes. The check reports it before the write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builderSaveDrift, decoratePageResult, nativeRadius } from '../core/builder-save-drift.mjs';

const node = (over) => ({ id: 'button-A1', meta: 'button', type: 'element', extra: {}, styles: {}, class: {}, ...over });
const page = (elements, sheets = {}) => ({
  sections: [{ id: 'sec-1', elements, general: { sectionStyles: sheets.section ?? '' } }],
  pageStyles: sheets.page ?? '',
  general: { general: { pageStyles: sheets.custom ?? '' } },
});

test('an API-set CSS button radius with native radius 0 is reported', () => {
  const b = node({});
  const drift = builderSaveDrift(page([b], { section: `.button-A1 .main-heading-button{border-radius:20px}` }));
  assert.equal(drift.length, 1);
  assert.equal(drift[0].nodeId, 'button-A1');
  assert.equal(drift[0].kind, 'button');
  assert.equal(drift[0].written, '20px');
  assert.equal(drift[0].builderWouldWrite, '0px', 'a button with no radius setting is native 0');
  assert.equal(drift[0].nativeKey, 'class.borderRadius');
});

test('a button whose native settings equal the CSS is not reported', () => {
  const themed = node({ class: { borderRadius: { value: 'radius15' } } });
  assert.deepEqual(builderSaveDrift(page([themed], { section: `.button-A1{border-radius:15px}` })), []);
  const styled = node({ styles: { borderRadius: { value: 8, unit: 'px' } } });
  assert.deepEqual(builderSaveDrift(page([styled], { section: `.button-A1{border-radius:8px}` })), [], 'styles.borderRadius is the native value');
});

test('image border radius set by class-level page CSS is reported with nativeKey', () => {
  const img = node({ id: 'image-feature-B2', meta: 'image-feature' });
  const drift = builderSaveDrift(page([img], { custom: `.image-feature img{border-radius:12px}` }));
  assert.equal(drift.length, 1);
  assert.equal(drift[0].written, '12px');
  assert.equal(drift[0].builderWouldWrite, '0px');
  assert.equal(drift[0].nativeKey, 'class.borderRadius');
});

test('a native radius class reads back as px; an unknown class is not modelled', () => {
  assert.equal(nativeRadius(node({ class: { borderRadius: { value: 'radius4' } } })), '4px');
  assert.equal(nativeRadius(node({ class: { borderRadius: { value: 'radius-weird' } } })), null);
  assert.deepEqual(builderSaveDrift(page([node({ class: { borderRadius: { value: 'radius-weird' } } })], { section: `.button-A1{border-radius:9px}` })), []);
});

test('decoratePageResult leaves a clean result unchanged and names the fix for a drifting one', () => {
  const clean = { ok: true, data: { x: 1 } };
  assert.equal(decoratePageResult(clean, page([node({})], {})), clean);
  const drifting = page([node({})], { section: `.button-A1{border-radius:20px}` });
  const out = decoratePageResult({ ok: true, data: {} }, drifting);
  assert.equal(out.builderSaveWouldChange.length, 1);
  assert.deepEqual(out.nativeFix, [{ nodeId: 'button-A1', set: { styles: { borderRadius: { value: 20, unit: 'px' } } } }]);
});

test('the same custom-CSS rule stored in two sheets is reported once', () => {
  const b = node({});
  const rule = `.button-A1 .main-heading-button{border-radius:20px}`;
  const drift = builderSaveDrift(page([b], { page: rule, custom: rule }));
  assert.equal(drift.length, 1, 'pageStyles and general.general.pageStyles carry one custom CSS, so one row');
});

test('decoratePageResult attaches cssWarnings for a broken custom sheet, from the page or an explicit customCss', () => {
  const broken = page([node({})], {});
  const fromPage = decoratePageResult({ ok: true }, { ...broken, general: { general: { pageStyles: '@import url(https://x.test/a.css);' } } });
  assert.equal(fromPage.cssWarnings[0].rule, 'import-ignored');
  const explicit = decoratePageResult({ ok: true }, broken, { customCss: '.image-feature img{border-radius:12px}' });
  assert.equal(explicit.cssWarnings[0].rule, 'class-level-selector');
  assert.equal(decoratePageResult({ ok: true }, broken, { customCss: '.button-A1 .main-heading-button{color:#fff}' }).cssWarnings, undefined);
});
