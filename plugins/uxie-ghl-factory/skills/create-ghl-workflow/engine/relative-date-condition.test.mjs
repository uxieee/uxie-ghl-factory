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
// GROUND TRUTH (live, read-only, 2026-07-19): a UI-built if_else in a real sub-account,
// gating on "Appointment start date is not In the Next 2 Days". LIVE_CONDITION below is
// that stored object verbatim, with account-identifying ids replaced by synthetic ones
// (only __conditionId is per-instance, so nothing about the shape is lost).
//
// SUPPORT: a sweep of all 78 workflows across GROM Digital AU + the client account found
// exactly ONE relative-date condition in the wild (this one), so the corpus proves only
// inTheNext/days. The remaining ten comparators were then PROBED live (2026-07-19): one
// throwaway workflow with a branch per comparator, read back through the BUILDER. A value
// the builder cannot resolve renders no label, so a correct human label ("is In the Last
// \"3\"") is proof the stored value is canonical. All 11 resolved. See RELATIVE_OPERATORS.
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
  __conditionId: '00000000-0000-4000-8000-000000000001',
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

// The 11 comparators, each with the value shape the live probe confirmed the builder
// resolves. `null` = takes no conditionValue at all (today/tomorrow/yesterday rendered
// correctly with the key absent — do NOT send an empty string).
export const RELATIVE_OPERATORS = {
  today: null, tomorrow: null, yesterday: null,
  on: 'date', between: 'date', after: 'date', before: 'date',
  inTheNext: 'count+unit', inTheLast: 'count+unit',
  afterDate: 'date', beforeDate: 'date',
};

test('every probed comparator survives compilation unchanged', () => {
  for (const [op, kind] of Object.entries(RELATIVE_OPERATORS)) {
    const authored = {
      conditionType: 'appointment', conditionSubType: 'startTime', conditionOperator: '==',
      conditionValueOperator: op,
      ...(kind === 'date' ? { conditionValue: '2026-08-01' } : {}),
      ...(kind === 'count+unit' ? { conditionValue: '2', conditionValueUnit: 'days' } : {}),
    };
    const got = expandCondition(authored, ctx());
    assert.equal(got.conditionValueOperator, op, `${op} must survive`);
    if (kind === null)
      assert.equal(got.conditionValue, undefined, `${op} takes no value — sending one is not the proven shape`);
    if (kind === 'count+unit') assert.equal(got.conditionValueUnit, 'days');
  }
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
