// THE entry point every write asks. The bug it exists to prevent: publish_workflow ran the engine
// gate and GHL's validator but NOT GHL's WorkflowValidator rules, because each path assembled its
// own layers and nobody noticed publish had assembled fewer. Layers belong to the intent now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument, validateForWrite, LAYERS } from './write-validation.mjs';
import { loadCatalog } from './catalog.mjs';

const catalog = loadCatalog();
const sms = (over = {}) => ({ id: 's1', name: 'Text', type: 'sms', order: 0, next: null,
  attributes: { type: 'sms', body: 'hi' }, ...over });
const base = { templates: [sms()], triggers: [], catalog, marketplaceTypes: new Set() };

test('the layer list is the contract: rules, canvas, engine, server', () => {
  assert.deepEqual(LAYERS, ['workflow_rules', 'canvas', 'engine', 'server']);
});

test('an empty workflow is legal as a draft and refused on publish — the layer publish used to skip', () => {
  assert.equal(validateDocument({ ...base, templates: [], intent: 'edit' }).blocked, false);
  const r = validateDocument({ ...base, templates: [], intent: 'publish' });
  assert.equal(r.blocked, true);
  assert.equal(r.blockingLayer, 'workflow_rules');
  assert.match(r.summary, /checkEmptyPublish|zero steps/);
});

test('saving an already-published workflow validates as publishing, the way the builder does', () => {
  // use-save-workflow.ts: "Saving a published workflow re-publishes it, so it goes through the same gate."
  const r = validateDocument({ ...base, templates: [], intent: 'edit', status: 'published' });
  assert.equal(r.blocked, true);
  assert.equal(r.publishing, true);
});

test('the engine layer still catches what GHL lets through', () => {
  const r = validateDocument({ ...base, templates: [sms({ attributes: { type: 'sms', body: 'hi', totallyInvented: 1 } })], intent: 'edit' });
  assert.equal(r.blocked, true);
  assert.equal(r.blockingLayer, 'engine');
  assert.match(r.summary, /ATTRIBUTE_KEY/);
});

test("the canvas's own stored error flag blocks a publish", () => {
  // shouldAllowPublishInNewBuilder() reads advanceCanvasMeta.hasErrors off the STORED step; the UI
  // refuses to publish while any step or trigger carries it.
  const flagged = sms({ advanceCanvasMeta: { hasErrors: true } });
  assert.equal(validateDocument({ ...base, templates: [flagged], intent: 'publish' }).blockingLayer, 'canvas');
  assert.equal(validateDocument({ ...base, templates: [flagged], intent: 'edit' }).blocked, false,
    'a draft edit is not a publish — the builder allows the save');
});

test('a trigger carrying the flag blocks a publish too', () => {
  const r = validateDocument({ ...base, intent: 'publish', triggers: [{ id: 't1', name: 'T', type: 'contact_created', advanceCanvasMeta: { hasErrors: true } }] });
  assert.equal(r.blockingLayer, 'canvas');
});

test('scope demotes a finding on a step this write never touched', () => {
  const dirty = [sms(), sms({ id: 's2', attributes: { type: 'sms', body: 'x', totallyInvented: 1 } })];
  const r = validateDocument({ ...base, templates: dirty, intent: 'edit', scope: new Set(['s1']) });
  assert.equal(r.blocked, false, 's2 was not touched by this write');
  assert.equal(r.engine.warnings.length >= 1, true);
});

test('every hatch is honoured, and every finding is still reported', () => {
  const r = validateDocument({ ...base, templates: [], intent: 'publish', skipWorkflowRules: true });
  assert.equal(r.blocked, false);
  const named = validateDocument({ ...base, templates: [], intent: 'publish', skipWorkflowRules: ['checkEmptyPublish'] });
  assert.equal(named.blocked, false);
  assert.equal(named.rules.skipped.length, 1, 'a skipped rule is recorded, not forgotten');
});

test('validateForWrite adds GHL\'s verdict, and reports which layer refused', async () => {
  const call = async () => ({ ok: false, status: 400, json: { valid: false, errorMetadata: { validationFailure: true, validationType: 'action', errors: [{ message: 'Fields is required', stepId: 's1', stepName: 'Text', stepType: 'sms' }] } } });
  const r = await validateForWrite({ ...base, intent: 'publish', call, loc: 'L', wid: 'W', document: { workflowData: { templates: [sms()] } } });
  assert.equal(r.blocked, true);
  assert.equal(r.blockingLayer, 'server');
  assert.match(r.summary, /Fields is required/);
});

test('the rules about whether a workflow can RUN refuse a publish and warn on a draft', () => {
  const ai = { id: 'a1', name: 'Reply', type: 'conversationai_custom_message', order: 0, next: null, attributes: {} };
  const pub = validateDocument({ ...base, templates: [ai], intent: 'publish' });
  assert.equal(pub.blockingLayer, 'workflow_rules');
  assert.match(pub.summary, /validateRequiredTriggersForActions/);
  const draft = validateDocument({ ...base, templates: [ai], intent: 'edit' });
  assert.ok(!draft.blockedLayers.includes('workflow_rules'), 'a draft cannot run, so it is not refused');
  assert.ok(draft.rules.advisories.some((a) => a.rule === 'validateRequiredTriggersForActions'), 'but it is not silent either');
});

test('validateForWrite reads creationSource off the document it judges', async () => {
  const templates = [
    { id: 'c', name: 'Check', type: 'if_else', order: 0, next: ['y', 'n'], attributes: { branches: [] } },
    { id: 'y', name: 'Yes', type: 'if_else', nodeType: 'branch-yes', order: 0, next: null, attributes: {} },
    { id: 'n', name: 'None', type: 'if_else', nodeType: 'branch-no', order: 1, next: null, attributes: { else: true } },
  ];
  const judged = (creationSource) => validateForWrite({ ...base, templates: undefined, intent: 'publish',
    document: { creationSource, workflowData: { templates } } });
  const ai = await judged('workflow_ai');
  assert.ok(ai.rules.findings.some((f) => f.rule === 'validateIfElseCondition'), JSON.stringify(ai.rules.findings));
  const human = await judged('builder');
  assert.ok(!human.rules.findings.some((f) => f.rule === 'validateIfElseCondition'), 'GHL judges only Workflow-AI-authored if/else');
});

test('a build asks the offline layers before anything exists, and the server layer says why it could not run', async () => {
  const r = await validateForWrite({ ...base, intent: 'build' });
  assert.equal(r.server.ran, false);
  assert.match(r.server.why, /workflow id/i);
  assert.equal(r.blocked, false, 'no verdict from GHL is not a refusal');
});
