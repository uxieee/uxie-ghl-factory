import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

// The 2026-08-22 runtime rails: get_trigger_logs, get_account_workflow_overview,
// test_custom_code, and get_workflow_logs's executionId mode. Stub responses mirror the
// LIVE shapes captured on GROM AU that day (ids/PII replaced).

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);
function gwStub(routes = {}) {
  const calls = [];
  return {
    calls, loc: 'L', uid: 'u',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      for (const [fragment, response] of Object.entries(routes)) {
        if (!path.includes(fragment)) continue;
        return response && typeof response === 'object' && 'ok' in response
          ? response
          : { status: 200, ok: true, json: typeof response === 'function' ? response(path, body) : response };
      }
      return { status: 404, ok: false, json: { message: `no stub for ${path}` } };
    },
  };
}
const deps = (gw) => ({ state: { tokenFile: '/x' }, makeGw: () => gw, now: '2026-08-22T10:00:00.000Z' });

test('get_trigger_logs: resolves a workflow\'s triggers, returns attempts with actual/expected + ranked reasons; triggerType is forwarded', async () => {
  const gw = gwStub({
    '/workflow/L/trigger?': [{ id: 'trg1', name: 'Stage changed', type: 'pipeline_stage_updated', active: true }],
    '/workflows/trigger/logs/count-by-triggerId': [{ triggerId: 'trg1', total: '3', matched: '1' }],
    '/workflows/trigger/logs/triggerId': [
      { _id: 'a1', createdAt: '2026-08-07T15:05:59.101Z', recordId: 'c1', triggerId: 'trg1', qualified: false, failedReason: 'Filter not matched - In pipeline', actualValue: '"pipeA"', expectedValue: '"pipeB"' },
      { _id: 'a2', createdAt: '2026-08-07T15:06:59.101Z', recordId: 'c2', triggerId: 'trg1', qualified: true, failedReason: null, actualValue: null, expectedValue: null },
    ],
    '/workflows/trigger/logs/top-failed-reasons': [{ failedReason: 'Filter not matched - In pipeline', failures: '2' }],
  });
  const r = await tool('get_trigger_logs').handler({ locationId: 'L', workflowId: 'w1', qualified: false }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [t] = r.data.triggers;
  assert.equal(t.attempted, 3); assert.equal(t.matched, 1); assert.equal(t.unmatched, 2);
  assert.deepEqual(t.attempts[0], { id: 'a1', at: '2026-08-07T15:05:59.101Z', contactId: 'c1', qualified: false, failedReason: 'Filter not matched - In pipeline', actualValue: 'pipeA', expectedValue: 'pipeB' });
  assert.deepEqual(t.failedReasons, [{ reason: 'Filter not matched - In pipeline', failures: 2 }]);
  const listCall = gw.calls.find((c) => c.path.includes('/trigger/logs/triggerId'));
  assert.match(listCall.path, /triggerType=pipeline_stage_updated/);
  assert.match(listCall.path, /qualified=false/);
  assert.match(listCall.path, /dateType=custom/);
  assert.ok(gw.calls.every((c) => c.method === 'GET'));
});

test('get_trigger_logs: triggerId without triggerType refuses loudly (the endpoints 422 without it); neither target refuses too', async () => {
  const gw = gwStub({});
  const a = await tool('get_trigger_logs').handler({ locationId: 'L', triggerId: 'trg1' }, deps(gw));
  assert.equal(a.ok, false); assert.match(JSON.stringify(a), /triggerType/);
  const b = await tool('get_trigger_logs').handler({ locationId: 'L' }, deps(gw));
  assert.equal(b.ok, false);
  assert.equal(gw.calls.length, 0, 'no network call before the argument check');
});

test('get_account_workflow_overview: statistics + weekly + needs-review + merged enrollment totals (live beats cache)', async () => {
  const gw = gwStub({
    '/workflows/statistics': { totalWorkflows: 40, publishedWorkflows: 12, totalEnrollments: 900, traceId: 'x' },
    '/workflows/logs/weekly-enrollment-data': [{ weekStart: '2026-08-10', enrollments: 5 }],
    '/error-notification/count': 1,
    '/error-notification/list': { list: [{ workflowId: 'wErr', name: 'Broken one', lastOccurred: '2026-08-20T00:00:00Z' }], totalCount: 1 },
    '/error-notification/settings': { locationId: 'L', isActive: true, users: ['u1'] },
    '/enroll-stats-cache': [{ workflowId: 'w1', total: 10, finished: 9 }, { workflowId: 'w2', total: 3, finished: 1 }],
    '/search/enroll-stats?': [{ workflowId: 'w1', total: 11, finished: 9 }],
  });
  const r = await tool('get_account_workflow_overview').handler({ locationId: 'L', workflowIds: ['w1', 'w2', 'w3'] }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.statistics, { totalWorkflows: 40, publishedWorkflows: 12, totalEnrollments: 900 }, 'traceId stripped');
  assert.equal(r.data.needsReview.count, 1);
  assert.equal(r.data.needsReview.workflows[0].workflowId, 'wErr');
  assert.deepEqual(r.data.needsReview.errorEmailSettings.users, ['u1']);
  assert.deepEqual(r.data.enrollment, [
    { workflowId: 'w1', total: 11, finished: 9, source: 'live' },
    { workflowId: 'w2', total: 3, finished: 1, source: 'cache' },
    { workflowId: 'w3', total: null, finished: null, source: null },
  ]);
  assert.ok(tool('get_account_workflow_overview').capabilities.every((c) => c.method === 'GET'));
});

test('test_custom_code: posts the builder\'s run-test payload; a primitive output is reported invalid, an object passes with its keys', async () => {
  const gw = gwStub({
    '/workflow/custom-code/run-test': (path, body) => body.attributes.code.includes('5')
      ? { consoleLogs: [], consoleWarnings: [], consoleErrors: [], consoleOutput: [], hasError: false, memoryUsage: 1, processTime: 0, inputData: {} }
      : { output: { ok: true, sum: 5 }, consoleLogs: ['hi'], consoleWarnings: [], consoleErrors: [], consoleOutput: [], hasError: false, memoryUsage: 1, processTime: 0, inputData: { a: 2, b: 3 } },
  });
  const good = await tool('test_custom_code').handler({ locationId: 'L', code: 'output = { ok: true, sum: inputData.a + inputData.b }', inputData: { a: 2, b: 3 } }, deps(gw));
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal(good.data.passed, true); assert.deepEqual(good.data.outputKeys, ['ok', 'sum']);
  assert.deepEqual(gw.calls[0].body, { location_id: 'L', attributes: { language: 'javascript', code: 'output = { ok: true, sum: inputData.a + inputData.b }', inputData: { a: 2, b: 3 } } });
  const bad = await tool('test_custom_code').handler({ locationId: 'L', code: 'output = 5' }, deps(gw));
  assert.equal(bad.data.passed, false); assert.equal(bad.data.outputValid, false); assert.equal(bad.data.hasError, false);
  const thrown = await tool('test_custom_code').handler({ locationId: 'L', code: 'throw new Error("boom")' }, {
    ...deps(gwStub({ '/run-test': { output: {}, hasError: true, errorMessage: 'Error: boom', consoleLogs: [] } })),
  });
  assert.equal(thrown.data.passed, false); assert.equal(thrown.data.errorMessage, 'Error: boom');
  assert.deepEqual(tool('test_custom_code').capabilities, [{ method: 'POST', path: '/workflow/custom-code/run-test' }]);
});

test('get_workflow_logs: executionId is forwarded to logs/v2 only, never to the roster', async () => {
  const gw = gwStub({
    '/workflows/logs/v2': [{ _id: 'l1', workflowStatusId: 'EXEC1', stepId: 's1', status: 'finished', type: 'remove_from_workflow' }],
    '/count-per-step': [],
    '/workflow-with-filter': { statuses: [] },
    '/enroll-stats': [],
  });
  const r = await tool('get_workflow_logs').handler({ locationId: 'L', workflowId: 'w1', executionId: 'EXEC1' }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r));
  const logs = gw.calls.find((c) => c.path.includes('/workflows/logs/v2'));
  assert.match(logs.path, /executionId=EXEC1/);
  for (const c of gw.calls.filter((c) => !c.path.includes('/workflows/logs/v2'))) assert.doesNotMatch(c.path, /executionId/);
});

test('pin_webhook_sample: previews without confirm; with confirm POSTs to the hooks host unauthenticated-by-design, finds the matching request, pins it, and returns merge tags minus headers', async () => {
  const sample = { lead: { email: 'sample@example.com' }, dealRefId: 'CANARY-1', items: [{ sku: 'A' }] };
  const calls = [];
  const gw = {
    calls, loc: 'L', uid: 'u',
    call: async (method, path, body, base) => {
      calls.push({ method, path, body, base });
      if (path.startsWith('/hooks/L/webhook-trigger/trg1')) return { status: 200, ok: true, json: { status: 'Success: test request received' } };
      if (path.startsWith('/hooks/inbound-webhook-request/trigger/trg1')) return { status: 200, ok: true, json: [
        { _id: 'reqOld', payload: { dealRefId: 'OLD', headers: { host: 'x' } } },
        { _id: 'reqNew', payload: { ...sample, headers: { host: 'x' } }, createdAt: '2026-08-22T08:13:48.994Z' },
      ] };
      if (path.startsWith('/hooks/inbound-webhook-request/set-as-reference/reqNew')) return { status: 200, ok: true, json: 'ref1' };
      if (path.startsWith('/hooks/inbound-webhook-request/reference/trg1')) return { status: 200, ok: true, json: { _id: 'ref1', requestId: 'reqNew', triggerId: 'trg1', payload: { ...sample, headers: { host: 'x' } }, updatedAt: '2026-08-22T08:13:51.509Z' } };
      return { status: 404, ok: false, json: {} };
    },
  };
  const d = { ...deps(gw), sleep: async () => {} };
  const pv = await tool('pin_webhook_sample').handler({ locationId: 'L', triggerId: 'trg1', samplePayload: sample }, d);
  assert.equal(pv.ok, true); assert.equal(pv.data.preview, true); assert.equal(calls.length, 0, 'preview makes no call');
  const r = await tool('pin_webhook_sample').handler({ locationId: 'L', triggerId: 'trg1', samplePayload: sample, confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].base, 'https://services.leadconnectorhq.com'); assert.deepEqual(calls[0].body, sample);
  assert.equal(r.data.requestId, 'reqNew'); assert.equal(r.data.referenceId, 'ref1');
  assert.deepEqual(r.data.mergeTags, { 'lead.email': '{{inboundWebhookRequest.lead.email}}', dealRefId: '{{inboundWebhookRequest.dealRefId}}', 'items.0.sku': '{{inboundWebhookRequest.items.0.sku}}' });
  assert.equal(r.data.headerTagsOmitted, 1);
  assert.ok(calls.some((c) => c.method === 'PUT' && c.path.includes('set-as-reference/reqNew')));
});

// F5-35: DELETE /contacts/{id}/workflow/{wid} on the PUBLIC rail ends a live run, and the roster
// says `finished` for that exactly as it does for a completed run. Only the lifecycle row's
// removedFrom.channel tells them apart, so an exit reason read from the roster alone is a guess.
test('get_workflow_logs labels a removal by ORIGIN and counts the external ones', async () => {
  const tool = TOOLS.find((t) => t.name === 'get_workflow_logs');
  const logs = [
    { type: 'added_to_workflow', stepName: 'Add to workflow' },
    { type: 'remove_from_workflow', stepName: 'Remove', removedFrom: { channel: 'OAUTH', source: 'INTEGRATION' } },
    { type: 'remove_from_workflow', stepName: 'Remove', removedFrom: { channel: 'WORKFLOW' } },
    { type: 'sms', stepName: 'Text' },
  ];
  const gw = { loc: 'LOC', call: async (m, p) => {
    if (p.includes('/logs')) return { ok: true, status: 200, json: { logs } };
    return { ok: true, status: 200, json: {} };
  } };
  const res = await tool.handler({ locationId: 'LOC', workflowId: 'WID' }, { state: {}, makeGw: () => gw });
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
  const rows = res.data.logs;
  assert.equal(rows[1].removalOrigin, 'external-api');
  assert.equal(rows[2].removalOrigin, 'workflow');
  assert.equal(rows[3].removalOrigin, undefined, 'a step row is not a removal');
  assert.equal(res.data.externalRemovals, 1);
});
