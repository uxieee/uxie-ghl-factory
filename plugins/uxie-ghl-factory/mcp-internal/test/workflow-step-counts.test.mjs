// W6 item 9: per-step counts, grouped like GHL's public log statistics, computed client-side over the COMPLETE log walk.
// A window the walk could not finish is refused, never counted partially. Row fields per corpus 50-runtime/11-runtime-logs.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollupStepCounts } from '../core/workflow-step-counts.mjs';

const T = (iso) => Date.parse(iso);
const ev = (iso, row) => ({ id: `${iso}-${row.stepId ?? row.status}`, timestamp: T(iso), event: row });
const definition = { workflow: { workflowData: { templates: [
  { id: 'S1', type: 'sms', name: 'Text', next: 'IF' },
  { id: 'IF', type: 'if_else', name: 'Gate', nodeType: 'condition-node', next: ['BY', 'BN'] },
  { id: 'BY', type: 'if_else', name: 'Yes', nodeType: 'branch-yes', parent: 'IF' },
  { id: 'BN', type: 'if_else', name: 'Else', nodeType: 'branch-no', parent: 'IF' },
] } } };
const windowOf = (events, extra = {}) => ({ complete: true, truncated: false, workflowDefinition: definition, runtimeEvents: events,
  requestedWindow: { fromDate: T('2026-10-29T00:00:00Z'), toDate: T('2026-10-31T00:00:00Z') }, ...extra });
const events = () => [
  ev('2026-10-29T15:30:00Z', { status: 'success', type: 'sms', stepId: 'S1', stepName: 'Text' }),
  ev('2026-10-29T15:31:00Z', { status: 'skipped', type: 'sms', stepId: 'S1', stepName: 'Text', meta: { skippedFor: { type: 'dnd' } } }),
  ev('2026-10-29T16:10:00Z', { status: 'success', type: 'condition', stepId: 'BY', stepName: 'Yes' }),
  ev('2026-10-29T16:11:00Z', { status: 'finished', type: 'remove_from_workflow', stepId: null, meta: { removedFrom: { type: 'end_of_workflow' } } }),
  ev('2026-10-30T01:00:00Z', { status: 'brand_new_status', type: 'sms', stepId: 'S1', stepName: 'Text' }),
];
const NOW = T('2026-10-30T12:00:00Z');

test('groupBy status+stepId equals a hand count, and an unknown status is its own row (item 13)', () => {
  const r = rollupStepCounts(windowOf(events()), { groupBy: ['status', 'stepId'], now: NOW });
  assert.equal(r.count, 5);
  const find = (status, stepId) => r.statistics.find((s) => s.status === status && s.stepId === stepId)?.count;
  assert.equal(find('success', 'S1'), 1);
  assert.equal(find('skipped', 'S1'), 1);
  assert.equal(find('brand_new_status', 'S1'), 1);
  assert.equal(find('finished', null), 1);
});

test('an If/Else row (logged with the BRANCH taken) carries the branch and its containerId', () => {
  const r = rollupStepCounts(windowOf(events()), { groupBy: ['stepId'], now: NOW });
  const b = r.statistics.find((s) => s.stepId === 'BY');
  assert.equal(b.stepName, 'Yes');
  assert.equal(b.containerId, 'IF');
});

test('removedReason and skippedReason group by meta.removedFrom.type / meta.skippedFor.type', () => {
  const r = rollupStepCounts(windowOf(events()), { groupBy: ['removedReason', 'skippedReason'], now: NOW });
  assert.equal(r.statistics.find((s) => s.removedReason === 'end_of_workflow').count, 1);
  assert.equal(r.statistics.find((s) => s.skippedReason === 'dnd').count, 1);
});

test('statuses / types filters apply before grouping', () => {
  const r = rollupStepCounts(windowOf(events()), { groupBy: ['type'], statuses: ['success'], now: NOW });
  assert.deepEqual(r.statistics.map((s) => [s.type, s.count]).sort(), [['condition', 1], ['sms', 1]]);
});

test('a day bucket follows the given time zone: 2026-10-30T01:00Z is the 30th in UTC and also in Manila, 15:30Z the 29th in UTC but the 29th 23:30 in Manila', () => {
  const utc = rollupStepCounts(windowOf(events()), { groupBy: [], timeBucket: 'day', timezone: 'UTC', now: NOW });
  const mnl = rollupStepCounts(windowOf(events()), { groupBy: [], timeBucket: 'day', timezone: 'Asia/Manila', now: NOW });
  assert.deepEqual(utc.statistics.map((s) => [s.bucket, s.count]), [['2026-10-29', 4], ['2026-10-30', 1]]);
  // Manila is UTC+8: 16:10Z and 16:11Z fall on the 30th there
  assert.deepEqual(mnl.statistics.map((s) => [s.bucket, s.count]), [['2026-10-29', 2], ['2026-10-30', 3]]);
});

test('refused, never partial: an incomplete or truncated walk, and a window older than 60 days', () => {
  assert.equal(rollupStepCounts(windowOf(events(), { complete: false }), { groupBy: ['status'], now: NOW }).refused, 'INCOMPLETE_WINDOW');
  assert.equal(rollupStepCounts(windowOf(events(), { truncated: true }), { groupBy: ['status'], now: NOW }).refused, 'INCOMPLETE_WINDOW');
  const old = windowOf(events(), { requestedWindow: { fromDate: T('2026-08-01T00:00:00Z'), toDate: T('2026-10-31T00:00:00Z') } });
  assert.equal(rollupStepCounts(old, { groupBy: ['status'], now: NOW }).refused, 'RETENTION');
});

test('an unknown groupBy key, two time buckets, or a bad time zone are refused by name', () => {
  assert.throws(() => rollupStepCounts(windowOf(events()), { groupBy: ['colour'], now: NOW }), /groupBy 'colour'/);
  assert.throws(() => rollupStepCounts(windowOf(events()), { groupBy: [], timeBucket: 'month', now: NOW }), /timeBucket/);
  assert.throws(() => rollupStepCounts(windowOf(events()), { groupBy: [], timeBucket: 'day', timezone: 'Mars/Olympus', now: NOW }), /timezone/);
});

// the tool: the runtime window's own walk, then the rollup; a refusal is an error with the reason, never a partial result
import { TOOLS } from '../core/tools.mjs';
const tool = () => TOOLS.find((t) => t.name === 'get_workflow_step_counts');
const deps = (win) => ({ state: {}, makeGw: () => ({ call: async () => ({ ok: true, json: {} }) }), collectRuntimeWindow: async () => win });
const args = { locationId: 'L', workflowId: 'W', fromDate: T('2026-10-29T00:00:00Z'), toDate: T('2026-10-31T00:00:00Z') };

test('get_workflow_step_counts returns the grouped statistics for a complete window', async () => {
  const r = await tool().handler({ ...args, groupBy: ['status'] }, deps(windowOf(events(), { requestedWindow: { fromDate: Date.now() - 86_400_000, toDate: Date.now() } })));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.equal(r.data.count, 5);
  assert.equal(r.data.complete, true);
});

test('get_workflow_step_counts refuses an incomplete window with INCOMPLETE_WINDOW and no statistics', async () => {
  const r = await tool().handler({ ...args, groupBy: ['status'] }, deps(windowOf(events(), { complete: false })));
  assert.equal(r.ok, false);
  assert.match(r.detail, /INCOMPLETE_WINDOW/);
  assert.equal(r.data?.statistics, undefined);
});

test('the tool is read-only and declares the log read', () => {
  assert.equal(tool().capabilities.every((c) => c.method === 'GET'), true);
  assert.ok(tool().capabilities.some((c) => c.path === '/workflows/logs/v2'));
});

// Live 2026-10-30 (knowledge sniffs/workflows-w6b-2026-10-30): on a real workflow the runtime window's EVENTS were complete
// while its DEFINITION read tripped the audit gateway's 500-record identity cap, so `complete`/`truncated` said incomplete.
// Counts need complete events; the definition only labels If/Else containers.
test('counts key on the EVENTS component: events complete + definition incomplete still counts', () => {
  const w = windowOf(events(), { complete: false, truncated: true, componentCompleteness: { runtimeEvents: true, workflowDefinition: false } });
  const r = rollupStepCounts(w, { groupBy: ['status'], now: NOW });
  assert.equal(r.count, 5);
});

test('events incomplete is refused even if the overall flag were true', () => {
  const w = windowOf(events(), { componentCompleteness: { runtimeEvents: false } });
  assert.equal(rollupStepCounts(w, { groupBy: ['status'], now: NOW }).refused, 'INCOMPLETE_WINDOW');
});

test('retention is judged first: an old AND incomplete window says RETENTION (live: it said INCOMPLETE_WINDOW)', () => {
  const old = windowOf(events(), { complete: false, componentCompleteness: { runtimeEvents: false }, requestedWindow: { fromDate: T('2026-08-01T00:00:00Z'), toDate: T('2026-10-31T00:00:00Z') } });
  assert.equal(rollupStepCounts(old, { groupBy: ['status'], now: NOW }).refused, 'RETENTION');
});

test('a definition passed separately labels the If/Else container when the window has none', () => {
  const w = windowOf(events(), { workflowDefinition: null });
  const r = rollupStepCounts(w, { groupBy: ['stepId'], now: NOW, definition });
  assert.equal(r.statistics.find((s) => s.stepId === 'BY').containerId, 'IF');
});

test('the tool refuses a window older than 60 days BEFORE walking the log', async () => {
  let walked = false;
  const r = await tool().handler({ ...args, fromDate: Date.now() - 70 * 86_400_000, toDate: Date.now(), groupBy: ['status'] },
    { state: {}, makeGw: () => ({ call: async () => ({ ok: true, json: {} }) }), collectRuntimeWindow: async () => { walked = true; return windowOf(events()); } });
  assert.match(r.detail, /RETENTION/);
  assert.equal(walked, false);
});

test('the tool reads the definition through the normal gateway when the window carries none', async () => {
  const calls = [];
  const gw = { call: async (m, p) => { calls.push(p); return { ok: true, status: 200, json: definition.workflow }; } };
  const w = windowOf(events(), { workflowDefinition: null, requestedWindow: { fromDate: Date.now() - 86_400_000, toDate: Date.now() } });
  const r = await tool().handler({ ...args, groupBy: ['stepId'] }, { state: {}, makeGw: () => gw, collectRuntimeWindow: async () => w });
  assert.equal(r.data.statistics.find((s) => s.stepId === 'BY').containerId, 'IF');
  assert.ok(calls.some((p) => p === '/workflow/L/W'));
});

test('the default log page is 50 rows: logs/v2 caps a page at 100 and a 100-row page overruns the audit record cap (live)', () => {
  assert.equal(tool().inputSchema.parse({ locationId: 'L', workflowId: 'W', fromDate: 0, toDate: 1 }).logPageSize, 50);
});

test('get_workflow_runtime_window defaults to 50-row log pages too (its 100 default never completed on a busy workflow, live)', async () => {
  const rw = TOOLS.find((t) => t.name === 'get_workflow_runtime_window');
  assert.equal(rw.inputSchema.parse({ locationId: 'L', workflowId: 'W', fromDate: 0, toDate: 1 }).logPageSize, 50);
  const { LOG_PAGE_SIZE_DEFAULT } = await import('../core/workflow-runtime-window.mjs');
  assert.equal(LOG_PAGE_SIZE_DEFAULT, 50);
});

// Final review W6b: the runtime window keeps `!rateLimit.limited` in its own `complete` so a throttled run is never
// published as complete; the rollup judged only the events component and dropped that term.
test('a throttled walk is refused even when the events component reads complete', () => {
  const r = rollupStepCounts(windowOf(events(), { componentCompleteness: { runtimeEvents: true }, rateLimit: { limited: true } }), { groupBy: ['status'], now: NOW });
  assert.equal(r.refused, 'INCOMPLETE_WINDOW');
});
