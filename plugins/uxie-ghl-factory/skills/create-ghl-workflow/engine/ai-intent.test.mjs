// ai_intent — GHL's workflow_ai_intent_detection, which the builder stores ONLY as a three-way container. The expected shape is
// the builder's own, captured from its in-memory document under a write guard on 2026-09-28 (knowledge
// sniffs/workflows-wave1-2026-09-25/live-3CB-intent-builder-specimen.json); ids are replaced by role names below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { multipathDefects } from './document-gate.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('ai'), catalog: loadCatalog() });
const tag = (ref, t) => ({ ref, kind: 'action', type: 'add_contact_tag', name: `Tag ${t}`, attributes: { tags: [t] } });
const build = (node) => compile({ name: 'x', triggers: [], graph: [node] }, ctx())._templates;
const intent = (o = {}) => ({ ref: 'i', kind: 'ai_intent', name: 'AI intent detection', inputText: 'John is a very good person', ...o });

// The builder's container and transitions (3CB), ids → C (container), P / N / O (Positive / Negative / None lanes).
const BUILDER = {
  step: { id: 'C', type: 'workflow_ai_intent_detection', name: 'AI intent detection', order: 0, cat: 'multi-path', workflowsActionType: 'INTERNAL', next: ['P', 'N', 'O'],
    attributes: { inputText: 'John is a very good person', type: 'workflow_ai_intent_detection', __customInputs__: {}, cat: 'multi-path', convertToMultipath: true, __name__: 'AI intent detection',
      transitions: [
        { id: 'P', name: 'Positive', fields: { branchKey: 'POSITIVE' }, meta: { __branchKey__: 'predefined_Positive' }, conditionType: 'pre-defined' },
        { id: 'N', name: 'Negative', fields: { branchKey: 'NEGATIVE' }, meta: { __branchKey__: 'predefined_Negative' }, conditionType: 'pre-defined' },
        { id: 'O', name: 'None', fields: { branchKey: 'NONE' }, meta: { __branchKey__: 'predefined_None' }, conditionType: 'pre-defined' }] } },
  transitions: [
    { id: 'P', parentKey: 'C', parent: 'C', type: 'transition', name: 'Positive', attributes: {}, order: 1, cat: 'transition', next: '<chain>' },
    { id: 'N', parentKey: 'C', parent: 'C', type: 'transition', name: 'Negative', attributes: {}, order: 1, cat: 'transition' },
    { id: 'O', parentKey: 'C', parent: 'C', type: 'transition', name: 'None', attributes: {}, order: 1, cat: 'transition' }],
};
const roles = (T) => {
  const c = T.find((t) => t.type === 'workflow_ai_intent_detection');
  const m = new Map([[c.id, 'C'], ...c.next.map((x, k) => [x, ['P', 'N', 'O'][k]])]);
  const r = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' && m.has(v) ? m.get(v) : v)));
  const step = r(c); delete step.parentKey;
  return { step, transitions: T.filter((t) => t.parentKey === c.id).map((t) => { const x = r(t); if ('next' in x) x.next = '<chain>'; return x; }) };
};

test('compiles to the BUILDER\'s own shape (3CB capture), structurally equal apart from ids', () => {
  assert.deepEqual(roles(build(intent({ branches: [{ name: 'positive', then: [tag('t', 'p')] }] }))), BUILDER);
});

test('each named lane carries its own chain; an omitted lane is an empty lane (no next), as the builder leaves it', () => {
  const T = build(intent({ branches: [{ name: 'Negative', then: [tag('n', 'neg')] }, { name: 'none', then: [tag('o', 'none')] }] }));
  const c = T.find((t) => t.type === 'workflow_ai_intent_detection');
  const [p, n, o] = c.next.map((id) => T.find((t) => t.id === id));
  assert.equal(p.next, undefined, 'positive omitted → empty lane');
  assert.equal(T.find((t) => t.id === n.next).attributes.tags[0], 'neg');
  assert.equal(T.find((t) => t.id === o.next).attributes.tags[0], 'none');
});

test('the WIRE type is inferred to the container (differential: it used to compile as a straight line)', () => {
  const T = build({ ref: 'i', kind: 'action', marketplace: true, type: 'workflow_ai_intent_detection', name: 'Intent', attributes: { inputText: 'I love it' } });
  const c = T.find((t) => t.type === 'workflow_ai_intent_detection');
  assert.ok(Array.isArray(c.next) && c.next.length === 3, 'three lanes');
  assert.equal(c.attributes.inputText, 'I love it');
  assert.deepEqual(multipathDefects(c, new Map(T.map((t) => [t.id, t]))), []);
  // control: the straight-line shape the old path produced is flagged by the document gate
  const linear = { id: 'L', type: 'workflow_ai_intent_detection', next: null, attributes: { inputText: 'x' } };
  assert.ok(multipathDefects(linear, new Map([['L', linear]])).length > 0, 'a linear intent step is a defect');
});

test('branch names are FIXED: an unknown or repeated name is refused by name; inputText must be non-empty', () => {
  assert.throws(() => build(intent({ branches: [{ name: 'Happy', then: [] }] })), (e) => e.code === 'AI_INTENT_BRANCH' && /"Happy"/.test(e.message) && /positive, negative, none/.test(e.message));
  assert.throws(() => build(intent({ branches: [{ name: 'positive' }, { name: 'POSITIVE' }] })), (e) => e.code === 'AI_INTENT_BRANCH' && /twice/.test(e.message));
  assert.throws(() => build(intent({ branches: [{ name: 'none', description: 'x' }] })), (e) => e.code === 'BRANCH_KEY');
  assert.throws(() => build(intent({ inputText: '  ' })), (e) => e.code === 'AI_INTENT_INPUT');
});

test('it is a container: a step authored after it in the same list is refused (CONTAINER_NOT_LAST)', () => {
  assert.throws(() => compile({ name: 'x', triggers: [], graph: [intent(), tag('after', 'a')] }, ctx()), (e) => e.code === 'CONTAINER_NOT_LAST');
});
