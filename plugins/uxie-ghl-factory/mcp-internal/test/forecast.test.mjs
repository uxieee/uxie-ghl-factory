import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketEnd, forecastBody, nameMaps, shapeForecast } from '../core/forecast.mjs';

const maps = nameMaps(
  [{ id: 'P', name: 'Sales', stages: [{ id: 's1', name: 'New' }, { id: 's2', name: 'Won-ish' }] }],
  [{ id: 'u1', name: 'Ann Owner' }, { id: 'u2', firstName: 'Bo', lastName: 'Lee' }],
);

test('summary sends locationId in the BODY and the pipeline TOP-LEVEL, as the app does (a filters row drops empty stages)', () => {
  const { body } = forecastBody('summary', { locationId: 'L', groupBy: 'stage', pipelineId: 'P' });
  assert.deepEqual(body, { locationId: 'L', groupBy: 'stage', pipelineId: 'P' });
  // Caller filters still ride as filters, beside the top-level pipeline.
  assert.deepEqual(forecastBody('summary', { locationId: 'L', pipelineId: 'P', filters: [{ field: 'status', operator: 'eq', value: ['open'] }] }).body,
    { locationId: 'L', groupBy: 'status', pipelineId: 'P', filters: [{ field: 'status', operator: 'eq', value: ['open'] }] });
  // CONTROL: timeline keeps the pipeline as a filters row (the app's timeline does).
  assert.deepEqual(forecastBody('timeline', { locationId: 'L', pipelineId: 'P' }).body.filters, [{ field: 'pipeline_id', operator: 'eq', value: ['P'] }]);
  // CONTROL: no pipeline, no filters key at all.
  assert.deepEqual(forecastBody('summary', { locationId: 'L' }).body, { locationId: 'L', groupBy: 'status' });
});

test('close-date bucketing is refused outside groupBy close_date', () => {
  assert.match(forecastBody('summary', { locationId: 'L', groupBy: 'owner', closeDateBucket: 'month' }).error, /close_date/);
  assert.deepEqual(forecastBody('summary', { locationId: 'L', groupBy: 'close_date', closeDateBucket: 'quarter', closeDateMode: 'windowed' }).body,
    { locationId: 'L', groupBy: 'close_date', closeDateBucket: 'quarter', closeDateMode: 'windowed' });
});

const NOT_LOST = [{ field: 'status', operator: 'not_eq', value: 'lost' }, { field: 'status', operator: 'not_eq', value: 'abandoned' }];

test('drilldown is the Forecast tab\'s own list — search, never POST /forecast/drilldown (0 call sites in the app)', () => {
  const r = forecastBody('drilldown', { locationId: 'L', drilldownBy: 'stage', key: 's1', pipelineId: 'P' });
  assert.equal(r.path, '/opportunities/search');
  assert.deepEqual(r.body, { locationId: 'L', page: 1, limit: 10,
    filters: [{ field: 'pipeline_id', operator: 'eq', value: 'P' }, ...NOT_LOST, { field: 'pipeline_stage_id', operator: 'eq', value: 's1' }] });
  assert.match(forecastBody('drilldown', { locationId: 'L' }).error, /drilldownBy/);
});

test('drilldown leaves lost and abandoned out — unless you drill INTO that status', () => {
  const open = forecastBody('drilldown', { locationId: 'L', drilldownBy: 'status', key: 'open' }).body.filters;
  assert.deepEqual(open, [...NOT_LOST, { field: 'status', operator: 'eq', value: 'open' }]);
  // CONTROL: a lost row lists lost deals, so the exclusion is not sent.
  const lost = forecastBody('drilldown', { locationId: 'L', drilldownBy: 'status', key: 'lost' }).body.filters;
  assert.deepEqual(lost, [{ field: 'status', operator: 'eq', value: 'lost' }]);
});

test('KPI tiles: won revenue lists won deals, the other three list open deals; an unknown tile is refused', () => {
  const f = (key) => forecastBody('drilldown', { locationId: 'L', drilldownBy: 'kpi', key }).body?.filters?.at(-1);
  assert.deepEqual(f('closedWon'), { field: 'status', operator: 'eq', value: 'won' });
  for (const k of ['activeOpportunities', 'bestCase', 'weightedForecast']) assert.deepEqual(f(k), { field: 'status', operator: 'eq', value: 'open' });
  assert.match(forecastBody('drilldown', { locationId: 'L', drilldownBy: 'kpi', key: 'wonValue' }).error, /closedWon/);
});

test('owner drilldown: the summary\'s __unassigned__ row becomes the app\'s __none__ filter', () => {
  const last = (key) => forecastBody('drilldown', { locationId: 'L', drilldownBy: 'owner', key }).body.filters.at(-1);
  assert.deepEqual(last('__unassigned__'), { field: 'assigned_to', operator: 'eq', value: ['__none__'] });
  assert.deepEqual(last('u1'), { field: 'assigned_to', operator: 'eq', value: 'u1' });
});

test('close-date buckets: month and quarter page forecast/column, a year searches a close-date range', () => {
  assert.equal(bucketEnd('2026-11-01', 'month'), '2026-11-30');
  assert.equal(bucketEnd('2026-10-01', 'quarter'), '2026-12-31');
  assert.equal(bucketEnd('2024-02-01', 'month'), '2024-02-29');
  assert.equal(bucketEnd('2026-01-01', 'year'), '2026-12-31');
  const q = forecastBody('drilldown', { locationId: 'L', drilldownBy: 'close_date', key: '2026-10-01', closeDateBucket: 'quarter', page: 2, limit: 5 });
  assert.equal(q.path, '/opportunities/forecast/column');
  assert.deepEqual(q.body, { locationId: 'L', startDate: '2026-10-01', endDate: '2026-12-31', periodType: 'quarter', filters: NOT_LOST, query: '', sort: [], page: 2, limit: 5 });
  const y = forecastBody('drilldown', { locationId: 'L', drilldownBy: 'close_date', key: '2026-01-01', closeDateBucket: 'year' });
  assert.equal(y.path, '/opportunities/search');
  assert.deepEqual(y.body.filters.at(-1), { field: 'forecast_expected_close_date', operator: 'range', value: { gte: Date.parse('2026-01-01T00:00:00.000Z'), lte: Date.parse('2026-12-31T23:59:59.999Z') } });
  assert.match(forecastBody('drilldown', { locationId: 'L', drilldownBy: 'close_date', key: 'Nov' }).error, /YYYY-MM-DD/);
  // CONTROL: the earlier periodStart contract lands on the same month bucket.
  assert.deepEqual(forecastBody('drilldown', { locationId: 'L', periodStart: '2026-11-01', metric: 'weighted' }).body,
    forecastBody('drilldown', { locationId: 'L', drilldownBy: 'close_date', key: '2026-11-01' }).body);
});

test('timeline pages with page and limit; without them the body carries neither', () => {
  assert.deepEqual(forecastBody('timeline', { locationId: 'L', periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30', page: 2, limit: 5 }).body,
    { locationId: 'L', periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30', page: 2, limit: 5 });
  assert.deepEqual(forecastBody('timeline', { locationId: 'L' }).body, { locationId: 'L' });
});

test('summary refuses the year bucket — measured with month and quarter only', () => {
  assert.match(forecastBody('summary', { locationId: 'L', groupBy: 'close_date', closeDateBucket: 'year' }).error, /month and quarter/);
});

test('stage and owner rows get their NAMES — the service labels them with the uuid', () => {
  const out = shapeForecast('summary', { grouping: { groupBy: 'stage', rows: [{ key: 's1', label: 's1', weighted: 5 }, { key: 'gone', label: 'gone' }] } }, maps);
  assert.deepEqual(out.rows.map((r) => r.label), ['New', 'gone']);
  const own = shapeForecast('summary', { grouping: { groupBy: 'owner', rows: [{ key: 'u2', label: 'u2' }, { key: '__unassigned__', label: 'Unassigned' }] } }, maps);
  assert.deepEqual(own.rows.map((r) => r.label), ['Bo Lee', 'Unassigned']);
  // CONTROL: status labels are the service's own and pass through.
  assert.equal(shapeForecast('summary', { grouping: { groupBy: 'status', rows: [{ key: 'open', label: 'Open' }] } }, maps).rows[0].label, 'Open');
});

test('opportunity rows are concise, with pipeline, stage and owner names beside nothing but ids', () => {
  const out = shapeForecast('drilldown', { total: 1, opportunities: [{ id: 'o1', name: 'Deal', pipelineId: 'P', pipelineStageId: 's2', ownerId: 'u1', status: 'open', monetaryValue: 2000, effectiveProbability: 35, forecastExpectedCloseDate: '2026-11-20', contribution: 700 }] }, maps);
  assert.deepEqual(out.opportunities[0], { id: 'o1', name: 'Deal', status: 'open', value: 2000, pipeline: 'Sales', stage: 'Won-ish', owner: 'Ann Owner', closeDate: '2026-11-20', probability: 35, contribution: 700 });
});

test('slippage rows use their own keys (stage, probability, newCloseDate) and still get names', () => {
  const out = shapeForecast('slippage', { summary: { groups: [] }, opportunities: [{ id: 'o1', name: 'Deal', pipelineId: 'P', amount: 2000, probability: 10, stage: 's1', owner: 'u1', ownerId: 'u1', origCloseDate: '2026-10-15', newCloseDate: '2026-11-20', daysSlipped: 36, slippageCount: 1, lastSlippedAt: 'T', risk: 'high' }] }, maps);
  assert.deepEqual(out.opportunities[0], { id: 'o1', name: 'Deal', status: undefined, value: 2000, pipeline: 'Sales', stage: 'New', owner: 'Ann Owner', closeDate: '2026-11-20', probability: 10, slipped: { times: 1, days: 36, from: '2026-10-15', lastAt: 'T' }, risk: 'high' });
});
