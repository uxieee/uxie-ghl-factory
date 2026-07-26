// Edit-op argument-shape guard.
//
// `{op:'appendStep', node:{...}}` used to fail with `Cannot read properties of undefined
// (reading 'kind')` from deep inside compileSubgraph — an error naming neither the op nor
// the key. The IR calls these things NODES everywhere except the edit ops, which call
// them STEPS, so `node` is the natural wrong guess. Live on AU 2026-07-25.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOpShape, applyOps } from './edit-driver.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog() });

test("appendStep with `node` names the mistake instead of dying on .kind", () => {
  assert.throws(
    () => checkOpShape({ op: 'appendStep', node: { kind: 'action', type: 'sms' } }),
    (e) => /appendStep/.test(e.message)
        && /missing required argument\(s\) \[step\]/.test(e.message)
        && /you passed 'node' — this op takes 'step'/.test(e.message));
});

test('the same mistake through applyOps, not just the bare checker', () => {
  assert.throws(
    () => applyOps([], [{ op: 'appendStep', node: { kind: 'action', type: 'sms' } }], { ctx: ctx(), idGen: makeSeededIdGen('b') }),
    (e) => /this op takes 'step'/.test(e.message));
});

test('other aliased keys are named too', () => {
  assert.throws(() => checkOpShape({ op: 'deleteStep', id: 'S1' }),
    (e) => /you passed 'id' — this op takes 'stepId'/.test(e.message));
  assert.throws(() => checkOpShape({ op: 'appendToBranch', step: {}, branchId: 'B1' }),
    (e) => /you passed 'branchId' — this op takes 'branchEntryId'/.test(e.message));
});

test('a plainly missing argument reports the op signature without inventing a suggestion', () => {
  assert.throws(
    () => checkOpShape({ op: 'insertAfter', step: {} }),
    (e) => /missing required argument\(s\) \[afterId\]/.test(e.message)
        && /takes: step, afterId/.test(e.message)
        && !/you passed/.test(e.message));
});

test('well-formed ops pass, including the zero-argument one', () => {
  assert.doesNotThrow(() => checkOpShape({ op: 'repairParentKeys' }));
  assert.doesNotThrow(() => checkOpShape({ op: 'appendStep', step: { kind: 'action', type: 'sms' } }));
  assert.doesNotThrow(() => checkOpShape({ op: 'moveStep', stepId: 'S1', afterId: 'S2' }));
});

test('unknown ops still fall through to the dispatch default, not this guard', () => {
  assert.doesNotThrow(() => checkOpShape({ op: 'notAnOp' }));
  assert.throws(
    () => applyOps([], [{ op: 'notAnOp' }], { ctx: ctx(), idGen: makeSeededIdGen('c') }),
    (e) => /unknown edit op/.test(e.message));
});

// Trigger ops are partitioned out before applyOp, so the guard must not claim them.
test('trigger ops are not policed here — they route through planTriggerOps', () => {
  assert.doesNotThrow(() => checkOpShape({ op: 'addTrigger', trigger: {} }));
});
