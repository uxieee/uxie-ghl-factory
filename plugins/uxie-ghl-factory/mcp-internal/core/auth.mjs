// Credentials live in a FILE on the user's machine (written by the Playwright
// capture runbook) — never in a tool argument, never in model context. Read
// fresh on every call so re-capturing mid-session just works.
import { readFileSync, existsSync } from 'node:fs';
import { CODES } from './errors.mjs';

export const DEFAULT_TOKEN_FILE = '.playwright-mcp/tok.txt';

export class AuthError extends Error {
  constructor(code, detail, remediation) { super(detail); this.code = code; this.detail = detail; this.remediation = remediation; }
}

const RECAPTURE = 'Re-capture the JWT per the get-ghl-workflow-json capture runbook, then retry (no restart needed).';
const AI_RECAPTURE = 'Re-capture both the Bearer JWT and token-id with the AI credential capture path in docs/auth-jwt-capture.md, then retry (no restart needed).';

function decode(jwt) {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); }
  catch { throw new AuthError(CODES.TOKEN_MISSING, 'token is not a decodable JWT', RECAPTURE); }
}

export const secondsRemaining = (jwt) => decode(jwt).exp - Math.floor(Date.now() / 1000);

export function safeClaims(jwt) {
  const c = decode(jwt);
  return { uid: c.authClassId ?? null, companyId: c.companyId ?? null, exp: c.exp, secondsRemaining: secondsRemaining(jwt) };
}

export function safeTokenIdClaims(tokenId) {
  const c = decode(tokenId);
  return {
    issuer: c.iss ?? null,
    role: c.role ?? null,
    scope: c.type ?? c.scope ?? null,
    exp: c.exp ?? null,
    secondsRemaining: Number.isFinite(c.exp) ? c.exp - Math.floor(Date.now() / 1000) : null,
  };
}

export function readCredentials({ tokenFile, allowExpired = false }) {
  if (!tokenFile || !existsSync(tokenFile)) {
    throw new AuthError(CODES.TOKEN_MISSING, `no token file at ${tokenFile ?? '(unset)'}`,
      `Run the capture runbook to write ${DEFAULT_TOKEN_FILE}, then call set_token_file with its path.`);
  }
  const raw = readFileSync(tokenFile, 'utf8');
  const jwt = (raw.match(/Bearer\s+(ey[A-Za-z0-9._-]+)/i) || [])[1];
  if (!jwt) throw new AuthError(CODES.TOKEN_MISSING, `no Bearer token found in ${tokenFile}`, RECAPTURE);
  if (!allowExpired && secondsRemaining(jwt) <= 0) throw new AuthError(CODES.TOKEN_EXPIRED, 'JWT exp is in the past', RECAPTURE);
  const tokenId = (raw.match(/token-id:\s*([A-Za-z0-9._-]+)/i) || [])[1] ?? null;
  const claims = safeClaims(jwt);
  return { jwt, tokenId, uid: claims.uid, exp: claims.exp, secondsRemaining: claims.secondsRemaining };
}

export function authStatus(state) {
  try {
    const c = readCredentials({ tokenFile: state.tokenFile, allowExpired: true });
    const s = safeClaims(c.jwt);
    let tokenId = { present: false, note: 'AI tools need a token-id line captured from the AI Agents app surface.' };
    if (c.tokenId) {
      try { tokenId = { present: true, ...safeTokenIdClaims(c.tokenId) }; }
      catch { tokenId = { present: true, issuer: null, role: null, scope: null, exp: null, secondsRemaining: null, note: 'token-id claims could not be decoded; re-capture with the AI credential capture path.' }; }
    }
    return {
      tokenFile: state.tokenFile, jwt: { present: true, ...s },
      tokenId,
      engine: state.engineVersion ?? 'unknown',
    };
  } catch (e) {
    return { tokenFile: state.tokenFile, jwt: { present: false }, error: { code: e.code, detail: e.detail, remediation: e.remediation }, engine: state.engineVersion ?? 'unknown' };
  }
}

export function requireAiCredentials(creds) {
  const jwtExpired = creds.secondsRemaining <= 0;
  if (!creds.tokenId) {
    throw new AuthError(CODES.TOKEN_ID_MISSING, 'AI request needs a token-id in addition to the Bearer JWT', AI_RECAPTURE);
  }
  let tokenIdClaims;
  try { tokenIdClaims = safeTokenIdClaims(creds.tokenId); }
  catch { throw new AuthError(CODES.TOKEN_ID_MISSING, 'token-id is not a decodable JWT from the AI capture path', AI_RECAPTURE); }
  const tokenIdExpired = tokenIdClaims.secondsRemaining !== null && tokenIdClaims.secondsRemaining <= 0;
  if (jwtExpired && tokenIdExpired) {
    throw new AuthError(CODES.TOKEN_EXPIRED, 'both the Bearer JWT and token-id are expired', AI_RECAPTURE);
  }
  if (jwtExpired) throw new AuthError(CODES.TOKEN_EXPIRED, 'Bearer JWT exp is in the past', AI_RECAPTURE);
  if (tokenIdExpired) throw new AuthError(CODES.TOKEN_ID_EXPIRED, 'token-id exp is in the past', AI_RECAPTURE);
  return tokenIdClaims;
}
