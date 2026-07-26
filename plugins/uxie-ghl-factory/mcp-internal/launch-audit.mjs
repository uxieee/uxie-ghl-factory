#!/usr/bin/env node
// Stable launcher for the AUDIT-ONLY uxie-ghl-internal-mcp server.
//
// The read-only sibling of launch.mjs, and deliberately a SEPARATE FILE rather than a flag
// on that one. A flag would have to default to something, and both defaults are wrong: an
// audit-by-default launcher silently narrows the full server, while a full-by-default
// launcher hands an operator who mistyped the flag every write tool in the registry while
// they believe they are read-only. That second failure is the one this whole profile exists
// to prevent, so the two launchers are two paths and neither can decay into the other.
//
// It is copied to a stable home the same way launch.mjs is (see commands/connect.md), so a
// plugin version update never breaks the path a project's MCP config points at. That copy is
// standalone — nothing resolves relative to the plugin tree at runtime — which is why the
// resolution logic below is duplicated from launch.mjs rather than imported from it. The
// duplication is a property of the deployment model, not an oversight.
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

// ONLY the audit bundle, and NO FALLBACK. If an installed build predates the audit profile
// its dist/ has no audit-server.mjs, and the tempting repair — fall back to the full bundle
// so the launch "works" — would start the entire registry, writes included, for a caller who
// asked for the read-only one and has no way to tell from the outside. A launch that cannot
// be read-only must not launch.
//
// The full bundle's filename is deliberately not written anywhere in this file, not even in
// prose: test/launchers.test.mjs asserts its absence, so reintroducing a fallback means
// reintroducing the name, and that fails before anyone has to reason about control flow.
const server = versions
  .map((v) => join(CACHE, v, 'mcp-internal', 'dist', 'audit-server.mjs'))
  .find((p) => existsSync(p));

if (!server) {
  const installed = versions.length ? versions.join(', ') : 'none';
  process.stderr.write(
    `uxie-ghl-internal-mcp (audit): no installed plugin build carries mcp-internal/dist/audit-server.mjs under ${CACHE}. ` +
    `Installed versions: ${installed}. ` +
    `Update the uxie-ghl-factory plugin to a build that ships the audit profile, then re-run /uxie-ghl-factory:connect. ` +
    `This launcher will NOT fall back to the full read-write server.\n`,
  );
  process.exit(1);
}

await import(pathToFileURL(server).href);
