// A tool-composed page must stay SAVEABLE in GHL's page builder. The builder recomputes every element's styles and fonts
// on each save and reads many values unguarded; a node missing one made the whole page unsaveable ("Error while creating
// page!", nothing sent) while its public render stayed fine. Measured by differential in knowledge
// sniffs/funnels-wave15-actions-2026-09-29: 54 kinds composed by main → 11 builder crashes (+ the order forms and 4 store
// kinds); composed by this code → the builder saved all 54 on the first try, and each store page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLeaf, ELEMENT_KINDS, emptyFor } from '../core/funnel-pages.mjs';
import { KIND_DEFAULT_STYLES, KIND_CONFIG_EXTRA } from '../core/kind-style-defaults.mjs';

test('a font prop is never an array: the builder calls value.replace() on every typography / *FontFamily', () => {
  assert.deepEqual(emptyFor('typography', 'nav-menu'), { value: '' });
  assert.deepEqual(emptyFor('productNameFontFamily', 'store-cart'), { value: '' });
  for (const k of ELEMENT_KINDS) {
    const n = makeLeaf({ meta: k, salt: 'f' });
    for (const part of ['extra', 'styles']) for (const [p, v] of Object.entries(n[part] ?? {})) {
      if (!/^typography$|fontfamily$/i.test(p)) continue;
      const val = v && typeof v === 'object' && 'value' in v ? v.value : v;
      assert.ok(val == null || typeof val === 'string', `${k}.${part}.${p} must be a string, got ${JSON.stringify(val)}`);
    }
  }
});

test('order forms carry the six styles orderFormStyles reads unguarded', () => {
  for (const k of ['one-step-order', 'two-setp-order']) {
    const s = makeLeaf({ meta: k, salt: 'o' }).styles;
    for (const p of ['buttonColor', 'buttonTextColor', 'formBgColor', 'buttonSize', 'formRadius', 'textAlign']) assert.ok(s[p] && 'value' in s[p], `${k} lacks styles.${p}`);
    assert.equal(s.formRadius.unit, 'px');
  }
});

test('every kind the differential proved crashing gets its builder style keys; an authored style still wins', () => {
  for (const [k, styles] of Object.entries(KIND_DEFAULT_STYLES)) {
    const n = makeLeaf({ meta: k, salt: 'k' });
    for (const p of Object.keys(styles)) assert.ok(p in n.styles, `${k} lacks styles.${p}`);
  }
  const authored = makeLeaf({ meta: 'nav-menu', salt: 'a', styles: { lineHeight: { value: 2, unit: 'em' } } });
  assert.deepEqual(authored.styles.lineHeight, { value: 2, unit: 'em' });
});

test('config extras take the real shape; content props are never copied from a template', () => {
  for (const [k, props] of Object.entries(KIND_CONFIG_EXTRA)) {
    for (const p of Object.keys(props)) assert.ok(!/list|items|^text$|html|slides|gallery|menuItems/i.test(p), `${k}.${p} is content and must not be filled`);
  }
  const bsf = makeLeaf({ meta: 'blog-subscribe-form', salt: 'b' }).extra.blogSubscribeFormStyle;
  assert.ok(bsf && typeof bsf === 'object' && !('value' in bsf) && bsf.title && bsf.button && bsf.form, 'blogSubscribeFormStyle is the builder\'s RAW object');
  assert.deepEqual(makeLeaf({ meta: 'nav-menu', salt: 'n' }).extra.desktopFontSize, { value: 14, unit: 'px' });
  // no url survives from a template
  assert.ok(!/https?:\/\//.test(JSON.stringify(KIND_CONFIG_EXTRA)), 'a template url leaked into the defaults');
});

test('one-step-order carries the builder\'s step1 field config: a phone field is rendered when the validator demands one', () => {
  const s1 = makeLeaf({ meta: 'one-step-order', salt: 'p' }).extra.step1.value;
  // the public validator requires a phone unless showPhone is false; an empty step1 rendered no phone field → unsubmittable
  assert.equal(s1.showPhone, true);
  assert.equal(typeof s1.btnText, 'string');
  assert.ok(s1.phone && s1.email && s1.fullName, 'field labels present');
});
