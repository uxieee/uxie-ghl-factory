import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendStep, deleteStep } from './edit.mjs';

const chain = () => [
  { id: 's1', type: 'add_contact_tag', name: 'A', next: 's2', parentKey: null, order: 0, attributes: {} },
  { id: 's2', type: 'sms', name: 'B', next: 's3', parentKey: 's1', order: 1, attributes: {} },
  { id: 's3', type: 'add_contact_tag', name: 'C', next: null, parentKey: 's2', order: 2, attributes: {} },
];

test('appendStep wires onto the tail and diffs correctly', () => {
  const { templates, diff } = appendStep(chain(), { id: 'sNew', type: 'email', name: 'D', attributes: {} });
  const tail = templates.find((t) => t.id === 's3');
  const added = templates.find((t) => t.id === 'sNew');
  assert.equal(tail.next, 'sNew');          // old tail now points to new step
  assert.equal(added.next, null);           // new step is the new tail
  assert.equal(added.parentKey, 's3');
  assert.deepEqual(diff, { createdSteps: ['sNew'], modifiedSteps: ['s3'], deletedSteps: [] });
});

test('deleteStep removes and rewires the predecessor', () => {
  const { templates, diff } = deleteStep(chain(), 's2');
  assert.equal(templates.find((t) => t.id === 's2'), undefined);
  assert.equal(templates.find((t) => t.id === 's1').next, 's3');   // s1 now skips to s3
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['s1'], deletedSteps: ['s2'] });
});

test('deleteStep on the tail leaves predecessor.next null', () => {
  const { templates, diff } = deleteStep(chain(), 's3');
  assert.equal(templates.find((t) => t.id === 's2').next, null);
  assert.deepEqual(diff.deletedSteps, ['s3']);
});

test('deleteStep of a missing id is a no-op', () => {
  const { diff } = deleteStep(chain(), 'nope');
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: [], deletedSteps: [] });
});
