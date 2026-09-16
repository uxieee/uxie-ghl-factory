// Bundle the stdio entry point + its deps (@modelcontextprotocol/sdk, zod) + the
// tool-description catalog into a single committed file, so the plugin can auto-register it
// and it boots with just node — no `npm install` on the user's machine.
//
//   dist/server.mjs        the server
//
// Config is shared with the dist-sync test (scripts/esbuild-config.mjs), so the committed
// bundle and the sync-check can never disagree on defines or entry points.
import { build } from 'esbuild';
import { buildOptions, OUTFILE } from './esbuild-config.mjs';

await build(buildOptions({ outfile: OUTFILE }));
console.log(`bundled ${OUTFILE}`);
