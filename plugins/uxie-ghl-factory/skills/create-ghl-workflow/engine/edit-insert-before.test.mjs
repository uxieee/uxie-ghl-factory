// Edit-mode insertBefore / root prepend (Gap: no op could make a step — least of all a
// CONTAINER — step 1 of an existing workflow; every insert required an anchor it could
// sit after). The bar these tests hold:
//   1. a plain step and a CONTAINER can both become the new head of an existing workflow;
//   2. mid-chain insertBefore is exactly insertAfter(predecessor) — one code path, not two;
//   3. when a container becomes the head, the ENTIRE existing chain is re-scoped onto the
//      branch the caller NAMED, never a guess (the whole workflow is the tail here, so a
//      wrong guess reroutes 100% of live traffic — the worst case of the insertAfter trap);
//   4. nothing is duplicated and no branch is orphaned (the v0.3.7 data-loss class);
//   5. inserting before a branch ENTRY is refused — that position is structural.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, compileSubgraph } from './edit-driver.mjs';
import { insertBefore, insertSubgraphBefore, prependStep, branchTargets, editCommitBody } from './edit.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = (seed = 'p') => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen(seed), catalog: loadCatalog() });

// a fetched-back linear workflow, as it would come back from GET
const linearWf = () => [
  { id: 's1', type: 'add_contact_tag', name: 'Head', next: 's2', parentKey: null, order: 0, attributes: { tags: ['a'] } },
  { id: 's2', type: 'add_contact_tag', name: 'Second', next: 's3', parentKey: 's1', order: 1, attributes: { tags: ['b'] } },
  { id: 's3', type: 'add_contact_tag', name: 'Tail', next: null, parentKey: 's2', order: 2, attributes: { tags: ['c'] } },
];

const tag = (name, t) => ({ type: 'add_contact_tag', name, attributes: { tags: [t] } });
const ifElse = () => ({
  kind: 'if_else', type: 'if_else', name: 'Gate',
  branches: [
    { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail', tag: 't' }], then: [] },
    { ref: 'n', name: 'None', else: true, then: [] },
  ],
});

const byId = (tpls) => new Map(tpls.map((t) => [t.id, t]));
const idsOf = (tpls) => tpls.map((t) => t.id);
const noDupes = (tpls) => assert.equal(new Set(idsOf(tpls)).size, tpls.length, 'duplicate template ids');

// The single root head: parentKey null AND no parent. Exactly one must exist.
const rootHeads = (tpls) => tpls.filter((t) => (t.parentKey === null || t.parentKey === undefined) && t.parent == null);

test('prependStep makes a plain step the new head and re-parents the old head', () => {
  const wf = linearWf();
  const step = { id: 'nEW', type: 'add_contact_tag', name: 'New First', attributes: { tags: ['z'] } };
  const { templates, diff } = prependStep(wf, step);
  noDupes(templates);
  const m = byId(templates);

  assert.equal(rootHeads(templates).length, 1, 'exactly one root head');
  assert.equal(rootHeads(templates)[0].id, 'nEW');
  assert.equal(m.get('nEW').next, 's1', 'new head chains into the old head');
  assert.equal(m.get('nEW').parentKey, null);
  assert.equal(m.get('s1').parentKey, 'nEW', 'old head re-parents onto the new one');
  assert.equal(m.get('s3').next, null, 'tail untouched');

  // the whole root chain is renumbered so the builder renders the real order
  assert.deepEqual(['nEW', 's1', 's2', 's3'].map((id) => m.get(id).order), [0, 1, 2, 3]);

  assert.deepEqual(diff.createdSteps, ['nEW']);
  assert.ok(diff.modifiedSteps.includes('s1'), 'old head must be re-persisted');
  assert.deepEqual(diff.deletedSteps, []);
});

test('insertBefore mid-chain is exactly insertAfter(predecessor)', () => {
  const step = { id: 'nEW', type: 'add_contact_tag', name: 'Mid', attributes: { tags: ['z'] } };
  const viaBefore = insertBefore(linearWf(), step, 's3');
  const m = byId(viaBefore.templates);
  assert.equal(m.get('s2').next, 'nEW');
  assert.equal(m.get('nEW').next, 's3');
  assert.equal(m.get('s3').parentKey, 'nEW');
  assert.equal(rootHeads(viaBefore.templates)[0].id, 's1', 'head unchanged for a mid-chain insert');
});

test('insertBefore refuses a branch ENTRY — that position is structural', () => {
  const wf = [
    { id: 'c1', type: 'if_else', name: 'Gate', next: ['b1', 'b2'], parentKey: null, order: 0, nodeType: 'condition-node' },
    { id: 'b1', type: 'if_else', name: 'Yes', next: null, parent: 'c1', parentKey: 'c1', order: 0, nodeType: 'branch-yes' },
    { id: 'b2', type: 'if_else', name: 'None', next: null, parent: 'c1', parentKey: 'c1', order: 1, nodeType: 'branch-no' },
  ];
  const step = { id: 'nEW', type: 'add_contact_tag', name: 'X', attributes: { tags: ['z'] } };
  assert.throws(() => insertBefore(wf, step, 'b1'), /branch entry|appendToBranch/i);
});

test('insertBefore on a missing id is a no-op', () => {
  const wf = linearWf();
  const { templates, diff } = insertBefore(wf, { id: 'nEW', type: 'add_contact_tag' }, 'nope');
  assert.deepEqual(templates, wf);
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: [], deletedSteps: [] });
});

test('a CONTAINER can become the head — the whole workflow re-scopes onto the named branch', () => {
  const wf = linearWf();
  const sub = compileSubgraph(ifElse(), ctx());
  assert.ok(sub.isContainer);
  const { templates, diff } = insertSubgraphBefore(wf, sub, 's1', 'Yes');
  noDupes(templates);
  const m = byId(templates);

  // the container is now the one and only root head
  const heads = rootHeads(templates);
  assert.equal(heads.length, 1, 'exactly one root head');
  assert.equal(heads[0].id, sub.entry.id);
  assert.equal(heads[0].order, 0);

  // the ENTIRE pre-existing chain hangs off the named branch, in its original order
  const yes = branchTargets(m.get(sub.entry.id), templates).find((b) => b.name === 'Yes');
  assert.equal(m.get(yes.id).next, 's1', 'old head chains off the Yes branch entry');
  assert.equal(m.get('s1').parentKey, yes.id);
  assert.equal(m.get('s1').parent, yes.id, 's1 moved into the branch scope');
  assert.equal(m.get('s2').parent, yes.id);
  assert.equal(m.get('s3').parent, yes.id);
  assert.equal(m.get('s1').next, 's2', 'chain order preserved');
  assert.equal(m.get('s2').next, 's3');
  assert.equal(m.get('s3').next, null);

  // no branch orphaned: every id in the container's next[] still resolves
  for (const bid of m.get(sub.entry.id).next) assert.ok(m.has(bid), `branch ${bid} orphaned`);

  assert.ok(diff.createdSteps.includes(sub.entry.id));
  for (const id of ['s1', 's2', 's3']) assert.ok(diff.modifiedSteps.includes(id), `${id} must be re-persisted`);
  assert.deepEqual(diff.deletedSteps, []);
});

// REGRESSION (live-caught 2026-07-19). The first cut of insertSubgraphBefore APPENDED the
// container to templates[], so every pointer was right — correct parentKey, branches wired,
// no orphans, clean round-trip, PUT 200, publish 200 — and the builder still refused to
// render the container, showing the OLD head as the first step. The builder resolves the
// root by ARRAY POSITION. Every UI-built workflow has its head at templates[0].
//
// The original tests all passed through this bug because they locate the head with a
// predicate (`rootHeads(...)[0]`) rather than asserting where it physically sits. Assert
// POSITION, not just identity.
test('a prepended head lands at templates[0] — the builder resolves the root by position', () => {
  const sub = compileSubgraph(ifElse(), ctx('pos'));
  const { templates } = insertSubgraphBefore(linearWf(), sub, 's1', 'Yes');
  assert.equal(templates[0].id, sub.entry.id, 'container must be templates[0], not appended');
  assert.ok(Array.isArray(templates[0].next), 'templates[0] is the container');
  // its branch entries follow immediately, mirroring a fresh compile's emission order
  assert.equal(templates[1].parent, sub.entry.id);

  // and the plain-step prepend path holds the same invariant
  const plain = prependStep(linearWf(), { id: 'nEW', type: 'add_contact_tag', name: 'X', attributes: { tags: ['z'] } });
  assert.equal(plain.templates[0].id, 'nEW');
});

test('a container becoming the head REFUSES to guess which branch takes the workflow', () => {
  const sub = compileSubgraph(ifElse(), ctx());
  assert.throws(
    () => insertSubgraphBefore(linearWf(), sub, 's1', undefined),
    /attachTailTo/,
    'must name the branch — guessing here reroutes 100% of traffic');
});

test('applyOps routes insertBefore for both a plain step and a container', () => {
  const plain = applyOps(linearWf(), [{ op: 'insertBefore', step: tag('First', 'z'), beforeId: 's1' }], { ctx: ctx('a'), idGen: ctx('a').idGen });
  assert.equal(rootHeads(plain.templates).length, 1);
  assert.notEqual(rootHeads(plain.templates)[0].id, 's1', 'a new head took over');

  const cont = applyOps(linearWf(), [{ op: 'insertBefore', step: ifElse(), beforeId: 's1', attachTailTo: 'Yes' }], { ctx: ctx('b'), idGen: ctx('b').idGen });
  noDupes(cont.templates);
  assert.ok(Array.isArray(rootHeads(cont.templates)[0].next), 'the new head is a container');
});

// ---------------------------------------------------------------------------
// Dead-branch lint (item 4). NARROW on purpose: it fires only when THIS edit created a
// container that took over an existing chain — one branch carrying pre-existing steps
// while a sibling terminates immediately at END. That is the exact near-miss shape (the
// normal path silently sent to END, invisible except by reading the canvas). A branch
// that dead-ends on a FRESH build is frequently correct and must NOT fire.
// ---------------------------------------------------------------------------

const freshCtx = { loc: 'LOC', uid: 'UID' };

test('dead-branch lint FIRES when a new container sends a sibling straight to END', () => {
  const sub = compileSubgraph(ifElse(), ctx('d'));
  const { templates, diff } = insertSubgraphBefore(linearWf(), sub, 's1', 'Yes');
  assert.throws(
    () => editCommitBody({ version: 1 }, templates, diff, 'UID'),
    (e) => e.code === 'DEAD_BRANCH' && /Yes/.test(e.message) && /None/.test(e.message),
    'must name both the branch that took the chain and the one going to END');
});

test('dead-branch lint is overridable per-op once acknowledged', () => {
  const sub = compileSubgraph(ifElse(), ctx('d'));
  const { templates, diff } = insertSubgraphBefore(linearWf(), sub, 's1', 'Yes');
  const body = editCommitBody({ version: 1 }, templates, diff, 'UID', { deadBranchAcknowledged: true });
  assert.equal(body.workflowData.templates.length, templates.length);
});

test('dead-branch lint does NOT fire on a container appended at the tail', () => {
  // nothing followed the anchor, so no pre-existing chain landed on any branch — both
  // branches are legitimately empty and the author fills them in next.
  const wf = linearWf();
  const sub = compileSubgraph(ifElse(), ctx('e'));
  const { templates, diff } = applyOps(wf, [{ op: 'appendStep', step: ifElse() }], { ctx: ctx('e'), idGen: ctx('e').idGen });
  assert.doesNotThrow(() => editCommitBody({ version: 1 }, templates, diff, 'UID'));
});

test('dead-branch lint does NOT fire on a PREDEFINED branch key (find_opportunity)', () => {
  // Deliberate exemption, not an oversight: "Opportunity Found" is GHL's own branch, the
  // tail belongs on it ~always, and Not-Found dead-ending is idiomatic. Firing here would
  // train the author to pass deadBranchAcknowledged reflexively and kill the guard.
  const findOpp = {
    kind: 'find_opportunity', type: 'find_opportunity', name: 'Find Opportunity',
    find: { filters: [{ field: 'pipeline_id', value: 'PIPE1' }], sorting: 'latest' },
    onFound: [], onNotFound: [],
  };
  const { templates, diff } = applyOps(
    linearWf(),
    [{ op: 'insertBefore', step: findOpp, beforeId: 's2', attachTailTo: 'predefined_Opportunity Found' }],
    { ctx: ctx('f'), idGen: ctx('f').idGen });
  assert.doesNotThrow(() => editCommitBody({ version: 1 }, templates, diff, 'UID'));
});

test('dead-branch lint does NOT fire when the edit created no container', () => {
  const { templates, diff } = prependStep(linearWf(), { id: 'nEW', type: 'add_contact_tag', name: 'X', attributes: { tags: ['z'] } });
  assert.doesNotThrow(() => editCommitBody({ version: 1 }, templates, diff, 'UID'));
});
