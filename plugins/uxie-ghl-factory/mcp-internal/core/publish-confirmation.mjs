// bl-946 (DECISIONS 2026-11-09): the two-step publish. An agent told "publish it now" passed confirm:true on its first call and
// published with no preview read. Now the first call publishes nothing and returns a preview plus a confirmation token; only a
// second call that presents the token publishes. The token is bound to one location, one workflow and the version the preview
// saw, lasts a few minutes, works once, and is signed with a per-process secret (it does not outlive the server that issued it).
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const PUBLISH_TOKEN_TTL_MS = 5 * 60 * 1000;

// w7 (orchestrator 2026-11-09): a token is valid only from this long after its preview. A model that reads the preview and calls
// publish in the same turn, with no user reply, is refused: the user has not had the chance to say yes. Test files that drive a
// preview and a publish in one process lower it with setPublishMinAgeForTests; no production path calls that.
export const PUBLISH_MIN_AGE_MS = 20 * 1000;
let minAgeMs = PUBLISH_MIN_AGE_MS;
export function setPublishMinAgeForTests(ms) { minAgeMs = ms; }

const SECRET = randomBytes(32);
// jti -> expiry, for tokens already spent. Pruned on every verify, so it never holds more than one lifetime of tokens.
const spent = new Map();

const sign = (payloadPart) => createHmac('sha256', SECRET).update(payloadPart).digest('hex');

// Hex, not base64: the output scrubber (core/errors.mjs) redacts any long string containing `eyJ` as a JWT, and base64 of a
// JSON object (or a signature) can contain it. Hex has no `J`, so the token can never trip that rule.
const PREFIX = 'pc1-';
const HEX = /^[0-9a-f]+$/;

// `kind` says what is being published ('workflow' or 'studio_site'), so a token for one cannot publish the other.
export function issuePublishToken({ locationId, workflowId, version, kind = 'workflow' }, { now = Date.now() } = {}) {
  const body = { loc: locationId, wid: workflowId, ver: version ?? null, k: kind, iat: now, exp: now + PUBLISH_TOKEN_TTL_MS, jti: randomUUID() };
  const payloadPart = Buffer.from(JSON.stringify(body)).toString('hex');
  return `${PREFIX}${payloadPart}.${sign(payloadPart)}`;
}

// Returns { ok: true } and spends the token, or { ok: false, reason }. A refusal does not spend the token, so the caller can
// retry with the right workflow or version after a fresh read.
export function verifyPublishToken(token, { locationId, workflowId, version, kind = 'workflow' }, { now = Date.now() } = {}) {
  for (const [jti, exp] of spent) if (exp < now) spent.delete(jti);
  if (typeof token !== 'string' || token === '') return { ok: false, reason: 'no confirmation token was given' };
  if (!token.startsWith(PREFIX)) return { ok: false, reason: 'the confirmation token is malformed' };
  const parts = token.slice(PREFIX.length).split('.');
  if (parts.length !== 2) return { ok: false, reason: 'the confirmation token is malformed' };
  const [payloadPart, sig] = parts;
  if (!HEX.test(payloadPart) || !HEX.test(sig)) return { ok: false, reason: 'the confirmation token is malformed' };
  const expected = Buffer.from(sign(payloadPart));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'the confirmation token signature does not match' };
  }
  let body;
  try { body = JSON.parse(Buffer.from(payloadPart, 'hex').toString('utf8')); } catch { return { ok: false, reason: 'the confirmation token is malformed' }; }
  if ((body.k ?? 'workflow') !== kind) return { ok: false, reason: 'the confirmation token is for a different kind of publish' };
  if (body.loc !== locationId) return { ok: false, reason: 'the confirmation token is for another location' };
  if (body.wid !== workflowId) return { ok: false, reason: 'the confirmation token is for another workflow' };
  if (body.ver !== (version ?? null)) return { ok: false, reason: 'the workflow version changed after the preview; preview again' };
  if (typeof body.iat !== 'number' || now - body.iat < minAgeMs) {
    return { ok: false, reason: 'the preview was only just shown: show the preview to the user and wait for their yes, then call again (no write was sent)' };
  }
  if (typeof body.exp !== 'number' || body.exp < now) return { ok: false, reason: 'the confirmation token expired; preview again' };
  if (spent.has(body.jti)) return { ok: false, reason: 'the confirmation token was already used' };
  spent.set(body.jti, body.exp);
  return { ok: true };
}

// The steps that send something outside the sub-account. Best-effort by type name: an unknown type is not listed here, and the
// preview still shows every step, so a missed type is a gap in the summary, not in the gate.
const OUTWARD_STEP_TYPES = new Set([
  'email', 'send_email', 'sms', 'send_sms', 'whatsapp', 'send_whatsapp', 'send_whatsapp_flow',
  'webhook', 'outbound_webhook', 'custom_webhook', 'call', 'voicemail', 'send_voicemail',
  'facebook_messenger', 'send_facebook_message', 'instagram_dm', 'send_instagram_message',
  'send_document', 'send_invoice', 'live_chat_message',
]);

export function outwardStepsOf(templates) {
  return (Array.isArray(templates) ? templates : [])
    .filter((step) => OUTWARD_STEP_TYPES.has(step?.type))
    .map((step) => ({ id: step.id ?? null, type: step.type, name: step.name ?? null }));
}

// A digest of exactly what a preview describes. A tool with no version of its own binds its token to this, so the token attests to
// the planned write: change one field of the preview and the token no longer matches.
export function digestOf(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 32);
}
