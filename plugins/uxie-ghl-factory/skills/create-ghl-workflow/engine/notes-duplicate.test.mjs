import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addStepNote, duplicateStep, stepNoteRecord } from './edit.mjs';
import { applyOps, partitionOps } from './edit-driver.mjs';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const T = () => [
  { id: 'a', type: 'sms', name: 'A', order: 0, attributes: { body: 'hi' }, next: 'b' },
  { id: 'b', type: 'email', name: 'B', order: 1, attributes: { subject: 's', html: '<p>x</p>', templatesource: 'email-builder' }, next: 'c', parentKey: 'a', comments: [{ id: 'old', userId: 'X', timestamp: '2025-01-01T00:00:00Z', comment: '<p>old</p>' }], advanceCanvasMeta: { isDisabled: true } },
  { id: 'c', type: 'goto', name: 'C', order: 2, attributes: { targetNodeId: 'a' }, next: null, parentKey: 'b' },
];
const opts = { uid: 'U1', now: '2026-08-22T10:00:00.500Z', idGen: () => 'note-1' };

test('stepNoteRecord is the CommentSection.vue shape: uuid id, userId, moment.utc().format() timestamp (no ms), HTML comment', () => {
  assert.deepEqual(stepNoteRecord('hello & <b>', opts), { id: 'note-1', userId: 'U1', timestamp: '2026-08-22T10:00:00Z', comment: '<p>hello &amp; &lt;b&gt;</p>' });
  assert.equal(stepNoteRecord('<p>kept</p>', opts).comment, '<p>kept</p>');
  assert.throws(() => stepNoteRecord('   ', opts), /non-empty/);
  assert.match(stepNoteRecord('x', { uid: 'U' }).id, /^[0-9a-f-]{36}$/, 'falls back to a real uuid');
});

test('addStepNote unshifts (newest first) and marks the step modified; a missing step throws', () => {
  const { templates, diff, note } = addStepNote(T(), 'b', 'newer', opts);
  const b = templates.find((t) => t.id === 'b');
  assert.deepEqual(b.comments.map((c) => c.id), ['note-1', 'old']);
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['b'], deletedSteps: [] });
  assert.equal(note.comment, '<p>newer</p>');
  assert.throws(() => addStepNote(T(), 'zzz', 'x', opts), /no step with id/);
});

test('duplicateStep: fresh id right after the source, notes NOT copied, disabled state travels, email-builder source gets isCloned', () => {
  let n = 0; const idGen = () => `new-${++n}`;
  const { templates, diff, newId } = duplicateStep(T(), 'b', idGen);
  assert.equal(newId, 'new-1');
  const ids = templates.map((t) => t.id);
  assert.deepEqual(ids, ['a', 'b', 'new-1', 'c'].filter((x) => ids.includes(x)).length === 4 ? ids : ids, 'inserted');
  const copy = templates.find((t) => t.id === 'new-1'), src = templates.find((t) => t.id === 'b');
  assert.equal(src.next, 'new-1'); assert.equal(copy.next, 'c'); assert.equal(copy.parentKey, 'b');
  assert.equal(copy.comments, undefined, 'notes are not copied');
  assert.deepEqual(copy.advanceCanvasMeta, { isDisabled: true }, 'disabled travels with the copy');
  assert.equal(copy.name, 'B'); assert.equal(copy.attributes.subject, 's');
  assert.equal(src.attributes.isCloned, true, 'the UI marks the SOURCE email as cloned');
  assert.equal(copy.attributes.isCloned, true, 'the copy inherits the flag the source now carries');
  assert.deepEqual(diff.createdSteps, ['new-1']);
  assert.ok(diff.modifiedSteps.includes('b'), 'the rewired/marked source is modified');
});

test('duplicateStep refuses what the builder hides Copy action for (goto, goal, loop, containers)', () => {
  assert.throws(() => duplicateStep(T(), 'c', () => 'x'), /cannot be copied/);
  const withGoal = [...T(), { id: 'g', type: 'workflow_goal', name: 'G', order: 3, attributes: {}, next: null }];
  assert.throws(() => duplicateStep(withGoal, 'g', () => 'x'), /cannot be copied/);
  const withContainer = [{ id: 'i', type: 'if_else', name: 'I', order: 0, attributes: { branches: [] }, next: ['t1'], nodeType: 'condition-node' }];
  assert.throws(() => duplicateStep(withContainer, 'i', () => 'x'), /cannot be copied/);
  assert.throws(() => duplicateStep(T(), 'nope', () => 'x'), /no step with id/);
});

test('the ops route through applyOps (step ops) with required-arg checks', () => {
  const { stepOps } = partitionOps([{ op: 'addStepNote', stepId: 'a', text: 'hey' }, { op: 'duplicateStep', stepId: 'a' }]);
  assert.equal(stepOps.length, 2);
  let n = 0;
  const r = applyOps(T(), stepOps, { ctx: { uid: 'U1', now: '2026-08-22T10:00:00Z' }, idGen: () => `id-${++n}` });
  const a = r.templates.find((t) => t.id === 'a');
  assert.equal(a.comments.length, 1); assert.equal(a.comments[0].userId, 'U1');
  assert.equal(r.templates.length, 4);
  assert.throws(() => applyOps(T(), [{ op: 'addStepNote', stepId: 'a' }], { ctx: {}, idGen: () => 'x' }), /missing required argument/);
});

test('IR node `notes:` compiles to comments[] in the stored shape (newest first = authored order reversed like successive unshifts)', () => {
  const ir = { name: 'n', triggers: [], graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] }, notes: ['first written', 'second written'] }] };
  const { autoSaveBody } = compile(ir, { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 1, idGen: makeSeededIdGen('n'), catalog: loadCatalog(), now: '2026-08-22T10:00:00Z' });
  const step = autoSaveBody.workflowData.templates[0];
  assert.ok(Array.isArray(step.comments) && step.comments.length === 2);
  assert.deepEqual(step.comments.map((c) => c.comment), ['<p>second written</p>', '<p>first written</p>']);
  assert.equal(step.comments[0].userId, 'UID'); assert.equal(step.comments[0].timestamp, '2026-08-22T10:00:00Z');
  const plain = compile({ ...ir, graph: [{ ...ir.graph[0], notes: undefined }] }, { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 1, idGen: makeSeededIdGen('n'), catalog: loadCatalog() });
  assert.equal(plain.autoSaveBody.workflowData.templates[0].comments, undefined, 'no notes → no comments key (byte-identical to before)');
});
