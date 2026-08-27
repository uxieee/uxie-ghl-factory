import test from 'node:test';
import assert from 'node:assert/strict';
import { gotoLoops } from './goto-loops.mjs';

test('a goto pointing back at an ancestor is reported as a loop', () => {
  const templates = [
    { id: 'a', type: 'sms', name: 'First', next: 'b' },
    { id: 'b', type: 'email', name: 'Second', next: 'g' },
    { id: 'g', type: 'goto', name: 'Back to first', attributes: { targetNodeId: 'a', type: 'goto' } },
  ];
  assert.deepEqual(gotoLoops(templates), [
    { id: 'g', name: 'Back to first', target: 'a', targetName: 'First' },
  ]);
});

test('a goto pointing FORWARD is not a loop', () => {
  const templates = [
    { id: 'a', type: 'sms', name: 'First', next: 'g' },
    { id: 'g', type: 'goto', name: 'Skip ahead', attributes: { targetNodeId: 'z', type: 'goto' } },
    { id: 'z', type: 'email', name: 'Later' },
  ];
  assert.deepEqual(gotoLoops(templates), []);
});

test('a goto reachable from its target through a BRANCH is still a loop', () => {
  const templates = [
    { id: 'c', type: 'if_else', name: 'Split', next: ['t1', 't2'] },
    { id: 't1', type: 'transition', name: 'Yes', next: 'g' },
    { id: 't2', type: 'transition', name: 'No' },
    { id: 'g', type: 'goto', name: 'Back to split', attributes: { targetNodeId: 'c', type: 'goto' } },
  ];
  assert.deepEqual(gotoLoops(templates).map((l) => l.id), ['g']);
});

test('a goto whose target does not exist is not reported here (REF_DANGLING owns that)', () => {
  const templates = [
    { id: 'g', type: 'goto', name: 'Nowhere', attributes: { targetNodeId: 'missing', type: 'goto' } },
  ];
  assert.deepEqual(gotoLoops(templates), []);
});

test('a goto pointing at ITSELF is a loop', () => {
  const templates = [
    { id: 'g', type: 'goto', name: 'Self', attributes: { targetNodeId: 'g', type: 'goto' } },
  ];
  assert.deepEqual(gotoLoops(templates).map((l) => l.id), ['g']);
});
