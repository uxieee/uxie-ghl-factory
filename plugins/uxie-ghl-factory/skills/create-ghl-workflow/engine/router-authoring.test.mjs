// w6c-1 (bl-784): the engine authors a Router. RED first (2026-11-07).
// Contract: the IR kind `router` compiles to GHL's stored shape (root = condition-node with attributes.branches, next = its lane
// ids in branch order; one lane per branch, nodeType branch-yes, attributes.routerBranch true, parentKey = the root). Every
// refusal below carries our code AND names GHL's own validator rule (router-rules.ts:223-230 and router.ts:249,414;
// evidence: console/.superpowers/sdd/release-2026-11-06/router-loop.md section 3).
// The bare Router round trip uses knowledge/sniffs/workflows-w6c-2026-11-06/fixtures/router.json (TEST-CONF-W6C-router, read back).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from './compiler.mjs';
import { liftWorkflow } from './lift.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// engine -> create-ghl-workflow -> skills -> uxie-ghl-factory -> plugins -> plugin -> lane root (six levels up), then knowledge
const FIXTURE = join(HERE, '../../../../../../knowledge/sniffs/workflows-w6c-2026-11-06/fixtures/router.json');
const catalog = loadCatalog();
const ctx = (seed = 'a', extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen(seed), catalog, ...extra });

// one custom branch with a complete condition, distinct per branch (GHL refuses an unfinished or duplicate branch)
const cond = (field) => ({ operator: 'and', conditions: [{ conditionType: 'contact_detail', conditionSubType: field, conditionOperator: 'has_value' }] });
// a branch's children are its `then` sequence (the IR convention, as on if_else and split)
const custom = (ref, field, then = []) => ({ ref, name: `Branch ${ref}`, branchType: 'custom', operator: 'and', segments: [cond(field)], then });
const fallback = (ref, then = []) => ({ ref, name: 'Fallback', branchType: 'fallback', then });
const routerIR = (branches, name = 'Router') => ({ name: 'R', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
  graph: [{ ref: 'r', kind: 'router', name, branches }] });
const rootOf = (templates) => templates.find((t) => t.type === 'router' && t.nodeType === 'condition-node');
const lanesOf = (templates, rootId) => templates.filter((t) => t.type === 'router' && t.nodeType === 'branch-yes' && t.parentKey === rootId);

test('three custom branches + a fallback compile to a condition-node root whose next lists the 4 lanes in branch order', () => {
  const ir = routerIR([custom('a', 'first_name'), custom('b', 'last_name'), custom('c', 'email'), fallback('f')]);
  const t = compile(ir, ctx()).autoSaveBody.workflowData.templates;
  const root = rootOf(t);
  assert.ok(root, 'a router root (type router, nodeType condition-node) is emitted');
  const lanes = lanesOf(t, root.id);
  assert.equal(lanes.length, 4, 'one lane per branch');
  assert.deepEqual(root.next, lanes.map((l) => l.id), 'root next = the lane ids, in branch order');
  assert.equal(lanes.at(-1).name, 'Fallback', 'the fallback lane is last');
});

test('the lane id equals attributes.branches[i].id, and each lane is branch-yes with attributes.routerBranch', () => {
  const t = compile(routerIR([custom('a', 'first_name'), fallback('f')]), ctx()).autoSaveBody.workflowData.templates;
  const root = rootOf(t);
  const branches = root.attributes.branches;
  const lanes = lanesOf(t, root.id);
  assert.deepEqual(lanes.map((l) => l.id), branches.map((b) => b.id), 'lane id === branch id, in order');
  for (const l of lanes) {
    assert.equal(l.nodeType, 'branch-yes');
    assert.deepEqual(l.attributes, { routerBranch: true });
    assert.equal(l.parentKey, root.id);
  }
});

test('an always-run branch with a fallback is refused (GHL: alwaysRunFallbackConflict)', () => {
  const ir = routerIR([{ ref: 'a', name: 'All', branchType: 'always_run', segments: [], then: [] }, fallback('f')]);
  assert.throws(() => compile(ir, ctx()), (e) => e.code === 'ROUTER_ALWAYS_RUN_FALLBACK' && /alwaysRunFallbackConflict/.test(e.message));
});

test('eleven branches are refused (GHL: tooManyBranches, limit 10)', () => {
  const ir = routerIR(Array.from({ length: 11 }, (_, i) => custom(`b${i}`, `f${i}`)));
  assert.throws(() => compile(ir, ctx()), (e) => e.code === 'ROUTER_BRANCH_LIMIT' && /tooManyBranches/.test(e.message));
});

test('two fallbacks are refused (GHL: fallbackExists)', () => {
  const ir = routerIR([fallback('f1'), fallback('f2')]);
  assert.throws(() => compile(ir, ctx()), (e) => e.code === 'ROUTER_FALLBACK_LIMIT' && /fallbackExists/.test(e.message));
});

test('a custom branch with no complete condition is refused (GHL: branchError)', () => {
  const ir = routerIR([{ ref: 'a', name: 'Half', branchType: 'custom', operator: 'and', segments: [], then: [] }, fallback('f')]);
  assert.throws(() => compile(ir, ctx()), (e) => e.code === 'ROUTER_BRANCH_INCOMPLETE' && /branchError/.test(e.message));
});

test('two branches on the same conditions are refused (GHL: duplicateBranchError)', () => {
  const ir = routerIR([custom('a', 'first_name'), custom('b', 'first_name')]);
  assert.throws(() => compile(ir, ctx()), (e) => e.code === 'ROUTER_DUPLICATE_BRANCH' && /duplicateBranchError/.test(e.message));
});

test('a router nested eleven deep is refused (GHL: nestingLimit, "Cannot nest more than 10 routers")', () => {
  let inner = { ref: 'leaf', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } };
  for (let d = 0; d < 11; d++) inner = { ref: `r${d}`, kind: 'router', name: `R${d}`, branches: [custom(`a${d}`, `f${d}`, [inner]), fallback(`f${d}x`)] };
  assert.throws(() => compile({ name: 'N', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [inner] }, ctx()),
    (e) => e.code === 'ROUTER_NESTING_LIMIT' && /Cannot nest more than 10 routers/.test(e.message));
});

test('a goto or a goal inside a branch is refused (GHL: stepNotAllowedInBranch)', () => {
  const goal = { ref: 'g', kind: 'action', type: 'workflow_goal', name: 'Goal', attributes: {} };
  assert.throws(() => compile(routerIR([custom('a', 'first_name', [goal]), fallback('f')]), ctx()),
    (e) => e.code === 'ROUTER_STEP_NOT_ALLOWED' && /stepNotAllowedInBranch/.test(e.message));
});

test('branches do not re-merge: no lane\'s last step points at a sibling lane\'s continuation', () => {
  const step = (ref) => ({ ref, kind: 'action', type: 'add_contact_tag', name: ref, attributes: { tags: [ref] } });
  const t = compile(routerIR([custom('a', 'first_name', [step('s1')]), custom('b', 'last_name', [step('s2')]), fallback('f', [step('s3')])]), ctx())
    .autoSaveBody.workflowData.templates;
  const lanes = lanesOf(t, rootOf(t).id);
  const ends = lanes.map((l) => {
    let cur = l.next;
    const seen = new Set();
    while (typeof cur === 'string' && cur && !seen.has(cur)) { seen.add(cur); const s = t.find((x) => x.id === cur); if (!s || typeof s.next !== 'string') break; cur = s.next; }
    return cur;
  });
  assert.equal(new Set(ends.filter(Boolean)).size, ends.filter(Boolean).length, 'no two branches continue into the same step');
});

test('round trip: compile(lift(stored bare Router)) reproduces the stored templates, same ids (fixture router.json)', () => {
  const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const stored = doc.templates;
  const lifted = liftWorkflow({ doc: { workflowData: { templates: stored } } }, { catalog });
  // a builder-made router must lift to the router KIND, not be carried verbatim as a raw step (a raw passthrough would
  // round-trip without authoring anything)
  const routerNode = lifted.ir.graph.find((n) => n.kind === 'router');
  assert.ok(routerNode, 'the lift yields a router kind node');
  assert.equal(lifted.ir.graph.filter((n) => n.kind === 'raw').length, 0, 'no router step is carried raw');
  const again = compile(structuredClone(lifted.ir), ctx('r', { pinIds: true, pins: lifted.ir.stored.pins })).autoSaveBody.workflowData.templates;
  const byId = new Map(again.map((s) => [s.id, s]));
  for (const s of stored) assert.deepEqual(byId.get(s.id), s, `${s.name} (${s.id})`);
  assert.equal(again.length, stored.length, 'no step added, none dropped');
});
