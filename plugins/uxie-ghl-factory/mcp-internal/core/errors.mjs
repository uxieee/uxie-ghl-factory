// The stable contract every tool returns. Codes are machine-branchable —
// agents key on `code`, humans read `detail`, and `remediation` names the
// next action. Never put a token in any field.

export const CODES = Object.freeze({
  TOKEN_MISSING: 'TOKEN_MISSING',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_ID_MISSING: 'TOKEN_ID_MISSING',
  TOKEN_ID_EXPIRED: 'TOKEN_ID_EXPIRED',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
  PREVIEW_STALE: 'PREVIEW_STALE',
  UNRESOLVED_DEPS: 'UNRESOLVED_DEPS',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  ENGINE_ABORT: 'ENGINE_ABORT',
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
