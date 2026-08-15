import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'list_marketplace_apps');

const APP = {
  appId: 'APP1', name: 'Test App', companyName: 'Vendor', totalInstallations: 10,
  averageRating: 4.7, isInstalled: true,
  actions: [{ key: 'act_a', version: '1.0', templateId: 'T1',
              inputs: [{ field: 'message', title: 'Message', required: true, fieldType: 'textarea' }] }],
  triggers: [{ key: 'trg_a', version: '1.3', templateId: 'T2',
               customVars: [{ reference: 'payload.message.text', name: 'Message', fieldType: 'string' }] }],
};

const deps = (captured) => ({
  state: {},
  makeGw: () => ({
    call: async (method, path) => {
      captured.push(path);
      return { ok: true, status: 200, json: path.includes('type=actions') ? [APP] : [APP] };
    },
  }),
});

test('the tool exists and declares only GET capabilities', () => {
  assert.ok(tool, 'list_marketplace_apps must be registered');
  assert.ok(tool.capabilities.length > 0);
  for (const c of tool.capabilities) assert.equal(c.method, 'GET');
});

test('compact mode returns identity plus keys and versions only', async () => {
  const paths = [];
  const res = await tool.handler({ locationId: 'LOC', type: 'both', compact: true }, deps(paths));
  assert.equal(res.ok, true);
  const app = res.data.apps[0];
  assert.equal(app.appId, 'APP1');
  assert.equal(app.companyName, 'Vendor');
  assert.deepEqual(app.actions, [{ key: 'act_a', version: '1.0' }]);
  assert.equal(app.actions[0].inputs, undefined, 'compact must omit the full schema');
});

test('full mode returns inputs and customVars', async () => {
  const res = await tool.handler({ locationId: 'LOC', type: 'both', compact: false }, deps([]));
  const app = res.data.apps[0];
  assert.equal(app.actions[0].inputs[0].field, 'message');
  assert.equal(app.triggers[0].customVars[0].reference, 'payload.message.text');
});

test('type:triggers reads only the triggers page', async () => {
  const paths = [];
  await tool.handler({ locationId: 'LOC', type: 'triggers', compact: true }, deps(paths));
  assert.ok(paths.every((p) => !p.includes('type=actions')));
  assert.ok(paths.some((p) => p.includes('type=triggers')));
});

test('appId filters to one app', async () => {
  const res = await tool.handler({ locationId: 'LOC', appId: 'OTHER', compact: true }, deps([]));
  assert.equal(res.data.apps.length, 0);
});
