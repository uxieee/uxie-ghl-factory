// check_workflow has NO MCP-level handler test elsewhere in this directory — grep -rl
// check_workflow test/ finds only the registry-name list (audit-registration.test.mjs).
// This branch replaced check_workflow's `fetchActionSchema` call with an inlined fetch and
// added a `marketplaceDrift` key computed from a SEPARATE trigger schema — swapping
// `triggerSchema` for `actionSchema` at either call site would break NO existing test.
//
// This file asserts the ONE property that actually distinguishes the two schemas: a
// required-field error must come from the ACTION schema, and marketplaceDrift must come
// from the TRIGGER schema — proven by using keys that exist in only ONE of the two schema
// buckets, so a swap makes the corresponding lookup miss entirely (undefined spec), not
// just resolve to a wrong-but-present value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'check_workflow');

const LOC = 'LOC1';
const WID = 'WID1';

// 'drift_only_action' — declared ONLY in the actions bucket, with one required field.
// checkWorkflow must find its required-field error via the ACTION schema. If the call site
// were swapped to consult the trigger schema instead, this key would be absent there
// (undefined spec), and missingForStep would silently report nothing.
const ACTION_TYPE = 'drift_only_action';

// 'drift_only_trigger' — declared ONLY in the triggers bucket, with a stored version/
// templateId that differs from what assets now reports. marketplaceDrift must compute
// against the TRIGGER schema. If the call site were swapped to the action schema instead,
// this key would be absent there (undefined spec), and marketplaceDrift would report []
// instead of one entry — `if (!spec) continue` in marketplaceDrift.
const TRIGGER_TYPE = 'drift_only_trigger';

const workflowBody = {
  name: 'WF',
  status: 'draft',
  workflowData: {
    templates: [
      { id: 's1', type: ACTION_TYPE, name: 'Step A', attributes: {} },
    ],
  },
};

const triggerListBody = {
  triggers: [
    { type: TRIGGER_TYPE, name: 'Trig', masterType: 'marketplace', version: '1.0', templateId: 'TPL-OLD' },
  ],
};

const assetsBody = {
  actions: [{
    appName: 'App',
    actions: [{
      key: ACTION_TYPE, version: '9.9', templateId: 'TPL-ACTION',
      inputs: [{ field: 'foo', title: 'Foo', required: true, fieldType: 'string' }],
    }],
  }],
  triggers: [{
    appName: 'App',
    triggers: [{ key: TRIGGER_TYPE, version: '2.0', templateId: 'TPL-NEW' }],
  }],
};

const deps = () => ({
  state: {},
  makeGw: () => ({
    call: async (method, path) => {
      if (path.includes('/trigger?')) return { ok: true, status: 200, json: triggerListBody };
      if (path.includes('/workflows-marketplace/')) return { ok: true, status: 200, json: assetsBody };
      if (path.startsWith(`/workflow/${LOC}/${WID}`)) return { ok: true, status: 200, json: workflowBody };
      throw new Error(`unexpected path in check_workflow test mock: ${path}`);
    },
  }),
});

test('check_workflow is registered', () => {
  assert.ok(tool, 'check_workflow must be registered');
});

test('check_workflow: response carries both errors/errorCount and marketplaceDrift', async () => {
  const res = await tool.handler({ locationId: LOC, workflowId: WID }, deps());
  assert.equal(res.ok, true);
  assert.equal(typeof res.data.errorCount, 'number');
  assert.ok(Array.isArray(res.data.errors));
  assert.ok(Array.isArray(res.data.marketplaceDrift));
});

// The load-bearing assertion: a workflow whose TRIGGER drifted reports it in
// marketplaceDrift. This can only pass if marketplaceDrift is computed from the TRIGGER
// schema — the trigger key does not exist in the action schema at all.
test('check_workflow: a drifted trigger is reported in marketplaceDrift, computed from the TRIGGER schema', async () => {
  const res = await tool.handler({ locationId: LOC, workflowId: WID }, deps());
  assert.equal(res.data.marketplaceDrift.length, 1);
  assert.equal(res.data.marketplaceDrift[0].type, TRIGGER_TYPE);
  assert.equal(res.data.marketplaceDrift[0].kind, 'templateId');
  assert.equal(res.data.marketplaceDrift[0].installed.templateId, 'TPL-NEW');
});

// The other load-bearing assertion: a step's required-field error still comes from the
// ACTION schema — the action key does not exist in the trigger schema at all.
test('check_workflow: a step\'s required-field error is computed from the ACTION schema', async () => {
  const res = await tool.handler({ locationId: LOC, workflowId: WID }, deps());
  assert.equal(res.data.errorCount, 1);
  const err = res.data.errors.find((e) => e.type === ACTION_TYPE);
  assert.ok(err, 'the step must be reported');
  assert.ok(err.fields.includes('foo'));
});

// This is the test that fails if the two schemas were swapped at either call site: with
// ACTION_TYPE only in the action bucket and TRIGGER_TYPE only in the trigger bucket, a
// swap makes ONE of the two lookups miss entirely (undefined spec -> no error / no drift
// entry), which either of the two tests above would catch. This test pins both properties
// together in one assertion so a future edit cannot "fix" one at the cost of the other.
test('check_workflow: swapping the two schemas at the drift or required-field call site would fail this test', async () => {
  const res = await tool.handler({ locationId: LOC, workflowId: WID }, deps());
  assert.equal(res.data.errorCount, 1, 'required-field error must come from the ACTION schema');
  assert.equal(res.data.marketplaceDrift.length, 1, 'drift must come from the TRIGGER schema');
});
