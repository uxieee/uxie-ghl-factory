// edit_workflow on the MARKETPLACE rail: retyping a native step into a third-party
// action inside a workflow that already exists.
//
// The gateway fixture here mirrors test/edit-workflow.test.mjs's, plus the two marketplace
// catalog reads. The load-bearing assertion in this file is the NEGATIVE one: a purely
// native edit must issue exactly the requests it issued before this feature existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS } from '../core/tools.mjs';
import { stripNullNext } from '../../skills/create-ghl-workflow/engine/terminals.mjs';

const editTool = () => TOOLS.find((candidate) => candidate.name === 'edit_workflow');

const enginePath = (file) => new URL(
  `../../skills/create-ghl-workflow/engine/fixtures/${file}`, import.meta.url);
const ASSETS = JSON.parse(readFileSync(enginePath('marketplace-assets.json'), 'utf8'));
const MODULES = JSON.parse(readFileSync(enginePath('marketplace-modules.json'), 'utf8'));

const ASSETS_PATH = '/workflows-marketplace/location/LOC/assets?workflowTypes=default,contacts';
const modulePath = (type) =>
  `/marketplace/core/search/module?locationId=LOC&type=${type}&isInstalled=true&skip=0&limit=200`;

const smsWorkflow = () => ({
  _id: 'WID', id: 'WID', name: 'Reply to Engaged', status: 'draft', version: 7,
  workflowData: {
    templates: [
      { id: 's1', type: 'sms', name: 'Instant SMS', next: 's2', parent: null, parentKey: null, order: 0,
        attributes: { body: 'Hi {{contact.first_name}}' } },
      { id: 's2', type: 'wait', name: 'Wait', next: 's3', parent: null, parentKey: 's1', order: 1,
        attributes: { duration: '1', unit: 'hours' } },
      { id: 's3', type: 'sms', name: 'Follow-up SMS', next: null, parent: null, parentKey: 's2', order: 2,
        attributes: { body: 'Still there?' } },
    ],
  },
});

function editGateway({ initial = smsWorkflow() } = {}) {
  const calls = [];
  let current = structuredClone(initial);
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.includes('/customFields/search')) return { status: 200, ok: true, json: { customFields: [] } };
      if (method === 'GET' && path === '/locations/LOC/tags') return { status: 200, ok: true, json: { tags: [] } };
      if (method === 'GET' && path === ASSETS_PATH) return { status: 200, ok: true, json: ASSETS };
      if (method === 'GET' && path === modulePath('actions')) return { status: 200, ok: true, json: MODULES.actions };
      if (method === 'GET' && path === modulePath('triggers')) return { status: 200, ok: true, json: MODULES.triggers };
      if (method === 'GET' && path === '/workflow/LOC/WID?includeScheduledPauseInfo=true') {
        return { status: 200, ok: true, json: structuredClone(current) };
      }
      if (method === 'PUT' && path === '/workflow/LOC/WID') {
        current = { ...structuredClone(body), version: current.version + 1 };
        return { status: 200, ok: true, json: { id: 'WID' } };
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  };
  return { gw, calls, current: () => current };
}

const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });

const retypeToWa = (stepId, message, name) => ({
  op: 'retypeStep',
  stepId,
  step: {
    kind: 'action', marketplace: true, type: 'imessage_a', name,
    attributes: { message, attachment: '', connected_phone: '', __dynamicAttachments__: {}, __customInputs__: {} },
  },
});

const marketplaceReads = (calls) => calls.filter(({ path }) =>
  path.includes('/workflows-marketplace/') || path.includes('/marketplace/core/'));

test('a purely native edit stays network-identical — no marketplace reads at all', async () => {
  const { gw, calls } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [{ op: 'renameStep', stepId: 's1', name: 'Instant SMS (renamed)' }],
  }, deps(gw));

  assert.equal(result.ok, true);
  assert.deepEqual(marketplaceReads(calls), [],
    'a native edit fetched the marketplace index it has no use for');
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    'GET /locations/LOC/customFields/search?parentId=&skip=0&limit=10000&documentType=field&model=all&query=&includeStandards=false',
    // the two per-location vocabulary reads an edit always makes: custom FIELDS resolve field ids,
    // custom VALUES complete the {{custom_values.*}} merge-tag check. Neither is a marketplace read.
    'GET /locations/LOC/customValues',
    'GET /workflow/LOC/WID?includeScheduledPauseInfo=true',
    'PUT /workflow/LOC/WID',
    'GET /workflow/LOC/WID?includeScheduledPauseInfo=true',
  ]);
});

test('a native edit on a workflow CONTAINING marketplace steps still fetches nothing', async () => {
  const initial = smsWorkflow();
  initial.workflowData.templates[0] = {
    id: 's1', type: 'imessage_a', name: 'WA', isMarketplaceAction: true, stepIndex: 1,
    next: 's2', parent: null, parentKey: null, order: 0, attributes: { type: 'imessage_a', message: 'hi' },
  };
  const { gw, calls } = editGateway({ initial });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [{ op: 'renameStep', stepId: 's3', name: 'Renamed' }],
  }, deps(gw));

  assert.equal(result.ok, true);
  assert.deepEqual(marketplaceReads(calls), []);
  const put = calls.find(({ method }) => method === 'PUT');
  assert.equal('meta' in put.body, false, 'a native edit rewrote marketplace metadata it never touched');
});

test('a marketplace op fetches the index and commits the marketplace step shape', async () => {
  const { gw, calls, current } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [retypeToWa('s1', 'Hi {{contact.first_name}}', 'Instant WhatsApp')],
  }, deps(gw));

  assert.equal(result.ok, true);
  assert.deepEqual(marketplaceReads(calls).map(({ path }) => path), [
    ASSETS_PATH, modulePath('actions'), modulePath('triggers'),
  ]);

  const step = current().workflowData.templates.find((t) => t.id === 's1');
  assert.equal(step.type, 'imessage_a');
  assert.equal(step.name, 'Instant WhatsApp');
  assert.equal(step.isMarketplaceAction, true);
  assert.equal(step.stepIndex, 1);
  assert.equal(step.attributes.type, 'imessage_a');
  assert.equal(step.attributes.message, 'Hi {{contact.first_name}}');
  assert.equal('body' in step.attributes, false, 'the old sms body survived into the marketplace step');
  // Graph untouched: same ids, same count, same wiring. The stored document strips a
  // terminal's `next: null` at the wire boundary (terminals.mjs) — s3 loses the key on
  // commit, same as `smsWorkflow()`'s fixture would if it were ever written, so the fixture
  // side is normalised the same way before comparing.
  assert.deepEqual(current().workflowData.templates.map((t) => [t.id, t.next, t.parentKey, t.order]),
    stripNullNext(smsWorkflow().workflowData.templates).map((t) => [t.id, t.next, t.parentKey, t.order]));
  assert.deepEqual(current().meta.stepIndexCounter, { imessage_a: 1 });
});

test('an unresolvable marketplace key fails closed with the engine\'s own error', async () => {
  const { gw, calls } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [{ op: 'retypeStep', stepId: 's1',
      step: { kind: 'action', marketplace: true, type: 'not_a_real_key', name: 'X', attributes: { message: 'hi' } } }],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /MARKETPLACE_KEY_UNKNOWN|no installed or available/);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false, 'a failed resolve must never commit');
});

test('a retype with no attributes replacement is refused before any write', async () => {
  const { gw, calls } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [{ op: 'retypeStep', stepId: 's1', step: { type: 'imessage_a', marketplace: true, name: 'X' } }],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), /needs a full 'attributes' object/);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false);
});

test('two retypes number 1 and 2 and the counter records the high-water mark', async () => {
  const { gw, current } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [retypeToWa('s1', 'Hi', 'Instant WhatsApp'), retypeToWa('s3', 'Still there?', 'Follow-up WhatsApp')],
  }, deps(gw));

  assert.equal(result.ok, true);
  const templates = current().workflowData.templates;
  assert.equal(templates.find((t) => t.id === 's1').stepIndex, 1);
  assert.equal(templates.find((t) => t.id === 's3').stepIndex, 2);
  assert.deepEqual(current().meta.stepIndexCounter, { imessage_a: 2 });
  assert.equal(templates.filter((t) => t.type === 'sms').length, 0);
});

test('the preview names the retype and writes nothing without confirm', async () => {
  const { gw, calls } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID',
    ops: [retypeToWa('s1', 'Hi', 'Instant WhatsApp')],
  }, deps(gw));

  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(result.data.preview.opsApplied, ['retypeStep']);
  assert.deepEqual(result.data.preview.diff.modifiedSteps, ['s1']);
  assert.deepEqual(result.data.preview.idsAdded, []);
  assert.deepEqual(result.data.preview.idsRemoved, []);
  assert.equal(calls.some(({ method }) => method !== 'GET'), false);
});
