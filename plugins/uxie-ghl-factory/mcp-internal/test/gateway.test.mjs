import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeGateway } from '../core/gateway.mjs';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `eyJhbGciOiJIUzI1NiJ9.${b64({ authClassId: 'u-1', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
function fixture() {
  const p = join(mkdtempSync(join(tmpdir(), 'gw-')), 'tok.txt');
  writeFileSync(p, `Bearer ${jwt}\ntoken-id: tid-9\n`);
  return p;
}
const stubFetch = (calls, res = { status: 200, ok: true, body: '{"a":1}' }) => async (url, init) => {
  calls.push({ url, init });
  return { status: res.status, ok: res.ok, text: async () => res.body };
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

test('token-id rail swaps the auth header', async () => {
  const calls = [];
  const gw = makeGateway({ tokenFile: fixture(), loc: 'L', rail: 'token-id', fetchImpl: stubFetch(calls), sleepImpl: async () => {} });
  await gw.call('GET', '/voice-ai/agents');
  assert.equal(calls[0].init.headers['token-id'], 'tid-9');
  assert.equal(calls[0].init.headers.authorization, undefined);
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
