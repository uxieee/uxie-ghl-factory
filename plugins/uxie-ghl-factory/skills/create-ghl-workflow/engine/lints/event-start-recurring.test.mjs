import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintEventStartRecurring } from './event-start-recurring.mjs';

const esd = (a) => ({ id: 'e', type: 'event_start_date', name: 'E', attributes: { type: 'event_start_date', event_start_type: 'recurring', ...a } });

test('the builder shape (proven live) is quiet', () => {
  assert.deepEqual(lintEventStartRecurring([esd({ recurring_type: 'day_week', value: 1, recurring_time: '19:15' }), esd({ recurring_type: 'day_month', value: 28, recurring_time: '00:00' })]), []);
});

test('the shape 3L stored ("monday", "9:00 AM") warns on both keys', () => {
  const f = lintEventStartRecurring([esd({ recurring_type: 'day_week', value: 'monday', recurring_time: '9:00 AM' })]);
  assert.equal(f.length, 2); assert.ok(f.every((x) => x.code === 'EVENT_START_RECURRING_SHAPE' && x.severity === 'warning'));
});

test('out-of-range days, off-grid times and a bad recurring_type warn; other event_start types are ignored', () => {
  assert.equal(lintEventStartRecurring([esd({ recurring_type: 'day_week', value: 7, recurring_time: '09:00' })]).length, 1);
  assert.equal(lintEventStartRecurring([esd({ recurring_type: 'day_month', value: 0, recurring_time: '09:10' })]).length, 2);
  assert.equal(lintEventStartRecurring([esd({ recurring_type: 'weekly', value: 1, recurring_time: '09:00' })]).length, 1);
  assert.deepEqual(lintEventStartRecurring([{ id: 'x', type: 'event_start_date', attributes: { event_start_type: 'datetime', value: '2026-10-01T09:00:00+01:00' } }]), []);
});
