// The 30-day chain (0.46.0). Probes 19-21 on 2026-08-31 established, by execution:
//   - the app restarts from a dead access token with POST /oauth/2/login/token, carrying the
//     30-day refresh token BOTH as a `refresh-token` header and as body {refreshTokenV2};
//   - it works from plain node with no browser and no cookies (201, and the returned authToken
//     authenticated a real read);
//   - the response carries only the bearer family (authToken/jwt/refreshToken) — NO firebase
//     custom token and NO companyId — so the AI-rail token-id still comes from the hourly path,
//     which the cold start runs with its fresh bearer;
//   - the refresh token is REUSABLE within its lifetime and every exchange returns a rotated one;
//   - removing the access token entirely makes the app log out; only an EXPIRED one refreshes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REFRESH_PATH, EXCHANGE_PATH,
  formatTokenFile, writeTokenFile, readRefreshToken, exchangeRefreshToken, renewCredentials, makeRenewer,
} from '../core/token-renewal.mjs';
import { readCredentials } from '../core/auth.mjs';
import { makeGateway } from '../core/gateway.mjs';

const TEST_KEY = 'AIzaTESTKEY0000000000000000000000000000';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const mkJwt = (c) => `eyJhbGciOiJIUzI1NiJ9.${b64(c)}.${'s'.repeat(40)}`;
const jwtIn = (ttl, extra = {}) => mkJwt({ authClassId: 'u-1', exp: now() + ttl, iat: now(), ...extra });
const tidIn = (ttl) => mkJwt({ iss: 'https://securetoken.google.com/highlevel-backend', role: 'admin', scope: 'agency', exp: now() + ttl });
const RT_OLD = jwtIn(30 * 86400, { kind: 'refresh', n: 1 });
const RT_NEW = jwtIn(30 * 86400, { kind: 'refresh', n: 2 });
const RT_NEWER = jwtIn(30 * 86400, { kind: 'refresh', n: 3 });
const FRESH_BEARER = jwtIn(3600, { via: 'exchange' });
const HOURLY_BEARER = jwtIn(3600, { via: 'login-current' });
const FRESH_TID = tidIn(3600);

// One stub for the whole chain: exchange -> login/current -> firebase -> the API read.
const chainFetch = (calls, { exchange = { status: 201 }, current = { status: 200 }, firebase = { status: 200 } } = {}) =>
  async (url, init = {}) => {
    calls.push({ url, init });
    const ok = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.endsWith(EXCHANGE_PATH)) {
      return exchange.status < 300
        ? ok(exchange.status, { authToken: FRESH_BEARER, jwt: FRESH_BEARER, refreshToken: RT_NEW, v1JWTs: {}, traceId: 't' })
        : ok(exchange.status, { statusCode: exchange.status, message: 'Invalid JWT' });
    }
    if (url.endsWith(REFRESH_PATH)) {
      return current.status < 300
        ? ok(200, { token: mkJwt({ kind: 'firebase-custom', exp: now() + 3600 }), authToken: HOURLY_BEARER, refreshToken: RT_NEWER, companyId: 'COMPANY0000000000001' })
        : ok(current.status, {});
    }
    if (url.includes('identitytoolkit')) return firebase.status < 300 ? ok(200, { idToken: FRESH_TID }) : ok(firebase.status, {});
    return ok(200, { ok: true });
  };
const hits = (calls, suffix) => calls.filter((c) => c.url.endsWith(suffix) || c.url.includes(suffix)).length;

const fileWith = ({ ttl, tid = tidIn(ttl), refreshToken = RT_OLD, firebaseKey = TEST_KEY }) => {
  const dir = mkdtempSync(join(tmpdir(), 'cold-'));
  const tokenFile = join(dir, 'tok.txt');
  writeFileSync(tokenFile, formatTokenFile({ bearer: jwtIn(ttl), tokenId: tid, firebaseKey, refreshToken }), { mode: 0o600 });
  return { dir, tokenFile };
};

// ---------- the file ----------

test('the refresh token is a fourth labelled line, and the reader still parses the first two', () => {
  const { tokenFile } = fileWith({ ttl: 3600 });
  const text = readFileSync(tokenFile, 'utf8');
  assert.equal(text.split('\n').filter(Boolean).length, 4);
  assert.match(text, /^refresh-token: ey/m);
  assert.equal(readRefreshToken({ tokenFile }), RT_OLD);
  assert.ok(readCredentials({ tokenFile }).jwt, 'the pre-existing reader is untouched');
});

test('writeTokenFile keeps the refresh-token line when a write does not mention it', () => {
  const { tokenFile } = fileWith({ ttl: 200 });
  writeTokenFile({ tokenFile, bearer: jwtIn(3600), tokenId: null });
  assert.equal(readRefreshToken({ tokenFile }), RT_OLD);
});

test('readRefreshToken is null for a file that predates 0.46.0', () => {
  const { tokenFile } = fileWith({ ttl: 3600, refreshToken: null });
  assert.equal(readRefreshToken({ tokenFile }), null);
});

// ---------- the exchange ----------

test('exchangeRefreshToken POSTs the token as BOTH the refresh-token header and body.refreshTokenV2, with the three headers', async () => {
  const calls = [];
  const out = await exchangeRefreshToken({ refreshToken: RT_OLD, fetchImpl: chainFetch(calls) });
  const x = calls.find((c) => c.url.endsWith(EXCHANGE_PATH));
  assert.equal(x.init.method, 'POST');
  assert.equal(x.init.headers['refresh-token'], RT_OLD);
  assert.deepEqual(JSON.parse(x.init.body), { refreshTokenV2: RT_OLD });
  assert.equal(x.init.headers.channel, 'APP'); assert.equal(x.init.headers.source, 'WEB_USER'); assert.equal(x.init.headers.version, '2021-07-28');
  assert.equal(x.init.headers.authorization, undefined, 'no bearer: the whole point is that none is alive');
  assert.equal(out.jwt, FRESH_BEARER);
  assert.equal(out.refreshToken, RT_NEW, 'the rotated token comes back');
});

test('exchangeRefreshToken: a non-2xx (the 30-day token itself expired) throws RENEW_FAILED', async () => {
  await assert.rejects(
    exchangeRefreshToken({ refreshToken: RT_OLD, fetchImpl: chainFetch([], { exchange: { status: 401 } }) }),
    (e) => e.code === 'RENEW_FAILED',
  );
});

test('the hourly renewal now also returns the refresh token login/current hands back', async () => {
  const out = await renewCredentials({ jwt: jwtIn(200), firebaseKey: TEST_KEY, fetchImpl: chainFetch([]) });
  assert.equal(out.refreshToken, RT_NEWER);
});

// ---------- the renewer: cold start ----------

const renewer = (tokenFile, calls, opts, log = () => {}) =>
  makeRenewer({ getTokenFile: () => tokenFile, fetchImpl: chainFetch(calls, opts), nowImpl: () => 5e12, log, env: {} });

test('an EXPIRED bearer with a refresh token on file restarts the chain: exchange, then the hourly path with the fresh bearer, both rails renewed', async () => {
  const { tokenFile, dir } = fileWith({ ttl: -600, tid: tidIn(-600) });
  const calls = [];
  const r = await renewer(tokenFile, calls).maybeRenew(readCredentials({ tokenFile, allowExpired: true }));
  assert.equal(r.renewed, true);
  assert.equal(r.coldStart, true);
  assert.equal(hits(calls, EXCHANGE_PATH), 1, 'one exchange');
  assert.equal(hits(calls, REFRESH_PATH), 1, 'then login/current with the fresh bearer, for token-id/companyId');
  const cur = calls.find((c) => c.url.endsWith(REFRESH_PATH));
  assert.equal(cur.init.headers.authorization, `Bearer ${FRESH_BEARER}`, 'login/current ran on the EXCHANGED bearer, not the dead one');
  assert.equal(hits(calls, 'identitytoolkit'), 1);
  const after = readCredentials({ tokenFile });
  assert.equal(after.jwt, HOURLY_BEARER, 'the final bearer is the hourly path\'s (newest)');
  assert.equal(after.tokenId, FRESH_TID);
  assert.ok(after.secondsRemaining > 3000);
  assert.equal(readRefreshToken({ tokenFile }), RT_NEWER, 'the NEWEST rotated refresh token is stored');
  assert.ok(readFileSync(join(dir, 'agency.json'), 'utf8').includes('COMPANY0000000000001'));
});

test('cold start still succeeds when the hourly step fails afterwards: fresh bearer + rotated refresh token are written, token-id kept', async () => {
  const oldTid = tidIn(900);
  const { tokenFile } = fileWith({ ttl: -600, tid: oldTid });
  const calls = [];
  const logs = [];
  const r = await renewer(tokenFile, calls, { current: { status: 500 } }, (m) => logs.push(m)).maybeRenew(readCredentials({ tokenFile, allowExpired: true }));
  assert.equal(r.renewed, true);
  const after = readCredentials({ tokenFile });
  assert.equal(after.jwt, FRESH_BEARER);
  assert.equal(after.tokenId, oldTid, 'a still-valid token-id is never discarded');
  assert.equal(readRefreshToken({ tokenFile }), RT_NEW);
  assert.ok(logs.some((m) => /token-id/i.test(m)), 'the partial outcome is logged');
});

test('an EXPIRED bearer with NO refresh token on file makes no network call — TOKEN_EXPIRED stays the answer', async () => {
  const { tokenFile } = fileWith({ ttl: -600, refreshToken: null });
  const calls = [];
  const r = await renewer(tokenFile, calls).maybeRenew(readCredentials({ tokenFile, allowExpired: true }));
  assert.equal(r.renewed, false);
  assert.equal(r.reason, 'no-refresh-token');
  assert.equal(calls.length, 0);
});

test('a failed exchange is swallowed, logged, backed off, and leaves the file untouched', async () => {
  const { tokenFile } = fileWith({ ttl: -600 });
  const before = readFileSync(tokenFile, 'utf8');
  const calls = [];
  const logs = [];
  const rn = renewer(tokenFile, calls, { exchange: { status: 401 } }, (m) => logs.push(m));
  const creds = readCredentials({ tokenFile, allowExpired: true });
  assert.equal((await rn.maybeRenew(creds)).renewed, false);
  assert.equal((await rn.maybeRenew(creds)).renewed, false);
  assert.equal(hits(calls, EXCHANGE_PATH), 1, 'no immediate retry');
  assert.ok(logs.some((m) => /cold start|exchange|RENEW_FAILED/i.test(m)));
  assert.equal(readFileSync(tokenFile, 'utf8'), before);
});

test('concurrent callers on an expired bearer share ONE exchange', async () => {
  const { tokenFile } = fileWith({ ttl: -600 });
  const calls = [];
  const rn = renewer(tokenFile, calls);
  const creds = readCredentials({ tokenFile, allowExpired: true });
  await Promise.all([rn.maybeRenew(creds), rn.maybeRenew(creds), rn.maybeRenew(creds)]);
  assert.equal(hits(calls, EXCHANGE_PATH), 1);
});

test('a LIVE near-expiry bearer still takes the hourly path (no exchange), and stores the refresh token it is handed', async () => {
  const { tokenFile } = fileWith({ ttl: 200, refreshToken: null });
  const calls = [];
  const r = await renewer(tokenFile, calls).maybeRenew(readCredentials({ tokenFile, allowExpired: true }));
  assert.equal(r.renewed, true);
  assert.equal(r.coldStart, false);
  assert.equal(hits(calls, EXCHANGE_PATH), 0);
  assert.equal(readRefreshToken({ tokenFile }), RT_NEWER, 'a pre-0.46.0 file gains the line at its first hourly renewal');
});

// ---------- the gateway ----------

test('gateway: an expired bearer with a refresh token on file goes out with a FRESH bearer instead of TOKEN_EXPIRED', async () => {
  const { tokenFile } = fileWith({ ttl: -600, tid: tidIn(-600) });
  const calls = [];
  const fetchImpl = chainFetch(calls);
  const rn = makeRenewer({ getTokenFile: () => tokenFile, fetchImpl, nowImpl: () => 5e12, log: () => {}, env: {} });
  const gw = makeGateway({ tokenFile, loc: 'L1', fetchImpl, renewer: rn, throttleMs: 0, jitterMs: 0 });
  const res = await gw.call('GET', '/workflow/L1/list');
  assert.equal(res.status, 200);
  const api = calls.find((c) => c.url.endsWith('/workflow/L1/list'));
  assert.equal(api.init.headers.authorization, `Bearer ${HOURLY_BEARER}`);
});

test('gateway: an expired bearer with NO refresh token still throws TOKEN_EXPIRED, exactly as before', async () => {
  const { tokenFile } = fileWith({ ttl: -600, refreshToken: null });
  const calls = [];
  const fetchImpl = chainFetch(calls);
  const rn = makeRenewer({ getTokenFile: () => tokenFile, fetchImpl, nowImpl: () => 5e12, log: () => {}, env: {} });
  const gw = makeGateway({ tokenFile, loc: 'L1', fetchImpl, renewer: rn, throttleMs: 0, jitterMs: 0 });
  await assert.rejects(gw.call('GET', '/workflow/L1/list'), (e) => e.code === 'TOKEN_EXPIRED');
  assert.equal(calls.length, 0);
});
