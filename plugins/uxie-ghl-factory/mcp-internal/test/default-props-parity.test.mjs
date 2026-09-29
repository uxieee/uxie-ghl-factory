// Default props of the three store kinds the completeness sweep reopened (store-product-list, collection-list, featured-products), against nodes the
// page builder itself made (test/fixtures/builder-created-nodes.json; knowledge sniffs/funnels-wave36-default-props-2026-09-30). The sweep's claim was
// "props neither filled nor audited" and "name-guessed empty defaults flip visible behaviour". Pinned here: every prop the builder writes is on the tool's
// bare node, and every VALUE is equal except a short list of stated differences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeLeaf } from '../core/funnel-pages.mjs';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/builder-created-nodes.json', import.meta.url), 'utf8'));
const LAYERS = ['extra', 'styles', 'wrapper', 'class'];

// Each entry: why the tool's bare node deliberately differs from what Quick Add makes.
const STATED = {
  'collection-list': {
    'extra.text': 'CONTENT: the builder fills the headline "Collections"; a bare tool node is the builder\'s fresh node minus content',
    'extra.collectionListItems': 'CONTENT: the builder adds three empty placeholder items; the tool has none until the caller names collections',
    'extra.typography': 'the tool sets a typography variable only when `font` is named (headline / content)',
    'extra.visibility': 'the builder also writes hideTablet:false; absent is false',
    'styles.fontWeight': 'the tool adds mobile:"400" — a builder save compiles an absent mobile weight to `undefined` (wave19)',
    'styles.fontWeightSub': 'same', 'styles.borderColor': 'template-proven style table (kind-style-defaults), border width 0 — nothing visible',
    'styles.borderWidth': 'same', 'styles.borderStyle': 'same', 'styles.borderRadius': 'same',
  },
  'featured-products': {
    'extra.text': 'CONTENT: the builder fills the headline "Featured Products"',
    'extra.featuredProductsItems': 'CONTENT: three empty placeholder product entries in the builder',
    'extra.typography': 'as collection-list', 'extra.visibility': 'as collection-list',
    'styles.fontWeight': 'as collection-list', 'styles.fontWeightSub': 'same', 'styles.fontWeightExtra': 'same',
    'styles.borderColor': 'as collection-list', 'styles.borderWidth': 'same', 'styles.borderStyle': 'same', 'styles.borderRadius': 'same',
  },
  'store-product-list': {
    // the fixture node is the SYSTEM template of a store's product-list page, made by an older builder: its empty values are the name-guessed empties the sweep flagged
    'extra.itemsPerPage': 'the older template has [] (page size / API limit); the builder registry default is 6 and the renderer\'s `?? 6` misses []',
    'extra.enableWishlisting': 'the older template has [] (truthy: wishlist shown); the builder default is false',
    'extra.featureHeadlineTabletFontSize': 'the older template has an empty size; a builder save prints `undefined` for it',
    'extra.priceDiscountTabletFontSize': 'same', 'extra.addToCart': 'template has "" (falsy = off), tool false', 'extra.defaultSortingOption': 'template "" — the registry default id_desc',
    'extra.customText': 'the template predates the filter / sort labels; the tool carries the current set', 'extra.mobileColumns': 'template empty; registry 2',
    'styles.fontWeight': 'mobile weight as above', 'styles.fontWeightSub': 'same', 'styles.fontWeightExtra': 'same',
  },
};

const cases = [...Object.entries(FIX.builderCreated), ...Object.entries(FIX.systemTemplate)];
for (const [kind, built] of cases) {
  test(`${kind}: every prop the builder-made node has is on the tool's bare node`, () => {
    const tool = JSON.parse(JSON.stringify(makeLeaf({ meta: kind })));
    for (const layer of LAYERS) {
      const missing = Object.keys(built[layer] ?? {}).filter((k) => k !== 'nodeId' && !(k in (tool[layer] ?? {})));
      assert.deepEqual(missing, [], `${layer}: props the builder writes and the tool does not`);
    }
  });
  test(`${kind}: every value equals the builder's, except the stated differences`, () => {
    const tool = JSON.parse(JSON.stringify(makeLeaf({ meta: kind })));
    const stated = STATED[kind] ?? {};
    const unexplained = [];
    for (const layer of LAYERS) for (const [k, v] of Object.entries(built[layer] ?? {})) {
      if (k === 'nodeId' || !(k in (tool[layer] ?? {}))) continue;
      if (JSON.stringify(v) !== JSON.stringify(tool[layer][k]) && !stated[`${layer}.${k}`]) unexplained.push(`${layer}.${k}: builder ${JSON.stringify(v).slice(0, 80)} tool ${JSON.stringify(tool[layer][k]).slice(0, 80)}`);
    }
    assert.deepEqual(unexplained, []);
    // and a stated difference that has stopped differing is stale text to delete
    const stale = Object.keys(stated).filter((p) => { const [layer, k] = p.split(/\.(.+)/); return built[layer]?.[k] !== undefined && JSON.stringify(built[layer][k]) === JSON.stringify(tool[layer]?.[k]); });
    assert.deepEqual(stale, [], 'stated differences that no longer differ');
  });
}

test('the name-guessed empties the sweep named are not on the tool node: itemsPerPage 6 and enableWishlisting false, on all three kinds that declare them', () => {
  const list = makeLeaf({ meta: 'store-product-list' }).extra;
  assert.equal(list.itemsPerPage.value, 6);
  assert.equal(list.enableWishlisting.value, false);
  assert.equal(makeLeaf({ meta: 'featured-products' }).extra.enableWishlisting.value, false);
});
