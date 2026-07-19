/**
 * Auth for the GHL Memberships builder.
 *
 * HARD CONSTRAINT (see ghl-workflow-api-docs/docs/02-auth.md):
 * there is no public refresh-token path. A LeadConnector JWT lives ~1 hour and is
 * re-minted by driving an authenticated browser. Everything here is about making
 * that constraint safe and legible rather than pretending it away.
 *
 * MEMBERSHIPS vs WORKFLOWS (proven by builder smoke test, 2026-07-19):
 *   - Workflows require an IFRAME-ORIGIN token and origin/referer headers on writes.
 *   - Memberships does NOT. A parent-frame token (captured from app.gohighlevel.com)
 *     drove product/category/post/video/material/offer/theme creates + DELETE from
 *     plain Node fetch with no origin header. Do not port the workflow CORS dance here.
 */

const SKEW_SECONDS = 120;

export function decodeJwt(token) {
  const part = String(token || '').split('.')[1];
  if (!part) throw new Error('Not a JWT (no payload segment)');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
}

/** Seconds until expiry (negative = already expired). */
export function secondsRemaining(token) {
  const { exp } = decodeJwt(token);
  if (!exp) throw new Error('JWT has no exp claim');
  return Math.floor(exp - Date.now() / 1000);
}

export function isUsable(token) {
  try { return secondsRemaining(token) > SKEW_SECONDS; } catch { return false; }
}

/**
 * Load a token from env (GHL_TOKEN) and fail LOUDLY with actionable guidance.
 * Never logs the token itself.
 */
export function loadToken({ env = process.env } = {}) {
  const token = env.GHL_TOKEN;
  if (!token) {
    throw new Error(
      'No GHL_TOKEN set.\n' + MINT_INSTRUCTIONS
    );
  }
  let left;
  try { left = secondsRemaining(token); }
  catch (e) { throw new Error(`GHL_TOKEN is not a valid JWT (${e.message}).\n` + MINT_INSTRUCTIONS); }

  if (left <= SKEW_SECONDS) {
    throw new Error(
      `GHL_TOKEN expired ${left <= 0 ? `${-left}s ago` : `in ${left}s (within safety skew)`}.\n` + MINT_INSTRUCTIONS
    );
  }
  return { token, secondsRemaining: left, claims: safeClaims(token) };
}

/** Non-sensitive claim summary — safe to log. */
export function safeClaims(token) {
  const c = decodeJwt(token);
  return {
    authClass: c.authClass,
    userId: c.authClassId,          // send as updatedBy / userId on writes
    channel: c.channel,
    source: c.source,
    expiresAt: c.exp ? new Date(c.exp * 1000).toISOString() : null,
  };
}

export const MINT_INSTRUCTIONS = `
How to mint a fresh token (~1 hour of validity):
  1. In an authenticated Chrome, open the target sub-account:
       https://app.gohighlevel.com/  ->  switch to the sub-account
  2. Navigate to Memberships > Courses (any page that loads course data).
  3. DevTools > Network > filter "membership" > pick any 200 XHR.
  4. Request Headers > copy "authorization" and strip the leading "Bearer ".
  5. export GHL_TOKEN='eyJ...'

Notes:
  - Memberships accepts a PARENT-FRAME token (unlike the workflow builder, which
    requires an iframe-origin token). No origin/referer headers needed.
  - Token is a password for ~1h. Never commit it or write it to a file.
  - For long runs, re-mint every ~50 minutes; on a 401 mid-flight, re-mint and retry.
`;

/**
 * Guard for long-running builds: throws before starting work that is likely to
 * outlive the token, instead of dying halfway through a course build.
 */
export function assertHeadroom(token, estimatedSeconds) {
  const left = secondsRemaining(token);
  if (left < estimatedSeconds + SKEW_SECONDS) {
    throw new Error(
      `Token has ${left}s left but this build needs ~${estimatedSeconds}s. ` +
      `Re-mint before starting to avoid a half-built course.\n` + MINT_INSTRUCTIONS
    );
  }
  return left;
}
