import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeGateway } from '../core/gateway.mjs';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `eyJhbGciOiJIUzI1NiJ9.${b64({ authClassId: 'u-1', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const tokenId = `eyJhbGciOiJIUzI1NiJ9.${b64({ iss: 'securetoken.google.com/highlevel-backend', role: 'admin', type: 'agency', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
function fixture({ bearer = jwt, token = tokenId } = {}) {
  const p = join(mkdtempSync(join(tmpdir(), 'gw-')), 'tok.txt');
  writeFileSync(p, `Bearer ${bearer}\n${token ? `token-id: ${token}\n` : ''}`);
  return p;
}
const stubFetch = (calls, res = { status: 200, ok: true, body: '{"a":1}' }) => async (url, init) => {
  calls.push({ url, init });
  return { status: res.status, ok: res.ok, text: async () => res.body };
};
const sseResponse = (chunks, { status = 200, ok = true, contentType = 'text/event-stream' } = {}) => ({
  status,
  ok,
  headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
  body: new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }),
  text: async () => chunks.join(''),
});

const sseResponseBytes = (bytes, { status = 200, ok = true, contentType = 'text/event-stream' } = {}) => ({
  status,
  ok,
  headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
  body: new ReadableStream({
    start(controller) {
      for (const chunk of bytes) controller.enqueue(chunk);
      controller.close();
    },
  }),
  text: async () => new TextDecoder().decode(Buffer.concat(bytes.map((chunk) => Buffer.from(chunk)))),
});

const observedStudioStream = (newline = '\n', finalDelimiter = true) => {
  const frame = (event, data) => `event: ${event}${newline}data: ${JSON.stringify(data)}${newline}${newline}`;
  const deltas = Array.from({ length: 748 }, (_, index) => frame('output_delta', { index, delta: 'x' }));
  const partials = Array.from({ length: 10 }, (_, index) => frame('config_partial', { index }));
  const completes = Array.from({ length: 2 }, (_, index) => frame('conversation_complete', { index }));
  const updates = Array.from({ length: 2 }, (_, index) => frame('config_update', { index }));
  const terminal = `event: done${newline}data: {"agentId":"agent-sse","durationMs":16553,"mode":"fast"}${newline}`;
  return [
    `: connected${newline}${newline}`,
    frame('conversation_started', { id: 'conversation-1' }),
    frame('generating', { started: true }),
    ...deltas,
    ...partials,
    ...completes,
    ...updates,
    frame('agent_saved', { id: 'agent-sse' }),
    terminal + (finalDelimiter ? newline : ''),
  ].join('');
};

const oneByteChunks = (text) => Array.from(new TextEncoder().encode(text), (byte) => Uint8Array.of(byte));
const adversarialChunks = (text) => {
  const bytes = new TextEncoder().encode(text);
  const cuts = [1, 2, 7, 19, 64, 257, bytes.length - 29, bytes.length - 14, bytes.length - 2, bytes.length];
  let start = 0;
  return cuts.filter((cut) => cut > start && cut <= bytes.length).map((cut) => {
    const chunk = bytes.slice(start, cut);
    start = cut;
    return chunk;
  });
};

test('GET sends read headers, no body, and returns {status,ok,json}', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'LOC1', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  const r = await gw.call('GET', '/workflow/LOC1/list');
  assert.deepEqual(r, { status: 200, ok: true, json: { a: 1 } });
  const h = calls[0].init.headers;
  assert.equal(h.authorization, `Bearer ${jwt}`);
  assert.equal(h.channel, 'APP');
  assert.equal(h.source, 'WEB_USER');
  assert.equal(h.version, '2021-07-28');
  assert.equal(h.origin, undefined);
  assert.equal(calls[0].init.body, undefined);
});

test('writes add content-type plus the iframe origin/referer', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  await gw.call('PUT', '/workflow/L/w1', { x: 1 });
  const h = calls[0].init.headers;
  assert.equal(h['content-type'], 'application/json');
  assert.match(h.origin, /client-app-automation-workflows/);
  assert.match(h.referer, /client-app-automation-workflows/);
  assert.equal(calls[0].init.body, '{"x":1}');
});

test('AI rail sends both Bearer and token-id together', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'ai', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  await gw.call('GET', '/voice-ai/agents', undefined, { base: 'https://services.leadconnectorhq.com' });
  assert.equal(calls[0].init.headers['token-id'], tokenId);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${jwt}`);
  assert.equal(calls[0].init.headers.referer, 'https://app.gohighlevel.com/');
});

test('AI writes use the app origin instead of the workflow-builder iframe', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'ai', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  await gw.call('POST', '/ai-employees/employees', { locationId: 'L' }, { base: 'https://services.leadconnectorhq.com' });
  assert.equal(calls[0].init.headers.origin, 'https://app.gohighlevel.com');
  assert.equal(calls[0].init.headers.referer, 'https://app.gohighlevel.com/');
});

test('legacy token-id rail still sends token-id only', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'token-id', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  await gw.call('GET', '/funnels');
  assert.equal(calls[0].init.headers['token-id'], tokenId);
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test('AI rail rejects a missing token-id before network access', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture({ token: null }), loc: 'L', rail: 'ai', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  await assert.rejects(gw.call('GET', '/voice-ai/agents', undefined, { base: 'https://services.leadconnectorhq.com' }), (e) => e.code === 'TOKEN_ID_MISSING' && /AI credential capture path/.test(e.remediation));
  assert.equal(calls.length, 0);
});

test('AI rail distinguishes an expired token-id from an expired Bearer JWT', async () => {
  const expired = `eyJhbGciOiJIUzI1NiJ9.${b64({ iss: 'securetoken.google.com/highlevel-backend', exp: Math.floor(Date.now() / 1000) - 10 })}.sig`;
  const tokenExpired = makeGateway({ tokenFile: fixture({ token: expired }), loc: 'L', rail: 'ai', fetchImpl: stubFetch([]), sleepImpl: async () => {} });
  await assert.rejects(tokenExpired.call('GET', '/voice-ai/agents', undefined, { base: 'https://services.leadconnectorhq.com' }), (e) => e.code === 'TOKEN_ID_EXPIRED');
  const jwtExpired = `eyJhbGciOiJIUzI1NiJ9.${b64({ authClassId: 'u-1', exp: Math.floor(Date.now() / 1000) - 10 })}.sig`;
  const bearerExpired = makeGateway({ tokenFile: fixture({ bearer: jwtExpired }), loc: 'L', rail: 'ai', fetchImpl: stubFetch([]), sleepImpl: async () => {} });
  await assert.rejects(bearerExpired.call('GET', '/voice-ai/agents', undefined, { base: 'https://services.leadconnectorhq.com' }), (e) => e.code === 'TOKEN_EXPIRED');
});

test('throttles every call with base delay plus jitter', async () => {
  const delays = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', fetchImpl: stubFetch([]), sleepImpl: async (ms) => delays.push(ms) });
  await gw.call('GET', '/a');
  await gw.call('GET', '/b');
  assert.equal(delays.length, 2);
  for (const d of delays) { assert.ok(d >= 300 && d <= 450, `delay ${d} out of range`); }
});

test('non-JSON body comes back as raw text, not a throw', async () => {
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', sleepImpl: async () => {},
    fetchImpl: stubFetch([], { status: 200, ok: true, body: 'plain' }) });
  assert.equal((await gw.call('GET', '/a')).json, 'plain');
});

test('uid comes from the JWT claim', async () => {
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', fetchImpl: stubFetch([]), sleepImpl: async () => {} });
  assert.equal(gw.uid, 'u-1');
});

test('per-call headers merge sourceid and override member-rail defaults without dropping auth', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'LOC1', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  await gw.call('GET', '/communities/LOC1/groups', undefined, {
    base: 'https://services.leadconnectorhq.com',
    headers: {
      sourceid: 'LOC1',
      source: 'PORTAL_USER',
      version: '2023-02-21',
      authorization: undefined,
    },
  });
  assert.equal(calls[0].url, 'https://services.leadconnectorhq.com/communities/LOC1/groups');
  assert.equal(calls[0].init.headers.sourceid, 'LOC1');
  assert.equal(calls[0].init.headers.source, 'PORTAL_USER');
  assert.equal(calls[0].init.headers.version, '2023-02-21');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${jwt}`);
});

test('auth remains pinned across case-variant header overrides', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'LOC1', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  await gw.call('GET', '/products', undefined, {
    headers: { Authorization: 'Bearer caller-controlled' },
  });
  assert.deepEqual(
    Object.entries(calls[0].init.headers).filter(([key]) => key.toLowerCase() === 'authorization'),
    [['authorization', `Bearer ${jwt}`]],
  );
});

test('overridden calls still throttle and positional base remains compatible', async () => {
  const calls = [];
  const delays = [];
  const gw = makeGateway({
    tokenFile: fixture(),
    loc: 'LOC1',
    fetchImpl: stubFetch(calls),
    sleepImpl: async (ms) => delays.push(ms),
    randomImpl: () => 0,
  });
  await gw.call('GET', '/membership/locations/LOC1/products', undefined, {
    base: 'https://backend.leadconnectorhq.com',
    headers: { sourceid: 'LOC1' },
  });
  await gw.call('GET', '/workflow/LOC1/list', undefined, 'https://example.test');
  assert.deepEqual(delays, [300, 300]);
  assert.equal(calls[1].url, 'https://example.test/workflow/LOC1/list');
});

test('signed storage uploads are raw and unauthenticated only on the GCS PUT rail', async () => {
  const calls = [];
  const bytes = Buffer.from('media');
  const gw = makeGateway({ tokenFile: fixture(), loc: 'LOC1', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });

  await gw.call('PUT', '/bucket/object?signature=x', bytes, {
    base: 'https://storage.googleapis.com',
    headers: { 'content-type': 'video/mp4' },
    signedUpload: true,
  });

  assert.equal(gw.capabilities.unauthenticatedRawUpload, true);
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.deepEqual(calls[0].init.headers, { 'content-type': 'video/mp4' });
  assert.equal(calls[0].init.body, bytes);
  await assert.rejects(
    gw.call('PUT', '/anything', bytes, { base: 'https://example.test', signedUpload: true }),
    /signedUpload.*storage\.googleapis\.com/,
  );
});

test('SC4/MF1: signed upload accepts a virtual-hosted bucket host and PUTs the resolved URL', async () => {
  const calls = [];
  const bytes = Buffer.from('media');
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });

  await gw.call('PUT', '/object?signature=x', bytes, {
    base: 'https://my-bucket.storage.googleapis.com',
    headers: { 'content-type': 'video/mp4' },
    signedUpload: true,
  });
  assert.equal(calls[0].url, 'https://my-bucket.storage.googleapis.com/object?signature=x');
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(calls[0].init.headers['token-id'], undefined);

  // A host that merely GLUES the GCS domain onto another label must still be refused —
  // the allowlist is anchored at a subdomain boundary, not a substring match.
  await assert.rejects(
    gw.call('PUT', '/x', bytes, { base: 'https://evil-storage.googleapis.com', signedUpload: true }),
    /signedUpload.*storage\.googleapis\.com/,
  );
  await assert.rejects(
    gw.call('PUT', '/x', bytes, { base: 'https://storage.googleapis.com.evil.test', signedUpload: true }),
    /signedUpload.*storage\.googleapis\.com/,
  );
});

test('SC3: the ai rail refuses a non-AI base and never attaches token-id or calls fetch', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'ai', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  await assert.rejects(
    gw.call('GET', '/voice-ai/agents', undefined, { base: 'https://backend.leadconnectorhq.com' }),
    (e) => e.code === 'AI_RAIL_HOST_INVALID',
  );
  assert.equal(calls.length, 0);
});

test('SC1: an expired Bearer JWT throw carries its code AND a re-capture remediation', async () => {
  const jwtExpired = `eyJhbGciOiJIUzI1NiJ9.${b64({ authClassId: 'u-1', exp: Math.floor(Date.now() / 1000) - 10 })}.sig`;
  const gw = makeGateway({ tokenFile: fixture({ bearer: jwtExpired }), loc: 'L', fetchImpl: stubFetch([]), sleepImpl: async () => {} });
  await assert.rejects(
    gw.call('GET', '/workflow/L/list'),
    (e) => e.code === 'TOKEN_EXPIRED' && typeof e.remediation === 'string' && e.remediation.length > 0,
  );
});

test('SC1: a token-id rail missing its token-id throws with a code AND remediation', async () => {
  const gw = makeGateway({ tokenFile: fixture({ token: null }), loc: 'L', rail: 'token-id', fetchImpl: stubFetch([]), sleepImpl: async () => {} });
  await assert.rejects(
    gw.call('GET', '/funnels'),
    (e) => e.code === 'TOKEN_MISSING' && typeof e.remediation === 'string' && e.remediation.length > 0,
  );
});

test('SSE stream returns accumulated events and its terminal success event', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'ai', sleepImpl: async () => {}, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return sseResponse(['event: config_partial\ndata: {"name":"draft"}\n\n', 'event: agent_saved\ndata: {"agentId":"agent-1"}\n\n']);
  } });
  const result = await gw.stream('POST', '/agent-studio/super-agents/build', { message: 'build' }, { base: 'https://services.leadconnectorhq.com' });
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.terminal, { event: 'agent_saved', data: { agentId: 'agent-1' } });
  assert.equal(calls[0].init.headers.accept, 'text/event-stream');
});

test('truncated SSE stream fails instead of reporting an empty success', async () => {
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'ai', sleepImpl: async () => {}, fetchImpl: async () => (
    sseResponse(['event: config_partial\ndata: {"name":"draft"}\n\n'])
  ) });
  await assert.rejects(gw.stream('POST', '/agent-studio/super-agents/build', { message: 'build' }, { base: 'https://services.leadconnectorhq.com' }), (e) => e.code === 'SSE_INCOMPLETE');
});

test('observed high-volume Studio SSE survives byte-by-byte chunks and a final done frame without its delimiter', async () => {
  const stream = observedStudioStream('\n', false);
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'ai', sleepImpl: async () => {}, fetchImpl: async () => (
    sseResponseBytes(oneByteChunks(stream))
  ) });
  const result = await gw.stream('POST', '/agent-studio/super-agents/build', { message: 'build' }, { base: 'https://services.leadconnectorhq.com' });
  assert.equal(result.events.filter(({ event }) => event === 'output_delta').length, 748);
  assert.deepEqual(result.terminal, { event: 'done', data: { agentId: 'agent-sse', durationMs: 16553, mode: 'fast' } });
});

test('observed Studio SSE accepts CRLF frame boundaries split inside the terminal event', async () => {
  const stream = observedStudioStream('\r\n', false);
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'ai', sleepImpl: async () => {}, fetchImpl: async () => (
    sseResponseBytes(adversarialChunks(stream))
  ) });
  const result = await gw.stream('POST', '/agent-studio/super-agents/build', { message: 'build' }, { base: 'https://services.leadconnectorhq.com' });
  assert.equal(result.events.filter(({ event }) => event === 'output_delta').length, 748);
  assert.deepEqual(result.terminal, { event: 'done', data: { agentId: 'agent-sse', durationMs: 16553, mode: 'fast' } });
});

test('non-SSE response on an SSE endpoint fails loudly', async () => {
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'ai', sleepImpl: async () => {}, fetchImpl: async () => (
    sseResponse(['{"agentId":"agent-1"}'], { contentType: 'application/json' })
  ) });
  await assert.rejects(gw.stream('POST', '/agent-studio/super-agents/build', { message: 'build' }, { base: 'https://services.leadconnectorhq.com' }), (e) => e.code === 'SSE_EXPECTED');
});
