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
  const json = { count: 438, workflows: [{ docType: 'action', docKey: 'wait', workflowJoinField: { parent: 'WF1' },
    meta: { id: 's1', type: 'wait', name: 'Hold', attributes: { type: 'time' } } }] };
  const r = await tool().handler({ locationId: 'LOC', types: ['wait'], returns: 'steps' }, gw(calls, json));
  assert.equal(calls[0].body.filters[0].field, 'docKey', 'no join in steps mode');
  assert.match(r.data.countIs, /documents/);
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
