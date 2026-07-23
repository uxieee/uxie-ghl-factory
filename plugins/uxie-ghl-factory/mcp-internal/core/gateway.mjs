// The ONE place an internal-API call happens: auth injection (both rails),
// header discipline, throttling, and response normalization. `call` returns
// { status, ok, json } — the exact contract engine/orchestrate.mjs expects,
// so engines drop in with no adapter.
import { readCredentials, requireAiCredentials } from './auth.mjs';
import { CODES } from './errors.mjs';

export const BASE = 'https://backend.leadconnectorhq.com';
const IFRAME = 'https://client-app-automation-workflows.leadconnectorhq.com';
const APP = 'https://app.gohighlevel.com';
// The one host the agency-admin `token-id` (Firebase, broader scope than the location
// JWT) may be attached to. Asserted per request so an `ai`-rail call to any other base
// cannot leak it (review SC3).
const AI_HOST = 'https://services.leadconnectorhq.com';
// Google Cloud Storage signed-upload targets: path-style (storage.googleapis.com) OR
// virtual-hosted style (<bucket>.storage.googleapis.com). Both are valid destinations for
// a GHL-issued signed URL, and neither ever receives GHL auth (review SC4/MF1).
const GCS_HOST_RE = /^([a-z0-9][a-z0-9._-]*\.)?storage\.googleapis\.com$/i;
const THROTTLE_MS = 300;   // established constant (scripts/edit.mjs)
const JITTER_MS = 150;

// Attached to request-time credential throws so tools.mjs#fromThrown recognizes them as
// auth failures (code + remediation) and tells the caller to RE-CAPTURE — not the generic
// "gateway transport failed, inspect account state", which sends them hunting the account
// for a problem that is really just an expired/absent token (review SC1).
const RECAPTURE = 'Run /uxie-ghl-factory:connect to re-authorize (the agent re-captures the token), then retry. No restart needed.';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeGateway({ tokenFile, loc, rail = 'jwt', fetchImpl = fetch, sleepImpl = defaultSleep, randomImpl = Math.random }) {
  // Read expired credentials too: the AI rail must distinguish its independently
  // expiring Bearer JWT and Firebase token-id before sending a request.
  const creds = readCredentials({ tokenFile, allowExpired: true });   // throws AuthError; tools map it

  const headers = (isWrite, overrides = {}, base = BASE) => {
    const h = { channel: 'APP', source: 'WEB_USER', version: '2021-07-28', accept: 'application/json, text/plain, */*' };
    if (isWrite) {
      h['content-type'] = 'application/json';
      h.origin = rail === 'ai' ? APP : IFRAME;
      h.referer = `${rail === 'ai' ? APP : IFRAME}/`;
    } else if (rail === 'ai') {
      // Live AI traffic originates from the application shell, not the workflow iframe.
      h.referer = `${APP}/`;
    }
    for (const [rawName, value] of Object.entries(overrides ?? {})) {
      if (value === undefined || value === null) continue;
      const name = rawName.toLowerCase();
      if (name === 'authorization' || name === 'token-id') continue;
      h[name] = value;
    }
    // Authentication is injected after caller overrides so it cannot be removed,
    // shadowed with different casing, or swapped onto the other credential rail.
    if (rail === 'ai') {
      // SC3: never attach the agency-admin token-id to anything but the AI host.
      let origin;
      try { origin = new URL(base).origin; } catch { origin = null; }
      if (origin !== AI_HOST) {
        const e = new Error(`ai rail may only target ${AI_HOST}, not ${origin ?? base}`);
        e.code = 'AI_RAIL_HOST_INVALID';
        e.remediation = 'The AI credential rail attaches an agency-admin token-id; route AI calls to the AI host only.';
        throw e;
      }
      requireAiCredentials(creds);
      h.authorization = `Bearer ${creds.jwt}`;
      h['token-id'] = creds.tokenId;
    } else if (rail === 'token-id') {
      if (!creds.tokenId) { const e = new Error('no token-id in capture file'); e.code = 'TOKEN_MISSING'; e.remediation = RECAPTURE; throw e; }
      h['token-id'] = creds.tokenId;
    } else {
      if (creds.secondsRemaining <= 0) { const e = new Error('JWT exp is in the past'); e.code = 'TOKEN_EXPIRED'; e.remediation = RECAPTURE; throw e; }
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
    // Validate the RESOLVED destination, not `base` alone: the fetch target is base+path,
    // so a non-`/` or traversing path could otherwise escape a base-only origin check
    // (review SC4/MF1). Resolving with `new URL(path, base)` also accepts both path-style
    // and virtual-hosted <bucket>.storage.googleapis.com signed URLs.
    let signedTarget = null;
    if (signedUpload) {
      let ok = method === 'PUT' && (Buffer.isBuffer(body) || ArrayBuffer.isView(body));
      try {
        const resolved = new URL(path, base);
        ok = ok && resolved.protocol === 'https:' && GCS_HOST_RE.test(resolved.hostname);
        signedTarget = resolved.href;
      } catch { ok = false; }
      if (!ok) {
        throw new Error('signedUpload requires a raw binary PUT to a *.storage.googleapis.com URL');
      }
    }
    await sleepImpl(THROTTLE_MS + Math.floor(randomImpl() * JITTER_MS));
    const requestHeaders = signedUpload
      ? Object.fromEntries(Object.entries(options.headers ?? {})
          .filter(([name, value]) => value !== undefined && value !== null
            && !['authorization', 'token-id'].includes(name.toLowerCase()))
          .map(([name, value]) => [name.toLowerCase(), value]))
      : headers(method !== 'GET', options.headers, base);
    const res = await fetchImpl(signedTarget ?? (base + path), {
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
    // This is deliberately stderr-only: stdout is the MCP stdio transport.  It
    // records protocol progress, never event payloads (which may contain prompts
    // or generated content).  Enable for a single human-gated live diagnostic.
    const diagnose = process.env.GHL_SSE_DIAGNOSTICS === '1';
    const startedAt = Date.now();
    let bytesReceived = 0;
    let chunkCount = 0;
    const lastEvents = [];
    const trace = (phase, extra = {}) => {
      if (!diagnose) return;
      process.stderr.write(`[ghl-sse] ${JSON.stringify({
        phase,
        elapsedMs: Date.now() - startedAt,
        bytesReceived,
        chunkCount,
        lastEvents,
        ...extra,
      })}\n`);
    };
    const supplied = typeof baseOrOptions === 'string' ? { base: baseOrOptions } : (baseOrOptions ?? {});
    const terminalEvents = new Set(supplied.terminalEvents ?? ['done', 'agent_saved']);
    let res;
    try {
      res = await request(method, path, body, {
        ...supplied,
        headers: { accept: 'text/event-stream', ...(supplied.headers ?? {}) },
      });
    } catch (error) {
      trace('request_error', { errorName: error?.name ?? 'Error' });
      throw error;
    }
    trace('response', { status: res.status, ok: res.ok });
    if (!res.ok) {
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = text; }
      const error = sseError(`HTTP_${res.status}`, 'SSE endpoint returned an unsuccessful HTTP response',
        'Inspect the upstream response, correct the request or credentials, then retry.');
      error.gatewayResponse = { status: res.status, json };
      throw error;
    }
    const contentType = res.headers?.get?.('content-type') ?? res.headers?.['content-type'] ?? '';
    trace('sse_headers', { status: res.status, contentType });
    if (!/\btext\/event-stream\b/i.test(contentType) || !res.body?.getReader) {
      throw sseError(CODES.SSE_EXPECTED, 'Agent Studio build did not return an SSE response',
        'Do not treat this as a successful agent creation. Inspect the response shape before retrying.');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = '';
    let terminal = null;
    const recordEvent = (parsed) => {
      events.push(parsed);
      lastEvents.push(parsed.event);
      if (lastEvents.length > 32) lastEvents.shift();
      if (terminalEvents.has(parsed.event)) terminal = parsed;
    };
    const consumeFrames = () => {
      // SSE permits CRLF, LF, or CR line endings.  The CRLF frame delimiter is
      // "\r\n\r\n", which does not contain a literal "\n\n" subsequence.
      const frames = buffer.split(/\r\n\r\n|\r\n\n|\n\r\n|\n\n|\r\r/);
      buffer = frames.pop();
      for (const frame of frames) {
        if (!frame.trim()) continue;
        const parsed = parseEvent(frame);
        recordEvent(parsed);
      }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          bytesReceived += value.byteLength;
          chunkCount++;
          buffer += decoder.decode(value, { stream: !done });
          consumeFrames();
        }
        if (done) break;
      }
    } catch (error) {
      trace('reader_error', { status: res.status, errorName: error?.name ?? 'Error' });
      throw error;
    }
    buffer += decoder.decode();
    consumeFrames();
    if (buffer.trim()) {
      const parsed = parseEvent(buffer);
      recordEvent(parsed);
    }
    trace('stream_closed', { status: res.status, terminalEvent: terminal?.event ?? null, pendingBytes: Buffer.byteLength(buffer) });
    if (!terminal) {
      trace('incomplete', { status: res.status });
      throw sseError(CODES.SSE_INCOMPLETE, 'SSE stream ended without a terminal success event',
        'Do not treat this as a successful agent creation. Inspect the account for a partial draft before retrying.');
    }
    return { status: res.status, ok: res.ok, events, terminal };
  };

  return { call, stream, loc, uid: creds.uid, capabilities: { unauthenticatedRawUpload: true } };
}
