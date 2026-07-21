// Shared esbuild config for the bundled server, used by BOTH scripts/build.mjs (which
// writes dist/server.mjs) and test/bundle.test.mjs (which rebuilds-and-diffs). Keeping it
// in one place means the committed bundle and the sync-check can never disagree on defines.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const OUTFILE = resolve(ROOT, 'dist/server.mjs');

// Values baked into the bundle at build time, because dist/ ships without a sibling
// package.json or the tool-description catalog:
//   __MCP_VERSION__  — the engine version (auth_status reports it)
//   __HAS_CATALOG__  — presence flag so tools.mjs reads the embedded catalog in the bundle
//                      and falls back to the co-located file in the un-bundled dev entry
//   __TOOL_CATALOG__ — the tool-description catalog, inlined as a JS object literal (raw
//                      JSON is a valid object-literal expression)
export function buildOptions(extra = {}) {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const catalog = readFileSync(resolve(ROOT, 'tool-descriptions.json'), 'utf8');
  return {
    entryPoints: [resolve(ROOT, 'stdio.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: {
      __MCP_VERSION__: JSON.stringify(pkg.version),
      __HAS_CATALOG__: 'true',
      __TOOL_CATALOG__: catalog,
    },
    logLevel: 'warning',
    ...extra,
  };
}
