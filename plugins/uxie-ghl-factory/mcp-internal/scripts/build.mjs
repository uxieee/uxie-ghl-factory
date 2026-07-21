// Bundle the stdio server + its two deps (@modelcontextprotocol/sdk, zod) into a single
// committed dist/server.mjs so the plugin can auto-register it and it boots with just node —
// no `npm install` on the user's machine. The version is injected via --define so the bundle
// carries it without reading a sibling package.json (which doesn't exist in dist/).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = resolve(HERE, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

await build({
  entryPoints: [resolve(root, 'stdio.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: resolve(root, 'dist/server.mjs'),
  define: { __MCP_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
});

console.log(`bundled dist/server.mjs @ ${pkg.version}`);
