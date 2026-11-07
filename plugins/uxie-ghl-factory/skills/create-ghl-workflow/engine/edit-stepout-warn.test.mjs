// w6d-8 QA item (bl-893): the step-output lint must judge an EDIT on the whole renumbered workflow, not on the inserted subgraph alone.
// Before the fix, compileSubgraph compiled the inserted steps by themselves, so the lint could not see the target's own custom_code steps
// and warned that a correctly renumbered copy reference "renders literally/empty". RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from './edit-driver.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctxWithWarnings = (warnings) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('c'), catalog: loadCatalog(),
  warn: (m) => warnings.push(m) });
const cc = (id, name, stepIndex, code, prev, next) => ({ id, type: 'custom_code', name, stepIndex, next, parentKey: prev, order: 0,
  attributes: { language: 'javascript', code, output: { x: 1 } } });
// The target: a head, then its own custom_code at stepIndex 1. Nothing else.
const target = () => [
  { id: 's1', type: 'add_contact_tag', name: 'Head', next: 'cc1', order: 0, attributes: { tags: ['a'] } },
  cc('cc1', 'Target code', 1, 'return {a:1}', 's1', null),
];
const copy = (name, stepIndex, code) => ({ type: 'custom_code', name, stepIndex, attributes: { language: 'javascript', code, output: { x: 1 } } });
const stepOutputWarnings = (warnings) => warnings.filter((m) => m.startsWith('step output'));

test('a renumbered copy reference inside the copied insert yields NO step-output warning (the producer is the copy, now at its new index)', () => {
  const warnings = [];
  applyOps(target(), [{ op: 'insertAfter', afterId: 's1', steps: [
    copy('Source one', 1, 'return {x:1}'),
    copy('Source two', 2, 'return {y: "{{custom_code.1.output.x}}"}'),
  ] }], { ctx: ctxWithWarnings(warnings), idGen: makeSeededIdGen('z') });
  assert.deepEqual(stepOutputWarnings(warnings), [], `a correctly renumbered reference was warned about: ${stepOutputWarnings(warnings).join(' | ')}`);
});

test('a fresh step referencing the TARGET\'s own custom_code (stepIndex 1) yields NO step-output warning (the lint sees the target\'s steps)', () => {
  const warnings = [];
  applyOps(target(), [{ op: 'insertAfter', afterId: 's1', steps: [
    { type: 'add_contact_tag', name: 'Reads target code', attributes: { tags: ['{{custom_code.1.output.x}}'] } },
  ] }], { ctx: ctxWithWarnings(warnings), idGen: makeSeededIdGen('z') });
  assert.deepEqual(stepOutputWarnings(warnings), [], `a reference to the target's own step was warned about: ${stepOutputWarnings(warnings).join(' | ')}`);
});

test('CONTROL: a fresh step referencing a custom_code that exists nowhere in the workflow still yields its step-output warning', () => {
  const warnings = [];
  applyOps(target(), [{ op: 'insertAfter', afterId: 's1', steps: [
    { type: 'add_contact_tag', name: 'Reads a missing step', attributes: { tags: ['{{custom_code.7.output.x}}'] } },
  ] }], { ctx: ctxWithWarnings(warnings), idGen: makeSeededIdGen('z') });
  const w = stepOutputWarnings(warnings);
  assert.equal(w.length, 1, `expected the one correct warning, got ${w.length}: ${w.join(' | ')}`);
  assert.match(w[0], /custom_code\.7\.output\.x/);
});
