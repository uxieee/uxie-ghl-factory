// SERVER:core/token-renewal.mjs — renews BOTH credentials in the token file with no browser.
//
// The GHL JWT lives ~60 minutes. Before 0.45.0 its expiry stopped work mid-task and the only
// remedy drove a headed browser and asked for a login. Everything below was MEASURED live on
// 2026-08-31 (18 probes); each rule that follows cost at least one of them to learn:
//
//   1. `GET /oauth/2/login/current` with the CURRENT bearer + channel/source/version mints a fresh
//      60-minute token. Bearer-only returns 401 — the three headers are validated server-side.
//   2. The response carries FIVE JWT-shaped fields. `authToken` (or `jwt`) is the new bearer.
//      `token` — FIRST in the body — is a Firebase CUSTOM token and 401s as a bearer. A "first JWT
//      in the body" regex picks the wrong one; two probes did exactly that.
//   3. That custom token, exchanged at Google's identitytoolkit with the app's PUBLIC Firebase web
//      key, yields the idToken the AI rail sends as `token-id`. `body.apiKey` is GHL's own key and
//      Google rejects it ("API key not valid"). The real key was read off the wire from the app's
//      own signInWithCustomToken call.
//   4. An EXPIRED bearer cannot refresh — 401 "Invalid JWT" at -322min. Renewal must run BEFORE
//      expiry; once a token is dead the browser capture is the only route. That is why the
//      trigger below requires the bearer to be alive.
//   5. ONE refresh per cycle is harmless (measured: 5 auth cookies before, 5 after). Hammering the
//      endpoint ~14x in minutes logged the automation profile out. Hence one in-flight promise
//      shared by every concurrent caller, and a minimum interval between attempts.
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
// Public client-side value, observed 2026-08-31 on the app's own identitytoolkit calls. Not a
// secret: every browser that loads app.gohighlevel.com receives it.
export const FIREBASE_WEB_API_KEY = 'AIzaSyB_w3vXmsI7WeQtrIOkjR6xTRVN5uOieiE';
export const RENEW_THRESHOLD_SEC = 300;
export const RENEW_MIN_INTERVAL_MS = 60_000;

const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;
const fail = (message) => { const e = new Error(message); e.code = 'RENEW_FAILED'; return e; };

// GHL_INTERNAL_AUTO_RENEW is a KILL SWITCH, so its absence means on. Only an explicit off wins.
export function autoRenewEnabled(env = process.env) {
  const v = String(env.GHL_INTERNAL_AUTO_RENEW ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

// Renew when either credential is inside the threshold — but ONLY while the bearer is alive,
// because a dead bearer cannot pay for the refresh (rule 4). A missing token-id is not a trigger:
// it would fire on every call for a bearer-only file and never stop.
export function needsRenewal({ jwtSecondsRemaining, tokenIdSecondsRemaining = null, thresholdSec = RENEW_THRESHOLD_SEC }) {
  if (!Number.isFinite(jwtSecondsRemaining) || jwtSecondsRemaining <= 0) return false;
  if (jwtSecondsRemaining <= thresholdSec) return true;
  return Number.isFinite(tokenIdSecondsRemaining) && tokenIdSecondsRemaining <= thresholdSec;
}

// THE FILE FORMAT IS A CONTRACT WITH readCredentials (core/auth.mjs): labelled lines, and an
// absent token-id omits the LINE rather than writing an empty value. capture-token.mjs re-exports
// this so the two writers cannot drift; test/token-file-format.test.mjs pins the round trip.
export function formatTokenFile({ bearer, tokenId }) {
  const lines = [`Bearer ${bearer}`];
  if (tokenId) lines.push(`token-id: ${tokenId}`);
  return `${lines.join('\n')}\n`;
}

export async function renewCredentials({ jwt, fetchImpl = fetch, firebaseKey = FIREBASE_WEB_API_KEY, base = BACKEND }) {
  const res = await fetchImpl(`${base}${REFRESH_PATH}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${jwt}`,
      channel: 'APP', source: 'WEB_USER', version: '2021-07-28',
      accept: 'application/json, text/plain, */*',
    },
  });
  if (res.status !== 200) throw fail(`refresh endpoint returned ${res.status}`);
  const body = await res.json().catch(() => null);
  const authToken = body?.authToken;
  if (!looksJwt(authToken)) throw fail('refresh response carried no usable authToken');

  const warnings = [];
  let tokenId = null;
  if (!looksJwt(body.token)) {
    warnings.push('refresh response carried no firebase custom token; token-id not renewed');
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
  return { jwt: authToken, tokenId, companyId: typeof body.companyId === 'string' ? body.companyId : null, warnings };
}

// Atomic: write a sibling temp file at 0600, then rename over the original. A reader mid-write
// (the gateway re-reads on every call) sees either the old file or the new one, never a torn one.
// A null tokenId keeps the EXISTING token-id line — a partial renewal must not discard a
// credential that is still valid.
export function writeTokenFile({ tokenFile, bearer, tokenId }) {
  let keep = tokenId;
  if (!keep && existsSync(tokenFile)) {
    keep = (readFileSync(tokenFile, 'utf8').match(/token-id:\s*([A-Za-z0-9._-]+)/i) || [])[1] ?? null;
  }
  const tmp = `${tokenFile}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, formatTokenFile({ bearer, tokenId: keep }), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, tokenFile);
}

// companyId is not a JWT claim, and internal-connect's audit needs it (spec §6). The refresh
// response hands it over for free, so record it beside the token file when nothing has yet —
// never overwriting a value connect mode captured from the browser.
function writeAgencyJsonIfAbsent({ tokenFile, companyId, nowMs }) {
  const path = join(dirname(tokenFile), 'agency.json');
  if (existsSync(path)) return false;
  writeFileSync(path, `${JSON.stringify({ companyId, source: 'token-renewal', capturedAt: new Date(nowMs).toISOString() }, null, 2)}\n`, { mode: 0o600 });
  return true;
}

export function makeRenewer({
  getTokenFile,
  fetchImpl = fetch,
  nowImpl = Date.now,
  log = (m) => process.stderr.write(`${m}\n`),
  firebaseKey = FIREBASE_WEB_API_KEY,
  thresholdSec = RENEW_THRESHOLD_SEC,
  minIntervalMs = RENEW_MIN_INTERVAL_MS,
}) {
  // Per token file, because set_token_file can repoint the server mid-session.
  const slots = new Map();
  const slotFor = (tokenFile) => {
    if (!slots.has(tokenFile)) slots.set(tokenFile, { inFlight: null, lastAttemptAt: -Infinity });
    return slots.get(tokenFile);
  };

  // Never throws: a renewal problem must not break the call that triggered it. The caller
  // proceeds with the credentials it has, and the existing TOKEN_EXPIRED path stays the backstop.
  const maybeRenew = (creds) => {
    const tokenFile = getTokenFile();
    if (!tokenFile || !creds || !Number.isFinite(creds.secondsRemaining)) return Promise.resolve({ renewed: false, reason: 'no-credentials' });
    let tokenIdSecondsRemaining = null;
    if (creds.tokenId) {
      try { tokenIdSecondsRemaining = safeTokenIdClaims(creds.tokenId).secondsRemaining; } catch { tokenIdSecondsRemaining = null; }
    }
    if (!needsRenewal({ jwtSecondsRemaining: creds.secondsRemaining, tokenIdSecondsRemaining, thresholdSec })) {
      return Promise.resolve({ renewed: false, reason: 'healthy' });
    }
    const slot = slotFor(tokenFile);
    if (slot.inFlight) return slot.inFlight;
    if (nowImpl() - slot.lastAttemptAt < minIntervalMs) return Promise.resolve({ renewed: false, reason: 'backoff' });
    slot.lastAttemptAt = nowImpl();
    slot.inFlight = (async () => {
      try {
        const out = await renewCredentials({ jwt: creds.jwt, fetchImpl, firebaseKey });
        writeTokenFile({ tokenFile, bearer: out.jwt, tokenId: out.tokenId });
        if (out.companyId) writeAgencyJsonIfAbsent({ tokenFile, companyId: out.companyId, nowMs: nowImpl() });
        for (const w of out.warnings) log(`[token-renewal] ${w}`);
        log(`[token-renewal] renewed ${out.tokenId ? 'both credentials' : 'the bearer only'} (had ${Math.round(creds.secondsRemaining / 60)}min left)`);
        return { renewed: true, tokenIdRenewed: Boolean(out.tokenId) };
      } catch (e) {
        // Our own error messages never contain a token value; upstream ones are status codes.
        log(`[token-renewal] renewal failed: ${e?.code ? `${e.code} ` : ''}${e?.message ?? e}`);
        return { renewed: false, reason: 'failed' };
      } finally {
        slot.inFlight = null;
      }
    })();
    return slot.inFlight;
  };

  return { maybeRenew };
}
