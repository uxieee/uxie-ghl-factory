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
const scrub = (s) => String(s).replace(TOKENISH, '<redacted>');

export const ok = (data) => ({ ok: true, data });
export const fail = (code, detail, remediation) => ({ ok: false, code, detail: scrub(detail), remediation });

export function fromHttp(status, body) {
  const detail = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  if (status === 401 || status === 403) {
    return fail(CODES.TOKEN_EXPIRED, detail,
      'Token rejected. Re-capture the JWT with the get-ghl-workflow-json skill capture runbook, then retry.');
  }
  if (status === 409) return fail(CODES.VERSION_CONFLICT, detail, 'Re-read the workflow to get the current version, then retry.');
  if (status === 422) return fail(CODES.VALIDATION_FAILED, detail, 'Server rejected the payload — check required fields per docs/08-validators.md.');
  if (status === 429) return fail(CODES.RATE_LIMITED, detail, 'Slow down and retry after a pause.');
  return fail(`HTTP_${status}`, detail, 'Unexpected upstream status — inspect detail.');
}
