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

test('empty trigger set does NOT vacuously seed association (add_to_workflow entry carries no opp)', () => {
  fails([], [upd('u1')]);
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

// --- ai_decision walk + branch-level assocGuaranteed (follow-ups from final review)

test('ai_decision: create in one branch does not satisfy a sibling branch or default', () => {
  fails([tagTrigger], [{ ref: 'ai', kind: 'ai_decision', name: 'AI', instructions: 'route', branches: [
    { ref: 'b1', name: 'Buy', then: [crt('c1')] },
    { ref: 'b2', name: 'Browse', then: [upd('u1')] },
  ] }]);
  fails([tagTrigger], [{ ref: 'ai', kind: 'ai_decision', name: 'AI', instructions: 'route', branches: [
    { ref: 'b1', name: 'Buy', then: [crt('c1')] },
  ], default: [upd('u1')] }]);
  check([tagTrigger], [crt('c0'), { ref: 'ai', kind: 'ai_decision', name: 'AI', instructions: 'route', branches: [
    { ref: 'b1', name: 'Buy', then: [upd('u1')] },
  ], default: [upd('u2')] }]);
});

test('compile: branch-level assocGuaranteed never reaches the payload', () => {
  const ir = { name: 'W', triggers: [tagTrigger], graph: [
    { ref: 'b', kind: 'if_else', name: 'B', branches: [
      { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail' }],
        assocGuaranteed: true, then: [upd('u1')] },
      { ref: 'n', name: 'No', else: true, then: [] },
    ] },
  ] };
  const { autoSaveBody } = compile(ir, ctx());
  assert.ok(!JSON.stringify(autoSaveBody).includes('assocGuaranteed'));
});

// --- edit-mode enforcement: template-graph checker + editCommitBody gate.
// Templates are COMPILED shapes (internal_* types, id/next/parentKey wiring),
// not IR — this is the path compile() never sees.
import { checkOpportunityAssociationTemplates, editCommitBody } from './edit.mjs';

const tpl = (id, type, next, parentKey, extra = {}) =>
  ({ id, type, name: id, next, parentKey, order: 0, attributes: {}, ...extra });
const updChain = () => [
  tpl('s1', 'sms', 's2', null),
  tpl('s2', 'internal_update_opportunity', null, 's1'),
];
const findContainer = (foundKids, notFoundKids) => [
  { id: 'f1', type: 'find_opportunity', name: 'Find', next: ['t1', 't2'], parentKey: null, order: 0,
    cat: 'multi-path', attributes: { type: 'find_opportunity', transitions: [
      { id: 't1', name: 'Opportunity Found', conditionType: 'pre-defined' },
      { id: 't2', name: 'Opportunity Not Found', conditionType: 'pre-defined' },
    ] } },
  { id: 't1', type: 'transition', name: 'Opportunity Found', cat: 'transition', parent: 'f1', parentKey: 'f1', order: 0, attributes: {}, next: foundKids[0]?.id ?? null },
  { id: 't2', type: 'transition', name: 'Opportunity Not Found', cat: 'transition', parent: 'f1', parentKey: 'f1', order: 1, attributes: {}, next: notFoundKids[0]?.id ?? null },
  ...foundKids.map((k) => ({ ...k, parent: 't1' })),
  ...notFoundKids.map((k) => ({ ...k, parent: 't2' })),
];

test('templates: bare internal_update_opportunity throws; rootAssoc=true passes', () => {
  assert.throws(() => checkOpportunityAssociationTemplates(updChain(), false), (e) => e.code === 'OPP_UNASSOCIATED');
  checkOpportunityAssociationTemplates(updChain(), true);
});

test('templates: preceding internal_create_opportunity satisfies', () => {
  const t = [tpl('c1', 'internal_create_opportunity', 's2', null), tpl('s2', 'internal_update_opportunity', null, 'c1')];
  checkOpportunityAssociationTemplates(t, false);
});

test('templates: find_opportunity Found scope passes, Not-Found fails', () => {
  checkOpportunityAssociationTemplates(findContainer([tpl('u1', 'internal_update_opportunity', null, 't1')], []), false);
  assert.throws(() => checkOpportunityAssociationTemplates(findContainer([], [tpl('u1', 'internal_update_opportunity', null, 't2')]), false),
    (e) => e.code === 'OPP_UNASSOCIATED');
});

test('editCommitBody: blocks an edit that adds an unassociated opportunity step', () => {
  const t = updChain();
  const diff = { createdSteps: ['s2'], modifiedSteps: ['s1'], deletedSteps: [] };
  assert.throws(() => editCommitBody({ version: 1 }, t, diff, 'UID'), (e) => e.code === 'OPP_UNASSOCIATED');
});

test('editCommitBody: assumeAssociated skips the check (opp-triggered workflow)', () => {
  const t = updChain();
  const diff = { createdSteps: ['s2'], modifiedSteps: ['s1'], deletedSteps: [] };
  const body = editCommitBody({ version: 1 }, t, diff, 'UID', { assumeAssociated: true });
  assert.equal(body.createdSteps[0], 's2');
});

test('editCommitBody: unrelated edit to an already-violating workflow is NOT blocked', () => {
  // workflow already contains a bare update (pre-existing violation) but THIS edit
  // only touches the sms step — the gate must not fire.
  const t = [...updChain(), tpl('s3', 'sms', null, 's2')];
  t[1] = { ...t[1], next: 's3' };
  const diff = { createdSteps: ['s3'], modifiedSteps: ['s2'], deletedSteps: [] };
  const body = editCommitBody({ version: 1 }, t, diff, 'UID');
  assert.equal(body.createdSteps[0], 's3');
});

test('templates: missing head FAILS CLOSED when an opportunity step exists', () => {
  // no step has parentKey null → head unlocatable; an update is present → refuse.
  const t = [tpl('s1', 'sms', 's2', 'ghost'), tpl('s2', 'internal_update_opportunity', null, 's1')];
  assert.throws(() => checkOpportunityAssociationTemplates(t, false), (e) => e.code === 'OPP_UNASSOCIATED');
  // but a headless graph with NO opportunity steps is not our problem — no throw.
  checkOpportunityAssociationTemplates([tpl('s1', 'sms', null, 'ghost')], false);
});

test('templates: Found transition matched by stable __branchKey__ even if renamed/reordered', () => {
  const t = findContainer([], [tpl('u1', 'internal_update_opportunity', null, 't2')]);
  // rename + reorder the transitions; keep the stable meta key on the real Found
  t[0].attributes.transitions = [
    { id: 't2', name: 'Kein Treffer', conditionType: 'pre-defined' },
    { id: 't1', name: 'Treffer', conditionType: 'pre-defined', meta: { __branchKey__: 'predefined_Opportunity Found' } },
  ];
  // u1 sits in the NOT-found scope (t2) — must still fail despite t2 being listed first
  assert.throws(() => checkOpportunityAssociationTemplates(t, false), (e) => e.code === 'OPP_UNASSOCIATED');
  // and an update in the true Found scope (t1) passes
  const ok = findContainer([tpl('u1', 'internal_update_opportunity', null, 't1')], []);
  ok[0].attributes.transitions = [
    { id: 't2', name: 'Kein Treffer', conditionType: 'pre-defined' },
    { id: 't1', name: 'Treffer', conditionType: 'pre-defined', meta: { __branchKey__: 'predefined_Opportunity Found' } },
  ];
  checkOpportunityAssociationTemplates(ok, false);
});
