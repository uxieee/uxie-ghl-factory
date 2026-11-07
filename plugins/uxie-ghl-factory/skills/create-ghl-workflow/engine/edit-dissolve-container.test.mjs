// bl-387: removing an If/Else "gate" so its go-on lane becomes top level had no op — moveStep refuses to lift steps out of
// a container and deleteContainer deletes the lane too. dissolveContainer {containerId, keep} keeps ONE lane in the
// container's place and deletes the container, its other branches and their steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from './edit-driver.mjs';
import { editCommitBody } from './edit.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'L', uid: 'U', companyAge: 0, idGen: makeSeededIdGen('x'), catalog: loadCatalog(), warn: () => {} });
const doc = () => [
  { id: 'H', type: 'add_contact_tag', name: 'Head', order: 0, parentKey: null, next: 'IF', attributes: { tags: ['h'] } },
  { id: 'IF', type: 'if_else', name: 'Test gate', nodeType: 'condition-node', cat: 'conditions', parentKey: 'H', next: ['BY', 'BN'], attributes: { branches: [{ id: 'BY', name: 'Go on', segments: [] }] } },
  { id: 'BY', type: 'if_else', name: 'Go on', nodeType: 'branch-yes', cat: 'conditions', parent: 'IF', parentKey: 'IF', sibling: ['BN'], next: 'G1', attributes: {} },
  { id: 'BN', type: 'if_else', name: 'None', nodeType: 'branch-no', cat: 'conditions', parent: 'IF', parentKey: 'IF', sibling: ['BY'], next: 'X1', attributes: { else: true } },
  { id: 'G1', type: 'add_contact_tag', name: 'Go 1', parent: 'BY', parentKey: 'BY', next: 'G2', attributes: { tags: ['g1'] } },
  { id: 'G2', type: 'add_contact_tag', name: 'Go 2', parent: 'BY', parentKey: 'G1', next: null, attributes: { tags: ['g2'] } },
  { id: 'X1', type: 'add_contact_tag', name: 'Stop', parent: 'BN', parentKey: 'BN', next: null, attributes: { tags: ['x'] } },
];
const run = (tpls, op) => { const c = ctx(); return applyOps(tpls, [op], { ctx: c, idGen: c.idGen }); };

test('the kept lane takes the container\'s place; the container, both branch nodes and the other lane are deleted', () => {
  const r = run(doc(), { op: 'dissolveContainer', containerId: 'IF', keep: 'Go on' });
  const by = new Map(r.templates.map((t) => [t.id, t]));
  assert.deepEqual([...by.keys()].sort(), ['G1', 'G2', 'H']);
  assert.equal(by.get('H').next, 'G1');
  assert.equal(by.get('G1').parentKey, 'H');
  assert.equal('parent' in by.get('G1'), false);
  assert.equal('parent' in by.get('G2'), false);
  assert.equal(by.get('G2').parentKey, 'G1');
  assert.deepEqual(r.diff.deletedSteps.sort(), ['BN', 'BY', 'IF', 'X1']);
  assert.doesNotThrow(() => editCommitBody({ _id: 'W', name: 'W', status: 'draft', workflowData: { templates: doc() } }, r.templates, r.diff, 'U', {}));
});

test('a container that is the entry hands index 0 to the kept lane\'s first step', () => {
  const tpls = doc().slice(1).map((t) => (t.id === 'IF' ? { ...t, parentKey: null } : t));
  const r = run(tpls, { op: 'dissolveContainer', containerId: 'IF', keep: 'BY' });
  assert.equal(r.templates[0].id, 'G1');
  assert.equal(r.templates[0].parentKey, null);
});

test('refused: a step that is not a container, an unknown branch, and a removed step something still points at', () => {
  assert.throws(() => run(doc(), { op: 'dissolveContainer', containerId: 'H', keep: 'x' }), /not a container/);
  assert.throws(() => run(doc(), { op: 'dissolveContainer', containerId: 'IF', keep: 'Nope' }), /no branch 'Nope'/);
  const withGoto = [...doc(), { id: 'GT', type: 'goto', name: 'Jump', parent: 'BY', parentKey: 'G2', next: null, attributes: { targetNodeId: 'X1' } }]
    .map((t) => (t.id === 'G2' ? { ...t, next: 'GT' } : t));
  assert.throws(() => run(withGoto, { op: 'dissolveContainer', containerId: 'IF', keep: 'Go on' }), /still referenced/);
});
