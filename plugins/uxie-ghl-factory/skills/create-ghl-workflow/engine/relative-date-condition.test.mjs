// if_else RELATIVE-DATE conditions (appointment start time, "In the Next N days").
//
// Why this looked unsupported for so long: the relative comparator is NOT in
// `conditionOperator`. That field only carries the Is/Is-not (`==`/`!=`) part, which is
// why a reader sees a plain `!=` and concludes there is no relative support. The
// comparator lives in TWO EXTRA fields the engine never documented:
//
//     conditionValueOperator : 'inTheNext'   <- the actual comparator
//     conditionValueUnit     : 'days'
//
// In the UI the control only renders AFTER an operator (Is / Is not) is picked, which is
// the other half of why it reads as "no relative support".
//
// GROUND TRUTH (live, read-only, 2026-07-19): location SJRURxzgbPTVBNLhqEZi, workflow
// fb0e0e34-4a01-4786-ae43-43c14c567ba7 ("07g Course Auto-Release Unpaid Seat"), container
// 85461afa-ef49-4c51-bb16-fb48e6f358aa ("Late booking?"), branch "Normal booking" —
// "Start date is not In the Next 2 Days". LIVE_CONDITION below is that object verbatim.
//
// SUPPORT = 1. A sweep of all 78 workflows across GROM Digital AU + the client account
// found exactly ONE relative-date condition in the wild: this one. Per the compiled-shape
// discipline (count support per field, never over-fit a thin corpus), the only shape
// asserted here is the one actually observed. The wider comparator enum is recorded in
// SKILL.md with its provenance and is deliberately NOT asserted as engine behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandCondition, IFELSE_NESTED_DROPDOWN_TYPES, IFELSE_ALLOW_IS_OPERATOR_TYPES } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';

// Verbatim from the live workflow (only __conditionId is per-instance).
const LIVE_CONDITION = {
  conditionType: 'appointment',
  conditionSubType: 'startTime',
  conditionOperator: '!=',
  conditionValue: '2',
  conditionValueOperator: 'inTheNext',
  conditionValueUnit: 'days',
  __conditionId: '74b33502-3a61-44cd-bc83-99d336ef17f6',
  ifElseNodeId: '',
  __customFieldType__: 'standard',
  isWait: false,
  nestedDropdownTypes: IFELSE_NESTED_DROPDOWN_TYPES,
  allowIsOperatorTypes: IFELSE_ALLOW_IS_OPERATOR_TYPES,
};

const ctx = () => ({ idGen: makeSeededIdGen('rd') });

test('an authored appointment relative-date condition compiles to the LIVE shape', () => {
  const authored = {
    conditionType: 'appointment',
    conditionSubType: 'startTime',
    conditionOperator: '!=',
    conditionValue: '2',
    conditionValueOperator: 'inTheNext',
    conditionValueUnit: 'days',
  };
  const got = expandCondition(authored, ctx());

  // the two relative fields must survive compilation — they ride the forward-compat
  // extras path, so this test is what keeps that path from being "cleaned up" away.
  assert.equal(got.conditionValueOperator, 'inTheNext');
  assert.equal(got.conditionValueUnit, 'days');

  // and the whole object must match the live one field-for-field
  const norm = (o) => { const { __conditionId, ...rest } = o; return rest; };
  assert.deepEqual(norm(got), norm(LIVE_CONDITION));
});

test('conditionValue stays a STRING — the live shape stores "2", not 2', () => {
  // A number here compiles clean and is the kind of thing that mismatches silently at
  // runtime. The live record is unambiguous: a quoted string.
  const got = expandCondition({
    conditionType: 'appointment', conditionSubType: 'startTime', conditionOperator: '!=',
    conditionValue: '2', conditionValueOperator: 'inTheNext', conditionValueUnit: 'days',
  }, ctx());
  assert.equal(typeof got.conditionValue, 'string');
  assert.equal(got.conditionValue, '2');
});

test('a relative-date condition is NOT mistaken for a contact_detail field condition', () => {
  // contact_detail lowercases its value and defaults the operator to `contain`; an
  // appointment condition must take neither of those paths.
  const got = expandCondition({
    conditionType: 'appointment', conditionSubType: 'startTime', conditionOperator: '!=',
    conditionValue: '2', conditionValueOperator: 'inTheNext', conditionValueUnit: 'days',
  }, ctx());
  assert.equal(got.conditionOperator, '!=', 'must not be rewritten to contain');
  assert.notEqual(got.conditionType, 'contact_detail');
});
