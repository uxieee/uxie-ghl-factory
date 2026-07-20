// SERVER:scripts/gen-manifest.mjs — emit the exact {tool,method,path} triples
// the docs repo's coverage checker verifies against the capability matrix.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const entries = TOOLS.flatMap((t) => t.capabilities.map((c) => ({ tool: t.name, method: c.method, path: c.path })));
writeFileSync(resolve(HERE, '../capability-manifest.json'), JSON.stringify(entries, null, 2) + '\n');
console.log(`capability-manifest: ${entries.length} entries`);
