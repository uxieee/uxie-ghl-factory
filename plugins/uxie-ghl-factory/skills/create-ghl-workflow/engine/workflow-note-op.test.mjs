// setWorkflowNote (coordinator-approved 2026-09-29): an edit op on the scoped note route, never the document PUT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionOps, planWorkflowNoteOps, applyOps, checkOpShape } from './edit-driver.mjs';

test('setWorkflowNote is partitioned as a NOTE op, not a step op', () => {
  const p = partitionOps([{ op: 'setWorkflowNote', content: 'x' }, { op: 'renameStep', stepId: 's', name: 'n' }]);
  assert.equal(p.noteOps.length, 1); assert.equal(p.stepOps.length, 1);
});
test('it plans exactly the measured request: PUT update-workflow-note {content, updatedByName}', () => {
  const r = planWorkflowNoteOps([{ op: 'setWorkflowNote', content: 'Owner: sales' }], { loc: 'LOC', wid: 'WID' });
  assert.deepEqual(r, { op: 'setWorkflowNote', method: 'PUT', path: '/workflow/LOC/update-workflow-note/WID', body: { content: 'Owner: sales', updatedByName: 'uxie-ghl-factory' } });
  assert.equal(planWorkflowNoteOps([{ op: 'setWorkflowNote', content: '' }], { loc: 'L', wid: 'W' }).body.content, '', '"" clears');
  assert.equal(planWorkflowNoteOps([], { loc: 'L', wid: 'W' }), null);
});
test('CONTROL: a missing or non-string content, two notes, or an unknown key is refused before any write', () => {
  assert.throws(() => checkOpShape({ op: 'setWorkflowNote' }));
  assert.throws(() => checkOpShape({ op: 'setWorkflowNote', content: 'x', note: 'y' }));
  assert.throws(() => planWorkflowNoteOps([{ op: 'setWorkflowNote', content: 3 }], { loc: 'L', wid: 'W' }));
  assert.throws(() => planWorkflowNoteOps([{ op: 'setWorkflowNote', content: 'a' }, { op: 'setWorkflowNote', content: 'b' }], { loc: 'L', wid: 'W' }));
});
test('applyOps refuses it by name (it is not a templates edit)', () => {
  assert.throws(() => applyOps([], [{ op: 'setWorkflowNote', content: 'x' }], {}), /WORKFLOW-NOTE/);
});
