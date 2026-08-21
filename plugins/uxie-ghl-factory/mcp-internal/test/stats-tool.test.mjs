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
          : { status: 200, ok: true, json: typeof response === 'function' ? response(path) : response };
      }
      return { status: 404, ok: false, json: { message: `no stub for ${path}` } };
    },
  };
}
const deps = (gw) => ({ state: { tokenFile: '/x' }, makeGw: () => gw, now: '2026-08-22T10:00:00.000Z' });

test('get_workflow_stats exists, is read-only, and declares exactly the Stats-view endpoints', () => {
  const t = tool('get_workflow_stats');
  assert.ok(t);
  assert.deepEqual(t.capabilities.map((c) => `${c.method} ${c.path}`), [
    'GET /workflow/{loc}/{wid}', 'GET /workflow/{loc}/trigger',
    'GET /conversations-reporting/messages/aggregate', 'GET /conversations-reporting/emails/aggregate',
    'GET /workflows/trigger/logs/count-by-triggerId', 'GET /workflows/status/search/count-per-step',
  ]);
  assert.ok(t.capabilities.every((c) => c.method === 'GET'));
});

test('aggregates per sms/email step, counts per trigger, contacts per step — with the builder\'s own 30-day window', async () => {
  const gw = gwStub({
    '/workflow/L/w1?': { _id: 'w1', status: 'published', workflowData: { templates: [
      { id: 's1', type: 'sms', name: 'Hello SMS' }, { id: 's2', type: 'email', name: 'Mail' }, { id: 's3', type: 'add_contact_tag', name: 'Tag' },
    ] } },
    '/workflow/L/trigger?': [{ id: 't1', name: 'Tag trigger', type: 'contact_tag', active: true }],
    '/conversations-reporting/messages/aggregate': { results: { sent: { value: 10 }, delivered: { value: 9 }, unfulfilled: { value: 1 }, optOut: { value: 0 } }, total: 10 },
    '/conversations-reporting/emails/aggregate': { results: { sent: { value: 4 }, delivered: { value: 4 }, permanentFail: { value: 0 }, rates: { open: 0.5 } }, total: 4 },
    '/workflows/trigger/logs/count-by-triggerId': [{ total: 7, matched: 5 }],
    '/workflows/status/search/count-per-step': [{ total: 3, currentStepId: 's1' }],
  });
  const result = await tool('get_workflow_stats').handler({ locationId: 'L', workflowId: 'w1' }, deps(gw));
  assert.equal(result.ok, true, JSON.stringify(result));
  const d = result.data;
  assert.equal(d.window.startDate, '2026-07-23T00:00:00.000+00:00');
  assert.equal(d.window.endDate, '2026-08-22T23:59:59.999+00:00');
  assert.equal(d.steps.length, 2, 'only sms + email steps get aggregates');
  assert.deepEqual(d.steps[0], { id: 's1', name: 'Hello SMS', type: 'sms', channel: 'messages', total: 10, metrics: { sent: 10, delivered: 9, unfulfilled: 1, optOut: 0 }, rates: null });
  assert.equal(d.steps[1].channel, 'emails'); assert.deepEqual(d.steps[1].rates, { open: 0.5 });
  assert.equal(d.stepsWithoutStats, 1);
  assert.deepEqual(d.triggers, [{ id: 't1', name: 'Tag trigger', type: 'contact_tag', active: true, attempted: 7, matched: 5, unmatched: 2 }]);
  assert.deepEqual(d.contactsPerStep, [{ stepId: 's1', total: 3 }]);
  const agg = gw.calls.find((c) => c.path.includes('messages/aggregate'));
  assert.match(agg.path, /source=workflow&sourceId=w1&subSourceId=s1&locationId=L/);
  const cnt = gw.calls.find((c) => c.path.includes('count-by-triggerId'));
  assert.match(cnt.path, /triggerId=t1&locationId=L&fromDate=\d+&toDate=\d+&recordId=&dateType=custom/);
});

test('an empty trigger count ([]) reads as 0/0/0; a failed aggregate is recorded per step, not fatal', async () => {
  const gw = gwStub({
    '/workflow/L/w1?': { _id: 'w1', status: 'draft', workflowData: { templates: [{ id: 's1', type: 'sms', name: 'S' }] } },
    '/workflow/L/trigger?': [{ id: 't1', type: 'contact_tag' }],
    '/conversations-reporting/messages/aggregate': { status: 500, ok: false, json: { message: 'boom' } },
    '/workflows/trigger/logs/count-by-triggerId': [],
    '/workflows/status/search/count-per-step': [],
  });
  const result = await tool('get_workflow_stats').handler({ locationId: 'L', workflowId: 'w1', days: 7 }, deps(gw));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.steps[0].error, { status: 500 });
  assert.deepEqual(result.data.triggers[0], { id: 't1', name: null, type: 'contact_tag', active: null, attempted: 0, matched: 0, unmatched: 0 });
  assert.equal(result.data.window.days, 7);
  assert.equal(result.data.window.startDate, '2026-08-15T00:00:00.000+00:00');
});

test('a missing workflow maps to the HTTP error contract', async () => {
  const gw = gwStub({ '/workflow/L/nope?': { status: 404, ok: false, json: { message: 'not found' } } });
  const result = await tool('get_workflow_stats').handler({ locationId: 'L', workflowId: 'nope' }, deps(gw));
  assert.equal(result.ok, false);
});
