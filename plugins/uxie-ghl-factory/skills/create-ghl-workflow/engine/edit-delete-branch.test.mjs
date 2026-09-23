// deleteBranch: remove ONE author-defined branch and everything under it, leave the container and
// its other branches wired exactly as a fresh build with that branch never authored would be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from './edit-driver.mjs';
import { compile } from './compiler.mjs';
import { gateDocument } from './document-gate.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = (seed = 'd') => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen(seed), catalog: loadCatalog() });
const tag = (ref, name) => ({ ref, kind: 'action', type: 'add_contact_tag', name, attributes: { tags: [ref] } });
const built = (graph) => compile({ name: 'x', triggers: [], graph }, ctx())._templates.map((t) => ({ ...t }));
const run = (templates, ops) => applyOps(templates, ops, { ctx: ctx('e'), idGen: makeSeededIdGen('z') });

const ifElse = () => built([tag('h', 'Head'), { ref: 'c', kind: 'if_else', name: 'Segment', branches: [
  { ref: 'b1', name: 'Hot', conditions: [{ conditionType: 'contact_detail', tag: 'hot' }], then: [tag('hot1', 'Hot 1'), tag('hot2', 'Hot 2')] },
  { ref: 'b2', name: 'Warm', conditions: [{ conditionType: 'contact_detail', tag: 'warm' }], then: [tag('warm1', 'Warm 1')] },
  { ref: 'b3', name: 'Otherwise', else: true, then: [tag('cold', 'Cold')] },
] }]);

test('deleteBranch removes an if/else conditioned branch and its whole subtree, and re-syncs the survivors', () => {
  const t0 = ifElse();
  const c = t0.find((t) => t.nodeType === 'condition-node');
  const { templates, diff } = run(t0, [{ op: 'deleteBranch', containerId: c.id, branch: 'Hot' }]);
  const names = templates.map((t) => t.name);
  for (const gone of ['Hot', 'Hot 1', 'Hot 2']) assert.ok(!names.includes(gone), `${gone} removed`);
  assert.equal(diff.deletedSteps.length, 3);
  const c2 = templates.find((t) => t.id === c.id);
  assert.equal(c2.next.length, 2);
  assert.deepEqual(c2.attributes.branches.map((b) => b.name), ['Warm']);
  const [warm, none] = c2.next.map((id) => templates.find((t) => t.id === id));
  assert.equal(warm.name, 'Warm'); assert.equal(warm.order, 0); assert.deepEqual(warm.sibling ?? [none.id], [none.id]);
  assert.equal(none.nodeType, 'branch-no'); assert.equal(none.order, 1); assert.deepEqual(none.sibling, [warm.id]);
  assert.equal(templates.find((t) => t.id === warm.next).name, 'Warm 1', 'the surviving branch keeps its steps');
  assert.equal(gateDocument(templates).errors.length, 0, JSON.stringify(gateDocument(templates).errors));
});

test('deleteBranch refuses the None branch and the last conditioned branch', () => {
  const t0 = ifElse();
  const c = t0.find((t) => t.nodeType === 'condition-node');
  assert.throws(() => run(t0, [{ op: 'deleteBranch', containerId: c.id, branch: 'Otherwise' }]), /None \(else\) branch/);
  const { templates } = run(t0, [{ op: 'deleteBranch', containerId: c.id, branch: 'Hot' }]);
  assert.throws(() => run(templates, [{ op: 'deleteBranch', containerId: c.id, branch: 'Warm' }]), /LAST conditioned branch.*deleteContainer/s);
});

test('deleteBranch refuses a PRE-DEFINED branch, a split path, an unknown branch, and a linear step', () => {
  const fo = built([tag('h', 'Head'), { ref: 'f', type: 'find_opportunity', name: 'FO', find: { filters: [{ field: 'pipeline_id', value: 'P' }] }, onFound: [tag('x', 'X')] }]);
  const f = fo.find((t) => t.type === 'find_opportunity');
  assert.throws(() => run(fo, [{ op: 'deleteBranch', containerId: f.id, branch: 'Opportunity Found' }]), /PRE-DEFINED/);
  assert.throws(() => run(fo, [{ op: 'deleteBranch', containerId: f.id, branch: 'Nope' }]), /no branch 'Nope'/);
  assert.throws(() => run(fo, [{ op: 'deleteBranch', containerId: fo.find((t) => t.name === 'Head').id, branch: 'X' }]), /not a container/);
  const sp = built([{ ref: 's', kind: 'split', name: 'AB', mode: 'weighted', paths: [{ ref: 'pa', name: 'A', weight: 50, then: [] }, { ref: 'pb', name: 'B', weight: 50, then: [] }] }]);
  assert.throws(() => run(sp, [{ op: 'deleteBranch', containerId: sp[0].id, branch: 'A' }]), /re-balancing/);
});

test('deleteBranch removes a user-defined AI decision branch; the Default Branch is refused', () => {
  const t0 = built([{ ref: 'a', type: 'workflow_ai_decision_maker', name: 'Route', instructions: 'x', branches: [
    { name: 'Hot', description: 'h', then: [tag('h1', 'H1')] }, { name: 'Cold', description: 'c', then: [] }] }]);
  const a = t0[0];
  assert.throws(() => run(t0, [{ op: 'deleteBranch', containerId: a.id, branch: 'Default Branch' }]), /PRE-DEFINED/);
  const { templates, diff } = run(t0, [{ op: 'deleteBranch', containerId: a.id, branch: 'Hot' }]);
  const a2 = templates.find((t) => t.id === a.id);
  assert.deepEqual(a2.attributes.transitions.map((x) => x.name), ['Default Branch', 'Cold']);
  assert.deepEqual(a2.next.map((id) => templates.find((t) => t.id === id).name), ['Default Branch', 'Cold']);
  assert.equal(templates.find((t) => t.name === 'Cold').order, 1);
  assert.equal(diff.deletedSteps.length, 2);
  assert.equal(gateDocument(templates).errors.length, 0, JSON.stringify(gateDocument(templates).errors));
});

test('deleteBranch requires both keys, strictly', () => {
  const t0 = ifElse();
  const c = t0.find((t) => t.nodeType === 'condition-node');
  assert.throws(() => run(t0, [{ op: 'deleteBranch', containerId: c.id }]), /branch/);
  assert.throws(() => run(t0, [{ op: 'deleteBranch', containerId: c.id, branch: 'Hot', stepId: 'x' }]), /stepId/);
});
