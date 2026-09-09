// Which build is this process actually running?
//
// The server is registered USER-SCOPED in ~/.claude.json and launched from a stable shim
// (~/.uxie-ghl-internal-mcp/launch.mjs) that resolves the NEWEST installed plugin build at launch
// time and runs its bundled dist. That is correct when it starts and frozen for the life of the
// process: `claude plugin update` writes a new build beside the old one, `/reload-plugins` does not
// restart a user-scoped server, and nothing anywhere says the running code is now behind.
//
// The cost is not theoretical. A peer session spent a matrix run concluding that guards were absent
// from a build that in fact carried them, and this project hit the same class twice in one day —
// an operator console serving a stale build of itself, and hand-written proof dates that no longer
// described the code they were attached to. In all three the failure is identical: a long-running
// thing reporting a freshness it does not have.
//
// So the server states its own provenance, and says plainly when it is behind. This is read-only,
// costs one directory listing at startup, and never guesses: an unreadable cache reports `null`
// rather than "current".
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

const CACHE = join(homedir(), '.claude', 'plugins', 'cache', 'uxieee', 'uxie-ghl-factory');
const SEMVER = /^\d+\.\d+\.\d+$/;

const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
};

/** The version directory this module was loaded from, or null when it is not running from a cache build. */
export function runningVersion(fromUrl) {
  const parts = String(fromUrl ?? import.meta.url).split(sep.length ? /[/\\]/ : '/');
  const i = parts.lastIndexOf('uxie-ghl-factory');
  const v = i >= 0 ? parts[i + 1] : null;
  return v && SEMVER.test(v) ? v : null;
}

/** The newest build installed on this machine, or null when the cache cannot be read. */
export function newestInstalled() {
  try {
    if (!existsSync(CACHE)) return null;
    const vs = readdirSync(CACHE).filter((d) => SEMVER.test(d)).sort(cmp);
    return vs[0] ?? null;
  } catch { return null; }
}

/**
 * `{ running, newest, stale, note }`. `stale` is only ever true when BOTH versions are known and
 * differ — an unknown on either side is reported as unknown, never as current, because "I could
 * not look" and "it is fine" are the two answers this must never conflate.
 */
export function buildProvenance(fromUrl) {
  const running = runningVersion(fromUrl);
  const newest = newestInstalled();
  const stale = running !== null && newest !== null && running !== newest;
  let note;
  if (stale) {
    note = `This server is running ${running} but ${newest} is installed. A user-scoped MCP server resolves its `
      + `build at LAUNCH, and /reload-plugins does not restart it — restart the session to pick up ${newest}. `
      + `Until then, a fix you believe you installed is not in this process.`;
  } else if (running === null) {
    note = 'Running from a source tree or an unrecognised path rather than an installed plugin build, so there is '
      + 'no version to compare. Expected when running the engine directly from the repo.';
  } else if (newest === null) {
    note = 'The plugin cache could not be read, so staleness is UNKNOWN — not confirmed current.';
  }
  return { running, newest, stale, ...(note ? { note } : {}) };
}
