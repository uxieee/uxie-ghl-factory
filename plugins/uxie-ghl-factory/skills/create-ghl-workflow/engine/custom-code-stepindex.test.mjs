// w6d-5 (plan Task 5, bl-435): a custom_code step copied into another workflow keeps a usable stepIndex. A custom_code's stepIndex is
// the N of its {{custom_code.N.output.*}} merge tags (corpus 40-rules/step-index-numbering.md: per (workflow, type), 1-based). A copied
// step that keeps its source index can collide with the target's own step, and a reference inside the same copy that names the source
// index then resolves to the wrong step. RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from './edit-driver.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('c'), catalog: loadCatalog() });
const cc = (id, name, stepIndex, code, prev, next) => ({ id, type: 'custom_code', name, ...(stepIndex === undefined ? {} : { stepIndex }),
  next, parentKey: prev, order: 0, attributes: { language: 'javascript', code, output: { x: 1 } } });
// The target: a head, then its own custom_code (stepIndex 1). Nothing else.
const target = () => [
  { id: 's1', type: 'add_contact_tag', name: 'Head', next: 'cc1', order: 0, attributes: { tags: ['a'] } },
  cc('cc1', 'Target code', 1, 'return {a:1}', 's1', null),
];
const copy = (name, stepIndex, code) => ({ type: 'custom_code', name, ...(stepIndex === undefined ? {} : { stepIndex }),
  attributes: { language: 'javascript', code, output: { x: 1 } } });
const codesOf = (templates) => templates.filter((t) => t.type === 'custom_code').map((t) => ({ name: t.name, stepIndex: t.stepIndex, code: t.attributes?.code }));

test('a custom_code copied in with its source index gets the next free index for its type (the target keeps its own 1)', () => {
  const { templates } = applyOps(target(), [{ op: 'insertAfter', afterId: 's1', step: copy('Copied', 1, 'return {b:1}') }], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const byName = Object.fromEntries(codesOf(templates).map((c) => [c.name, c.stepIndex]));
  assert.equal(byName['Target code'], 1);
  assert.equal(byName['Copied'], 2);
});

test('a custom_code copied in with NO stepIndex is numbered the next free index (not left null, which renders its tags empty)', () => {
  const { templates } = applyOps(target(), [{ op: 'insertAfter', afterId: 's1', step: copy('Bare', undefined, 'return {b:1}') }], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const bare = codesOf(templates).find((c) => c.name === 'Bare');
  assert.equal(bare.stepIndex, 2);
});

test('{{custom_code.N}} references in the same copied insert are renumbered to the copies\' new indices (RED: the second copy kept the stale 1)', () => {
  // Source: step 1 is 'Copied one' (returns x), step 2 is 'Copied two', whose code reads {{custom_code.1.output.x}} = 'Copied one'.
  const { templates } = applyOps(target(), [{ op: 'insertAfter', afterId: 's1', steps: [
    copy('Copied one', 1, 'return {x:1}'),
    copy('Copied two', 2, 'return {y: "{{custom_code.1.output.x}}"}'),
  ] }], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const by = Object.fromEntries(codesOf(templates).map((c) => [c.name, c]));
  assert.equal(by['Copied one'].stepIndex, 2);
  assert.equal(by['Copied two'].stepIndex, 3);
  assert.ok(by['Copied two'].code.includes('{{custom_code.2.output.x}}'), `reference not renumbered: ${by['Copied two'].code}`);
  assert.ok(!by['Copied two'].code.includes('{{custom_code.1.'), 'the stale index is gone');
});

test('the target\'s own references are NOT renumbered by a copy (only references inside the copied insert move)', () => {
  const t = target();
  t.push({ id: 's2', type: 'add_contact_tag', name: 'Reads target', next: null, parentKey: 'cc1', order: 1, attributes: { tags: ['{{custom_code.1.output.x}}'] } });
  t[1].next = 's2';
  const { templates } = applyOps(t, [{ op: 'insertAfter', afterId: 's1', steps: [
    copy('Copied one', 1, 'return {x:1}'),
  ] }], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const reader = templates.find((x) => x.name === 'Reads target');
  assert.deepEqual(reader.attributes.tags, ['{{custom_code.1.output.x}}'], 'the target keeps its own reference to its own step 1');
});

// w6d-5 QA FAIL #1: the safety rule and the attribute shapes the renumbering must not miss.
test('a source index carried by TWO created steps is ambiguous: a reference to it is left unchanged (not rewritten to the last copy)', () => {
  const { templates } = applyOps(target(), [{ op: 'insertAfter', afterId: 's1', steps: [
    copy('Dup A', 1, 'return {x:1}'),
    copy('Dup B', 1, 'return {w:1}'),
    copy('Reads', 3, 'return {z: "{{custom_code.1.output.x}}"}'),
  ] }], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const reads = codesOf(templates).find((c) => c.name === 'Reads');
  assert.ok(reads.code.includes('{{custom_code.1.output.x}}'), `an ambiguous reference was rewritten: ${reads.code}`);
});

test('a reference inside an OBJECT-valued attribute (inputData) is renumbered', () => {
  const { templates } = applyOps(target(), [{ op: 'insertAfter', afterId: 's1', steps: [
    copy('First', 1, 'return {x:1}'),
    { type: 'custom_code', name: 'Second', stepIndex: 2, attributes: { language: 'javascript', code: 'return {q:1}', output: { q: 1 },
      inputData: { contactId: '{{custom_code.1.output.x}}' } } },
  ] }], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const second = templates.find((t) => t.name === 'Second');
  assert.equal(second.attributes.inputData.contactId, '{{custom_code.2.output.x}}');
});

// custom_code keeps only its known attribute keys (code, language, inputData, output): an array survives only inside inputData, so the
// array sits there. (A top-level array attribute is dropped by the compiler and cannot be a reference site.)
test('a reference inside an ARRAY inside an attribute is renumbered (the array walk)', () => {
  const { templates } = applyOps(target(), [{ op: 'insertAfter', afterId: 's1', steps: [
    copy('First', 1, 'return {x:1}'),
    { type: 'custom_code', name: 'Second', stepIndex: 2, attributes: { language: 'javascript', code: 'return {q:1}', output: { q: 1 },
      inputData: { list: ['{{custom_code.1.output.x}}', 'literal'] } } },
  ] }], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const second = templates.find((t) => t.name === 'Second');
  assert.deepEqual(second.attributes.inputData.list, ['{{custom_code.2.output.x}}', 'literal']);
});

// w6d-8 review #1 (RED first): only COPIED steps are renumbered. A step the edit creates WITHOUT a source index (a fresh step, not a copy) is
// written against the target's own numbering, so its {{custom_code.1.*}} names the target's own step 1 and must not move when a copy
// that carried index 1 is renumbered to 2.
test('a fresh (non-copy) step created in the same insert keeps its reference to the target\'s own step (not renumbered with the copies)', () => {
  const fresh = { type: 'add_contact_tag', name: 'Reads target code', attributes: { tags: ['{{custom_code.1.output.x}}'] } };
  const { templates } = applyOps(target(), [{ op: 'insertAfter', afterId: 's1', steps: [
    copy('Copied', 1, 'return {x:1}'),
    fresh,
  ] }], { ctx: ctx(), idGen: makeSeededIdGen('z') });
  const reads = templates.find((t) => t.name === 'Reads target code');
  assert.deepEqual(reads.attributes.tags, ['{{custom_code.1.output.x}}'], 'the fresh step names the target\'s own step 1; it must not be rewritten to the copy');
  assert.equal(codesOf(templates).find((c) => c.name === 'Copied').stepIndex, 2, 'the copy is still numbered 2');
});
