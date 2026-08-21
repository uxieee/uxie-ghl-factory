import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { evaluateWorkflowRules, checkWorkflowRules } from './graph-rules.mjs';

// GHL's second validation layer (WorkflowValidator) mirrored. The corpus replay (research repo,
// replay-workflow-rules.mjs) proves 0 fires across 326 real workflows; these tests prove each rule
// CAN fire on the shape GHL refuses, and that clean shapes pass.
const R = () => loadCatalog().workflowRules;
const fired = (doc) => evaluateWorkflowRules(doc, R()).findings.map((f) => f.rule);
const step = (id, type, extra = {}) => ({ id, type, name: id, attributes: {}, order: 0, next: null, ...extra });
const trig = (type, conditions = [{ field: 'x', value: 'y' }]) => ({ type, name: type, conditions });

test('catalog carries the workflowRules block with vocab from GHL source', () => {
  const r = R();
  assert.ok(r?.vocab?.actionsUnsupportedInsideLoop?.includes('goto'));
  assert.ok(r.vocab.ivrActionKeys.includes('ivr_gather'));
  assert.ok(r.rules.some((x) => x.rule === 'checkMultipleGoal' && x.runsOnSave));
});

test('checkMultipleGoal: two goals fire, one goal is fine', () => {
  const g = (id) => step(id, 'workflow_goal', { attributes: { op: 'or', segments: [] } });
  assert.ok(fired({ templates: [g('a'), g('b')], triggers: [] }).includes('checkMultipleGoal'));
  assert.ok(!fired({ templates: [g('a')], triggers: [] }).includes('checkMultipleGoal'));
});

test('checkEmptyPublish: publishing zero steps fires; drafting zero steps does not', () => {
  assert.ok(fired({ templates: [], triggers: [], publishing: true }).includes('checkEmptyPublish'));
  assert.ok(!fired({ templates: [], triggers: [], publishing: false }).includes('checkEmptyPublish'));
});

test('loop rules: banned action inside a loop, banned wait inside a loop, empty loop', () => {
  const loop = step('L', 'loop', { attributes: { type: 'loop' } });
  const gotoIn = step('g', 'goto', { parentContainerId: 'L', attributes: { type: 'goto', targetNodeId: 'L' } });
  const waitIn = step('w', 'wait', { parentContainerId: 'L', attributes: { type: 'reply' } });
  const smsIn = step('s', 'sms', { parentContainerId: 'L', attributes: { body: 'x' } });
  let f = fired({ templates: [loop, gotoIn, waitIn], triggers: [] });
  assert.ok(f.includes('checkUnsupportedActionsInsideLoop') && f.includes('checkUnsupportedWaitTypesInsideLoop'));
  assert.ok(fired({ templates: [loop], triggers: [] }).includes('checkLoopHasBody'));
  f = fired({ templates: [loop, smsIn], triggers: [] });
  assert.ok(!f.includes('checkLoopHasBody') && !f.includes('checkUnsupportedActionsInsideLoop'));
});

test('filterless contact_changed + tag mutation fires; with a filter it does not', () => {
  const tag = step('t', 'add_contact_tag', { attributes: { tags: ['x'] } });
  assert.ok(fired({ templates: [tag], triggers: [trig('contact_changed', [])] }).includes('filterlessContactChangedLoopValidator'));
  assert.ok(!fired({ templates: [tag], triggers: [trig('contact_changed')] }).includes('filterlessContactChangedLoopValidator'));
  assert.ok(!fired({ templates: [step('s', 'sms', { attributes: { body: 'x' } })], triggers: [trig('contact_changed', [])] }).includes('filterlessContactChangedLoopValidator'));
});

test('createUpdateContact must map Email or Phone', () => {
  const bad = step('c', 'create_update_contact', { attributes: { fields: [{ title: 'First Name', value: 'x' }] } });
  const ok = step('c', 'create_update_contact', { attributes: { fields: [{ title: 'Email', value: '{{x}}' }] } });
  assert.ok(fired({ templates: [bad], triggers: [] }).includes('createUpdateContactValidator'));
  assert.ok(!fired({ templates: [ok], triggers: [] }).includes('createUpdateContactValidator'));
});

test('delete-contact must be last; IVR needs its trigger; interactive messenger needs comment/DM trigger', () => {
  assert.ok(fired({ templates: [step('d', 'internal-delete-contact', { next: 'x' }), step('x', 'sms', { attributes: { body: 'b' } })], triggers: [] }).includes('validateDeleteContact'));
  assert.ok(fired({ templates: [step('i', 'ivr_say')], triggers: [trig('contact_tag')] }).includes('validateIVRActions'));
  assert.ok(!fired({ templates: [step('i', 'ivr_say')], triggers: [trig('ivr_incoming_call')] }).includes('validateIVRActions'));
  assert.ok(fired({ templates: [step('m', 'respond_on_comment')], triggers: [trig('contact_tag')] }).includes('validateInteractiveMessenger'));
  assert.ok(!fired({ templates: [step('m', 'respond_on_comment')], triggers: [trig('facebook_comment_on_post')] }).includes('validateInteractiveMessenger'));
});

test('appointment booking with an appointment trigger fires', () => {
  assert.ok(fired({ templates: [step('b', 'appointment_booking')], triggers: [trig('appointment')] }).includes('validateAppointmentBooking'));
  assert.ok(!fired({ templates: [step('b', 'appointment_booking')], triggers: [trig('contact_tag')] }).includes('validateAppointmentBooking'));
});

test('create-opportunity vs opportunity_created trigger: no pipeline filter, same pipeline, same stage', () => {
  const act = (attrs) => step('o', 'internal_create_opportunity', { attributes: attrs });
  const tr = (conds) => [trig('opportunity_created', conds)];
  assert.ok(fired({ templates: [act({ pipeline_id: 'P' })], triggers: tr([]) }).includes('validateCreateOpportunity'));            // no pipeline filter
  assert.ok(fired({ templates: [act({ pipeline_id: 'P' })], triggers: tr([{ field: 'opportunity.pipelineId', value: 'P' }]) }).includes('validateCreateOpportunity'));   // same pipeline
  assert.ok(!fired({ templates: [act({ pipeline_id: 'Q' })], triggers: tr([{ field: 'opportunity.pipelineId', value: 'P' }]) }).includes('validateCreateOpportunity'));  // different
  assert.ok(!fired({ templates: [act({ pipeline_id: 'P', pipeline_stage_id: 's2' })], triggers: tr([{ field: 'opportunity.pipelineId', value: 'P' }, { field: 'opportunity.pipelineStageId', value: 's1' }]) }).includes('validateCreateOpportunity'));  // same pipeline, different stage
});

test('trigger/action restriction map (GHL legacy pairs) fires on a listed pair', () => {
  const [trigType, acts] = Object.entries(R().vocab.triggerActionRestrictions)[0];
  assert.ok(fired({ templates: [step('a', acts[0])], triggers: [trig(trigType)] }).includes('validateTriggerActionRestrictions'));
});

test('validateWaitStep: stringified window, non-branchable type branching, missing transition', () => {
  const w = (attrs, extra = {}) => step('w', 'wait', { attributes: { type: 'time', ...attrs }, ...extra });
  assert.ok(fired({ templates: [w({ window: '{"start":"09:00"}' })], triggers: [] }).includes('validateWaitStep'));
  assert.ok(fired({ templates: [w({ type: 'time' }, { cat: 'multi-path', next: ['a', 'b'] }), step('a', 'sms'), step('b', 'sms')], triggers: [] }).includes('validateWaitStep'));
  assert.ok(fired({ templates: [w({ type: 'reply', convertToMultipath: true, transitions: [{ id: 'ghost', name: 'Reply' }] }, { cat: 'multi-path', next: ['a', 'b'] }), step('a', 'sms'), step('b', 'sms')], triggers: [] }).includes('validateWaitStep'));
  assert.ok(!fired({ templates: [w({ type: 'reply', convertToMultipath: true, transitions: [{ id: 'a', name: 'Reply' }, { id: 'b', name: 'Timeout' }] }, { cat: 'multi-path', next: ['a', 'b'] }), step('a', 'sms'), step('b', 'sms')], triggers: [] }).includes('validateWaitStep'));
});

test('checkWorkflowRules throws WORKFLOW_RULE naming the GHL rule; hatch is full or targeted', () => {
  const doc = { templates: [step('a', 'workflow_goal'), step('b', 'workflow_goal')], triggers: [] };
  assert.throws(() => checkWorkflowRules(doc, R()), /WORKFLOW_RULE[\s\S]*checkMultipleGoal/);
  checkWorkflowRules(doc, R(), { skipWorkflowRules: true });
  checkWorkflowRules(doc, R(), { skipWorkflowRules: ['checkMultipleGoal'] });
  assert.deepEqual(checkWorkflowRules({ templates: [step('a', 'sms', { attributes: { body: 'hi' } })], triggers: [trig('contact_tag')] }, R()), []);
});

test('advisory channel: a picker-disabled action under its trigger WARNS (never blocks)', () => {
  const r = R();
  const [trigType, acts] = Object.entries(r.disabledActionsByTrigger ?? {})[0] ?? [];
  if (!trigType) return;                                   // catalog predates round 2 — nothing to assert
  const warns = [];
  const doc = { templates: [step('x', acts[0], { attributes: { body: 'b' } })], triggers: [trig(trigType)] };
  const res = checkWorkflowRules(doc, r, { warn: (m) => warns.push(m) });
  assert.deepEqual(res, []);                                   // not a block
  assert.ok(warns.some((m) => /WORKFLOW_RULE_SOFT.*inCompatibleActions/.test(m)), JSON.stringify(warns));
});
