// repair_workflow is the sanctioned whole-document write. Its description had promised "workflow
// rules" since it shipped, but only the commit guards actually ran — and none of the build path's
// pre-write ladder (asset validator, sandbox, graph-context, readiness, persisted required fields,
// opportunity intent) did. 0.48.0 ported the ladder to edit_workflow; this pins the same ladder
// here, through the SAME shared helpers, with the one difference that matters: there is no op
// list, so the diff against the stored document is the gate and the touched set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const repairTool = () => TOOLS.find((t) => t.name === 'repair_workflow');

const TAG = (id, over = {}) => ({ id, type: 'add_contact_tag', name: id, next: null, parentKey: null, order: 0, attributes: { tags: ['x'] }, ...over });
const CODE = (over = {}) => ({
  id: 'cc1', type: 'custom_code', name: 'Compute', next: null, parentKey: null, order: 1,
  attributes: { type: 'custom_code', language: 'javascript', code: 'output = { a: 1 }', inputData: { x: '1' }, output: { a: 'sample' } },
  ...over,
});
const SMS = (over = {}) => ({ id: 'sms1', type: 'sms', name: 'Nudge', next: null, parentKey: null, order: 1, attributes: { type: 'sms', body: 'original' }, ...over });

const workflow = (templates) => ({ _id: 'WID', id: 'WID', name: 'Flow', status: 'draft', version: 7, workflowData: { templates } });

function gateway(templates, {
  assetVerdict = { errors: [], warnings: [] },
  sandbox = { output: { b: 2 }, hasError: false },
  phoneNumbers = [],
} = {}) {
  const calls = [];
  let stored = structuredClone(workflow(templates));
  const gw = {
    loc: 'LOC', uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'POST' && path === '/workflow/LOC/validate-assets') return { ok: true, status: 200, json: structuredClone(assetVerdict) };
      if (method === 'POST' && path === '/workflow/custom-code/run-test') return { ok: true, status: 200, json: structuredClone(sandbox) };
      if (method === 'GET' && path.startsWith('/phone-system/numbers')) return { ok: true, status: 200, json: { phoneNumbers: structuredClone(phoneNumbers) } };
      if (method === 'GET' && path.includes('/workflows-marketplace/')) return { ok: true, status: 200, json: { actions: [], triggers: [] } };
      if (method === 'GET' && path.includes('/customFields/search')) return { ok: true, status: 200, json: { customFields: [] } };
      if (method === 'GET' && path === '/locations/LOC/customValues') return { ok: true, status: 200, json: { customValues: [] } };
      if (method === 'GET' && path.includes('/trigger')) return { ok: true, status: 200, json: { triggers: [] } };
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { ok: true, status: 200, json: structuredClone(stored) };
      if (method === 'PUT' && path.startsWith('/workflow/LOC/WID')) {
        stored = { ...stored, ...structuredClone(body), version: stored.version + 1 };
        return { ok: true, status: 200, json: structuredClone(stored) };
      }
      return { ok: false, status: 404, json: {} };
    },
    stored: () => stored,
  };
  return { gw, calls };
}
const deps = (gw) => ({ state: {}, makeGw: () => gw });
const run = (gw, templates, extra = {}) => repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates, ...extra }, deps(gw));

const USER_GONE = (stepId) => ({ ruleId: 'ASSET_USER_NOT_FOUND', assetType: 'user', assetId: 'u1', message: 'user not found', severity: 'error', stepId });

test('an asset error on a step the repair changed refuses it, naming ignoreAssetErrors', async () => {
  const { gw, calls } = gateway([TAG('s1')], { assetVerdict: { errors: [USER_GONE('s1')], warnings: [] } });
  const changed = [TAG('s1', { attributes: { tags: ['y'] } })];
  const refused = await run(gw, changed, { confirm: true });
  assert.equal(refused.code, 'VALIDATION_FAILED');
  assert.match(refused.remediation, /ignoreAssetErrors/);
  assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [], 'refused before any write');

  const hatched = await run(gateway([TAG('s1')], { assetVerdict: { errors: [USER_GONE('s1')], warnings: [] } }).gw, changed, { confirm: true, ignoreAssetErrors: true });
  assert.equal(hatched.ok, true);
  assert.equal(hatched.data.assetPreflight.errors.length, 1);
});

test('an asset error on a step the repair did NOT change is legacy debt — warns, does not block', async () => {
  const { gw } = gateway([TAG('s1'), TAG('s2')], { assetVerdict: { errors: [USER_GONE('s2')], warnings: [] } });
  const result = await run(gw, [TAG('s1', { attributes: { tags: ['y'] } }), TAG('s2')], { confirm: true });
  assert.equal(result.ok, true);
  assert.ok(result.data.warnings.some((w) => /pre-existing, untouched/.test(w)));
});

test('an unchanged document sends nothing new — the diff is the gate', async () => {
  const { gw, calls } = gateway([TAG('s1'), CODE(), SMS()]);
  const result = await run(gw, [TAG('s1'), CODE(), SMS()], { confirm: true });
  assert.equal(result.ok, true);
  const extra = calls.filter((c) => c.path.endsWith('/validate-assets') || c.path.endsWith('/run-test')
    || c.path.startsWith('/phone-system/') || c.path.includes('/workflows-marketplace/'));
  assert.deepEqual(extra, [], 'no changed step, so no validator call');
});

test('a changed custom_code step runs in the sandbox and the REAL output reaches the PUT; strict refuses a failure', async () => {
  const { gw, calls } = gateway([CODE()], { sandbox: { output: { b: 2 }, hasError: false } });
  const result = await run(gw, [CODE({ attributes: { ...CODE().attributes, code: 'output = { b: 2 }' } })], { confirm: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(calls.filter((c) => c.path === '/workflow/custom-code/run-test').length, 1);
  assert.deepEqual(gw.stored().workflowData.templates[0].attributes.output, { b: 2 });
  assert.equal(result.data.customCodeTests[0].replacedOutput, true);

  const strict = gateway([CODE()], { sandbox: { hasError: true, errorMessage: 'boom' } });
  const refused = await run(strict.gw, [CODE({ attributes: { ...CODE().attributes, code: 'throw 1' } })], { confirm: true, strictCustomCode: true });
  assert.equal(refused.code, 'ENGINE_ABORT');
  assert.match(refused.detail, /boom/);
  assert.deepEqual(strict.calls.filter((c) => c.method === 'PUT'), []);
});

test('a changed SMS step on a location with no number warns, advisorily', async () => {
  const { gw } = gateway([SMS()], { phoneNumbers: [] });
  const result = await run(gw, [SMS({ attributes: { type: 'sms', body: 'hi' } })], { confirm: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.readiness.find((c) => c.key === 'sms_number').ok, false);
  assert.ok(result.data.warnings.some((w) => /readiness: NO SMS number/.test(w)));
});

test('a goto with a step after it warns (graph-context), and the preview carries every verdict', async () => {
  const templates = [
    TAG('p', { next: 'g' }),
    { id: 'g', type: 'goto', name: 'Jump', next: 'x', parentKey: null, order: 1, attributes: { type: 'goto', targetNodeId: 'x' } },
    TAG('x', { order: 2 }),
  ];
  const { gw, calls } = gateway(templates, { assetVerdict: { errors: [], warnings: [USER_GONE('x')] } });
  const changed = structuredClone(templates); changed[2].attributes.tags = ['y'];
  const preview = await run(gw, changed, { allowGotoLoops: true });
  assert.equal(preview.code, 'CONFIRM_REQUIRED');
  assert.ok(preview.data.preview.warnings.some((w) => /goto/.test(w) && /unreachable/.test(w)));
  assert.equal(preview.data.preview.assetPreflight.warnings.length, 1);
  assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [], 'the preview wrote nothing');
});
