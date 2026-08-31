// The edit path never ran GHL's own action schema, so a 614-character prompt written into a
// `conversationai_ai_message` returned 200, round-tripped clean, and published — and the builder
// then showed "Resolve 1 Errors — Maximum 600 characters are allowed" to whoever opened it.
//
// Round-trip cannot catch this by construction: it compares what was SENT with what was STORED,
// and the server stores an over-cap value verbatim. Only the marketplace assets catalog carries
// the per-field rule, and only the BUILD path had ever consulted it.
//
// The caps are per node type, not global: conversationai_ai_message.message is 600 while
// conversationai_book_appointment.promptInstructions is 500, which is how a 550-character rewrite
// written to the 600 budget introduced a second, different violation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const editTool = () => TOOLS.find((candidate) => candidate.name === 'edit_workflow');
const ASSETS_PATH = '/workflows-marketplace/location/LOC/assets?workflowTypes=default,contacts';

// Trimmed to the one rule under test, in the live payload's shape: `actions` is a list of APPS,
// each carrying its own `actions[]`.
const ASSETS = {
  actions: [{
    appName: 'Conversation AI',
    actions: [{
      key: 'conversationai_ai_message',
      section: 'Conversation AI',
      workflowsActionType: 'INTERNAL',
      inputs: [{
        field: 'message',
        title: 'Enter the Prompt for The Message',
        required: true,
        fieldType: 'textarea',
        validations: [{ rule: '(value) => value.length <= 600', errorMessage: 'Maximum 600 characters are allowed' }],
      }],
    }],
  }],
  triggers: [],
};

const workflow = () => ({
  _id: 'WID', id: 'WID', name: 'AI Flow', status: 'draft', version: 3,
  workflowData: {
    templates: [
      { id: 's1', type: 'conversationai_ai_message', name: 'Handover line', next: null,
        parent: null, parentKey: null, order: 0,
        attributes: { type: 'conversationai_ai_message', message: 'short', waitForReply: true } },
    ],
  },
});

function gateway({ assetsOk = true } = {}) {
  const calls = [];
  let current = structuredClone(workflow());
  const gw = {
    uid: 'UID',
    call: async (method, path, body) => {
      calls.push({ method, path });
      if (method === 'GET' && path === ASSETS_PATH) {
        return assetsOk ? { ok: true, status: 200, json: ASSETS } : { ok: false, status: 503, json: null };
      }
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { ok: true, status: 200, json: structuredClone(current) };
      if (method === 'GET' && path.includes('/customFields/search')) return { ok: true, status: 200, json: { customFields: [] } };
      if (method === 'GET' && path.includes('/customValues')) return { ok: true, status: 200, json: { customValues: [] } };
      if (method === 'GET' && path.includes('/tags')) return { ok: true, status: 200, json: { tags: [] } };
      if (method === 'GET' && path.includes('/trigger')) return { ok: true, status: 200, json: { triggers: [] } };
      if (method === 'PUT' && path === '/workflow/LOC/WID') {
        current = { ...current, ...body, workflowData: body.workflowData ?? current.workflowData };
        return { ok: true, status: 200, json: structuredClone(current) };
      }
      return { ok: true, status: 200, json: {} };
    },
  };
  return { gw, calls };
}
const deps = (gw) => ({ makeGw: () => gw, state: {} });

const overCap = 'x'.repeat(614);
const modify = { op: 'modifyStep', stepId: 's1', attrPatch: { message: overCap } };

test('an over-cap prompt is named in the PREVIEW, before anything is written', async () => {
  const { gw, calls } = gateway();
  const result = await editTool().handler(
    { locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true, ops: [modify] }, deps(gw));

  assert.equal(result.ok, false, 'a preview never commits');
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  const violations = result.data?.preview?.schemaViolations ?? [];
  assert.equal(violations.length, 1, 'the builder would show exactly one error');
  assert.match(violations[0].messages.join(' '), /Maximum 600 characters are allowed/);
  assert.equal(violations[0].stepId, 's1');
  assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [], 'the preview wrote nothing');
});

test('the committed result carries the builder headline the round-trip cannot see', async () => {
  const { gw } = gateway();
  const result = await editTool().handler(
    { locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true, confirm: true, ops: [modify] }, deps(gw));

  assert.equal(result.ok, true, 'the server accepts an over-cap value, so the edit still commits');
  assert.equal(result.data.verify.roundTrip, true, 'and it round-trips clean — that is the whole point');
  assert.equal(result.data.schemaHeadline, 'Resolve 1 Errors');
  assert.match(result.data.schemaViolations[0].messages.join(' '), /Maximum 600 characters are allowed/);
});

test('a value inside the cap is clean, and the check is fail-open when the catalog is down', async () => {
  const inCap = { op: 'modifyStep', stepId: 's1', attrPatch: { message: 'y'.repeat(600) } };
  const ok = await editTool().handler(
    { locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true, confirm: true, ops: [inCap] }, deps(gateway().gw));
  assert.equal(ok.data.schemaViolations.length, 0, '600 is inclusive');

  // An unreachable catalog must never become a new way for a working edit to fail.
  const down = await editTool().handler(
    { locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true, confirm: true, ops: [modify] }, deps(gateway({ assetsOk: false }).gw));
  assert.equal(down.ok, true);
  assert.deepEqual(down.data.schemaViolations, []);
});

test('a rename does not fetch the catalog — a graph-only op cannot breach a field rule', async () => {
  const { gw, calls } = gateway();
  await editTool().handler(
    { locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true, confirm: true, ops: [{ op: 'renameStep', stepId: 's1', name: 'Renamed' }] },
    deps(gw));
  assert.deepEqual(calls.filter((c) => c.path === ASSETS_PATH), [],
    'the edit path network shape is a pinned contract; it must not grow for an op that cannot violate a rule');
});
