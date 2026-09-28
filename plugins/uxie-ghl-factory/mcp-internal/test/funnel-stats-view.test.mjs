// get_funnel view stats: the Stats tab's per-step read (GET /stats/?funnelId) with step names, plus the Sites Analytics
// totals (/stats/count, /stats/optin/conversion-rate, /stats/video/stats). Shapes mirror the live reads in knowledge
// sniffs/funnels-wave17-analytics-2026-09-29/live-analytics.stats-reads.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'get_funnel');
const deps = (calls, { failPath = null } = {}) => ({ state: {}, makeGw: () => ({ uid: 'U', call: async (m, p) => {
  calls.push({ m, p });
  const j = (json, status = 200) => ({ ok: status < 300, status, json });
  if (failPath && p.startsWith(failPath)) return j({ message: 'boom' }, 500);
  if (p.startsWith('/funnels/funnel/fetch/')) return j({ _id: 'F1', name: 'TEST-CONF-FUN-X', type: 'funnel', steps: [{ id: 'S1', name: 'Optin', pages: ['P1'] }] });
  if (p.startsWith('/stats/?')) return j([{ type: 'step', stepId: 'S1', pageViewsAll: 13, pageViewsUnique: 1, optinsRate: null, saleRate: null, earningsPerPageViewAll: 0, pageStats: [{ pageId: 'P1', pageViewsAll: 13, pageViewsUnique: 1 }] }]);
  if (p.includes('eventType=page_view')) return j({ totalCount: 13 });
  if (p.includes('eventType=sale')) return j({ totalCount: 0, saleValue: 0 });
  if (p.startsWith('/stats/count')) return j({ totalCount: 0 });
  if (p.startsWith('/stats/optin/conversion-rate')) return j({ totalCount: 0 });
  if (p.startsWith('/stats/video/stats')) return j({ data: { videoPlay: 1, averageTime: 100, completion: 100 } });
  return j({ message: `unexpected ${p}` }, 404);
} }) });

test('stats: per-step rows carry the step NAME; totals come from the dashboard reads; GET only', async () => {
  const calls = [];
  const r = await tool.handler({ locationId: 'L', funnelId: 'F1', view: 'stats', from: '2026-09-01', to: '2026-09-29' }, deps(calls));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.steps[0].name, 'Optin');
  assert.equal(r.data.steps[0].pageViewsAll, 13);
  assert.equal(r.data.totals.pageViews, 13);
  assert.equal(r.data.totals.hostedVideo.plays, 1);
  assert.ok(calls.every((c) => c.m === 'GET'), 'read-only');
  assert.ok(calls.some((c) => c.p.includes('fromDate=2026-09-01') && c.p.includes('toDate=2026-09-29') && c.p.includes('type=funnel')));
});

test('stats: a failing read is reported, not turned into zeros (control)', async () => {
  const r = await tool.handler({ locationId: 'L', funnelId: 'F1', view: 'stats' }, deps([], { failPath: '/stats/count' }));
  assert.notEqual(r.ok, true);
});

test('stats: the default window is the last 30 days ending today', async () => {
  const calls = [];
  const r = await tool.handler({ locationId: 'L', funnelId: 'F1', view: 'stats' }, deps(calls));
  const days = (Date.parse(r.data.to) - Date.parse(r.data.from)) / 86400000;
  assert.equal(days, 30);
});
