// The ONE place an internal-API call happens: auth injection (both rails),
// header discipline, throttling, and response normalization. `call` returns
// { status, ok, json } — the exact contract engine/orchestrate.mjs expects,
// so engines drop in with no adapter.
import { readCredentials, requireAiCredentials } from './auth.mjs';

export const BASE = 'https://backend.leadconnectorhq.com';
const IFRAME = 'https://client-app-automation-workflows.leadconnectorhq.com';
const THROTTLE_MS = 300;   // established constant (scripts/edit.mjs)
const JITTER_MS = 150;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeGateway({ tokenFile, loc, rail = 'jwt', fetchImpl = fetch, sleepImpl = defaultSleep, randomImpl = Math.random }) {
  // Read expired credentials too: the AI rail must distinguish its independently
  // expiring Bearer JWT and Firebase token-id before sending a request.
  const creds = readCredentials({ tokenFile, allowExpired: true });   // throws AuthError; tools map it

  const headers = (isWrite, overrides = {}) => {
    const h = { channel: 'APP', source: 'WEB_USER', version: '2021-07-28', accept: 'application/json, text/plain, */*' };
    if (isWrite) { h['content-type'] = 'application/json'; h.origin = IFRAME; h.referer = `${IFRAME}/`; }
    for (const [rawName, value] of Object.entries(overrides ?? {})) {
      if (value === undefined || value === null) continue;
      const name = rawName.toLowerCase();
      if (name === 'authorization' || name === 'token-id') continue;
      h[name] = value;
    }
    // Authentication is injected after caller overrides so it cannot be removed,
    // shadowed with different casing, or swapped onto the other credential rail.
    if (rail === 'ai') {
      requireAiCredentials(creds);
      h.authorization = `Bearer ${creds.jwt}`;
      h['token-id'] = creds.tokenId;
    } else if (rail === 'token-id') {
      if (!creds.tokenId) { const e = new Error('no token-id in capture file'); e.code = 'TOKEN_MISSING'; throw e; }
      h['token-id'] = creds.tokenId;
    } else {
      if (creds.secondsRemaining <= 0) { const e = new Error('JWT exp is in the past'); e.code = 'TOKEN_EXPIRED'; throw e; }
      h.authorization = `Bearer ${creds.jwt}`;
    }
    return h;
  };

  const call = async (method, path, body, baseOrOptions = BASE) => {
    const options = typeof baseOrOptions === 'string'
      ? { base: baseOrOptions }
      : (baseOrOptions ?? {});
    const base = options.base ?? BASE;
    const signedUpload = options.signedUpload === true;
    if (signedUpload && (
      method !== 'PUT'
      || new URL(base).origin !== 'https://storage.googleapis.com'
      || !(Buffer.isBuffer(body) || ArrayBuffer.isView(body))
    )) {
      throw new Error('signedUpload requires a raw binary PUT to https://storage.googleapis.com');
    }
    await sleepImpl(THROTTLE_MS + Math.floor(randomImpl() * JITTER_MS));
    const requestHeaders = signedUpload
      ? Object.fromEntries(Object.entries(options.headers ?? {})
          .filter(([name, value]) => value !== undefined && value !== null
            && !['authorization', 'token-id'].includes(name.toLowerCase()))
          .map(([name, value]) => [name.toLowerCase(), value]))
      : headers(method !== 'GET', options.headers);
    const res = await fetchImpl(base + path, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : (signedUpload ? body : JSON.stringify(body)),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, ok: res.ok, json };
  };

  return { call, loc, uid: creds.uid, capabilities: { unauthenticatedRawUpload: true } };
}
