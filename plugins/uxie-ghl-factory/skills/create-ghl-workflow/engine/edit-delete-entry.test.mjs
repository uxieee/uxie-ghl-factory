// bl-429: deleting the entry step left its successor wherever it sat in the array; the runtime enters at index 0
// (F5-34), so editCommitBody refused ENTRY_NOT_FIRST and the only route was a reordered repair_workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteStep, editCommitBody } from './edit.mjs';

const doc = () => [
  { id: 's1', type: 'add_contact_tag', name: 'Entry', order: 0, parentKey: null, next: 's2', attributes: { tags: ['a'] } },
  { id: 's3', type: 'add_contact_tag', name: 'Third', order: 2, parentKey: 's2', next: null, attributes: { tags: ['c'] } },
  { id: 's2', type: 'add_contact_tag', name: 'Second', order: 1, parentKey: 's1', next: 's3', attributes: { tags: ['b'] } },
];

test('deleting the entry step moves its successor to index 0 as the new entry', () => {
  const { templates, diff } = deleteStep(doc(), 's1');
  assert.equal(templates[0].id, 's2');
  assert.equal(templates[0].parentKey, null);
  assert.deepEqual(templates.map((t) => t.id), ['s2', 's3']);
  assert.ok(diff.modifiedSteps.includes('s2'));
});

test('and the commit body is accepted (no ENTRY_NOT_FIRST)', () => {
  const { templates, diff } = deleteStep(doc(), 's1');
  assert.doesNotThrow(() => editCommitBody({ _id: 'W', name: 'W', status: 'draft', workflowData: { templates: doc() } }, templates, diff, 'U', {}));
});

test('CONTROL: deleting a middle step leaves the array order alone', () => {
  const { templates } = deleteStep(doc(), 's2');
  assert.deepEqual(templates.map((t) => t.id), ['s1', 's3']);
});
