#!/usr/bin/env node
// Stable launcher for the uxie-ghl-internal-mcp server.
//
// Per-project MCP configs point at a COPY of this file in a stable home
// (~/.uxie-ghl-internal-mcp/launch.mjs), written by /uxie-ghl-factory:connect — so a plugin
// version update never breaks the path the way pointing straight at the versioned plugin
// cache (…/plugins/cache/uxieee/uxie-ghl-factory/<version>/…) would. At launch it resolves
// the NEWEST installed plugin build and runs its bundled server, inheriting env (GHL_TOK_FILE)
// from the project config. Result: per-project config + token, but always the latest server.
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CACHE = join(homedir(), '.claude', 'plugins', 'cache', 'uxieee', 'uxie-ghl-factory');

const semverDesc = (a, b) => {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
};

let versions = [];
try { versions = readdirSync(CACHE).filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort(semverDesc); } catch { /* no plugin */ }
const server = versions
  .map((v) => join(CACHE, v, 'mcp-internal', 'dist', 'server.mjs'))
  .find((p) => existsSync(p));

if (!server) {
  process.stderr.write(
    `uxie-ghl-internal-mcp: no installed plugin build found under ${CACHE}. ` +
    `Install/enable the uxie-ghl-factory plugin, then re-run /uxie-ghl-factory:connect.\n`,
  );
  process.exit(1);
}

await import(pathToFileURL(server).href);
