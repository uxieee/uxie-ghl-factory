import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';

const publishTool = () => TOOLS.find((candidate) => candidate.name === 'publish_workflow');

const workflow = ({ status = 'draft', version = 3 } = {}) => ({
  _id: 'WID',
  id: 'WID',
  name: 'Workflow',
  status,
  version,
  filePath: 'keep.json',
  autoSaveSession: { id: 'must-strip' },
  autoSaveSessionId: 'must-strip-too',
  workflowData: { templates: [{ id: 's1', next: null, parentKey: null }] },
});

function publishGateway({
  initial = workflow(), refreshVersion, failWorkflowGets = [], throwAfterPublishApply = false,
  failTriggerActivation = false,
} = {}) {
  const calls = [];
  let current = structuredClone(initial);
  let workflowGets = 0;
  const failingGets = new Set(failWorkflowGets);
  let triggers = [{ id: 'tr1', name: 'Trigger', active: false }];
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path === '/workflow/LOC/WID?includeScheduledPauseInfo=true') {
        workflowGets++;
        if (workflowGets === 2 && refreshVersion != null) current.version = refreshVersion;
        if (failingGets.delete(workflowGets)) {
          return { status: 503, ok: false, json: { message: `workflow GET ${workflowGets} unavailable` } };
        }
        return { status: 200, ok: true, json: structuredClone(current) };
      }
      if (method === 'GET' && path === '/workflow/LOC/trigger?workflowId=WID') {
        return { status: 200, ok: true, json: { triggers: structuredClone(triggers) } };
      }
      // The REAL write rail (Task 9, workflow save-correctness): one PUT per trigger,
      // carrying the whole stored record. Only this endpoint moves `active` in this
      // fixture — the document PUT below deliberately does NOT, matching the live-proven
      // inertness of a full-document PUT's oldTriggers/newTriggers for trigger content.
      if (method === 'PUT' && path.startsWith('/workflow/LOC/trigger/')) {
        if (failTriggerActivation) return { status: 500, ok: false, json: { message: 'trigger activation unavailable' } };
        const tid = path.split('/').pop();
        const index = triggers.findIndex((trigger) => (trigger.id ?? trigger._id) === tid);
        if (index === -1) return { status: 404, ok: false, json: { message: `no trigger ${tid}` } };
        triggers = triggers.map((trigger, i) => (i === index ? { ...trigger, ...body } : trigger));
        return { status: 200, ok: true, json: { id: tid } };
      }
      if (method === 'PUT' && path === '/workflow/LOC/WID') {
        current = { ...structuredClone(body), version: body.version + 1 };
        // Deliberately NOT applied to `triggers` — a full-document PUT's oldTriggers/
        // newTriggers is live-proven INERT for trigger content, including `active`. Real
        // activation happens only through the per-trigger PUT above.
        if (throwAfterPublishApply) throw new Error('transport lost after publish PUT applied');
        return { status: 200, ok: true, json: { id: 'WID' } };
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  };
  return { gw, calls, current: () => current, triggers: () => triggers };
}

const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });

test('publish_workflow registers through a real McpServer with the confirmation schema', async () => {
  assert.ok(publishTool(), 'publish_workflow must exist');
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, { state: {}, makeGw: () => { throw new Error('unused'); } }, [publishTool()]);

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const input = listed.tools[0].inputSchema;
    assert.deepEqual(input.required.sort(), ['locationId', 'workflowId']);
    assert.equal(input.properties.confirm.type, 'boolean');
    assert.equal(input.properties.confirm.default, false);
  } finally {
    await client.close();
  }
});

test('publish_workflow preview reports current status/version and performs reads only', async () => {
  const { gw, calls } = publishGateway();
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID' },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(result.data.preview.current, { status: 'draft', version: 3 });
  assert.deepEqual(result.data.preview.changes.status, { from: 'draft', to: 'published' });
  assert.equal(result.data.preview.changes.triggers.total, 1);
  assert.equal(result.data.preview.changes.triggers.willActivate, 1);
  assert.deepEqual(result.data.preview.changes.strips, ['autoSaveSession', 'autoSaveSessionId']);
  assert.equal(calls.some(({ method }) => ['POST', 'PUT', 'DELETE'].includes(method)), false);
});

test('confirmed publish re-GETs immediately before PUT, uses that version, strips sessions, and verifies', async () => {
  const { gw, calls, current, triggers } = publishGateway({ refreshVersion: 9 });
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, true);
  const putIndex = calls.findIndex(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/WID');
  assert.ok(putIndex > 0);
  assert.equal(calls[putIndex - 1].method, 'GET');
  assert.equal(calls[putIndex - 1].path, '/workflow/LOC/WID?includeScheduledPauseInfo=true',
    'the version-bearing workflow GET must be immediately before PUT');
  const body = calls[putIndex].body;
  assert.equal(body.version, 9, 'publish must use the immediately refreshed current version');
  assert.equal(body.status, 'published');
  // The fixture's fresh GET carries a stored `next: null` (workflow() above) — publish echoes
  // that document straight back as a PUT, so it inherits every stored null the same way an
  // untouched build or edit does. The save validator refuses the explicit null (terminals.mjs
  // live A/B 2026-08-27), so this must be stripped before the wire or an untouched legacy
  // terminal 400s a publish nobody meant to change.
  assert.equal('next' in body.workflowData.templates[0], false,
    'a stored null terminal must not survive onto the publish PUT');
  assert.equal('autoSaveSession' in body, false);
  assert.equal('autoSaveSessionId' in body, false);
  // oldTriggers/newTriggers on the DOCUMENT PUT is an unchanged roster ECHO of what was
  // read before activation — not the activation mechanism. Real activation already
  // happened above, via the per-trigger PUT rail (asserted below).
  assert.deepEqual(body.oldTriggers, body.newTriggers);
  assert.deepEqual(body.newTriggers.map((trigger) => trigger.active), [false]);
  const activatePutIndex = calls.findIndex(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/trigger/tr1');
  assert.ok(activatePutIndex !== -1, 'a per-trigger activation PUT must have been sent');
  assert.ok(activatePutIndex < putIndex, 'trigger activation must happen BEFORE the document publish PUT');
  const activateBody = calls[activatePutIndex].body;
  assert.equal(activateBody.active, true);
  assert.equal(activateBody.triggersChanged, true);
  assert.equal(activateBody.name, 'Trigger', 'the whole stored record rides along, not a patch');
  assert.equal(current().status, 'published');
  assert.deepEqual(triggers().map((trigger) => trigger.active), [true]);
  assert.equal(result.data.verify.roundTrip, true);
  assert.equal(result.data.verify.status, 'published');
  assert.deepEqual(result.data.verify.inactiveTriggers, []);
  assert.match(result.data.runtimeProofNote, /active: true.*not proof.*added_to_workflow/is);
});

test('v0.3.4 regression: publishing an already-published workflow never drafts it or turns triggers off', async () => {
  const { gw, calls, current, triggers } = publishGateway({
    initial: workflow({ status: 'published', version: 40 }),
    refreshVersion: 41,
  });
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(current().status, 'published');
  assert.deepEqual(triggers().map((trigger) => trigger.active), [true]);
  const documentPutBodies = calls.filter(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/WID').map(({ body }) => body);
  assert.equal(documentPutBodies.length, 1);
  assert.deepEqual(documentPutBodies.map(({ status }) => status), ['published'],
    'publish_workflow must never perform a draft leg');
  const activationPuts = calls.filter(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/trigger/tr1');
  assert.equal(activationPuts.length, 1, 'the inactive trigger must be activated exactly once, via the per-trigger rail');
});

test('a failed trigger activation PUT aborts before the document publish PUT is ever sent', async () => {
  const { gw, calls, current } = publishGateway({ failTriggerActivation: true });
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.data.partialProgress.failurePhase, 'trigger_activate');
  assert.equal(calls.some(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/WID'), false,
    'the document publish PUT must never be sent after a failed trigger activation');
  assert.equal(current().status, 'draft', 'the workflow must not appear published while a trigger failed to activate');
});

test('an already-active trigger gets no activation PUT at all', async () => {
  const { gw, calls } = publishGateway({
    initial: workflow({ status: 'draft', version: 3 }),
  });
  // Flip the fixture's trigger to already-active before publish runs, by activating it
  // through the real rail first (mirrors an account where every trigger already fired once).
  await gw.call('PUT', '/workflow/LOC/trigger/tr1', { id: 'tr1', name: 'Trigger', active: true, triggersChanged: true });
  calls.length = 0;
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );
  assert.equal(result.ok, true);
  assert.equal(calls.some(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/trigger/tr1'), false,
    'an already-active trigger must not be re-written');
});

test('post-PUT verification failure reports acknowledged publish progress and urgent remediation', async () => {
  const { gw, current } = publishGateway({ failWorkflowGets: [3] });
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_503');
  assert.match(result.remediation, /URGENT/i);
  assert.equal(result.data.partialProgress.putApplied, true);
  assert.equal(result.data.partialProgress.verification.attempted, true);
  assert.equal(result.data.partialProgress.verification.completed, false);
  assert.equal(result.data.partialProgress.failurePhase, 'publish_verify_workflow_get');
  assert.equal(current().status, 'published', 'the fixture confirms why a bare GET error was misleading');
});

test('publish PUT applied then transport throws reports an urgent ambiguous write without losing the failure', async () => {
  const { gw, current } = publishGateway({ throwAfterPublishApply: true });
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.match(result.detail, /transport lost after publish PUT applied/);
  assert.match(result.remediation, /URGENT/i);
  assert.equal(result.data.partialProgress.putApplied, false);
  assert.equal(result.data.partialProgress.putOutcome.attempted, true);
  assert.equal(result.data.partialProgress.putOutcome.acknowledged, false);
  assert.equal(result.data.partialProgress.putOutcome.ambiguous, true);
  assert.equal(result.data.partialProgress.verification.attempted, false);
  assert.equal(current().status, 'published');
});
