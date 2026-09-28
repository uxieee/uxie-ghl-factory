import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastBody, nameMaps, shapeForecast } from '../core/forecast.mjs';

const maps = nameMaps(
  [{ id: 'P', name: 'Sales', stages: [{ id: 's1', name: 'New' }, { id: 's2', name: 'Won-ish' }] }],
  [{ id: 'u1', name: 'Ann Owner' }, { id: 'u2', firstName: 'Bo', lastName: 'Lee' }],
);

test('summary sends locationId in the BODY and the pipeline as a pipeline_id filter', () => {
  const { body } = forecastBody('summary', { locationId: 'L', groupBy: 'stage', pipelineId: 'P' });
  assert.deepEqual(body, { locationId: 'L', groupBy: 'stage', filters: [{ field: 'pipeline_id', operator: 'eq', value: ['P'] }] });
  // CONTROL: no pipeline, no filters key at all.
  assert.deepEqual(forecastBody('summary', { locationId: 'L' }).body, { locationId: 'L', groupBy: 'status' });
});

test('close-date bucketing is refused outside groupBy close_date', () => {
  assert.match(forecastBody('summary', { locationId: 'L', groupBy: 'owner', closeDateBucket: 'month' }).error, /close_date/);
  assert.deepEqual(forecastBody('summary', { locationId: 'L', groupBy: 'close_date', closeDateBucket: 'quarter', closeDateMode: 'windowed' }).body,
    { locationId: 'L', groupBy: 'close_date', closeDateBucket: 'quarter', closeDateMode: 'windowed' });
});

test('drilldown needs periodStart and metric, and sends nothing it was not measured with', () => {
  assert.match(forecastBody('drilldown', { locationId: 'L' }).error, /periodStart/);
  assert.match(forecastBody('drilldown', { locationId: 'L', periodStart: '2026-11-01', metric: 'weighted', pipelineId: 'P' }).error, /not sent rather than guessed/);
  assert.deepEqual(forecastBody('drilldown', { locationId: 'L', periodStart: '2026-11-01', metric: 'weighted' }).body, { locationId: 'L', periodStart: '2026-11-01', metric: 'weighted' });
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
