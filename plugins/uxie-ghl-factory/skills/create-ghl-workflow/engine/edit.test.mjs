import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as edit from './edit.mjs';

const { appendStep, deleteStep, insertAfter, modifyStep, appendToBranch, moveStep, addBranch, deleteContainer,
  danglingParentKeys, repairParentKeys, editCommitBody } = edit;

let _n = 0;
const seqId = () => `gen${++_n}`;

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

test('deleteStep removes and rewires the predecessor (and re-points the orphan parentKey)', () => {
  const { templates, diff } = deleteStep(chain(), 's2');
  assert.equal(templates.find((t) => t.id === 's2'), undefined);
  assert.equal(templates.find((t) => t.id === 's1').next, 's3');   // s1 now skips to s3
  assert.equal(templates.find((t) => t.id === 's3').parentKey, 's1'); // orphan re-pointed at pred, not left dangling on s2
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['s1', 's3'], deletedSteps: ['s2'] });
  assert.equal(danglingParentKeys(templates).length, 0);
});

test('deleteStep of the head re-points the new head parentKey to null', () => {
  const { templates } = deleteStep(chain(), 's1');   // s1 is head (parentKey null); s2 becomes head
  assert.equal(templates.find((t) => t.id === 's2').parentKey, null);
  assert.equal(danglingParentKeys(templates).length, 0);
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
  assert.equal(templates.find((t) => t.id === 's2').parentKey, 'sMid'); // displaced successor re-points at the new step
  assert.deepEqual(diff, { createdSteps: ['sMid'], modifiedSteps: ['s1', 's2'], deletedSteps: [] });
});

test('modifyStep patches attributes in place', () => {
  const base = chain().map((t) => (t.id === 's2' ? { ...t, attributes: { body: 'old' } } : t));
  const { templates, diff } = modifyStep(base, 's2', { body: 'new', mediaUrl: 'x' });
  const s2 = templates.find((t) => t.id === 's2');
  assert.equal(s2.attributes.body, 'new');
  assert.equal(s2.attributes.mediaUrl, 'x');
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['s2'], deletedSteps: [] });
});

test('setStepDisabled preserves config and position, flips both directions, and is idempotent', () => {
  assert.equal(typeof edit.setStepDisabled, 'function');
  const base = chain().map((t) => t.id === 's2' ? {
    ...t,
    attributes: { body: 'keep me', selectedUser: ['u1'] },
    advanceCanvasMeta: { position: { x: 12, y: 34 } },
  } : t);

  const disabled = edit.setStepDisabled(base, 's2', true);
  assert.deepEqual(disabled.diff, { createdSteps: [], modifiedSteps: ['s2'], deletedSteps: [] });
  assert.deepEqual(disabled.templates.find((t) => t.id === 's2'), {
    ...base.find((t) => t.id === 's2'),
    advanceCanvasMeta: { position: { x: 12, y: 34 }, isDisabled: true },
  });

  const alreadyDisabled = edit.setStepDisabled(disabled.templates, 's2', true);
  assert.strictEqual(alreadyDisabled.templates, disabled.templates);
  assert.deepEqual(alreadyDisabled.diff.modifiedSteps, []);

  const enabled = edit.setStepDisabled(disabled.templates, 's2', false);
  assert.equal(enabled.templates.find((t) => t.id === 's2').advanceCanvasMeta.isDisabled, false);
  assert.deepEqual(enabled.diff.modifiedSteps, ['s2']);

  const alreadyEnabled = edit.setStepDisabled(enabled.templates, 's2', false);
  assert.strictEqual(alreadyEnabled.templates, enabled.templates);
  assert.deepEqual(alreadyEnabled.diff.modifiedSteps, []);
});

test('disableStepsByType changes only matching steps that need a state flip', () => {
  assert.equal(typeof edit.disableStepsByType, 'function');
  const base = chain().map((t) => t.id === 's3'
    ? { ...t, advanceCanvasMeta: { position: { x: 3, y: 4 }, isDisabled: true } }
    : t);
  const { templates, diff } = edit.disableStepsByType(base, 'add_contact_tag', true);
  assert.deepEqual(diff.modifiedSteps, ['s1']);
  assert.equal(templates.find((t) => t.id === 's1').advanceCanvasMeta.isDisabled, true);
  assert.deepEqual(templates.find((t) => t.id === 's3').advanceCanvasMeta,
    { position: { x: 3, y: 4 }, isDisabled: true });
  assert.equal(templates.find((t) => t.id === 's2').advanceCanvasMeta, undefined);
});

// a branched graph: container B with a Yes branch-entry (has 1 child) and an empty No branch-entry
const branched = () => [
  { id: 'root1', type: 'add_contact_tag', name: 'Start', next: 'cont', parentKey: null, order: 0, attributes: {} },
  { id: 'cont', type: 'if_else', name: 'Check', nodeType: 'condition-node', next: ['yes', 'no'], parentKey: 'root1', order: 1,
    attributes: { branches: [{ id: 'yes', name: 'Yes', operator: 'and', segments: [] }, { id: 'no', name: 'No', operator: 'and', segments: [] }], conditionName: 'Check', if: true, operator: 'and', noneBranchName: 'No' } },
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

test('deleteStep works inside a branch (deletes the branch first child → empties it)', () => {
  const { templates } = deleteStep(branched(), 'y1');
  assert.equal(templates.find((t) => t.id === 'y1'), undefined);
  assert.equal(templates.find((t) => t.id === 'yes').next, null);   // yes branch is now empty
});

test('moveStep reorders within the root trunk', () => {
  // chain s1->s2->s3; move s3 to after s1 → s1->s3->s2
  const { templates, diff } = moveStep(chain(), 's3', 's1');
  const s1 = templates.find((t) => t.id === 's1'), s3 = templates.find((t) => t.id === 's3'), s2 = templates.find((t) => t.id === 's2');
  assert.equal(s1.next, 's3');
  assert.equal(s3.next, 's2');
  assert.equal(s2.next, null);            // s2 is now the tail (its old next s3 moved away)
  assert.equal(diff.createdSteps.length, 0);
  assert.equal(diff.deletedSteps.length, 0);
  assert.ok(diff.modifiedSteps.includes('s3'));
});

test('deleteContainer removes the if_else and all descendants, rewiring the predecessor', () => {
  const { templates, diff } = deleteContainer(branched(), 'cont');
  // container + both branch-entries + the Yes child (y1) all gone
  for (const id of ['cont', 'yes', 'no', 'y1']) assert.equal(templates.find((t) => t.id === id), undefined, `${id} should be removed`);
  assert.equal(templates.find((t) => t.id === 'root1').next, null);   // predecessor rewired
  assert.deepEqual(diff.deletedSteps.sort(), ['cont', 'no', 'y1', 'yes']);
  assert.deepEqual(diff.modifiedSteps, ['root1']);
});

test('moveStep does a cross-scope move (branch step → root trunk)', () => {
  // move y1 (inside the Yes branch) to after root1 (root trunk)
  const { templates } = moveStep(branched(), 'y1', 'root1');
  const y1 = templates.find((t) => t.id === 'y1');
  assert.equal(y1.parent, undefined);          // no longer in a branch scope
  assert.equal(y1.parentKey, 'root1');
  assert.equal(templates.find((t) => t.id === 'root1').next, 'y1');   // now in the trunk
  assert.equal(templates.find((t) => t.id === 'yes').next, null);     // Yes branch now empty
});

test('addBranch inserts a new conditional branch before the else', () => {
  _n = 0;
  const { templates, diff } = addBranch(branched(), 'cont', { name: 'Maybe', conditions: [{ conditionType: 'contact_detail' }] }, seqId);
  const cont = templates.find((t) => t.id === 'cont');
  // next was [yes, no] → now [yes, gen1, no] (new branch before the else)
  assert.deepEqual(cont.next, ['yes', 'gen1', 'no']);
  assert.equal(cont.attributes.branches[1].id, 'gen1');
  assert.equal(cont.attributes.branches[1].name, 'Maybe');
  assert.equal(cont.attributes.branches[1].segments.length, 1);
  const newEntry = templates.find((t) => t.id === 'gen1');
  assert.equal(newEntry.nodeType, 'branch-yes');
  assert.equal(newEntry.parent, 'cont');
  assert.deepEqual(newEntry.sibling.sort(), ['no', 'yes']);
  // existing branch-entries got the new sibling
  assert.ok(templates.find((t) => t.id === 'yes').sibling.includes('gen1'));
  assert.deepEqual(diff.createdSteps, ['gen1']);
});

// addBranch must emit the SAME runtime-correct branch shape as the compiler: a non-empty
// branch-yes `attributes`, a segment with a generated __segmentId, and fully-enriched
// conditions (not the bare authored tuple). An empty attributes / bare condition made the
// edited step uneditable in the builder and mis-shaped at runtime.
test('addBranch emits enriched conditions + non-empty branch-yes attributes', () => {
  _n = 0;
  const { templates } = addBranch(branched(), 'cont',
    { name: 'Maybe', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'fld', conditionOperator: 'contain', conditionValue: 'x' }] }, seqId);
  const cont = templates.find((t) => t.id === 'cont');
  const seg = cont.attributes.branches[1].segments[0];
  assert.equal(typeof seg.__segmentId, 'string');
  assert.ok(seg.__segmentId.length > 0);
  const cond = seg.conditions[0];
  assert.equal(typeof cond.__conditionId, 'string');
  assert.ok(cond.__conditionId.length > 0);
  assert.equal(cond.ifElseNodeId, '');
  assert.equal(cond.isWait, false);
  assert.equal(cond.__customFieldType__, 'standard');
  assert.ok(Array.isArray(cond.nestedDropdownTypes) && cond.nestedDropdownTypes.length > 0);
  assert.ok(Array.isArray(cond.allowIsOperatorTypes) && cond.allowIsOperatorTypes.length > 0);
  const newEntry = templates.find((t) => t.id === 'gen1');
  assert.deepEqual(newEntry.attributes, { if: false, conditionName: 'Condition', operator: 'and', branches: [] });
  assert.equal(newEntry.cat, 'conditions');
});

// --- dangling parentKey (finding 2026-07-17f #4/#12) ---------------------------------

// A chain with a hand-injected dangling parentKey: s3 points at 'ghost' (not in the graph).
const withDangling = () => [
  { id: 's1', type: 'add_contact_tag', name: 'A', next: 's2', parentKey: null, order: 0, attributes: {} },
  { id: 's2', type: 'sms', name: 'B', next: 's3', parentKey: 's1', order: 1, attributes: {} },
  { id: 's3', type: 'add_contact_tag', name: 'C', next: null, parentKey: 'ghost', order: 2, attributes: {} },
];

test('danglingParentKeys detects a parentKey pointing at a missing step', () => {
  const bad = danglingParentKeys(withDangling());
  assert.equal(bad.length, 1);
  assert.deepEqual(bad[0], { id: 's3', name: 'C', parentKey: 'ghost' });
  assert.equal(danglingParentKeys(chain()).length, 0); // a clean chain has none
});

test('repairParentKeys re-points a dangling parentKey at its true inbound source', () => {
  const { templates, diff } = repairParentKeys(withDangling());
  assert.equal(templates.find((t) => t.id === 's3').parentKey, 's2'); // s2.next === s3
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['s3'], deletedSteps: [] });
  assert.equal(danglingParentKeys(templates).length, 0);
});

test('repairParentKeys nulls an orphan with no inbound edge and flags ambiguous ones', () => {
  // orphan with zero inbound → head → null
  const zero = [{ id: 'x', type: 'sms', name: 'X', next: null, parentKey: 'ghost', order: 0, attributes: {} }];
  const r0 = repairParentKeys(zero);
  assert.equal(r0.templates[0].parentKey, null);
  // orphan with two inbound edges → ambiguous, left untouched
  const two = [
    { id: 'a', type: 'sms', name: 'A', next: 'z', parentKey: null, order: 0, attributes: {} },
    { id: 'b', type: 'sms', name: 'B', next: 'z', parentKey: null, order: 1, attributes: {} },
    { id: 'z', type: 'sms', name: 'Z', next: null, parentKey: 'ghost', order: 2, attributes: {} },
  ];
  const r2 = repairParentKeys(two);
  assert.equal(r2.templates.find((t) => t.id === 'z').parentKey, 'ghost'); // untouched
  assert.equal(r2.ambiguous.length, 1);
  assert.equal(r2.ambiguous[0].id, 'z');
});

test('editCommitBody fails closed on a dangling parentKey among touched steps', () => {
  const fresh = { status: 'draft', version: 1, workflowData: { templates: withDangling() } };
  // s3 is dangling and is claimed as modified → must throw
  assert.throws(
    () => editCommitBody(fresh, withDangling(), { createdSteps: [], modifiedSteps: ['s3'], deletedSteps: [] }, 'uid'),
    (err) => err.code === 'DANGLING_PARENTKEY',
  );
  // pre-existing residue on an UNtouched step does not block an unrelated edit
  assert.doesNotThrow(
    () => editCommitBody(fresh, withDangling(), { createdSteps: [], modifiedSteps: ['s1'], deletedSteps: [] }, 'uid'),
  );
  // explicit override commits anyway
  assert.doesNotThrow(
    () => editCommitBody(fresh, withDangling(), { createdSteps: [], modifiedSteps: ['s3'], deletedSteps: [] }, 'uid', { allowDanglingParentKeys: true }),
  );
});

test('a repairParentKeys op commits cleanly through editCommitBody', async () => {
  const { applyOps } = await import('./edit-driver.mjs');
  const { templates, diff } = applyOps(withDangling(), [{ op: 'repairParentKeys' }], { ctx: {}, idGen: () => 'x' });
  assert.equal(danglingParentKeys(templates).length, 0);
  const fresh = { status: 'draft', version: 1, workflowData: { templates } };
  assert.doesNotThrow(() => editCommitBody(fresh, templates, diff, 'uid'));
});
