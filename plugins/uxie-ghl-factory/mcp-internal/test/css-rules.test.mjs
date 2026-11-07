// w7-4 (rules 1–3; bl-497, bl-517, bl-529, bl-541; NATIVE_GAPS bl-544): the CSS a caller writes is checked before it is trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssRuleProblems, NATIVE_GAPS } from '../core/css-rules.mjs';

const rules = (css) => cssRuleProblems(css).map((p) => p.rule);
const MIRROR = '@container (max-width:767px){.x{padding:0}}';
const WRAPPER = '.hl-builder-main-wrapper{container-type:inline-size}';

test('bl-497: a font shorthand that mixes inherit with other values is refused, with the line', () => {
  const p = cssRuleProblems('font:600 13px/1 inherit');
  assert.equal(p.length, 1);
  assert.equal(p[0].rule, 'font-shorthand-inherit');
  assert.equal(p[0].line, 1);
  assert.match(p[0].why, /font-\*|separate/);
});

test('bl-497: a lone CSS-wide keyword is valid and not refused (font: inherit, initial, unset, revert)', () => {
  for (const v of ['inherit', 'initial', 'unset', 'revert', 'inherit !important']) {
    assert.deepEqual(cssRuleProblems(`.a{font:${v}}`), [], v);
  }
});

test('bl-529: an @import is refused (GHL concatenates page CSS mid-sheet; the import is ignored)', () => {
  assert.deepEqual(rules('@import url(https://fonts.googleapis.com/css2?family=Newsreader);'), ['import-ignored']);
});

test('bl-541: a mobile @media rule with no @container mirror and no container-type is refused', () => {
  assert.deepEqual(rules('@media (max-width:767px){.x{padding:0}}'), ['mobile-media-no-container-mirror']);
});

test('bl-541: each mobile @media block is checked for its own mirror, not silenced by another block', () => {
  const css = '@media (max-width:767px){.a{padding:0}}'
    + '@media (max-width:767px){.b{padding:0}}'
    + '@container (max-width:767px){.a{padding:0}}'
    + WRAPPER;
  const p = cssRuleProblems(css);
  assert.deepEqual(p.map((x) => x.rule), ['mobile-media-no-container-mirror']);
  assert.match(p[0].why, /\.b/);
  assert.doesNotMatch(p[0].why, /no @container \(max-width:767px\) mirror for: \.a/);
});

test('bl-541: a mirror without the .hl-builder-main-wrapper container-type is refused (the @container never matches)', () => {
  const p = cssRuleProblems('@media (max-width:767px){.x{padding:0}}@container (max-width:767px){.x{padding:0}}');
  assert.deepEqual(p.map((x) => x.rule), ['mobile-media-no-container-mirror']);
  assert.match(p[0].why, /container-type/);
});

test('bl-541: the screen and only-screen media forms are caught too', () => {
  assert.deepEqual(rules('@media screen and (max-width:767px){.x{padding:0}}'), ['mobile-media-no-container-mirror']);
  assert.deepEqual(rules('@media only screen and (max-width: 767px){.x{padding:0}}'), ['mobile-media-no-container-mirror']);
});

test('id-level rule with a mirrored mobile rule and the container-type → no problems', () => {
  const css = '#button-S0C01 .main-heading-button{border-radius:8px}'
    + '@media (max-width:767px){#button-S0C01 .main-heading-button{border-radius:4px}}'
    + '@container (max-width:767px){#button-S0C01 .main-heading-button{border-radius:4px}}'
    + WRAPPER;
  assert.deepEqual(cssRuleProblems(css), []);
});

test('bl-517: a class-level compiled property is refused with or without !important', () => {
  assert.deepEqual(rules('.image-feature img{border-radius:12px}'), ['class-level-selector']);
  assert.deepEqual(rules('.image-feature img{border-radius:12px !important}'), ['class-level-selector']);
});

test('bl-517: a node CLASS is still class-level (class specificity loses to the compiled value)', () => {
  assert.deepEqual(rules('.button-S0C01 .main-heading-button{border-radius:8px}'), ['class-level-selector']);
});

test('bl-517: an id-level (#…) compiled property is not refused, with or without !important', () => {
  assert.deepEqual(cssRuleProblems('#image-feature-AbC12 img{border-radius:12px}'), []);
  assert.deepEqual(cssRuleProblems('#image-feature-AbC12 img{border-radius:12px !important}'), []);
});

test('a clean page rule (a node class, no compiled property) produces no problems', () => {
  assert.deepEqual(cssRuleProblems('.button-S0C01 .main-heading-button{color:#fff}'), []);
});

test('NATIVE_GAPS is frozen; a measured gap has a selector and CSS that pass the checker; an unmeasured gap ships no CSS', () => {
  assert.ok(Object.isFrozen(NATIVE_GAPS));
  for (const g of NATIVE_GAPS) {
    assert.equal(g.cssAllowedOnlyIfAsked, true, g.id);
    assert.match(g.bl, /^bl-\d+$/, g.id);
    if (g.css === null) {
      assert.equal(g.selector, null, g.id);
      assert.match(g.status, /pending measurement/, g.id);
      continue;
    }
    assert.ok(typeof g.selector === 'string' && g.selector.includes('#'), g.id);
    assert.ok(typeof g.css === 'string' && g.css.length > 0, g.id);
    assert.deepEqual(cssRuleProblems(`#popup-P03.popup-body{${g.css}}`), [], g.id);
  }
  assert.ok(NATIVE_GAPS.some((g) => g.bl === 'bl-544' && typeof g.css === 'string'));
  assert.ok(NATIVE_GAPS.some((g) => g.bl === 'bl-542' && g.css === null));
});
