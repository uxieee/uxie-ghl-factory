// A per-project snapshot of the last workflow READ, so a write can tell whether the graph moved
// underneath the agent that authored it.
//
// The stale-read window is real and silent: an agent exports a workflow, reasons about it, and
// commits ops minutes later against a document someone else has since edited. Nothing in the API
// notices — the PUT carries the whole templates array, so the other edit is simply gone.
//
// The cache lives beside the token, in the project's own `.ghl/` seam, because it is per-project
// state about a per-project account. It is a CONVENIENCE, never a source of truth: every read and
// write is wrapped, and any failure degrades to "no cache" rather than to an error.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// Never persist anything that looks like a credential. The cache holds live workflow bodies, and
// a webhook step's headers can carry a bearer token.
const JWT = /\b(?:Bearer\s+)?ey[A-Za-z0-9._-]{20,}/g;
export function scrubUpstream(value) {
  if (typeof value === 'string') return value.replace(JWT, '<redacted>');
  if (Array.isArray(value)) return value.map(scrubUpstream);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubUpstream(v);
    return out;
  }
  return value;
}

export function readCache(state) {
  const enabled = process.env.GHL_READ_CACHE !== '0';
  const root = state?.tokenFile ? dirname(state.tokenFile) : join(homedir(), '.uxie-ghl-internal-mcp', 'cache');
  const pathFor = (locationId, workflowId) =>
    join(root, String(locationId), 'workflows', String(workflowId), 'last-read.json');

  return {
    enabled,
    read(locationId, workflowId) {
      try {
        if (!enabled || !locationId || !workflowId) return null;
        const p = pathFor(locationId, workflowId);
        return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
      } catch { return null; }
    },
    write(locationId, workflowId, snapshot) {
      try {
        if (!enabled || !locationId || !workflowId || !snapshot) return false;
        const p = pathFor(locationId, workflowId);
        mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
        writeFileSync(p, JSON.stringify(scrubUpstream(snapshot), null, 1), { mode: 0o600 });
        return true;
      } catch { return false; }
    },
    pathFor,
  };
}
