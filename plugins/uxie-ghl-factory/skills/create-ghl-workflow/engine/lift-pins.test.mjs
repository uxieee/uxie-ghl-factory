// W6 item 2, Task 1: compiler id pins. A stored workflow read back as a spec must compile to the SAME ids — step,
// branch, path, lane, transition, segment, condition, branch key, goto target — and the same stepIndex, or a
// repair re-mints every id and breaks every merge tag, goto and log row that names one. With `pinIds`, an authored
// ref IS the id, and every id the compiler mints for itself is looked up by (owner id, slot) in `pins.slots`
// first. Without pins nothing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const catalog = loadCatalog();
const ctx = (seed, extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen(seed), catalog, warn: () => {}, ...extra });
import { ALL, code } from './fixtures/all-containers.mjs';

const templatesOf = (built) => built.autoSaveBody.workflowData.templates;
const metaOf = (built) => built.autoSaveBody.workflowData.meta ?? built.autoSaveBody.meta;

// The test's stand-in for the lifter: every ref (node, branch, path, goto target, reply step) becomes the id it
// compiled to, the way a spec read from a stored document names its steps.
function relabel(ir, refToId) {
  const id = (r) => (refToId.has(r) ? refToId.get(r) : r);
  const walk = (v, key) => {
    if (Array.isArray(v)) return key === 'steps' ? v.map(id) : v.map((x) => walk(x));
    if (!v || typeof v !== 'object') return v;
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = (k === 'ref' || k === 'target') ? id(x) : (k === 'attributes' ? x : walk(x, k));
    return o;
  };
  return { ...ir, graph: walk(ir.graph) };
}

function firstBuild() {
  const mintLog = new Map();
  const refLog = new Map();
  const built = compile(structuredClone(ALL), ctx('a', { mintLog, refLog }));
  return { built, slots: Object.fromEntries(mintLog), refToId: refLog };
}

test('a recompile with pinIds and the recorded slots reproduces every id of every container kind', () => {
  const { built, slots, refToId } = firstBuild();
  assert.ok(Object.keys(slots).length >= 20, `the compiler recorded ${Object.keys(slots).length} minted slots`);
  const lifted = relabel(ALL, refToId);
  const again = compile(lifted, ctx('b', { pinIds: true, pins: { slots } }));
  assert.deepEqual(templatesOf(again), templatesOf(built));
});

test('without pins a different seed mints different ids (the pins, not the seed, carry identity)', () => {
  const { built, refToId } = firstBuild();
  const fresh = compile(relabel(ALL, refToId), ctx('b'));
  const a = new Set(templatesOf(built).map((t) => t.id));
  const minted = templatesOf(fresh).filter((t) => !a.has(t.id));
  assert.ok(minted.length > 0, 'some ids are compiler-minted, so an unpinned recompile changes them');
});

test('pins are inert unless pinIds is set: same seed, same output, pins or not', () => {
  const { slots } = firstBuild();
  const plain = compile(structuredClone(ALL), ctx('c'));
  const ignored = compile(structuredClone(ALL), ctx('c', { pins: { slots } }));
  assert.deepEqual(templatesOf(ignored), templatesOf(plain));
});

test('a stored stepIndex is kept, the stored counter seeds the next one, and the counter is emitted as stored', () => {
  const { built, refToId } = firstBuild();
  const lifted = relabel(ALL, refToId);
  const c1 = refToId.get('code1'), c2 = refToId.get('code2');
  const setIdx = (nodes) => nodes.forEach((n) => {
    if (n.ref === c1) n.stepIndex = 3;
    if (n.ref === c2) n.stepIndex = 7;
    for (const k of ['then', 'onFound', 'onNotFound', 'onBooked', 'onNotBooked', 'onEvent', 'onTimeout', 'default']) if (Array.isArray(n[k])) setIdx(n[k]);
    for (const k of ['branches', 'paths']) (n[k] ?? []).forEach((b) => setIdx(b.then ?? []));
  });
  setIdx(lifted.graph);
  lifted.graph[2].branches[1].then.push(code('code3'));   // the empty Warm lane
  const again = compile(lifted, ctx('d', { pinIds: true, pins: { slots: {}, stepIndexCounter: { custom_code: 9 } } }));
  const byId = Object.fromEntries(templatesOf(again).map((t) => [t.id, t]));
  assert.equal(byId[c1].stepIndex, 3);
  assert.equal(byId[c2].stepIndex, 7);
  const added = templatesOf(again).find((t) => t.name === 'code3');
  assert.equal(added.stepIndex, 10, 'a new step continues from the stored counter, never reusing an index');
  assert.equal(metaOf(again).stepIndexCounter.custom_code, 10);
  assert.equal(metaOf(built).stepIndexCounter.custom_code, 2, 'unpinned numbering unchanged: 1, 2');
});
