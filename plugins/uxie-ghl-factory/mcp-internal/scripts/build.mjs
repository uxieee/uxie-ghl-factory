// Bundle the stdio server + its deps (@modelcontextprotocol/sdk, zod) + the tool-description
// catalog into a single committed dist/server.mjs so the plugin can auto-register it and it
// boots with just node — no `npm install` on the user's machine. Config is shared with the
// dist-sync test (scripts/esbuild-config.mjs).
import { build } from 'esbuild';
import { buildOptions, OUTFILE } from './esbuild-config.mjs';

await build(buildOptions({ outfile: OUTFILE }));
console.log(`bundled ${OUTFILE}`);
