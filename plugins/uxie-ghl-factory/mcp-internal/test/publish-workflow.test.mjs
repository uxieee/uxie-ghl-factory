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
  // Models the measured truth (throwaway workflows on the designated test sub-account,
  // 2026-08-28): `active` is a READ-ONLY PROJECTION of a trigger's own `status` field
  // ("draft"|"published") — `active === (status !== "draft")`. The workflow-level
  // draft→published transition CASCADES `status:"published"` onto every trigger as a side
  // effect of the publish PUT, with no trigger write needed — set this false to model a
  // trigger the cascade does NOT reach, so the REPAIR path below (added 2026-08-28) gets
  // exercised.
  triggersActivateOnPublish = true,
  // the location's sending domains, as GET /workflow/{loc}/email/domain-selection answers them
  domains = [],
  // Controls whether the REPAIR PUT (one per-trigger status write, sent only for a trigger
  // still inactive after the cascade) actually takes. false models the measured
  // "a bogus/ignored `status` is silently accepted" pitfall — 200, unchanged — so the
  // verification tests below can prove the repair's 200 is never trusted on its own.
  repairActivates = true,
  // the workflow's triggers, and what GET /hooks/inbound-webhook-request/reference/{tid} answers per trigger
  initialTriggers = [{ id: 'tr1', name: 'Trigger', active: false }],
  webhookReferences = {},
} = {}) {
  const calls = [];
  let current = structuredClone(initial);
  let workflowGets = 0;
  const failingGets = new Set(failWorkflowGets);
  let triggers = structuredClone(initialTriggers);
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
      if (method === 'GET' && path.startsWith('/workflow/LOC/email/domain-selection')) {
        return { status: 200, ok: true, json: structuredClone(domains) };
      }
      if (method === 'GET' && path.startsWith('/hooks/inbound-webhook-request/reference/')) {
        const tid = decodeURIComponent(path.split('/').pop().split('?')[0]);
        return structuredClone(webhookReferences[tid] ?? { status: 404, ok: false, json: { statusCode: 404, message: `${tid} was not found` } });
      }
      if (method === 'GET' && path === '/workflow/LOC/trigger?workflowId=WID') {
        return { status: 200, ok: true, json: { triggers: structuredClone(triggers) } };
      }
      // REPAIR rail: a per-trigger PUT carrying `status:'published'` is what actually
      // activates a trigger the publish PUT's own cascade missed — see edit-driver.mjs's
      // translateActiveToStatus for the full mechanism. The body's own `active` key is still
      // ignored (the server never keys off it — only `status` does); this fixture derives
      // `active` from `status` the same way, gated by `repairActivates` to model the
      // "silently ignored" pitfall on demand.
      if (method === 'PUT' && path.startsWith('/workflow/LOC/trigger/')) {
        const tid = path.split('/').pop();
        const index = triggers.findIndex((trigger) => (trigger.id ?? trigger._id) === tid);
        if (index === -1) return { status: 404, ok: false, json: { message: `no trigger ${tid}` } };
        const { active: _ignoredActive, ...contentOnly } = body ?? {};
        triggers = triggers.map((trigger, i) => {
          if (i !== index) return trigger;
          const merged = { ...trigger, ...contentOnly };
          if (contentOnly.status === 'draft') merged.active = false;
          else if (contentOnly.status === 'published') merged.active = repairActivates ? true : trigger.active;
          else merged.active = trigger.active;
          return merged;
        });
        return { status: 200, ok: true, json: { id: tid } };
      }
      if (method === 'PUT' && path === '/workflow/LOC/WID') {
        current = { ...structuredClone(body), version: body.version + 1 };
        // The measured mechanism: the document PUT's OWN draft→published transition cascades
        // status:'published' onto every trigger, sub-second — not anything in
        // oldTriggers/newTriggers (proven inert for content, asserted as an unchanged echo
        // below). triggersActivateOnPublish:false models a trigger the cascade does not reach.
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

// Asserts no per-trigger PUT was sent AT ALL. Valid only for the HAPPY PATH (the publish
// PUT's own cascade already activated everything, so the REPAIR rail added 2026-08-28 has
// nothing to do) — the repair tests further below assert the opposite on purpose.
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
  // validate-workflows is a POST that WRITES NOTHING (proven 2026-09-11: the document read back
  // byte-identical after twelve calls), the same class as validate-assets: a read for this contract.
  assert.equal(calls.some(({ method, path }) => ['POST', 'PUT', 'DELETE'].includes(method) && !path.endsWith('/validate-workflows')), false);
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
// trigger reading active:true regardless. This pins the HAPPY PATH: when the publish PUT's
// own cascade already activates every trigger (the default fixture), there is nothing left
// for the REPAIR rail (added 2026-08-28, later the same day) to do. The two tests below cover
// the case the cascade does NOT reach, where a per-trigger PUT is exactly what gets sent.
test('publish_workflow sends no per-trigger activation PUT when the publish PUT alone already activated every trigger', async () => {
  const { gw, calls } = publishGateway();
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );
  assert.equal(result.ok, true);
  assert.ok(noActivationPutSent(calls), 'the cascade already covers this case; the repair rail must not fire needlessly');
});

// This pins the REPAIR case: a trigger the publish PUT's own cascade did NOT reach. The
// trigger's own `status` field is what `active` projects (`active === (status !== "draft")`
// — see edit-driver.mjs's translateActiveToStatus), and a per-trigger PUT carrying
// `status:'published'` DOES activate it. publish_workflow REPAIRS exactly this case — one
// PUT per trigger still reading inactive after the cascade — before reporting failure.
test('publish_workflow REPAIRS a trigger that still reads inactive after the publish PUT — one per-trigger status write, verified by read-back', async () => {
  const { gw, calls, current, triggers } = publishGateway({ triggersActivateOnPublish: false });
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, true, 'the repair must let publish_workflow report success');
  assert.equal(current().status, 'published');
  const repairPut = calls.find(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/trigger/tr1');
  assert.ok(repairPut, 'a still-inactive trigger after publish must get exactly one repair PUT');
  assert.equal(repairPut.body.status, 'published');
  assert.equal(repairPut.body.id, 'tr1', 'the repair sends the FULL trigger record, not a lean patch');
  assert.deepEqual(triggers().map((trigger) => trigger.active), [true]);
  assert.equal(result.data.verify.roundTrip, true);
  assert.deepEqual(result.data.verify.inactiveTriggers, []);
});

test('post-publish verification fails loudly, naming the trigger, when it is STILL inactive after the repair PUT — never trust the 200, verify by read-back', async () => {
  // Models the measured bogus-status pitfall: the repair PUT is acknowledged (200) but the
  // trigger reads back UNCHANGED. The engine's job is to ATTEMPT the repair, but the write's
  // 200 must never be trusted — only the re-list decides.
  const { gw, calls, current } = publishGateway({ triggersActivateOnPublish: false, repairActivates: false });
  const result = await publishTool().handler(
    { locationId: 'LOC', workflowId: 'WID', confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(current().status, 'published', 'the document PUT itself still applied');
  const repairPut = calls.find(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/trigger/tr1');
  assert.ok(repairPut, 'the repair must still be ATTEMPTED even though it will not fix this particular trigger');
  assert.equal(repairPut.body.status, 'published');
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

// ── the layers publish never ran (0.84.0) ────────────────────────────────────────────────────
// GHL's browser publish gate runs THREE checks before it sends the status PUT: WorkflowValidator
// as 'published', the canvas's stored hasErrors flag, and the per-field highlight map. Our publish
// ran none of the first two — so an empty workflow, or a goto with no target, published over the
// API while the builder refused it on screen. Every layer belongs to the intent now.

test('publish refuses an EMPTY workflow — checkEmptyPublish, the rule only a publish runs', async () => {
  const empty = workflow();
  empty.workflowData.templates = [];
  const { gw, calls } = publishGateway({ initial: empty });
  const result = await publishTool().handler({ locationId: 'LOC', workflowId: 'WID', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /WORKFLOW_RULE|empty/i);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false, 'nothing was written');
});

test("publish refuses a step the canvas itself has flagged", async () => {
  const flagged = workflow();
  flagged.workflowData.templates = [{ id: 's1', type: 'sms', name: 'Text', attributes: { type: 'sms', body: 'hi' }, next: null, advanceCanvasMeta: { hasErrors: true } }];
  const { gw, calls } = publishGateway({ initial: flagged });
  const result = await publishTool().handler({ locationId: 'LOC', workflowId: 'WID', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.data?.validation ?? result), /CANVAS_HAS_ERRORS/);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false);
});

test('allowValidationFailure publishes anyway, and still reports what it skipped', async () => {
  const empty = workflow();
  empty.workflowData.templates = [];
  const { gw, calls } = publishGateway({ initial: empty });
  const result = await publishTool().handler({ locationId: 'LOC', workflowId: 'WID', confirm: true, allowValidationFailure: true }, deps(gw));
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300));
  assert.equal(calls.some(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/WID'), true);
  assert.match(JSON.stringify(result.data.warnings ?? []), /VALIDATION BYPASSED/);
});

// inboundWebhookTriggerValidator (0.84.1): GHL refuses to publish an inbound webhook with no mapped
// sample. The sample is not in the document, so publish reads it. A 404 is GHL's "none mapped"
// (measured 2026-09-12); any other failed read leaves the rule unjudged.
const hookTrigger = { id: 'hk1', name: 'Inbound Webhook', type: 'inbound_webhook', active: false };

test('publish refuses an inbound webhook with no mapped sample, and names the fix', async () => {
  const { gw, calls } = publishGateway({ initialTriggers: [hookTrigger] });
  const result = await publishTool().handler({ locationId: 'LOC', workflowId: 'WID', confirm: true }, deps(gw));
  assert.ok(calls.some(({ method, path }) => method === 'GET' && path.startsWith('/hooks/inbound-webhook-request/reference/hk1?')));
  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /inboundWebhookTriggerValidator/);
  assert.match(result.detail ?? '', /pin_webhook_sample/);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false, 'nothing is published');
});

test('publish passes the webhook rule once a sample is mapped', async () => {
  const { gw } = publishGateway({ initialTriggers: [hookTrigger],
    webhookReferences: { hk1: { status: 200, ok: true, json: { _id: 'ref', payload: { dealRef: 'D-1' } } } } });
  const result = await publishTool().handler({ locationId: 'LOC', workflowId: 'WID' }, deps(gw));
  assert.equal(result.code, 'CONFIRM_REQUIRED', JSON.stringify(result).slice(0, 300));
  assert.ok(!JSON.stringify(result).includes('inboundWebhookTriggerValidator'));
});

test('a failed sample read leaves the webhook rule unjudged, never refused on our own error', async () => {
  const { gw } = publishGateway({ initialTriggers: [hookTrigger],
    webhookReferences: { hk1: { status: 503, ok: false, json: { message: 'unavailable' } } } });
  const result = await publishTool().handler({ locationId: 'LOC', workflowId: 'WID' }, deps(gw));
  assert.equal(result.code, 'CONFIRM_REQUIRED', JSON.stringify(result).slice(0, 300));
  assert.match(JSON.stringify(result.data?.preview?.validation?.rules?.notEvaluable ?? []), /inboundWebhookTriggerValidator/);
});

test('publish reads no webhook sample when there is no inbound webhook trigger', async () => {
  const { gw, calls } = publishGateway();
  await publishTool().handler({ locationId: 'LOC', workflowId: 'WID' }, deps(gw));
  assert.equal(calls.some(({ path }) => path.startsWith('/hooks/')), false);
});

test('publish refuses an AI step with none of the triggers it requires (validateRequiredTriggersForActions)', async () => {
  // GHL's server validator answers valid:true here (live-70-required-trigger.json); the replay is the only guard.
  const w = workflow();
  w.workflowData = { templates: [{ id: 'a1', name: 'Reply', type: 'conversationai_custom_message', order: 0, next: null, attributes: {} }] };
  const { gw, calls } = publishGateway({ initial: w, initialTriggers: [] });
  const result = await publishTool().handler({ locationId: 'LOC', workflowId: 'WID', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /validateRequiredTriggersForActions/);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false);
});

test("publish reads the workflow's sending domain, so checkFromEmailFormat can be judged", async () => {
  // GHL: with a specific sending domain the From Email must be a full address; with All Domains it
  // must be a local part. The domain is NOT in the document — it comes from domain-selection.
  const w = workflow();
  w.senderAddress = { from_name: 'Grom', from_email: 'marketing' };
  const { gw, calls } = publishGateway({ initial: w, domains: [{ domain: 'mail.example.com', selected: true }] });
  const result = await publishTool().handler({ locationId: 'LOC', workflowId: 'WID', confirm: true }, deps(gw));
  assert.equal(calls.some(({ method, path }) => method === 'GET' && path.includes('/email/domain-selection')), true,
    'the sending domain must be read, or the rule silently passes');
  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /From Email|checkFromEmailFormat/i);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false);
});
