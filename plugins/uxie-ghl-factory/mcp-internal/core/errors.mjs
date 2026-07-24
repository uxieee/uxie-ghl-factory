// The stable contract every tool returns. Codes are machine-branchable —
// agents key on `code`, humans read `detail`, and `remediation` names the
// next action. Never put a token in any field.

export const CODES = Object.freeze({
  TOKEN_MISSING: 'TOKEN_MISSING',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_ID_MISSING: 'TOKEN_ID_MISSING',
  TOKEN_ID_EXPIRED: 'TOKEN_ID_EXPIRED',
  SSE_EXPECTED: 'SSE_EXPECTED',
  SSE_INCOMPLETE: 'SSE_INCOMPLETE',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
  PREVIEW_STALE: 'PREVIEW_STALE',
  UNRESOLVED_DEPS: 'UNRESOLVED_DEPS',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  ENGINE_ABORT: 'ENGINE_ABORT',

  // Audit-rail policy codes. They are separate from the codes above because an
  // audit caller must be able to tell "the account refused me" (RATE_LIMITED,
  // TOKEN_EXPIRED) apart from "my own request was never allowed to leave" — the
  // latter is a policy bug to fix, never a reason to retry or to report a
  // successful-but-empty read.
  UNKNOWN_CAPABILITY: 'UNKNOWN_CAPABILITY',
  UNKNOWN_CAPABILITY_HOST: 'UNKNOWN_CAPABILITY_HOST',
  AMBIGUOUS_CAPABILITY: 'AMBIGUOUS_CAPABILITY',
  CAPABILITY_TRACE_MISMATCH: 'CAPABILITY_TRACE_MISMATCH',
  UNAPPROVED_METHOD: 'UNAPPROVED_METHOD',
  ABSOLUTE_PATH_REJECTED: 'ABSOLUTE_PATH_REJECTED',
  MISSING_PATH_BINDING: 'MISSING_PATH_BINDING',
  INVALID_PATH_BINDING: 'INVALID_PATH_BINDING',
  UNKNOWN_QUERY_KEY: 'UNKNOWN_QUERY_KEY',
  MISSING_QUERY_KEY: 'MISSING_QUERY_KEY',
  DUPLICATE_QUERY_KEY: 'DUPLICATE_QUERY_KEY',
  FIXED_QUERY_VALUE_MISMATCH: 'FIXED_QUERY_VALUE_MISMATCH',
  DISALLOWED_QUERY_VALUE: 'DISALLOWED_QUERY_VALUE',
  QUERY_BOUND_VIOLATION: 'QUERY_BOUND_VIOLATION',
  BINDING_MISMATCH: 'BINDING_MISMATCH',
  LOCATION_BINDING_MISMATCH: 'LOCATION_BINDING_MISMATCH',
  LOCATION_RATE_LIMITED: 'LOCATION_RATE_LIMITED',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  // The audit circuit is SCOPED ('process' plus one scope per credential rail), so a
  // mistyped scope must be loud: silently accepting it would register a latch nothing
  // ever checks, and the run would sail on through a dead credential.
  INVALID_CIRCUIT_SCOPE: 'INVALID_CIRCUIT_SCOPE',

  // Construction-time audit-rail faults. They are separate from the request-time
  // codes above because they mean the PROCESS is wired wrong: no request could
  // ever have been legal, so there is nothing to checkpoint and resume.
  AUDIT_RAIL_MISMATCH: 'AUDIT_RAIL_MISMATCH',
  MISSING_AUTH_RAIL: 'MISSING_AUTH_RAIL',
  INVALID_AUDIT_LOCATION: 'INVALID_AUDIT_LOCATION',

  // Response-side fail-closed classes. Each one exists so an unusable response is
  // recorded as its own kind of failure rather than collapsing into "empty read":
  // a challenge page, an identity conflict, a rejected credential, and a transport
  // fault demand four different operator responses.
  INVALID_RESPONSE_BODY: 'INVALID_RESPONSE_BODY',
  IDENTITY_CONFLICT: 'IDENTITY_CONFLICT',
  AUTH_REJECTED: 'AUTH_REJECTED',
  TRANSPORT_FAILED: 'TRANSPORT_FAILED',

  // Identity-inspection INCOMPLETENESS classes. A conflict (above) says "this response
  // provably belongs to someone else"; these three say "I could not prove it belongs to
  // me", which is a different operator action but the SAME verdict: not a read.
  //
  // They exist as separate codes because the audit rail's whole value is the distinction
  // between "checked and clean" and "not checked". Collapsing them into one code, or into
  // a silent pass, is how a bounded walker turns an unverified page into evidence.
  IDENTITY_INSPECTION_CAPPED: 'IDENTITY_INSPECTION_CAPPED',   // record budget exhausted
  IDENTITY_DEPTH_CAPPED: 'IDENTITY_DEPTH_CAPPED',             // walk refused to descend further
  IDENTITY_UNREADABLE: 'IDENTITY_UNREADABLE',                 // identity field carried a shape we cannot compare
  // A response object that THROWS while being inspected (a getter, a hostile proxy).
  // Without this the throw escaped callCapability uncoded, so a caller branching on
  // `.code` saw a generic Error and could not tell it apart from a bug in its own handler.
  IDENTITY_INSPECTION_FAILED: 'IDENTITY_INSPECTION_FAILED',
});

const TOKENISH = /\bey[A-Za-z0-9._-]{20,}/g;
const TOKENISH_SCAN = /\bey[A-Za-z0-9._-]{20,}/;
const SECRET_LABEL = '(?:token(?:[-_ ]?id)?|(?:access|refresh|auth|id|oauth|csrf|xsrf)[-_ ]?token|authorization|proxy[-_ ]?authorization|jwt|api[-_ ]?(?:key|secret)|client[-_ ]?secret|secret[-_ ]?access[-_ ]?key|access[-_ ]?key|private[-_ ]?key|signing[-_ ]?key|password|credentials?|cookies?|set[-_ ]?cookie|session(?:[-_ ]?(?:id|token|key|secret|cookie|credentials?))?)';
const LABELED_SECRET = new RegExp(`\\b(${SECRET_LABEL})\\s*([:=/])\\s*(?:Bearer\\s+)?([^\\s,;&#/]+)`, 'gi');
const LABELED_SECRET_SCAN = new RegExp(`\\b${SECRET_LABEL}\\s*[:=/]\\s*(?:Bearer\\s+)?[^\\s,;&#/]+`, 'i');
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._-]{8,}/gi;
const BEARER_SECRET_SCAN = /\bBearer\s+[A-Za-z0-9._-]{8,}/i;
const SECRET_KEYS = new Set([
  'token', 'tokenid', 'accesstoken', 'refreshtoken', 'authtoken', 'idtoken', 'oauthtoken',
  'csrftoken', 'xsrftoken', 'authorization', 'proxyauthorization', 'jwt', 'bearer',
  'apikey', 'apisecret', 'clientsecret', 'secretaccesskey', 'accesskey', 'privatekey',
  'signingkey', 'password', 'credential', 'credentials', 'cookie', 'cookies', 'setcookie',
  'session', 'sessionid', 'sessiontoken', 'sessionkey', 'sessionsecret', 'sessioncookie',
  'sessioncredential', 'sessioncredentials',
]);
const isSecretKey = (key) => SECRET_KEYS.has(String(key).replace(/[-_\s]/g, '').toLowerCase());

const scrub = (s) => {
  if (s == null) return s;
  const text = String(s);
  try {
    const structured = JSON.parse(text);
    if (structured && typeof structured === 'object') return JSON.stringify(scrubSecrets(structured));
  } catch {
    // Non-JSON error text is handled by the credential-pattern scrub below.
  }
  return text
    .replace(TOKENISH, '<redacted>')
    .replace(LABELED_SECRET, (_match, label, separator) => `${label}${separator} <redacted>`)
    .replace(BEARER_SECRET, 'Bearer <redacted>');
};

export function containsSecrets(value, key = '') {
  if (isSecretKey(key)) return true;
  if (value == null) return false;
  if (typeof value === 'string') {
    return TOKENISH_SCAN.test(value) || LABELED_SECRET_SCAN.test(value) || BEARER_SECRET_SCAN.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsSecrets(item, key));
  if (typeof value === 'object') {
    return Object.entries(value).some(([childKey, item]) => (
      containsSecrets(childKey) || containsSecrets(item, childKey)
    ));
  }
  return false;
}

// Tool results are JSON-shaped, so scrub recursively at the contract boundary.
// This covers a read endpoint unexpectedly returning a credential as well as
// errors echoing one. A token must never reach the MCP transcript either way.
export function scrubSecrets(value) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      scrub(key),
      // Deliberately scrubs the WHOLE subtree under a secret-named key, not just
      // primitives. A nested credential need not be JWT-shaped (`{credentials:{value:
      // "sk_live_…"}}`), so recursing would leak it. Callers wanting to expose metadata
      // ABOUT a credential must name the field something that is not itself a credential
      // name — see authStatus's `jwtClaims` / `tokenIdClaims`.
      isSecretKey(key) ? '<redacted>' : scrubSecrets(item),
    ]));
  }
  return value;
}

export const ok = (data) => ({ ok: true, data: scrubSecrets(data) });
export const fail = (code, detail, remediation) => ({
  ok: false,
  code,
  detail: scrub(detail),
  remediation: scrub(remediation),
});

export function fromHttp(status, body) {
  const detail = typeof body === 'string' ? body : JSON.stringify(scrubSecrets(body ?? {}));
  if (status === 401 || status === 403) {
    return fail(CODES.TOKEN_EXPIRED, detail,
      'Token rejected. Re-capture the JWT with the get-ghl-workflow-json skill capture runbook, then retry.');
  }
  if (status === 409) return fail(CODES.VERSION_CONFLICT, detail, 'Re-read the workflow to get the current version, then retry.');
  if (status === 422) return fail(CODES.VALIDATION_FAILED, detail, 'Server rejected the payload — check required fields per docs/08-validators.md.');
  if (status === 429) return fail(CODES.RATE_LIMITED, detail, 'Slow down and retry after a pause.');
  return fail(`HTTP_${status}`, detail, 'Unexpected upstream status — inspect detail.');
}
