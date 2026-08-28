import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';

const editTool = () => TOOLS.find((candidate) => candidate.name === 'edit_workflow');

const workflow = ({ status = 'draft', version = 7, templates } = {}) => ({
  _id: 'WID',
  id: 'WID',
  name: 'Existing workflow',
  status,
  version,
  filePath: 'keep.json',
  workflowData: {
    templates: templates ?? [
      { id: 's1', type: 'add_contact_tag', name: 'Head', next: 's2', parentKey: null, order: 0, attributes: { tags: ['old'] } },
      { id: 's2', type: 'add_contact_tag', name: 'Tail', next: null, parentKey: 's1', order: 1, attributes: { tags: ['old'] } },
    ],
  },
});

function editGateway({
  initial = workflow(),
  existingTags = [],
  triggers = [],
  customFieldsResponse = { status: 200, ok: true, json: { customFields: [] } },
  failWorkflowGets = [],
  throwWorkflowGets = [],
  throwTriggerGets = [],
  throwAfterPutStatuses = [],
  throwAfterTagCreate = false,
  throwAfterStepCommit = false,
  throwAfterTriggerPost = false,
  ignoredTriggerWrites = [],
  triggerPostResponseIds,
  triggerPostPersistedIds,
  persistTransform = (body) => body,
  // Simulates `active` as a SERVER-MANAGED PROJECTION independent of what a per-trigger PUT's
  // body says (measured 2026-08-28) — the real value on read-back can diverge from whatever
  // this fixture's PUT handler was sent, e.g. because something unrelated (a publish
  // elsewhere) changed it in the gap. Keyed by trigger id; a value here OVERRIDES whatever
  // `active` the PUT body carried when the trigger is next read back.
  triggerActiveOverride = {},
} = {}) {
  const calls = [];
  let current = structuredClone(initial);
  let currentTriggers = structuredClone(triggers);
  let workflowGets = 0;
  let triggerGets = 0;
  let triggerPosts = 0;
  const failingGets = new Set(failWorkflowGets);
  const throwingWorkflowGets = new Set(throwWorkflowGets);
  const throwingTriggerGets = new Set(throwTriggerGets);
  const throwingStatuses = [...throwAfterPutStatuses];
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.includes('/customFields/search')) {
        return structuredClone(customFieldsResponse);
      }
      if (method === 'GET' && path === '/locations/LOC/tags') {
        return { status: 200, ok: true, json: { tags: existingTags.map((name) => ({ name })) } };
      }
      if (method === 'POST' && path === '/locations/LOC/tags') {
        existingTags.push(body.name);
        if (throwAfterTagCreate) throw new Error('transport lost after tag create applied');
        return { status: 201, ok: true, json: { id: `tag-${existingTags.length}`, name: body.name } };
      }
      if (path === '/workflow/LOC/trigger?workflowId=WID' && method === 'GET') {
        triggerGets++;
        if (throwingTriggerGets.delete(triggerGets)) {
          throw new Error(`trigger GET ${triggerGets} transport failed`);
        }
        return { status: 200, ok: true, json: { triggers: structuredClone(currentTriggers) } };
      }
      if (path === '/workflow/LOC/trigger' && method === 'POST') {
        const index = triggerPosts++;
        const responseId = triggerPostResponseIds === undefined
          ? 'tr-new'
          : triggerPostResponseIds[index] ?? null;
        const persistedId = triggerPostPersistedIds === undefined
          ? responseId
          : triggerPostPersistedIds[index] ?? null;
        if (!ignoredTriggerWrites.includes('POST') && persistedId) {
          // Measured 2026-08-28: `active` is a read-only projection of the POSTed trigger's
          // OWN `status` field (`active === (status !== 'draft')`) — not a hardcoded
          // API-created default. addTrigger/duplicateTrigger now always send an explicit
          // `status` (see edit-driver.mjs's targetStatus), so this derives the same way the
          // real API does instead of hardcoding `active:false`.
          currentTriggers.push({
            ...structuredClone(body), id: persistedId, _id: persistedId, active: body.status !== 'draft',
          });
        }
        if (throwAfterTriggerPost) throw new Error('transport lost after trigger POST applied');
        return { status: 201, ok: true, json: responseId ? { id: responseId } : {} };
      }
      if (path.startsWith('/workflow/LOC/trigger/') && method === 'PUT') {
        const triggerId = path.split('/').at(-1);
        if (!ignoredTriggerWrites.includes('PUT')) {
          currentTriggers = currentTriggers.map((trigger) => {
            if ((trigger.id ?? trigger._id) !== triggerId) return trigger;
            const stored = structuredClone(body);
            // Measured 2026-08-28: `active` projects the PUT body's own `status` field when
            // present ('draft'->false, 'published'->true); an ABSENT status (a pure content
            // modifyTrigger, or replaceTagInTriggers) leaves `active` UNCHANGED from before
            // this write, exactly as measured live — never falls back to whatever `active`
            // this PUT's body happened to carry, which the real server does not key off.
            if (stored.status === 'draft') stored.active = false;
            else if (stored.status === 'published') stored.active = true;
            else stored.active = trigger.active ?? false;
            if (Object.hasOwn(triggerActiveOverride, triggerId)) stored.active = triggerActiveOverride[triggerId];
            return stored;
          });
        }
        return { status: 200, ok: true, json: { id: triggerId } };
      }
      if (path.startsWith('/workflow/LOC/trigger/') && method === 'DELETE') {
        const triggerId = path.split('/').at(-1).split('?')[0];
        if (!ignoredTriggerWrites.includes('DELETE')) {
          currentTriggers = currentTriggers.filter((trigger) => (trigger.id ?? trigger._id) !== triggerId);
        }
        return { status: 200, ok: true, json: { id: triggerId } };
      }
      if (path === '/workflow/LOC/WID?includeScheduledPauseInfo=true' && method === 'GET') {
        workflowGets++;
        if (failingGets.delete(workflowGets)) {
          return { status: 503, ok: false, json: { message: `workflow GET ${workflowGets} unavailable` } };
        }
        if (throwingWorkflowGets.delete(workflowGets)) {
          throw new Error(`workflow GET ${workflowGets} transport failed`);
        }
        return { status: 200, ok: true, json: structuredClone(current) };
      }
      if (path === '/workflow/LOC/WID' && method === 'PUT') {
        current = { ...structuredClone(persistTransform(structuredClone(body))), version: current.version + 1 };
        if (body.oldTriggers) currentTriggers = body.oldTriggers.map((trigger) => ({ ...trigger }));
        if (throwAfterStepCommit && !body.oldTriggers) {
          throw new Error('transport lost after step PUT applied');
        }
        const throwIndex = throwingStatuses.indexOf(body.status);
        if (throwIndex >= 0) {
          throwingStatuses.splice(throwIndex, 1);
          throw new Error(`transport lost after ${body.status} PUT applied`);
        }
        return { status: 200, ok: true, json: { id: 'WID' } };
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  };
  return { gw, calls, current: () => current, currentTriggers: () => currentTriggers };
}

const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });

test('edit_workflow registers through a real McpServer with a permissive ops schema', async () => {
  assert.ok(editTool(), 'edit_workflow must exist');
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, { state: {}, makeGw: () => { throw new Error('unused'); } }, [editTool()]);

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const input = listed.tools[0].inputSchema;
    assert.equal(input.type, 'object');
    assert.deepEqual(input.required.sort(), ['locationId', 'ops', 'workflowId']);
    assert.equal(input.properties.ops.type, 'array');
    assert.notEqual(input.properties.ops.items.additionalProperties, false,
      'ops must pass through permissively to the canonical engine');
  } finally {
    await client.close();
  }
});

test('edit_workflow preview applies ops but performs reads only', async () => {
  const { gw, calls } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', ops: [{ op: 'deleteStep', stepId: 's2' }],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(result.data.preview.opsApplied, ['deleteStep']);
  assert.deepEqual(result.data.preview.stepCount, { before: 2, after: 1 });
  assert.deepEqual(result.data.preview.idsAdded, []);
  assert.deepEqual(result.data.preview.idsRemoved, ['s2']);
  assert.deepEqual(result.data.preview.diff.deletedSteps, ['s2']);
  assert.equal(calls.some(({ method }) => ['POST', 'PUT', 'DELETE'].includes(method)), false,
    'missing-confirm preview must never write, including tag creation');
});

test('confirmed edit creates missing tags before a plain workflow PUT and round-trip verifies', async () => {
  const { gw, calls, current } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC',
    workflowId: 'WID',
    confirm: true,
    ops: [{
      op: 'appendStep',
      step: { type: 'add_contact_tag', name: 'Add VIP', attributes: { tags: ['vip'] } },
    }],
  }, deps(gw));

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.createdTags, ['vip']);
  assert.equal(result.data.stepCount.before, 2);
  assert.equal(result.data.stepCount.after, 3);
  assert.equal(result.data.verify.roundTrip, true);
  assert.equal(result.data.verify.stepCountMatch, true);
  assert.equal(result.data.verify.missingExpectedIds.length, 0);
  assert.equal(current().workflowData.templates.length, 3);

  const tagCreate = calls.findIndex(({ method, path }) => method === 'POST' && path === '/locations/LOC/tags');
  const commit = calls.findIndex(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/WID');
  assert.ok(tagCreate >= 0 && tagCreate < commit, 'referenced tags must exist before commit');
  assert.equal(calls.some(({ path }) => path.includes('/auto-save')), false,
    'existing-workflow edits must never use auto-save');
});

test('edit_workflow refuses to guess attachTailTo for a mid-chain multi-branch container', async () => {
  const { gw, calls } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC',
    workflowId: 'WID',
    confirm: true,
    ops: [{
      op: 'insertAfter',
      afterId: 's1',
      step: {
        kind: 'if_else', type: 'if_else', name: 'Gate',
        branches: [
          { ref: 'yes', name: 'Yes', conditions: [{ conditionType: 'contact_detail', tag: 'vip' }], then: [] },
          { ref: 'no', name: 'None', else: true, then: [] },
        ],
      },
    }],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.match(result.detail, /attachTailTo/);
  assert.equal(calls.some(({ method }) => ['POST', 'PUT', 'DELETE'].includes(method)), false);
});

// Split 2026-08-28 from one parametrized test that asserted `active:false` and
// `requiresPublish:true` identically for BOTH a draft and an already-published target — that
// was belief #2 from the corpus/docs ("every API-created trigger lands active:false"),
// finally traced to buildTrigger's hardcoded `status:'draft'`, not to being API-created (see
// edit-driver.mjs's mechanism note). edit_workflow now passes `workflowStatus: fresh.status`
// into planTriggerOps, so `addTrigger` on an ALREADY-PUBLISHED workflow lands active
// immediately — the two cases now genuinely diverge and need their own assertions.
test('edit_workflow on a DRAFT workflow commits a new trigger inactive — never publishes trigger edits as a side effect', async () => {
  const initial = workflow({ status: 'draft', version: 20 });
  const { gw, calls, current, currentTriggers } = editGateway({ initial, existingTags: ['vip'] });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [
      { op: 'modifyStep', stepId: 's1', attrPatch: { tags: ['vip'] } },
      {
        op: 'addTrigger',
        trigger: { type: 'contact_tag', name: 'VIP added', filters: [{ field: 'tagsAdded', value: 'vip' }] },
      },
    ],
  }, deps(gw));

  assert.equal(result.ok, true);
  assert.equal(current().status, 'draft');
  assert.deepEqual(currentTriggers().map((trigger) => trigger.active), [false],
    'draft-first: a trigger added to a still-draft workflow stays inactive until the workflow itself is published');
  assert.equal(result.data.requiresPublish, true);
  assert.equal(result.data.partialProgress.verification.triggers.roundTrip, true);
  assert.equal(result.data.partialProgress.verification.triggers.checks[0].persisted, true);
  assert.match(result.data.publishInstruction, /publish_workflow.*confirm:true/i);
  assert.equal(Object.hasOwn(result.data, 'triggerActivation'), false);
  assert.equal(Object.hasOwn(result.data.partialProgress, 'draftApplied'), false);
  assert.equal(Object.hasOwn(result.data.partialProgress, 'publishedApplied'), false);
  assert.equal(Object.hasOwn(result.data.partialProgress, 'recovery'), false);

  const workflowPuts = calls.filter(({ method, path }) => (
    method === 'PUT' && path === '/workflow/LOC/WID'
  ));
  assert.equal(workflowPuts.length, 1, 'an edit with step changes sends one plain workflow PUT');
  assert.equal(workflowPuts[0].body.status, 'draft', 'the single PUT preserves current status');
  assert.equal('oldTriggers' in workflowPuts[0].body, false);
  assert.equal('newTriggers' in workflowPuts[0].body, false);
  assert.equal(calls.some(({ method, path, body }) => (
    method === 'PUT' && path === '/workflow/LOC/WID' && body.status !== 'draft'
  )), false, 'edit_workflow must never own a status transition');
});

test('edit_workflow on an ALREADY-PUBLISHED workflow activates a new trigger immediately — no separate publish needed, and no dead trigger left behind', async () => {
  const initial = workflow({ status: 'published', version: 20 });
  const { gw, calls, current, currentTriggers } = editGateway({ initial, existingTags: ['vip'] });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [
      { op: 'modifyStep', stepId: 's1', attrPatch: { tags: ['vip'] } },
      {
        op: 'addTrigger',
        trigger: { type: 'contact_tag', name: 'VIP added', filters: [{ field: 'tagsAdded', value: 'vip' }] },
      },
    ],
  }, deps(gw));

  assert.equal(result.ok, true);
  assert.equal(current().status, 'published');
  assert.deepEqual(currentTriggers().map((trigger) => trigger.active), [true],
    'measured 2026-08-28: a trigger POSTed with status:"published" (the target workflow\'s own state) lands active immediately — this is the addTrigger-creates-a-dead-trigger fix');
  assert.equal(result.data.requiresPublish, false, 'the trigger is already active; nothing further to publish');
  assert.equal(result.data.publishInstruction, null);
  assert.equal(result.data.partialProgress.verification.triggers.roundTrip, true);
  assert.equal(result.data.partialProgress.verification.triggers.checks[0].persisted, true);
  assert.equal(Object.hasOwn(result.data, 'triggerActivation'), false);
  assert.equal(Object.hasOwn(result.data.partialProgress, 'draftApplied'), false);
  assert.equal(Object.hasOwn(result.data.partialProgress, 'publishedApplied'), false);
  assert.equal(Object.hasOwn(result.data.partialProgress, 'recovery'), false);

  const workflowPuts = calls.filter(({ method, path }) => (
    method === 'PUT' && path === '/workflow/LOC/WID'
  ));
  assert.equal(workflowPuts.length, 1, 'an edit with step changes sends one plain workflow PUT');
  assert.equal(workflowPuts[0].body.status, 'published', 'the single PUT preserves current status');
  assert.equal('oldTriggers' in workflowPuts[0].body, false);
  assert.equal('newTriggers' in workflowPuts[0].body, false);
  assert.equal(calls.some(({ method, path, body }) => (
    method === 'PUT' && path === '/workflow/LOC/WID' && body.status !== 'published'
  )), false, 'edit_workflow must never own a status transition');
});

test('acknowledged trigger add, modify, and delete each fail closed when the change did not persist', async () => {
  const existingTrigger = {
    id: 'tr-old', _id: 'tr-old', workflowId: 'WID', type: 'contact_tag',
    name: 'Original', conditions: [], actions: [{ workflow_id: 'WID', type: 'add_to_workflow' }],
    active: false,
  };
  const scenarios = [
    {
      label: 'add', method: 'POST', triggers: [],
      op: { op: 'addTrigger', trigger: { type: 'contact_tag', name: 'Added', filters: [] } },
    },
    {
      label: 'modify', method: 'PUT', triggers: [existingTrigger],
      op: { op: 'modifyTrigger', triggerId: 'tr-old', trigger: { name: 'Renamed' } },
    },
    {
      label: 'delete', method: 'DELETE', triggers: [existingTrigger],
      op: { op: 'deleteTrigger', triggerId: 'tr-old' },
    },
  ];

  for (const scenario of scenarios) {
    const { gw, calls } = editGateway({
      triggers: scenario.triggers,
      ignoredTriggerWrites: [scenario.method],
    });
    const result = await editTool().handler({
      locationId: 'LOC', workflowId: 'WID', confirm: true, ops: [scenario.op],
    }, deps(gw));

    assert.equal(result.ok, false, scenario.label);
    assert.equal(result.code, 'ENGINE_ABORT', scenario.label);
    assert.equal(result.data.requiresPublish, false, scenario.label);
    assert.equal(result.data.publishInstruction, null, scenario.label);
    assert.equal(result.data.partialProgress.failurePhase, 'trigger_round_trip_verify', scenario.label);
    assert.equal(result.data.partialProgress.verification.triggers.attempted, true, scenario.label);
    assert.equal(result.data.partialProgress.verification.triggers.completed, true, scenario.label);
    assert.equal(result.data.partialProgress.verification.triggers.roundTrip, false, scenario.label);
    assert.equal(result.data.partialProgress.verification.triggers.checks[0].op, `${scenario.label}Trigger`);
    assert.equal(result.data.partialProgress.verification.triggers.checks[0].persisted, false);
    assert.equal(calls.filter(({ method, path }) => (
      method === 'GET' && path === '/workflow/LOC/trigger?workflowId=WID'
    )).length, 2, `${scenario.label} must re-list after the acknowledged write`);
  }
});

// Belt-and-braces considered and REJECTED 2026-08-28 for the modifyTrigger refusal added
// the same day (edit-driver.mjs): should `active` join triggerSemanticExpectation()'s
// compared keys in tools.mjs? No — see that function's comment for the full reasoning. This
// test pins the concrete scenario that reasoning describes: a per-trigger content edit
// persists cleanly while `active` reads back as something OTHER than what was echoed (e.g.
// because an unrelated publish elsewhere changed it in the gap — `active` is a
// SERVER-MANAGED PROJECTION, never something THIS PUT controls, for a pure content edit).
// The round-trip must judge the edit on what it actually touched, not on a field it never
// wrote. `active` STILL never joins the compared keys for a case like this one — see the two
// tests below for the one case that changed: an op that explicitly asked for an active
// change (the TRANSLATED case, carrying a real `status` write) now DOES get it verified.
test('modifyTrigger round-trip check ignores an `active` drift unrelated to this edit — a clean content persist must not be reported as failed', async () => {
  const existingTrigger = {
    id: 'tr-old', _id: 'tr-old', workflowId: 'WID', type: 'contact_tag',
    name: 'Original', conditions: [], active: false,
  };
  const { gw } = editGateway({
    triggers: [existingTrigger],
    triggerActiveOverride: { 'tr-old': true },
  });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [{ op: 'modifyTrigger', triggerId: 'tr-old', trigger: { name: 'Renamed' } }],
  }, deps(gw));

  assert.equal(result.ok, true);
  assert.equal(result.data.partialProgress.verification.triggers.roundTrip, true,
    'content persisted cleanly; an active drift the edit never attempted must not fail it');
  const check = result.data.partialProgress.verification.triggers.checks[0];
  assert.equal(check.persisted, true);
  assert.equal(check.mismatches.length, 0, '`active` must never appear as a mismatch — it is not a compared key');
});

// ADDED 2026-08-28 (later the same day, item 6 of the status-rail fix): now that a requested
// `active` change is a real write (translated into `status` — edit-driver.mjs's
// translateActiveToStatus), the round trip SHOULD verify it, but ONLY for this translated
// case — see triggerSemanticExpectation's updated comment in tools.mjs. This is the mirror
// image of the drift test above: THERE active was never requested, so a drift must not fail
// it; HERE active WAS explicitly requested, so a failure to persist it MUST be caught.
test('modifyTrigger round-trip check DOES verify an explicitly requested `active` change — a translated write that silently failed to flip it must be caught, never trusted from the 200', async () => {
  const existingTrigger = {
    id: 'tr-old', _id: 'tr-old', workflowId: 'WID', type: 'contact_tag',
    name: 'Original', conditions: [], active: false,
  };
  const { gw } = editGateway({
    triggers: [existingTrigger],
    // Models the measured bogus-status pitfall: the write is acknowledged (200) but the
    // trigger reads back UNCHANGED — exactly the case a bare 200 must never be trusted for.
    triggerActiveOverride: { 'tr-old': false },
  });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [{ op: 'modifyTrigger', triggerId: 'tr-old', trigger: { active: true, filters: [] } }],
  }, deps(gw));

  assert.equal(result.ok, false, 'an explicit activation that did not actually persist must fail loudly, not report success');
  assert.equal(result.data.partialProgress.failurePhase, 'trigger_round_trip_verify');
  const check = result.data.partialProgress.verification.triggers.checks[0];
  assert.equal(check.persisted, false);
  assert.ok(check.mismatches.some((m) => m.path === 'active'), '`active` must be the flagged mismatch when the op explicitly requested it');
});

test('modifyTrigger round-trip check confirms an explicitly requested `active` change when it DOES persist', async () => {
  const existingTrigger = {
    id: 'tr-old', _id: 'tr-old', workflowId: 'WID', type: 'contact_tag',
    name: 'Original', conditions: [], active: false,
  };
  const { gw } = editGateway({ triggers: [existingTrigger] });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [{ op: 'modifyTrigger', triggerId: 'tr-old', trigger: { active: true, filters: [] } }],
  }, deps(gw));

  assert.equal(result.ok, true);
  const check = result.data.partialProgress.verification.triggers.checks[0];
  assert.equal(check.persisted, true);
  assert.equal(check.mismatches.length, 0);
});

const identicalAddTrigger = () => ({
  op: 'addTrigger',
  trigger: { type: 'contact_tag', name: 'Identical add', filters: [] },
});

const persistedIdenticalTrigger = (id) => ({
  id, _id: id, workflowId: 'WID', type: 'contact_tag', masterType: 'highlevel',
  name: 'Identical add', conditions: [], schedule_config: {},
  actions: [{ workflow_id: 'WID', type: 'add_to_workflow' }], active: false,
});

test('empty acknowledged add cannot use an unchanged pre-existing identical trigger as persistence proof', async () => {
  const { gw } = editGateway({
    triggers: [persistedIdenticalTrigger('tr-existing')],
    triggerPostResponseIds: [null],
    triggerPostPersistedIds: [null],
  });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [identicalAddTrigger()],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(result.data.requiresPublish, false);
  assert.equal(result.data.publishInstruction, null);
  assert.equal(result.data.partialProgress.failurePhase, 'trigger_round_trip_verify');
  assert.equal(result.data.partialProgress.verification.triggers.checks[0].persisted, false);
});

test('two identical acknowledged adds cannot reuse one newly observed fallback candidate', async () => {
  const { gw } = editGateway({
    triggerPostResponseIds: [null, null],
    triggerPostPersistedIds: ['tr-new-only', null],
  });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [identicalAddTrigger(), identicalAddTrigger()],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(result.data.requiresPublish, false);
  assert.equal(result.data.publishInstruction, null);
  assert.deepEqual(
    result.data.partialProgress.verification.triggers.checks.map(({ persisted }) => persisted),
    [true, false],
  );
});

test('identical acknowledged adds without returned IDs pass when distinct new candidates persist', async () => {
  const { gw } = editGateway({
    triggerPostResponseIds: [null, null],
    triggerPostPersistedIds: ['tr-new-1', 'tr-new-2'],
  });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [identicalAddTrigger(), identicalAddTrigger()],
  }, deps(gw));

  assert.equal(result.ok, true);
  assert.equal(result.data.requiresPublish, true);
  const checks = result.data.partialProgress.verification.triggers.checks;
  assert.deepEqual(checks.map(({ persisted }) => persisted), [true, true]);
  assert.deepEqual(checks.map(({ triggerId }) => triggerId), ['tr-new-1', 'tr-new-2']);
});

// CORRECTED 2026-08-28: this used to assert `requiresPublish:true` for a PUBLISHED target
// workflow too — belief #2 from the corpus/docs ("every API-created trigger lands
// active:false", so a publish is always needed), traced to buildTrigger's hardcoded
// `status:'draft'`, not to being API-created. The preview now reflects what the planned
// request will actually do: an addTrigger against an already-published workflow activates
// immediately, so no publish is required for it.
test('trigger preview on a DRAFT workflow tells the caller that a confirmed publish_workflow is needed to activate the change', async () => {
  const { gw, calls } = editGateway({
    initial: workflow({ status: 'draft', version: 20 }),
    existingTags: ['vip'],
  });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID',
    ops: [{
      op: 'addTrigger',
      trigger: { type: 'contact_tag', name: 'VIP added', filters: [{ field: 'tagsAdded', value: 'vip' }] },
    }],
  }, deps(gw));

  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.equal(result.data.preview.requiresPublish, true);
  assert.match(result.data.preview.publishInstruction, /publish_workflow.*confirm:true/i);
  assert.equal(calls.some(({ method }) => ['POST', 'PUT', 'DELETE'].includes(method)), false);
});

test('trigger preview on an ALREADY-PUBLISHED workflow tells the caller no separate publish is needed — the trigger will land active', async () => {
  const { gw, calls } = editGateway({
    initial: workflow({ status: 'published', version: 20 }),
    existingTags: ['vip'],
  });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID',
    ops: [{
      op: 'addTrigger',
      trigger: { type: 'contact_tag', name: 'VIP added', filters: [{ field: 'tagsAdded', value: 'vip' }] },
    }],
  }, deps(gw));

  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.equal(result.data.preview.requiresPublish, false);
  assert.equal(result.data.preview.publishInstruction, null);
  assert.equal(calls.some(({ method }) => ['POST', 'PUT', 'DELETE'].includes(method)), false);
});

test('failed custom-field lookup stays unknown so engine passthrough remains available', async () => {
  const { gw } = editGateway({
    customFieldsResponse: { status: 503, ok: false, json: { message: 'field index unavailable' } },
  });
  const result = await editTool().handler({
    locationId: 'LOC',
    workflowId: 'WID',
    assumeAssociated: true,
    ops: [{
      op: 'appendStep',
      step: {
        type: 'update_opportunity',
        name: 'Unknown field while index is down',
        attributes: { updates: [{ field: 'mysteryField', value: 'x' }] },
      },
    }],
  }, deps(gw));

  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.match(result.data.warnings.join('\n'), /no customFields list.*emitted as authored/i);
});

test('successful empty custom-field list remains authoritative', async () => {
  const { gw } = editGateway();
  const result = await editTool().handler({
    locationId: 'LOC',
    workflowId: 'WID',
    assumeAssociated: true,
    ops: [{
      op: 'appendStep',
      step: {
        type: 'update_opportunity',
        name: 'Unknown field with authoritative index',
        attributes: { updates: [{ field: 'mysteryField', value: 'x' }] },
      },
    }],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.match(result.detail, /neither a standard opportunity field/i);
});

test('malformed custom-field items degrade to unavailable instead of throwing', async () => {
  for (const customFields of [[null], [{ name: 'Missing identity' }]]) {
    const { gw } = editGateway({
      customFieldsResponse: { status: 200, ok: true, json: { customFields } },
    });
    const result = await editTool().handler({
      locationId: 'LOC',
      workflowId: 'WID',
      assumeAssociated: true,
      ops: [{
        op: 'appendStep',
        step: {
          type: 'update_opportunity',
          name: 'Unknown field with malformed index',
          attributes: { updates: [{ field: 'mysteryField', value: 'x' }] },
        },
      }],
    }, deps(gw));

    assert.equal(result.code, 'CONFIRM_REQUIRED');
    assert.match(result.data.warnings.join('\n'), /no customFields list.*emitted as authored/i);
  }
});

// A stored workflow closed into a cycle by its own goto: g -> s1 -> s2 -> g. Fix #1/#5 pairing:
// editCommitBody's GOTO_LOOP guard (edit.mjs) names `allowGotoLoops:true` as its remedy — this
// proves that hatch is actually reachable from the tool, end to end through the wire schema.
const gotoLoopWorkflow = () => workflow({
  templates: [
    { id: 's1', type: 'add_contact_tag', name: 'First', next: 's2', parentKey: null, order: 0, attributes: { tags: ['a'] } },
    { id: 's2', type: 'add_contact_tag', name: 'Second', next: 'g', parentKey: 's1', order: 1, attributes: { tags: ['b'] } },
    { id: 'g', type: 'goto', name: 'Back to first', parentKey: 's2', order: 2, attributes: { targetNodeId: 's1', type: 'goto' } },
  ],
});

test('edit_workflow refuses to commit an edit that leaves a goto loop, naming the allowGotoLoops:true hatch', async () => {
  const { gw, calls } = editGateway({ initial: gotoLoopWorkflow() });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true,
    ops: [{ op: 'renameStep', stepId: 'g', name: 'Loop back to first' }],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.match(result.detail, /allowGotoLoops:true/);
  assert.equal(calls.some(({ method }) => method === 'PUT'), false, 'no write was sent');
});

test('edit_workflow allowGotoLoops:true lets that same edit commit', async () => {
  const { gw, calls } = editGateway({ initial: gotoLoopWorkflow() });
  const result = await editTool().handler({
    locationId: 'LOC', workflowId: 'WID', confirm: true, allowGotoLoops: true,
    ops: [{ op: 'renameStep', stepId: 'g', name: 'Loop back to first' }],
  }, deps(gw));

  assert.equal(result.ok, true, JSON.stringify(result));
  const put = calls.find(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/WID');
  assert.ok(put, 'the step commit PUT must have been sent');
  const renamed = put.body.workflowData.templates.find((t) => t.id === 'g');
  assert.equal(renamed.name, 'Loop back to first');
});

test('identical workflow version and canonical ops keep preview and confirm ids identical', async () => {
  const ops = [{
    op: 'appendStep',
    step: { type: 'add_contact_tag', name: 'Add VIP', attributes: { tags: ['vip'] } },
  }];
  const previewGateway = editGateway({ existingTags: ['vip'] });
  const confirmedGateway = editGateway({ existingTags: ['vip'] });
  const preview = await editTool().handler(
    { locationId: 'LOC', workflowId: 'WID', ops },
    deps(previewGateway.gw),
  );
  const confirmed = await editTool().handler(
    { locationId: 'LOC', workflowId: 'WID', ops, confirm: true },
    deps(confirmedGateway.gw),
  );

  assert.equal(confirmed.ok, true);
  assert.deepEqual(confirmed.data.idsAdded, preview.data.preview.idsAdded);
});

test('deterministic edit ids change when workflow version or canonical op content changes', async () => {
  const opA = [{
    op: 'appendStep',
    step: { name: 'Add VIP', attributes: { tags: ['vip'] }, type: 'add_contact_tag' },
  }];
  const opAReordered = [{
    step: { type: 'add_contact_tag', attributes: { tags: ['vip'] }, name: 'Add VIP' },
    op: 'appendStep',
  }];
  const opB = [{
    op: 'appendStep',
    step: { type: 'add_contact_tag', name: 'Add Gold', attributes: { tags: ['gold'] } },
  }];
  const previewIds = async (initial, ops, tags) => {
    const { gw } = editGateway({ initial, existingTags: tags });
    const result = await editTool().handler({ locationId: 'LOC', workflowId: 'WID', ops }, deps(gw));
    return result.data.preview.idsAdded;
  };

  const base = await previewIds(workflow({ version: 7 }), opA, ['vip']);
  assert.deepEqual(await previewIds(workflow({ version: 7 }), opAReordered, ['vip']), base,
    'object key order is not semantic and must not change the canonical seed');
  assert.notDeepEqual(await previewIds(workflow({ version: 8 }), opA, ['vip']), base);
  assert.notDeepEqual(await previewIds(workflow({ version: 7 }), opB, ['gold']), base);
});

test('round-trip verification fails when GHL ignores a nested modifyStep value', async () => {
  const { gw } = editGateway({
    persistTransform: (body) => {
      const ignored = structuredClone(body);
      ignored.workflowData.templates.find((step) => step.id === 's1').attributes.tags = ['old'];
      return ignored;
    },
  });
  const result = await editTool().handler({
    locationId: 'LOC',
    workflowId: 'WID',
    confirm: true,
    ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { tags: ['new'] } }],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(result.data.verify.roundTrip, false);
  assert.ok(result.data.verify.valueMismatches.some(({ id, path }) => (
    id === 's1' && path === 'attributes.tags[0]'
  )));
});

test('round-trip verification fails when GHL drops advanceCanvasMeta.isDisabled', async () => {
  const { gw } = editGateway({
    persistTransform: (body) => {
      const ignored = structuredClone(body);
      delete ignored.workflowData.templates.find((step) => step.id === 's1').advanceCanvasMeta;
      return ignored;
    },
  });
  const result = await editTool().handler({
    locationId: 'LOC',
    workflowId: 'WID',
    confirm: true,
    ops: [{ op: 'setStepDisabled', stepId: 's1', disabled: true }],
  }, deps(gw));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(result.data.verify.roundTrip, false);
  assert.ok(result.data.verify.valueMismatches.some(({ id, path, expected }) => (
    id === 's1' && path === 'advanceCanvasMeta' && expected.isDisabled === true
  )));
});

test('tag, step, and trigger transport throws all return urgent per-write ambiguity metadata', async () => {
  const scenarios = [
    {
      phase: 'tag_create',
      gateway: () => editGateway({ throwAfterTagCreate: true }),
      request: {
        locationId: 'LOC', workflowId: 'WID', confirm: true,
        ops: [{ op: 'appendStep', step: { type: 'add_contact_tag', name: 'Add VIP', attributes: { tags: ['vip'] } } }],
      },
    },
    {
      phase: 'step_commit',
      gateway: () => editGateway({ throwAfterStepCommit: true }),
      request: {
        locationId: 'LOC', workflowId: 'WID', confirm: true,
        ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { tags: ['new'] } }],
      },
    },
    {
      phase: 'trigger_write',
      gateway: () => editGateway({ existingTags: ['vip'], throwAfterTriggerPost: true }),
      request: {
        locationId: 'LOC', workflowId: 'WID', confirm: true,
        ops: [{
          op: 'addTrigger',
          trigger: { type: 'contact_tag', name: 'VIP added', filters: [{ field: 'tagsAdded', value: 'vip' }] },
        }],
      },
    },
  ];

  for (const scenario of scenarios) {
    const { gw } = scenario.gateway();
    const result = await editTool().handler(scenario.request, deps(gw));
    assert.equal(result.ok, false, scenario.phase);
    assert.match(result.remediation, /URGENT/i, scenario.phase);
    assert.equal(result.data.partialProgress.failurePhase, scenario.phase);
    const outcome = result.data.partialProgress.writes.find(({ phase }) => phase === scenario.phase);
    assert.equal(outcome.attempted, true, scenario.phase);
    assert.equal(outcome.acknowledged, false, scenario.phase);
    assert.equal(outcome.ambiguous, true, scenario.phase);
    assert.doesNotMatch(result.remediation, /republish|remain draft|recovery/i, scenario.phase);
    assert.equal(Object.hasOwn(result.data.partialProgress, 'recovery'), false, scenario.phase);
  }
});
