// bl-400: insertBefore on the FIRST step of a lane delegated to insertAfter(predecessor) — and the predecessor is the
// lane's transition, whose own parent is the container. The new step took the container as its parent; a step inserted
// before X belongs to X's scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertBefore } from './edit.mjs';

const lane = () => [
  { id: 'C', type: 'find_opportunity', name: 'Find', order: 0, parentKey: null, next: ['T1', 'T2'], attributes: {} },
  { id: 'T1', type: 'transition', name: 'Found', parent: 'C', parentKey: 'C', next: 'L1', attributes: {} },
  { id: 'T2', type: 'transition', name: 'Not found', parent: 'C', parentKey: 'C', next: null, attributes: {} },
  { id: 'L1', type: 'add_contact_tag', name: 'Lane first', parent: 'T1', parentKey: 'T1', next: 'L2', attributes: { tags: ['a'] } },
  { id: 'L2', type: 'add_contact_tag', name: 'Lane second', parent: 'T1', parentKey: 'L1', next: null, attributes: { tags: ['b'] } },
];
const step = { id: 'N', type: 'add_contact_tag', name: 'New', attributes: { tags: ['n'] } };

test('a step inserted before a lane-first step takes the lane as its parent, not the container', () => {
  const { templates } = insertBefore(lane(), step, 'L1');
  const n = templates.find((t) => t.id === 'N');
  assert.equal(n.parent, 'T1');
  assert.equal(n.parentKey, 'T1');
  assert.equal(templates.find((t) => t.id === 'T1').next, 'N');
  assert.equal(templates.find((t) => t.id === 'L1').parentKey, 'N');
});

test('CONTROL: inserting before a lane-second step already took the lane (via the lane-first anchor)', () => {
  const n = insertBefore(lane(), step, 'L2').templates.find((t) => t.id === 'N');
  assert.equal(n.parent, 'T1');
});
