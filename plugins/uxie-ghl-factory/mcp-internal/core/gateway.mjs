// The ONE place an internal-API call happens: auth injection (both rails),
// header discipline, throttling, and response normalization. `call` returns
// { status, ok, json } — the exact contract engine/orchestrate.mjs expects,
// so engines drop in with no adapter.
import { readCredentials, requireAiCredentials } from './auth.mjs';
import { CODES } from './errors.mjs';

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

  const request = async (method, path, body, baseOrOptions = BASE) => {
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
    return res;
  };

  const call = async (method, path, body, baseOrOptions = BASE) => {
    const res = await request(method, path, body, baseOrOptions);
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, ok: res.ok, json };
  };

  const sseError = (code, detail, remediation) => {
    const error = new Error(detail);
    error.code = code;
    error.detail = detail;
    error.remediation = remediation;
    return error;
  };

  const parseEvent = (frame) => {
    const fields = frame.replace(/\r/g, '').split('\n');
    let event = 'message';
    const data = [];
    for (const line of fields) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    const raw = data.join('\n');
    let payload = raw;
    try { payload = JSON.parse(raw); } catch { /* keep non-JSON event data intact */ }
    return { event, data: payload };
  };

  // Consume an SSE response through the same auth/throttle chokepoint as call().
  // A closed stream is not success on its own: one of terminalEvents must arrive.
  const stream = async (method, path, body, baseOrOptions = BASE) => {
    const supplied = typeof baseOrOptions === 'string' ? { base: baseOrOptions } : (baseOrOptions ?? {});
    const terminalEvents = new Set(supplied.terminalEvents ?? ['done', 'agent_saved']);
    const res = await request(method, path, body, {
      ...supplied,
      headers: { accept: 'text/event-stream', ...(supplied.headers ?? {}) },
    });
    if (!res.ok) {
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = text; }
      const error = sseError(`HTTP_${res.status}`, 'SSE endpoint returned an unsuccessful HTTP response',
        'Inspect the upstream response, correct the request or credentials, then retry.');
      error.gatewayResponse = { status: res.status, json };
      throw error;
    }
    const contentType = res.headers?.get?.('content-type') ?? res.headers?.['content-type'] ?? '';
    if (!/\btext\/event-stream\b/i.test(contentType) || !res.body?.getReader) {
      throw sseError(CODES.SSE_EXPECTED, 'Agent Studio build did not return an SSE response',
        'Do not treat this as a successful agent creation. Inspect the response shape before retrying.');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = '';
    let terminal = null;
    const consumeFrames = () => {
      const frames = buffer.split(/\n\n/);
      buffer = frames.pop();
      for (const frame of frames) {
        if (!frame.trim()) continue;
        const parsed = parseEvent(frame);
        events.push(parsed);
        if (terminalEvents.has(parsed.event)) terminal = parsed;
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (value) { buffer += decoder.decode(value, { stream: !done }); consumeFrames(); }
      if (done) break;
    }
    if (buffer.trim()) {
      const parsed = parseEvent(buffer);
      events.push(parsed);
      if (terminalEvents.has(parsed.event)) terminal = parsed;
    }
    if (!terminal) {
      throw sseError(CODES.SSE_INCOMPLETE, 'SSE stream ended without a terminal success event',
        'Do not treat this as a successful agent creation. Inspect the account for a partial draft before retrying.');
    }
    return { status: res.status, ok: res.ok, events, terminal };
  };

  return { call, stream, loc, uid: creds.uid, capabilities: { unauthenticatedRawUpload: true } };
}
