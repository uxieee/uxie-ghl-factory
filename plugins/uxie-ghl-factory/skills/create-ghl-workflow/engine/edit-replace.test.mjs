// F5-18: a custom field's dataType is IMMUTABLE, so converting a field's type means a NEW field
// with a NEW id — and every reference to the old id, in both documents, has to move. Doing that
// by hand across steps and trigger conditions is exactly the errand that sent people to the
// unguarded full-document PUT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceFieldIdInTemplates, replaceInAttributes } from './edit.mjs';
import { replaceFieldIdInTriggerConditions, applyOps, partitionOps } from './edit-driver.mjs';

const tpls = () => [
  { id: 'a', type: 'update_contact_field', name: 'Set', attributes: { fields: [{ field: 'OLD', value: 'x', title: 'Messaging Channel' }] } },
  { id: 'b', type: 'if_else', nodeType: 'condition-node', name: 'Gate', attributes: { branches: [{ segments: [{ conditions: [{ conditionType: 'contact_detail', conditionSubType: 'OLD', conditionOperator: 'contain', conditionValue: 'sms' }] }] }] } },
  { id: 'c', type: 'internal_update_opportunity', name: 'Move', attributes: { __customInputFields__: [{ filterField: 'OLD', value: '1', dataType: 'TEXT', valueFieldType: 'string' }] } },
  { id: 'd', type: 'sms', name: 'Text', attributes: { body: 'Hi {{contact.messaging_channel}} — OLD stays in prose' } },
];

test('replaceFieldIdInTemplates swaps the id in every place a field id lives and nowhere else', () => {
  const { templates, diff, replaced } = replaceFieldIdInTemplates(tpls(), 'OLD', 'NEW');
  assert.equal(templates[0].attributes.fields[0].field, 'NEW');
  assert.equal(templates[1].attributes.branches[0].segments[0].conditions[0].conditionSubType, 'NEW');
  assert.equal(templates[2].attributes.__customInputFields__[0].filterField, 'NEW');
  assert.equal(templates[3].attributes.body, 'Hi {{contact.messaging_channel}} — OLD stays in prose',
    'merge tags key off fieldKey, which the NEW field regenerates from its name — prose is not a field id');
  assert.deepEqual(diff.modifiedSteps.sort(), ['a', 'b', 'c']);
  assert.equal(replaced, 3);
});

test('replaceFieldIdInTemplates refuses a no-op or a blank id rather than silently doing nothing', () => {
  assert.throws(() => replaceFieldIdInTemplates(tpls(), 'OLD', 'OLD'), /same/);
  assert.throws(() => replaceFieldIdInTemplates(tpls(), '', 'NEW'), /non-empty/);
});

test('replaceFieldIdInTriggerConditions rewrites contact.<id> rows and id/value carriers', () => {
  const out = replaceFieldIdInTriggerConditions([
    { operator: 'has-changed', field: 'contact.OLD', title: 'Next Callback On', type: 'date', id: 'OLD' },
    { operator: 'custom-field-eq', field: 'contact.customFields', value: 'OLD', id: 'custom-field' },
    { operator: '==', field: 'message.direction', value: 'outbound' },
  ], 'OLD', 'NEW');
  assert.deepEqual(out.map((c) => [c.field, c.id ?? null, c.value ?? null]),
    [['contact.NEW', 'NEW', null], ['contact.customFields', 'custom-field', 'NEW'], ['message.direction', null, 'outbound']]);
  assert.equal(replaceFieldIdInTriggerConditions([{ field: 'x', value: 'y' }], 'OLD', 'NEW'), null,
    'no change returns null, the same convention replaceTagInTriggerConditions uses');
});

test('replaceInAttributes replaces a string at one path, optionally per type, and counts', () => {
  const { templates, replaced } = replaceInAttributes(tpls(), { type: 'sms', path: 'body', find: 'OLD', replace: 'NEW' });
  assert.equal(templates[3].attributes.body, 'Hi {{contact.messaging_channel}} — NEW stays in prose');
  assert.equal(replaced, 1);
  assert.throws(() => replaceInAttributes(tpls(), { path: 'body', find: '', replace: 'x' }), /non-empty/);
});

test('replaceInAttributes expands an array level with []', () => {
  const t = [{ id: 'x', type: 'update_contact_field', attributes: { fields: [{ field: 'F', value: 'keep OLD' }, { field: 'G', value: 'no' }] } }];
  const { templates, replaced } = replaceInAttributes(t, { path: 'fields[].value', find: 'OLD', replace: 'NEW' });
  assert.equal(templates[0].attributes.fields[0].value, 'keep NEW');
  assert.equal(templates[0].attributes.fields[1].value, 'no');
  assert.equal(replaced, 1);
});

test('the ops route through the driver and replaceFieldId derives a trigger op like replaceTag', () => {
  const { stepOps, triggerOps } = partitionOps([{ op: 'replaceFieldId', oldId: 'OLD', newId: 'NEW' }]);
  assert.equal(stepOps.length, 1);
  assert.equal(triggerOps[0].op, 'replaceFieldIdInTriggers');
  const { templates } = applyOps(tpls(), [{ op: 'replaceInAttributes', type: 'sms', path: 'body', find: 'OLD', replace: 'NEW' }], { ctx: {}, idGen: () => 'x' });
  assert.match(templates[3].attributes.body, /NEW stays/);
});
