import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';

const fastForwardTool = () => TOOLS.find((candidate) => candidate.name === 'fast_forward_contacts');

function depsFixture({
  rows = [], getFailure = null, postFailure = null, throwAfterPostApply = false,
} = {}) {
  const calls = [];
  let made = 0;
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.includes('/details-by-step?')) {
        if (getFailure) return getFailure;
        const query = new URLSearchParams(path.split('?')[1]);
        const skip = Number(query.get('skip'));
        const limit = Number(query.get('limit'));
        return {
          status: 200,
          ok: true,
          json: { totalCount: rows.length, rows: rows.slice(skip, skip + limit) },
        };
      }
      if (method === 'POST' && path.includes('/requeue-stuck-statuses/')) {
        if (throwAfterPostApply) throw new Error('transport lost after requeue applied');
        if (postFailure) return postFailure;
        return { status: 200, ok: true, json: { queued: body.statusIds } };
      }
      return { status: 404, ok: false, json: { message: 'unstubbed' } };
    },
  };
  return {
    calls,
    made: () => made,
    deps: {
      state: { tokenFile: '/fixture/token.txt' },
      makeGw: () => { made++; return gw; },
    },
  };
}

const request = (selector, extra = {}) => ({
  locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', ...selector, ...extra,
});

async function previewFor(selector, rows) {
  const fixture = depsFixture({ rows });
  const result = await fastForwardTool().handler(request(selector), fixture.deps);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  return { result, fixture };
}

test('fast_forward_contacts is registered with an optional previewToken', async () => {
  assert.ok(fastForwardTool(), 'fast_forward_contacts must exist');
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, { state: {}, makeGw: () => { throw new Error('unused'); } }, [fastForwardTool()]);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.ok(listed.tools[0].inputSchema.properties.previewToken,
      'previewToken must be a declared MCP input, not an unknown passthrough field');
    assert.equal(listed.tools[0].inputSchema.properties.previewToken.type, 'string');
    assert.equal(listed.tools[0].inputSchema.required.includes('previewToken'), false);
  } finally {
    await client.close();
  }
});

test('fast_forward_contacts rejects zero, multiple, false, and empty selectors before account access', async () => {
  const invalidSelectors = [
    {},
    { contactId: '' },
    { statusIds: [] },
    { all: false },
    { contactId: 'CONTACT_1', all: true },
    { contactId: 'CONTACT_1', statusIds: ['STATUS_1'] },
    { statusIds: ['STATUS_1'], all: true },
    { contactId: '', all: true },
    { statusIds: [], all: true },
    { contactId: 'CONTACT_1', all: false },
  ];

  for (const selector of invalidSelectors) {
    const fixture = depsFixture();
    const result = await fastForwardTool().handler({
      locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', ...selector,
    }, fixture.deps);

    assert.equal(result.ok, false, JSON.stringify(selector));
    assert.equal(result.code, 'VALIDATION_FAILED', JSON.stringify(selector));
    assert.equal(fixture.made(), 0, JSON.stringify(selector));
    assert.equal(fixture.calls.length, 0, JSON.stringify(selector));
  }
});

test('fast_forward_contacts preview walks every parked page and never writes', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    _id: `STATUS_${index + 1}`,
    contactId: `CONTACT_${index + 1}`,
  }));
  const fixture = depsFixture({ rows });
  const result = await fastForwardTool().handler({
    locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', all: true,
  }, fixture.deps);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.equal(result.data.preview.count, 51);
  assert.deepEqual(result.data.preview.statusIds, rows.map((row) => row._id));
  assert.match(result.data.preview.previewToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.data.preview.samples.statusIds, rows.slice(0, 10).map((row) => row._id));
  assert.deepEqual(result.data.preview.samples.contactIds, rows.slice(0, 10).map((row) => row.contactId));
  assert.deepEqual(
    fixture.calls.filter(({ method }) => method === 'GET').map(({ path }) => path.match(/[?&]skip=(\d+)/)[1]),
    ['0', '50'],
  );
  assert.equal(fixture.calls.some(({ method }) => method === 'POST'), false);
});

test('fast_forward_contacts preview resolves contact and status selectors read-only', async () => {
  const rows = [
    { _id: 'STATUS_1', contactId: 'CONTACT_OTHER' },
    { _id: 'STATUS_2', contactId: 'CONTACT_TARGET' },
    { _id: 'STATUS_3', contactId: 'CONTACT_TARGET' },
  ];

  const byContact = depsFixture({ rows });
  const contactResult = await fastForwardTool().handler({
    locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', contactId: 'CONTACT_TARGET',
  }, byContact.deps);
  assert.equal(contactResult.code, 'CONFIRM_REQUIRED');
  assert.equal(contactResult.data.preview.count, 2);
  assert.deepEqual(contactResult.data.preview.statusIds, ['STATUS_2', 'STATUS_3']);
  assert.match(contactResult.data.preview.previewToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(contactResult.data.preview.samples.statusIds, ['STATUS_2', 'STATUS_3']);
  assert.deepEqual(contactResult.data.preview.samples.contactIds, ['CONTACT_TARGET', 'CONTACT_TARGET']);
  assert.equal(byContact.calls.some(({ method }) => method === 'POST'), false);

  const byStatus = depsFixture({ rows });
  const statusResult = await fastForwardTool().handler({
    locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', statusIds: ['STATUS_1', 'STATUS_3'],
  }, byStatus.deps);
  assert.equal(statusResult.code, 'CONFIRM_REQUIRED');
  assert.equal(statusResult.data.preview.count, 2);
  assert.deepEqual(statusResult.data.preview.statusIds, ['STATUS_1', 'STATUS_3']);
  assert.match(statusResult.data.preview.previewToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(statusResult.data.preview.samples.statusIds, ['STATUS_1', 'STATUS_3']);
  assert.deepEqual(statusResult.data.preview.samples.contactIds, ['CONTACT_OTHER', 'CONTACT_TARGET']);
  assert.equal(byStatus.calls.some(({ method }) => method === 'POST'), false);
});

test('confirmed fast-forward requeues exact workflow-status ULIDs and reports attempted and moved IDs', async () => {
  const rows = [
    { _id: 'STATUS_ULID_1', contactId: 'CONTACT_1' },
    { _id: 'STATUS_ULID_2', contactId: 'CONTACT_2' },
  ];
  const selector = { statusIds: ['STATUS_ULID_1', 'STATUS_ULID_2'] };
  const preview = await previewFor(selector, rows);
  const fixture = depsFixture({ rows });
  const result = await fastForwardTool().handler({
    locationId: 'LOC',
    workflowId: 'WID',
    stepId: 'STEP',
    ...selector,
    previewToken: preview.result.data.preview.previewToken,
    confirm: true,
  }, fixture.deps);

  assert.equal(result.ok, true);
  assert.equal(result.data.moved, 2);
  assert.deepEqual(result.data.statusIds, ['STATUS_ULID_1', 'STATUS_ULID_2']);
  assert.deepEqual(result.data.statusIdsAttempted, ['STATUS_ULID_1', 'STATUS_ULID_2']);
  assert.deepEqual(result.data.statusIdsMoved, ['STATUS_ULID_1', 'STATUS_ULID_2']);
  assert.deepEqual(fixture.calls.at(-1), {
    method: 'POST',
    path: '/workflow/LOC/WID/requeue-stuck-statuses/STEP',
    body: {
      actionFrom: { userId: 'USER', channel: 'web_app', source: 'action_stats_page' },
      statusIds: ['STATUS_ULID_1', 'STATUS_ULID_2'],
    },
  });
  assert.equal(result.data.partialProgress.write.acknowledged, true);
  assert.equal(result.data.partialProgress.write.ambiguous, false);
});

test('confirmed statusIds resolve the same current parked set as preview when live and stale IDs are mixed', async () => {
  const rows = [
    { _id: 'STATUS_LIVE', contactId: 'CONTACT_LIVE' },
    { _id: 'STATUS_OTHER', contactId: 'CONTACT_OTHER' },
  ];
  const args = {
    locationId: 'LOC', workflowId: 'WID', stepId: 'STEP',
    statusIds: ['STATUS_LIVE', 'STATUS_STALE'],
  };
  const previewFixture = depsFixture({ rows });
  const preview = await fastForwardTool().handler(args, previewFixture.deps);
  const confirmFixture = depsFixture({ rows });
  const confirmed = await fastForwardTool().handler({
    ...args, confirm: true, previewToken: preview.data.preview.previewToken,
  }, confirmFixture.deps);

  assert.equal(preview.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(preview.data.preview.samples.statusIds, ['STATUS_LIVE']);
  assert.equal(confirmed.ok, true);
  assert.deepEqual(confirmed.data.statusIdsAttempted, preview.data.preview.statusIds);
  assert.deepEqual(confirmed.data.statusIdsMoved, ['STATUS_LIVE']);
  assert.deepEqual(confirmFixture.calls.at(-1).body.statusIds, ['STATUS_LIVE']);
});

test('statusIds preview exposes the full resolved set even when samples are truncated', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    _id: `STATUS_${index + 1}`,
    contactId: `CONTACT_${index + 1}`,
  }));
  const statusIds = [...rows.map((row) => row._id), 'STATUS_STALE'];
  const previewFixture = depsFixture({ rows });
  const preview = await fastForwardTool().handler({
    locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', statusIds,
  }, previewFixture.deps);
  const confirmFixture = depsFixture({ rows });
  const confirmed = await fastForwardTool().handler({
    locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', statusIds, confirm: true,
    previewToken: preview.data.preview.previewToken,
  }, confirmFixture.deps);

  assert.equal(preview.data.preview.samples.statusIds.length, 10);
  assert.deepEqual(preview.data.preview.statusIds, rows.map((row) => row._id));
  assert.deepEqual(confirmed.data.statusIdsAttempted, preview.data.preview.statusIds);
});

test('confirmed stale-only statusIds resolve empty and do not POST', async () => {
  const rows = [{ _id: 'STATUS_OTHER', contactId: 'CONTACT_OTHER' }];
  const preview = await previewFor({ statusIds: ['STATUS_STALE'] }, rows);
  const fixture = depsFixture({ rows });
  const result = await fastForwardTool().handler({
    locationId: 'LOC', workflowId: 'WID', stepId: 'STEP',
    statusIds: ['STATUS_STALE'], confirm: true,
    previewToken: preview.result.data.preview.previewToken,
  }, fixture.deps);

  assert.equal(result.ok, true);
  assert.equal(result.data.moved, 0);
  assert.deepEqual(result.data.statusIdsAttempted, []);
  assert.equal(fixture.calls.some(({ method }) => method === 'POST'), false);
});

test('confirmed all selector walks every 50-row page before one exact requeue', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    _id: `STATUS_${index + 1}`,
    contactId: `CONTACT_${index + 1}`,
  }));
  const preview = await previewFor({ all: true }, rows);
  const fixture = depsFixture({ rows });
  const result = await fastForwardTool().handler({
    locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', all: true, confirm: true,
    previewToken: preview.result.data.preview.previewToken,
  }, fixture.deps);

  assert.equal(result.ok, true);
  assert.equal(result.data.moved, 51);
  assert.deepEqual(result.data.statusIdsAttempted, rows.map((row) => row._id));
  assert.deepEqual(result.data.statusIdsMoved, rows.map((row) => row._id));
  assert.deepEqual(
    fixture.calls.filter(({ method }) => method === 'GET').map(({ path }) => path.match(/[?&]skip=(\d+)/)[1]),
    ['0', '50'],
  );
  assert.equal(fixture.calls.filter(({ method }) => method === 'POST').length, 1);
});

test('requeue applied then transport throws is an urgent ambiguous failure, never a bare success', async () => {
  const rows = [{ _id: 'STATUS_ULID_1', contactId: 'CONTACT_1' }];
  const preview = await previewFor({ statusIds: ['STATUS_ULID_1'] }, rows);
  const fixture = depsFixture({
    rows,
    throwAfterPostApply: true,
  });
  const result = await fastForwardTool().handler({
    locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', statusIds: ['STATUS_ULID_1'], confirm: true,
    previewToken: preview.result.data.preview.previewToken,
  }, fixture.deps);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.match(result.detail, /transport lost after requeue applied/);
  assert.match(result.remediation, /URGENT/i);
  assert.match(result.remediation, /STATUS_ULID_1/);
  assert.match(result.remediation, /CONTACT_1/);
  assert.match(result.remediation, /runtime logs/i);
  assert.doesNotMatch(result.remediation, /draft|republish/i);
  assert.equal(result.data.moved, null);
  assert.deepEqual(result.data.statusIdsAttempted, ['STATUS_ULID_1']);
  assert.equal(result.data.statusIdsMoved, null);
  assert.equal(result.data.partialProgress.write.attempted, true);
  assert.equal(result.data.partialProgress.write.acknowledged, false);
  assert.equal(result.data.partialProgress.write.ambiguous, true);
});

test('ambiguous fast-forward recursively scrubs credential-looking parked identities in the direct handler', async () => {
  const parkedStatusCredential = 'eyJhbGciOiJIUzI1NiJ9.parked-status-credential-fixture.signature';
  const parkedContactCredential = 'eyJhbGciOiJIUzI1NiJ9.parked-contact-credential-fixture.signature';
  const rows = [{ _id: parkedStatusCredential, contactId: parkedContactCredential }];
  const preview = await previewFor({ all: true }, rows);
  const fixture = depsFixture({ rows, throwAfterPostApply: true });

  const result = await fastForwardTool().handler(request({ all: true }, {
    confirm: true,
    previewToken: preview.result.data.preview.previewToken,
  }), fixture.deps);

  const serialized = JSON.stringify(result);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.doesNotMatch(serialized, new RegExp(parkedStatusCredential.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, new RegExp(parkedContactCredential.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(serialized, /<redacted>/);
});

test('ambiguous fast-forward scrubs credential-looking parked identities through real MCP tools/call', async () => {
  const parkedStatusCredential = 'eyJhbGciOiJIUzI1NiJ9.mcp-status-credential-fixture.signature';
  const parkedContactCredential = 'eyJhbGciOiJIUzI1NiJ9.mcp-contact-credential-fixture.signature';
  const fixture = depsFixture({
    rows: [{ _id: parkedStatusCredential, contactId: parkedContactCredential }],
    throwAfterPostApply: true,
  });
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, fixture.deps, [fastForwardTool()]);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const previewResult = await client.callTool({
      name: 'fast_forward_contacts',
      arguments: request({ all: true }),
    });
    const previewContract = JSON.parse(previewResult.content[0].text);
    const confirmedResult = await client.callTool({
      name: 'fast_forward_contacts',
      arguments: request({ all: true }, {
        confirm: true,
        previewToken: previewContract.data.preview.previewToken,
      }),
    });
    const serialized = JSON.stringify(confirmedResult);
    const contract = JSON.parse(confirmedResult.content[0].text);
    assert.equal(contract.ok, false);
    assert.equal(contract.code, 'ENGINE_ABORT');
    assert.equal(serialized.includes(parkedStatusCredential), false);
    assert.equal(serialized.includes(parkedContactCredential), false);
    assert.match(serialized, /<redacted>/);
  } finally {
    await client.close();
  }
});

test('malformed selected parked rows fail closed before preview hashing or confirmation writes', async () => {
  const scenarios = [
    { label: 'all selector', selector: { all: true }, rows: [null] },
    {
      label: 'contact selector',
      selector: { contactId: 'CONTACT_TARGET' },
      rows: [{ _id: '   ', contactId: 'CONTACT_TARGET' }],
    },
    {
      label: 'status selector',
      selector: { statusIds: ['STATUS_TARGET'] },
      rows: [{ _id: 'STATUS_TARGET', contactId: '' }],
    },
  ];

  for (const scenario of scenarios) {
    for (const confirmation of [false, true]) {
      const fixture = depsFixture({ rows: scenario.rows });
      const result = await fastForwardTool().handler(request(scenario.selector, confirmation ? {
        confirm: true,
        previewToken: '0'.repeat(64),
      } : {}), fixture.deps);

      assert.equal(result.ok, false, `${scenario.label} confirm=${confirmation}`);
      assert.equal(result.code, 'VALIDATION_FAILED', `${scenario.label} confirm=${confirmation}`);
      assert.match(result.detail, /malformed.*parked/i, `${scenario.label} confirm=${confirmation}`);
      assert.equal(JSON.stringify(result).includes('"statusIds":[null]'), false);
      assert.equal(fixture.calls.some(({ method }) => method === 'POST'), false,
        `${scenario.label} confirm=${confirmation}`);
    }
  }
});

test('preview maps structured details-by-step HTTP failures through the stable HTTP contract', async () => {
  const cases = [
    { status: 401, code: 'TOKEN_EXPIRED' },
    { status: 422, code: 'VALIDATION_FAILED' },
    { status: 429, code: 'RATE_LIMITED' },
  ];
  for (const scenario of cases) {
    const fixture = depsFixture({
      getFailure: { status: scenario.status, ok: false, json: { message: 'preview rejected' } },
    });
    const result = await fastForwardTool().handler({
      locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', all: true,
    }, fixture.deps);

    assert.equal(result.ok, false, String(scenario.status));
    assert.equal(result.code, scenario.code, String(scenario.status));
    assert.equal(fixture.calls.some(({ method }) => method === 'POST'), false);
  }
});

test('requeue maps known HTTP failures without marking the responded write ambiguous', async () => {
  const cases = [
    { status: 401, code: 'TOKEN_EXPIRED' },
    { status: 422, code: 'VALIDATION_FAILED' },
    { status: 429, code: 'RATE_LIMITED' },
  ];
  for (const scenario of cases) {
    const rows = [{ _id: 'STATUS_1', contactId: 'CONTACT_1' }];
    const preview = await previewFor({ statusIds: ['STATUS_1'] }, rows);
    const fixture = depsFixture({
      rows,
      postFailure: { status: scenario.status, ok: false, json: { message: 'requeue rejected' } },
    });
    const result = await fastForwardTool().handler({
      locationId: 'LOC', workflowId: 'WID', stepId: 'STEP', statusIds: ['STATUS_1'], confirm: true,
      previewToken: preview.result.data.preview.previewToken,
    }, fixture.deps);

    assert.equal(result.ok, false, String(scenario.status));
    assert.equal(result.code, scenario.code, String(scenario.status));
    assert.equal(result.data.partialProgress.write.attempted, true, String(scenario.status));
    assert.equal(result.data.partialProgress.write.acknowledged, false, String(scenario.status));
    assert.equal(result.data.partialProgress.write.ambiguous, false, String(scenario.status));
  }
});

test('preview token is stable across parked-row response order and binds selector scope', async () => {
  const rows = [
    { _id: 'STATUS_2', contactId: 'CONTACT_2' },
    { _id: 'STATUS_1', contactId: 'CONTACT_1' },
  ];
  const first = await previewFor({ all: true }, rows);
  const reordered = await previewFor({ all: true }, [...rows].reverse());
  const otherStep = depsFixture({ rows });
  const other = await fastForwardTool().handler({
    locationId: 'LOC', workflowId: 'WID', stepId: 'OTHER_STEP', all: true,
  }, otherStep.deps);

  assert.equal(first.result.data.preview.previewToken, reordered.result.data.preview.previewToken);
  assert.notEqual(first.result.data.preview.previewToken, other.data.preview.previewToken);
});

test('confirm refuses missing or tampered preview tokens with a fresh read-only preview', async () => {
  const rows = [{ _id: 'STATUS_1', contactId: 'CONTACT_1' }];
  for (const previewToken of [undefined, 'tampered']) {
    const fixture = depsFixture({ rows });
    const result = await fastForwardTool().handler(request(
      { statusIds: ['STATUS_1'] },
      { confirm: true, ...(previewToken ? { previewToken } : {}) },
    ), fixture.deps);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'PREVIEW_STALE');
    assert.deepEqual(result.data.preview.statusIds, ['STATUS_1']);
    assert.match(result.data.preview.previewToken, /^[a-f0-9]{64}$/);
    assert.match(result.remediation, /reconfirm|confirm/i);
    assert.equal(fixture.calls.some(({ method }) => method === 'POST'), false);
  }
});

test('all:true token goes stale when a new parked enrollment appears', async () => {
  const before = [{ _id: 'STATUS_1', contactId: 'CONTACT_1' }];
  const preview = await previewFor({ all: true }, before);
  const fixture = depsFixture({ rows: [
    ...before,
    { _id: 'STATUS_2', contactId: 'CONTACT_2' },
  ] });
  const result = await fastForwardTool().handler(request({ all: true }, {
    confirm: true, previewToken: preview.result.data.preview.previewToken,
  }), fixture.deps);

  assert.equal(result.code, 'PREVIEW_STALE');
  assert.deepEqual(result.data.preview.statusIds, ['STATUS_1', 'STATUS_2']);
  assert.equal(fixture.calls.some(({ method }) => method === 'POST'), false);
});

test('contact token goes stale when the selected enrollment or contact association changes', async () => {
  const preview = await previewFor(
    { contactId: 'CONTACT_TARGET' },
    [{ _id: 'STATUS_1', contactId: 'CONTACT_TARGET' }],
  );
  const fixture = depsFixture({
    rows: [{ _id: 'STATUS_1', contactId: 'CONTACT_OTHER' }],
  });
  const result = await fastForwardTool().handler(request({ contactId: 'CONTACT_TARGET' }, {
    confirm: true, previewToken: preview.result.data.preview.previewToken,
  }), fixture.deps);

  assert.equal(result.code, 'PREVIEW_STALE');
  assert.deepEqual(result.data.preview.statusIds, []);
  assert.equal(fixture.calls.some(({ method }) => method === 'POST'), false);
});

test('statusIds token goes stale when the requested live/stale resolution changes', async () => {
  const selector = { statusIds: ['STATUS_1', 'STATUS_2'] };
  const preview = await previewFor(selector, [
    { _id: 'STATUS_1', contactId: 'CONTACT_1' },
    { _id: 'STATUS_2', contactId: 'CONTACT_2' },
  ]);
  const fixture = depsFixture({ rows: [{ _id: 'STATUS_1', contactId: 'CONTACT_1' }] });
  const result = await fastForwardTool().handler(request(selector, {
    confirm: true, previewToken: preview.result.data.preview.previewToken,
  }), fixture.deps);

  assert.equal(result.code, 'PREVIEW_STALE');
  assert.deepEqual(result.data.preview.statusIds, ['STATUS_1']);
  assert.equal(fixture.calls.some(({ method }) => method === 'POST'), false);
});

test('duplicate requested statusIds are deduplicated in first-occurrence order before preview and POST', async () => {
  const rows = [
    { _id: 'STATUS_1', contactId: 'CONTACT_1' },
    { _id: 'STATUS_2', contactId: 'CONTACT_2' },
  ];
  const selector = { statusIds: ['STATUS_2', 'STATUS_1', 'STATUS_2', 'STATUS_1'] };
  const preview = await previewFor(selector, rows);
  assert.equal(preview.result.data.preview.count, 2);
  assert.deepEqual(preview.result.data.preview.statusIds, ['STATUS_2', 'STATUS_1']);

  const fixture = depsFixture({ rows });
  const result = await fastForwardTool().handler(request(selector, {
    confirm: true, previewToken: preview.result.data.preview.previewToken,
  }), fixture.deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.moved, 2);
  assert.deepEqual(result.data.statusIdsAttempted, ['STATUS_2', 'STATUS_1']);
  assert.deepEqual(fixture.calls.at(-1).body.statusIds, ['STATUS_2', 'STATUS_1']);
});
