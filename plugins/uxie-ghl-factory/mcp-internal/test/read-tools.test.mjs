import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);

function gwStub(routes = {}) {
  const calls = [];
  return {
    calls,
    loc: 'L',
    uid: 'u',
    call: async (method, path) => {
      calls.push({ method, path });
      for (const [fragment, response] of Object.entries(routes)) {
        if (!path.includes(fragment)) continue;
        return response && typeof response === 'object' && 'ok' in response
          ? response
          : { status: 200, ok: true, json: response };
      }
      return { status: 404, ok: false, json: { message: `no stub for ${path}` } };
    },
  };
}

const deps = (gw) => ({ state: { tokenFile: '/x' }, makeGw: () => gw });

test('all six read tools exist', () => {
  for (const name of [
    'list_workflows',
    'get_workflow',
    'export_workflow',
    'get_workflow_logs',
    'list_account_entities',
    'raw_request',
  ]) {
    assert.ok(tool(name), `missing ${name}`);
  }
});

test('get_workflow returns a summary, not the whole graph', async () => {
  const gw = gwStub({
    '/workflow/L/w1?': {
      _id: 'w1',
      name: 'WF',
      status: 'draft',
      version: 4,
      workflowData: { templates: [{ id: 's1' }, { id: 's2' }] },
    },
  });
  const result = await tool('get_workflow').handler(
    { locationId: 'L', workflowId: 'w1' },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.stepCount, 2);
  assert.equal(result.data.workflowData, undefined, 'summary must not embed the full graph');
});

test('export_workflow bundles body, triggers and sticky notes', async () => {
  const gw = gwStub({
    '/workflow/L/w1?': { _id: 'w1', name: 'WF', workflowData: { templates: [] } },
    '/workflow/L/trigger': { triggers: [{ id: 't1' }] },
    // live envelope (GROM AU 2026-07-20): { data, count, traceId } — not { notes }
    'sticky-notes-all': { data: [{ id: 'n1' }], count: 1, traceId: 't' },
  });
  const result = await tool('export_workflow').handler(
    { locationId: 'L', workflowId: 'w1' },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.triggers.length, 1);
  assert.equal(result.data.stickyNotes.length, 1);
  assert.ok(result.data.workflow);
  assert.equal(gw.calls.length, 3);
});

test('export_workflow reports a supplemental-request failure instead of claiming a partial export', async () => {
  const gw = gwStub({
    '/workflow/L/w1?': { _id: 'w1', name: 'WF' },
    '/workflow/L/trigger': { status: 503, ok: false, json: { message: 'trigger service unavailable' } },
    'sticky-notes-all': { data: [], count: 0, traceId: 't' },
  });
  const result = await tool('export_workflow').handler(
    { locationId: 'L', workflowId: 'w1' },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_503');
});

test('get_workflow_logs merges executions, per-step counts and the enrollment roster', async () => {
  const gw = gwStub({
    'logs/v2': { logs: [{ id: 'l1', eventType: 'added_to_workflow' }] },
    'count-per-step': { counts: [{ stepId: 's1', count: 3 }] },
    'workflow-with-filter': { rows: [{ contactId: 'c1', stepId: 's1' }] },
  });
  const result = await tool('get_workflow_logs').handler(
    { locationId: 'L', workflowId: 'w1', limit: 20 },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.logs.length, 1);
  assert.equal(result.data.perStepCounts.length, 1);
  assert.equal(result.data.enrollments.length, 1);
  assert.equal(gw.calls.length, 3);
});

test('get_workflow_logs reports any failed component instead of returning incomplete evidence', async () => {
  const gw = gwStub({
    'logs/v2': { logs: [] },
    'count-per-step': { status: 500, ok: false, json: { message: 'counts unavailable' } },
    'workflow-with-filter': { rows: [] },
  });
  const result = await tool('get_workflow_logs').handler(
    { locationId: 'L', workflowId: 'w1' },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_500');
});

test('get_workflow_logs forwards contact/date/event filters to both logs and the roster', async () => {
  const gw = gwStub({
    'logs/v2': { logs: [] },
    'count-per-step': { counts: [] },
    'workflow-with-filter': { rows: [] },
  });
  await tool('get_workflow_logs').handler(
    { locationId: 'L', workflowId: 'w1', contactId: 'c9', fromDate: 100, toDate: 200, eventType: 'email' },
    deps(gw),
  );

  const logsCall = gw.calls.find((c) => c.path.includes('logs/v2')).path;
  const rosterCall = gw.calls.find((c) => c.path.includes('workflow-with-filter')).path;
  for (const path of [logsCall, rosterCall]) {
    assert.match(path, /contactId=c9/, `filter missing on ${path}`);
    assert.match(path, /fromDate=100/, `fromDate missing on ${path}`);
    assert.match(path, /toDate=200/, `toDate missing on ${path}`);
    assert.match(path, /eventType=email/, `eventType missing on ${path}`);
  }
});

test('get_workflow_logs walks the enrollment roster to completion when allEnrollments is set', async () => {
  // Two full pages then a short page; the cursor must advance on _id.
  const pages = [
    { rows: [{ _id: 'a' }, { _id: 'b' }] },
    { rows: [{ _id: 'c' }, { _id: 'd' }] },
    { rows: [{ _id: 'e' }] },
  ];
  let hit = 0;
  const gw = {
    calls: [], loc: 'L', uid: 'u',
    call: async (method, path) => {
      gw.calls.push({ method, path });
      if (path.includes('logs/v2')) return { status: 200, ok: true, json: { logs: [] } };
      if (path.includes('count-per-step')) return { status: 200, ok: true, json: { counts: [] } };
      if (path.includes('workflow-with-filter')) {
        // action=first has no referenceId; every subsequent page must carry one.
        if (hit > 0) assert.match(path, /referenceId=/, 'next page must carry a cursor');
        return { status: 200, ok: true, json: pages[hit++] };
      }
      return { status: 404, ok: false, json: {} };
    },
  };
  const result = await tool('get_workflow_logs').handler(
    { locationId: 'L', workflowId: 'w1', limit: 2, allEnrollments: true },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.enrollments.length, 5);
  assert.equal(result.data.enrollmentsComplete, true);
  assert.equal(result.data.enrollmentPages, 3);
});

test('get_workflow_logs flags an incomplete roster when the account is rate limited', async () => {
  const gw = gwStub({
    'logs/v2': { logs: [] },
    'count-per-step': { counts: [] },
    'workflow-with-filter': { rows: [{ _id: 'a' }, { _id: 'b' }], isLocationRateLimited: true },
  });
  const result = await tool('get_workflow_logs').handler(
    { locationId: 'L', workflowId: 'w1', limit: 2, allEnrollments: true },
    deps(gw),
  );

  assert.equal(result.data.enrollmentsComplete, false);
  assert.equal(result.data.rateLimited, true);
});

test('get_workflow_logs attaches opt-in enrollment totals without failing on a stats miss', async () => {
  const gw = gwStub({
    'logs/v2': { logs: [] },
    'count-per-step': { counts: [] },
    'workflow-with-filter': { rows: [] },
    'enroll-stats-cache': [{ workflowId: 'w1', total: 42, finished: 7 }],
  });
  const result = await tool('get_workflow_logs').handler(
    { locationId: 'L', workflowId: 'w1', enrollmentTotals: true },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.enrollmentStats.total, 42);
  assert.equal(result.data.enrollmentStats.finished, 7);
  assert.equal(result.data.enrollmentStats.source, 'enroll-stats-cache');
  assert.equal(result.data.enrollmentStats.proof, 'live-runtime (2026-07-24)');
});

test('get_workflow_logs stays backward-compatible: no filters, no total, single roster page', async () => {
  const gw = gwStub({
    'logs/v2': { logs: [{ id: 'l1' }] },
    'count-per-step': { counts: [] },
    'workflow-with-filter': { rows: [{ _id: 'a' }] },
  });
  const result = await tool('get_workflow_logs').handler({ locationId: 'L', workflowId: 'w1' }, deps(gw));

  assert.equal(result.ok, true);
  assert.equal(gw.calls.length, 3, 'default path must not call stats or extra roster pages');
  assert.equal(result.data.enrollmentsComplete, undefined, 'single-page shape unchanged for existing callers');
});

test('get_contacts_at_step walks details-by-step to the reported total', async () => {
  const gw = {
    calls: [], loc: 'L', uid: 'u',
    call: async (method, path) => {
      gw.calls.push({ method, path });
      const skip = Number(new URL(`http://x${path}`).searchParams.get('skip'));
      const rows = skip === 0
        ? [{ _id: 's1', contactId: 'c1' }, { _id: 's2', contactId: 'c2' }]
        : [{ _id: 's3', contactId: 'c3' }];
      return { status: 200, ok: true, json: { totalCount: 3, rows } };
    },
  };
  const result = await tool('get_contacts_at_step').handler(
    { locationId: 'L', workflowId: 'w1', stepId: 'step9', limit: 2 },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.total, 3);
  assert.equal(result.data.contacts.length, 3);
  assert.equal(result.data.complete, true);
  assert.ok(gw.calls.every((c) => c.path.includes('currentStepId=step9')));
});

test('get_contacts_at_step surfaces an upstream failure as the error contract', async () => {
  const gw = gwStub({ 'details-by-step': { status: 500, ok: false, json: { message: 'nope' } } });
  const result = await tool('get_contacts_at_step').handler(
    { locationId: 'L', workflowId: 'w1', stepId: 's1' },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_500');
});

test('list_account_entities reuses the canonical best-effort entity sweep', async () => {
  const gw = gwStub({
    '/opportunities/pipelines': { pipelines: [{ id: 'p1', name: 'Pipeline', stages: [] }] },
    '/calendars/': { calendars: [{ id: 'c1', name: 'Calendar' }] },
    '/users/': { users: [{ id: 'u1', firstName: 'Ada' }] },
    '/forms/': { forms: [{ id: 'f1', name: 'Form' }] },
    '/customFields/search': { customFields: [{ id: 'cf1', name: 'Field' }] },
    '/voice-ai/agents': { status: 404, ok: false, json: {} },
    '/ai-employees/agents': { agents: [{ id: 'a1', name: 'Agent' }] },
  });
  const result = await tool('list_account_entities').handler({ locationId: 'L' }, deps(gw));

  assert.equal(result.ok, true);
  assert.equal(result.data.pipelines.length, 1);
  assert.equal(result.data.calendars.length, 1);
  assert.equal(result.data.users.length, 1);
  assert.equal(result.data.forms.length, 1);
  assert.equal(result.data.customFields.length, 1);
  assert.deepEqual(result.data.agents, [{ id: 'a1', name: 'Agent' }]);
  assert.equal(gw.calls.length, 7);
});

test('list_account_entities treats malformed successful payloads as empty best-effort arrays', async () => {
  const gw = gwStub({
    '/opportunities/pipelines': { pipelines: { message: 'not an array' } },
    '/calendars/': { calendars: null },
    '/users/': { message: 'successful object without users' },
    '/forms/': { forms: 'not an array' },
    '/customFields/search': { message: 'successful object without customFields' },
    '/voice-ai/agents': { data: { message: 'not an array' } },
    '/ai-employees/agents': { agents: null },
  });
  const result = await tool('list_account_entities').handler({ locationId: 'L' }, deps(gw));

  assert.deepEqual(result, { ok: true, data: {
    pipelines: [], calendars: [], users: [], forms: [], customFields: [], agents: [],
  } });
});

test('list_workflows encodes a hostile location id as one path segment', async () => {
  const gw = gwStub({ '/workflow/': { rows: [] } });
  const locationId = 'L /?&=#';
  const result = await tool('list_workflows').handler({ locationId }, deps(gw));

  assert.equal(result.ok, true);
  assert.match(gw.calls[0].path, new RegExp(`^/workflow/${encodeURIComponent(locationId)}/list\\?`));
  assert.doesNotMatch(gw.calls[0].path, /\/workflow\/L \/\?/);
});

test('raw_request refuses non-GET without making a gateway call', async () => {
  const gw = gwStub();
  const result = await tool('raw_request').handler(
    { locationId: 'L', method: 'POST', path: '/x' },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.equal(gw.calls.length, 0);
});

test('raw_request passes a GET through', async () => {
  const gw = gwStub({ '/ping': { pong: true } });
  const result = await tool('raw_request').handler(
    { locationId: 'L', method: 'GET', path: '/ping' },
    deps(gw),
  );

  assert.deepEqual(result, { ok: true, data: { status: 200, json: { pong: true } } });
});

test('raw_request scrubs JWT-looking values returned by an upstream endpoint', async () => {
  const secret = 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz.signature';
  const result = await tool('raw_request').handler(
    { locationId: 'L', method: 'GET', path: '/debug' },
    deps(gwStub({ '/debug': { authorization: `Bearer ${secret}` } })),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.json.authorization, '<redacted>');
  assert.doesNotMatch(JSON.stringify(result), /eyJ/);
});

test('raw_request rejects JWT-looking paths without echoing the value', async () => {
  const secret = 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz.signature';
  const result = await tool('raw_request').handler(
    { locationId: 'L', method: 'GET', path: `/debug?token=${secret}` },
    deps(gwStub()),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /eyJ/);
});

test('typed tools reject JWT-looking values in any argument without making a call', async () => {
  const secret = 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz.signature';
  const gw = gwStub();
  const result = await tool('get_workflow').handler(
    { locationId: 'L', workflowId: secret },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /eyJ/);
  assert.equal(gw.calls.length, 0);
});

test('upstream failure becomes the error contract', async () => {
  const result = await tool('get_workflow').handler(
    { locationId: 'L', workflowId: 'missing' },
    deps(gwStub()),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_404');
});

test('every handler returns the stable contract for undefined direct arguments', async () => {
  for (const candidate of TOOLS) {
    let result;
    await assert.doesNotReject(async () => {
      result = await candidate.handler(undefined, undefined);
    }, `${candidate.name} threw`);
    assert.equal(typeof result?.ok, 'boolean', `${candidate.name} did not return the stable contract`);
  }
});
