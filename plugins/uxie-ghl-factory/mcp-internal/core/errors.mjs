// The stable contract every tool returns. Codes are machine-branchable —
// agents key on `code`, humans read `detail`, and `remediation` names the
// next action. Never put a token in any field.

export const CODES = Object.freeze({
  TOKEN_MISSING: 'TOKEN_MISSING',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
  UNRESOLVED_DEPS: 'UNRESOLVED_DEPS',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  ENGINE_ABORT: 'ENGINE_ABORT',
});

const TOKENISH = /\bey[A-Za-z0-9._-]{20,}/g;
const TOKENISH_SCAN = /\bey[A-Za-z0-9._-]{20,}/;
const LABELED_SECRET = /\b(token[-_ ]?id|access[-_ ]?token|authorization|jwt|api[-_ ]?key|client[-_ ]?secret|password|credentials?)\s*([:=])\s*(?:Bearer\s+)?([^\s,;]+)/gi;
const LABELED_SECRET_SCAN = /\b(?:token[-_ ]?id|access[-_ ]?token|authorization|jwt|api[-_ ]?key|client[-_ ]?secret|password|credentials?)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/i;
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._-]{8,}/gi;
const BEARER_SECRET_SCAN = /\bBearer\s+[A-Za-z0-9._-]{8,}/i;
const SECRET_KEY = /^(?:token[-_ ]?id|access[-_ ]?token|authorization|jwt|bearer|api[-_ ]?key|client[-_ ]?secret|password|credentials?)$/i;

const scrub = (s) => s == null ? s : String(s)
  .replace(TOKENISH, '<redacted>')
  .replace(LABELED_SECRET, (_match, label, separator) => `${label}${separator} <redacted>`)
  .replace(BEARER_SECRET, 'Bearer <redacted>');

export function containsSecrets(value, key = '') {
  if (value == null) return false;
  if (typeof value !== 'object' && SECRET_KEY.test(key)) return true;
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
      item != null && typeof item !== 'object' && SECRET_KEY.test(key) ? '<redacted>' : scrubSecrets(item),
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
