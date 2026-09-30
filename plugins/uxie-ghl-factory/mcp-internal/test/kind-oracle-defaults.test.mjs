// The runtime defaults of the f7 kinds (core/kind-oracle-defaults.mjs), measured from nodes the page builder made itself
// (knowledge sniffs/funnels-wave42-f7-defaults-2026-09-30). The value-by-value parity lives in default-props-parity.test.mjs; these pin the
// behaviours that matter and their overrides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLeaf } from '../core/funnel-pages.mjs';
import { KIND_TAGNAME, KIND_ORACLE_EXTRA } from '../core/kind-oracle-defaults.mjs';

test('the day and minute timers are the countdown component: tagName c-countdown (a null tagName rendered nothing)', () => {
  assert.equal(makeLeaf({ meta: 'day-timer' }).tagName, 'c-countdown');
  assert.equal(makeLeaf({ meta: 'minute-timer' }).tagName, 'c-countdown');
  assert.equal(makeLeaf({ meta: 'countdown' }).tagName, 'c-countdown');
  assert.deepEqual(Object.keys(KIND_TAGNAME).sort(), ['day-timer', 'minute-timer']);
});

test('timers and the countdown carry the page content font, the navigation menu its headline font', () => {
  for (const k of ['countdown', 'day-timer', 'minute-timer']) assert.equal(makeLeaf({ meta: k }).extra.typography.value, 'var(--contentfont)', k);
  assert.equal(makeLeaf({ meta: 'nav-menu-v2' }).extra.typography.value, 'var(--headlinefont)');
});

test('a fresh countdown is dated now (both dates the same instant); a caller\'s date wins', () => {
  const n = makeLeaf({ meta: 'countdown' }).extra;
  assert.equal(n.startDate.value, n.endDate.value);
  assert.ok(Math.abs(Date.parse(n.endDate.value) - Date.now()) < 5000);
  assert.equal(makeLeaf({ meta: 'countdown', extra: { endDate: { value: '2030-01-01T00:00:00.000Z' } } }).extra.endDate.value, '2030-01-01T00:00:00.000Z');
  assert.equal(KIND_ORACLE_EXTRA.countdown('T').startDate.value, 'T');
});

test('the navigation menu v2 takes the builder\'s fresh styles and leaves its sample content out', () => {
  const n = makeLeaf({ meta: 'nav-menu-v2' });
  assert.equal(n.styles.navMenuAlign.value, 'left');
  assert.equal(n.styles.navMenuItemSpacingX.value, 12);
  assert.equal(n.styles.hoverBackgroundColor.value, 'var(--cobalt)');
  assert.equal(n.extra.showSearchbar.value, false);
  assert.equal(n.extra.desktopFontSize.value, 14);
  assert.deepEqual(n.extra.menuItems.value, [], 'no stock Home/About/Contact items');
  assert.ok(!/storage\.googleapis/.test(JSON.stringify(n.extra.imageProperties)), 'no stock logo published on a client page');
});

test('the blog lists 6 posts and has the builder\'s filled cobalt button', () => {
  const n = makeLeaf({ meta: 'blog' });
  assert.equal(n.extra.paginationOverride.value, 6);
  assert.equal(n.styles.buttonColor.value, 'var(--cobalt)');
});

test('blog-post carries blogAuthor (the prop the sweep found missing)', () => {
  assert.deepEqual(makeLeaf({ meta: 'blog-post' }).extra.blogAuthor, { value: [] });
});

test('a page countdown leaves off the four webinar* props (the builder does not write them and a Save drops them); a caller can still name one', () => {
  assert.deepEqual(Object.keys(makeLeaf({ meta: 'countdown' }).extra).filter((k) => /^webinar/.test(k)), []);
  assert.deepEqual(makeLeaf({ meta: 'countdown', extra: { webinarRedirectUrl: { value: 'https://example.com' } } }).extra.webinarRedirectUrl, { value: 'https://example.com' });
});

test('the audit does not flag the webinar* props a page countdown leaves off, but still flags a real missing prop', async () => {
  const { auditPageData, buildPageData } = await import('../core/funnel-pages.mjs');
  const node = makeLeaf({ meta: 'countdown' });
  const pd = buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [{ id: 's', type: 'section', metaData: { child: [] }, elements: [node] }] });
  assert.deepEqual(auditPageData(pd).filter((p) => /missing declared extra props/.test(p)), []);
  delete node.extra.timezone;
  assert.match(auditPageData(pd).join('\n'), /missing declared extra props timezone/);
});

test('product detail customText carries the labels a builder Save adds (description show more / less, view full details)', () => {
  for (const meta of ['store-product-detail', 'store-custom-product-detail']) {
    const c = makeLeaf({ meta }).extra.customText.value.productDetailSection;
    assert.equal(c.descriptionShowMoreText, 'Show more', meta);
    assert.equal(c.descriptionShowLessText, 'Show less', meta);
    assert.equal(c.viewDetailsModalButtonText, 'View full details', meta);
  }
  const own = makeLeaf({ meta: 'store-product-detail', extra: { customText: { value: { productDetailSection: { descriptionShowMoreText: 'More' } } } } }).extra.customText.value.productDetailSection;
  assert.equal(own.descriptionShowMoreText, 'More', 'a caller\'s customText is used as given');
});
