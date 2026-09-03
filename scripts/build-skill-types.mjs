#!/usr/bin/env node
// The ghl-system-conventions skill ships its own copy of the type catalogue so it works
// STANDALONE (npx skills add …) with no plugin and no MCP:
//
//   skills/create-ghl-workflow/catalog/type-cards.json   (the corpus, compiled — already shipped)
//     → skills/ghl-system-conventions/catalog/type-cards.json         byte-for-byte copy
//     → skills/ghl-system-conventions/references/ghl-types-index.md   rendered index
//
// Run by scripts/sync-generated.mjs; checked by scripts/check-generated-freshness.mjs
// (`--only skill-types`), which runs this with --out-dir into a temp dir and diffs.
//
//   node scripts/build-skill-types.mjs                    # write into the skill
//   node scripts/build-skill-types.mjs --out-dir <dir>    # write <dir>/type-cards.json + <dir>/ghl-types-index.md
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const pluginRootArg = args.indexOf('--plugin-root');
const PLUGIN = resolve(pluginRootArg >= 0 ? args[pluginRootArg + 1] : join(REPO, 'plugins/uxie-ghl-factory'));
const SOURCE = join(PLUGIN, 'skills/create-ghl-workflow/catalog/type-cards.json');
const SKILL = join(PLUGIN, 'skills/ghl-system-conventions');
const outArg = args.indexOf('--out-dir');
const outDir = outArg >= 0 ? resolve(args[outArg + 1]) : null;

const cardsOut = outDir ? join(outDir, 'type-cards.json') : join(SKILL, 'catalog/type-cards.json');
const indexOut = outDir ? join(outDir, 'ghl-types-index.md') : join(SKILL, 'references/ghl-types-index.md');
mkdirSync(join(cardsOut, '..'), { recursive: true });
mkdirSync(join(indexOut, '..'), { recursive: true });

copyFileSync(SOURCE, cardsOut);
const { loadCards, renderIndex } = await import(pathToFileURL(join(SKILL, 'scripts/types.mjs')).href);
const cards = loadCards(cardsOut);
writeFileSync(indexOut, renderIndex(cards));

const count = JSON.parse(readFileSync(cardsOut, 'utf8')).count;
console.log(`skill-types: ${count} cards copied, index rendered (${cards.length} types) → ${outDir ?? 'skills/ghl-system-conventions'}`);
