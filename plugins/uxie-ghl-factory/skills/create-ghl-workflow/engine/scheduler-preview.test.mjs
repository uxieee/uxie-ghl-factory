import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedulerPreviewBody, interpretSchedulerPreview } from './scheduler-preview.mjs';

const trig = { id: 'T1', type: 'scheduler_trigger', name: 'Mondays', schedule_config: { skip_weekends: false, stop_at: '' },
  conditions: [{ field: 'scheduler.interval', value: 'weekly' }, { field: 'scheduler.weekly.days', value: ['monday'] }, { field: 'scheduler.weekly.times', value: ['09:00'] }, { field: 'scheduler.cron.expression', value: '' }] };

test('the body is the builder\'s: every filter EXCEPT scheduler.interval, empties dropped, config keys only when set', () => {
  assert.deepEqual(schedulerPreviewBody(trig, 'Europe/London'), { timezone: 'Europe/London', triggerId: 'T1', scheduleConfig: { skip_weekends: false },
    conditions: [{ field: 'scheduler.weekly.days', value: ['monday'] }, { field: 'scheduler.weekly.times', value: ['09:00'] }] });
  assert.equal(schedulerPreviewBody({ type: 'contact_tag' }, 'UTC'), null, 'not a scheduler: nothing to ask');
});

test('an EMPTY executions list is a finding — the trigger never fires — not a pass', () => {
  const r = interpretSchedulerPreview(trig, 'UTC', { ok: true, status: 200, json: { success: true, executions: [] } });
  assert.equal(r.checked, true); assert.equal(r.neverFires, true); assert.match(r.detail, /never run/);
});

test('control: a schedule that does fire is reported with its instants and the zone they were computed for', () => {
  const r = interpretSchedulerPreview(trig, 'Australia/Sydney', { ok: true, status: 200, json: { success: true, executions: ['2026-09-20T23:00:00.000Z'] } });
  assert.equal(r.neverFires, false); assert.match(r.detail, /Australia\/Sydney/); assert.deepEqual(r.executions, ['2026-09-20T23:00:00.000Z']);
});

test('a preview that fails or is unreadable is UNKNOWN (checked:false), never "fires fine"', () => {
  assert.equal(interpretSchedulerPreview(trig, 'UTC', { ok: false, status: 400, json: { error: 'conditions array is required' } }).checked, false);
  assert.equal(interpretSchedulerPreview(trig, 'UTC', { ok: true, status: 200, json: { success: true } }).checked, false);
});
