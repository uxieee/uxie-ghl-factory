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
// key order is not a value: the builder writes {unit, value} where the tool writes {value, unit}
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

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
  // f7 (knowledge sniffs/funnels-wave42-f7-defaults-2026-09-30): kinds whose fresh node the builder makes at runtime — see core/kind-oracle-defaults.mjs
  countdown: {
    'extra.startDate': 'CLOCK: the builder dates a fresh countdown at the moment it is made; the tool does the same at compose time (the value differs by the seconds between the two)',
    'extra.endDate': 'same', 'extra.visibility': 'the builder also writes hideTablet:false; absent is false',
    'styles.fontWeight': 'the tool adds mobile:"700" — a builder save compiles an absent mobile weight to `undefined` (wave19)', 'styles.fontWeightSub': 'same',
  },
  'day-timer': { 'extra.visibility': 'as countdown', 'styles.fontWeight': 'as countdown', 'styles.fontWeightSub': 'same' },
  'minute-timer': { 'extra.visibility': 'as countdown', 'styles.fontWeight': 'as countdown', 'styles.fontWeightSub': 'same' },
  'nav-menu-v2': {
    'extra.menuItems': 'CONTENT: the builder seeds Home / About / Contact sample items; the tool has none until the caller names the menu',
    'extra.cacItems': 'CONTENT: the builder seeds My Orders / Logout for the customer-account menu',
    'extra.imageProperties': 'CONTENT: the builder seeds a stock "Brand Logo" image; publishing one on a client page is worse than no logo',
    'extra.text': 'CONTENT: the builder seeds "Business Name"', 'extra.visibility': 'as countdown',
    'styles.letterSpacing': 'the builder stores the string "0"; the tool the number 0 (same length)',
    'styles.fontWeight': 'as countdown',
  },
  blog: { 'extra.visibility': 'as countdown' },
  // f8 (knowledge sniffs/funnels-wave45-f8-2026-09-30): a Countdown Timer ASSET dragged from the Add Elements panel. A bare tool node names no asset; the
  // values below are what the builder copies from the asset it binds — assetBindingExtra writes them when compose names countdownTimerId (test/marketing-countdown.test.mjs).
  'marketing-countdown': {
    'extra.visibility': 'as countdown',
    'extra.timerType': 'ASSET: the builder copies the bound asset\'s type (fixed here), disabled',
    'extra.startDate': 'ASSET / CLOCK: the moment of binding', 'extra.endDate': 'ASSET: the asset\'s end', 'extra.endTime': 'ASSET: the end\'s wall clock (the builder wrote its browser\'s zone)',
    'extra.expireAction': 'ASSET: the same value, marked disabled', 'extra.redirectUrl': 'ASSET: the same value, marked disabled',
    'extra.timezone': 'ASSET: the asset\'s timezone and adaptToContactTimezone, disabled', 'extra.countdownTimerId': 'the caller names the asset',
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
      if (canon(v) !== canon(tool[layer][k]) && !stated[`${layer}.${k}`]) unexplained.push(`${layer}.${k}: builder ${JSON.stringify(v).slice(0, 80)} tool ${JSON.stringify(tool[layer][k]).slice(0, 80)}`);
    }
    assert.deepEqual(unexplained, []);
    // and a stated difference that has stopped differing is stale text to delete
    const stale = Object.keys(stated).filter((p) => { const [layer, k] = p.split(/\.(.+)/); return built[layer]?.[k] !== undefined && canon(built[layer][k]) === canon(tool[layer]?.[k]); });
    assert.deepEqual(stale, [], 'stated differences that no longer differ');
  });
}

test('the name-guessed empties the sweep named are not on the tool node: itemsPerPage 6 and enableWishlisting false, on all three kinds that declare them', () => {
  const list = makeLeaf({ meta: 'store-product-list' }).extra;
  assert.equal(list.itemsPerPage.value, 6);
  assert.equal(list.enableWishlisting.value, false);
  assert.equal(makeLeaf({ meta: 'featured-products' }).extra.enableWishlisting.value, false);
});
