import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'get_contact_workflow_history');
// Newest first, as the status search answers. r3 has no sid (the reference omits it then).
const RUNS = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id, i) => ({ _id: id, sid: `s${i}`, workflowId: i % 2 ? 'W2' : 'W1',
  status: 'finished', createdAt: `2026-09-29T05:0${9 - i}:00.000Z`, updatedAt: `2026-09-29T05:0${9 - i}:30.000Z`, currentStepName: `step ${id}`, currentStepType: 'wait' }));

// inclusive: action=next re-returns the reference row first (measured). exclusive: starts after it (control).
function gateway({ inclusive = true } = {}) {
  const calls = [];
  const gw = { call: async (method, path) => {
    calls.push(path);
    const [p, qs] = path.split('?'); const q = new URLSearchParams(qs ?? '');
    if (p === '/workflows/status/search/contact-executions' || p === '/workflows/status/search/workflow-with-filter') {
      let rows = q.get('workflowId') ? RUNS.filter((r) => r.workflowId === q.get('workflowId')) : RUNS;
      if (q.get('action') === 'next') {
        const exec = p.endsWith('contact-executions');
        // measured 2026-09-29: contact-executions refuses the id/createdAt reference and pages by sid, exclusively
        if (exec && (q.has('referenceId') || q.has('referenceCreatedAt'))) return { ok: false, status: 422, json: { message: ['property referenceCreatedAt should not exist'] } };
        const at = rows.findIndex((r) => (exec ? r.sid === q.get('referenceSid') : r._id === q.get('referenceId')));
        rows = rows.slice(exec ? at + 1 : (inclusive ? at : at + 1));
      }
      return { ok: true, status: 200, json: { statuses: structuredClone(rows.slice(0, Number(q.get('limit')))), count: rows.length } };
    }
    const m = p.match(/^\/workflow\/LOC\/(W\d)$/);
    if (m) return { ok: true, status: 200, json: { id: m[1], name: `Workflow ${m[1]}` } };
    return { ok: false, status: 404, json: {} };
  } };
  return { gw, calls, deps: { state: {}, makeGw: () => gw } };
}
const walk = async (g, extra = {}) => {
  const seen = []; let cursor; let pages = 0;
  do {
    const r = await tool().handler({ locationId: 'LOC', contactId: 'C1', limit: 2, ...extra, ...(cursor ? { cursor } : {}) }, g.deps);
    assert.equal(r.ok, true, JSON.stringify(r));
    seen.push(...r.data.runs); cursor = r.data.nextCursor; pages++;
  } while (cursor && pages < 10);
  return seen;
};

test('the walk returns every run exactly once, newest first, with the workflow name beside its id', async () => {
  const runs = await walk(gateway());
  assert.deepEqual(runs.map((r) => r.runId), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.deepEqual(runs.map((r) => r.workflowName), ['Workflow W1', 'Workflow W2', 'Workflow W1', 'Workflow W2', 'Workflow W1']);
  assert.deepEqual(runs[0].step, { name: 'step r1', type: 'wait' });
});

test('CONTROL: an endpoint that starts AFTER the reference loses nothing either', async () => {
  assert.deepEqual((await walk(gateway({ inclusive: false }))).map((r) => r.runId), ['r1', 'r2', 'r3', 'r4', 'r5']);
});

test('unnarrowed pages send ONLY referenceSid; narrowed pages send the id/createdAt tuple', async () => {
  const g = gateway(); await walk(g);
  const next = g.calls.filter((c) => c.includes('action=next'));
  assert.ok(next.length >= 2);
  assert.match(next[0], /referenceSid=s1/); assert.doesNotMatch(next[0], /referenceId|referenceCreatedAt/);
  const g2 = gateway(); await walk(g2, { workflowId: 'W1' });
  assert.ok(g2.calls.filter((c) => c.includes('action=next')).every((c) => /referenceId=/.test(c) && /referenceCreatedAt=/.test(c)));
});

test('workflowId narrows through workflow-with-filter, and pages across the inclusive reference', async () => {
  const g = gateway(); const runs = await walk(g, { workflowId: 'W1' });
  assert.deepEqual(runs.map((r) => r.runId), ['r1', 'r3', 'r5']);
  assert.ok(g.calls.every((c) => !c.includes('contact-executions')));
});

test('a cursor from another contact or workflow is refused, not silently re-used', async () => {
  const g = gateway();
  const first = await tool().handler({ locationId: 'LOC', contactId: 'C1', limit: 2 }, g.deps);
  const r = await tool().handler({ locationId: 'LOC', contactId: 'C2', limit: 2, cursor: first.data.nextCursor }, g.deps);
  assert.equal(r.ok, false); assert.equal(r.code, 'VALIDATION_FAILED');
  const r2 = await tool().handler({ locationId: 'LOC', contactId: 'C1', workflowId: 'W1', limit: 2, cursor: first.data.nextCursor }, g.deps);
  assert.equal(r2.ok, false);
});

test('it is a read: GET capabilities only', () => {
  assert.ok(tool().capabilities.every((c) => c.method === 'GET'));
});
