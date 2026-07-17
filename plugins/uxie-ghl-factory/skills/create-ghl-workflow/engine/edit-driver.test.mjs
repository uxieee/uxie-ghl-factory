import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, compileStep, normalizeDiff, mergeDiff } from './edit-driver.mjs';
import { editCommitBody } from './edit.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('e'), catalog: loadCatalog() });

// a fetched-back workflow's templates[] (linear s1->s2->s3)
const chain = () => [
  { id: 's1', type: 'add_contact_tag', name: 'A', next: 's2', parentKey: null, order: 0, attributes: { tags: ['a'] } },
  { id: 's2', type: 'sms', name: 'B', next: 's3', parentKey: 's1', order: 1, attributes: { body: 'hi' } },
  { id: 's3', type: 'add_contact_tag', name: 'C', next: null, parentKey: 's2', order: 2, attributes: { tags: ['c'] } },
];

test('compileStep: a linear action compiles to a single catalog-shaped template', () => {
  const s = compileStep({ type: 'add_contact_tag', name: 'Tag Z', attributes: { tags: ['z'] } }, ctx());
  assert.equal(s.type, 'add_contact_tag');
  assert.equal(s.name, 'Tag Z');
  assert.deepEqual(s.attributes.tags, ['z']);
  assert.ok(s.id);                 // real id minted
  assert.equal('order' in s, false); // graph position stripped — the op sets it
  assert.equal('next' in s, false);
});

// Containers are no longer rejected outright (see edit-multipath.test.mjs) — they route
// to compileSubgraph + a subgraph splice. compileStep is the LINEAR-only entry point, so
// handing it a container is a caller routing bug and still throws.
test('compileStep: a container type is redirected to the subgraph path, not silently mis-spliced', () => {
  assert.throws(() => compileStep({ type: 'conversationai_ai_splitter', name: 'X', attributes: { description: 'y' }, branches: [{ name: 'a', then: [] }] }, ctx()),
    /is a container/);
});

test('applyOps: appendStep wires onto the tail and emits the right diff', () => {
  const { templates, diff } = applyOps(chain(), [
    { op: 'appendStep', step: { type: 'add_contact_tag', name: 'D', attributes: { tags: ['d'] } } },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const added = templates.find((t) => t.name === 'D');
  assert.equal(templates.find((t) => t.id === 's3').next, added.id);
  assert.equal(added.next, null);
  assert.equal(added.parentKey, 's3');
  assert.deepEqual(diff.createdSteps, [added.id]);
  assert.deepEqual(diff.modifiedSteps, ['s3']);
  assert.deepEqual(diff.deletedSteps, []);
});

test('applyOps: multi-op sequence merges diffs (insert + delete + modify)', () => {
  const { templates, diff } = applyOps(chain(), [
    { op: 'insertAfter', afterId: 's1', step: { type: 'sms', name: 'Mid', attributes: { body: 'm' } } },
    { op: 'modifyStep', stepId: 's2', attrPatch: { body: 'changed' } },
    { op: 'deleteStep', stepId: 's3' },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const mid = templates.find((t) => t.name === 'Mid');
  assert.equal(templates.find((t) => t.id === 's1').next, mid.id);
  assert.equal(mid.next, 's2');
  assert.equal(templates.find((t) => t.id === 's2').attributes.body, 'changed');
  assert.equal(templates.find((t) => t.id === 's3'), undefined);
  assert.deepEqual(diff.createdSteps, [mid.id]);
  assert.ok(diff.modifiedSteps.includes('s2'));
  assert.deepEqual(diff.deletedSteps, ['s3']);
});

test('normalizeDiff: created-then-deleted nets out; deleted wins over modified', () => {
  const d = normalizeDiff(mergeDiff(
    { createdSteps: ['x'], modifiedSteps: ['y'], deletedSteps: [] },
    { createdSteps: [], modifiedSteps: ['x'], deletedSteps: ['x', 'y'] }));
  assert.deepEqual(d.createdSteps, []);       // x created then deleted → gone
  assert.deepEqual(d.deletedSteps, ['y']);    // y deleted wins over modified
  assert.deepEqual(d.modifiedSteps, []);
});

test('editCommitBody consumes the driver output into a plain-PUT body', () => {
  const { templates, diff } = applyOps(chain(), [
    { op: 'appendStep', step: { type: 'add_contact_tag', name: 'D', attributes: { tags: ['d'] } } },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const fresh = { _id: 'w', id: 'w', status: 'draft', version: 4, workflowData: { templates: chain() }, filePath: 'x' };
  const body = editCommitBody(fresh, templates, diff, 'UID');
  assert.equal(body.version, 4);              // server envelope preserved
  assert.equal(body.filePath, 'x');
  assert.equal(body.triggersChanged, false);
  assert.equal(body.workflowData.templates.length, 4);
  assert.deepEqual(body.createdSteps, diff.createdSteps);
  assert.deepEqual(body.modifiedSteps, diff.modifiedSteps);
});

test('disableStepsByType op round-trips through the published commit body without changing anything else', () => {
  const original = chain().map((t) => t.type === 'sms' ? {
    ...t,
    attributes: { ...t.attributes, selectedUser: ['u1'], userType: 'user' },
    advanceCanvasMeta: { position: { x: 120, y: 240 } },
  } : t);
  let edited;
  assert.doesNotThrow(() => {
    edited = applyOps(original, [
      { op: 'disableStepsByType', type: 'sms', disabled: true },
    ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  });
  const fresh = {
    _id: 'w', id: 'w', name: 'Published workflow', status: 'published', version: 9,
    filePath: 'keep.json', permission: 380, workflowData: { templates: original },
  };
  const body = editCommitBody(fresh, edited.templates, edited.diff, 'UID');
  const changed = body.workflowData.templates.find((t) => t.id === 's2');

  assert.equal(body.status, 'published');
  assert.equal(body.version, 9);
  assert.equal(body.filePath, 'keep.json');
  assert.equal(body.permission, 380);
  assert.equal(body.updatedBy, 'UID');
  assert.equal(body.triggersChanged, false);
  assert.deepEqual(body.createdSteps, []);
  assert.deepEqual(body.modifiedSteps, ['s2']);
  assert.deepEqual(body.deletedSteps, []);
  assert.deepEqual(changed.attributes, original.find((t) => t.id === 's2').attributes);
  assert.deepEqual(changed.advanceCanvasMeta, {
    position: { x: 120, y: 240 },
    isDisabled: true,
  });
  assert.deepEqual(body.workflowData.templates.filter((t) => t.id !== 's2'),
    original.filter((t) => t.id !== 's2'));
});
