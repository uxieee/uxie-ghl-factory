import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { analyzeRun, buildRuntimeIR, probeConditions } from './runtime-test.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog() });

// The runtime bug (root-caused 2026-07-15): a malformed if_else made the step BEFORE the
// container terminal, so the contact hit end_of_workflow AT THE WAIT and never reached the
// tag. The tag-shape bug (follow-up): a QUALIFYING contact mis-routed to the None branch.
// These fixtures mirror the /workflows/logs/v2 traces that distinguish the outcomes.
// Log rows are newest-first, as the endpoint returns them. The probe now tags the Match and
// None branches DIFFERENTLY (step names 'Reached (Match)' / 'Reached (None)').

const reachedMatchTrace = [
  { stepId: 'tag1', stepName: 'Reached (Match)', type: 'add_contact_tag', status: 'success', sequence: 4, contactId: 'C1', meta: {} },
  { stepId: 'cond', stepName: 'Probe condition', type: 'condition', status: 'success', sequence: 3, contactId: 'C1', meta: { isQualified: true } },
  { stepId: 'wait', stepName: 'Wait 1 min', type: 'wait_finished', status: 'wait_finished', sequence: 2, contactId: 'C1', meta: {} },
  { stepId: 'wait', stepName: 'Wait 1 min', type: 'wait_time', status: 'waiting', sequence: 1, contactId: 'C1', meta: {} },
  { stepId: null, stepName: null, type: 'added_to_workflow', status: 'added_to_workflow', sequence: 0, contactId: 'C1', meta: {} },
];

// The tag-shape bug: a qualifying contact reaches the NONE branch (condition mis-matched).
const reachedNoneTrace = [
  { stepId: 'tag2', stepName: 'Reached (None)', type: 'add_contact_tag', status: 'success', sequence: 4, contactId: 'C1', meta: {} },
  { stepId: 'cond', stepName: 'Probe condition', type: 'condition', status: 'success', sequence: 3, contactId: 'C1', meta: { isQualified: false } },
  { stepId: 'wait', stepName: 'Wait 1 min', type: 'wait_finished', status: 'wait_finished', sequence: 2, contactId: 'C1', meta: {} },
  { stepId: null, stepName: null, type: 'added_to_workflow', status: 'added_to_workflow', sequence: 0, contactId: 'C1', meta: {} },
];

// The graph bug: contact removed at the wait via end_of_workflow; no condition/tag rows appear.
const stuckAtWaitTrace = [
  { stepId: 'wait', stepName: 'Wait 1 min', type: 'wait_time', status: 'waiting', sequence: 1, contactId: 'C1', meta: { removedFrom: { type: 'end_of_workflow' } } },
  { stepId: null, stepName: null, type: 'added_to_workflow', status: 'added_to_workflow', sequence: 0, contactId: 'C1', meta: {} },
];

// Still mid-flight: reached the wait, not yet resumed — no terminal verdict.
const inProgressTrace = [
  { stepId: 'wait', stepName: 'Wait 1 min', type: 'wait_time', status: 'waiting', sequence: 1, contactId: 'C1', meta: {}, nextExecutionAt: '2026-07-15T00:01:00Z' },
  { stepId: null, stepName: null, type: 'added_to_workflow', status: 'added_to_workflow', sequence: 0, contactId: 'C1', meta: {} },
];

test('analyzeRun: PASS when the contact reaches the MATCH-branch tag', () => {
  const r = analyzeRun(reachedMatchTrace, { contactId: 'C1' });
  assert.equal(r.reachedMatch, true);
  assert.equal(r.stuckAtWait, false);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.lastStep.type, 'add_contact_tag');
});

test('analyzeRun: WRONG-BRANCH when a qualifying contact reaches the NONE-branch tag (the tag-shape bug)', () => {
  const r = analyzeRun(reachedNoneTrace, { contactId: 'C1' });
  assert.equal(r.reachedMatch, false);
  assert.equal(r.reachedNone, true);
  assert.equal(r.verdict, 'wrong-branch');
  assert.match(r.reason, /mis-routed|mis-match|NONE branch/i);
});

test('analyzeRun: FAIL when the contact hits end_of_workflow at the wait (the graph bug)', () => {
  const r = analyzeRun(stuckAtWaitTrace, { contactId: 'C1' });
  assert.equal(r.reachedTag, false);
  assert.equal(r.stuckAtWait, true);
  assert.equal(r.verdict, 'fail');
  assert.match(r.reason, /end_of_workflow/);
});

test('analyzeRun: PENDING while the wait is still pending', () => {
  const r = analyzeRun(inProgressTrace, { contactId: 'C1' });
  assert.equal(r.reachedTag, false);
  assert.equal(r.stuckAtWait, false);
  assert.equal(r.verdict, 'pending');
});

test('analyzeRun: filters rows to the target contact', () => {
  const mixed = [...reachedMatchTrace.map((r) => ({ ...r, contactId: 'OTHER' })), ...stuckAtWaitTrace];
  const r = analyzeRun(mixed, { contactId: 'C1' });
  assert.equal(r.verdict, 'fail'); // only C1's (stuck) rows count
});

test('analyzeRun: back-compat — any tag counts as PASS when branch step names are not supplied', () => {
  const trace = [{ stepId: 't', stepName: 'Add Tag', type: 'add_contact_tag', status: 'success', sequence: 1, contactId: 'C1', meta: {} }];
  const r = analyzeRun(trace, { contactId: 'C1', matchStepName: undefined, noneStepName: undefined });
  assert.equal(r.verdict, 'pass');
});

test('buildRuntimeIR: trigger → wait 1min → if_else → distinct tag per branch', () => {
  const ir = buildRuntimeIR({ triggerTag: 'rt-trigger', condition: probeConditions.customField('FIELD1', 'yes') });
  assert.equal(ir.triggers[0].type, 'contact_tag');
  const [wait, cond] = ir.graph;
  assert.equal(wait.kind, 'wait');
  assert.equal(wait.config.unit, 'minutes');
  assert.equal(wait.config.value, 1);
  assert.equal(cond.kind, 'if_else');
  // Match and None branches must add DIFFERENT tags — this is what lets the log reveal routing
  const matchTags = cond.branches.find((b) => b.name === 'Match').then.filter((s) => s.type === 'add_contact_tag');
  const noneTags = cond.branches.find((b) => b.name === 'None').then.filter((s) => s.type === 'add_contact_tag');
  assert.equal(matchTags.length, 1);
  assert.equal(noneTags.length, 1);
  assert.notDeepEqual(matchTags[0].attributes.tags, noneTags[0].attributes.tags);
});

// The three probe kinds each compile to the CORRECT stored condition shape (this is the
// whole point — the custom-field-only probe could not catch the tag/stage mis-shape).
test('probe: TAG condition compiles to tags/index-of-true/ARRAY', () => {
  const ir = buildRuntimeIR({ triggerTag: 'rt', condition: probeConditions.tag('vip') });
  const { autoSaveBody } = compile(ir, ctx());
  const container = autoSaveBody.workflowData.templates.find((s) => s.name === 'Probe condition');
  const cond = container.attributes.branches[0].segments[0].conditions[0];
  assert.equal(cond.conditionSubType, 'tags');
  assert.equal(cond.conditionOperator, 'index-of-true');
  assert.deepEqual(cond.conditionValue, ['vip']);
});

test('probe: OPPORTUNITY-STAGE condition compiles to pipelineStageId/==/string', () => {
  const ir = buildRuntimeIR({ triggerTag: 'rt', condition: probeConditions.oppStage('STAGE_1') });
  const { autoSaveBody } = compile(ir, ctx());
  const container = autoSaveBody.workflowData.templates.find((s) => s.name === 'Probe condition');
  const cond = container.attributes.branches[0].segments[0].conditions[0];
  assert.equal(cond.conditionType, 'opportunities');
  assert.equal(cond.conditionSubType, 'pipelineStageId');
  assert.equal(cond.conditionOperator, '==');
  assert.equal(cond.conditionValue, 'STAGE_1');
});

test('probe: CUSTOM-FIELD condition compiles to contain + lowercased value', () => {
  const ir = buildRuntimeIR({ triggerTag: 'rt', condition: probeConditions.customField('FIELD1', 'Yes') });
  const { autoSaveBody } = compile(ir, ctx());
  const container = autoSaveBody.workflowData.templates.find((s) => s.name === 'Probe condition');
  const cond = container.attributes.branches[0].segments[0].conditions[0];
  assert.equal(cond.conditionOperator, 'contain');
  assert.equal(cond.conditionValue, 'yes');
});
