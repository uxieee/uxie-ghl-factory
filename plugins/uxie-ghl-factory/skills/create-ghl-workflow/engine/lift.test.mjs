// W6 item 2, Task 2: the lifter — a stored workflow document back to the build format. A lifted spec is IR + pins +
// residual + frozen nodes (`spec.stored`), so compile(lift(W)) with ids pinned reproduces W step for step:
//   invariant 1  overlay(compile(lift(W))) ≡ W per step id, for a UI-shaped document
//   invariant 2  the fixpoint: lifting the compiler's own output leaves no residual and freezes nothing
//   invariant 3  the residual never carries a semantic path (identity or graph); those nodes are frozen instead
// Fixtures are synthetic (this repo is public): the all-containers IR compiled, then dressed the way the builder
// leaves a document — canvas positions, UI labels, an extra stored key, a two-segment branch, a step type the
// engine has no handler for, an unreachable step, a backward goto and a stored stepIndex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { orchestrate } from './orchestrate.mjs';
import { liftWorkflow, SEMANTIC_PATH_HEADS } from './lift.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { ALL } from './fixtures/all-containers.mjs';

const catalog = loadCatalog();
const ctx = (seed, extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen(seed), catalog, warn: () => {}, ...extra });
const templatesOf = (built) => built.autoSaveBody.workflowData.templates;
const byId = (ts) => new Map(ts.map((t) => [t.id, t]));

function engineDoc() {
  const built = compile(structuredClone(ALL), ctx('w'));
  return {
    built,
    doc: { _id: 'WID', name: 'All containers', locationId: 'LOC', companyId: 'CID', meta: built.autoSaveBody.meta,
      workflowData: { templates: structuredClone(templatesOf(built)) } },
  };
}

// The document as the builder would leave it after a person opened and saved it.
function uiDoc() {
  const { built, doc } = engineDoc();
  const ref = built._refMap;
  const T = doc.workflowData.templates;
  const get = (r) => T.find((t) => t.id === ref.get(r));
  T.forEach((t, i) => { t.advanceCanvasMeta = { position: { x: i * 10, y: i * 20 } }; });
  get('ie2').attributes.conditionName = 'Condition';                       // the UI's label, not the step name
  get('h1').attributes.previewUrl = 'https://example.invalid/p.png';        // a key the compiler never emits
  Object.assign(get('e1'), { type: 'create_opportunity', attributes: { type: 'create_opportunity', pipeline_id: 'P', pipeline_stage_id: 'S',
    fields: [{ field: 'custom_fields.x', value: '1' }] } });                // custom-field rows: no author form
  const start = get('start');
  const future = { id: 'FUTURE-1', type: 'future_step_type', name: 'From the future', parentKey: start.id, next: start.next, attributes: { x: 1 } };
  start.next = future.id;
  get('code1').parentKey = future.id;
  T.push(future);
  T.push({ id: 'ORPHAN-1', type: 'add_contact_tag', name: 'Orphan', parentKey: 'GONE', attributes: { tags: ['o'] } });
  get('back').attributes.targetNodeId = start.id;                           // a backward goto: a loop GHL already holds
  get('code1').stepIndex = 3;
  doc.meta = { stepIndexCounter: { custom_code: 9 } };
  return { doc, ref };
}

const relift = (lifted, seed = 'r') => compile(structuredClone(lifted.ir), ctx(seed, { pinIds: true, pins: lifted.ir.stored.pins }));

test('invariant 2: lifting the compiler\'s own output is a fixpoint — no residual, nothing frozen', () => {
  const { doc } = engineDoc();
  const lifted = liftWorkflow({ doc }, { catalog });
  assert.deepEqual(lifted.ir.stored.frozen, {});
  assert.deepEqual(lifted.ir.stored.residual, {});
  const again = byId(templatesOf(relift(lifted)));
  for (const s of doc.workflowData.templates) assert.deepEqual(again.get(s.id), s, s.name);
  assert.equal(again.size, doc.workflowData.templates.length);
});

test('invariant 1: a UI-shaped document round-trips step for step, ids included', () => {
  const { doc } = uiDoc();
  const lifted = liftWorkflow({ doc }, { catalog });
  assert.equal(lifted.report.frozen.length, 2, 'only the two inexpressible steps are frozen, so the invariant tests the inverses');
  const again = byId(templatesOf(relift(lifted)));
  for (const s of doc.workflowData.templates) assert.deepEqual(again.get(s.id), s, `${s.name} (${s.id})`);
  assert.equal(again.size, doc.workflowData.templates.length, 'no step added, none dropped');
});

test('what the IR cannot express is frozen or carried, and named — never dropped', () => {
  const { doc, ref } = uiDoc();
  const lifted = liftWorkflow({ doc }, { catalog });
  const frozen = lifted.report.frozen.map((f) => f.id);
  assert.ok(frozen.includes(ref.get('e1')), 'create_opportunity with custom-field rows frozen');
  assert.ok(frozen.includes('FUTURE-1'), 'a step type with no handler frozen');
  assert.deepEqual(lifted.report.detached, ['ORPHAN-1']);
  assert.deepEqual(lifted.report.acceptedLoops.length, 1);
  for (const f of lifted.report.frozen) assert.ok(f.reason, `frozen ${f.id} says why`);
});

test('a branch with two condition segments freezes its if_else, subtree and all, and still round-trips', () => {
  const ir = { name: 'Two segments', triggers: [], graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['a'] } },
    { ref: 'ie', kind: 'if_else', name: 'Split on tags', branches: [
      { ref: 'b1', name: 'Hot', conditions: [{ conditionType: 'contact_detail', tag: 'hot' }], then: [{ ref: 'c', kind: 'action', type: 'add_contact_tag', name: 'C', attributes: { tags: ['c'] } }] },
      { ref: 'b2', name: 'Else', else: true, then: [] }] }] };
  const built = compile(ir, ctx('s'));
  const T = structuredClone(templatesOf(built));
  T.find((t) => t.nodeType === 'condition-node').attributes.branches[0].segments.push({ __segmentId: 'SEG-2', operator: 'or', conditions: [] });
  const doc = { name: 'Two segments', workflowData: { templates: T } };
  const lifted = liftWorkflow({ doc }, { catalog });
  assert.deepEqual(lifted.report.frozen.map((f) => f.id), [built._refMap.get('ie')]);
  assert.match(lifted.report.frozen[0].reason, /2 condition segments/);
  assert.equal(lifted.ir.stored.frozen[built._refMap.get('ie')].length, 4, 'container, both lanes and the step under Hot');
  const again = byId(templatesOf(relift(lifted)));
  for (const s of T) assert.deepEqual(again.get(s.id), s, s.name);
  assert.equal(again.size, T.length);
});

test('invariant 3: the residual carries no semantic path', () => {
  const { doc } = uiDoc();
  const lifted = liftWorkflow({ doc }, { catalog });
  for (const [id, entries] of Object.entries(lifted.ir.stored.residual)) {
    const head = lifted.ir.stored.frozen[id] !== undefined;
    for (const e of entries) {
      if (head && e.p.length === 1 && e.p[0] === 'next') continue;                 // a frozen head's stored link
      if (e.p[0] === 'stepIndex' && !Number.isInteger(e.t)) continue;              // a number the UI never stored
      assert.ok(!SEMANTIC_PATH_HEADS.some((h) => h.every((k, i) => e.p[i] === k)), `${id}: ${e.p.join('.')}`);
    }
    assert.ok(entries.every((e) => e.p.at(-1) !== 'id'), `${id}: an id leaf in the residual`);
  }
});

test('the stored stepIndex and counter survive; a step added to the spec takes the next index', () => {
  const { doc, ref } = uiDoc();
  const lifted = liftWorkflow({ doc }, { catalog });
  const built = relift(lifted);
  const t = byId(templatesOf(built));
  assert.equal(t.get(ref.get('code1')).stepIndex, 3);
  assert.equal(built.autoSaveBody.meta.stepIndexCounter.custom_code, 9);
});

test('an author edit wins over the residual; untouched stored keys on the same step stay', () => {
  const { doc, ref } = uiDoc();
  const lifted = liftWorkflow({ doc }, { catalog });
  const ir = structuredClone(lifted.ir);
  const h1 = JSON.stringify(ir.graph).includes(ref.get('h1'));
  assert.ok(h1);
  const find = (nodes) => { for (const n of nodes ?? []) { if (n.ref === ref.get('h1')) return n; for (const k of ['then', 'onFound', 'onNotFound', 'onBooked', 'onNotBooked', 'onEvent', 'onTimeout', 'default']) { const x = find(n[k]); if (x) return x; } for (const b of [...(n.branches ?? []), ...(n.paths ?? [])]) { const x = find(b.then); if (x) return x; } } return null; };
  const node = find(ir.graph);
  node.attributes.tags = ['edited'];
  const built = compile(ir, ctx('e', { pinIds: true, pins: ir.stored.pins }));
  const step = byId(templatesOf(built)).get(ref.get('h1'));
  assert.deepEqual(step.attributes.tags, ['edited']);
  assert.equal(step.attributes.previewUrl, 'https://example.invalid/p.png');
  assert.deepEqual(step.advanceCanvasMeta, doc.workflowData.templates.find((x) => x.id === step.id).advanceCanvasMeta);
});

test('without pins (a new workflow from a lifted spec) every id is fresh, frozen subtrees included, and the graph still closes', () => {
  const { doc } = uiDoc();
  const lifted = liftWorkflow({ doc }, { catalog });
  const built = compile(structuredClone(lifted.ir), ctx('n'));
  const T = templatesOf(built);
  const storedIds = new Set(doc.workflowData.templates.map((t) => t.id));
  assert.deepEqual(T.filter((t) => storedIds.has(t.id)).map((t) => t.name), []);
  const ids = new Set(T.map((t) => t.id));
  for (const t of T) for (const n of [t.next].flat().filter(Boolean)) assert.ok(ids.has(n), `${t.name} -> ${n}`);
  assert.ok(!JSON.stringify(T).includes(doc.workflowData.templates[0].id), 'no stored id leaks into a new workflow');
});

test('the lifter does not touch the document it reads', () => {
  const { doc } = uiDoc();
  const before = JSON.stringify(doc);
  liftWorkflow({ doc }, { catalog });
  assert.equal(JSON.stringify(doc), before);
});

test('build_workflow\'s path (orchestrate) builds a lifted spec as a NEW workflow: no stored id reaches the wire', async () => {
  const { doc } = uiDoc();
  const lifted = liftWorkflow({ doc }, { catalog });
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'POST' && /\/workflow\/LOC$/.test(path)) return { ok: true, status: 200, json: { id: 'NEWWID' } };
    if (method === 'GET' && /\/tags$/.test(path)) return { ok: true, status: 200, json: { tags: [] } };
    if (method === 'POST' && path.includes('/validate')) return { ok: true, status: 200, json: { valid: true, errors: [], warnings: [] } };
    if (method === 'GET' && path.includes('/workflow/LOC/NEWWID')) {
      const save = calls.filter((c) => c.method === 'PUT' && c.path.includes('/auto-save')).at(-1);
      return { ok: true, status: 200, json: { ...(save?.body ?? {}), _id: 'NEWWID', id: 'NEWWID' } };
    }
    return { ok: true, status: 200, json: {} };
  };
  // The stored defects this fixture carries are refused for a NEW workflow by the build gate, like any authored defect.
  const refused = await orchestrate(structuredClone(lifted.ir), { call, loc: 'LOC', uid: 'UID' }, { ignoreUnresolved: true, skipCustomCodeTest: true });
  assert.match(String(refused.aborted), /VALIDATION_GATE/);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET' && !c.path.includes('/validate')), [], 'refused before any write');
  // ... and built under the gate's own hatch, every id is new.
  const r = await orchestrate(structuredClone(lifted.ir), { call, loc: 'LOC', uid: 'UID' }, { ignoreUnresolved: true, skipCustomCodeTest: true, allowValidationFailure: true });
  const save = calls.find((c) => c.method === 'PUT' && c.path.includes('/auto-save'));
  assert.ok(save, `an auto-save was sent (aborted: ${r.aborted})`);
  const storedIds = doc.workflowData.templates.map((t) => t.id);
  const wire = JSON.stringify(save.body.workflowData.templates);
  assert.deepEqual(storedIds.filter((id) => wire.includes(id)), []);
  assert.equal(save.body.workflowData.templates.length, doc.workflowData.templates.length);
});
