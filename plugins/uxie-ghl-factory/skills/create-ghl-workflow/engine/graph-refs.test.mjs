import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { deleteStep } from './edit.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { danglingStepRefs, stepRefsOf, checkStepRefs } from './graph-refs.mjs';

// The class Xander's screenshot exposed (2026-08-21): a workflow whose Go To steps point at
// nothing, under a GHL panel reading "0 Errors — You are all good to go". GHL grades a dangling
// goto target as a WARNING, so its panel is blind to it. These tests pin the three places the
// engine now refuses to create that shape. Corpus ground truth: 0 dangling step-refs across all
// 187 published workflows — so nothing real is rejected by any of this.

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog() });
const wf = (graph) => ({ name: 'G', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph });
const tag = (ref, name) => ({ ref, kind: 'action', type: 'add_contact_tag', name, attributes: { tags: ['x'] } });

// ── fresh path: authored gotos were ALREADY guarded upstream ("goto target not found") ────
// The emit-site resolve-or-throw added alongside this suite is defence-in-depth behind it.
test('a goto targeting a nonexistent ref REFUSES at compile, naming the authored ref', () => {
  assert.throws(() => compile(wf([tag('a', 'A'), { ref: 'g', kind: 'goto', name: 'Loop back', target: 'no_such_ref' }]), ctx()),
    /goto target not found.*no_such_ref|REF_DANGLING.*no_such_ref/s);
});

test('a goto targeting a real ref compiles with its resolved targetNodeId', () => {
  const built = compile(wf([tag('a', 'A'), { ref: 'g', kind: 'goto', name: 'Loop back', target: 'a' }]), ctx());
  const tpls = built.autoSaveBody.workflowData.templates;
  const g = tpls.find((t) => t.type === 'goto');
  assert.equal(g.attributes.targetNodeId, tpls.find((t) => t.type === 'add_contact_tag').id);
});

// ── the chokepoint sweep catches every other path ─────────────────────────────────────────
test('checkStepRefs throws on a wait whose reply list references a missing step', () => {
  const templates = [
    { id: 's1', type: 'sms', name: 'S', attributes: { body: 'b' }, order: 0, next: 's2' },
    { id: 's2', type: 'wait', name: 'W', attributes: { type: 'reply', reply: ['GONE-1234'] }, order: 1, next: null },
  ];
  assert.throws(() => checkStepRefs(templates), /REF_DANGLING.*GONE-1234/s);
  templates[1].attributes.reply = ['s1'];
  checkStepRefs(templates);   // resolves → no throw
});

test('danglingStepRefs is pure and names holder, path, and missing id', () => {
  const bad = danglingStepRefs([{ id: 'g1', type: 'goto', name: 'Go', attributes: { type: 'goto', targetNodeId: 'ghost' } }]);
  assert.deepEqual(bad, [{ id: 'g1', name: 'Go', type: 'goto', path: 'targetNodeId', missing: 'ghost' }]);
  assert.deepEqual(stepRefsOf({ type: 'goto', attributes: { type: 'goto', targetNodeId: '' } }), []);   // empty is not a ref
});

// ── edit path: deleting a referenced step refuses instead of orphaning the reference ──────
test('deleteStep REFUSES to delete a step a goto still points at, naming the holder', () => {
  const templates = [
    { id: 'a1', type: 'add_contact_tag', name: 'Tag it', attributes: { tags: ['x'] }, order: 0, next: 'g1' },
    { id: 'g1', type: 'goto', name: 'Loop back', attributes: { type: 'goto', targetNodeId: 'a1' }, order: 1, next: null, parentKey: 'a1' },
  ];
  assert.throws(() => deleteStep(templates, 'a1'), /referenced by 'Loop back' \(goto\)/);
});

test('deleteStep still deletes an unreferenced step and rewires around it', () => {
  const templates = [
    { id: 'a1', type: 'add_contact_tag', name: 'A', attributes: { tags: ['x'] }, order: 0, next: 'a2' },
    { id: 'a2', type: 'add_contact_tag', name: 'B', attributes: { tags: ['y'] }, order: 1, next: 'a3', parentKey: 'a1' },
    { id: 'a3', type: 'add_contact_tag', name: 'C', attributes: { tags: ['z'] }, order: 2, next: null, parentKey: 'a2' },
  ];
  const { templates: out, diff } = deleteStep(templates, 'a2');
  assert.equal(out.find((t) => t.id === 'a1').next, 'a3');
  assert.deepEqual(diff.deletedSteps, ['a2']);
});

// ── commit backstop: an edit that leaves a dangling ref fails closed, scoped like parentKey ──
test('editCommitBody fails closed when this edit deletes a referenced step; hatch overrides', async () => {
  const { editCommitBody } = await import('./edit.mjs');
  const withGhostRef = () => [
    { id: 's1', type: 'sms', name: 'S', attributes: { body: 'b' }, order: 0, next: 'g1' },
    { id: 'g1', type: 'goto', name: 'Loop back', attributes: { type: 'goto', targetNodeId: 'a9' }, order: 1, next: null, parentKey: 's1' },
  ];
  const fresh = { status: 'draft', version: 1, workflowData: { templates: withGhostRef() } };
  // this edit DELETED a9 (elsewhere) → the goto's ref went dangling → refuse
  assert.throws(
    () => editCommitBody(fresh, withGhostRef(), { createdSteps: [], modifiedSteps: [], deletedSteps: ['a9'] }, 'uid'),
    /dangling step reference.*Loop back.*a9/s,
  );
  // pre-existing residue, untouched by this edit → does not block an unrelated edit
  assert.doesNotThrow(
    () => editCommitBody(fresh, withGhostRef(), { createdSteps: [], modifiedSteps: ['s1'], deletedSteps: [] }, 'uid', { allowDanglingParentKeys: true }),
  );
  // explicit hatch commits anyway
  assert.doesNotThrow(
    () => editCommitBody(fresh, withGhostRef(), { createdSteps: [], modifiedSteps: [], deletedSteps: ['a9'] }, 'uid', { allowDanglingStepRefs: true }),
  );
});

// ── nested goal refs: the paths the first registry cut got WRONG (corpus-verified shape) ──
test('workflow_goal refs are read at segments[].conditions[].extras, and a dangling one refuses', () => {
  const goal = (extras, cond = 'email_event') => ({
    id: 'g1', type: 'workflow_goal', name: 'Goal', order: 1, next: null, parentKey: 's1',
    attributes: { op: 'or', type: 'workflow_goal', action: 'exit',
      segments: [{ op: 'or', conditions: [{ goal_condition: cond, extras, id: 'c1' }] }] },
  });
  const s1 = { id: 's1', type: 'sms', name: 'S', attributes: { body: 'b' }, order: 0, next: 'g1' };
  // email_event goal listing a REAL step resolves; a ghost refuses
  checkStepRefs([s1, goal({ stepIds: ['s1'] })]);
  assert.throws(() => checkStepRefs([s1, goal({ stepIds: ['GHOST'] })]), /REF_DANGLING.*GHOST/s);
  assert.throws(() => checkStepRefs([s1, goal({ invoiceStepId: 'GHOST-INV' }, 'invoice_paid')]), /GHOST-INV/);
  // a tag goal (extras.tags) holds NO step refs — asset ids must never be mistaken for step ids
  assert.deepEqual(stepRefsOf(goal({ tags: ['hb-reactivation'] }, 'remove_contact_tag')), []);
});
// deleteStep coverage via the same registry, without a circular import dance in the test file
test('deleteStep refuses to delete a step a GOAL still references', async () => {
  const { deleteStep } = await import('./edit.mjs');
  const templates = [
    { id: 's1', type: 'sms', name: 'S', attributes: { body: 'b' }, order: 0, next: 's2' },
    { id: 's2', type: 'email', name: 'E', attributes: { subject: 's', html: '<p>x</p>' }, order: 1, next: 'g1', parentKey: 's1' },
    { id: 'g1', type: 'workflow_goal', name: 'Goal', order: 2, next: null, parentKey: 's2',
      attributes: { op: 'or', segments: [{ op: 'or', conditions: [{ goal_condition: 'email_event', extras: { stepIds: ['s2'] }, id: 'c1' }] }] } },
  ];
  assert.throws(() => deleteStep(templates, 's2'), /referenced by 'Goal' \(workflow_goal\)/);
  const { templates: out } = deleteStep(templates, 's1');   // unreferenced → fine
  assert.equal(out.length, 2);
});
