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
  // Authenticated fine, but the server refused the operation — a business rule, not a
  // credential problem. Kept distinct from TOKEN_EXPIRED so an agent does not burn a
  // re-authentication cycle on something re-authenticating cannot fix.
  ACCESS_DENIED: 'ACCESS_DENIED',
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

  // The audit process's SECOND lock. The first is the registry filter, which decides which
  // tools exist; this one decides which HTTP methods can leave, and it sits below every tool
  // rather than beside them. Two independent locks matter because the audit bundle still
  // CONTAINS the write handlers as unreachable code (one TOOLS array literal, nothing for
  // esbuild to tree-shake), so registry filtering alone is a single point of failure.
  AUDIT_WRITE_BLOCKED: 'AUDIT_WRITE_BLOCKED',

  // The audit composite's OWN input fault. It is separate from VALIDATION_FAILED because
  // an audit caller must be able to tell "my window was never legal" apart from any
  // upstream refusal: the log descriptors carry no numeric bounds on fromDate/toDate, so
  // an inverted or malformed window would otherwise reach the wire, return SOMETHING, and
  // have that something recorded as evidence for a window nobody actually asked for.
  INVALID_RUNTIME_WINDOW: 'INVALID_RUNTIME_WINDOW',

  // The account-surface composites' OWN input fault, separate from INVALID_RUNTIME_WINDOW
  // for the same reason that one is separate from VALIDATION_FAILED: a caller must be able
  // to tell "the roster/bundle request I made was never legal" apart from any upstream
  // refusal. A page budget or a location that never bound is a caller-side fix, never a
  // reason to retry and never an empty surface.
  INVALID_AUDIT_CONFIGURATION_INPUT: 'INVALID_AUDIT_CONFIGURATION_INPUT',

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

// A GHL workflow document legitimately carries SIGNED STORAGE URLS: `fileUrl` at the top
// level and `attributes.previewUrl` on email steps. Both end in `?…&token=<uuid>`, which
// LABELED_SECRET reads as a credential — so the guard refused to let raw_request PUT back
// any document it had just GET'd, and scrubSecrets mangled the URLs on the way out. The
// escape hatch could not round-trip, and stripping the fields is a one-way door (once
// `fileUrl` is gone you cannot PUT it back either).
//
// These are storage POINTERS the API itself just handed us, not user secrets, so their
// query params are exempt from the LABELED scan. The exemption is deliberately narrow: it
// covers only the two Google storage hosts, only the labelled-value rule, and NEVER the
// JWT or `Bearer …` rules — a real credential smuggled inside a storage-shaped URL is
// still caught, because a firebase download token is a UUID and never `ey…`-shaped.
const SIGNED_STORAGE_URL = /https:\/\/(?:firebasestorage\.googleapis\.com|storage\.googleapis\.com)\/[^\s"'<>\\,;)]+/g;

// Split `text` into signed-storage-URL runs and everything else, mapping each with its own
// function and re-joining. One walker so the scan and the scrub cannot drift apart.
const partitionStorageUrls = (text, outside, inUrl) => {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(SIGNED_STORAGE_URL)) {
    out += outside(text.slice(last, m.index)) + inUrl(m[0]);
    last = m.index + m[0].length;
  }
  return out + outside(text.slice(last));
};

const hasSecretText = (text) => {
  let found = false;
  partitionStorageUrls(
    text,
    (s) => { if (TOKENISH_SCAN.test(s) || LABELED_SECRET_SCAN.test(s) || BEARER_SECRET_SCAN.test(s)) found = true; return ''; },
    (u) => { if (TOKENISH_SCAN.test(u) || BEARER_SECRET_SCAN.test(u)) found = true; return ''; },
  );
  return found;
};

const scrub = (s) => {
  if (s == null) return s;
  const text = String(s);
  try {
    const structured = JSON.parse(text);
    if (structured && typeof structured === 'object') return JSON.stringify(scrubSecrets(structured));
  } catch {
    // Non-JSON error text is handled by the credential-pattern scrub below.
  }
  const tokenish = (t) => t.replace(TOKENISH, '<redacted>').replace(BEARER_SECRET, 'Bearer <redacted>');
  return partitionStorageUrls(
    text,
    (t) => tokenish(t).replace(LABELED_SECRET, (_match, label, separator) => `${label}${separator} <redacted>`),
    tokenish,
  );
};

export function containsSecrets(value, key = '') {
  if (isSecretKey(key)) return true;
  if (value == null) return false;
  if (typeof value === 'string') return hasSecretText(value);
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
  // 401 and 403 are NOT the same failure and must not share a code. Folding 403 into
  // TOKEN_EXPIRED told the caller to re-authenticate for something re-authenticating
  // cannot fix: a DELETE on an agent-type workflow came back
  //   403 {"error":true,"msg":"Workflows with type \"agent\" cannot be deleted"}
  // and was reported as an expired token, on a JWT that was demonstrably valid (the very
  // next call succeeded). Live-verified on AU 2026-07-27, with a bad-token control on the
  // same endpoint returning 401 "Unauthorized" — so the two are cleanly separable by status.
  if (status === 401) {
    return fail(CODES.TOKEN_EXPIRED, detail,
      // Same phrasing discipline as core/auth.mjs: aimed at the agent, and bounded to one attempt.
      // This one also used to point at a capture runbook inside a read skill, which is a longer
      // road to the same place than the connect skill the agent can just invoke.
      'EXPIRED CREDENTIAL — RE-CAPTURE IT YOURSELF, do not ask and do not stop. Invoke the '
      + '`uxie-ghl-factory:internal-connect` skill, then retry this exact call. The server re-reads '
      + 'the token file every call, so nothing restarts. ONE re-capture per failure: if the retry '
      + 'fails the same way, stop and report it.');
  }
  if (status === 403) {
    return fail(CODES.ACCESS_DENIED, detail,
      'Authenticated, but the server refused this operation — a permission or business rule, '
      + 'NOT an expired token. Re-capturing the JWT will not help; read `detail` for the reason.');
  }
  if (status === 409) return fail(CODES.VERSION_CONFLICT, detail, 'Re-read the workflow to get the current version, then retry.');
  if (status === 422) return fail(CODES.VALIDATION_FAILED, detail, 'Server rejected the payload — check required fields per docs/08-validators.md.');
  if (status === 429) return fail(CODES.RATE_LIMITED, detail, 'Slow down and retry after a pause.');
  return fail(`HTTP_${status}`, detail, 'Unexpected upstream status — inspect detail.');
}
