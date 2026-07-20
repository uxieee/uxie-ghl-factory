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
          currentTriggers.push({
            ...structuredClone(body), id: persistedId, _id: persistedId, active: false,
          });
        }
        if (throwAfterTriggerPost) throw new Error('transport lost after trigger POST applied');
        return { status: 201, ok: true, json: responseId ? { id: responseId } : {} };
      }
      if (path.startsWith('/workflow/LOC/trigger/') && method === 'PUT') {
        const triggerId = path.split('/').at(-1);
        if (!ignoredTriggerWrites.includes('PUT')) {
          currentTriggers = currentTriggers.map((trigger) => (
            (trigger.id ?? trigger._id) === triggerId ? structuredClone(body) : trigger
          ));
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

for (const initialStatus of ['draft', 'published']) {
  test(`edit_workflow preserves an initially ${initialStatus} status and never publishes trigger edits`, async () => {
    const initial = workflow({ status: initialStatus, version: 20 });
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
    assert.equal(current().status, initialStatus);
    assert.deepEqual(currentTriggers().map((trigger) => trigger.active), [false],
      'edit commits trigger configuration but does not activate or publish it');
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
    assert.equal(workflowPuts[0].body.status, initialStatus, 'the single PUT preserves current status');
    assert.equal('oldTriggers' in workflowPuts[0].body, false);
    assert.equal('newTriggers' in workflowPuts[0].body, false);
    assert.equal(calls.some(({ method, path, body }) => (
      method === 'PUT' && path === '/workflow/LOC/WID' && body.status !== initialStatus
    )), false, 'edit_workflow must never own a status transition');
  });
}

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

test('trigger preview tells the caller that only confirmed publish_workflow activates the change', async () => {
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
  assert.equal(result.data.preview.requiresPublish, true);
  assert.match(result.data.preview.publishInstruction, /publish_workflow.*confirm:true/i);
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
