import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'find_workflows_using');
const gw = (capture, json) => ({
  state: { tokenFile: '/fixture/token.txt' },
  makeGw: () => ({ loc: 'LOC', call: async (method, path, body) => { capture.push({ method, path, body }); return { status: 201, ok: true, json }; } }),
});

// 🔴 BOTH DEFAULTS ARE APPLIED IN THE HANDLER, NOT LEFT TO ZOD. The schema only runs when the tool
// is called through the MCP server; tests and the conformance suite call handlers DIRECTLY. On this
// tool's first live run a missing `kind` built {docType eq undefined} and GHL answered 422, and a
// missing `returns` silently took the STEPS branch while labelling nothing — a wrong count with a
// confident label, which is the failure this tool exists to prevent.
test('a direct call with no returns/kind defaults to workflows/any — not to undefined', async () => {
  const calls = [];
  const r = await tool().handler({ locationId: 'LOC', types: ['wait'] }, gw(calls, { count: 61, workflows: [] }));
  assert.equal(r.ok, true);
  const filters = calls[0].body.filters;
  assert.equal(filters.length, 1, 'kind:any must add NO docType filter');
  assert.equal(filters[0].operator, 'has_child', 'returns:workflows must use the parent join');
  assert.deepEqual(filters[0].value, [{ field: 'docKey', operator: 'contains_set', value: ['wait'] }]);
  assert.match(r.data.countIs, /workflows/);
});

test('returns:"steps" queries the child documents directly and says the count means documents', async () => {
  const calls = [];
  const json = { count: 1, workflows: [{ docType: 'action', docKey: 'wait', workflowJoinField: { parent: 'WF1' },
    meta: { id: 's1', type: 'wait', name: 'Hold', attributes: { type: 'time' } } }] };
  const r = await tool().handler({ locationId: 'LOC', types: ['wait'], returns: 'steps' }, gw(calls, json));
  assert.equal(calls[0].body.filters[0].field, 'docKey', 'no join in steps mode');
  assert.match(r.data.countIs, /documents/);
  assert.equal(r.data.complete, true, 'unique count (1) reconciles with count (1)');
  assert.deepEqual(r.data.steps[0], { workflowId: 'WF1', stepId: 's1', type: 'wait', docType: 'action', name: 'Hold', attributes: { type: 'time' } });
});

test('kind narrows INSIDE the join, because it describes the child and not the workflow', async () => {
  const calls = [];
  await tool().handler({ locationId: 'LOC', types: ['appointment'], kind: 'trigger' }, gw(calls, { count: 21, workflows: [] }));
  const [outer] = calls[0].body.filters;
  assert.equal(outer.operator, 'has_child');
  assert.deepEqual(outer.value.map((f) => f.field), ['docKey', 'docType'], 'the docType filter belongs in the CHILD clause');
});

test('an empty types list is refused rather than matching the whole index', async () => {
  const r = await tool().handler({ locationId: 'LOC', types: [] }, gw([], {}));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail, /at least one/);
});

// A wrong zero here reads exactly like "no workflow uses this step", which is the answer an operator
// would act on. Fail loudly on a shape we do not recognise instead.
test('a response whose rows are not an array FAILS rather than reporting zero', async () => {
  const r = await tool().handler({ locationId: 'LOC', types: ['wait'] }, gw([], { count: 5, workflows: 'nope' }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /not with a rows array/);
});

// --- offset-paging reconciliation (2026-09-21 defect) ---------------------------------------
// Measured live: `POST /workflows/es/search` has no stable ordering under `offset`, so a paged
// walk can hand back a row it already returned on an earlier page. Reverted, this whole block
// would ship the duplicate straight through as a real row and never report it.
test('duplicate rows (same workflowId+stepId) are deduped and counted', async () => {
  const calls = [];
  const row = { docType: 'action', docKey: 'wait', workflowJoinField: { parent: 'WF1' },
    meta: { id: 's1', type: 'wait', name: 'Hold', attributes: { type: 'time' } } };
  const json = { count: 1, workflows: [row, row] };
  const r = await tool().handler({ locationId: 'LOC', types: ['wait'], returns: 'steps' }, gw(calls, json));
  assert.equal(r.ok, true);
  assert.equal(r.data.duplicatesDropped, 1, 'reverted, the second copy of the same step ships as a real row');
  assert.equal(r.data.steps.length, 1);
  assert.equal(r.data.complete, true, 'one unique row reconciles with count:1');
});

// Reverted, a short unique count would come back under `workflows`/`steps` with no signal that
// 26 real documents were never returned — the exact shape the peer's paged sweep silently missed.
test('unique rows short of count are reported incomplete with a coded warning', async () => {
  const calls = [];
  const json = { count: 3, workflows: [
    { docType: 'action', docKey: 'wait', workflowJoinField: { parent: 'WF1' }, meta: { id: 's1' } },
  ] };
  const r = await tool().handler({ locationId: 'LOC', types: ['wait'], returns: 'steps' }, gw(calls, json));
  assert.equal(r.ok, true);
  assert.equal(r.data.complete, false, 'reverted, a 1-of-3 result would read complete:true');
  assert.equal(r.data.steps, null, 'reverted, a short list would ship under the key callers trust as whole');
  assert.equal(r.data.partialSteps.length, 1);
  assert.equal(r.data.warnings.length, 1, 'reverted, no coded warning would exist at all');
  assert.equal(r.data.warnings[0].code, 'ES_SEARCH_RECONCILIATION_SHORT');
  assert.match(r.data.warnings[0].detail, /limit.*count|count.*limit/i);
});

// CONTROL. Proves the reconciliation check is not simply always-incomplete: a result whose
// unique count matches `count` exactly must publish complete:true, no warning, rows intact.
test('CONTROL: unique rows reconciling with count publish complete:true and no warning', async () => {
  const calls = [];
  const json = { count: 2, workflows: [
    { docType: 'action', docKey: 'wait', workflowJoinField: { parent: 'WF1' }, meta: { id: 's1' } },
    { docType: 'action', docKey: 'wait', workflowJoinField: { parent: 'WF2' }, meta: { id: 's2' } },
  ] };
  const r = await tool().handler({ locationId: 'LOC', types: ['wait'], returns: 'steps' }, gw(calls, json));
  assert.equal(r.ok, true);
  assert.equal(r.data.complete, true);
  assert.equal(r.data.duplicatesDropped, 0);
  assert.equal(r.data.steps.length, 2);
  assert.equal(r.data.partialSteps, null);
  assert.deepEqual(r.data.warnings, []);
});

// CONTROL. returns:"workflows" mode has no step id at all — dedupe must key on the workflow id,
// not silently pass every row through (or collapse everything onto one shared undefined key).
test('CONTROL: returns:"workflows" dedupes on the workflow id, not a step id', async () => {
  const calls = [];
  const json = { count: 2, workflows: [
    { id: 'WF1', name: 'A' }, { id: 'WF1', name: 'A' }, { id: 'WF2', name: 'B' },
  ] };
  const r = await tool().handler({ locationId: 'LOC', types: ['wait'] }, gw(calls, json));
  assert.equal(r.ok, true);
  assert.equal(r.data.duplicatesDropped, 1, 'the repeated WF1 row is a duplicate by workflow id');
  assert.equal(r.data.complete, true, '2 unique workflows reconciles with count:2');
  assert.deepEqual(r.data.workflows.map((w) => w.id), ['WF1', 'WF2']);
});
