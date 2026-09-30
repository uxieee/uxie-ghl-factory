// Page text / link colour (the Typography panel's two swatches). Shape measured from a builder Save after picking Red and Cobalt
// (knowledge sniffs/funnels-wave42-f7-defaults-2026-09-30/live-read.typography-ui.json):
//   typography.colors.textColor = {value:{label:'var(--black)', value:'var(--red)'}}   (the label keeps the slot's previous label)
//   :root { --text-color: var(--red); --link-color: var(--cobalt) }
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageColorValue, setPageColors } from '../core/page-fonts.mjs';
import { applyPageEdits, verifyEdits } from '../core/page-edit.mjs';
import { buildPageData } from '../core/funnel-pages.mjs';

test('a palette name, a var() reference or a hex colour; anything else is refused with the choices', () => {
  assert.equal(pageColorValue('red'), 'var(--red)');
  assert.equal(pageColorValue('Cobalt'), 'var(--cobalt)');
  assert.equal(pageColorValue('var(--blue)'), 'var(--blue)');
  assert.equal(pageColorValue('#1A2B3C'), '#1a2b3c');
  assert.equal(pageColorValue('#fff'), '#fff');
  assert.throws(() => pageColorValue('crimson', 'linkColor'), /typography\.linkColor: "crimson" is neither a palette colour/);
  assert.throws(() => pageColorValue('rgb(1,2,3)'), /neither a palette colour/);
});

test('setPageColors writes the builder\'s stored shape (label kept) and rewrites the :root variables in place', () => {
  const pd = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [] });
  setPageColors(pd, { textColor: 'red', linkColor: 'cobalt' });
  assert.deepEqual(pd.settings.settings.typography.colors.textColor, { value: { label: 'var(--black)', value: 'var(--red)' } });
  assert.deepEqual(pd.settings.settings.typography.colors.linkColor, { value: { label: 'var(--blue)', value: 'var(--cobalt)' } });
  assert.match(pd.pageStyles, /--text-color:\s*var\(--red\)/);
  assert.match(pd.pageStyles, /--link-color:\s*var\(--cobalt\)/);
  assert.doesNotMatch(pd.pageStyles, /--text-color:\s*#000000/, 'the default declaration is replaced, not left to win the cascade');
});

test('naming only one leaves the other slot as it was', () => {
  const pd = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [] });
  setPageColors(pd, { linkColor: '#ff0000' });
  assert.equal(pd.settings.settings.typography.colors.linkColor.value.value, '#ff0000');
  assert.equal(pd.settings.settings.typography.colors.textColor.value.value, '#000000');
});

test('edit: the page op takes textColor / linkColor and verifies both the setting and the variable', () => {
  const pd = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [] });
  const { pageData, report, errors } = applyPageEdits(structuredClone(pd), [{ op: 'page', typography: { textColor: 'red' } }]);
  assert.deepEqual(errors, []);
  assert.ok(verifyEdits(pageData, report).every((v) => v.applied), JSON.stringify(verifyEdits(pageData, report)));
  assert.equal(verifyEdits(pd, report)[0].applied, false, 'the unedited page fails the check (non-vacuous)');
});
