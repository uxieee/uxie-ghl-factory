import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTriggerOps, partitionOps, TRIGGER_OPS } from './edit-driver.mjs';

const existing = [
  { id: 'T1', date_added: 'x', date_updated: 'y', deleted: false, active: true, type: 'contact_tag', name: 'Tag trigger', masterType: 'highlevel',
    workflow_id: 'W', location_id: 'L', belongs_to: 'workflow', schedule_config: {}, actions: [{ workflow_id: 'W', type: 'add_to_workflow' }],
    conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'VIP', title: 'Tag added', type: 'select', id: 'tag-added' }] },
  { id: 'T2', active: true, type: 'inbound_webhook', name: 'Hook', masterType: 'highlevel', workflow_id: 'W', location_id: 'L', predeterminedId: 'old-pid', conditions: [], actions: [] },
];
const ctx = { loc: 'L', idGen: () => 'fresh-id' };

test('duplicateTrigger is a trigger op and re-posts the stored trigger as "(Copy)", inactive, same conditions', () => {
  assert.ok(TRIGGER_OPS.has('duplicateTrigger'));
  const { triggerOps } = partitionOps([{ op: 'duplicateTrigger', triggerId: 'T1' }]);
  const [plan] = planTriggerOps(triggerOps, { ctx, wid: 'W', uid: 'U', existing });
  assert.equal(plan.method, 'POST'); assert.equal(plan.path, '/workflow/L/trigger'); assert.equal(plan.sourceTriggerId, 'T1');
  assert.equal(plan.body.name, 'Tag trigger (Copy)'); assert.equal(plan.body.active, false); assert.equal(plan.body.workflow_id, 'W');
  assert.deepEqual(plan.body.conditions, existing[0].conditions);
  for (const k of ['id', '_id', 'date_added', 'date_updated', 'deleted']) assert.equal(k in plan.body, false, `${k} must not be re-posted`);
  assert.equal(plan.body.masterType, 'highlevel'); assert.deepEqual(plan.body.actions, existing[0].actions);
});

// Bug fix 2026-08-28: this used to leave `status` absent on the copy entirely, so it landed
// "wherever the absent-status default puts it" — per the measured POST table, an ABSENT
// `status` lands a trigger ACTIVE on either a draft OR a published target, regardless of the
// stale `active:false` this body also carries (the server does not key off `active` on
// write). `status` now follows the workflow's own state explicitly, same rule as addTrigger.
test('duplicateTrigger sends status:"published" when the target workflow is already published — the copy matches its workflow instead of landing wherever the absent-status default puts it', () => {
  const { triggerOps } = partitionOps([{ op: 'duplicateTrigger', triggerId: 'T1' }]);
  const [plan] = planTriggerOps(triggerOps, { ctx, wid: 'W', uid: 'U', existing, workflowStatus: 'published' });
  assert.equal(plan.body.status, 'published');
});

test('duplicateTrigger sends status:"draft" when the target workflow is a draft', () => {
  const { triggerOps } = partitionOps([{ op: 'duplicateTrigger', triggerId: 'T1' }]);
  const [plan] = planTriggerOps(triggerOps, { ctx, wid: 'W', uid: 'U', existing, workflowStatus: 'draft' });
  assert.equal(plan.body.status, 'draft');
});

test('duplicateTrigger defaults to status:"draft" when workflowStatus is not passed at all', () => {
  const { triggerOps } = partitionOps([{ op: 'duplicateTrigger', triggerId: 'T1' }]);
  const [plan] = planTriggerOps(triggerOps, { ctx, wid: 'W', uid: 'U', existing });
  assert.equal(plan.body.status, 'draft');
});

test('an explicit name wins; an inbound-webhook copy gets a fresh predeterminedId; unknown triggers throw', () => {
  const [byName] = planTriggerOps([{ op: 'duplicateTrigger', name: 'Tag trigger' }], { ctx, wid: 'W', uid: 'U', existing });
  assert.equal(byName.body.name, 'Tag trigger (Copy)');
  const [renamed] = planTriggerOps([{ op: 'duplicateTrigger', triggerId: 'T1', newName: 'Second tag trigger' }], { ctx, wid: 'W', uid: 'U', existing });
  assert.equal(renamed.body.name, 'Second tag trigger');
  const [hook] = planTriggerOps([{ op: 'duplicateTrigger', triggerId: 'T2' }], { ctx, wid: 'W', uid: 'U', existing });
  assert.equal(hook.body.predeterminedId, 'fresh-id');
  assert.throws(() => planTriggerOps([{ op: 'duplicateTrigger', triggerId: 'nope' }], { ctx, wid: 'W', uid: 'U', existing }));
});
