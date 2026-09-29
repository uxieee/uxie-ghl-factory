// get_funnel analytics: Advanced filters, filter-values, video engagement, the Sales tab. Wire shapes are the ones the Analytics screen sent
// (knowledge sniffs/funnels-wave40-f5d-analytics-2026-09-30 ui-reads.after-city-filter.txt) and the live differentials in live-filter-*.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { planAdvancedFilters, videoFilters, videoView, ordersView, filterQuery, FILTER_FIELDS, MAX_FILTER_GROUPS } from '../core/funnel-analytics.mjs';

const G = (group, ...filters) => ({ group, filters });
const C = (field, operator, ...value) => ({ field, operator, value });

test('planAdvancedFilters: the screen\'s wire object, defaults OR / AND / in, and every refusal the server would 422', () => {
  const p = planAdvancedFilters({ filters: [{ filters: [{ field: 'city', value: ['Batangas'] }] }] });
  assert.deepEqual(p.filters, { group: 'OR', filters: [{ group: 'AND', filters: [{ field: 'city', operator: 'in', value: ['Batangas'] }] }] });
  assert.equal(filterQuery(p.filters), `&advancedFilters=${encodeURIComponent('{"group":"OR","filters":[{"group":"AND","filters":[{"field":"city","operator":"in","value":["Batangas"]}]}]}')}`);
  assert.equal(planAdvancedFilters(undefined).filters, null);
  assert.equal(planAdvancedFilters({ filters: [] }).filters, null, 'no groups = no filter (the screen sends none)');
  assert.equal(filterQuery(null), '');
  const r = (spec) => planAdvancedFilters(spec).refuse;
  assert.match(r({ filters: [{ filters: [{ field: 'nope', value: ['x'] }] }] }), /field is one of city, region/);
  assert.match(r({ filters: [{ filters: [{ field: 'city', operator: 'eq', value: ['x'] }] }] }), /"in" \(is\) or "not_in"/);
  assert.match(r({ filters: [{ filters: [{ field: 'city', value: [] }] }] }), /non-empty list/);
  assert.match(r({ filters: Array.from({ length: MAX_FILTER_GROUPS + 1 }, () => ({ filters: [{ field: 'city', value: ['x'] }] })) }), /at most 5 filter groups/);
  assert.match(r({ filters: [{ filters: Array.from({ length: 6 }, () => ({ field: 'city', value: ['x'] })) }] }), /at most 5 conditions/);
  assert.match(r({ filters: [{ filters: [] }] }), /non-empty filters list/);
  assert.match(r('city'), /filters is \{group/);
  assert.equal(FILTER_FIELDS.length, 8);
});

test('videoFilters: only pageId and deviceType reach the video read, deviceType renamed device (live: deviceType and city answered 400)', () => {
  const f = planAdvancedFilters({ group: 'OR', filters: [{ filters: [{ field: 'city', value: ['Batangas'] }, { field: 'deviceType', value: ['desktop'] }] }, { filters: [{ field: 'country', value: ['PH'] }] }] }).filters;
  const v = videoFilters(f);
  assert.deepEqual(v.filters, G('OR', G('AND', C('device', 'in', 'desktop'))));
  assert.deepEqual(v.dropped.sort(), ['city', 'country']);
  assert.equal(videoFilters(planAdvancedFilters({ filters: [{ filters: [{ field: 'city', value: ['x'] }] }] }).filters).filters, null, 'nothing left → the video read is sent unfiltered, as the screen does');
  assert.equal(videoFilters(null).filters, null);
});

test('videoView: the Video engagement cards and graph; percent fields stay percent', () => {
  const v = videoView({ videoPlay: 2, averageTime: 67, videoPauses: 1, completion: 100, dropOffSpike: 50, graphData: { xAxis: [0, 10, 20], yAxis: [1, 0, 1] } });
  assert.deepEqual(v, { plays: 2, pauses: 1, completionPct: 100, averageWatchedPct: 67, dropOffSpikePct: 50, progress: [{ atPct: 0, users: 1 }, { atPct: 10, users: 0 }, { atPct: 20, users: 1 }] });
  assert.deepEqual(videoView(undefined), { plays: 0, pauses: 0, completionPct: null, averageWatchedPct: null, dropOffSpikePct: null, progress: [] });
});

test('ordersView: step and product names joined, contactId kept, no contact PII', () => {
  const rows = ordersView([{ _id: 'O1', contactId: 'C1', stepId: 'S1', productId: 'P1', amount: 10, currency: 'gbp', chargeId: 'ch_1', dateAdded: '2026-09-01' }],
    { steps: [{ id: 'S1', name: 'Checkout' }], products: { P1: { productName: 'Thing' } } });
  assert.deepEqual(rows, [{ orderId: 'O1', contactId: 'C1', stepId: 'S1', stepName: 'Checkout', productId: 'P1', productName: 'Thing', amount: 10, currency: 'gbp', chargeId: 'ch_1', dateAdded: '2026-09-01' }]);
  assert.deepEqual(ordersView(undefined), []);
});

// ── the tool ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const tool = TOOLS.find((t) => t.name === 'get_funnel');
const deps = (calls) => ({ state: {}, makeGw: () => ({ uid: 'U', call: async (m, p) => {
  calls.push({ m, p });
  const j = (json, status = 200) => ({ ok: status < 300, status, json });
  if (p.startsWith('/funnels/funnel/fetch/')) return j({ _id: 'F1', name: 'TEST-CONF-FUN-X', type: 'funnel', steps: [{ id: 'S1', name: 'Checkout', pages: ['P1'], products: [{ id: 'P9', productName: 'Thing' }] }] });
  if (p.startsWith('/stats/filter-values')) return j({ field: 'city', values: [{ value: 'Batangas' }, { value: '40', label: 'Calabarzon' }] });
  if (p.startsWith('/funnels/order')) return j({ data: [{ _id: 'O1', contactId: 'C1', stepId: 'S1', productId: 'P9', amount: 5, currency: 'gbp', chargeId: 'ch_1', dateAdded: '2026-09-02' }], count: 1 });
  if (p.startsWith('/stats/?')) return j([{ type: 'step', stepId: 'S1', pageViewsAll: 3, pageViewsUnique: 1, pageStats: [] }]);
  if (p.startsWith('/stats/video/stats')) return j({ data: { videoPlay: 2, averageTime: 67, videoPauses: 1, completion: 100, dropOffSpike: 50, graphData: { xAxis: [0, 100], yAxis: [1, 1] } } });
  if (p.startsWith('/stats/')) return j({ totalCount: 3, saleValue: 0 });
  return j({ message: `unexpected ${p}` }, 404);
} }) });
const get = (args, calls = []) => tool.handler({ locationId: 'L', funnelId: 'F1', ...args }, deps(calls));

test('stats with filters: the totals and the per-step rows carry advancedFilters; the video read only page/device; the numbers say what was not applied', async () => {
  let calls = [];
  const r = await get({ view: 'stats', from: '2026-09-16', to: '2026-09-30', filters: { filters: [{ filters: [{ field: 'city', value: ['Batangas'] }, { field: 'deviceType', value: ['desktop'] }] }] } }, calls);
  assert.equal(r.ok, true, JSON.stringify(r));
  const wire = (path) => decodeURIComponent(calls.find((c) => c.p.startsWith(path)).p);
  assert.match(wire('/stats/count'), /advancedFilters=\{"group":"OR","filters":\[\{"group":"AND","filters":\[\{"field":"city","operator":"in","value":\["Batangas"\]\},\{"field":"deviceType"/);
  assert.match(wire('/stats/?'), /advancedFilters=/);
  assert.match(wire('/stats/video/stats'), /includeGraphData=true&advancedFilters=\{"group":"OR","filters":\[\{"group":"AND","filters":\[\{"field":"device","operator":"in","value":\["desktop"\]\}\]\}\]\}/);
  assert.ok(!/city/.test(wire('/stats/video/stats')), 'city never reaches the video read');
  assert.equal(r.data.totals.hostedVideo.pauses, 1);
  assert.equal(r.data.totals.hostedVideo.dropOffSpikePct, 50);
  assert.equal(r.data.totals.hostedVideo.progress.length, 2);
  assert.match(r.data.notes.join(' '), /city was not applied to the video numbers/);
  assert.ok(calls.every((c) => c.m === 'GET'));
  const plain = await get({ view: 'stats' }, calls = []);
  assert.ok(!calls.some((c) => /advancedFilters/.test(c.p)), 'no filters → none sent');
  assert.equal(plain.data.filters, undefined);
});

test('stats: a bad filter is refused before any read', async () => {
  const calls = [];
  const r = await get({ view: 'stats', filters: { filters: [{ filters: [{ field: 'city', value: [] }] }] } }, calls);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.equal(calls.filter((c) => c.p.startsWith('/stats')).length, 0);
});

test('filter-values: the values a filter can pick; needs a field; 20 per call', async () => {
  const calls = [];
  const r = await get({ view: 'filter-values', field: 'city', search: 'bat', from: '2026-09-16', to: '2026-09-30' }, calls);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.values, [{ value: 'Batangas' }, { value: '40', label: 'Calabarzon' }]);
  const p = calls.find((c) => c.p.startsWith('/stats/filter-values')).p;
  assert.match(p, /field=city&limit=20&offset=0&search=bat/);
  assert.match(p, /funnelId=F1&type=funnel/);
  assert.equal((await get({ view: 'filter-values' })).code, 'VALIDATION_FAILED');
  assert.equal((await get({ view: 'filter-values', field: 'city', limit: 50 })).code, 'VALIDATION_FAILED');
});

test('sales: the Sales tab\'s order list with step and product names, and the version-1 note', async () => {
  const calls = [];
  const r = await get({ view: 'sales', from: '2026-08-30', to: '2026-09-30', limit: 10 }, calls);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.count, 1);
  assert.deepEqual([r.data.orders[0].stepName, r.data.orders[0].productName, r.data.orders[0].amount], ['Checkout', 'Thing', 5]);
  assert.match(calls.find((c) => c.p.startsWith('/funnels/order')).p, /funnelId=F1&startDate=2026-08-30&endDate=2026-09-30&limit=10&skip=0/);
  assert.match(r.data.note, /VERSION 1 order forms only/);
  assert.match(r.data.note, /Payments/);
});
