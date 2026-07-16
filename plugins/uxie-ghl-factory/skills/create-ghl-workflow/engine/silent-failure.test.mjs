// Regression suite for the SILENT-failure class: shapes that compiled, published and
// round-tripped "clean" while doing nothing (or the wrong thing) at runtime. Every case
// here was found the hard way on a live account 2026-07-16. The rule these encode:
// the engine must never discard authored intent, and must never emit a structurally
// empty step. When it can't honour what was authored, it FAILS LOUD at compile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog() });
const tagTrigger = { ref: 't', type: 'contact_tag', name: 'T', filters: [] };
const wf = (graph, triggers = [tagTrigger]) => ({ name: 'WF', triggers, graph });
const build = (graph, triggers) => compile(wf(graph, triggers), ctx());
const templatesOf = (graph, triggers) => build(graph, triggers).autoSaveBody.workflowData.templates;
const throws = (graph, code, triggers) =>
  assert.throws(() => build(graph, triggers), (e) => e.name === 'IRError' && e.code === code,
    `expected IRError ${code}`);

// ─── Item 1: find_opportunity authored with kind: (no type:) dropped onFound ──────────
// The compiler gated the container on n.type === 'find_opportunity'; a node authored as
// { kind:'find_opportunity' } fell through to the linear path, so the ENTIRE onFound
// subtree was discarded and the build reported a clean round-trip for a fraction of the IR.
test('kind:find_opportunity is accepted as an alias and keeps its onFound subtree', () => {
  const t = templatesOf([{
    ref: 'f', kind: 'find_opportunity', name: 'F',
    find: { filters: [{ field: 'pipeline_id', value: 'PID' }], sorting: 'latest' },
    onFound: [
      { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['x'] } },
      { ref: 'b', kind: 'action', type: 'add_contact_tag', name: 'B', attributes: { tags: ['y'] } },
    ],
    onNotFound: [{ ref: 'c', kind: 'action', type: 'add_contact_tag', name: 'C', attributes: { tags: ['z'] } }],
  }]);
  const byType = t.map((x) => x.type);
  assert.equal(byType.filter((x) => x === 'find_opportunity').length, 1, 'container emitted');
  assert.equal(byType.filter((x) => x === 'add_contact_tag').length, 3, 'all 3 children survive');
  assert.equal(byType.filter((x) => x === 'transition').length, 2, 'Found/Not-Found transitions');
});

test('kind:find_contact and kind:lc_merge_contact are accepted as aliases too', () => {
  for (const kind of ['find_contact', 'lc_merge_contact']) {
    const t = templatesOf([{
      ref: 'f', kind, name: 'F',
      onFound: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['x'] } }],
      onNotFound: [],
    }]);
    assert.equal(t.filter((x) => x.type === kind).length, 1, `${kind} container emitted`);
    assert.equal(t.filter((x) => x.type === 'add_contact_tag').length, 1, `${kind} child survives`);
  }
});

// ─── Cross-cutting A: every authored node must reach the built payload ───────────────
// The backstop that would have caught item 1 on its own. Round-trip verification only
// proved that what was SENT came back — never that what was AUTHORED was sent.
test('compile reports the authored node count alongside the compiled count', () => {
  const built = build([
    { ref: 'f', kind: 'find_opportunity', name: 'F', onFound: [
      { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['x'] } }], onNotFound: [] },
  ]);
  // 2 authored nodes (the container + its child); the compiler additionally emits the
  // two pre-defined transition steps, so compiled > authored is expected and fine.
  assert.equal(built.authored, 2);
  assert.ok(built.compiled >= built.authored);
});

test('a dropped authored node fails the build loudly (NODE_DROPPED)', () => {
  // `branches` on a node the flattener routes to the LINEAR path: the branch children are
  // never walked. This is item 1's exact failure mode reproduced through a different door,
  // and it proves NODE_DROPPED is reachable rather than dead backstop code.
  throws([{
    ref: 'x', kind: 'action', type: 'add_contact_tag', name: 'X', attributes: { tags: ['t'] },
    branches: [{ ref: 'b', name: 'B', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'tags', tag: 'y' }],
      then: [{ ref: 'dropped', kind: 'action', type: 'add_contact_tag', name: 'D', attributes: { tags: ['z'] } }] }],
  }], 'NODE_DROPPED');
});

test('NODE_DROPPED names the node that vanished', () => {
  assert.throws(() => build([{
    ref: 'x', kind: 'action', type: 'add_contact_tag', name: 'X', attributes: { tags: ['t'] },
    branches: [{ ref: 'b', name: 'B', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'tags', tag: 'y' }],
      then: [{ ref: 'ghost', kind: 'action', type: 'add_contact_tag', name: 'D', attributes: { tags: ['z'] } }] }],
  }]), /ghost/);
});

// Defense in depth: even if the item-1 alias were removed, the drop cannot go quiet.
test('a container scope whose subtree is unreachable can never build silently', () => {
  // find_opportunity with NO scope handler match (type absent, alias disabled) must fail
  // one of the two guards — never compile to a partial workflow.
  assert.throws(() => build([{
    ref: 'f', kind: 'action', type: 'add_contact_tag', name: 'F', attributes: { tags: ['t'] },
    onFound: [{ ref: 'lost', kind: 'action', type: 'add_contact_tag', name: 'L', attributes: { tags: ['x'] } }],
  }]), (e) => e.name === 'IRError' && ['NODE_KEY', 'NODE_DROPPED'].includes(e.code));
});

// ─── Item 2: time wait built an EMPTY startAfter → fired INSTANTLY ───────────────────
// The single most dangerous bug in the set: 4 messages blasted at a live customer in 6
// seconds instead of over 6 days. waitAttributes only read node.config; an author
// mirroring the live blob shape (attributes.startAfter) got startAfter:{} and no window.
test('wait authored via attributes.startAfter compiles to a real startAfter + window', () => {
  const t = templatesOf([{
    ref: 'w', kind: 'wait', name: 'W',
    attributes: {
      type: 'time',
      startAfter: { type: 'days', value: 1, when: 'after' },
      window: { condition: 'when', days: [0, 1, 2, 3, 4, 5, 6], start: '07:00', end: '18:00' },
    },
  }]);
  assert.deepEqual(t[0].attributes.startAfter, { type: 'days', value: 1, when: 'after' });
  assert.equal(t[0].attributes.window.start, '07:00');
  assert.equal(t[0].attributes.window.end, '18:00');
});

test('wait authored via node.config still works (canonical shape unchanged)', () => {
  const t = templatesOf([{
    ref: 'w', kind: 'wait', name: 'W',
    config: { unit: 'days', value: 1, when: 'after' },
    window: { condition: 'when', days: [1, 2], start: '07:00', end: '18:00' },
  }]);
  assert.deepEqual(t[0].attributes.startAfter, { type: 'days', value: 1, when: 'after' });
  assert.equal(t[0].attributes.window.condition, 'when');
});

test('a time wait with NO duration anywhere is rejected, never emitted empty', () => {
  throws([{ ref: 'w', kind: 'wait', name: 'W' }], 'EMPTY_STEP');
  throws([{ ref: 'w', kind: 'wait', name: 'W', attributes: { type: 'time' } }], 'EMPTY_STEP');
});

test('a time wait with an INCOMPLETE duration is rejected (partial startAfter never ships)', () => {
  throws([{ ref: 'w', kind: 'wait', name: 'W', config: { unit: 'days' } }], 'EMPTY_STEP');
  throws([{ ref: 'w', kind: 'wait', name: 'W', attributes: { type: 'time', startAfter: { type: 'days' } } }], 'EMPTY_STEP');
});

// The appointment-anchored wait (live-verified, workflow 07e) must keep passing through.
test('appointment-anchored wait passes its subtype fields through', () => {
  const t = templatesOf([{
    ref: 'w', kind: 'wait', name: 'W',
    attributes: {
      type: 'appointment',
      appointmentStartAfter: { when: 'before', type: 'hours', value: 24, distributed: {} },
      appointmentCondition: 'appointment',
    },
  }]);
  assert.equal(t[0].attributes.type, 'appointment');
  assert.deepEqual(t[0].attributes.appointmentStartAfter, { when: 'before', type: 'hours', value: 24, distributed: {} });
  assert.equal(t[0].attributes.appointmentCondition, 'appointment');
});

// ─── Item 3: update_opportunity ignored the resolved pipeline/stage → EMPTY step ──────
// resolve.mjs already resolves attributes.pipeline/stage NAMES into pipelineId/stageId,
// but updateOpportunityAttributes only ever read attributes.updates — so the documented
// name-authoring path compiled to __customInputFields__: [] and no-op'd at runtime.
test('update_opportunity builds fields from resolved pipelineId/stageId', () => {
  const t = templatesOf([{
    ref: 'u', kind: 'action', type: 'update_opportunity', name: 'U',
    assocGuaranteed: true,
    attributes: { pipeline: 'P', pipelineId: 'PID', stage: 'S', stageId: 'SID', allowBackward: true },
  }]);
  const f = t[0].attributes.__customInputFields__;
  const byField = Object.fromEntries(f.map((x) => [x.filterField, x.value]));
  assert.equal(byField.pipelineId, 'PID');
  assert.equal(byField.pipelineStageId, 'SID');
  assert.equal(t[0].attributes.allowBackward, true);
});

test('update_opportunity still honours an explicit updates[] (canonical shape unchanged)', () => {
  const t = templatesOf([{
    ref: 'u', kind: 'action', type: 'update_opportunity', name: 'U', assocGuaranteed: true,
    attributes: { allowBackward: true, updates: [{ field: 'pipelineStageId', value: 'SID' }] },
  }]);
  const f = t[0].attributes.__customInputFields__;
  assert.equal(f.length, 1);
  assert.equal(f[0].filterField, 'pipelineStageId');
  assert.equal(f[0].value, 'SID');
});

test('update_opportunity with nothing to update is rejected, never emitted empty', () => {
  throws([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'U', assocGuaranteed: true, attributes: {} }], 'EMPTY_STEP');
  throws([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'U', assocGuaranteed: true, attributes: { updates: [] } }], 'EMPTY_STEP');
});

// ─── Item 4: a BACKWARD stage move is silently [skipped] unless allowBackward:true ────
// Not statically decidable (we can't know the contact's current stage), so the engine
// can't fail on it — but an unresolved-stage move that regresses is the single most
// common live symptom. The default must at least be explicit and documented.
test('update_opportunity allowBackward defaults to false and is honoured when set', () => {
  const off = templatesOf([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'U', assocGuaranteed: true,
    attributes: { updates: [{ field: 'pipelineStageId', value: 'SID' }] } }]);
  assert.equal(off[0].attributes.allowBackward, false);
  const on = templatesOf([{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'U', assocGuaranteed: true,
    attributes: { allowBackward: true, updates: [{ field: 'pipelineStageId', value: 'SID' }] } }]);
  assert.equal(on[0].attributes.allowBackward, true);
});

// ─── Cross-cutting B: unknown NODE-level keys are author intent being discarded ───────
// Attribute keys were already linted (ATTR_KEY); node-level keys were not. `onFound` on a
// node with no container handler, or a typo'd `attribute:`, silently vanished.
test('an unknown node-level key is rejected (NODE_KEY)', () => {
  throws([{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attribute: { tags: ['x'] } }], 'NODE_KEY');
});

test('a scope key on a node type that has no container handler is rejected (NODE_KEY)', () => {
  throws([{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['x'] },
    onFound: [{ ref: 'b', kind: 'action', type: 'add_contact_tag', name: 'B', attributes: { tags: ['y'] } }] }], 'NODE_KEY');
});

test('known node-level keys on their proper containers still pass', () => {
  assert.doesNotThrow(() => templatesOf([{
    ref: 'i', kind: 'if_else', name: 'I',
    branches: [
      { ref: 'b1', name: 'Yes', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'tags', tag: 'x' }],
        then: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['q'] } }] },
      { ref: 'b2', name: 'None', else: true, then: [] },
    ],
  }]));
});
