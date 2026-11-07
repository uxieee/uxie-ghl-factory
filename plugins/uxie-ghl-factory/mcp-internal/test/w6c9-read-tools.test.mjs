// w6c-9 (plan Task 9, bl-789): the read tools. RED first. Mocks sit at the gateway seam; every tool here makes GET requests only.
// Proof labels follow the live G1-era reads recorded in knowledge gates/w6c-9-live-reads.json (2026-11-07, GROM Sandbox):
//   enrollment-counts 200 (proven-live), statuses_v2 200 (proven-live), event-runs 200 empty (proven-live),
//   latest-result 404 "no test result for this step" (proven-live absence), error-notification/list 500 (finding: the route errors live).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { makeW6cTools } from '../core/workflow-w6c-tools.mjs';
import { CODES } from '../core/errors.mjs';

const describe = (_t, fallback) => fallback;
const schema = (shape) => z.object(shape).passthrough();
const guard = (fn) => fn();
const tools = makeW6cTools({ describe, schema, guard });
const tool = (name) => tools.find((t) => t.name === name);
const LOC = 'TEST_LOCATION_ID';
const DAY = 86400000;

function mockGw(routes) {
  const calls = [];
  const gw = {
    async call(method, path, body) {
      calls.push({ method, path, body });
      const hit = routes.find((r) => r.method === method && path.startsWith(r.path));
      if (!hit) throw new Error(`unrouted ${method} ${path}`);
      return typeof hit.respond === 'function' ? hit.respond(path, body) : hit.respond;
    },
  };
  return { calls, deps: { makeGw: () => gw, state: {} } };
}

test('every new read tool is registered and carries a proof label within 2048 characters', () => {
  for (const name of ['get_workflow_heat_map', 'get_contact_workflow_journey', 'list_workflow_test_runs', 'get_step_latest_test_result', 'list_workflow_error_notifications']) {
    const t = tool(name);
    assert.ok(t, `${name} is registered`);
    assert.ok(t.description.length <= 2048, name);
    assert.match(t.description, /proof:/, name);
  }
});

test('the heat map refuses a window over 60 days before any request (RETENTION)', async () => {
  const from = Date.parse('2026-08-01T00:00:00Z');
  const { calls, deps } = mockGw([]);
  const out = await tool('get_workflow_heat_map').handler({ locationId: LOC, fromDate: from, toDate: from + 61 * DAY }, deps);
  assert.equal(out.ok, false);
  assert.equal(out.code, CODES.RETENTION ?? 'RETENTION');
  assert.equal(calls.length, 0);
});

test('the heat map reads enrollment-counts once with ISO dates and rolls up, absent not 0', async () => {
  const from = Date.parse('2026-11-01T00:00:00Z'); const to = Date.parse('2026-11-07T00:00:00Z');
  const { calls, deps } = mockGw([{ method: 'GET', path: '/workflows/logs/enrollment-counts', respond: { ok: true, status: 200,
    json: [{ workflowId: 'w1', count: 5 }] } }]);
  const out = await tool('get_workflow_heat_map').handler({ locationId: LOC, fromDate: from, toDate: to, workflowIds: ['w1', 'w9'] }, deps);
  assert.equal(out.ok, true);
  assert.deepEqual(out.data.absent, ['w9']);
  assert.equal(out.data.total, 5);
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /fromDate=2026-11-01T00%3A00%3A00\.000Z/);
  assert.ok(calls.every((c) => c.method === 'GET'), 'reads only');
});

test('the contact journey is one GET on statuses_v2 and returns the workflow statuses', async () => {
  const { calls, deps } = mockGw([{ method: 'GET', path: `/workflow/${LOC}/contact/c1/statuses_v2`, respond: { ok: true, status: 200,
    json: { msg: 'Success', count: 1, workflowStatuses: [{ workflowId: 'w1', status: 'finished' }] } } }]);
  const out = await tool('get_contact_workflow_journey').handler({ locationId: LOC, contactId: 'c1' }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.data.workflowStatuses[0].status, 'finished');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('the test-run list is one GET on event-runs (limit 10) and returns the runs, empty included', async () => {
  const { calls, deps } = mockGw([{ method: 'GET', path: `/workflow/${LOC}/test-workflow/w1/event-runs`, respond: { ok: true, status: 200,
    json: { mode: 'history', runs: [], lastDocumentId: null, hasMore: false, pageSize: 10, error: false } } }]);
  const out = await tool('list_workflow_test_runs').handler({ locationId: LOC, workflowId: 'w1' }, deps);
  assert.equal(out.ok, true);
  assert.deepEqual(out.data.runs, []);
  assert.match(calls[0].path, /limit=10/);
  assert.equal(calls[0].method, 'GET');
});

test('the latest step result: a 404 with the message "no test result" is a proven absence, not an error', async () => {
  const { calls, deps } = mockGw([{ method: 'GET', path: `/workflow/${LOC}/test-workflow/w1/steps/s1/latest-result`, respond: { ok: false, status: 404,
    json: { msg: 'no test result for this step', error: true } } }]);
  const out = await tool('get_step_latest_test_result').handler({ locationId: LOC, workflowId: 'w1', stepId: 's1' }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.data.present, false);
  assert.match(out.data.reason, /no test result/);
  assert.equal(calls.length, 1);
});

test('the error-notification list is one GET; a 500 is reported as the route error, never retried', async () => {
  const { calls, deps } = mockGw([{ method: 'GET', path: `/workflow/${LOC}/error-notification/list`, respond: { ok: false, status: 500, json: 'Internal Server Error' } }]);
  const out = await tool('list_workflow_error_notifications').handler({ locationId: LOC }, deps);
  assert.equal(out.ok, false);
  assert.equal(calls.length, 1, 'no retry');
  assert.ok(calls.every((c) => c.method === 'GET'));
});

// QA FAIL #1–3 (2026-11-07): the proof field must not be in the data; get_workflow_test_run is built; the journey reports incomplete when
// its count differs from the rows.
test('no read tool returns a proof field in its data (the seeded label is the one proof)', async () => {
  const cases = [
    ['get_workflow_heat_map', { locationId: LOC, fromDate: Date.parse('2026-11-01T00:00:00Z'), toDate: Date.parse('2026-11-07T00:00:00Z') },
      [{ method: 'GET', path: '/workflows/logs/enrollment-counts', respond: { ok: true, status: 200, json: [] } }]],
    ['get_contact_workflow_journey', { locationId: LOC, contactId: 'c1' },
      [{ method: 'GET', path: `/workflow/${LOC}/contact/c1/statuses_v2`, respond: { ok: true, status: 200, json: { count: 0, workflowStatuses: [] } } }]],
    ['list_workflow_test_runs', { locationId: LOC, workflowId: 'w1' },
      [{ method: 'GET', path: `/workflow/${LOC}/test-workflow/w1/event-runs`, respond: { ok: true, status: 200, json: { runs: [], hasMore: false } } }]],
    ['list_workflow_error_notifications', { locationId: LOC },
      [{ method: 'GET', path: `/workflow/${LOC}/error-notification/list`, respond: { ok: true, status: 200, json: [] } }]],
  ];
  for (const [name, args, routes] of cases) {
    const { deps } = mockGw(routes);
    const out = await tool(name).handler(args, deps);
    assert.equal('proof' in (out.data ?? {}), false, `${name} has no proof field`);
  }
});

test('get_workflow_test_run reads the run and, with a stepId, its step events (GET only)', async () => {
  const { calls, deps } = mockGw([
    { method: 'GET', path: `/workflow/${LOC}/test-workflow/runs/r1/step-events`, respond: { ok: true, status: 200, json: { events: [{ stepId: 's1' }] } } },
    { method: 'GET', path: `/workflow/${LOC}/test-workflow/runs/r1`, respond: { ok: true, status: 200, json: { events: [], hasMore: false, workflowStatusId: 'x' } } },
  ]);
  const out = await tool('get_workflow_test_run').handler({ locationId: LOC, requestId: 'r1', stepId: 's1' }, deps);
  assert.equal(out.ok, true);
  assert.ok(out.data.progress, 'the run progress is returned');
  assert.deepEqual(out.data.stepEvents.events, [{ stepId: 's1' }]);
  assert.ok(calls.every((c) => c.method === 'GET'), 'reads only');
});

test('get_workflow_test_run without a stepId reads only the run progress', async () => {
  const { calls, deps } = mockGw([
    { method: 'GET', path: `/workflow/${LOC}/test-workflow/runs/r1`, respond: { ok: true, status: 200, json: { events: [], hasMore: false } } },
  ]);
  const out = await tool('get_workflow_test_run').handler({ locationId: LOC, requestId: 'r1' }, deps);
  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(out.data.stepEvents, null);
});

test('the journey is complete:false when its count differs from the rows it returns', async () => {
  const { deps } = mockGw([{ method: 'GET', path: `/workflow/${LOC}/contact/c1/statuses_v2`, respond: { ok: true, status: 200,
    json: { count: 3, workflowStatuses: [{ workflowId: 'a', status: 'finished' }] } } }]);
  const out = await tool('get_contact_workflow_journey').handler({ locationId: LOC, contactId: 'c1' }, deps);
  assert.equal(out.data.complete, false);
  assert.equal(out.data.count, 3);
});
