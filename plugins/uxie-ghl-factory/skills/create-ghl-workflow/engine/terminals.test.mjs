import test from 'node:test';
import assert from 'node:assert/strict';
import { stripNullNext, nullNextIds, fillInputTriggerParams } from './terminals.mjs';

test('an explicit null next is removed and nothing else on the step changes', () => {
  const templates = [
    { id: 'a', type: 'sms', name: 'Text', next: 'b', order: 0 },
    { id: 'b', type: 'conversationai_continue', name: 'End', next: null, parentKey: 'a', order: 1 },
  ];
  const out = stripNullNext(templates);
  assert.equal('next' in out[1], false);
  assert.deepEqual(out, [
    { id: 'a', type: 'sms', name: 'Text', next: 'b', order: 0 },
    { id: 'b', type: 'conversationai_continue', name: 'End', parentKey: 'a', order: 1 },
  ]);
});

test('a clean array comes back as the SAME object, so callers relying on identity are unaffected', () => {
  const templates = [{ id: 'a', type: 'sms', next: 'b' }, { id: 'b', type: 'email' }];
  assert.equal(stripNullNext(templates), templates);
});

test('a container next[] and a scalar next are never touched', () => {
  const templates = [
    { id: 'c', type: 'if_else', next: ['b1', 'b2'] },
    { id: 'b1', type: 'transition', next: 'x' },
  ];
  assert.deepEqual(stripNullNext(templates), templates);
});

test('nullNextIds reports every offending step by id, name and type', () => {
  const templates = [
    { id: 'a', type: 'sms', next: 'b' },
    { id: 'b', type: 'conversationai_continue', name: 'End', next: null },
    { id: 'c', type: 'goto', next: null },
  ];
  assert.deepEqual(nullNextIds(templates), [
    { id: 'b', name: 'End', type: 'conversationai_continue' },
    { id: 'c', name: null, type: 'goto' },
  ]);
});

test('a non-array is handed straight back rather than throwing', () => {
  assert.equal(stripNullNext(undefined), undefined);
  assert.deepEqual(nullNextIds(undefined), []);
});

test('editCommitBody strips a legacy null terminal the edit never touched', async () => {
  const { editCommitBody } = await import('./edit.mjs');
  const fresh = { _id: 'w1', id: 'w1', status: 'draft', version: 4, name: 'WF' };
  const templates = [
    { id: 'a', type: 'sms', name: 'Text', next: 'b', order: 0 },
    { id: 'b', type: 'email', name: 'Mail', next: null, parentKey: 'a', order: 1 },
  ];
  const diff = { createdSteps: [], modifiedSteps: ['a'], deletedSteps: [] };
  const body = editCommitBody(fresh, templates, diff, 'uid-1');
  const sent = body.workflowData.templates;
  assert.equal('next' in sent[1], false, 'the untouched legacy terminal must not carry next:null');
  assert.equal(sent[0].next, 'b', 'a real forward edge is untouched');
  assert.deepEqual(body.modifiedSteps, ['a'], 'the diff is unchanged by normalisation');
});

test('fillInputTriggerParams defaults input_trigger_params:false on an add_to_workflow step that lacks it', () => {
  const templates = [
    { id: 'a', type: 'add_to_workflow', name: 'Enrol', attributes: { workflow_id: 'W1', type: 'add_to_workflow' }, order: 0 },
  ];
  const out = fillInputTriggerParams(templates);
  assert.equal(out[0].attributes.input_trigger_params, false);
  assert.equal(out[0].attributes.workflow_id, 'W1', 'the rest of attributes is untouched');
});

test('fillInputTriggerParams leaves an author-supplied true alone', () => {
  const templates = [
    { id: 'a', type: 'add_to_workflow', name: 'Enrol', attributes: { workflow_id: 'W1', type: 'add_to_workflow', input_trigger_params: true }, order: 0 },
  ];
  const out = fillInputTriggerParams(templates);
  assert.equal(out[0].attributes.input_trigger_params, true);
  assert.equal(out, templates, 'nothing changed, so the identity-preservation contract still applies');
});

test('fillInputTriggerParams returns the SAME array when nothing changed, exactly as stripNullNext does', () => {
  const templates = [
    { id: 'a', type: 'sms', name: 'Text', attributes: {}, order: 0 },
    { id: 'b', type: 'add_to_workflow', name: 'Enrol', attributes: { workflow_id: 'W1', type: 'add_to_workflow', input_trigger_params: false }, order: 1 },
  ];
  assert.equal(fillInputTriggerParams(templates), templates);
});

test('fillInputTriggerParams never touches a non-add_to_workflow step, even one with no attributes key', () => {
  const templates = [{ id: 'a', type: 'sms', name: 'Text', order: 0 }];
  assert.deepEqual(fillInputTriggerParams(templates), templates);
  assert.equal(fillInputTriggerParams(templates), templates);
});

test('a non-array is handed straight back rather than throwing (fillInputTriggerParams)', () => {
  assert.equal(fillInputTriggerParams(undefined), undefined);
});

test('editCommitBody fills input_trigger_params on a legacy add_to_workflow step this edit never touched — its absence blocks EVERY save on the workflow, not just this step', async () => {
  const { editCommitBody } = await import('./edit.mjs');
  const fresh = { _id: 'w1', id: 'w1', status: 'draft', version: 4, name: 'WF' };
  const templates = [
    { id: 'a', type: 'sms', name: 'Text', next: 'b', order: 0 },
    { id: 'b', type: 'add_to_workflow', name: 'Enrol', attributes: { workflow_id: 'W1', type: 'add_to_workflow' }, parentKey: 'a', order: 1 },
  ];
  const diff = { createdSteps: [], modifiedSteps: ['a'], deletedSteps: [] };
  const body = editCommitBody(fresh, templates, diff, 'uid-1');
  const sent = body.workflowData.templates;
  assert.equal(sent[1].attributes.input_trigger_params, false,
    'a stored {workflow_id, type}-only add_to_workflow step must not ride the wire unrepaired');
});

test('a built workflow puts no null terminal in autoSaveBody', async () => {
  const { compile } = await import('./compiler.mjs');
  const { loadCatalog } = await import('./catalog.mjs');
  const { makeSeededIdGen } = await import('./idgen.mjs');
  // Same ctx shape the existing engine tests use (convai-nodes.test.mjs:11).
  const ctx = {
    loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27,
    idGen: makeSeededIdGen('a'), catalog: loadCatalog(),
  };
  const out = compile({
    name: 'Terminal probe',
    triggers: [],
    graph: [
      { ref: 's1', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } },
      { ref: 's2', kind: 'action', type: 'add_contact_tag', name: 'Tag2', attributes: { tags: ['y'] } },
    ],
  }, ctx);
  const sent = out.autoSaveBody.workflowData.templates;
  assert.equal(sent.length, 2);
  assert.equal(sent[0].next, sent[1].id, 'the first step still points at the second');
  assert.equal('next' in sent[1], false, 'the terminal must not carry next:null on the wire');
});
