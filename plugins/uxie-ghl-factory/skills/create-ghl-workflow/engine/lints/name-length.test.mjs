// R-58 (Xander's review, 2026-09-02): ten cloned steps carried names over 100 characters. The API
// accepted every one (200, read back intact) and the BUILDER then refuses to save the step the
// moment a human opens its drawer — so the workflow reads clean by API and is unsaveable by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintNameLength, STEP_NAME_MAX, STEP_NAME_MIN } from './name-length.mjs';

const long = 'x'.repeat(101);
const atCap = 'y'.repeat(100);

test('a step name over the cap is reported, with its length and the cap', () => {
  const f = lintNameLength([{ id: 's1', type: 'sms', name: long }], []);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, 'NAME_LENGTH');
  assert.equal(f[0].severity, 'warning');
  assert.equal(f[0].stepId, 's1');
  assert.match(f[0].msg, /101/);
  assert.match(f[0].msg, /100/);
  // it must say WHO refuses it, because the API does not
  assert.match(f[0].msg, /builder/i);
});

test('exactly at the cap is fine, and so is one character', () => {
  assert.deepEqual(lintNameLength([{ id: 's1', type: 'sms', name: atCap }], []), []);
  assert.deepEqual(lintNameLength([{ id: 's2', type: 'sms', name: 'a' }], []), []);
});

test('an EMPTY or whitespace-only name is the other end of the same cap', () => {
  const f = lintNameLength([{ id: 's1', type: 'sms', name: '' }, { id: 's2', type: 'sms', name: '   ' }], []);
  assert.equal(f.length, 2);
  assert.ok(f.every((x) => x.code === 'NAME_LENGTH' && /at least/i.test(x.msg)));
});

test('TRIGGERS are checked too, and reported by triggerId not stepId', () => {
  const f = lintNameLength([], [{ id: 't1', type: 'contact_created', name: long }]);
  assert.equal(f.length, 1);
  assert.equal(f[0].triggerId, 't1');
  assert.equal(f[0].stepId, undefined);
});

test('a missing name is not this rule\'s business — required-fields owns that', () => {
  assert.deepEqual(lintNameLength([{ id: 's1', type: 'sms' }], []), []);
  assert.deepEqual(lintNameLength([{ id: 's1', type: 'sms', name: null }], []), []);
});

test('the cap constants are the live-observed pair', () => {
  assert.equal(STEP_NAME_MIN, 1);
  assert.equal(STEP_NAME_MAX, 100);
});
