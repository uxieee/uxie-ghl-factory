// Credentials live in a FILE on the user's machine (written by the Playwright
// capture runbook) — never in a tool argument, never in model context. Read
// fresh on every call so re-capturing mid-session just works.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODES } from './errors.mjs';

// Absolute + stable so the auto-registered server and the capture flow agree on ONE path,
// and it survives plugin updates (never under the plugin cache root). Overridable via the
// GHL_TOK_FILE env or the set_token_file tool.
export const DEFAULT_TOKEN_FILE = join(homedir(), '.uxie-ghl-internal-mcp', 'tok.txt');

export class AuthError extends Error {
  constructor(code, detail, remediation) { super(detail); this.code = code; this.detail = detail; this.remediation = remediation; }
}

const RECAPTURE = 'Run /uxie-ghl-factory:connect to re-authorize (the agent re-captures the token to this project), then retry. No restart needed.';
const AI_RECAPTURE = 'Run /uxie-ghl-factory:connect to re-authorize (it captures both the Bearer JWT and token-id), then retry. No restart needed.';

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
      'Run /uxie-ghl-factory:connect to authorize this project (the agent captures the token for you). No restart needed.');
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
    // Field names deliberately avoid the credential-key denylist in errors.mjs
    // (`jwt`, `tokenid`, …), which scrubs a whole subtree under such a name. These
    // hold CLAIMS ABOUT the credentials, never the credentials — but named `jwt` /
    // `tokenId` they came back as "<redacted>", so auth_status could no longer tell
    // you whether your token was about to expire (live-caught 2026-07-21).
    return {
      tokenFile: state.tokenFile,
      jwtClaims: { present: true, ...s },
      tokenIdClaims: tokenId,
      engine: state.engineVersion ?? 'unknown',
    };
  } catch (e) {
    return { tokenFile: state.tokenFile, jwtClaims: { present: false }, error: { code: e.code, detail: e.detail, remediation: e.remediation }, engine: state.engineVersion ?? 'unknown' };
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
