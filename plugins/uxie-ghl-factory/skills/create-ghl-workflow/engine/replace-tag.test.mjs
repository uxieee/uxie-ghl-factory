import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceTagInTemplates, replaceTagInTriggerConditions } from './edit.mjs';
import { partitionOps, applyOps, planTriggerOps } from './edit-driver.mjs';

const T = () => [
  { id: 'a', type: 'add_contact_tag', name: 'A', order: 0, attributes: { tags: ['vip', 'new'], customTags: 'vip,vip-2' }, next: 'b' },
  { id: 'b', type: 'remove_contact_tag', name: 'B', order: 1, attributes: { tags: ['vip', 'gold'] }, next: 'c', parentKey: 'a' },
  { id: 'c', type: 'if_else', name: 'C', order: 2, attributes: { branches: [{ id: 'br', name: 'Yes', segments: [{ operator: 'and', conditions: [
    { conditionType: 'contact_detail', conditionSubType: 'tags', conditionOperator: 'index-of-true', conditionValue: ['vip'] },
    { conditionType: 'contact_detail', conditionSubType: 'email', conditionOperator: 'contain', conditionValue: 'vip' },
  ] }] }] }, next: ['t1'], nodeType: 'condition-node', parentKey: 'b' },
  { id: 'd', type: 'sms', name: 'D', order: 3, attributes: { body: 'vip offer' }, next: null, parentKey: 'c' },
];

test('tag mode is EXACT on tag arrays, case-sensitive substring on customTags, and only touches tags-subtype if/else conditions', () => {
  const { templates, diff, replaced } = replaceTagInTemplates(T(), 'vip', 'vip-2026');
  assert.equal(replaced, 3);
  assert.deepEqual(diff.modifiedSteps, ['a', 'b', 'c']);
  assert.deepEqual(templates[0].attributes.tags, ['vip-2026', 'new']);
  assert.equal(templates[0].attributes.customTags, 'vip-2026,vip-2026-2', 'customTags is a plain string replace (UI: case-sensitive)');
  assert.deepEqual(templates[1].attributes.tags, ['vip-2026', 'gold']);
  const conds = templates[2].attributes.branches[0].segments[0].conditions;
  assert.deepEqual(conds[0].conditionValue, ['vip-2026']);
  assert.equal(conds[1].conditionValue, 'vip', 'a non-tag condition that merely contains the text is untouched');
  assert.equal(templates[3].attributes.body, 'vip offer', 'text bodies are untouched in tag mode');
});

test('duplicate-tag rule: when the new tag already exists the original is removed (de-dup), and a no-op swap throws like the UI warns', () => {
  const t = [{ id: 'a', type: 'add_contact_tag', name: 'A', order: 0, attributes: { tags: ['vip', 'gold'] }, next: null }];
  assert.deepEqual(replaceTagInTemplates(t, 'vip', 'gold').templates[0].attributes.tags, ['gold']);
  assert.throws(() => replaceTagInTemplates(t, 'vip', 'vip'), /same/);
  assert.throws(() => replaceTagInTemplates(t, '', 'x'), /non-empty/);
  assert.equal(replaceTagInTemplates(t, 'nope', 'x').replaced, 0);
});

test('trigger conditions: array values swap exactly, string values replace; untouched → null', () => {
  assert.deepEqual(replaceTagInTriggerConditions([{ field: 'tagsAdded', value: 'vip' }, { field: 'contact.tags', value: ['vip', 'x'] }], 'vip', 'v2'),
    [{ field: 'tagsAdded', value: 'v2' }, { field: 'contact.tags', value: ['v2', 'x'] }]);
  assert.equal(replaceTagInTriggerConditions([{ field: 'tagsAdded', value: 'gold' }], 'vip', 'v2'), null);
});

test('the replaceTag op runs over steps AND plans a PUT for every trigger that carries the tag', () => {
  const { stepOps, triggerOps } = partitionOps([{ op: 'replaceTag', oldTag: 'vip', newTag: 'v2' }]);
  assert.equal(stepOps.length, 1); assert.equal(triggerOps.length, 1); assert.equal(triggerOps[0].op, 'replaceTagInTriggers');
  const r = applyOps(T(), stepOps, { ctx: {}, idGen: () => 'x' });
  assert.deepEqual(r.diff.modifiedSteps, ['a', 'b', 'c']);
  const existing = [
    { id: 'T1', type: 'contact_tag', name: 'Tag', conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'vip', title: 'Tag added', type: 'select', id: 'tag-added' }] },
    { id: 'T2', type: 'contact_tag', name: 'Other', conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'gold' }] },
  ];
  const plans = planTriggerOps(triggerOps, { ctx: { loc: 'L' }, wid: 'W', uid: 'U', existing });
  assert.equal(plans.length, 1, 'one PUT per matching trigger; T2 untouched');
  assert.equal(plans[0].method, 'PUT'); assert.equal(plans[0].path, '/workflow/L/trigger/T1'); assert.equal(plans[0].triggerId, 'T1');
  assert.equal(plans[0].body.conditions[0].value, 'v2'); assert.equal(plans[0].body.id, 'T1');
  const none = partitionOps([{ op: 'replaceTag', oldTag: 'vip', newTag: 'v2', triggers: false }]);
  assert.equal(none.triggerOps.length, 0, 'triggers:false keeps the trigger document untouched');
});
