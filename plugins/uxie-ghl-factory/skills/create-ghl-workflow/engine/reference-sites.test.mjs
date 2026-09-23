import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReferenceSites, needsReferenceSites } from './reference-sites.mjs';

const cals = [{ id: 'CAL_OK', isActive: true }, { id: 'CAL_OFF', isActive: false }];
const users = [{ id: 'U1' }, { id: 'U2' }];
const appt = (calendarId) => ({ id: 's1', name: 'Book', type: 'appointment_booking', attributes: { calendarId } });
const rr = (weights, index) => ({ id: 's2', name: 'Round robin', type: 'assign_user', attributes: { user_list: ['U1'], traffic_weightage: weights, traffic_index: index } });
const codes = (r) => r.errors.map((e) => e.code);

test('a step calendar: real passes (control), ghost and inactive are named', () => {
  assert.deepEqual(codes(checkReferenceSites([appt('CAL_OK')], { calendars: cals })), []);
  assert.deepEqual(codes(checkReferenceSites([appt('GHOST')], { calendars: cals })), ['STEP_CALENDAR_NOT_FOUND']);
  assert.deepEqual(codes(checkReferenceSites([appt('CAL_OFF')], { calendars: cals })), ['STEP_CALENDAR_INACTIVE']);
  assert.deepEqual(codes(checkReferenceSites([appt('{{custom_values.cal}}')], { calendars: cals })), [], 'merge tags pass');
});
test('round robin: ids as map KEYS and in traffic_index are both checked', () => {
  assert.deepEqual(codes(checkReferenceSites([rr({ U1: 50, U2: 50 }, [{ id: 'U1' }])], { users })), []);
  const r = checkReferenceSites([rr({ U1: 50, GHOST_A: 50 }, [{ id: 'GHOST_B' }])], { users });
  assert.deepEqual(codes(r), ['ROUND_ROBIN_USER_NOT_FOUND']);
  assert.match(r.errors[0].message, /GHOST_A, GHOST_B/);
});
test('an unreadable list is NOT CHECKED, never clean; nothing is fetched when nothing needs it', () => {
  const r = checkReferenceSites([appt('GHOST'), rr({ X: 1 }, [])], { calendars: null, users: null });
  assert.equal(r.errors.length, 0); assert.equal(r.notChecked.length, 2);
  assert.deepEqual(needsReferenceSites([{ type: 'sms', attributes: {} }]), { calendars: false, users: false });
});
