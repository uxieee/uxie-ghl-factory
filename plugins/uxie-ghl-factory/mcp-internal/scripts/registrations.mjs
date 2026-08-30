// SERVER:scripts/registrations.mjs — owns ~/.claude.json for the internal rail.
//
// Two rules here are load-bearing, both learned by breaking them:
//
// 1. EXACT PATH MATCH. ~/.claude.json still holds project entries under this machine's OLD paths
//    (/Users/<user>/Documents/...) alongside the live ones. The stale entries carry no mcpServers,
//    and they sort FIRST, so `keys.find(k => k.endsWith(suffix))` returns the server-less twin and
//    reports "not registered" for a folder that plainly is.
// 2. ADDITIVE WRITES. `claude mcp add` rewrites the whole server entry, so any env var not on that
//    command line is dropped -- which is how a credential update silently erases a location binding.
//    Everything here mutates one key at a time and leaves siblings alone.
import { readFileSync } from 'node:fs';

export const readConfig = (path) => JSON.parse(readFileSync(path, 'utf8'));

// Exact key only. See rule 1 above.
export function findRegistration(cfg, folder, server) {
  const srv = cfg?.projects?.[folder]?.mcpServers?.[server];
  return srv ?? null;
}

export function listRegistrations(cfg) {
  const out = [];
  for (const [folder, project] of Object.entries(cfg?.projects ?? {})) {
    for (const [server, srv] of Object.entries(project?.mcpServers ?? {})) {
      if (!server.startsWith('uxie-ghl-internal-mcp')) continue;
      const env = srv?.env ?? {};
      out.push({
        folder,
        server,
        tokenFile: env.GHL_INTERNAL_TOK_FILE ?? null,
        locationsRaw: env.GHL_INTERNAL_LOCATIONS ?? null,
        // A legacy name WITHOUT its new counterpart is what 0.43.0's migration guards refuse.
        legacyTokenFile: Boolean(env.GHL_TOK_FILE) && !env.GHL_INTERNAL_TOK_FILE,
        legacyLocations: Boolean(env.GHL_LOCATIONS) && !env.GHL_INTERNAL_LOCATIONS,
      });
    }
  }
  return out;
}

export function setEnv(cfg, folder, server, patch) {
  const srv = findRegistration(cfg, folder, server);
  if (!srv) throw new Error(`${folder} is not registered for ${server}`);
  srv.env = srv.env ?? {};
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (srv.env[k] === v) continue;
    srv.env[k] = v;
    changed.push(k);
  }
  return { changed };
}

export const backupPath = (configPath, now = new Date()) =>
  `${configPath}.bak-${now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')}`;
