import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIR, IRError, checkOpportunityAssociation } from './ir.mjs';

// The 5 catalog category==='opportunities' triggers (hard-coded HERE only;
// shipped code derives this set from the catalog — see compiler.mjs).
const OPP_TRIGGERS = new Set(['opportunity_created', 'opportunity_status_changed',
  'opportunity_changed', 'pipeline_stage_updated', 'opportunity_decay']);

const tagTrigger = { ref: 't1', type: 'contact_tag', name: 'Tag', filters: [] };
const oppTrigger = { ref: 't2', type: 'opportunity_created', name: 'Opp', filters: [] };
const upd = (ref, extra = {}) => ({ ref, kind: 'action', type: 'update_opportunity', name: 'Upd',
  attributes: { updates: [{ field: 'status', value: 'won' }] }, ...extra });
const crt = (ref) => ({ ref, kind: 'action', type: 'create_opportunity', name: 'Create',
  attributes: { pipelineId: 'P', stageId: 'S' } });
const check = (triggers, graph) =>
  checkOpportunityAssociation(parseIR({ name: 'W', triggers, graph }), OPP_TRIGGERS);
const fails = (triggers, graph) =>
  assert.throws(() => check(triggers, graph),
    (e) => e instanceof IRError && e.code === 'OPP_UNASSOCIATED');

test('bare update with non-opp trigger rejected', () => {
  fails([tagTrigger], [upd('u1')]);
});

test('error message names the ref and the fixes', () => {
  try { check([tagTrigger], [upd('u1')]); assert.fail('should throw'); }
  catch (e) {
    assert.match(e.message, /'u1'/);
    assert.match(e.message, /find_opportunity/);
    assert.match(e.message, /create_opportunity/);
    assert.match(e.message, /assocGuaranteed/);
  }
});

test('create then update in same scope passes', () => {
  check([tagTrigger], [crt('c1'), upd('u1')]);
});

test('create satisfies later siblings and their child scopes', () => {
  check([tagTrigger], [crt('c1'), { ref: 'b', kind: 'if_else', name: 'B', branches: [
    { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail' }], then: [upd('u1')] },
    { ref: 'n', name: 'No', else: true, then: [] },
  ] }]);
});

test('update inside find_opportunity Found branch passes', () => {
  check([tagTrigger], [{ ref: 'f', kind: 'action', type: 'find_opportunity', name: 'Find',
    find: { filters: [] }, onFound: [upd('u1')], onNotFound: [] }]);
});

test('update inside Not-Found branch rejected; create before it passes', () => {
  fails([tagTrigger], [{ ref: 'f', kind: 'action', type: 'find_opportunity', name: 'Find',
    find: { filters: [] }, onFound: [], onNotFound: [upd('u1')] }]);
  check([tagTrigger], [{ ref: 'f', kind: 'action', type: 'find_opportunity', name: 'Find',
    find: { filters: [] }, onFound: [], onNotFound: [crt('c1'), upd('u1')] }]);
});

test('all-opp triggers seed root as associated', () => {
  check([oppTrigger], [upd('u1')]);
  check([oppTrigger, { ...oppTrigger, ref: 't3', type: 'pipeline_stage_updated' }], [upd('u1')]);
});

test('mixed triggers do NOT seed root', () => {
  fails([oppTrigger, tagTrigger], [upd('u1')]);
});

test('create in one if branch does not satisfy a sibling branch or later siblings', () => {
  fails([tagTrigger], [{ ref: 'b', kind: 'if_else', name: 'B', branches: [
    { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail' }], then: [crt('c1')] },
    { ref: 'n', name: 'No', else: true, then: [upd('u1')] },
  ] }]);
  fails([tagTrigger], [{ ref: 'b', kind: 'if_else', name: 'B', branches: [
    { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail' }], then: [crt('c1')] },
    { ref: 'n', name: 'No', else: true, then: [] },
  ] }, upd('u1')]);
});

test('assocGuaranteed on the node passes', () => {
  check([tagTrigger], [upd('u1', { assocGuaranteed: true })]);
});

test('assocGuaranteed on a branch scope seeds that scope only', () => {
  check([tagTrigger], [{ ref: 'b', kind: 'if_else', name: 'B', branches: [
    { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail' }],
      assocGuaranteed: true, then: [upd('u1')] },
    { ref: 'n', name: 'No', else: true, then: [] },
  ] }]);
  fails([tagTrigger], [{ ref: 'b', kind: 'if_else', name: 'B', branches: [
    { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail' }],
      assocGuaranteed: true, then: [] },
    { ref: 'n', name: 'No', else: true, then: [upd('u1')] },
  ] }]);
});

test('multipath wait and split scopes inherit incoming state independently', () => {
  fails([tagTrigger], [{ ref: 'w', kind: 'wait', name: 'W', waitType: 'reply',
    reply: { steps: [], labels: ['sms'] }, timeout: { unit: 'days', value: 1 },
    onEvent: [upd('u1')], onTimeout: [] }]);
  check([tagTrigger], [crt('c1'), { ref: 's', kind: 'split', name: 'S', mode: 'random', paths: [
    { ref: 'p1', name: 'A', then: [upd('u1')] },
    { ref: 'p2', name: 'B', then: [] },
  ] }]);
});

test('raw internal_update_opportunity type is also enforced', () => {
  fails([tagTrigger], [{ ref: 'u1', kind: 'raw', type: 'internal_update_opportunity',
    name: 'Upd', attributes: {} }]);
});

// --- compile() integration: the compiler derives the opp-trigger set from the
// catalog (category === 'opportunities') and enforces the invariant itself.
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27,
  idGen: makeSeededIdGen('a'), catalog: loadCatalog() });

test('compile: bare update with tag trigger throws OPP_UNASSOCIATED', () => {
  const ir = { name: 'W', triggers: [tagTrigger], graph: [upd('u1')] };
  assert.throws(() => compile(ir, ctx()), (e) => e.code === 'OPP_UNASSOCIATED');
});

test('compile: opp-triggered bare update compiles', () => {
  const ir = { name: 'W', triggers: [oppTrigger], graph: [upd('u1')] };
  const { autoSaveBody } = compile(ir, ctx());
  assert.equal(autoSaveBody.workflowData.templates[0].type, 'internal_update_opportunity');
});

test('compile: find-or-create recipe compiles and assocGuaranteed never reaches the payload', () => {
  const ir = { name: 'W', triggers: [tagTrigger], graph: [
    { ref: 'f', kind: 'action', type: 'find_opportunity', name: 'Find', find: { filters: [] },
      onFound: [upd('u1', { assocGuaranteed: true })],
      onNotFound: [crt('c1'), { ref: 'g', kind: 'goto', target: 'u1' }] },
  ] };
  const { autoSaveBody } = compile(ir, ctx());
  assert.ok(!JSON.stringify(autoSaveBody).includes('assocGuaranteed'));
});
