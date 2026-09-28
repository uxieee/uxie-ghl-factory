// Groups with no sub-type rows get conditionSubType = the group's name, as the builder sets it when the group
// is picked (models/conditions/Condition.ts:857-868). Without it GHL refuses the If/Else ("missing its field",
// live 2026-09-28: knowledge sniffs/workflows-wave1-2026-09-25/live-3V-ifelse-contact-groups-run1-trigger-subtype-refused.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCondition } from './compiler.mjs';

test('trigger: subtype defaults to "trigger", operator defaults to == and an authored != is kept', () => {
  const ctx = { __triggerRefs: new Map([['ta', 'tid-1']]) };
  assert.deepEqual(normalizeCondition({ conditionType: 'trigger', trigger: 'ta' }, ctx),
    { conditionType: 'trigger', conditionSubType: 'trigger', conditionOperator: '==', conditionValue: 'tid-1' });
  assert.equal(normalizeCondition({ conditionType: 'trigger', trigger: 'ta', conditionOperator: '!=' }, ctx).conditionOperator, '!=');
});

test('workflow_contact / workflow_object / ai_bot_booked_appointment: subtype = the group name; an authored subtype wins', () => {
  for (const t of ['workflow_contact', 'workflow_object', 'ai_bot_booked_appointment'])
    assert.equal(normalizeCondition({ conditionType: t, conditionOperator: 'index-of-true', conditionValue: 'x' }, {}).conditionSubType, t);
  assert.equal(normalizeCondition({ conditionType: 'workflow_contact', conditionSubType: 'custom', conditionValue: 'x' }, {}).conditionSubType, 'custom');
});

test('other groups are untouched (no subtype invented)', () => {
  assert.equal(normalizeCondition({ conditionType: 'number_formatter', conditionOperator: '>', conditionValue: '1' }, {}).conditionSubType, undefined);
});

test('a marketplace-authored Add Task stores attributes.type task_notification (its inner spelling), not the step key', async () => {
  const { compile } = await import('./compiler.mjs');
  const { buildMarketplaceIndex } = await import('./marketplace.mjs');
  const { loadCatalog } = await import('./catalog.mjs');
  const assets = { actions: [{ appName: 'contact', actions: [{ key: 'task-notification', workflowsActionType: 'INTERNAL', section: 'contact',
    inputs: [{ field: 'title', fieldType: 'string', required: true }, { field: 'body', fieldType: 'rich-text', required: true }, { field: 'dueDate', fieldType: 'duration-picker', required: true }] }] }] };
  let n = 0;
  const t = compile({ name: 'wf', triggers: [], graph: [{ ref: 'p', kind: 'action', marketplace: true, type: 'task-notification', name: 'Add task', attributes: { title: 'T', body: 'B', dueDate: 1 } }] },
    { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: () => `id-${++n}`, catalog: loadCatalog(), marketplace: buildMarketplaceIndex({ assets, modules: { actions: [], triggers: [] } }), warn: () => {} })
    .autoSaveBody.workflowData.templates[0];
  assert.equal(t.type, 'task-notification');
  assert.equal(t.attributes.type, 'task_notification');
});

test('merge-tag brace check: a JSON body ending in }} is balanced; an unclosed {{ or a stray }} in text still warns', async () => {
  const { evaluateMergeTags } = await import('./merge-tags.mjs');
  const { loadCatalog } = await import('./catalog.mjs');
  const M = loadCatalog().mergeTags;
  const run = (v) => evaluateMergeTags([{ id: 'w', type: 'custom_webhook', name: 'W', attributes: { body: { rawData: v } } }], M).filter((f) => f.kind === 'unbalanced');
  assert.deepEqual(run(JSON.stringify({ tcwf: { email: '{{contact.email}}', kind: 'x' } })), []);
  assert.equal(run('Hello {{contact.first_name}').length, 1);
  assert.equal(run('Hello }} there').length, 1);
});
