import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRun, buildRuntimeIR } from './runtime-test.mjs';

// The runtime bug (root-caused 2026-07-15): a malformed if_else made the step BEFORE the
// container terminal, so the contact hit end_of_workflow AT THE WAIT and never reached the
// tag. These fixtures mirror the two /workflows/logs/v2 traces that distinguish pass vs bug.
// Log rows are newest-first, as the endpoint returns them.

const reachedTagTrace = [
  { stepId: 'tag1', stepName: 'Add Tag', type: 'add_contact_tag', status: 'success', sequence: 4, contactId: 'C1', meta: {} },
  { stepId: 'cond', stepName: 'Check field', type: 'condition', status: 'success', sequence: 3, contactId: 'C1', meta: { isQualified: true } },
  { stepId: 'wait', stepName: 'Wait 1 min', type: 'wait_finished', status: 'wait_finished', sequence: 2, contactId: 'C1', meta: {} },
  { stepId: 'wait', stepName: 'Wait 1 min', type: 'wait_time', status: 'waiting', sequence: 1, contactId: 'C1', meta: {} },
  { stepId: null, stepName: null, type: 'added_to_workflow', status: 'added_to_workflow', sequence: 0, contactId: 'C1', meta: {} },
];

// The bug: contact removed at the wait via end_of_workflow; no condition/tag rows ever appear.
const stuckAtWaitTrace = [
  { stepId: 'wait', stepName: 'Wait 1 min', type: 'wait_time', status: 'waiting', sequence: 1, contactId: 'C1', meta: { removedFrom: { type: 'end_of_workflow' } } },
  { stepId: null, stepName: null, type: 'added_to_workflow', status: 'added_to_workflow', sequence: 0, contactId: 'C1', meta: {} },
];

// Still mid-flight: reached the wait, not yet resumed — neither pass nor the bug.
const inProgressTrace = [
  { stepId: 'wait', stepName: 'Wait 1 min', type: 'wait_time', status: 'waiting', sequence: 1, contactId: 'C1', meta: {}, nextExecutionAt: '2026-07-15T00:01:00Z' },
  { stepId: null, stepName: null, type: 'added_to_workflow', status: 'added_to_workflow', sequence: 0, contactId: 'C1', meta: {} },
];

test('analyzeRun: PASS when the contact reaches the add_contact_tag step', () => {
  const r = analyzeRun(reachedTagTrace, { contactId: 'C1' });
  assert.equal(r.reachedTag, true);
  assert.equal(r.stuckAtWait, false);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.lastStep.type, 'add_contact_tag');
});

test('analyzeRun: FAIL when the contact hits end_of_workflow at the wait (the bug)', () => {
  const r = analyzeRun(stuckAtWaitTrace, { contactId: 'C1' });
  assert.equal(r.reachedTag, false);
  assert.equal(r.stuckAtWait, true);
  assert.equal(r.verdict, 'fail');
  assert.match(r.reason, /end_of_workflow/);
});

test('analyzeRun: INCONCLUSIVE while the wait is still pending', () => {
  const r = analyzeRun(inProgressTrace, { contactId: 'C1' });
  assert.equal(r.reachedTag, false);
  assert.equal(r.stuckAtWait, false);
  assert.equal(r.verdict, 'pending');
});

test('analyzeRun: filters rows to the target contact', () => {
  const mixed = [...reachedTagTrace.map((r) => ({ ...r, contactId: 'OTHER' })), ...stuckAtWaitTrace];
  const r = analyzeRun(mixed, { contactId: 'C1' });
  assert.equal(r.verdict, 'fail'); // only C1's (stuck) rows count
});

test('buildRuntimeIR: trigger → wait 1min → if_else(custom field) → add_tag on both branches', () => {
  const ir = buildRuntimeIR({ triggerTag: 'rt-trigger', customFieldId: 'FIELD1', matchValue: 'yes', tagToAdd: 'rt-reached' });
  assert.equal(ir.triggers[0].type, 'contact_tag');
  const [wait, cond] = ir.graph;
  assert.equal(wait.kind, 'wait');
  assert.equal(wait.config.unit, 'minutes');
  assert.equal(wait.config.value, 1);
  assert.equal(cond.kind, 'if_else');
  // both branches add the tag, so reaching EITHER proves the flow got past the wait+condition
  const tagSteps = cond.branches.flatMap((b) => b.then).filter((s) => s.type === 'add_contact_tag');
  assert.equal(tagSteps.length, 2);
  assert.ok(tagSteps.every((s) => s.attributes.tags.includes('rt-reached')));
});
