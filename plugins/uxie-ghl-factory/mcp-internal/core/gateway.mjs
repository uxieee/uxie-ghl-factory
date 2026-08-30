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
// Retry-After's two legal forms (RFC 9110 §10.2.3). Parsed by SHAPE before Date.parse,
// because V8 happily reads `-5` as a bare year and `1e3` as a year too — both would land
// in the past and clamp to 0, emitting the exact "retry immediately" value this reader
// exists to never produce. Anything not matching delta-seconds or one of the three
// historical HTTP-date shapes is `null` (unknown), not `0` (go now).
const DELTA_SECONDS = /^\d+$/;
const IMF_FIXDATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
// The letters BEFORE the literal `day` are the weekday stem, and the stems are 3-6 long:
// Sun/Mon/Fri (3), Tues (4), Thurs/Satur (5), Wednes (6). Requiring 6-9 letters ahead of
// `day` therefore matched `Wednesday` and NOTHING ELSE — the other six weekday names fell
// through to `null` (unknown delay) even though Date.parse reads them perfectly, so six
// days out of seven a legal RFC 850 Retry-After was silently discarded.
const RFC850_DATE = /^[A-Za-z]{3,6}day, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT$/;
// asctime is the ONE HTTP-date shape that carries no zone token. RFC 9110 §5.6.7 still
// defines it as GMT, but `Date.parse` has no way to know that and reads it as LOCAL time —
// so the same header yields a different delay in every deployment timezone, and in a
// timezone ahead of GMT it lands in the past and clamps to 0: the exact "retry
// immediately" value this reader exists to never produce. Parsed field-by-field into
// Date.UTC instead, so the result is timezone-independent.
const ASCTIME_DATE = /^[A-Za-z]{3} ([A-Za-z]{3}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parseAsctimeGmt = (text) => {
  const match = ASCTIME_DATE.exec(text);
  if (!match) return NaN;
  const [, monthName, dayText, hour, minute, second, year] = match;
  const month = MONTHS.indexOf(monthName);
  if (month < 0) return NaN;
  const day = Number(dayText);
  const at = Date.UTC(Number(year), month, day, Number(hour), Number(minute), Number(second));
  // Date.UTC silently ROLLS OVER out-of-range fields (`Feb 31` becomes March 3, `25:00`
  // becomes the next day), which would turn a malformed header into a confident delay.
  // Round-tripping the parsed instant is the cheapest way to reject that outright.
  const check = new Date(at);
  const valid = check.getUTCFullYear() === Number(year)
    && check.getUTCMonth() === month
    && check.getUTCDate() === day
    && check.getUTCHours() === Number(hour)
    && check.getUTCMinutes() === Number(minute)
    && check.getUTCSeconds() === Number(second);
  return valid ? at : NaN;
};
// A checkpoint consumer may sleep on this value, so a server claiming a delay measured
// in millennia is clamped to a day rather than parking the run past any human horizon.
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

// Attached to request-time credential throws so tools.mjs#fromThrown recognizes them as
// auth failures (code + remediation) and tells the caller to RE-CAPTURE — not the generic
// "gateway transport failed, inspect account state", which sends them hunting the account
// for a problem that is really just an expired/absent token (review SC1).
const RECAPTURE = 'Re-capture the token: invoke the uxie-ghl-factory:internal-connect skill yourself, then retry the call. No restart needed; the server re-reads the token file on every call.';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `throttleMs`/`jitterMs` default to the established constants, so every existing caller
// keeps the exact 300-450ms per-call pacing it has today. They exist for ONE caller: the
// audit rail, where a process-wide limiter already owns pacing and a second per-gateway
// sleep would double every read's cost for no extra politeness.
//
// Task 5's audit stdio MUST construct its audit gateways with `throttleMs: 0, jitterMs: 0`
// — the shared makeAuditLimiter is the single pacing authority on that rail.
export function makeGateway({ tokenFile, loc, rail = 'jwt', fetchImpl = fetch, sleepImpl = defaultSleep, randomImpl = Math.random, nowImpl = Date.now, throttleMs = THROTTLE_MS, jitterMs = JITTER_MS, legacyTokenFileEnv = false }) {
  // Read expired credentials too: the AI rail must distinguish its independently
  // expiring Bearer JWT and Firebase token-id before sending a request.
  const creds = readCredentials({ tokenFile, allowExpired: true, legacyTokenFileEnv });   // throws AuthError; tools map it

  const headers = (isWrite, overrides = {}, base = BASE) => {
    // channel/source/version are NOT optional outside the /workflow/* prefix. Anything on
    // /workflows/*, /workflows-marketplace/*, /marketplace/* or /conversations-reporting/*
    // returns 401 without them — with the body `version header was not found`, which reads like
    // an auth failure and is not one. /workflow/* tolerates them, so sending them everywhere is
    // both correct and simpler than deciding per path.
    //
    // The version value is VALIDATED against an allowlist, not merely required: a bogus value
    // returns `version header is invalid` rather than passing. Both 2021-07-28 (ours) and
    // 2021-04-15 (what GHL's own marketplace wrapper sends) are accepted — differential
    // 2026-08-25. Do not change this string casually; it is checked server-side.
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

  // `baseOrOptions` deliberately has NO default: the four entry points used to pin it to BASE,
  // which meant `options.base` was always set and the rail-aware default below could never apply.
  const request = async (method, path, body, baseOrOptions) => {
    const options = typeof baseOrOptions === 'string'
      ? { base: baseOrOptions }
      : (baseOrOptions ?? {});
    // The default destination follows the RAIL. An `ai`-rail gateway that defaulted to backend
    // made its most natural call — no explicit base — throw AI_RAIL_HOST_INVALID by construction
    // (list_marketplace_apps did exactly that, in both profiles, from 0.23.0 to 0.37.1). An
    // explicit wrong base is still refused by the SC3 guard in headers().
    const base = options.base ?? (rail === 'ai' ? AI_HOST : BASE);
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
    // Skipped entirely rather than slept for 0ms: a disabled throttle must cost no
    // scheduling turn at all, so a test can prove the audit rail pays the shared
    // limiter once instead of twice.
    const delayMs = Math.max(0, throttleMs) + Math.floor(randomImpl() * Math.max(0, jitterMs));
    if (delayMs > 0) await sleepImpl(delayMs);
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

  const call = async (method, path, body, baseOrOptions) => {
    const res = await request(method, path, body, baseOrOptions);
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, ok: res.ok, json };
  };

  // Header access is duck-typed because the stubs in test/ hand back a plain object
  // while a real Response exposes a Headers instance. The plain-object branch matches
  // case-insensitively for the same reason Headers does: HTTP field names are
  // case-insensitive, and a capture written as `Retry-After` must not read as absent.
  const headerValue = (res, name) => {
    if (typeof res?.headers?.get === 'function') return res.headers.get(name) ?? null;
    const bag = res?.headers;
    if (!bag || typeof bag !== 'object') return null;
    const wanted = String(name).toLowerCase();
    for (const [key, value] of Object.entries(bag)) {
      if (String(key).toLowerCase() !== wanted) continue;
      return value === undefined || value === null ? null : value;
    }
    return null;
  };

  // Retry-After is either delta-seconds or an HTTP-date. The date form is measured
  // against the INJECTED clock, not Date.now(), so a checkpoint/resume decision is
  // reproducible in tests and does not drift with wall time between capture and use.
  // An unparseable header is null rather than 0: pretending "retry immediately" is
  // exactly the silent retry the audit rail must not perform.
  const readRetryAfterMs = (res, capturedAt) => {
    const raw = headerValue(res, 'retry-after');
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (text === '') return null;
    if (DELTA_SECONDS.test(text)) return Math.min(Number(text) * 1000, MAX_RETRY_AFTER_MS);
    // Shape first, parse second. Date.parse is deliberately permissive and would
    // otherwise accept bare-year garbage as a date far in the past.
    //
    // asctime never reaches Date.parse: it is the only shape with no zone token, so
    // Date.parse would read it as local time (see parseAsctimeGmt). The other two shapes
    // end in a literal `GMT`, so their parse is already zone-independent.
    let at;
    if (ASCTIME_DATE.test(text)) at = parseAsctimeGmt(text);
    else if (IMF_FIXDATE.test(text) || RFC850_DATE.test(text)) at = Date.parse(text);
    else return null;
    if (Number.isNaN(at)) return null;
    return Math.min(Math.max(0, at - capturedAt), MAX_RETRY_AFTER_MS);
  };

  // A SEPARATE reader, deliberately not folded into `call`: engine/orchestrate.mjs
  // and every existing tool branch on the exact { status, ok, json } shape, and a
  // widened success object there would change behaviour far outside the audit rail.
  const callWithMeta = async (method, path, body, baseOrOptions) => {
    const res = await request(method, path, body, baseOrOptions);
    const capturedAt = nowImpl();
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, ok: res.ok, json, retryAfterMs: readRetryAfterMs(res, capturedAt), capturedAt };
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
  const stream = async (method, path, body, baseOrOptions) => {
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

  // `rail` is exposed so a composer can ASSERT which credential rail a gateway carries
  // instead of trusting the slot it was handed in on. The audit rail needs this: a
  // jwt-rail gateway asked for a services capability would send the location Bearer to
  // the AI host with no token-id, and an ai-rail gateway asked for a backend capability
  // throws AI_RAIL_HOST_INVALID outside the audit error taxonomy.
  // ONE POLLED READ-BACK PRIMITIVE. Four places hand-rolled this loop — both folder tools and two
  // webhook-pin paths — each with its own delay, its own attempt count, and its own idea of what a
  // miss meant. GHL's list indexes lag a write by a second or two, so a single immediate read-back
  // reported `verified: false` on writes that had in fact applied, and callers learned to ignore
  // the flag. Sleeps BEFORE each retry, never before the first attempt; a thrown predicate counts
  // as a miss and is recorded rather than escaping.
  const readBackUntil = async (fn, { pollMs = 1500, maxPolls = 8, sleepImpl: sleepOverride } = {}) => {
    const nap = sleepOverride ?? sleepImpl;
    let last = null;
    for (let attempt = 1; attempt <= maxPolls; attempt++) {
      if (attempt > 1) await nap(pollMs);
      try {
        const hit = await fn(attempt);
        if (hit !== null && hit !== undefined && hit !== false) return { hit, attempts: attempt, last: hit };
        last = hit ?? null;
      } catch (error) {
        last = { error: String(error?.message ?? error) };
      }
    }
    return { hit: null, attempts: maxPolls, last };
  };

  return { call, callWithMeta, stream, readBackUntil, loc, rail, uid: creds.uid, capabilities: { unauthenticatedRawUpload: true } };
}
