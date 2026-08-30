// Credentials live in a FILE on the user's machine (written by the Playwright
// capture runbook) — never in a tool argument, never in model context. Read
// fresh on every call so re-capturing mid-session just works.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODES } from './errors.mjs';

// Absolute + stable so the auto-registered server and the capture flow agree on ONE path,
// and it survives plugin updates (never under the plugin cache root). Overridable via the
// GHL_INTERNAL_TOK_FILE env or the set_token_file tool.
export const DEFAULT_TOKEN_FILE = join(homedir(), '.uxie-ghl-internal-mcp', 'tok.txt');

export class AuthError extends Error {
  constructor(code, detail, remediation) { super(detail); this.code = code; this.detail = detail; this.remediation = remediation; }
}

// 0.43.0 hard-renamed GHL_TOK_FILE -> GHL_INTERNAL_TOK_FILE (see CHANGELOG). Only the NEW name
// is ever read AS A VALUE — there is deliberately no fallback that reads the old one. But a
// registration that still sets only the OLD name would see GHL_INTERNAL_TOK_FILE as simply
// unset and fall through to DEFAULT_TOKEN_FILE above, silently authenticating as whatever login
// owns that shared file. That is a silent wrong-account failure, so entry points compute this
// flag from the OLD name's PRESENCE ONLY (never its value) and hand it to readCredentials,
// which refuses loudly instead.
const LEGACY_TOKEN_FILE_REMEDIATION = 'Rename the env var on this registration, then retry — same '
  + 'value, new name:\n'
  + '  claude mcp add --transport stdio --scope local -e GHL_INTERNAL_TOK_FILE="<same path you '
  + 'had after -e GHL_TOK_FILE=...>" ... (GHL_INTERNAL_TOK_FILE replaces GHL_TOK_FILE; keep any '
  + '-e GHL_INTERNAL_LOCATIONS=... flag and the same server name)';

// PHRASED AT THE AGENT, NOT AT THE USER, and that is the whole point of these two strings.
//
// They used to open "Run /uxie-ghl-factory:internal-connect…". A slash command is a thing a USER
// types, so an agent read it as "tell the human to do this" and stopped mid-task -- every time,
// on a credential that expires hourly. The skill is invocable by the agent directly, so it never
// needed to ask.
//
// The one-attempt bound matters as much as the permission: re-capturing in a loop against a
// genuinely dead browser session is how a task burns a context window achieving nothing.
const RECAPTURE = 'EXPIRED CREDENTIAL — RE-CAPTURE IT YOURSELF, do not ask and do not stop. '
  + 'Invoke the `uxie-ghl-factory:internal-connect` skill: it drives the browser and writes a fresh '
  + 'token to this project. The server re-reads the file on every call, so nothing restarts. The '
  + 'user only has to act if the browser session itself has lapsed. Then retry the call that failed. '
  + 'ONE re-capture per failure: if the retry fails the same way, stop and report it.';
const AI_RECAPTURE = 'EXPIRED CREDENTIAL — RE-CAPTURE IT YOURSELF, do not ask and do not stop. '
  + 'Invoke the `uxie-ghl-factory:internal-connect` skill: one capture on the AI surface yields BOTH '
  + 'the Bearer JWT and the token-id this rail needs. The server re-reads the file on every call, so '
  + 'nothing restarts. Then retry the call that failed. ONE re-capture per failure: if the retry '
  + 'fails the same way, stop and report it.';

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

export function readCredentials({ tokenFile, allowExpired = false, legacyTokenFileEnv = false }) {
  // Checked BEFORE the file lookup: a stale env var means this registration was never going
  // to reach the right file at all, so naming that is more useful than "no token file at
  // ~/.uxie-ghl-internal-mcp/tok.txt" — the default path a caller has no reason to suspect.
  if (legacyTokenFileEnv) {
    throw new AuthError(
      CODES.LEGACY_TOKEN_FILE_ENV,
      'GHL_TOK_FILE is set but GHL_INTERNAL_TOK_FILE is not. GHL_TOK_FILE no longer does '
      + 'anything (renamed in 0.43.0), so this registration would silently fall back to the '
      + 'shared default token file and could authenticate as the wrong account.',
      LEGACY_TOKEN_FILE_REMEDIATION,
    );
  }
  if (!tokenFile || !existsSync(tokenFile)) {
    throw new AuthError(CODES.TOKEN_MISSING, `no token file at ${tokenFile ?? '(unset)'}`,
      'NO CREDENTIAL YET — set one up yourself rather than asking. Invoke the '
      + '`uxie-ghl-factory:internal-connect` skill; it registers this project and captures the token. '
      + 'No restart needed. Then retry the call that failed.');
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
    const c = readCredentials({ tokenFile: state.tokenFile, allowExpired: true, legacyTokenFileEnv: state.legacyTokenFileEnv });
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
      // A COUNT, never the ids: an operator needs to know whether this registration is guarded,
      // not which accounts it may reach.
      allowedLocations: state.allowedLocations ? state.allowedLocations.size : null,
    };
  } catch (e) {
    return {
      tokenFile: state.tokenFile,
      jwtClaims: { present: false },
      error: { code: e.code, detail: e.detail, remediation: e.remediation },
      engine: state.engineVersion ?? 'unknown',
      // A COUNT, never the ids: an operator needs to know whether this registration is guarded,
      // not which accounts it may reach.
      allowedLocations: state.allowedLocations ? state.allowedLocations.size : null,
    };
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
