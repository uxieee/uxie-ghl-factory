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

function decode(jwt) {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); }
  catch { throw new AuthError(CODES.TOKEN_MISSING, 'token is not a decodable JWT', RECAPTURE); }
}

export const secondsRemaining = (jwt) => decode(jwt).exp - Math.floor(Date.now() / 1000);

export function safeClaims(jwt) {
  const c = decode(jwt);
  return { uid: c.authClassId ?? null, companyId: c.companyId ?? null, exp: c.exp, secondsRemaining: secondsRemaining(jwt) };
}

export function readCredentials({ tokenFile }) {
  if (!tokenFile || !existsSync(tokenFile)) {
    throw new AuthError(CODES.TOKEN_MISSING, `no token file at ${tokenFile ?? '(unset)'}`,
      `Run the capture runbook to write ${DEFAULT_TOKEN_FILE}, then call set_token_file with its path.`);
  }
  const raw = readFileSync(tokenFile, 'utf8');
  const jwt = (raw.match(/Bearer\s+(ey[A-Za-z0-9._-]+)/i) || [])[1];
  if (!jwt) throw new AuthError(CODES.TOKEN_MISSING, `no Bearer token found in ${tokenFile}`, RECAPTURE);
  if (secondsRemaining(jwt) <= 0) throw new AuthError(CODES.TOKEN_EXPIRED, 'JWT exp is in the past', RECAPTURE);
  const tokenId = (raw.match(/token-id:\s*([A-Za-z0-9._-]+)/i) || [])[1] ?? null;
  const claims = safeClaims(jwt);
  return { jwt, tokenId, uid: claims.uid, exp: claims.exp };
}

export function authStatus(state) {
  try {
    const c = readCredentials({ tokenFile: state.tokenFile });
    const s = safeClaims(c.jwt);
    return {
      tokenFile: state.tokenFile, jwt: { present: true, ...s },
      tokenId: { present: Boolean(c.tokenId), note: c.tokenId ? 'AI-services rail available' : 'AI tools (Plan 4) need a token-id line in the capture file' },
      engine: state.engineVersion ?? 'unknown',
    };
  } catch (e) {
    return { tokenFile: state.tokenFile, jwt: { present: false }, error: { code: e.code, detail: e.detail, remediation: e.remediation }, engine: state.engineVersion ?? 'unknown' };
  }
}
