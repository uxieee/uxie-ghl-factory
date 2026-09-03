#!/usr/bin/env node
// The GHL type catalogue, readable without the plugin.
//
//   node scripts/types.mjs                    # counts, and how to search
//   node scripts/types.mjs wait               # the full card for one type key
//   node scripts/types.mjs appointment        # search: every type whose key/title/summary matches
//   node scripts/types.mjs --index            # the one-line-per-type index (what references/ghl-types-index.md is)
//
// The data is catalog/type-cards.json — one card per step and trigger type, compiled from the
// knowledge corpus's 30-types pages (one page per type, status-stamped). It is the SAME artefact
// the uxie-ghl-factory plugin serves through describe_step_type; here it is a file so the skill
// works standalone. The index is generated from it and the plugin's freshness gate refuses to
// ship if either has drifted, so what you read here cannot be older than the last release.
//
// `status` is the card's FLOOR — the weakest claim on it. `proven-live` means executed against a
// live account and read back. Say which level you relied on.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CATALOG_PATH = resolve(HERE, '..', 'catalog', 'type-cards.json');

export function loadCards(path = CATALOG_PATH) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  // picker-taxonomy is a routing page that rides along in the corpus folder, not a type.
  return data.cards.filter((c) => c.family !== '.');
}

const FAMILY_LABEL = {
  steps: 'Steps (native)',
  triggers: 'Triggers (native)',
  'steps-marketplace': 'Steps (marketplace apps)',
  'triggers-marketplace': 'Triggers (marketplace apps)',
};
const FAMILY_ORDER = ['triggers', 'steps', 'triggers-marketplace', 'steps-marketplace'];

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// One line per type, grouped by family. Native families carry the summary; marketplace ones are
// a bare index (third-party apps — detail on demand via the CLI).
export function renderIndex(cards) {
  const byFamily = new Map();
  for (const c of cards) {
    if (!byFamily.has(c.family)) byFamily.set(c.family, []);
    byFamily.get(c.family).push(c);
  }
  const out = [];
  out.push('# GHL workflow types — index');
  out.push('');
  out.push('Generated from `catalog/type-cards.json` by the plugin\'s sync step. **Do not edit** — regenerate.');
  out.push('One line per step and trigger type. For the full card (fields, allowed values, validator,');
  out.push('gotchas) run `node scripts/types.mjs <type-key>`, or `describe_step_type` if the');
  out.push('uxie-ghl-factory plugin is installed — same data.');
  out.push('');
  const native = cards.filter((c) => !c.family.endsWith('-marketplace')).length;
  out.push(`${cards.length} types: ${native} native, ${cards.length - native} marketplace. Status is each card's floor: `);
  out.push('`proven-live` > `source-derived` > `inferred`; `deprecated` means do not build on it.');
  out.push('');
  for (const family of FAMILY_ORDER) {
    const rows = (byFamily.get(family) ?? []).sort((a, b) => a.type.localeCompare(b.type));
    if (!rows.length) continue;
    out.push(`## ${FAMILY_LABEL[family] ?? family} (${rows.length})`);
    out.push('');
    if (family.endsWith('-marketplace')) {
      out.push('| type | title | status |');
      out.push('|---|---|---|');
      for (const c of rows) out.push(`| \`${c.type}\` | ${oneLine(c.title)} | ${c.status} |`);
    } else {
      out.push('| type | status | summary |');
      out.push('|---|---|---|');
      for (const c of rows) out.push(`| \`${c.type}\` | ${c.status} | ${oneLine(c.summary).replace(/\|/g, '\\|')} |`);
    }
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

const table = (rows, cols) => {
  const lines = [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`];
  for (const r of rows) lines.push(`| ${cols.map((k) => oneLine(r[k] ?? '—').replace(/\|/g, '\\|')).join(' | ')} |`);
  return lines.join('\n');
};

// The whole card, as the corpus page would read.
export function renderCard(c) {
  const out = [`# ${c.type}  (${c.family})`, ''];
  out.push(`**status:** ${c.status}${c.lastVerified ? ` · last verified ${c.lastVerified}` : ''}`);
  if (c.summary) out.push('', oneLine(c.summary));
  if (c.meta && Object.keys(c.meta).length) {
    out.push('', '## Meta', '');
    for (const [k, v] of Object.entries(c.meta)) out.push(`- **${k}:** ${oneLine(v)}`);
  }
  if (c.validator) out.push('', '## Validator', '', oneLine(c.validator));
  if (c.fields?.length) out.push('', '## Fields', '', table(c.fields, ['name', 'type', 'required', 'default', 'notes']));
  if (c.configSurface) out.push('', '## Config surface', '', typeof c.configSurface === 'string' ? c.configSurface : JSON.stringify(c.configSurface, null, 2));
  if (c.filterRows?.length) out.push('', '## Filter rows', '', table(c.filterRows, Object.keys(c.filterRows[0])));
  if (c.customVariables?.length) out.push('', '## Custom variables', '', table(c.customVariables, Object.keys(c.customVariables[0])));
  if (c.notes) out.push('', '## Notes', '', typeof c.notes === 'string' ? c.notes : c.notes.map((n) => `- ${n}`).join('\n'));
  if (c.hasCanonicalExample) out.push('', '_A canonical example exists in the corpus (`catalog/step-examples/` or `trigger-examples/`)._');
  return `${out.join('\n')}\n`;
}

export function search(cards, term) {
  const q = term.toLowerCase();
  return cards.filter((c) => [c.type, c.title, c.summary].some((s) => String(s ?? '').toLowerCase().includes(q)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cards = loadCards();
  const args = process.argv.slice(2);
  if (args[0] === '--index') {
    process.stdout.write(renderIndex(cards));
  } else if (!args.length) {
    const native = cards.filter((c) => !c.family.endsWith('-marketplace'));
    console.log(`${cards.length} types (${native.length} native, ${cards.length - native.length} marketplace).`);
    console.log('  node scripts/types.mjs <type-key>   full card');
    console.log('  node scripts/types.mjs <term>       search keys, titles, summaries');
    console.log('  node scripts/types.mjs --index      the index');
  } else {
    const term = args.join(' ');
    // A key can live in two families — dnd_contact is both a trigger and a step, and two
    // affiliate/proposal keys exist natively AND as marketplace triggers. Print every card.
    const exact = cards.filter((c) => c.type === term);
    if (exact.length) { process.stdout.write(exact.map(renderCard).join('\n---\n\n')); process.exit(0); }
    const hits = search(cards, term);
    if (!hits.length) {
      console.log(`no type matches "${term}". A miss here does NOT prove GHL lacks it — the catalogue is what has been mapped so far.`);
      process.exit(1);
    }
    if (hits.length === 1) { process.stdout.write(renderCard(hits[0])); process.exit(0); }
    console.log(`${hits.length} matches — pass the exact key for the full card:`);
    for (const c of hits) console.log(`  ${c.family.padEnd(20)} ${c.type}  ${c.status}  ${oneLine(c.summary).slice(0, 90)}`);
  }
}
