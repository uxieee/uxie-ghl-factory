// A step's `name` is a SIBLING of `attributes`, and modifyStep only ever merged INTO
// attributes — so until renameStep/stepPatch existed, no op in the whole vocabulary could
// rename a step. Found live on the UK account 2026-07-31: an "Update opportunity, Signed
// Won" step whose stage and status had both been re-pointed by modifyStep was left with a
// label that actively lied about what it did, and the engine could not fix its own mess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modifyStep, renameStep, PROTECTED_STEP_FIELDS } from './edit.mjs';
import { applyOp, applyOps, checkOpShape } from './edit-driver.mjs';

const chain = () => [
  { id: 's1', type: 'add_contact_tag', name: 'A', next: 's2', parentKey: null, order: 0, attributes: {} },
  { id: 's2', type: 'internal_update_opportunity', name: 'Update opportunity, Signed Won', next: 's3', parentKey: 's1', order: 1, attributes: { stageId: 'old' } },
  { id: 's3', type: 'add_contact_tag', name: 'C', next: null, parentKey: 's2', order: 2, attributes: {} },
];

test('renameStep sets the top-level name and reports the step as modified', () => {
  const { templates, diff } = renameStep(chain(), 's2', 'Update opportunity, Lost');
  const s2 = templates.find((t) => t.id === 's2');
  assert.equal(s2.name, 'Update opportunity, Lost');
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['s2'], deletedSteps: [] });
});

test('renameStep touches nothing else — attributes and wiring round-trip identically', () => {
  const before = chain();
  const { templates } = renameStep(before, 's2', 'Renamed');
  const s2 = templates.find((t) => t.id === 's2');
  const was = before.find((t) => t.id === 's2');
  assert.deepEqual(s2, { ...was, name: 'Renamed' });
  // every OTHER step is untouched, by identity not just by value
  for (const t of templates) if (t.id !== 's2') assert.equal(t, before.find((b) => b.id === t.id));
});

test('renameStep refuses an empty or non-string name rather than blanking the label', () => {
  for (const bad of ['', '   ', null, undefined, 42, { name: 'x' }])
    assert.throws(() => renameStep(chain(), 's2', bad), /non-empty string/);
});

// D27: renameStep delegates to modifyStep, which used to return emptyDiff() for an unknown
// id — a successful-looking no-op that hid a caller bug. modifyStep now throws, so renameStep
// does too, by inheritance rather than its own guard.
test('renameStep on an unknown id throws instead of returning a clean empty diff', () => {
  assert.throws(() => renameStep(chain(), 'nope', 'X'), /modifyStep: no step with id 'nope'/);
});

test('modifyStep still merges attributes only when no stepPatch is passed (contract intact)', () => {
  const { templates, diff } = modifyStep(chain(), 's2', { stageId: 'new' });
  const s2 = templates.find((t) => t.id === 's2');
  assert.equal(s2.attributes.stageId, 'new');
  assert.equal(s2.name, 'Update opportunity, Signed Won');
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['s2'], deletedSteps: [] });
});

test('modifyStep applies attrPatch and stepPatch in one op — the re-point plus its honest label', () => {
  const { templates } = modifyStep(chain(), 's2', { stageId: 'new' }, { name: 'Update opportunity, Lost' });
  const s2 = templates.find((t) => t.id === 's2');
  assert.equal(s2.attributes.stageId, 'new');
  assert.equal(s2.name, 'Update opportunity, Lost');
});

test('stepPatch refuses every GRAPH field — those have dedicated ops that keep the graph consistent', () => {
  for (const field of PROTECTED_STEP_FIELDS)
    assert.throws(
      () => modifyStep(chain(), 's2', {}, { [field]: 'hijacked' }),
      new RegExp(`refusing to patch graph field\\(s\\) '${field}'`),
      `expected stepPatch to refuse '${field}'`);
  // and the refusal happens BEFORE any mutation
  const before = chain();
  assert.throws(() => modifyStep(before, 's2', { stageId: 'new' }, { next: 's1' }));
  assert.deepEqual(before, chain());
});

test('the graph guard names every offending field at once, not just the first', () => {
  assert.throws(
    () => modifyStep(chain(), 's2', {}, { next: 'x', order: 9, name: 'ok' }),
    /'next', 'order'/);
});

test("renameStep is reachable as an edit op and checkOpShape knows its signature", () => {
  const { templates, diff } = applyOp(chain(), { op: 'renameStep', stepId: 's2', name: 'Renamed' }, {});
  assert.equal(templates.find((t) => t.id === 's2').name, 'Renamed');
  assert.deepEqual(diff.modifiedSteps, ['s2']);
  assert.throws(() => checkOpShape({ op: 'renameStep', stepId: 's2' }), /missing required argument\(s\) \[name\]/);
  // the alias hint: `newName` is the obvious guess for what the key is called
  assert.throws(() => checkOpShape({ op: 'renameStep', stepId: 's2', newName: 'X' }), /you passed 'newName'/);
});

test('the modifyStep op forwards stepPatch, and applyOps reports the rename in modifiedSteps', () => {
  const { templates, diff } = applyOps(chain(), [
    { op: 'modifyStep', stepId: 's2', attrPatch: { stageId: 'new' }, stepPatch: { name: 'Update opportunity, Lost' } },
    { op: 'renameStep', stepId: 's3', name: 'Tag: closed' },
  ], {});
  assert.equal(templates.find((t) => t.id === 's2').name, 'Update opportunity, Lost');
  assert.equal(templates.find((t) => t.id === 's2').attributes.stageId, 'new');
  assert.equal(templates.find((t) => t.id === 's3').name, 'Tag: closed');
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['s2', 's3'], deletedSteps: [] });
});
