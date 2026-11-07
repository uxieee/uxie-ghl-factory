// bl-370: modifyStep on an If/Else merged attrPatch shallowly, so a `branches` patch REPLACED every row and the row keys the
// caller did not resend (nestedDropdownTypes, allowIsOperatorTypes — the drawer's own hints) were lost on every row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modifyStep } from './edit.mjs';
import { IFELSE_NESTED_DROPDOWN_TYPES, IFELSE_ALLOW_IS_OPERATOR_TYPES } from './compiler.mjs';

const row = (id, value, extra = {}) => ({ conditionType: 'contact_detail', conditionSubType: 'tags', conditionOperator: 'index-of-true', conditionValue: [value],
  __conditionId: id, ifElseNodeId: '', isWait: false, nestedDropdownTypes: ['sheet'], allowIsOperatorTypes: ['contact_reply'], __customFieldType__: 'standard', ...extra });
const stored = () => [{ id: 'IF', type: 'if_else', name: 'Gate', nodeType: 'condition-node', next: ['B1', 'B2'], attributes: {
  branches: [{ id: 'B1', name: 'Yes', segments: [{ __segmentId: 'S1', operator: 'and', conditions: [row('C1', 'a'), row('C2', 'b')] }] }, { id: 'B2', name: 'Else', else: true }] } }];

test('a branches patch that resends only the changed row keys keeps every stored row key', () => {
  const patch = { branches: [{ id: 'B1', name: 'Yes', segments: [{ __segmentId: 'S1', operator: 'and', conditions: [
    { __conditionId: 'C1', conditionType: 'contact_detail', conditionSubType: 'tags', conditionOperator: 'index-of-true', conditionValue: ['z'] },
    { __conditionId: 'C2', conditionType: 'contact_detail', conditionSubType: 'tags', conditionOperator: 'index-of-true', conditionValue: ['b'] }] }] },
  { id: 'B2', name: 'Else', else: true }] };
  const [t] = modifyStep(stored(), 'IF', patch).templates;
  const [c1, c2] = t.attributes.branches[0].segments[0].conditions;
  assert.deepEqual(c1.conditionValue, ['z']);
  for (const c of [c1, c2]) {
    assert.deepEqual(c.nestedDropdownTypes, ['sheet']); assert.deepEqual(c.allowIsOperatorTypes, ['contact_reply']);
    assert.equal(c.__customFieldType__, 'standard'); assert.equal(c.ifElseNodeId, '');
  }
  assert.equal(t.attributes.branches[1].else, true);
});

test('a NEW row (no stored __conditionId) gets the drawer hint arrays the compiler gives every row', () => {
  const patch = { branches: [{ id: 'B1', name: 'Yes', segments: [{ __segmentId: 'S1', operator: 'and', conditions: [
    { __conditionId: 'C9', conditionType: 'contact_detail', conditionSubType: 'tags', conditionOperator: 'index-of-true', conditionValue: ['n'] }] }] },
  { id: 'B2', name: 'Else', else: true }] };
  const c = modifyStep(stored(), 'IF', patch).templates[0].attributes.branches[0].segments[0].conditions[0];
  assert.deepEqual(c.nestedDropdownTypes, IFELSE_NESTED_DROPDOWN_TYPES);
  assert.deepEqual(c.allowIsOperatorTypes, IFELSE_ALLOW_IS_OPERATOR_TYPES);
});

test('CONTROL: a row the patch leaves out is removed — the patch still decides which rows exist', () => {
  const patch = { branches: [{ id: 'B1', name: 'Yes', segments: [{ __segmentId: 'S1', operator: 'and', conditions: [{ __conditionId: 'C2', conditionValue: ['b'] }] }] }, { id: 'B2', name: 'Else', else: true }] };
  const conds = modifyStep(stored(), 'IF', patch).templates[0].attributes.branches[0].segments[0].conditions;
  assert.deepEqual(conds.map((c) => c.__conditionId), ['C2']);
  assert.equal(conds[0].conditionSubType, 'tags');
});
