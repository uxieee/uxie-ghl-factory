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
  // s1 exercises the null-`next` rule; s2 exercises the sibling `input_trigger_params` rule —
  // a legacy add_to_workflow step whose attributes are exactly {workflow_id, type}, the shape
  // a pre-fix engine build actually produced (required-fields.mjs's CONDITIONAL_DEFAULTS only
  // ever ran on the compile path).
  workflowData: { templates: [
    { id: 's1', next: null, parentKey: null },
    { id: 's2', type: 'add_to_workflow', name: 'Enrol', attributes: { workflow_id: 'W1', type: 'add_to_workflow' } },
  ] },
});

function publishGateway({
  initial = workflow(), refreshVersion, failWorkflowGets = [], throwAfterPublishApply = false,
  // Models the measured truth (throwaway probes on the designated test sub-account,
  // 2026-08-28): `active` is a SERVER-MANAGED PROJECTION of the workflow's publish state.
  // Publishing flips every trigger active as a side effect of the status transition itself
  // — set this false to model the "stuck inactive despite a successful publish" case the
  // engine has no known fix for, so the verification test below can exercise it.
  triggersActivateOnPublish = true,
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
      // publish_workflow no longer sends this write at all (removed 2026-08-28 as proven
      // inert for `active` — see edit-driver.mjs's history comment). This route is kept in
      // the fixture only so a stray reintroduction of the write is caught doing what the
      // real API does — accept `active` and ignore it — rather than the mock accidentally
      // "fixing" a bug the live API does not fix. Content fields DO persist here, matching
      // the live-proven CONTENT rail modifyTrigger still uses.
      if (method === 'PUT' && path.startsWith('/workflow/LOC/trigger/')) {
        const tid = path.split('/').pop();
        const index = triggers.findIndex((trigger) => (trigger.id ?? trigger._id) === tid);
        if (index === -1) return { status: 404, ok: false, json: { message: `no trigger ${tid}` } };
        const { active: _ignoredActive, ...contentOnly } = body ?? {};
        triggers = triggers.map((trigger, i) => (i === index ? { ...trigger, ...contentOnly } : trigger));
        return { status: 200, ok: true, json: { id: tid } };
      }
      if (method === 'PUT' && path === '/workflow/LOC/WID') {
        current = { ...structuredClone(body), version: body.version + 1 };
        // The measured mechanism: publishing itself is what flips `active`, not anything in
        // oldTriggers/newTriggers (which is proven inert and asserted as an unchanged echo
        // below). triggersActivateOnPublish:false models the case the engine cannot fix.
        if (triggersActivateOnPublish && body.status === 'published') {
          triggers = triggers.map((trigger) => ({ ...trigger, active: true }));
        }
        if (throwAfterPublishApply) throw new Error('transport lost after publish PUT applied');
        return { status: 200, ok: true, json: { id: 'WID' } };
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  };
  return { gw, calls, current: () => current, triggers: () => triggers };
}

// Every activation test below asserts this the same way — no per-trigger PUT is ever sent
// by publish_workflow, because none does anything (measured 2026-08-28).
const noActivationPutSent = (calls) => calls.every(({ method, path }) => !(method === 'PUT' && path.startsWith('/workflow/LOC/trigger/')));

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
  // read BEFORE the publish PUT — still carrying `active:false`. That is expected and
  // correct: `active` is a server-managed projection of the publish state, not a field
  // this body's trigger roster controls (measured 2026-08-28) — see edit-driver.mjs.
  assert.deepEqual(body.oldTriggers, body.newTriggers);
  assert.deepEqual(body.newTriggers.map((trigger) => trigger.active), [false]);
  // No per-trigger activation write. It was removed 2026-08-28 — it is a 200 that changes
  // nothing (measured on a live account, three ways). Publishing alone is what activates.
  assert.ok(noActivationPutSent(calls), 'publish_workflow must never send a per-trigger PUT — the write is proven inert');
  assert.equal(current().status, 'published');
  assert.deepEqual(triggers().map((trigger) => trigger.active), [true],
    'the trigger reads active via the publish transition itself, not any per-trigger write');
  assert.equal(result.data.verify.roundTrip, true);
  assert.equal(result.data.verify.status, 'published');
  assert.deepEqual(result.data.verify.inactiveTriggers, []);
  assert.match(result.data.runtimeProofNote, /active: true.*not proof.*added_to_workflow/is);
});

test('confirmed publish fills input_trigger_params on a legacy add_to_workflow step it never touched — its absence blocks EVERY save on the workflow, not just this step (terminals.mjs)', async () => {
  // Sibling rule to the null-`next` test above, same wire-assembly boundary. The fixture's
  // fresh GET (workflow() above, step s2) carries a legacy add_to_workflow step stored as
  // {workflow_id, type} — no input_trigger_params key at all, the shape a pre-fix engine
  // build actually produced. GHL's save validator refuses its absence with "Input Trigger
  // Params is required", and that refusal blocks EVERY save on the workflow. publish_workflow
  // echoes the stored document straight back as a PUT, so it must repair this the same way
  // editCommitBody already does on the edit path.
  const { gw, calls } = publishGateway({ refreshVersion: 9 });
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, true);
  const putIndex = calls.findIndex(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/WID');
  const body = calls[putIndex].body;
  const legacyStep = body.workflowData.templates.find((t) => t.id === 's2');
  assert.equal(legacyStep.attributes.input_trigger_params, false,
    'a stored {workflow_id, type}-only add_to_workflow step must not ride the publish PUT unrepaired');
  assert.equal(typeof legacyStep.attributes.input_trigger_params, 'boolean',
    'it must be a real JSON boolean, not a stringified or missing value');
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
  assert.ok(noActivationPutSent(calls),
    'publishing an already-published workflow must not send a per-trigger PUT either — the write is inert regardless of prior status');
});

// Replaces the retired 2026-08-27 write-rail tests ("a failed trigger activation PUT
// aborts..." and "an already-active trigger gets no activation PUT at all"). Those pinned
// a write that measurement (throwaway probes on the designated test sub-account,
// 2026-08-28, three experiments) proved does nothing: a publish with ZERO trigger writes
// still activates every trigger sub-second after the publish PUT returns, and a
// per-trigger PUT with active:false against a published workflow returns 200 with the
// trigger reading active:true regardless. The new contract is the opposite of what those
// tests asserted — no such write is ever sent, whatever the trigger roster's active state.
test('publish_workflow sends no per-trigger activation PUT, whatever the trigger roster looks like before publish', async () => {
  const { gw, calls } = publishGateway();
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );
  assert.equal(result.ok, true);
  assert.ok(noActivationPutSent(calls), 'no per-trigger PUT may be sent by publish_workflow, ever');
});

test('post-publish verification fails loudly when a trigger reads inactive despite a successful publish PUT — the open, unsolved case', async () => {
  // Models the honest open question: `active` is a server-managed projection with no known
  // write to force it, so a trigger that does not flip on publish cannot currently be
  // fixed through any known API path. The engine's job here is to report that state
  // clearly, never to pretend a fix exists.
  const { gw, calls, current } = publishGateway({ triggersActivateOnPublish: false });
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(current().status, 'published', 'the document PUT itself still applied');
  assert.ok(noActivationPutSent(calls), 'the verification failure must not provoke a retry via the retired per-trigger write');
  assert.equal(result.data.partialProgress.putApplied, true);
  assert.equal(result.data.partialProgress.verification.completed, true);
  assert.equal(result.data.verify.roundTrip, false);
  assert.deepEqual(result.data.verify.inactiveTriggers, ['Trigger']);
  assert.match(result.remediation, /Inspect the workflow and runtime logs/i);
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
