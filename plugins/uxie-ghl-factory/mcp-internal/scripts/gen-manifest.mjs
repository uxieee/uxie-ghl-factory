// SERVER:scripts/gen-manifest.mjs — emits capability-manifest.json: the exact {tool,method,path}
// triples the docs repo's coverage checker verifies against the capability matrix.
//
// It is COMPILED FROM source (`TOOLS`) and never read back the other way. A manifest that could
// redefine policy would let a checked-in file widen the served surface with no test and no
// descriptor change.
//
// Until 2026-09-16 this also emitted audit-capability-manifest.json, the second server's policy
// manifest. That server is gone; the descriptors it policed live on in core/audit-capabilities.mjs,
// which the MAIN server's composite reads still use through makeAuditGateway.
//
// Importing this module has NO side effect. It used to write on import, which meant a test that
// merely inspected the generator rewrote a committed artefact as a side effect.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const MANIFEST_PATH = resolve(ROOT, 'capability-manifest.json');

export function buildCapabilityManifest(tools = TOOLS) {
  return tools.flatMap((t) => t.capabilities.map((c) => ({ tool: t.name, method: c.method, path: c.path })));
}

// Only write when run directly. `npm run manifest` regenerates the artefact; importing this
// module for inspection must never touch a committed file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = buildCapabilityManifest();
  writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2) + '\n');
  console.log(`capability-manifest: ${entries.length} entries`);
}
