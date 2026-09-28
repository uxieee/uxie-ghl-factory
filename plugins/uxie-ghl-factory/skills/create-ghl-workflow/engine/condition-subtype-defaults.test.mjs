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
