// The ONE place an internal-API call happens: auth injection (both rails),
// header discipline, throttling, and response normalization. `call` returns
// { status, ok, json } — the exact contract engine/orchestrate.mjs expects,
// so engines drop in with no adapter.
import { readCredentials } from './auth.mjs';

export const BASE = 'https://backend.leadconnectorhq.com';
const IFRAME = 'https://client-app-automation-workflows.leadconnectorhq.com';
const THROTTLE_MS = 300;   // established constant (scripts/edit.mjs)
const JITTER_MS = 150;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeGateway({ tokenFile, loc, rail = 'jwt', fetchImpl = fetch, sleepImpl = defaultSleep, randomImpl = Math.random }) {
  const creds = readCredentials({ tokenFile });   // throws AuthError; tools map it

  const headers = (isWrite) => {
    const h = { channel: 'APP', source: 'WEB_USER', version: '2021-07-28', accept: 'application/json, text/plain, */*' };
    if (rail === 'token-id') {
      if (!creds.tokenId) { const e = new Error('no token-id in capture file'); e.code = 'TOKEN_MISSING'; throw e; }
      h['token-id'] = creds.tokenId;
    } else {
      h.authorization = `Bearer ${creds.jwt}`;
    }
    if (isWrite) { h['content-type'] = 'application/json'; h.origin = IFRAME; h.referer = `${IFRAME}/`; }
    return h;
  };

  const call = async (method, path, body, base = BASE) => {
    await sleepImpl(THROTTLE_MS + Math.floor(randomImpl() * JITTER_MS));
    const res = await fetchImpl(base + path, {
      method,
      headers: headers(method !== 'GET'),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, ok: res.ok, json };
  };

  return { call, loc, uid: creds.uid };
}
