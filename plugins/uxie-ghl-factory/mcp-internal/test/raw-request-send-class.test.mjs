// raw_request's send-class branch (W5a Task 3, REV-I1/I4/I5). A write that can make GHL text people on its
// own (or sign compliance, or flip a one-way Lab) needs confirm:true AND acknowledge:<the preview's ackToken>.
// The preview names the consequence BEFORE anything is sent, the token binds to this exact request, and the
// `acknowledge` argument is accepted on the REGISTERED dispatch path (validateRegisteredArgs), not only on a
// direct handler() call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';

const raw = () => TOOLS.find((t) => t.name === 'raw_request');
const L = 'loc_1';
const PATH = '/ai-employees/employees/agent_1';
const ARM = { locationId: L, mode: 'auto-pilot' };

// A gateway whose call() THROWS: any request that reaches the wire fails the test loudly, unless the test
// asked for a working one.
function fixture({ works = false } = {}) {
  const calls = [];
  const gw = {
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (!works) throw new Error('the gateway was called — nothing should have been sent');
      return { ok: true, status: 200, json: { ok: true } };
    },
  };
  return { calls, deps: { state: { tokenFile: '/fixture/token.txt', allowedLocations: new Set([L]) }, makeGw: () => gw } };
}

test('confirm:false on a send-class write: CONFIRM_REQUIRED whose preview carries sendClass with an ackToken; nothing sent', async () => {
  const f = fixture();
  const out = await raw().handler({ locationId: L, method: 'PUT', path: PATH, body: ARM, host: 'ai' }, f.deps);
  assert.equal(out.code, 'CONFIRM_REQUIRED', JSON.stringify(out));
  const sc = out.data.preview.sendClass;
  assert.equal(sc.class, 'send');
  assert.equal(typeof sc.rule, 'string');
  assert.ok(sc.consequence.length > 20);
  assert.match(sc.ackToken, /^[0-9a-f]{16}$/);
  assert.match(out.remediation, /acknowledge/);
  assert.equal(f.calls.length, 0);
});

test('confirm:true without acknowledge: SEND_CLASS_ACK_REQUIRED, the token in data, nothing sent', async () => {
  const f = fixture();
  const preview = await raw().handler({ locationId: L, method: 'PUT', path: PATH, body: ARM, host: 'ai' }, f.deps);
  const out = await raw().handler({ locationId: L, method: 'PUT', path: PATH, body: ARM, host: 'ai', confirm: true }, f.deps);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED');
  assert.equal(out.data.sendClass.ackToken, preview.data.preview.sendClass.ackToken);
  assert.equal(f.calls.length, 0);
});

test('an ack computed for a DIFFERENT body is refused; a bare word is refused', async () => {
  const f = fixture();
  const other = await raw().handler({ locationId: L, method: 'PUT', path: PATH, body: { locationId: L, mode: 'suggestive' }, host: 'ai' }, f.deps);
  const otherToken = other.data.preview.sendClass.ackToken;
  for (const acknowledge of [otherToken, 'send', 'yes']) {
    const out = await raw().handler({ locationId: L, method: 'PUT', path: PATH, body: ARM, host: 'ai', confirm: true, acknowledge }, f.deps);
    assert.equal(out.code, 'SEND_CLASS_ACK_REQUIRED', acknowledge);
  }
  assert.equal(f.calls.length, 0);
});

test('the matching ack sends exactly once', async () => {
  const f = fixture({ works: true });
  const preview = await raw().handler({ locationId: L, method: 'PUT', path: PATH, body: ARM, host: 'ai' }, f.deps);
  const acknowledge = preview.data.preview.sendClass.ackToken;
  // key order differs from the preview: the token is over the canonical body
  const out = await raw().handler({ locationId: L, method: 'PUT', path: PATH, body: { mode: 'auto-pilot', locationId: L }, host: 'ai', confirm: true, acknowledge }, f.deps);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { method: 'PUT', path: PATH, body: { mode: 'auto-pilot', locationId: L } });
});

test('CONTROL: a non-send-class write is unchanged — no sendClass in its preview, confirm:true alone sends', async () => {
  const f = fixture({ works: true });
  const body = { locationId: L, mode: 'off' };
  const preview = await raw().handler({ locationId: L, method: 'PUT', path: PATH, body, host: 'ai' }, f.deps);
  assert.equal(preview.code, 'CONFIRM_REQUIRED');
  assert.equal(preview.data.preview.sendClass, undefined);
  assert.doesNotMatch(preview.remediation, /acknowledge/);
  const out = await raw().handler({ locationId: L, method: 'PUT', path: PATH, body, host: 'ai', confirm: true }, f.deps);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(f.calls.length, 1);
});

test('the existing refusals still win: an empty send-class POST is EMPTY_WRITE_BODY, not an ack request', async () => {
  const f = fixture();
  const out = await raw().handler({ locationId: L, method: 'POST', path: '/agent-deployment/outbound-configs', body: {}, host: 'ai', confirm: true }, f.deps);
  assert.equal(out.code, 'EMPTY_WRITE_BODY');
  assert.equal(f.calls.length, 0);
});

// The registered path: registerTools → validateRegisteredArgs (undeclared keys refused) → binding → handler.
async function withClient(deps, fn) {
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, deps, TOOLS.filter((t) => t.name === 'raw_request'));
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await fn(client); } finally { await client.close(); await server.close(); }
}
const contractOf = (result) => JSON.parse(result.content[0].text);

test('REGISTERED dispatch: `acknowledge` is accepted by the schema, and the matching token sends once', async () => {
  const f = fixture({ works: true });
  const base = { locationId: L, method: 'PUT', path: PATH, body: ARM, host: 'ai' };
  await withClient(f.deps, async (client) => {
    const preview = contractOf(await client.callTool({ name: 'raw_request', arguments: base }));
    assert.equal(preview.code, 'CONFIRM_REQUIRED', JSON.stringify(preview));
    const acknowledge = preview.data.preview.sendClass.ackToken;
    assert.match(acknowledge, /^[0-9a-f]{16}$/, 'the token must survive the output scrubber');
    const wrong = contractOf(await client.callTool({ name: 'raw_request', arguments: { ...base, confirm: true, acknowledge: '0000000000000000' } }));
    assert.equal(wrong.code, 'SEND_CLASS_ACK_REQUIRED', JSON.stringify(wrong));
    assert.equal(f.calls.length, 0);
    const sent = contractOf(await client.callTool({ name: 'raw_request', arguments: { ...base, confirm: true, acknowledge } }));
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.equal(f.calls.length, 1);
  });
});

// W5a final review C1: a non-canonical path (dot-segments raw or %2e-encoded, backslash, control characters) is
// REFUSED before the confirm gate — nothing is sent, with or without a token. The review proved each spelling below
// reached the gated route with confirm:true and no acknowledge.
test('C1: every bypass spelling is refused, nothing sent, even with confirm:true', async () => {
  const spellings = [
    ['POST', '/x/../agent-deployment/outbound-configs', { locationId: L, agentId: 'agent_1', channel: 'SMS', enabled: true }],
    ['POST', '/./agent-deployment/outbound-triggers', { locationId: L, agentId: 'agent_1', type: 'contact_tag', enabled: true }],
    ['POST', '/agent-deployment\\outbound-configs', { locationId: L, enabled: true }],
    ['POST', '/agent-deploy\tment/outbound-configs', { locationId: L, enabled: true }],
    ['POST', '/agent-deployment/outbound-configs\n', { locationId: L, enabled: true }],
    ['POST', '/%2e%2e/agent-deployment/outbound-configs', { locationId: L, enabled: true }],
    ['POST', '/x/%2e%2e%2fagent-deployment/outbound-configs', { locationId: L, enabled: true }],
    ['PUT', '/ai-employees/employees/./agent_1', ARM],
    ['PUT', '/ai-employees/employees/x/../agent_1', ARM],
    ['POST', '/bulk-actions/x/../request', { bulkActionType: 'bulk-conversation-ai', locationId: L }],
    ['GET', '/x/../agent-deployment/outbound-configs?locationId=loc_1', undefined],
  ];
  for (const [method, path, body] of spellings) {
    const f = fixture();
    const out = await raw().handler({ locationId: L, method, path, body, host: 'ai', confirm: true }, f.deps);
    assert.equal(out.ok, false, `${JSON.stringify(path)} ${JSON.stringify(out)}`);
    assert.equal(out.code, 'VALIDATION_FAILED', JSON.stringify(path));
    assert.match(out.detail, /non-canonical/i);
    assert.equal(f.calls.length, 0, JSON.stringify(path));
  }
});

test('C1 control: canonical paths (query, encoded %2F, trailing /) are not refused by the canonical-path guard', async () => {
  for (const path of ['/agent-deployment/outbound-configs?locationId=loc_1&agentId=a.b', '/agent-deployment/outbound-configs/', '/workflow/loc_1/list?name=a b']) {
    const f = fixture({ works: true });
    const out = await raw().handler({ locationId: L, method: 'GET', path, host: 'ai' }, f.deps);
    assert.equal(out.ok, true, `${path} ${JSON.stringify(out)}`);
    assert.equal(f.calls.length, 1);
  }
});
