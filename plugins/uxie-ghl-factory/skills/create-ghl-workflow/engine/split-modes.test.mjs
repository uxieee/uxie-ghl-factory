// w6c-4 (plan Task 4, bl-786): the Split to 10 paths and its modes. Even, weighted and random compile from the w6c-0 fixtures
// (split-even.json, split-weighted.json, split-random.json); conditional stays refused with SPLIT_MODE_UNPROVEN until w6c-11's live
// differential proves its stored names (w6c-4b). Controls pass today; the rest are RED until GREEN.
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
const FIX = (f) => join(HERE, '../../../../../../knowledge/sniffs/workflows-w6c-2026-11-06/fixtures', f);
const catalog = loadCatalog();
const ctx = (seed = 'split', extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen(seed), catalog, ...extra });
const trig = [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }];
const tag = (ref, tags = ['x']) => ({ ref, kind: 'action', type: 'add_contact_tag', name: `Tag ${ref}`, attributes: { tags } });
const paths = (n, weights) => Array.from({ length: n }, (_, i) => ({ ref: `p${i}`, name: `Path ${String.fromCharCode(65 + i)}`, then: [], ...(weights ? { weight: weights[i] } : {}) }));
const splitIr = (split) => ({ name: 'S', triggers: trig, graph: [{ ref: 's', kind: 'split', name: 'Split', ...split }] });
const container = (ts) => ts.find((t) => t.type === 'workflow_split');
const fixture = (f) => JSON.parse(readFileSync(FIX(f), 'utf8')).templates;

test('10 paths are accepted; 11 are refused (SPLIT_ARITY)', () => {
  assert.doesNotThrow(() => compile(splitIr({ mode: 'random', paths: paths(10) }), ctx()));
  assert.throws(() => compile(splitIr({ mode: 'random', paths: paths(11) }), ctx()), (e) => e.code === 'SPLIT_ARITY');
});

test('weights not summing to 100.0 are refused (SPLIT_WEIGHT); one-decimal weights summing to 100.0 pass', () => {
  assert.throws(() => compile(splitIr({ mode: 'weighted', paths: paths(2, [60, 30]) }), ctx()), (e) => e.code === 'SPLIT_WEIGHT');
  assert.throws(() => compile(splitIr({ mode: 'weighted', paths: paths(2, [33.35, 66.65]) }), ctx()), (e) => e.code === 'SPLIT_WEIGHT', 'two decimals are not allowed');
  assert.doesNotThrow(() => compile(splitIr({ mode: 'weighted', paths: paths(2, [60, 40]) }), ctx()));
});

test('even-split stores no weights (condition even-split, extras carry rememberPath only)', () => {
  const ts = compile(splitIr({ mode: 'even', paths: paths(3) }), ctx()).autoSaveBody.workflowData.templates;
  const c = container(ts);
  assert.equal(c.attributes.condition, 'even-split');
  assert.equal(c.attributes.extras.weightDistribution, undefined, 'no weights are stored');
  assert.equal(c.attributes.extras.rememberPath, true);
});

test('conditional-split is refused with SPLIT_MODE_UNPROVEN, naming the missing proof', () => {
  assert.throws(() => compile(splitIr({ mode: 'conditional', paths: paths(2) }), ctx()),
    (e) => e.code === 'SPLIT_MODE_UNPROVEN' && /conditional/.test(e.message) && /w6c-11|fixture|proof/i.test(e.message));
});

test('CONTROL: random-split output is byte-identical to today (regression, snapshot captured before the change)', () => {
  const snapshot = JSON.parse(readFileSync(join(HERE, 'split-random.snapshot.json'), 'utf8'));
  const out = compile(splitIr({ mode: 'random', paths: [{ ref: 'a', name: 'Path A', then: [tag('ta')] }, { ref: 'b', name: 'Path B', then: [tag('tb')] }] }), ctx()).autoSaveBody.workflowData.templates;
  assert.deepEqual(out, snapshot);
});

test('compile(lift(fixture)) === fixture for the even split fixture', () => {
  const stored = fixture('split-even.json');
  const lifted = liftWorkflow({ doc: { workflowData: { templates: stored } } }, { catalog });
  assert.ok(lifted.ir.graph.some((n) => n.kind === 'split'), 'the split lifts to the split kind, not frozen as stored');
  const again = compile(structuredClone(lifted.ir), { ...ctx('r'), pinIds: true, pins: lifted.ir.stored.pins }).autoSaveBody.workflowData.templates;
  const byId = new Map(again.map((s) => [s.id, s]));
  for (const s of stored) assert.deepEqual(byId.get(s.id), s, `${s.name} (${s.id})`);
});

test('compile(lift(fixture)) === fixture for the weighted split fixture (60 / 40)', () => {
  const stored = fixture('split-weighted.json');
  const lifted = liftWorkflow({ doc: { workflowData: { templates: stored } } }, { catalog });
  assert.ok(lifted.ir.graph.some((n) => n.kind === 'split'), 'the split lifts to the split kind, not frozen as stored');
  const again = compile(structuredClone(lifted.ir), { ...ctx('r'), pinIds: true, pins: lifted.ir.stored.pins }).autoSaveBody.workflowData.templates;
  const byId = new Map(again.map((s) => [s.id, s]));
  for (const s of stored) assert.deepEqual(byId.get(s.id), s, `${s.name} (${s.id})`);
});

test('compile(lift(fixture)) === fixture for the random split fixture (50 / 50)', () => {
  const stored = fixture('split-random.json');
  const lifted = liftWorkflow({ doc: { workflowData: { templates: stored } } }, { catalog });
  assert.ok(lifted.ir.graph.some((n) => n.kind === 'split'), 'the split lifts to the split kind, not frozen as stored');
  const again = compile(structuredClone(lifted.ir), { ...ctx('r'), pinIds: true, pins: lifted.ir.stored.pins }).autoSaveBody.workflowData.templates;
  const byId = new Map(again.map((s) => [s.id, s]));
  for (const s of stored) assert.deepEqual(byId.get(s.id), s, `${s.name} (${s.id})`);
});

// QA fail #1 and #2 (w6c-4), and w6c-11b (live refusal 2026-11-07): a weight is a WHOLE percentage from 1 to 99 (GHL: "weightDistribution
// values must be integers between 1 and 99"); the weights must sum to exactly 100. An even split takes no weights (refused, not dropped).
test('a weight is an integer from 1 to 99 (SPLIT_WEIGHT): 0, 100, a negative or a fraction is refused, even when the total is 100', () => {
  assert.throws(() => compile(splitIr({ mode: 'weighted', paths: paths(2, [110, -10]) }), ctx()), (e) => e.code === 'SPLIT_WEIGHT');
  assert.throws(() => compile(splitIr({ mode: 'random', paths: paths(2, [110, -10]) }), ctx()), (e) => e.code === 'SPLIT_WEIGHT');
  assert.throws(() => compile(splitIr({ mode: 'weighted', paths: paths(2, [100, 0]) }), ctx()), (e) => e.code === 'SPLIT_WEIGHT', '0 and 100 are outside 1 to 99');
  assert.doesNotThrow(() => compile(splitIr({ mode: 'weighted', paths: paths(2, [99, 1]) }), ctx()), '1 and 99 are the bounds');
});

test('an authored weight on an even split is refused (SPLIT_WEIGHT), not silently dropped', () => {
  assert.throws(() => compile(splitIr({ mode: 'even', paths: paths(2, [70, 30]) }), ctx()),
    (e) => e.code === 'SPLIT_WEIGHT' && /even-split takes no weights/.test(e.message) && /weighted/.test(e.message));
});

// w6c-11b (orchestrator decision 2026-11-07: live beats corpus): integers 1-99 summing to 100. The live server refused 33.3 / 33.3 / 33.4
// on GROM Sandbox (weightDistribution values must be integers between 1 and 99); 33 / 33 / 34 was accepted and read back.
test('integer weights summing to 100 are accepted and stored as authored (33 / 33 / 34)', () => {
  const ts = compile(splitIr({ mode: 'weighted', paths: paths(3, [33, 33, 34]) }), ctx()).autoSaveBody.workflowData.templates;
  assert.deepEqual(Object.values(container(ts).attributes.extras.weightDistribution), [33, 33, 34]);
});

test('one-decimal weights are refused, as the live server refused 33.3 (SPLIT_WEIGHT)', () => {
  assert.throws(() => compile(splitIr({ mode: 'weighted', paths: paths(3, [33.3, 33.3, 33.4]) }), ctx()), (e) => e.code === 'SPLIT_WEIGHT');
});

test('a weight with two decimals is refused (SPLIT_WEIGHT)', () => {
  assert.throws(() => compile(splitIr({ mode: 'weighted', paths: paths(2, [50.55, 49.45]) }), ctx()), (e) => e.code === 'SPLIT_WEIGHT');
});

test('the integer total must be exactly 100: 50 + 50 passes; 50 + 49 = 99 is refused (SPLIT_WEIGHT)', () => {
  assert.doesNotThrow(() => compile(splitIr({ mode: 'weighted', paths: paths(2, [50, 50]) }), ctx()));
  assert.throws(() => compile(splitIr({ mode: 'weighted', paths: paths(2, [50, 49]) }), ctx()), (e) => e.code === 'SPLIT_WEIGHT');
});

test('a split with NO mode but authored weights warns (ctx.warn naming mode weighted) and is not refused', () => {
  const warnings = [];
  assert.doesNotThrow(() => compile(splitIr({ paths: paths(2, [60, 40]) }), ctx('split', { warn: (m) => warnings.push(m) })));
  assert.ok(warnings.some((m) => /mode: weighted/.test(m)), `warned: ${JSON.stringify(warnings)}`);
});
