// wf-3 (bl-838): list_workflow_error_notifications sends the query the route needs and pages to totalCount.
// Live (2026-11-08): the route answers 200 with {list, totalCount} for ?skip=0&limit=100 and 500 with no query (3 of 3). The tool sent no query,
// so it 500'd. RED first: the request must carry skip and limit, paging must follow totalCount and stop there, and a page that adds nothing
// (a service that ignores skip) must stop rather than loop. A 500 is still never retried.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeW6cTools } from '../core/workflow-w6c-tools.mjs';
import { z } from 'zod';

const describe = (_t, fallback) => fallback;
const schema = (shape) => z.object(shape).passthrough();
const guard = (fn) => fn();
const tools = makeW6cTools({ describe, schema, guard });
const tool = (name) => tools.find((t) => t.name === name);
const LOC = 'TEST_LOCATION_ID';

// A simulated route holding `total` notifications. It honours skip and limit, and answers totalCount, like the live route did.
function serverOf(total, { ignoreSkip = false, failAt = null } = {}) {
  const calls = [];
  const rows = Array.from({ length: total }, (_, i) => ({ id: `n${i}`, workflowId: `w${i % 3}` }));
  const gw = {
    async call(method, path) {
      calls.push({ method, path });
      const u = new URL(`https://x${path}`);
      const skip = Number(u.searchParams.get('skip') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 25);
      if (failAt !== null && skip === failAt) return { ok: false, status: 500, json: 'Internal Server Error' };
      const from = ignoreSkip ? 0 : skip;
      const list = rows.slice(from, from + limit);
      return { ok: true, status: 200, json: { list, totalCount: total } };
    },
  };
  return { calls, deps: { makeGw: () => gw, state: {} } };
}

test('the request carries skip and limit (the route answers 500 without them)', async () => {
  const { calls, deps } = serverOf(3);
  await tool('list_workflow_error_notifications').handler({ locationId: LOC }, deps);
  assert.ok(calls.length >= 1);
  const u = new URL(`https://x${calls[0].path}`);
  assert.equal(u.searchParams.get('skip'), '0', 'the first page starts at skip 0');
  assert.equal(u.searchParams.get('limit'), '100', 'the default page is the Workflow Maps page size, 100');
});

test('paging follows totalCount: 250 rows come back in three pages (skip 0, 100, 200), then it stops', async () => {
  const { calls, deps } = serverOf(250);
  const out = await tool('list_workflow_error_notifications').handler({ locationId: LOC }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.data.notifications.length, 250);
  assert.equal(out.data.totalCount, 250);
  assert.equal(out.data.complete, true);
  const skips = calls.map((c) => new URL(`https://x${c.path}`).searchParams.get('skip'));
  assert.deepEqual(skips, ['0', '100', '200'], 'exactly three pages, then no fourth request once totalCount is reached');
});

test('a total that is an exact multiple of the page size stops at the total (no empty trailing request)', async () => {
  const { calls, deps } = serverOf(200);
  const out = await tool('list_workflow_error_notifications').handler({ locationId: LOC }, deps);
  assert.equal(out.data.notifications.length, 200);
  assert.equal(calls.length, 2, 'two full pages reach 200; no third request');
});

test('a service that ignores skip cannot make the walk loop: a page that adds nothing new stops it, and the answer is not complete', async () => {
  const { calls, deps } = serverOf(250, { ignoreSkip: true });
  const out = await tool('list_workflow_error_notifications').handler({ locationId: LOC }, deps);
  assert.equal(out.ok, true);
  assert.ok(calls.length <= 3, `the walk must stop, got ${calls.length} requests`);
  assert.equal(out.data.complete, false, 'the rows did not reach totalCount, so the answer is not complete');
  assert.equal(out.data.notifications.length, 100, 'the rows read are kept, de-duplicated by id');
});

test('a 500 on a page is reported as the route error, never retried, and the walk stops there', async () => {
  const { calls, deps } = serverOf(250, { failAt: 100 });
  const out = await tool('list_workflow_error_notifications').handler({ locationId: LOC }, deps);
  assert.equal(out.ok, false, 'a failed page is an error, not a partial answer presented as whole');
  assert.equal(calls.filter((c) => new URL(`https://x${c.path}`).searchParams.get('skip') === '100').length, 1, 'the failed page is not retried');
  assert.ok(calls.every((c) => c.method === 'GET'));
});
