// bl-415: an If/Else has_value row was reported "did not round-trip" (ENGINE_ABORT) after a write that succeeded. GHL stores
// has_value / has_no_value rows with NO conditionValue key (16 + 9 stored client rows, none carrying one), so a sent
// value read back missing. The engine now writes the stored shape on both paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandCondition } from './compiler.mjs';
import { modifyStep } from './edit.mjs';
import { makeSeededIdGen } from './idgen.mjs';

test('expandCondition omits conditionValue for has_value and has_no_value', () => {
  for (const op of ['has_value', 'has_no_value']) {
    const c = expandCondition({ conditionType: 'contact_detail', conditionSubType: 'last_appointment', conditionOperator: op, conditionValue: '' }, { idGen: makeSeededIdGen('v') });
    assert.equal('conditionValue' in c, false, op);
  }
});

test('CONTROL: a value operator keeps its conditionValue', () => {
  const c = expandCondition({ conditionType: 'contact_detail', conditionSubType: 'last_appointment', conditionOperator: '==', conditionValue: 'x' }, { idGen: makeSeededIdGen('w') });
  assert.equal(c.conditionValue, 'x');
});

test('a modifyStep If/Else row with has_value drops a sent conditionValue', () => {
  const stored = [{ id: 'IF', type: 'if_else', name: 'G', next: ['B'], attributes: { branches: [{ id: 'B', segments: [{ __segmentId: 'S', conditions: [{ __conditionId: 'C', conditionType: 'contact_detail', conditionSubType: 'email', conditionOperator: '==', conditionValue: 'a' }] }] }] } }];
  const patch = { branches: [{ id: 'B', segments: [{ __segmentId: 'S', conditions: [{ __conditionId: 'C', conditionOperator: 'has_value', conditionValue: '' }] }] }] };
  const c = modifyStep(stored, 'IF', patch).templates[0].attributes.branches[0].segments[0].conditions[0];
  assert.equal(c.conditionOperator, 'has_value');
  assert.equal('conditionValue' in c, false);
});
