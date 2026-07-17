// Edit-mode container/multipath splicing (Gap A). The bar these tests hold:
//   1. a container can be ADDED to an existing workflow at all (it could not before);
//   2. the downstream tail lands on the branch the caller NAMED, never a guess;
//   3. the result is structurally identical to the same shape built fresh by compile();
//   4. nothing is duplicated — the historical defect that produced ~60 dup templates and
//      a misleading "Wait for reply doesn't reference the step" publish rejection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, compileSubgraph, compileStep } from './edit-driver.mjs';
import { branchTargets, editCommitBody } from './edit.mjs';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = (seed = 'e') => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen(seed), catalog: loadCatalog() });

const PIPE = 'PIPE1', STAGE = 'STAGE1';

// The IR node for 07c's find_opportunity: find by pipeline, move stage on Found.
// NOTE the deliberate asymmetry — find filters use pipeline_id (snake), the stage move
// uses pipelineId (camel). They are different steps and GHL genuinely differs here.
const findOpp = (onFound = []) => ({
  type: 'find_opportunity', name: 'Find Opportunity',
  find: { filters: [{ field: 'pipeline_id', value: PIPE }], sorting: 'latest' },
  onFound, onNotFound: [],
});
// Authored as stageId — which compiles to the filterField 'pipelineStageId'. Writing the
// emitted name here is the trap the UNKNOWN_ATTR guard now catches.
const updateOpp = () => ({
  type: 'update_opportunity', name: 'Move to Deposit Pending',
  attributes: { pipelineId: PIPE, stageId: STAGE },
});
const tag = (name, t) => ({ type: 'add_contact_tag', name, attributes: { tags: [t] } });

// a fetched-back linear workflow: head -> update_opportunity (already compiled shape,
// as it would come back from GET — the update's fields live in __customInputFields__)
const linearWf = () => [
  { id: 's1', type: 'add_contact_tag', name: 'Head', next: 's2', parentKey: null, order: 0, attributes: { tags: ['a'] } },
  { id: 's2', type: 'internal_update_opportunity', name: 'Move to Deposit Pending', next: null, parentKey: 's1', order: 1,
    workflowsActionType: 'INTERNAL',
    attributes: { allowBackward: false, type: 'internal_update_opportunity', __customInputs__: {},
      __customInputFields__: [
        { __customInputs__: {}, dataType: 'SINGLE_OPTIONS', filterField: 'pipelineId', value: PIPE, valueFieldType: 'select' },
        { __customInputs__: {}, dataType: 'SINGLE_OPTIONS', filterField: 'pipelineStageId', value: STAGE, valueFieldType: 'select' },
      ] } },
];

// Ids are minted per-run and templates[] order is an artifact of push sequence, so a
// structural comparison must be blind to both. Number the ids by a deterministic walk of
// the GRAPH (head → next, containers → branches in next[] order), not by array position.
const normalize = (templates) => {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const num = new Map();
  const visit = (id) => {
    if (id == null || num.has(id) || !byId.has(id)) return;
    num.set(id, num.size);
    const n = byId.get(id);
    for (const nx of (Array.isArray(n.next) ? n.next : [n.next])) visit(nx);
  };
  visit((templates.find((t) => t.parentKey == null && t.parent == null) ?? templates[0]).id);
  for (const t of templates) visit(t.id);           // anything unreachable still gets a number
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    if (typeof v === 'string' && num.has(v)) return `#${num.get(v)}`;
    return v;
  };
  return templates.slice().sort((a, b) => num.get(a.id) - num.get(b.id)).map(walk);
};

test('compileSubgraph: find_opportunity compiles to a container subgraph, not a single step', () => {
  const sub = compileSubgraph(findOpp([updateOpp()]), ctx());
  assert.equal(sub.isContainer, true);
  assert.equal(sub.entry.type, 'find_opportunity');
  assert.ok(Array.isArray(sub.entry.next), 'container entry keeps its branch array');
  assert.equal(sub.entry.next.length, 2);
  assert.equal('order' in sub.entry, false);      // graph position stripped
  assert.equal('parentKey' in sub.entry, false);
  // entry + 2 transitions + the update step under Found
  assert.equal(sub.templates.length, 4);
  // The two steps genuinely differ: find filters by pipeline_id (snake), the stage move
  // by pipelineId (camel) + pipelineStageId. Both must survive a subgraph compile.
  assert.equal(sub.entry.attributes.__customInputFields__[0].filterField, 'pipeline_id');
  const upd = sub.templates.find((t) => t.type === 'internal_update_opportunity');
  assert.deepEqual(upd.attributes.__customInputFields__.map((f) => [f.filterField, f.value]),
    [['pipelineId', PIPE], ['pipelineStageId', STAGE]]);
});

test('update_opportunity: authoring the EMITTED name pipelineStageId is refused, not silently dropped', () => {
  // it saves, round-trips clean, and never moves the stage — the live 2026-07-16 bug
  assert.throws(() => compileStep({ type: 'update_opportunity', name: 'U', attributes: { pipelineId: PIPE, pipelineStageId: STAGE } }, ctx()),
    /unknown attribute key\(s\) \[pipelineStageId\].*did you mean 'stageId'/s);
});

test('compileStep still rejects a container, and still compiles a linear step', () => {
  assert.throws(() => compileStep(findOpp([]), ctx()), /is a container/);
  const s = compileStep(tag('Tag Z', 'z'), ctx());
  assert.equal(s.type, 'add_contact_tag');
  assert.equal('next' in s, false);
});

test('branchTargets exposes find_opportunity Found/Not-Found with their stable branch keys', () => {
  const sub = compileSubgraph(findOpp([]), ctx());
  const targets = branchTargets(sub.entry, sub.templates);
  assert.deepEqual(targets.map((t) => t.name), ['Opportunity Found', 'Opportunity Not Found']);
  assert.deepEqual(targets.map((t) => t.key), ['predefined_Opportunity Found', 'predefined_Opportunity Not Found']);
});

test('insertAfter splices find_opportunity in and re-scopes the tail onto the NAMED branch', () => {
  const { templates, diff } = applyOps(linearWf(), [
    { op: 'insertAfter', afterId: 's1', step: findOpp([]), attachTailTo: 'Opportunity Found' },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });

  const container = templates.find((t) => t.type === 'find_opportunity');
  const [foundId, notFoundId] = container.next;
  const found = templates.find((t) => t.id === foundId);
  const notFound = templates.find((t) => t.id === notFoundId);
  const upd = templates.find((t) => t.id === 's2');

  // head now points at the container, not the update step
  assert.equal(templates.find((t) => t.id === 's1').next, container.id);
  assert.equal(container.parentKey, 's1');
  // the pre-existing update step MOVED into the Found scope — same id, re-parented
  assert.equal(found.next, 's2');
  assert.equal(upd.parent, foundId);
  assert.equal(upd.parentKey, foundId);
  assert.equal(upd.order, 0);
  assert.equal(upd.next, null);
  // Not-Found stays empty
  assert.equal(notFound.next, null);

  // the tail was RE-POINTED, never copied
  assert.equal(templates.filter((t) => t.id === 's2').length, 1);
  const ids = templates.map((t) => t.id);
  assert.equal(ids.length, new Set(ids).size, 'no duplicate template ids');

  // diff: the whole subgraph is created; the anchor and the re-scoped tail are modified
  assert.equal(diff.createdSteps.length, 3);            // container + 2 transitions
  assert.ok(diff.createdSteps.includes(container.id));
  assert.ok(diff.modifiedSteps.includes('s1'));
  assert.ok(diff.modifiedSteps.includes('s2'));
  assert.deepEqual(diff.deletedSteps, []);
});

test('ROUND-TRIP: an edit-inserted find_opportunity is structurally identical to a fresh build', () => {
  // fresh: build.mjs's path — the whole 07c shape compiled in one go
  const fresh = compile({
    name: 'rt', triggers: [],
    graph: [{ ...tag('Head', 'a'), ref: 'h' }, { ...findOpp([{ ...updateOpp(), ref: 'u' }]), ref: 'f' }],
  }, ctx('rt')).autoSaveBody.workflowData.templates;

  // edited: the same shape reached by inserting the container into a linear workflow
  const { templates: edited } = applyOps(linearWf(), [
    { op: 'insertAfter', afterId: 's1', step: findOpp([]), attachTailTo: 'predefined_Opportunity Found' },
  ], { ctx: ctx('ed'), idGen: makeSeededIdGen('z') });

  assert.equal(edited.length, fresh.length);
  assert.deepEqual(normalize(edited), normalize(fresh));
});

test('insertAfter REFUSES to guess the branch when a tail must land on one of several', () => {
  assert.throws(() => applyOps(linearWf(), [
    { op: 'insertAfter', afterId: 's1', step: findOpp([]) },       // no attachTailTo
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') }),
  /has 2 branches.*pass attachTailTo.*Opportunity Found/s);
});

test('insertAfter rejects an unknown branch name and lists the real ones', () => {
  assert.throws(() => applyOps(linearWf(), [
    { op: 'insertAfter', afterId: 's1', step: findOpp([]), attachTailTo: 'Found' },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') }),
  /no branch 'Found'.*'Opportunity Found'/s);
});

test('insertAfter needs no attachTailTo when nothing follows the anchor', () => {
  const { templates } = applyOps(linearWf(), [
    { op: 'insertAfter', afterId: 's2', step: findOpp([]) },       // s2 is the tail
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const container = templates.find((t) => t.type === 'find_opportunity');
  assert.equal(templates.find((t) => t.id === 's2').next, container.id);
  assert.equal(container.parentKey, 's2');
});

test('if_else: inserting the container re-scopes the tail onto a named branch, with a SEPARATE None node', () => {
  const ifElse = {
    kind: 'if_else', type: 'if_else', name: 'Deposit paid?',
    branches: [
      { ref: 'b1', name: 'Paid', conditions: [{ field: 'contact.tags', operator: 'contains', value: 'deposit-paid' }], then: [] },
      { ref: 'b2', name: 'Not paid', else: true, then: [] },
    ],
  };
  const { templates } = applyOps(linearWf(), [
    { op: 'insertAfter', afterId: 's1', step: ifElse, attachTailTo: 'Paid' },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });

  const container = templates.find((t) => t.nodeType === 'condition-node');
  const none = templates.find((t) => t.nodeType === 'branch-no');
  const yes = templates.find((t) => t.nodeType === 'branch-yes');

  // the runtime-correct if_else invariant: branches[] is CONDITIONED only, and the None
  // is a separate node, so next.length === branches.length + 1
  assert.equal(container.next.length, container.attributes.branches.length + 1);
  assert.equal(container.attributes.branches.length, 1);
  assert.equal(container.next[container.next.length - 1], none.id);
  assert.deepEqual(none.attributes, { else: true });
  // branch-yes needs real attrs, not {} (an empty attributes made the node uneditable)
  assert.deepEqual(yes.attributes, { if: false, conditionName: 'Condition', operator: 'and', branches: [] });

  // the tail landed on Paid, not the None
  assert.equal(yes.next, 's2');
  assert.equal(none.next, null);
  assert.equal(templates.find((t) => t.id === 's2').parent, yes.id);

  const ids = templates.map((t) => t.id);
  assert.equal(ids.length, new Set(ids).size, 'no duplicate template ids');
});

test('appendStep splices a container onto the root tail (no tail to re-scope)', () => {
  const { templates, diff } = applyOps(linearWf(), [
    { op: 'appendStep', step: findOpp([updateOpp()]) },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const container = templates.find((t) => t.type === 'find_opportunity');
  assert.equal(templates.find((t) => t.id === 's2').next, container.id);
  assert.equal(container.parentKey, 's2');
  assert.equal(container.parent, undefined, 'root-scope container carries no parent');
  // the authored onFound step came along with the subgraph
  const found = templates.find((t) => t.id === container.next[0]);
  assert.equal(templates.find((t) => t.id === found.next).type, 'internal_update_opportunity');
  assert.equal(diff.createdSteps.length, 4);           // container + 2 transitions + the update
  const ids = templates.map((t) => t.id);
  assert.equal(ids.length, new Set(ids).size);
});

test('appendToBranch splices a container into an existing branch scope, after its steps', () => {
  const base = applyOps(linearWf(), [
    { op: 'insertAfter', afterId: 's1', step: findOpp([]), attachTailTo: 'Opportunity Found' },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const foundId = base.templates.find((t) => t.type === 'find_opportunity').next[0];

  // append a SECOND container inside the Found branch, after the update step already there
  const { templates } = applyOps(base.templates, [
    { op: 'appendToBranch', branchEntryId: foundId, step: { ...findOpp([]), name: 'Find Again' } },
  ], { ctx: ctx('b'), idGen: makeSeededIdGen('y') });

  const inner = templates.find((t) => t.name === 'Find Again');
  assert.equal(templates.find((t) => t.id === 's2').next, inner.id, 'chained after the branch\'s existing tail');
  assert.equal(inner.parent, foundId);
  assert.equal(inner.parentKey, 's2');
  assert.equal(inner.order, 1);
  const ids = templates.map((t) => t.id);
  assert.equal(ids.length, new Set(ids).size);
});

test('a container is terminal in its scope — inserting after one is refused with a usable message', () => {
  const base = applyOps(linearWf(), [
    { op: 'insertAfter', afterId: 's1', step: findOpp([]), attachTailTo: 'Opportunity Found' },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const containerId = base.templates.find((t) => t.type === 'find_opportunity').id;
  assert.throws(() => applyOps(base.templates, [
    { op: 'insertAfter', afterId: containerId, step: tag('X', 'x') },
  ], { ctx: ctx('c'), idGen: makeSeededIdGen('y') }),
  /is a container.*appendToBranch/s);
});

// --- container-clobber regressions -----------------------------------------------
// A container's `next` is its BRANCH ARRAY. Three ops used to overwrite it with a scalar
// id, orphaning every branch and everything under them — silently, since the orphans
// carry no id in deletedSteps and just ride along in templates[] as dead data. Each op
// must refuse instead. (All three were live in v0.3.7.)
const withContainer = () => [
  { id: 'h', type: 'sms', name: 'Head', next: 'c', parentKey: null, order: 0, attributes: {} },
  { id: 'c', type: 'find_opportunity', name: 'Finder', next: ['t1', 't2'], parentKey: 'h', order: 1, attributes: {} },
  { id: 't1', type: 'transition', name: 'Opportunity Found', parent: 'c', parentKey: 'c', next: null, order: 0, attributes: {} },
  { id: 't2', type: 'transition', name: 'Opportunity Not Found', parent: 'c', parentKey: 'c', next: null, order: 1, attributes: {} },
  { id: 'm', type: 'sms', name: 'Mover', next: null, parentKey: null, order: 2, attributes: {} },
];

test('regression: moveStep onto a container refuses instead of orphaning its branches', () => {
  assert.throws(() => applyOps(withContainer(), [{ op: 'moveStep', stepId: 'm', afterId: 'c' }],
    { ctx: ctx(), idGen: makeSeededIdGen('z') }), /is a container.*orphan its branches/s);
});

test('regression: moveStep of a whole container refuses (its children would dangle)', () => {
  assert.throws(() => applyOps(withContainer(), [{ op: 'moveStep', stepId: 'c', afterId: 'm' }],
    { ctx: ctx(), idGen: makeSeededIdGen('z') }), /moving a whole container subgraph is not supported/);
});

test('regression: appendToBranch finds branch content via the next-chain, not the parent field', () => {
  // a nested container whose `parent` the compiler omits (if_else does exactly this) —
  // the old parent-filter missed it, took the "empty branch" path, and overwrote the
  // branch entry's next, orphaning the whole subtree
  const tpls = [
    ...withContainer().filter((t) => t.id !== 'm'),
    { id: 'inner', type: 'if_else', name: 'Nested', nodeType: 'condition-node', next: ['b1', 'b2'], parentKey: 't1', order: 0, attributes: {} },
    { id: 'b1', type: 'if_else', name: 'Yes', nodeType: 'branch-yes', parent: 'inner', parentKey: 'inner', next: null, order: 0, attributes: {} },
    { id: 'b2', type: 'if_else', name: 'None', nodeType: 'branch-no', parent: 'inner', parentKey: 'inner', next: null, order: 1, attributes: {} },
  ].map((t) => (t.id === 't1' ? { ...t, next: 'inner' } : t));

  // the branch already ends in a container → appending must REFUSE, not silently orphan
  assert.throws(() => applyOps(tpls, [
    { op: 'appendToBranch', branchEntryId: 't1', step: tag('X', 'x') },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') }), /already ends in the container 'Nested'/);

  // and the nested container is still wired up — nothing was orphaned
  assert.equal(tpls.find((t) => t.id === 't1').next, 'inner');
});

test('regression: appendToBranch still chains onto a linear branch tail (unchanged behaviour)', () => {
  const tpls = withContainer().map((t) => (t.id === 't1' ? { ...t, next: 'x1' } : t))
    .concat([{ id: 'x1', type: 'sms', name: 'InBranch', parent: 't1', parentKey: 't1', next: null, order: 0, attributes: {} }]);
  const { templates, diff } = applyOps(tpls, [
    { op: 'appendToBranch', branchEntryId: 't1', step: tag('X', 'x') },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const added = templates.find((t) => t.name === 'X');
  assert.equal(templates.find((t) => t.id === 'x1').next, added.id);
  assert.equal(added.parent, 't1');
  assert.equal(added.parentKey, 'x1');
  assert.equal(added.order, 1);
  assert.equal(added.next, null);
  assert.deepEqual(diff.modifiedSteps, ['x1']);
});

test('regression: appendToBranch wires an EMPTY branch off the branch entry', () => {
  const { templates, diff } = applyOps(withContainer(), [
    { op: 'appendToBranch', branchEntryId: 't2', step: tag('X', 'x') },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const added = templates.find((t) => t.name === 'X');
  assert.equal(templates.find((t) => t.id === 't2').next, added.id);
  assert.equal(added.parent, 't2');
  assert.equal(added.parentKey, 't2');
  assert.equal(added.order, 0);
  assert.deepEqual(diff.modifiedSteps, ['t2']);
});

test('regression: insertAfter a container refuses instead of orphaning its branches', () => {
  assert.throws(() => applyOps(withContainer(), [
    { op: 'insertAfter', afterId: 'c', step: tag('X', 'x') },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') }), /is a container.*orphan its branches/s);
});

test('the opportunity invariant accepts an update that the inserted find_opportunity now covers', () => {
  // s2 updates an opportunity with nothing associating one — inserting find_opportunity
  // ABOVE it and landing it on Found is exactly the fix the invariant asks for.
  const { templates, diff } = applyOps(linearWf(), [
    { op: 'insertAfter', afterId: 's1', step: findOpp([]), attachTailTo: 'Opportunity Found' },
  ], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const fresh = { _id: 'w', id: 'w', status: 'draft', version: 1, workflowData: { templates: linearWf() } };
  assert.doesNotThrow(() => editCommitBody(fresh, templates, diff, 'UID'));
});
