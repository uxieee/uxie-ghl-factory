// w6c-9 (plan Task 9, bl-789): the heat-map roll-up, pure. RED first. The read is GET /workflows/logs/enrollment-counts (a whole-window
// count per workflow, no per-day rows), so the roll-up only has to check the window and report absent workflows as absent, never 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHeatMapWindow, rollupEnrollmentCounts, windowGuard, HEAT_MAP_MAX_DAYS } from '../core/workflow-heat-map.mjs';

const DAY = 24 * 60 * 60 * 1000;

test('a window over 60 days is refused (RETENTION): GHL keeps 60 days of log rows', () => {
  assert.equal(HEAT_MAP_MAX_DAYS, 60);
  const from = Date.parse('2026-09-01T00:00:00Z');
  const ok = checkHeatMapWindow(from, from + 60 * DAY);
  assert.equal(ok.ok, true, 'exactly 60 days is allowed');
  const bad = checkHeatMapWindow(from, from + 61 * DAY);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'RETENTION');
});

test('a window whose end is before its start is refused, not counted', () => {
  const from = Date.parse('2026-09-10T00:00:00Z');
  assert.equal(checkHeatMapWindow(from, from - DAY).ok, false);
});

test('rows roll up to { workflows, total, window, absent }', () => {
  const rows = [{ workflowId: 'w1', count: 5 }, { workflowId: 'w2', count: 3 }];
  const r = rollupEnrollmentCounts(rows, { workflowIds: ['w1', 'w2'], fromDate: 100, toDate: 200 });
  assert.deepEqual(Object.keys(r).sort(), ['absent', 'total', 'window', 'workflows']);
  assert.deepEqual(r.workflows, [{ workflowId: 'w1', count: 5 }, { workflowId: 'w2', count: 3 }]);
  assert.equal(r.total, 8);
  assert.deepEqual(r.window, { fromDate: 100, toDate: 200 });
  assert.deepEqual(r.absent, []);
});

test('a requested workflow with no row is in absent, never counted as 0', () => {
  const rows = [{ workflowId: 'w1', count: 5 }];
  const r = rollupEnrollmentCounts(rows, { workflowIds: ['w1', 'w9'], fromDate: 100, toDate: 200 });
  assert.deepEqual(r.absent, ['w9']);
  assert.equal(r.workflows.some((w) => w.workflowId === 'w9'), false, 'no zero row for an absent workflow');
});

test('with no requested ids, every row is reported and nothing is absent', () => {
  const r = rollupEnrollmentCounts([{ workflowId: 'w1', count: 2 }], { fromDate: 1, toDate: 2 });
  assert.deepEqual(r.absent, []);
  assert.equal(r.total, 2);
});

test('a row with a non-number count is refused as unknown, not summed as 0', () => {
  const r = rollupEnrollmentCounts([{ workflowId: 'w1', count: 'x' }], { requestedIds: ['w1'], fromDate: 1, toDate: 2 });
  assert.equal(r.workflows[0].count, undefined);
  assert.deepEqual(r.absent, []);
});

test('windowGuard throws RETENTION when the span is over 60 days (the plan interface)', () => {
  const from = Date.parse('2026-08-01T00:00:00Z');
  assert.doesNotThrow(() => windowGuard(from, from + 60 * DAY));
  assert.throws(() => windowGuard(from, from + 61 * DAY), (e) => e.code === 'RETENTION');
});

test('windowGuard throws WINDOW_INVERTED when the end is before the start', () => {
  assert.throws(() => windowGuard(10, 5), (e) => e.code === 'WINDOW_INVERTED');
});
