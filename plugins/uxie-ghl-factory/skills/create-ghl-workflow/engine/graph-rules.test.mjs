import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { evaluateWorkflowRules, checkWorkflowRules, rulesNeedTriggers, fromEmailNeedsDomain } from './graph-rules.mjs';

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

// ── checkFromEmailFormat (GHL 2026-09-11, in validate()'s throw chain) ────────────────────────
// Fires only when the workflow's SENDING DOMAIN is known (GET /workflow/{loc}/email/domain-selection)
// and is a specific domain: with "All Domains" the From Email is a local part by design. A merge
// field is exempt — it resolves at send time, so its literal text cannot be format-checked.
const SD = { vocab: { senderDomain: { allDomains: 'ALL_DOMAINS' } } };
const withEmail = (from_email, senderDomain) => ({ templates: [], settings: { senderAddress: { from_email } }, senderDomain });
const firedFromEmail = (doc) => evaluateWorkflowRules(doc, SD).findings.filter((f) => f.rule === 'checkFromEmailFormat');

test('checkFromEmailFormat: a specific sending domain requires a real address', () => {
  assert.equal(firedFromEmail(withEmail('marketing', 'mail.example.com')).length, 1, 'no @');
  assert.equal(firedFromEmail(withEmail('marketing@example', 'mail.example.com')).length, 1, 'no dot');
  assert.equal(firedFromEmail(withEmail('hello@example.com', 'mail.example.com')).length, 0);
});

test('checkFromEmailFormat: a merge field is exempt, it resolves at send time', () => {
  assert.equal(firedFromEmail(withEmail('{{location.email}}', 'mail.example.com')).length, 0);
});

test('checkFromEmailFormat: All Domains means the From Email is a local part by design', () => {
  assert.equal(firedFromEmail(withEmail('marketing', 'ALL_DOMAINS')).length, 0);
});

test('checkFromEmailFormat is NOT EVALUABLE without the sending domain, never silently passed', () => {
  const r = evaluateWorkflowRules(withEmail('marketing', undefined), SD);
  assert.equal(r.findings.filter((f) => f.rule === 'checkFromEmailFormat').length, 0);
  assert.match(r.notEvaluable.join(' '), /checkFromEmailFormat/);
});

test('fromEmailNeedsDomain: only a From Email the rule could refuse is worth a domain read', () => {
  assert.equal(fromEmailNeedsDomain('marketing'), true);
  assert.equal(fromEmailNeedsDomain('marketing@example'), true);
  assert.equal(fromEmailNeedsDomain('hello@example.com'), false, 'a full address passes on every domain');
  assert.equal(fromEmailNeedsDomain('{{location.email}}'), false, 'a merge field is exempt');
  assert.equal(fromEmailNeedsDomain(undefined), false);
});

test('checkFromEmailFormat: a full address is judged (it passes) even with no domain read', () => {
  const r = evaluateWorkflowRules(withEmail('hello@example.com', undefined), SD);
  assert.ok(!r.notEvaluable.some((n) => /checkFromEmailFormat/.test(n)), r.notEvaluable.join(' | '));
});

// ── The three rules about whether a workflow can RUN ─────────────────────────────────────────
// GHL's builder refuses these on every save. The engine refuses them when the write PUBLISHES and
// warns on a draft: a draft cannot run, and a build or edit legitimately completes the workflow
// across calls (the webhook sample is pinned after the workflow exists; a trigger can be added in
// a later edit). Silent is not an option either way.

// validateRequiredTriggersForActions — getActionMetaData(type).requiredTriggers. Measured
// 2026-09-12: GHL's server validator answers valid:true on an AI step with NO trigger
// (live-70-required-trigger.json), so this replay is the only check there is.
const RT = { requiredTriggersByAction: {
  conversationai_custom_message: ['conv_ai_autonomous_trigger', 'conv_ai_trigger'], 'tiktok-dm': ['customer_reply'] } };
const aiStep = () => step('a1', 'conversationai_custom_message', { name: 'Reply' });
const required = (doc) => evaluateWorkflowRules(doc, RT);

test('catalog carries every action\'s required triggers, from GHL\'s own action metadata', () => {
  const m = R().requiredTriggersByAction ?? {};
  assert.deepEqual([...(m.conversationai_custom_message ?? [])].sort(), ['conv_ai_autonomous_trigger', 'conv_ai_trigger']);
  assert.deepEqual(m['tiktok-dm'], ['customer_reply']);
  assert.equal(Object.keys(m).length, 11, Object.keys(m).join(', '));
});

test('validateRequiredTriggersForActions: publishing an AI step with no trigger is refused', () => {
  const f = required({ templates: [aiStep()], triggers: [], publishing: true }).findings;
  assert.deepEqual(f.map((x) => x.rule), ['validateRequiredTriggersForActions']);
  assert.match(f[0].message, /"Reply" action requires conv_ai_autonomous_trigger or conv_ai_trigger trigger to be present/);
});

test('validateRequiredTriggersForActions: any ONE of the required triggers satisfies it', () => {
  for (const t of ['conv_ai_trigger', 'conv_ai_autonomous_trigger'])
    assert.deepEqual(required({ templates: [aiStep()], triggers: [trig(t)], publishing: true }).findings, [], t);
  assert.equal(required({ templates: [step('d', 'tiktok-dm')], triggers: [trig('facebook_comment_on_post')], publishing: true }).findings.length, 1);
});

test('validateRequiredTriggersForActions: a draft is warned, never refused, never silent', () => {
  const r = required({ templates: [aiStep()], triggers: [], publishing: false });
  assert.deepEqual(r.findings, []);
  assert.ok(r.advisories.some((a) => a.rule === 'validateRequiredTriggersForActions' && /publish/.test(a.message)));
});

test('rulesNeedTriggers: a required-trigger action makes an edit load the trigger list', () => {
  assert.equal(rulesNeedTriggers([aiStep()], RT), true);
  assert.equal(rulesNeedTriggers([step('s', 'sms')], RT), false);
});

// inboundWebhookTriggerValidator — GHL reads GET /hooks/inbound-webhook-request/reference/{triggerId}
// for the FIRST inbound_webhook trigger and refuses when the answer has no payload. The reference is
// not in the document, so the caller reads it and passes it in; without it the rule is unjudged.
const hook = (id = 'T1') => ({ id, type: 'inbound_webhook', name: 'Inbound Webhook', conditions: [] });
const hookDoc = (webhookReference, publishing = true) => ({ templates: [step('s', 'sms')], triggers: [hook()], publishing, webhookReference });
const hookRule = (doc) => evaluateWorkflowRules(doc, {});

test('inboundWebhookTriggerValidator: publishing with no mapped sample is refused', () => {
  const f = hookRule(hookDoc({ triggerId: 'T1', payload: null })).findings;
  assert.deepEqual(f.map((x) => x.rule), ['inboundWebhookTriggerValidator']);
  assert.match(f[0].message, /Mapping Reference is required for the Inbound Webhook Trigger/);
});

test('inboundWebhookTriggerValidator: a mapped sample passes', () => {
  assert.deepEqual(hookRule(hookDoc({ triggerId: 'T1', payload: { dealRef: 'D-1' } })).findings, []);
});

test('inboundWebhookTriggerValidator: without the reference read it is NOT EVALUABLE, never passed', () => {
  const r = hookRule(hookDoc(undefined));
  assert.deepEqual(r.findings, []);
  assert.match(r.notEvaluable.join(' '), /inboundWebhookTriggerValidator/);
});

test('inboundWebhookTriggerValidator: a draft is warned; a workflow with no webhook trigger is not judged at all', () => {
  const draft = hookRule(hookDoc({ triggerId: 'T1', payload: null }, false));
  assert.deepEqual(draft.findings, []);
  assert.ok(draft.advisories.some((a) => a.rule === 'inboundWebhookTriggerValidator'));
  const none = hookRule({ templates: [step('s', 'sms')], triggers: [], publishing: true });
  assert.ok(!none.notEvaluable.some((n) => /inboundWebhookTriggerValidator/.test(n)));
});

// validateIfElseCondition — GHL judges it only for creationSource 'workflow_ai' (a stored field on
// the document). Shapes are the engine's own condition-node / branch-yes / branch-no.
const cond = (over = {}) => ({ conditionType: 'contact_detail', conditionSubType: 'first_name', conditionOperator: 'is', conditionValue: 'Ann', ...over });
const branch = (conditions, name = 'Yes') => ({ id: 'y', name, segments: conditions === null ? [] : [{ operator: 'and', conditions }] });
const ifElse = (branches, over = {}) => [
  step('c', 'if_else', { name: 'Check', nodeType: 'condition-node', next: ['y', 'n'], attributes: { branches }, ...over }),
  step('y', 'if_else', { name: 'Yes', nodeType: 'branch-yes', attributes: { branches: [] } }),
  step('n', 'if_else', { name: 'None', nodeType: 'branch-no', attributes: { else: true } }),
];
const ifMsgs = (templates, extra = {}) => evaluateWorkflowRules({ templates, triggers: [], publishing: true, creationSource: 'workflow_ai', ...extra }, {})
  .findings.filter((f) => f.rule === 'validateIfElseCondition').map((f) => f.message);

test('validateIfElseCondition: only a Workflow-AI-authored workflow is judged', () => {
  assert.deepEqual(ifMsgs(ifElse([branch(null)]), { creationSource: 'builder' }), []);
  assert.deepEqual(ifMsgs(ifElse([branch(null)]), { creationSource: undefined }), []);
  assert.equal(ifMsgs(ifElse([branch(null)])).length, 1);
});

test('validateIfElseCondition: a complete condition passes; a legacy if/else skips the whole rule', () => {
  assert.deepEqual(ifMsgs(ifElse([branch([cond()])])), []);
  const legacy = [step('old', 'if_else', { attributes: { segments: [{ conditions: [] }] } }), ...ifElse([branch(null)])];
  assert.deepEqual(ifMsgs(legacy), []);
});

test('validateIfElseCondition: an if/else node with no nodeType gets GHL\'s missing-configuration message', () => {
  const t = ifElse([branch([cond()])]);
  delete t[1].nodeType;
  assert.match(ifMsgs(t)[0], /The condition "Yes" is missing required configuration\. Try creating a new workflow using AI/);
  assert.match(ifMsgs(t, { status: 'published' })[0], /Your published workflow will continue running with the previous version/);
});

test('validateIfElseCondition: the structure checks, in GHL\'s order', () => {
  assert.match(ifMsgs(ifElse([branch([cond()])], { next: ['y'] }))[0], /"Check" condition requires at least two next nodes/);
  assert.match(ifMsgs(ifElse([]))[0], /"Check" condition requires at least one branch/);
  assert.match(ifMsgs(ifElse([branch(null)]))[0], /branch "Yes" in "Check" condition requires at least one segment/);
  assert.match(ifMsgs(ifElse([branch([])]))[0], /a segment in branch "Yes" of "Check" condition requires at least one condition/);
});

test('validateIfElseCondition: every missing part of a condition is named', () => {
  const one = (over) => ifMsgs(ifElse([branch([cond(over)])]))[0] ?? '';
  assert.match(one({ conditionType: '' }), /missing a condition type/);
  assert.match(one({ conditionSubType: undefined }), /missing a condition field/);
  assert.match(one({ conditionOperator: '' }), /missing a condition operator/);
  assert.match(one({ conditionValue: '' }), /missing a condition value/);
  assert.match(one({ conditionValue: [] }), /missing a condition value/);
});

test('validateIfElseCondition: operators and date words that need no value pass; a relative date needs a unit', () => {
  for (const conditionOperator of ['has_value', 'has_no_value', 'timeout'])
    assert.deepEqual(ifMsgs(ifElse([branch([cond({ conditionOperator, conditionValue: undefined })])])), [], conditionOperator);
  for (const conditionValueOperator of ['today', 'yesterday', 'tomorrow'])
    assert.deepEqual(ifMsgs(ifElse([branch([cond({ conditionValueOperator, conditionValue: undefined })])])), [], conditionValueOperator);
  assert.match(ifMsgs(ifElse([branch([cond({ conditionValueOperator: 'inTheNext', conditionValue: 3 })])]))[0], /requires a time unit/);
  assert.deepEqual(ifMsgs(ifElse([branch([cond({ conditionValueOperator: 'inTheNext', conditionValueUnit: 'days', conditionValue: 3 })])])), []);
  assert.deepEqual(ifMsgs(ifElse([branch([cond({ conditionValueOperator: 'on', conditionValue: '2026-01-01' })])])), []);
});

test('validateIfElseCondition: a draft is warned, not refused', () => {
  const r = evaluateWorkflowRules({ templates: ifElse([branch(null)]), triggers: [], publishing: false, creationSource: 'workflow_ai' }, {});
  assert.deepEqual(r.findings, []);
  assert.ok(r.advisories.some((a) => a.rule === 'validateIfElseCondition'));
});
