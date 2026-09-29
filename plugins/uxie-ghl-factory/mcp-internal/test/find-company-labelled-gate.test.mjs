// bl-315 (live 2026-09-29, 1.25.0): a Find company authored with no marketplace:true node anywhere drew
// "VALIDATION ATTRIBUTE_KEY unknown attribute key(s) [cat, convertToMultipath, transitions, __name__]". The gate's
// marketplace types were derived from the IR's marketplace flags, so they were an empty set and the step's
// INTERNAL label could not be confirmed. They now follow the COMPILED document, on build and on edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS } from '../core/tools.mjs';
import { orchestrate } from '../../skills/create-ghl-workflow/engine/orchestrate.mjs';
import { hasAssetLabelledStep } from '../../skills/create-ghl-workflow/engine/marketplace.mjs';

const enginePath = (file) => new URL(`../../skills/create-ghl-workflow/engine/fixtures/${file}`, import.meta.url);
const BASE_ASSETS = JSON.parse(readFileSync(enginePath('marketplace-assets.json'), 'utf8'));
// The company catalogue lists Find company as an INTERNAL action (live read 2026-09-29, default,company).
const withFind = () => {
  const a = structuredClone(BASE_ASSETS);
  a.actions = [...(a.actions ?? []), { appName: 'company', actions: [{ key: 'co_find_company_record', name: 'Find company',
    workflowsActionType: 'INTERNAL', section: 'company', inputs: [] }] }];
  return a;
};
const isAssets = (path) => path.startsWith('/workflows-marketplace/location/LOC/assets');
const keyWarnings = (warnings) => (warnings ?? []).filter((w) => /ATTRIBUTE_KEY/.test(w) && /Find company/.test(w));

const FIND = { ref: 'f', type: 'co_find_company_record', name: 'Find company',
  find: { filter_on: 'earliest', filters: [{ field: 'business.name__TEXT', value: '{{inboundWebhookRequest.x}}' }] },
  onFound: [{ ref: 'w', kind: 'wait', name: 'Found: wait', waitType: 'time', attributes: { type: 'time', startAfter: { type: 'minutes', value: 1, when: 'after' } } }],
  onNotFound: [] };

test('hasAssetLabelledStep reads the label, not the IR flag', () => {
  assert.equal(hasAssetLabelledStep([{ type: 'co_find_company_record', workflowsActionType: 'INTERNAL' }]), true);
  assert.equal(hasAssetLabelledStep([{ type: 'sms' }, { type: 'wait' }]), false);
  assert.equal(hasAssetLabelledStep(undefined), false);
});

function buildGateway(assets) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && isAssets(path)) return { ok: true, status: 200, json: assets };
    if (method === 'GET' && path.includes('/marketplace/core/search/module')) return { ok: true, status: 200, json: [] };
    if (method === 'GET' && path.includes('/opportunities/pipelines')) return { ok: true, json: { pipelines: [] } };
    if (method === 'GET' && path.includes('/calendars/')) return { ok: true, json: { calendars: [] } };
    if (method === 'GET' && path.includes('/users/')) return { ok: true, json: { users: [] } };
    if (method === 'GET' && path.includes('/forms/')) return { ok: true, json: { forms: [] } };
    if (method === 'GET' && path.includes('/customFields')) return { ok: true, json: { customFields: [] } };
    if (method === 'GET' && (path.includes('/voice-ai/') || path.includes('/ai-employees/'))) return { ok: false, json: {} };
    if (method === 'GET' && path.match(/\/tags$/)) return { ok: true, json: { tags: [] } };
    if (method === 'POST' && path.match(/\/workflow\/[^/]+$/)) return { ok: true, json: { id: 'WID_1' } };
    if (method === 'PUT' && path.includes('/auto-save')) return { ok: true, json: {} };
    if (method === 'POST' && path.includes('/trigger')) return { ok: true, json: { id: 'TRIG_1' } };
    return { ok: true, json: {} };
  };
  return { gw: { call, loc: 'LOC', uid: 'UID' }, calls };
}
const findIr = () => ({ name: 'W', workflowType: 'business', triggers: [{ ref: 'h', type: 'inbound_webhook', name: 'hook', filters: [] }], graph: [structuredClone(FIND)] });

test('build: Find company authored alone draws no ATTRIBUTE_KEY on its own container keys', async () => {
  const { gw, calls } = buildGateway(withFind());
  const report = await orchestrate(findIr(), gw);
  assert.deepEqual(keyWarnings(report.warnings), []);
  assert.ok(calls.some(({ path }) => path.includes('/marketplace/core/search/module')), 'the labelled step made the gate read the list');
});

test('CONTROL build: when the list does not confirm Find company, the key check still runs and warns', async () => {
  const { gw } = buildGateway(structuredClone(BASE_ASSETS));
  const report = await orchestrate(findIr(), gw);
  assert.equal(keyWarnings(report.warnings).length, 1, 'an unconfirmed label must not switch the check off');
});

test('CONTROL build: a native build still reads no marketplace install list', async () => {
  const { gw, calls } = buildGateway(withFind());
  await orchestrate({ name: 'W', triggers: [], graph: [{ ref: 's', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }] }, gw);
  assert.equal(calls.some(({ path }) => path.includes('/marketplace/core/search/module')), false);
});

// ── edit_workflow: add Find company to a native-only company workflow ──
const editTool = () => TOOLS.find((t) => t.name === 'edit_workflow');
const companyWorkflow = () => ({
  _id: 'WID', id: 'WID', name: 'Company wf', status: 'draft', version: 3, workflowType: 'business',
  workflowData: { templates: [
    { id: 'w1', type: 'wait', name: 'Wait', next: null, parent: null, parentKey: null, order: 0,
      attributes: { type: 'time', startAfter: { type: 'minutes', value: 1, when: 'after' } } },
  ] },
});
function editGateway(assets) {
  const calls = [];
  let current = companyWorkflow();
  const gw = { loc: 'LOC', uid: 'USER', call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/customFields/search')) return { status: 200, ok: true, json: { customFields: [] } };
    if (method === 'GET' && path === '/locations/LOC/customValues') return { status: 200, ok: true, json: { customValues: [] } };
    if (method === 'GET' && path === '/locations/LOC/tags') return { status: 200, ok: true, json: { tags: [] } };
    if (method === 'GET' && isAssets(path)) return { status: 200, ok: true, json: assets };
    if (method === 'GET' && path === '/workflow/LOC/WID?includeScheduledPauseInfo=true') return { status: 200, ok: true, json: structuredClone(current) };
    if (method === 'GET' && path === '/workflow/LOC/trigger?workflowId=WID') return { status: 200, ok: true, json: [{ id: 'T1', type: 'inbound_webhook', name: 'hook', workflowId: 'WID', conditions: [], actions: [] }] };
    if (method === 'POST' && path === '/workflow/LOC/WID/validate-workflows') return { status: 201, ok: true, json: { valid: true } };
    if (method === 'PUT' && path === '/workflow/LOC/WID') { current = { ...structuredClone(body), version: current.version + 1 }; return { status: 200, ok: true, json: { id: 'WID' } }; }
    return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
  } };
  return { gw, calls };
}
const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });
const appendFind = { op: 'appendStep', step: structuredClone(FIND) };

test('edit: appending Find company to a native-only workflow draws no ATTRIBUTE_KEY', async () => {
  const { gw, calls } = editGateway(withFind());
  const r = await editTool().handler({ locationId: 'LOC', workflowId: 'WID', confirm: true, ops: [appendFind] }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 800));
  assert.deepEqual(keyWarnings(r.data?.warnings ?? r.warnings), []);
  assert.ok(calls.some(({ path }) => isAssets(path)), 'the touched labelled step made the gate read the list');
});

test('CONTROL edit: when the list does not confirm Find company, the key check still warns', async () => {
  const { gw } = editGateway(structuredClone(BASE_ASSETS));
  const r = await editTool().handler({ locationId: 'LOC', workflowId: 'WID', confirm: true, ops: [appendFind] }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 800));
  assert.equal(keyWarnings(r.data?.warnings ?? r.warnings).length, 1);
});
