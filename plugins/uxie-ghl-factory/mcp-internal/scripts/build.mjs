// Bundle each stdio entry point + its deps (@modelcontextprotocol/sdk, zod) + the
// tool-description catalog into a single committed file, so the plugin can auto-register it
// and it boots with just node — no `npm install` on the user's machine.
//
//   dist/server.mjs        the full server
//   dist/audit-server.mjs  the structurally read-only audit profile
//
// Config is shared with the dist-sync tests (scripts/esbuild-config.mjs), so the committed
// bundles and the sync-checks can never disagree on defines or entry points.
import { build } from 'esbuild';
import { auditBuildOptions, AUDIT_OUTFILE, buildOptions, OUTFILE } from './esbuild-config.mjs';

await build(buildOptions({ outfile: OUTFILE }));
console.log(`bundled ${OUTFILE}`);

await build(auditBuildOptions({ outfile: AUDIT_OUTFILE }));
console.log(`bundled ${AUDIT_OUTFILE}`);
