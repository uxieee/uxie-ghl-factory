// Auto-renewal of BOTH credentials in the token file, with no browser. Every rule here was
// measured live on 2026-08-31 (probes 6-18 in the memory record), and each test pins the one
// that cost a probe to learn:
//   - the refresh response carries FIVE JWT-shaped fields; `authToken` works, `token` (first in
//     the body) is a Firebase CUSTOM token and 401s as a bearer;
//   - `token` + the REAL Firebase web key mint the AI rail's token-id (`body.apiKey` is GHL's
//     own key and is rejected by Google);
//   - an EXPIRED bearer cannot refresh (401 Invalid JWT), so renewal must run BEFORE expiry;
//   - ONE refresh per cycle is harmless; hammering the endpoint logged the profile out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIREBASE_KEY_ENV, REFRESH_PATH, RENEW_THRESHOLD_SEC,
  autoRenewEnabled, needsRenewal, renewCredentials, writeTokenFile, makeRenewer, formatTokenFile, readFirebaseKey,
} from '../core/token-renewal.mjs';
import { readCredentials } from '../core/auth.mjs';

const TEST_KEY = 'AIzaTESTKEY0000000000000000000000000000'; // shape-valid, not a real key
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const mkJwt = (claims) => `eyJhbGciOiJIUzI1NiJ9.${b64(claims)}.${'s'.repeat(40)}`;
const liveJwt = (ttl = 3600) => mkJwt({ authClassId: 'u-1', exp: now() + ttl, iat: now() });
const liveTid = (ttl = 3600) => mkJwt({ iss: 'https://securetoken.google.com/highlevel-backend', role: 'admin', scope: 'agency', exp: now() + ttl });

// The measured response shape. `token` is deliberately FIRST and deliberately NOT the credential.
const refreshBody = (over = {}) => ({
  token: mkJwt({ kind: 'firebase-custom', exp: now() + 3600 }),
  apiKey: 'ghl-own-key-not-firebase-000000000000',
  userId: 'u-1', companyId: 'COMPANY0000000000001', role: 'admin', type: 'agency',
  authToken: mkJwt({ authClassId: 'u-1', exp: now() + 3600, iat: now(), field: 'authToken' }),
  jwt: mkJwt({ authClassId: 'u-1', exp: now() + 3600, iat: now(), field: 'jwt' }),
  refreshToken: mkJwt({ exp: now() + 30 * 86400 }),
  refreshJwt: mkJwt({ exp: now() + 30 * 86400 }),
  ...over,
});

const fakeFetch = (calls, { refresh = { status: 200, body: refreshBody() }, firebase = { status: 200, body: { idToken: liveTid(), expiresIn: '3600' } } } = {}) =>
  async (url, init = {}) => {
    calls.push({ url, init });
    const r = url.includes('identitytoolkit') ? firebase : refresh;
    return { status: r.status, ok: r.status === 200, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };

// ---------- policy ----------

test('autoRenewEnabled: on by default, off only for an explicit 0/false/off', () => {
  assert.equal(autoRenewEnabled({}), true);
  assert.equal(autoRenewEnabled({ GHL_INTERNAL_AUTO_RENEW: '1' }), true);
  for (const v of ['0', 'false', 'off', 'FALSE']) assert.equal(autoRenewEnabled({ GHL_INTERNAL_AUTO_RENEW: v }), false, v);
});

test('needsRenewal: only while the bearer is ALIVE and inside the threshold', () => {
  assert.equal(needsRenewal({ jwtSecondsRemaining: 3000 }), false, 'plenty of life left');
  assert.equal(needsRenewal({ jwtSecondsRemaining: RENEW_THRESHOLD_SEC }), true, 'at the threshold');
  assert.equal(needsRenewal({ jwtSecondsRemaining: 30 }), true, 'nearly dead');
  // An expired bearer 401s at the refresh endpoint (measured: "Invalid JWT" at -322min). Renewal
  // cannot help; the existing TOKEN_EXPIRED path (browser capture) is the only route.
  assert.equal(needsRenewal({ jwtSecondsRemaining: 0 }), false);
  assert.equal(needsRenewal({ jwtSecondsRemaining: -60 }), false);
});

test('needsRenewal: a dying token-id triggers renewal while the bearer can still pay for it', () => {
  assert.equal(needsRenewal({ jwtSecondsRemaining: 3000, tokenIdSecondsRemaining: 120 }), true);
  assert.equal(needsRenewal({ jwtSecondsRemaining: 3000, tokenIdSecondsRemaining: -5 }), true, 'expired token-id, live bearer');
  assert.equal(needsRenewal({ jwtSecondsRemaining: 3000, tokenIdSecondsRemaining: 3000 }), false);
  assert.equal(needsRenewal({ jwtSecondsRemaining: 3000, tokenIdSecondsRemaining: null }), false, 'no token-id at all is not a trigger');
});

// ---------- the exchange ----------

test('renewCredentials takes `authToken`, never the first JWT in the body', async () => {
  const calls = [];
  const body = refreshBody();
  const out = await renewCredentials({ jwt: liveJwt(), fetchImpl: fakeFetch(calls, { refresh: { status: 200, body } }) });
  assert.equal(out.jwt, body.authToken);
  assert.notEqual(out.jwt, body.token, 'body.token is the Firebase custom token and 401s as a bearer');
  assert.equal(out.companyId, body.companyId);
});

test('renewCredentials sends the three required GHL headers and the current bearer', async () => {
  const calls = [];
  const current = liveJwt();
  await renewCredentials({ jwt: current, fetchImpl: fakeFetch(calls) });
  const refresh = calls.find((c) => c.url.endsWith(REFRESH_PATH));
  assert.ok(refresh, 'hit the refresh endpoint');
  const h = refresh.init.headers;
  assert.equal(h.authorization, `Bearer ${current}`);
  // bearer-only returned 401 live; these three are validated server-side
  assert.equal(h.channel, 'APP'); assert.equal(h.source, 'WEB_USER'); assert.equal(h.version, '2021-07-28');
});

test('renewCredentials exchanges body.token at identitytoolkit with the CAPTURED firebase key, not body.apiKey', async () => {
  const calls = [];
  const body = refreshBody();
  const tid = liveTid();
  const out = await renewCredentials({ jwt: liveJwt(), firebaseKey: TEST_KEY, fetchImpl: fakeFetch(calls, { refresh: { status: 200, body }, firebase: { status: 200, body: { idToken: tid, expiresIn: '3600' } } }) });
  const fb = calls.find((c) => c.url.includes('identitytoolkit'));
  assert.ok(fb, 'called identitytoolkit');
  assert.match(fb.url, new RegExp(`key=${TEST_KEY}$`), 'the key the capture recorded, not a constant in the repo');
  assert.doesNotMatch(fb.url, new RegExp(body.apiKey), 'body.apiKey is GHL\'s own key — Google rejects it');
  assert.equal(fb.init.method, 'POST');
  assert.deepEqual(JSON.parse(fb.init.body), { token: body.token, returnSecureToken: true });
  assert.equal(out.tokenId, tid);
});

test('renewCredentials: a non-200 refresh throws RENEW_FAILED and never calls firebase', async () => {
  const calls = [];
  await assert.rejects(
    renewCredentials({ jwt: liveJwt(), fetchImpl: fakeFetch(calls, { refresh: { status: 401, body: { message: 'Invalid JWT' } } }) }),
    (e) => e.code === 'RENEW_FAILED',
  );
  assert.equal(calls.some((c) => c.url.includes('identitytoolkit')), false);
});

test('renewCredentials: a firebase failure still returns the new bearer, with tokenId null and a warning', async () => {
  const calls = [];
  const out = await renewCredentials({ jwt: liveJwt(), firebaseKey: TEST_KEY, fetchImpl: fakeFetch(calls, { firebase: { status: 400, body: { error: { message: 'API key not valid' } } } }) });
  assert.ok(out.jwt);
  assert.equal(out.tokenId, null);
  assert.ok(out.warnings.some((w) => /firebase|token-id/i.test(w)));
});

test('renewCredentials with NO firebase key on record renews the bearer only and says why, without calling Google', async () => {
  const calls = [];
  const out = await renewCredentials({ jwt: liveJwt(), firebaseKey: null, fetchImpl: fakeFetch(calls) });
  assert.ok(out.jwt);
  assert.equal(out.tokenId, null);
  assert.equal(calls.some((c) => c.url.includes('identitytoolkit')), false);
  assert.ok(out.warnings.some((w) => w.includes(FIREBASE_KEY_ENV)), 'names the override so the operator can fix it');
});

test('readFirebaseKey: env override wins, then the token file line, else null — and a malformed value is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'renew-'));
  const tokenFile = join(dir, 'tok.txt');
  writeFileSync(tokenFile, formatTokenFile({ bearer: liveJwt(), tokenId: liveTid(), firebaseKey: TEST_KEY }), { mode: 0o600 });
  assert.equal(readFirebaseKey({ tokenFile, env: {} }), TEST_KEY);
  const other = TEST_KEY.replace('TESTKEY', 'ENVKEY0');
  assert.equal(readFirebaseKey({ tokenFile, env: { [FIREBASE_KEY_ENV]: other } }), other);
  assert.equal(readFirebaseKey({ tokenFile, env: { [FIREBASE_KEY_ENV]: 'not-a-key' } }), TEST_KEY, 'a malformed env value falls through to the file');
  writeFileSync(tokenFile, formatTokenFile({ bearer: liveJwt(), tokenId: liveTid() }), { mode: 0o600 });
  assert.equal(readFirebaseKey({ tokenFile, env: {} }), null);
});

test('renewCredentials: an authToken that is not JWT-shaped is refused rather than written', async () => {
  const calls = [];
  await assert.rejects(
    renewCredentials({ jwt: liveJwt(), fetchImpl: fakeFetch(calls, { refresh: { status: 200, body: refreshBody({ authToken: 'nope' }) } }) }),
    (e) => e.code === 'RENEW_FAILED',
  );
});

// ---------- the file ----------

test('formatTokenFile + writeTokenFile round-trip through the real reader, at mode 0600, atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'renew-'));
  const tokenFile = join(dir, 'tok.txt');
  const bearer = liveJwt(); const tid = liveTid();
  writeTokenFile({ tokenFile, bearer, tokenId: tid, firebaseKey: TEST_KEY });
  const creds = readCredentials({ tokenFile });
  assert.equal(creds.jwt, bearer);
  assert.equal(creds.tokenId, tid);
  assert.equal(readFirebaseKey({ tokenFile, env: {} }), TEST_KEY, 'the third line survives the round trip');
  assert.equal(statSync(tokenFile).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ['tok.txt'], 'no temp file left behind');
  assert.equal(readFileSync(tokenFile, 'utf8'), formatTokenFile({ bearer, tokenId: tid, firebaseKey: TEST_KEY }));
});

test('writeTokenFile keeps the EXISTING token-id when the new one is null (partial renewal)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'renew-'));
  const tokenFile = join(dir, 'tok.txt');
  const oldTid = liveTid(900);
  writeFileSync(tokenFile, formatTokenFile({ bearer: liveJwt(200), tokenId: oldTid, firebaseKey: TEST_KEY }), { mode: 0o600 });
  const newBearer = liveJwt();
  writeTokenFile({ tokenFile, bearer: newBearer, tokenId: null });
  const creds = readCredentials({ tokenFile });
  assert.equal(creds.jwt, newBearer);
  assert.equal(creds.tokenId, oldTid, 'a still-valid token-id must not be thrown away');
  assert.equal(readFirebaseKey({ tokenFile, env: {} }), TEST_KEY, 'the recorded key survives a renewal that did not mention it');
});

// ---------- the renewer (rate discipline) ----------

const renewerFixture = ({ ttl = 200, tidTtl = 200, fetchOpts } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'renew-'));
  const tokenFile = join(dir, 'tok.txt');
  writeFileSync(tokenFile, formatTokenFile({ bearer: liveJwt(ttl), tokenId: liveTid(tidTtl), firebaseKey: TEST_KEY }), { mode: 0o600 });
  const calls = [];
  const logs = [];
  let t = 1_000_000;
  const renewer = makeRenewer({
    getTokenFile: () => tokenFile,
    fetchImpl: fakeFetch(calls, fetchOpts),
    nowImpl: () => t,
    log: (m) => logs.push(m),
    env: {},                      // the key must come from the FILE here, as in production
  });
  const creds = () => readCredentials({ tokenFile, allowExpired: true });
  return { dir, tokenFile, calls, logs, renewer, creds, advance: (ms) => { t += ms; } };
};
const refreshCalls = (calls) => calls.filter((c) => c.url.endsWith(REFRESH_PATH)).length;

test('maybeRenew renews a near-expiry file and both credentials come back with a full hour', async () => {
  const f = renewerFixture({ ttl: 200 });
  const before = f.creds();
  assert.ok(before.secondsRemaining < 300);
  const r = await f.renewer.maybeRenew(before);
  assert.equal(r.renewed, true);
  const after = f.creds();
  assert.ok(after.secondsRemaining > 3000, `bearer renewed: ${after.secondsRemaining}s`);
  assert.notEqual(after.jwt, before.jwt);
  assert.notEqual(after.tokenId, before.tokenId, 'token-id renewed too');
  assert.equal(refreshCalls(f.calls), 1);
});

test('maybeRenew does nothing for a healthy file', async () => {
  const f = renewerFixture({ ttl: 3000, tidTtl: 3000 });
  const r = await f.renewer.maybeRenew(f.creds());
  assert.equal(r.renewed, false);
  assert.equal(f.calls.length, 0);
});

test('concurrent callers share ONE in-flight refresh', async () => {
  const f = renewerFixture({ ttl: 200 });
  const c = f.creds();
  const results = await Promise.all([f.renewer.maybeRenew(c), f.renewer.maybeRenew(c), f.renewer.maybeRenew(c)]);
  assert.equal(refreshCalls(f.calls), 1, 'hammering the endpoint is what logged the profile out');
  assert.ok(results.every((r) => r.renewed === true));
});

test('a failed renewal is swallowed, logged to the provided sink, and not retried within the minimum interval', async () => {
  const f = renewerFixture({ ttl: 200, fetchOpts: { refresh: { status: 500, body: {} } } });
  const c = f.creds();
  const r1 = await f.renewer.maybeRenew(c);
  assert.equal(r1.renewed, false);
  assert.ok(f.logs.some((m) => /renew/i.test(m)), 'failure is logged (to stderr in production — never stdout, the transport)');
  const r2 = await f.renewer.maybeRenew(c);
  assert.equal(r2.renewed, false);
  assert.equal(refreshCalls(f.calls), 1, 'no immediate retry');
  f.advance(120_000);
  await f.renewer.maybeRenew(c);
  assert.equal(refreshCalls(f.calls), 2, 'retried once the interval has passed');
  const still = f.creds();
  assert.equal(still.jwt, c.jwt, 'the file is untouched on failure');
});

test('a successful renewal writes agency.json beside the token file, and never overwrites an existing one', async () => {
  const f = renewerFixture({ ttl: 200 });
  await f.renewer.maybeRenew(f.creds());
  const agency = join(f.dir, 'agency.json');
  assert.ok(existsSync(agency));
  const j = JSON.parse(readFileSync(agency, 'utf8'));
  assert.equal(j.companyId, 'COMPANY0000000000001');
  assert.equal(j.source, 'token-renewal');
  // second cycle, different companyId in the response: the file written first wins
  writeFileSync(f.tokenFile, formatTokenFile({ bearer: liveJwt(200), tokenId: liveTid(200), firebaseKey: TEST_KEY }), { mode: 0o600 });
  f.advance(120_000);
  f.calls.length = 0;
  const renewer2 = makeRenewer({ getTokenFile: () => f.tokenFile, fetchImpl: fakeFetch(f.calls, { refresh: { status: 200, body: refreshBody({ companyId: 'OTHER00000000000002' }) } }), nowImpl: () => 9e12, log: () => {}, env: {} });
  await renewer2.maybeRenew(f.creds());
  assert.equal(JSON.parse(readFileSync(agency, 'utf8')).companyId, 'COMPANY0000000000001');
});
