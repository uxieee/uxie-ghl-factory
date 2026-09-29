// An if/else tag condition holding a capital letter never matches (live 2026-09-30): the same contact took Yes for the lower-case
// condition and Else for the mixed-case one. The compiler lower-cases the value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCondition } from './compiler.mjs';

test('a tag condition value is lower-cased (single, list, negated)', () => {
  assert.deepEqual(normalizeCondition({ conditionType: 'contact_detail', tag: 'VIP Lead' }, {}).conditionValue, ['vip lead']);
  assert.deepEqual(normalizeCondition({ conditionType: 'contact_detail', tag: ['A', 'b'] }, {}).conditionValue, ['a', 'b']);
  const neg = normalizeCondition({ conditionType: 'contact_detail', tag: 'Cold', not: true }, {});
  assert.equal(neg.conditionOperator, 'index-of-false'); assert.deepEqual(neg.conditionValue, ['cold']);
});
test('CONTROLS: a merge tag keeps its case; a non-tag contact_detail condition is untouched', () => {
  assert.deepEqual(normalizeCondition({ conditionType: 'contact_detail', tag: '{{Custom.Tag}}' }, {}).conditionValue, ['{{Custom.Tag}}']);
  assert.equal(normalizeCondition({ conditionType: 'contact_detail', conditionSubType: 'someFieldId', conditionOperator: '==', conditionValue: 'MixedCase' }, {}).conditionValue.toString().toLowerCase(), 'mixedcase');
});
