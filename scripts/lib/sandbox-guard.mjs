// The sandbox guard for live-proof harnesses: a call may name the sandbox, and ONLY the sandbox, in `locationId` AND in every
// field that names a RECEIVER of the write. A push/copy tool queues any receiver id it is given (push_snapshot did, until its
// own target check), so a guard that looks at `locationId` alone lets a mistyped client id through.
//
// 🔴 The sandbox id is never written in this repo (it is public): callers pass it in from the environment.

/** Fields that name where a write LANDS, as opposed to where the call is scoped. Extend when a tool adds one. */
export const RECEIVER_FIELDS = ['targetLocationIds', 'targetLocationId', 'destinationLocationId', 'toLocationId'];

/** Env var names that carry a receiver (e.g. GHL_TARGET_LOCATION, GHL_DESTINATION_LOCATION_IDS). */
export const RECEIVER_ENV = /(TARGET|DESTINATION|RECEIVER|TO)_?LOCATION|LOCATION_?(TARGET|DEST|IDS?_TO)/i;

const ids = (v) => (v === undefined || v === null ? [] : [].concat(v).filter((x) => x !== undefined && x !== null && x !== ''));

/** Every reason `args` is not sandbox-only. Empty = fine. */
export function receiverViolations(args, sandbox) {
  if (!sandbox) return ['no sandbox id was supplied, so nothing can be checked — refuse'];
  const out = [];
  for (const id of ids(args?.locationId)) if (id !== sandbox) out.push('locationId');
  for (const field of RECEIVER_FIELDS) for (const id of ids(args?.[field])) if (id !== sandbox) out.push(field);
  return [...new Set(out)];
}

/** Throws when `args` names anything but the sandbox. */
export function assertSandboxOnly(args, sandbox) {
  const bad = receiverViolations(args, sandbox);
  if (bad.length) throw new Error(`refusing: ${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} not the sandbox`);
}

/** Env vars that name a receiver other than the sandbox — a runner refuses to start with one set. */
export function receiverEnvViolations(env, sandbox) {
  return Object.entries(env ?? {})
    .filter(([k, v]) => RECEIVER_ENV.test(k) && v && ids(String(v).split(',').map((s) => s.trim())).some((x) => x !== sandbox))
    .map(([k]) => k);
}
