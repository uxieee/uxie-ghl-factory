// w6c-4b (plan: unlock the proven Split modes). A mode is unlocked when the w6c-11 live differential proved its stored names: the
// compiled container must match the stored body GHL returned on a separate read. The stored bodies are in
// fixtures/split-stored-bodies.json, reduced to condition and extras with every real id replaced by a placeholder (the source
// pointers are in that file's _source). Even, weighted (integers 1-99 summing to 100) and random (10 paths) are proven. Conditional
// has NO fixture and the builder on the sandbox does not offer it (w6c-0 FINDINGS), so it stays refused (SPLIT_MODE_UNPROVEN).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORED = JSON.parse(readFileSync(join(HERE, 'fixtures/split-stored-bodies.json'), 'utf8')).modes;
const catalog = loadCatalog();
const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('split-live'), catalog });
const trig = [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }];
const paths = (n, weights) => Array.from({ length: n }, (_, i) => ({ ref: `p${i}`, name: `Path ${i}`, then: [], ...(weights ? { weight: weights[i] } : {}) }));
const splitIr = (split) => ({ name: 'S', triggers: trig, graph: [{ ref: 's', kind: 'split', name: 'Split', ...split }] });
const container = (ts) => ts.find((t) => t.type === 'workflow_split');
const wd = (attrs) => Object.values(attrs.extras?.weightDistribution ?? {});
const compiledAttrs = (split) => container(compile(splitIr(split), ctx()).autoSaveBody.workflowData.templates).attributes;

test('even: the compiled container matches the stored body (condition even-split; extras as stored)', () => {
  const stored = STORED.even;
  const c = compiledAttrs({ mode: 'even', paths: paths(2) });
  assert.equal(c.condition, stored.condition);
  assert.deepEqual(Object.keys(c.extras ?? {}).sort(), Object.keys(stored.extras).sort());
  assert.equal(c.extras.weightDistribution, undefined, 'even stores no weights, as read back');
});

test('weighted 33/33/34: the compiled container matches the stored body (condition weighted-split; weights in path order)', () => {
  const stored = STORED.weighted;
  const c = compiledAttrs({ mode: 'weighted', paths: paths(3, [33, 33, 34]) });
  assert.equal(c.condition, stored.condition);
  assert.deepEqual(Object.keys(c.extras ?? {}).sort(), Object.keys(stored.extras).sort());
  assert.deepEqual(wd(c), Object.values(stored.extras.weightDistribution), 'weights 33/33/34 as read back');
  assert.equal(wd(c).reduce((a, b) => a + b, 0), 100);
});

test('random, 10 paths: the compiled container matches the stored body (condition random-split; 10 equal weights as read back)', () => {
  const stored = STORED.random;
  const c = compiledAttrs({ mode: 'random', paths: paths(10) });
  assert.equal(c.condition, stored.condition);
  assert.deepEqual(Object.keys(c.extras ?? {}).sort(), Object.keys(stored.extras).sort());
  assert.deepEqual(wd(c), Object.values(stored.extras.weightDistribution));
  assert.equal(wd(c).length, 10);
});

test('conditional stays refused (SPLIT_MODE_UNPROVEN): no fixture, and the builder does not offer it on the sandbox', () => {
  assert.throws(() => compile(splitIr({ mode: 'conditional', paths: paths(2) }), ctx()), (e) => e.code === 'SPLIT_MODE_UNPROVEN');
});
