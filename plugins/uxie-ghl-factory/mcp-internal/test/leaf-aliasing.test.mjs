// makeLeaf hands out nodes in which no two keys share one object: the builder's registry defaults share a desktop and a tablet
// font-size object, and a write through one key (an in-place edit, a delete) must not change its sibling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENT_KINDS, makeLeaf } from '../core/funnel-pages.mjs';
import { applyPageEdits } from '../core/page-edit.mjs';

const sharedPairs = (node) => { const seen = new Map(); const hits = []; const walk = (o, p) => { if (o && typeof o === 'object') { if (seen.has(o)) hits.push([seen.get(o), p]); else { seen.set(o, p); for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`); } } }; walk(node, ''); return hits; };

test('no kind\'s leaf shares an object between two keys', () => {
  for (const k of ELEMENT_KINDS) { let n; try { n = makeLeaf({ meta: k }); } catch { continue; } assert.deepEqual(sharedPairs(n), [], k); }
});

test('setting one font-size key in place leaves its sibling alone (compose, then an edit of the composed node in the same call)', () => {
  const leaf = makeLeaf({ meta: 'featured-products' });
  assert.notEqual(leaf.extra.priceDiscountDesktopFontSize, leaf.extra.priceDiscountTabletFontSize);
  leaf.extra.priceDiscountDesktopFontSize.value = 31;   // a write THROUGH the key (no replacement)
  assert.equal(leaf.extra.priceDiscountTabletFontSize.value, 16, 'the tablet key still has its own value');
  delete leaf.extra.priceDiscountDesktopFontSize.value;
  assert.equal(leaf.extra.priceDiscountTabletFontSize.value, 16);
  const page = { sections: [{ id: 's1', general: { sectionStyles: '' }, metaData: { id: 's1' }, elements: [makeLeaf({ meta: 'featured-products' })] }] };
  const id = page.sections[0].elements[0].id;
  const { pageData, errors } = applyPageEdits(page, [{ op: 'set', nodeId: id, extra: { priceDiscountDesktopFontSize: { value: 22, unit: 'px' } } }]);
  assert.deepEqual(errors, []);
  const n = pageData.sections[0].elements[0];
  assert.equal(n.extra.priceDiscountDesktopFontSize.value, 22);
  assert.equal(n.extra.priceDiscountTabletFontSize.value, 16);
});
