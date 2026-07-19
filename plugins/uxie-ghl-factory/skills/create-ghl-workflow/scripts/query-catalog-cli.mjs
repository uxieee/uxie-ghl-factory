#!/usr/bin/env node
// CLI wrapper for engine/query-catalog.mjs — the engine itself must stay
// import-only so it can be bundled and imported from the MCP server.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadData, renderMarkdown, summary, searchCatalog, renderCard } from '../engine/query-catalog.mjs';

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const d = loadData();
  const args = process.argv.slice(2);
  if (args[0] === '--md') {
    process.stdout.write(renderMarkdown(d));
  } else if (args.length === 0) {
    console.log(summary(d));
  } else {
    const hits = searchCatalog(d, args.join(' '));
    if (!hits.length) {
      console.log(`no catalog match for "${args.join(' ')}" — try a shorter term. ` +
        'A miss here does NOT prove GHL lacks it: harvest a live example (scripts/harvest-step.js) and extend the catalog.');
    } else if (hits.length > 15) {
      console.log(`${hits.length} matches (showing names — narrow the term for full cards):`);
      for (const e of hits) console.log(`  ${e.kind === 'trigger' ? 'trigger' : 'step   '} ${e.type} (${e.section ?? e.category ?? 'other'})`);
    } else {
      console.log(hits.map(renderCard).join('\n\n'));
    }
  }
}
