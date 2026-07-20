import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';

const buildTool = () => TOOLS.find((candidate) => candidate.name === 'build_workflow');

const tagSpec = () => ({
  name: 'Draft workflow',
  triggers: [],
  graph: [{
    ref: 'tag-contact',
    kind: 'action',
    type: 'add_contact_tag',
    name: 'Tag contact',
    attributes: { tags: ['existing-tag'] },
  }],
});

function buildGateway({
  persistedSteps = 'sent',
  createFails = false,
  existingTags = ['existing-tag'],
  throwAt = null,
} = {}) {
  const calls = [];
  let sentTemplates = [];
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.includes('/opportunities/pipelines')) return { status: 200, ok: true, json: { pipelines: [] } };
      if (path.includes('/calendars/')) return { status: 200, ok: true, json: { calendars: [] } };
      if (path.includes('/users/')) return { status: 200, ok: true, json: { users: [] } };
      if (path.includes('/forms/')) return { status: 200, ok: true, json: { forms: [] } };
      if (path.includes('/customFields/search')) return { status: 200, ok: true, json: { customFields: [] } };
      if (path.includes('/voice-ai/agents') || path.includes('/ai-employees/agents')) {
        return { status: 404, ok: false, json: {} };
      }
      if (method === 'GET' && path === '/locations/LOC/tags') {
        return { status: 200, ok: true, json: { tags: existingTags.map((name) => ({ name })) } };
      }
      if (method === 'POST' && path === '/locations/LOC/tags') {
        existingTags.push(body.name);
        return { status: 201, ok: true, json: { id: `tag-${existingTags.length}`, name: body.name } };
      }
      if (method === 'POST' && path === '/workflow/LOC') {
        if (throwAt === 'workflow_create') throw new Error('transport lost before workflow create response');
        if (createFails) return { status: 500, ok: false, json: { message: 'create unavailable' } };
        return { status: 201, ok: true, json: { id: 'WID_1' } };
      }
      if (method === 'PUT' && path === '/workflow/LOC/WID_1/auto-save') {
        if (throwAt === 'workflow_auto_save') throw new Error('transport lost after workflow creation');
        sentTemplates = body.workflowData.templates;
        return { status: 200, ok: true, json: {} };
      }
      if (method === 'GET' && path === '/workflow/LOC/WID_1?includeScheduledPauseInfo=true') {
        return {
          status: 200,
          ok: true,
          json: { workflowData: { templates: persistedSteps === 'sent' ? sentTemplates : [] } },
        };
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  };
  return { gw, calls };
}

const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });

test('build_workflow is registered with a permissive object schema for spec', async () => {
  assert.ok(buildTool(), 'build_workflow must exist');
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, { state: {}, makeGw: () => { throw new Error('unused'); } }, [buildTool()]);

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const schema = listed.tools[0].inputSchema;
    assert.equal(schema.type, 'object');
    assert.deepEqual(schema.required.sort(), ['locationId', 'spec']);
    assert.notEqual(schema.properties.spec.additionalProperties, false,
      'spec must stay permissive so the engine remains the validator');
    assert.equal(schema.properties.ignoreUnresolved.default, false);
  } finally {
    await client.close();
  }
});

test('build_workflow delegates a successful draft to the orchestrator and returns its full report', async () => {
  const { gw, calls } = buildGateway();
  const result = await buildTool().handler(
    { locationId: 'LOC', spec: tagSpec(), ignoreUnresolved: false },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.wid, 'WID_1');
  assert.deepEqual(
    { authored: result.data.authored, compiled: result.data.compiled, steps: result.data.steps },
    { authored: 1, compiled: 1, steps: 1 },
  );
  assert.equal(result.data.countIntegrity.mismatch, false);
  assert.deepEqual(result.data.createdTags, []);
  assert.deepEqual(result.data.createdTemplates, []);
  assert.deepEqual(result.data.unresolved, []);
  assert.deepEqual(result.data.verify, { pass: 1, issues: [] });
  assert.equal(result.data.builderUrl,
    'https://app.gohighlevel.com/v2/location/LOC/automation/workflow/WID_1');
  assert.equal(result.data.published, false);
  assert.match(result.data.publicationNote, /nothing (?:was|is) published/i);
  assert.equal(
    calls.some(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/WID_1'),
    false,
    'draft build must never make the publish PUT',
  );
});

test('build_workflow loudly reports authored/compiled/persisted step mismatch together', async () => {
  const { gw } = buildGateway({ persistedSteps: 'none' });
  const result = await buildTool().handler(
    { locationId: 'LOC', spec: tagSpec() },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    { authored: result.data.authored, compiled: result.data.compiled, steps: result.data.steps },
    { authored: 1, compiled: 1, steps: 0 },
  );
  assert.equal(result.data.countIntegrity.mismatch, true);
  assert.match(result.data.countIntegrity.warning, /LOUD.*MISMATCH/i);
  assert.equal(result.data.verify.issues[0].stepCountMismatch.got, 0);
});

test('build_workflow maps unresolved-dependency aborts to a failure with report data', async () => {
  const { gw, calls } = buildGateway();
  const spec = {
    name: 'Blocked workflow',
    triggers: [],
    graph: [{
      ref: 'create-opportunity',
      kind: 'action',
      type: 'create_opportunity',
      name: 'Create opportunity',
      attributes: { name: 'Deal', pipeline: 'Ghost pipeline', status: 'open' },
    }],
  };
  const result = await buildTool().handler(
    { locationId: 'LOC', spec, ignoreUnresolved: false },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNRESOLVED_DEPS');
  assert.match(result.detail, /Ghost pipeline/);
  assert.match(result.detail, /unresolved/i);
  assert.equal(result.data.aborted.startsWith('Missing account dependencies:'), true);
  assert.equal(result.data.unresolved[0].name, 'Ghost pipeline');
  assert.deepEqual(result.data.createdTags, []);
  assert.deepEqual(result.data.createdTemplates, []);
  assert.deepEqual(result.data.verify, { pass: 0, issues: [] });
  assert.equal(result.data.builderUrl, null);
  assert.equal(result.data.published, false);
  assert.match(result.data.publicationNote, /nothing (?:was|is) published/i);
  assert.equal(calls.some(({ method, path }) => method === 'POST' && path === '/workflow/LOC'), false);
});

test('build_workflow maps a non-dependency engine abort to ENGINE_ABORT and never throws', async () => {
  const { gw } = buildGateway();
  const spec = {
    name: 'Rejected workflow',
    triggers: [],
    graph: [{
      ref: 'update-opportunity',
      kind: 'action',
      type: 'update_opportunity',
      name: 'Update opportunity',
      attributes: { updates: [{ field: 'status', value: 'won' }] },
    }],
  };

  let result;
  await assert.doesNotReject(async () => {
    result = await buildTool().handler({ locationId: 'LOC', spec }, deps(gw));
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.match(result.detail, /OPP_UNASSOCIATED/);
  assert.deepEqual(result.data.unresolved, []);
  assert.equal(result.data.published, false);
});

test('build_workflow keeps a downstream abort as ENGINE_ABORT when ignored dependencies remain in the report', async () => {
  const { gw } = buildGateway({ createFails: true });
  const spec = {
    name: 'Forced unresolved workflow',
    triggers: [],
    graph: [{
      ref: 'create-opportunity',
      kind: 'action',
      type: 'create_opportunity',
      name: 'Create opportunity',
      attributes: { name: 'Deal', pipeline: 'Ghost pipeline', status: 'open' },
    }],
  };
  const result = await buildTool().handler(
    { locationId: 'LOC', spec, ignoreUnresolved: true },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT', 'the create failure, not the ignored dependency, caused this abort');
  assert.match(result.detail, /create failed: 500/);
  assert.equal(result.data.unresolved[0].name, 'Ghost pipeline');
});

test('build_workflow returns observed dependency resources when transport fails before workflow creation', async () => {
  const { gw } = buildGateway({ existingTags: [], throwAt: 'workflow_create' });
  const result = await buildTool().handler(
    { locationId: 'LOC', spec: tagSpec() },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.ok(result.data, 'transport abort must carry the partial orchestrator report');
  assert.equal(result.data.aborted !== null, true);
  assert.equal(result.data.failurePhase, 'workflow_create');
  assert.deepEqual(result.data.createdTags, ['existing-tag']);
  assert.deepEqual(result.data.createdTemplates, []);
  assert.equal(result.data.wid, null);
  assert.equal(result.data.builderUrl, null);
  assert.deepEqual(result.data.unresolved, []);
  assert.deepEqual(result.data.verify, { pass: 0, issues: [] });
  assert.match(result.remediation, /createdTags|partial resources|cleanup|inspect/i);
});

test('build_workflow returns the observed workflow id and builder URL when transport fails after creation', async () => {
  const { gw } = buildGateway({ throwAt: 'workflow_auto_save' });
  const result = await buildTool().handler(
    { locationId: 'LOC', spec: tagSpec() },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.ok(result.data, 'post-create transport abort must retain the observed workflow resource');
  assert.equal(result.data.failurePhase, 'workflow_auto_save');
  assert.equal(result.data.wid, 'WID_1');
  assert.equal(result.data.builderUrl,
    'https://app.gohighlevel.com/v2/location/LOC/automation/workflow/WID_1');
  assert.deepEqual(result.data.createdTags, []);
  assert.deepEqual(result.data.createdTemplates, []);
  assert.equal(result.data.authored, 1);
  assert.equal(result.data.compiled, 1);
  assert.equal(result.data.steps, 0);
  assert.match(result.remediation, /WID_1|builder|cleanup|inspect/i);
});

test('build_workflow maps a known dependency HTTP failure through fromHttp with partial cleanup data', async () => {
  const upstreamCredential = 'eyJhbGciOiJIUzI1NiJ9.build-dependency-credential-fixture.signature';
  const { gw, calls } = buildGateway({ existingTags: [] });
  const inner = gw.call;
  gw.call = async (method, path, body) => {
    if (method === 'POST' && path === '/locations/LOC/tags') {
      calls.push({ method, path, body });
      return {
        status: 500,
        ok: false,
        json: { message: 'tag create rejected', authorization: upstreamCredential },
      };
    }
    return inner(method, path, body);
  };

  const result = await buildTool().handler(
    { locationId: 'LOC', spec: tagSpec() },
    deps(gw),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_500');
  assert.equal(result.data.failurePhase, 'tag_create');
  assert.equal(result.data.failureHttp.status, 500);
  assert.equal(result.data.failureHttp.body.authorization, '<redacted>');
  assert.equal(JSON.stringify(result).includes(upstreamCredential), false);
  assert.match(result.remediation, /partial|cleanup|inspect/i);
  assert.equal(calls.some(({ method, path }) => (
    method === 'POST' && path === '/workflow/LOC'
  )), false);
});
