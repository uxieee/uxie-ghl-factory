// The gateway is where renewal has to live: it already re-reads the token file on every call,
// so a renewed file takes effect with no restart. These tests pin the wiring — that a near-expiry
// bearer is renewed BEFORE the request goes out and the request carries the NEW one — and that a
// gateway built without a renewer behaves exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGateway } from '../core/gateway.mjs';
import { makeGatewayFactory } from '../core/tools.mjs';
import { makeRenewer, formatTokenFile, REFRESH_PATH } from '../core/token-renewal.mjs';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const mkJwt = (c) => `eyJhbGciOiJIUzI1NiJ9.${b64(c)}.${'s'.repeat(40)}`;
const liveJwt = (ttl) => mkJwt({ authClassId: 'u-1', exp: now() + ttl, iat: now() });
const liveTid = (ttl) => mkJwt({ iss: 'https://securetoken.google.com/highlevel-backend', role: 'admin', scope: 'agency', exp: now() + ttl });

const fixture = (ttl) => {
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'gwr-')), 'tok.txt');
  writeFileSync(tokenFile, formatTokenFile({ bearer: liveJwt(ttl), tokenId: liveTid(ttl) }), { mode: 0o600 });
  return tokenFile;
};
const NEW_BEARER = mkJwt({ authClassId: 'u-1', exp: now() + 3600, iat: now(), fresh: true });
const NEW_TID = liveTid(3600);
// One fetch stub serves refresh, firebase, AND the API call, recording everything.
const fetchAll = (calls) => async (url, init = {}) => {
  calls.push({ url, init });
  if (url.endsWith(REFRESH_PATH)) return { status: 200, ok: true, json: async () => ({ token: 'x.y.z'.padEnd(90, 'z'), authToken: NEW_BEARER, companyId: 'C1' }), text: async () => '' };
  if (url.includes('identitytoolkit')) return { status: 200, ok: true, json: async () => ({ idToken: NEW_TID }), text: async () => '' };
  return { status: 200, ok: true, text: async () => '{"ok":true}' };
};

test('a near-expiry bearer is renewed before the request, and the request carries the NEW bearer', async () => {
  const tokenFile = fixture(200);
  const calls = [];
  const fetchImpl = fetchAll(calls);
  const renewer = makeRenewer({ getTokenFile: () => tokenFile, fetchImpl, nowImpl: () => 1e12, log: () => {} });
  const gw = makeGateway({ tokenFile, loc: 'L1', fetchImpl, renewer, throttleMs: 0, jitterMs: 0 });
  const res = await gw.call('GET', '/workflow/L1/list');
  assert.equal(res.status, 200);
  const api = calls.find((c) => c.url.endsWith('/workflow/L1/list'));
  const refresh = calls.find((c) => c.url.endsWith(REFRESH_PATH));
  assert.ok(refresh, 'renewal ran');
  assert.ok(calls.indexOf(refresh) < calls.indexOf(api), 'renewal ran BEFORE the request');
  assert.equal(api.init.headers.authorization, `Bearer ${NEW_BEARER}`, 'the request used the renewed bearer');
});

test('the AI rail picks up the renewed token-id in the same call', async () => {
  const tokenFile = fixture(200);
  const calls = [];
  const fetchImpl = fetchAll(calls);
  const renewer = makeRenewer({ getTokenFile: () => tokenFile, fetchImpl, nowImpl: () => 1e12, log: () => {} });
  const gw = makeGateway({ tokenFile, loc: 'L1', rail: 'ai', fetchImpl, renewer, throttleMs: 0, jitterMs: 0 });
  await gw.call('GET', '/ai-employees/employees/search?locationId=L1');
  const api = calls.find((c) => c.url.includes('/ai-employees/'));
  assert.equal(api.init.headers['token-id'], NEW_TID);
  assert.equal(api.init.headers.authorization, `Bearer ${NEW_BEARER}`);
});

test('a healthy bearer makes exactly one request and no refresh', async () => {
  const tokenFile = fixture(3600);
  const calls = [];
  const fetchImpl = fetchAll(calls);
  const renewer = makeRenewer({ getTokenFile: () => tokenFile, fetchImpl, nowImpl: () => 1e12, log: () => {} });
  const gw = makeGateway({ tokenFile, loc: 'L1', fetchImpl, renewer, throttleMs: 0, jitterMs: 0 });
  await gw.call('GET', '/workflow/L1/list');
  assert.equal(calls.length, 1);
});

test('no renewer = the pre-0.45.0 behaviour, byte for byte: near-expiry bearer is sent as-is', async () => {
  const tokenFile = fixture(200);
  const calls = [];
  const gw = makeGateway({ tokenFile, loc: 'L1', fetchImpl: fetchAll(calls), throttleMs: 0, jitterMs: 0 });
  await gw.call('GET', '/workflow/L1/list');
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].init.headers.authorization, `Bearer ${NEW_BEARER}`);
});

test('a renewal failure never breaks the call — the current bearer is used and the error goes to the log sink', async () => {
  const tokenFile = fixture(200);
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith(REFRESH_PATH)) return { status: 500, ok: false, json: async () => ({}), text: async () => '' };
    return { status: 200, ok: true, text: async () => '{"ok":true}' };
  };
  const renewer = makeRenewer({ getTokenFile: () => tokenFile, fetchImpl, nowImpl: () => 1e12, log: (m) => logs.push(m) });
  const gw = makeGateway({ tokenFile, loc: 'L1', fetchImpl, renewer, throttleMs: 0, jitterMs: 0 });
  const res = await gw.call('GET', '/workflow/L1/list');
  assert.equal(res.status, 200, 'the call still went out');
  assert.ok(logs.length >= 1);
});

test('makeGatewayFactory forwards state.renewer so every tool call is covered', async () => {
  const tokenFile = fixture(200);
  const calls = [];
  const fetchImpl = fetchAll(calls);
  const state = { tokenFile, legacyTokenFileEnv: false, renewer: makeRenewer({ getTokenFile: () => tokenFile, fetchImpl, nowImpl: () => 1e12, log: () => {} }) };
  const makeGw = makeGatewayFactory({ state });
  const gw = makeGw({ loc: 'L1', fetchImpl, throttleMs: 0, jitterMs: 0 });
  await gw.call('GET', '/workflow/L1/list');
  assert.ok(calls.some((c) => c.url.endsWith(REFRESH_PATH)), 'the factory-built gateway renewed');
});
