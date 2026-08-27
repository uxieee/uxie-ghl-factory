import test from 'node:test';
import assert from 'node:assert/strict';
import { stripNullNext, nullNextIds } from './terminals.mjs';

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
