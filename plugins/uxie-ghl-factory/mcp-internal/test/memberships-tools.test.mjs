import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);
const spec = () => ({
  course: { title: 'Launchpad', description: '<p>Course</p>' },
  chapters: [{ title: 'Start', lessons: [{ title: 'Read', text: '<p>Body</p>' }] }],
  offer: null,
});

function buildGateway({ failCategory = false } = {}) {
  const calls = [];
  const gw = {
    loc: 'LOC1',
    uid: 'USER1',
    capabilities: { unauthenticatedRawUpload: true },
    calls,
    async call(method, path, body, options) {
      calls.push({ method, path, body, options });
      if (method === 'POST' && path.endsWith('/products')) {
        return { status: 201, ok: true, json: { id: 'COURSE1' } };
      }
      if (method === 'POST' && path.endsWith('/categories')) {
        if (failCategory) throw new Error('transport lost during category create');
        return { status: 201, ok: true, json: { id: 'CHAPTER1' } };
      }
      if (method === 'POST' && path.endsWith('/posts')) {
        return { status: 201, ok: true, json: { id: 'LESSON1' } };
      }
      if (method === 'GET' && path.endsWith('/posts/LESSON1')) {
        return { status: 200, ok: true, json: { id: 'LESSON1', description: '<p>Body</p>' } };
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  };
  return gw;
}

const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });

test('build_course and list_courses register with permissive SDK object schemas', async () => {
  assert.ok(tool('build_course'));
  assert.ok(tool('list_courses'));
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, { state: {}, makeGw: () => { throw new Error('unused'); } }, [tool('build_course'), tool('list_courses')]);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const build = listed.tools.find(({ name }) => name === 'build_course');
    assert.deepEqual(build.inputSchema.required.sort(), ['locationId', 'spec']);
    assert.notEqual(build.inputSchema.properties.spec.additionalProperties, false);
    assert.equal(build.inputSchema.properties.confirm.default, false);
  } finally {
    await client.close();
  }
});

test('list_courses returns summaries with counts, not full course bodies', async () => {
  const gw = {
    loc: 'LOC1', uid: 'USER1', calls: [],
    async call(method, path, body, options) {
      this.calls.push({ method, path, body, options });
      return { status: 200, ok: true, json: [{
        id: 'COURSE1', title: 'Launchpad', status: 'published', description: 'omit me',
        categoriesCount: 2, postsCount: 7, offers: [{ id: 'OFFER1' }],
      }] };
    },
  };
  const result = await tool('list_courses').handler({ locationId: 'LOC1' }, deps(gw));

  assert.deepEqual(result, { ok: true, data: {
    count: 1,
    courses: [{ id: 'COURSE1', title: 'Launchpad', status: 'published', counts: { chapters: 2, lessons: 7, offers: 1 } }],
    note: 'Summary only; full course bodies are intentionally omitted.',
  } });
  assert.equal(JSON.stringify(result).includes('omit me'), false);
  assert.equal(gw.calls.length, 1);
});

test('list_courses fills missing chapter and lesson counts from the read-only category tree', async () => {
  const calls = [];
  const gw = {
    loc: 'LOC1', uid: 'USER1',
    async call(method, path) {
      calls.push({ method, path });
      if (path.includes('/products?')) {
        return { status: 200, ok: true, json: [{ id: 'COURSE1', title: 'Launchpad', status: 'draft' }] };
      }
      if (path.includes('/categories?')) {
        return { status: 200, ok: true, json: [
          { id: 'C1', posts: [{ id: 'P1' }, { id: 'P2' }] },
          { id: 'C2', posts: [{ id: 'P3' }] },
        ] };
      }
      return { status: 404, ok: false, json: {} };
    },
  };
  const result = await tool('list_courses').handler({ locationId: 'LOC1' }, deps(gw));

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.courses[0].counts, { chapters: 2, lessons: 3, offers: null });
  assert.equal(calls.length, 2);
  assert.match(calls[1].path, /product_id=COURSE1&posts=true/);
});

test('build_course preview validates and returns CONFIRM_REQUIRED without constructing a gateway', async () => {
  let madeGateway = false;
  const result = await tool('build_course').handler(
    { locationId: 'LOC1', spec: spec(), confirm: false },
    { state: {}, makeGw: () => { madeGateway = true; throw new Error('preview must not access account'); } },
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.equal(result.data.preview.wouldCreate.counts.courses, 1);
  assert.equal(result.data.preview.wouldCreate.counts.lessons, 1);
  assert.equal(madeGateway, false);
});

test('build_course rejects paid offers before account access', async () => {
  let madeGateway = false;
  const paid = spec();
  paid.offer = { type: 'recurring' };
  const result = await tool('build_course').handler(
    { locationId: 'LOC1', spec: paid, confirm: true },
    { state: {}, makeGw: () => { madeGateway = true; throw new Error('invalid spec must not access account'); } },
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.match(result.detail, /Only "free" is proven/);
  assert.equal(madeGateway, false);
});

test('confirmed build_course returns created ids and verification evidence', async () => {
  const gw = buildGateway();
  const result = await tool('build_course').handler(
    { locationId: 'LOC1', spec: spec(), confirm: true },
    deps(gw),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.created.productId, 'COURSE1');
  assert.equal(result.data.created.chapters[0].id, 'CHAPTER1');
  assert.equal(result.data.created.chapters[0].lessons[0].postId, 'LESSON1');
  assert.equal(result.data.verification.problems, 0);
  assert.match(result.data.cleanup.note, /offer|credential/i);
});

test('partial build_course failure reports already-created ids and never throws', async () => {
  const gw = buildGateway({ failCategory: true });
  let result;
  await assert.doesNotReject(async () => {
    result = await tool('build_course').handler(
      { locationId: 'LOC1', spec: spec(), confirm: true },
      deps(gw),
    );
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(result.data.created.productId, 'COURSE1');
  assert.equal(result.data.failurePhase, 'category_create');
  assert.equal(result.data.writeOutcomeAmbiguous, true);
  assert.match(result.remediation, /partially|inspect|cleanup/i);
});

test('build_course description states paid, embed and local-media constraints', () => {
  const description = tool('build_course').description;
  assert.match(description, /only free/i);
  assert.match(description, /embedJson|embed.*PUT/i);
  assert.match(description, /local.*absolute|absolute.*local/i);
});
