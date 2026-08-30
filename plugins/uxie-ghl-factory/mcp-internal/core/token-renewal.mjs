// SERVER:core/token-renewal.mjs — renews BOTH credentials in the token file with no browser, and
// (0.46.0) restarts the whole chain from a 30-day refresh token after any idle.
//
// The GHL JWT lives ~60 minutes. Before 0.45.0 its expiry stopped work mid-task and the only
// remedy drove a headed browser and asked for a login. Everything below was MEASURED live on
// 2026-08-31 (21 probes); each rule that follows cost at least one of them to learn:
//
//   1. `GET /oauth/2/login/current` with the CURRENT bearer + channel/source/version mints a fresh
//      60-minute token. Bearer-only returns 401 — the three headers are validated server-side.
//   2. The response carries FIVE JWT-shaped fields. `authToken` (or `jwt`) is the new bearer.
//      `token` — FIRST in the body — is a Firebase CUSTOM token and 401s as a bearer. A "first JWT
//      in the body" regex picks the wrong one; two probes did exactly that.
//   3. That custom token, exchanged at Google's identitytoolkit with the app's Firebase web key,
//      yields the idToken the AI rail sends as `token-id`. `body.apiKey` is GHL's own key and
//      Google rejects it ("API key not valid").
//   4. An EXPIRED bearer cannot refresh THAT way — 401 "Invalid JWT" at -322min. So the hourly
//      path runs BEFORE expiry, and the trigger below requires the bearer to be alive.
//   5. ONE refresh per cycle is harmless (measured: 5 auth cookies before, 5 after). Hammering the
//      endpoint ~14x in minutes logged the automation profile out. Hence one in-flight promise
//      shared by every concurrent caller, and a minimum interval between attempts.
//   6. THE COLD START (0.46.0). The same login/current response carries a 30-DAY `refreshToken`.
//      The app itself restarts a dead session with `POST /oauth/2/login/token`, sending that token
//      BOTH as a `refresh-token` header and as body {refreshTokenV2} — caught on the wire by
//      giving the browser an EXPIRED access cookie (removing the cookie makes the app log out
//      instead). Executed from plain node with no browser: 201, and the returned authToken
//      authenticated a real read. The token is REUSABLE within its lifetime; every exchange
//      returns a rotated one and each login/current call returns a fresh one, so any use inside
//      30 days resets the clock. The exchange returns the bearer family ONLY — no firebase custom
//      token, no companyId — so after it the hourly path runs on the fresh bearer to renew the
//      AI rail too. Only when the 30-day token itself is dead does the browser come back.
//
// THE FIREBASE WEB KEY IS CAPTURED, NOT SHIPPED (0.45.1). It is a public client-side value that
// every browser loading app.gohighlevel.com receives, but it is GHL's, not ours: 0.45.0 hardcoded
// it and GitHub's secret scanner flagged the bundle within minutes of the push. It now travels
// like the other credentials — capture-token.mjs reads it off the app's own identitytoolkit
// call and writes it as a `firebase-key:` line in the 0600 token file; GHL_INTERNAL_FIREBASE_KEY
// overrides. Without one, the bearer still renews and the token-id does not (logged, not fatal).
//
// The token VALUE never leaves this module except into the token file: nothing here logs it, and
// the log sink defaults to STDERR because on the MCP server STDOUT IS THE TRANSPORT.
import { renameSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeTokenIdClaims } from './auth.mjs';

// Same origin as gateway.mjs's BASE; kept literal here so this module never imports the gateway
// (the gateway receives a renewer by injection and must not depend back on this file).
const BACKEND = 'https://backend.leadconnectorhq.com';
export const REFRESH_PATH = '/oauth/2/login/current';
export const EXCHANGE_PATH = '/oauth/2/login/token';
export const FIREBASE_KEY_ENV = 'GHL_INTERNAL_FIREBASE_KEY';
export const RENEW_THRESHOLD_SEC = 300;
export const RENEW_MIN_INTERVAL_MS = 60_000;

const STD_HEADERS = { channel: 'APP', source: 'WEB_USER', version: '2021-07-28', accept: 'application/json, text/plain, */*' };
const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;
// Google API keys are `AIza` + 35 url-safe characters.
const looksFirebaseKey = (v) => typeof v === 'string' && /^AIza[0-9A-Za-z_-]{35}$/.test(v);
const fail = (message) => { const e = new Error(message); e.code = 'RENEW_FAILED'; return e; };
const lineOf = (raw, label) => (raw.match(new RegExp(`${label}:\\s*([A-Za-z0-9._-]+)`, 'i')) || [])[1] ?? null;

// GHL_INTERNAL_AUTO_RENEW is a KILL SWITCH, so its absence means on. Only an explicit off wins.
export function autoRenewEnabled(env = process.env) {
  const v = String(env.GHL_INTERNAL_AUTO_RENEW ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

// Env wins (an operator override), then the token file's own `firebase-key:` line, else null.
export function readFirebaseKey({ tokenFile, env = process.env }) {
  const fromEnv = env?.[FIREBASE_KEY_ENV];
  if (looksFirebaseKey(fromEnv)) return fromEnv;
  if (!tokenFile || !existsSync(tokenFile)) return null;
  const fromFile = lineOf(readFileSync(tokenFile, 'utf8'), 'firebase-key');
  return looksFirebaseKey(fromFile) ? fromFile : null;
}

// The 30-day token, from the token file's `refresh-token:` line. Null for a pre-0.46.0 file.
export function readRefreshToken({ tokenFile }) {
  if (!tokenFile || !existsSync(tokenFile)) return null;
  const v = lineOf(readFileSync(tokenFile, 'utf8'), 'refresh-token');
  return looksJwt(v) ? v : null;
}

// Renew when either credential is inside the threshold — but ONLY while the bearer is alive,
// because a dead bearer cannot pay for the hourly refresh (rule 4); a dead bearer is the cold
// start's job. A missing token-id is not a trigger: it would fire on every call for a
// bearer-only file and never stop.
export function needsRenewal({ jwtSecondsRemaining, tokenIdSecondsRemaining = null, thresholdSec = RENEW_THRESHOLD_SEC }) {
  if (!Number.isFinite(jwtSecondsRemaining) || jwtSecondsRemaining <= 0) return false;
  if (jwtSecondsRemaining <= thresholdSec) return true;
  return Number.isFinite(tokenIdSecondsRemaining) && tokenIdSecondsRemaining <= thresholdSec;
}

// THE FILE FORMAT IS A CONTRACT WITH readCredentials (core/auth.mjs): labelled lines, and an
// absent value omits the LINE rather than writing an empty one. capture-token.mjs re-exports this
// so the two writers cannot drift; test/token-file-format.test.mjs pins the round trip. Lines
// three and four carry the Firebase web key (token-id renewal) and the 30-day refresh token
// (cold start); a file without them still works, it just renews less.
export function formatTokenFile({ bearer, tokenId, firebaseKey, refreshToken }) {
  const lines = [`Bearer ${bearer}`];
  if (tokenId) lines.push(`token-id: ${tokenId}`);
  if (firebaseKey) lines.push(`firebase-key: ${firebaseKey}`);
  if (refreshToken) lines.push(`refresh-token: ${refreshToken}`);
  return `${lines.join('\n')}\n`;
}

// The app's own session endpoint. Needs a LIVE bearer; returns the whole family.
export async function fetchLoginCurrent({ jwt, fetchImpl = fetch, base = BACKEND }) {
  const res = await fetchImpl(`${base}${REFRESH_PATH}`, { method: 'GET', headers: { ...STD_HEADERS, authorization: `Bearer ${jwt}` } });
  if (res.status !== 200) throw fail(`refresh endpoint returned ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!looksJwt(body?.authToken)) throw fail('refresh response carried no usable authToken');
  return body;
}

// The hourly path: fresh bearer, fresh token-id (via the firebase exchange), plus the companyId
// and 30-day refresh token the response carries.
export async function renewCredentials({ jwt, fetchImpl = fetch, firebaseKey = null, base = BACKEND }) {
  const body = await fetchLoginCurrent({ jwt, fetchImpl, base });
  const warnings = [];
  let tokenId = null;
  if (!looksJwt(body.token)) {
    warnings.push('refresh response carried no firebase custom token; token-id not renewed');
  } else if (!firebaseKey) {
    warnings.push(`no firebase web key on record (re-run the capture to record one, or set ${FIREBASE_KEY_ENV}); token-id not renewed`);
  } else {
    try {
      const fb = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${firebaseKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: body.token, returnSecureToken: true }),
      });
      if (fb.status !== 200) {
        warnings.push(`firebase exchange returned ${fb.status}; token-id not renewed`);
      } else {
        const j = await fb.json().catch(() => null);
        if (looksJwt(j?.idToken)) tokenId = j.idToken;
        else warnings.push('firebase exchange returned no idToken; token-id not renewed');
      }
    } catch (e) {
      warnings.push(`firebase exchange threw (${e?.message ?? e}); token-id not renewed`);
    }
  }
  return {
    jwt: body.authToken,
    tokenId,
    companyId: typeof body.companyId === 'string' ? body.companyId : null,
    refreshToken: looksJwt(body.refreshToken) ? body.refreshToken : null,
    warnings,
  };
}

// The cold start: a 30-day refresh token buys a fresh bearer with no live credential at all. The
// token rides in BOTH the header and the body because that is exactly what the app sends; one
// or the other alone was not tested and there is no reason to find out the hard way.
export async function exchangeRefreshToken({ refreshToken, fetchImpl = fetch, base = BACKEND }) {
  const res = await fetchImpl(`${base}${EXCHANGE_PATH}`, {
    method: 'POST',
    headers: { ...STD_HEADERS, 'content-type': 'application/json', 'refresh-token': refreshToken },
    body: JSON.stringify({ refreshTokenV2: refreshToken }),
  });
  if (res.status < 200 || res.status >= 300) throw fail(`refresh-token exchange returned ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!looksJwt(body?.authToken)) throw fail('refresh-token exchange carried no usable authToken');
  return { jwt: body.authToken, refreshToken: looksJwt(body.refreshToken) ? body.refreshToken : refreshToken };
}

// Atomic: write a sibling temp file at 0600, then rename over the original. A reader mid-write
// (the gateway re-reads on every call) sees either the old file or the new one, never a torn one.
// A null tokenId keeps the EXISTING token-id line — a partial renewal must not discard a
// credential that is still valid — and an OMITTED firebaseKey/refreshToken keeps its existing line.
export function writeTokenFile({ tokenFile, bearer, tokenId, firebaseKey, refreshToken }) {
  let keepTid = tokenId;
  let keepKey = firebaseKey;
  let keepRt = refreshToken;
  if ((!keepTid || keepKey === undefined || keepRt === undefined) && existsSync(tokenFile)) {
    const raw = readFileSync(tokenFile, 'utf8');
    if (!keepTid) keepTid = lineOf(raw, 'token-id');
    if (keepKey === undefined) keepKey = lineOf(raw, 'firebase-key');
    if (keepRt === undefined) keepRt = lineOf(raw, 'refresh-token');
  }
  const tmp = `${tokenFile}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, formatTokenFile({ bearer, tokenId: keepTid, firebaseKey: keepKey ?? null, refreshToken: keepRt ?? null }), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, tokenFile);
}

// companyId is not a JWT claim, and internal-connect's audit needs it (spec §6). The refresh
// response hands it over for free, so record it beside the token file when nothing has yet —
// never overwriting a value connect mode captured from the browser.
export function writeAgencyJsonIfAbsent({ tokenFile, companyId, nowMs = Date.now(), source = 'token-renewal' }) {
  const path = join(dirname(tokenFile), 'agency.json');
  if (existsSync(path)) return false;
  writeFileSync(path, `${JSON.stringify({ companyId, source, capturedAt: new Date(nowMs).toISOString() }, null, 2)}\n`, { mode: 0o600 });
  return true;
}

export function makeRenewer({
  getTokenFile,
  fetchImpl = fetch,
  nowImpl = Date.now,
  log = (m) => process.stderr.write(`${m}\n`),
  firebaseKey = undefined,          // explicit override; otherwise resolved per renewal from env/file
  env = process.env,
  thresholdSec = RENEW_THRESHOLD_SEC,
  minIntervalMs = RENEW_MIN_INTERVAL_MS,
}) {
  // Per token file, because set_token_file can repoint the server mid-session.
  const slots = new Map();
  const slotFor = (tokenFile) => {
    if (!slots.has(tokenFile)) slots.set(tokenFile, { inFlight: null, lastAttemptAt: -Infinity });
    return slots.get(tokenFile);
  };

  // Runs one attempt under the slot's in-flight/back-off discipline. `work` returns the result.
  const guarded = (slot, work) => {
    if (slot.inFlight) return slot.inFlight;
    if (nowImpl() - slot.lastAttemptAt < minIntervalMs) return Promise.resolve({ renewed: false, reason: 'backoff' });
    slot.lastAttemptAt = nowImpl();
    slot.inFlight = work().finally(() => { slot.inFlight = null; });
    return slot.inFlight;
  };

  // The hourly path on a live bearer.
  const hourly = async (tokenFile, creds) => {
    try {
      const key = firebaseKey !== undefined ? firebaseKey : readFirebaseKey({ tokenFile, env });
      const out = await renewCredentials({ jwt: creds.jwt, fetchImpl, firebaseKey: key });
      writeTokenFile({ tokenFile, bearer: out.jwt, tokenId: out.tokenId, refreshToken: out.refreshToken ?? undefined });
      if (out.companyId) writeAgencyJsonIfAbsent({ tokenFile, companyId: out.companyId, nowMs: nowImpl() });
      for (const w of out.warnings) log(`[token-renewal] ${w}`);
      log(`[token-renewal] renewed ${out.tokenId ? 'both credentials' : 'the bearer only'} (had ${Math.round(creds.secondsRemaining / 60)}min left)`);
      return { renewed: true, coldStart: false, tokenIdRenewed: Boolean(out.tokenId) };
    } catch (e) {
      // Our own error messages never contain a token value; upstream ones are status codes.
      log(`[token-renewal] renewal failed: ${e?.code ? `${e.code} ` : ''}${e?.message ?? e}`);
      return { renewed: false, reason: 'failed' };
    }
  };

  // The cold start on a dead bearer: exchange the 30-day token, write the bearer it buys at once
  // (so a failure in the next step still leaves a working file), then run the hourly path on that
  // fresh bearer to renew the AI rail and pick up the newest refresh token.
  const coldStart = async (tokenFile, refreshToken) => {
    let restored;
    try {
      restored = await exchangeRefreshToken({ refreshToken, fetchImpl });
      writeTokenFile({ tokenFile, bearer: restored.jwt, tokenId: null, refreshToken: restored.refreshToken });
    } catch (e) {
      log(`[token-renewal] cold start failed: ${e?.code ? `${e.code} ` : ''}${e?.message ?? e} — the browser capture is required`);
      return { renewed: false, reason: 'failed' };
    }
    try {
      const key = firebaseKey !== undefined ? firebaseKey : readFirebaseKey({ tokenFile, env });
      const out = await renewCredentials({ jwt: restored.jwt, fetchImpl, firebaseKey: key });
      writeTokenFile({ tokenFile, bearer: out.jwt, tokenId: out.tokenId, refreshToken: out.refreshToken ?? undefined });
      if (out.companyId) writeAgencyJsonIfAbsent({ tokenFile, companyId: out.companyId, nowMs: nowImpl() });
      for (const w of out.warnings) log(`[token-renewal] ${w}`);
      log(`[token-renewal] cold start: chain restarted from the 30-day token, ${out.tokenId ? 'both credentials' : 'bearer'} renewed`);
      return { renewed: true, coldStart: true, tokenIdRenewed: Boolean(out.tokenId) };
    } catch (e) {
      log(`[token-renewal] cold start: bearer restored from the 30-day token, but the hourly step failed (${e?.message ?? e}); token-id not renewed`);
      return { renewed: true, coldStart: true, tokenIdRenewed: false };
    }
  };

  // Never throws: a renewal problem must not break the call that triggered it. The caller
  // proceeds with the credentials it has, and the existing TOKEN_EXPIRED path stays the backstop.
  const maybeRenew = (creds) => {
    const tokenFile = getTokenFile();
    if (!tokenFile || !creds || !Number.isFinite(creds.secondsRemaining)) return Promise.resolve({ renewed: false, reason: 'no-credentials' });
    const slot = slotFor(tokenFile);

    if (creds.secondsRemaining <= 0) {
      const rt = readRefreshToken({ tokenFile });
      if (!rt) return Promise.resolve({ renewed: false, reason: 'no-refresh-token' });
      return guarded(slot, () => coldStart(tokenFile, rt));
    }

    let tokenIdSecondsRemaining = null;
    if (creds.tokenId) {
      try { tokenIdSecondsRemaining = safeTokenIdClaims(creds.tokenId).secondsRemaining; } catch { tokenIdSecondsRemaining = null; }
    }
    if (!needsRenewal({ jwtSecondsRemaining: creds.secondsRemaining, tokenIdSecondsRemaining, thresholdSec })) {
      return Promise.resolve({ renewed: false, reason: 'healthy' });
    }
    return guarded(slot, () => hourly(tokenFile, creds));
  };

  return { maybeRenew };
}
