import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFF } from './ff.mjs';

function stubGateway({ rows = [] } = {}) {
  const calls = [];
  const gw = {
    loc: 'LOC_1',
    uid: 'USER_1',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.includes('/details-by-step?')) {
        const query = new URLSearchParams(path.split('?')[1]);
        const skip = Number(query.get('skip'));
        const limit = Number(query.get('limit'));
        return { status: 200, ok: true, json: { totalCount: rows.length, rows: rows.slice(skip, skip + limit) } };
      }
      if (method === 'POST' && path.includes('/requeue-stuck-statuses/')) {
        return { status: 200, ok: true, json: { queued: body.statusIds } };
      }
      throw new Error(`unexpected gateway call: ${method} ${path}`);
    },
  };
  return { gw, calls };
}

test('move uses supplied workflow-status IDs without looking up parked contacts', async () => {
  const { gw, calls } = stubGateway();
  const result = await makeFF({ gw }).move('WID_1', 'STEP_1', { statusIds: ['STATUS_1', 'STATUS_2'] });

  assert.equal(result.moved, 2);
  assert.deepEqual(result.statusIds, ['STATUS_1', 'STATUS_2']);
  assert.deepEqual(calls, [{
    method: 'POST',
    path: '/workflow/LOC_1/WID_1/requeue-stuck-statuses/STEP_1',
    body: {
      actionFrom: { userId: 'USER_1', channel: 'web_app', source: 'action_stats_page' },
      statusIds: ['STATUS_1', 'STATUS_2'],
    },
  }]);
});

test('move resolves a contact selector to that contact’s parked workflow-status ID', async () => {
  const { gw, calls } = stubGateway({ rows: [
    { _id: 'STATUS_1', contactId: 'CONTACT_OTHER' },
    { _id: 'STATUS_2', contactId: 'CONTACT_TARGET' },
  ] });
  const result = await makeFF({ gw }).move('WID_1', 'STEP_1', { contactId: 'CONTACT_TARGET' });

  assert.equal(result.moved, 1);
  assert.deepEqual(result.statusIds, ['STATUS_2']);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].path, /workflowId=WID_1/);
  assert.match(calls[0].path, /locationId=LOC_1/);
  assert.match(calls[0].path, /currentStepId=STEP_1/);
  assert.deepEqual(calls.at(-1).body.statusIds, ['STATUS_2']);
});

test('move all walks 50-row details-by-step pages through totalCount before requeueing', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ _id: `STATUS_${index + 1}`, contactId: `CONTACT_${index + 1}` }));
  const { gw, calls } = stubGateway({ rows });
  const result = await makeFF({ gw }).move('WID_1', 'STEP_1', { all: true });

  assert.equal(result.moved, 51);
  assert.deepEqual(result.statusIds, rows.map((row) => row._id));
  assert.deepEqual(calls.filter((call) => call.method === 'GET').map((call) => call.path.match(/[?&]skip=(\d+)/)[1]), ['0', '50']);
  assert.deepEqual(calls.at(-1).body.statusIds, rows.map((row) => row._id));
});

test('HTTP failures still throw for CLI callers while preserving the structured gateway response', async () => {
  const gatewayResponse = { status: 429, ok: false, json: { message: 'slow down' } };
  const gw = {
    loc: 'LOC_1',
    uid: 'USER_1',
    call: async () => gatewayResponse,
  };

  await assert.rejects(
    () => makeFF({ gw }).parkedAt('WID_1', 'STEP_1'),
    (error) => {
      assert.match(error.message, /GET .*429.*slow down/);
      assert.deepEqual(error.gatewayResponse, gatewayResponse);
      return true;
    },
  );
});

test('allParked follows totalCount across short intermediate pages and advances by actual rows', async () => {
  const rows = Array.from({ length: 75 }, (_, index) => ({
    _id: `STATUS_${index + 1}`,
    contactId: `CONTACT_${index + 1}`,
  }));
  const skips = [];
  const gw = {
    loc: 'LOC_1',
    uid: 'USER_1',
    call: async (_method, path) => {
      const query = new URLSearchParams(path.split('?')[1]);
      const skip = Number(query.get('skip'));
      skips.push(skip);
      return { status: 200, ok: true, json: { totalCount: rows.length, rows: rows.slice(skip, skip + 25) } };
    },
  };

  const result = await makeFF({ gw }).allParked('WID_1', 'STEP_1');
  assert.equal(result.length, 75);
  assert.deepEqual(skips, [0, 25, 50]);
});

test('allParked fails explicitly when pagination makes no progress before totalCount', async () => {
  const firstPage = Array.from({ length: 25 }, (_, index) => ({ _id: `STATUS_${index + 1}` }));
  const skips = [];
  const gw = {
    loc: 'LOC_1',
    uid: 'USER_1',
    call: async (_method, path) => {
      const query = new URLSearchParams(path.split('?')[1]);
      const skip = Number(query.get('skip'));
      skips.push(skip);
      return {
        status: 200,
        ok: true,
        json: { totalCount: 75, rows: skip === 0 ? firstPage : [] },
      };
    },
  };

  await assert.rejects(
    () => makeFF({ gw }).allParked('WID_1', 'STEP_1'),
    /pagination stalled.*25.*75/i,
  );
  assert.deepEqual(skips, [0, 25]);
});
