import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendStep, deleteStep, insertAfter, modifyStep, appendToBranch } from './edit.mjs';

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

test('insertAfter drops a step mid-chain and rewires', () => {
  const { templates, diff } = insertAfter(chain(), { id: 'sMid', type: 'email', name: 'M', attributes: {} }, 's1');
  const s1 = templates.find((t) => t.id === 's1'), mid = templates.find((t) => t.id === 'sMid');
  assert.equal(s1.next, 'sMid');           // s1 → new
  assert.equal(mid.next, 's2');            // new → s2 (s1's old next)
  assert.equal(mid.parentKey, 's1');
  assert.deepEqual(diff, { createdSteps: ['sMid'], modifiedSteps: ['s1'], deletedSteps: [] });
});

test('modifyStep patches attributes in place', () => {
  const base = chain().map((t) => (t.id === 's2' ? { ...t, attributes: { body: 'old' } } : t));
  const { templates, diff } = modifyStep(base, 's2', { body: 'new', mediaUrl: 'x' });
  const s2 = templates.find((t) => t.id === 's2');
  assert.equal(s2.attributes.body, 'new');
  assert.equal(s2.attributes.mediaUrl, 'x');
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['s2'], deletedSteps: [] });
});

// a branched graph: container B with a Yes branch-entry (has 1 child) and an empty No branch-entry
const branched = () => [
  { id: 'root1', type: 'add_contact_tag', name: 'Start', next: 'cont', parentKey: null, order: 0, attributes: {} },
  { id: 'cont', type: 'if_else', name: 'Check', nodeType: 'condition-node', next: ['yes', 'no'], parentKey: 'root1', order: 1, attributes: {} },
  { id: 'yes', type: 'if_else', name: 'Yes', nodeType: 'branch-yes', parent: 'cont', parentKey: 'cont', next: 'y1', order: 0, attributes: {} },
  { id: 'y1', type: 'sms', name: 'Yes step 1', parent: 'yes', parentKey: 'yes', next: null, order: 0, attributes: {} },
  { id: 'no', type: 'if_else', name: 'No', nodeType: 'branch-no', parent: 'cont', parentKey: 'cont', next: null, order: 1, attributes: {} },
];

test('appendToBranch chains onto a non-empty branch', () => {
  const { templates, diff } = appendToBranch(branched(), 'yes', { id: 'y2', type: 'email', name: 'Yes step 2', attributes: {} });
  const y1 = templates.find((t) => t.id === 'y1'), y2 = templates.find((t) => t.id === 'y2');
  assert.equal(y1.next, 'y2');
  assert.equal(y2.parent, 'yes');          // stays in the branch scope
  assert.equal(y2.parentKey, 'y1');
  assert.equal(y2.next, null);
  assert.deepEqual(diff, { createdSteps: ['y2'], modifiedSteps: ['y1'], deletedSteps: [] });
});

test('appendToBranch wires the entry for an empty branch', () => {
  const { templates, diff } = appendToBranch(branched(), 'no', { id: 'n1', type: 'sms', name: 'No step 1', attributes: {} });
  const no = templates.find((t) => t.id === 'no'), n1 = templates.find((t) => t.id === 'n1');
  assert.equal(no.next, 'n1');             // empty branch-entry now points to the new step
  assert.equal(n1.parent, 'no');
  assert.equal(n1.parentKey, 'no');
  assert.deepEqual(diff, { createdSteps: ['n1'], modifiedSteps: ['no'], deletedSteps: [] });
});
