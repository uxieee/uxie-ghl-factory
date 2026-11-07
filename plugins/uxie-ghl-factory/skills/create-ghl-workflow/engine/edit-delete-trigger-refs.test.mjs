// bl-419: deleting a trigger left its id in "which trigger" If/Else rows (conditionType 'trigger'); the builder then shows
// an empty OR row. deleteTrigger now refuses while a row still names it — fix that If/Else first (same call is fine,
// the plan sees the edited templates) or pass keepIfElseRows:true on the op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTriggerOps } from './edit-driver.mjs';

const existing = [{ id: 'TRIG1', type: 'contact_tag', name: 'Tag added', conditions: [] }, { id: 'TRIG2', type: 'contact_tag', name: 'Other', conditions: [] }];
const ifElse = (value) => [{ id: 'IF', type: 'if_else', name: 'Which trigger', attributes: { branches: [
  { id: 'B1', name: 'From tag', segments: [{ conditions: [{ conditionType: 'trigger', conditionOperator: '==', conditionValue: value, __conditionId: 'C' }] }] }] } }];
const plan = (ops, templates) => planTriggerOps(ops, { ctx: {}, wid: 'W', uid: 'U', existing, workflowStatus: 'draft', templates });

test('deleteTrigger is refused while an If/Else row names the trigger, naming the If/Else', () => {
  assert.throws(() => plan([{ op: 'deleteTrigger', triggerId: 'TRIG1' }], ifElse('TRIG1')), /'Which trigger'.*keepIfElseRows/s);
});

test('it goes through when no row names it, or with keepIfElseRows:true', () => {
  assert.equal(plan([{ op: 'deleteTrigger', triggerId: 'TRIG1' }], ifElse('TRIG2'))[0].method, 'DELETE');
  assert.equal(plan([{ op: 'deleteTrigger', triggerId: 'TRIG1', keepIfElseRows: true }], ifElse('TRIG1'))[0].method, 'DELETE');
  assert.equal(plan([{ op: 'deleteTrigger', triggerId: 'TRIG1' }], undefined)[0].method, 'DELETE');
});
