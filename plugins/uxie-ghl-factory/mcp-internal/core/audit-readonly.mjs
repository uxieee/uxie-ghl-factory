// The audit process's SECOND lock.
//
// The first lock is the registry filter: `toolsForProfile('audit')` decides which tools the
// audit server publishes. That lock is real — the committed bundle lists exactly six tools —
// but it is the ONLY one, and it is a filter over a registry rather than a property of the
// artefact. `dist/audit-server.mjs` still CONTAINS every write handler as unreachable code,
// because `core/tools.mjs` declares all of them in one array literal and esbuild has nothing
// to tree-shake. The audit bundle is in fact slightly LARGER than the full server.
//
// So this lock sits underneath every tool instead of beside them: whatever the registry
// publishes, and whatever a future refactor does to it, nothing but a GET to an approved
// audit origin can leave the process. It is deliberately independent of the descriptor
// policy in audit-capabilities.mjs — a second lock that shared the first one's reasoning
// would fail in the same way at the same time.
import { CODES, scrubSecrets } from './errors.mjs';
import { AUDIT_HOSTS } from './audit-capabilities.mjs';

export function auditError(code, detail, remediation) {
  const safeDetail = scrubSecrets(String(detail));
  const error = new Error(`${code}: ${safeDetail}`);
  error.code = code;
  error.detail = safeDetail;
  error.remediation = scrubSecrets(String(remediation));
  return error;
}

const APPROVED_ORIGINS = Object.freeze(Object.values(AUDIT_HOSTS));

// The base an audit read may target. Checked here as well as in the gateway policy because
// this wrapper's whole job is to be the lock that still holds when the other one is wrong.
const originOf = (baseOrOptions) => {
  const base = typeof baseOrOptions === 'string' ? baseOrOptions : baseOrOptions?.base;
  if (base === undefined) return null;
  try { return new URL(base).origin; } catch { return String(base); }
};

const blocked = (what, detail) => auditError(
  CODES.AUDIT_WRITE_BLOCKED,
  detail,
  `The audit profile is structurally read-only. Use the full server for ${what}.`,
);

// Wrap a gateway so only GETs to an approved audit origin can be issued. Every other
// property is passed through unchanged — `rail` in particular, which makeAuditGateway reads
// at construction to refuse a swapped rail map.
export function readOnlyGateway(gateway) {
  const guard = (name, fn) => (method, path, body, baseOrOptions) => {
    if (method !== 'GET') {
      return Promise.reject(blocked('any write', `${name} was called with ${String(method)} on the audit rail`));
    }
    // A body on a GET is not a write by itself, but nothing on this rail has a reason to
    // send one, and accepting it would leave a shape a future bug could smuggle through.
    if (body !== undefined) {
      return Promise.reject(blocked('any request carrying a body', `${name} was given a request body on the audit rail`));
    }
    const origin = originOf(baseOrOptions);
    if (origin !== null && !APPROVED_ORIGINS.includes(origin)) {
      return Promise.reject(blocked('any other host', `${name} was pointed at an origin outside the audit hosts`));
    }
    return fn(method, path, body, baseOrOptions);
  };
  return {
    ...gateway,
    call: guard('call', (...args) => gateway.call(...args)),
    callWithMeta: guard('callWithMeta', (...args) => gateway.callWithMeta(...args)),
    // SSE is a build channel on this codebase (Agent Studio), never a read. There is no
    // GET-shaped legitimate use of it on the audit rail, so it is refused outright.
    stream: () => Promise.reject(blocked('a streaming build', 'stream is not available on the audit rail')),
  };
}
