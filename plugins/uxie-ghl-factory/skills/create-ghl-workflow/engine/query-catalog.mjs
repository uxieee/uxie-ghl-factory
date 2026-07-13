// Capability lookup over catalog.data.json — the answer to "can the engine build X?"
// Agents MUST consult this (or references/capabilities.md, which it generates) before
// claiming a step/trigger type doesn't exist or working around a "missing" action.
//
// CLI:
//   node engine/query-catalog.mjs               summary (counts by tier + section)
//   node engine/query-catalog.mjs <term…>       search steps + triggers by type/name/section
//   node engine/query-catalog.mjs --md          full capabilities index (markdown) to stdout
//
// Regenerate the committed index after gen-catalog runs:
//   node engine/query-catalog.mjs --md > references/capabilities.md
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export function loadData() {
  return JSON.parse(readFileSync(resolve(HERE, 'catalog.data.json'), 'utf8'));
}

// IR authoring sugar for container types (SKILL.md "Node kinds"). Everything else
// is `kind: action`.
const IR_KIND = {
  if_else: 'if_else', workflow_split: 'split', workflow_ai_decision_maker: 'ai_decision',
  goto: 'goto', wait: 'wait',
  find_contact: 'find_contact (onFound/onNotFound)',
  find_opportunity: 'find_opportunity (onFound/onNotFound)',
  lc_merge_contact: 'lc_merge_contact (onFound/onNotFound)',
};
const TIER_MARK = { 'verified-live': '✅', 'bundle-derived': '◐', 'live-schema': '▫' };

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '');

export function searchCatalog(d, term) {
  const q = norm(term);
  const score = (entry) => {
    const hay = [entry.type, entry.display_name, entry.section, entry.category].map(norm);
    if (hay[0] === q || hay[1] === q) return 3;
    if (hay[0].startsWith(q) || hay[1].startsWith(q)) return 2;
    if (hay.some((h) => h && h.includes(q))) return 1;
    return 0;
  };
  const all = [...Object.values(d.steps), ...Object.values(d.triggers)];
  return all.map((e) => [score(e), e]).filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0]).map(([, e]) => e);
}

export function renderCard(e) {
  const lines = [];
  if (e.kind === 'trigger') {
    lines.push(`■ ${e.type} — TRIGGER (${e.category ?? 'other'}, masterType ${e.masterType}) ${TIER_MARK[e.confidence] ?? ''}${e.confidence}`);
    const rows = e.filterRows ?? [];
    if (rows.length) lines.push(`  filters: ${rows.map((r) => `${r.label} (${r.value}, ${r.type})`).join(' | ')}`);
    if (e.example) lines.push(`  example: ${e.example}`);
    lines.push(`  IR: triggers: [{ ref, type: ${e.type}, name, filters: [{ field, value }] }]`);
  } else {
    const flags = [
      e.isMultipathContainer && 'container', e.premium && 'premium (top-level stepIndex)',
      e.usesCustomInputs && '__customInputs__', e.situational?.length && `situational: ${e.situational.join(',')}`,
      e.section === 'marketplace' && 'marketplace app — runs only if the app is installed',
    ].filter(Boolean);
    lines.push(`■ ${e.type} — STEP (${e.section ?? 'other'}) ${TIER_MARK[e.confidence] ?? ''}${e.confidence}`);
    if (e.display_name && norm(e.display_name) !== norm(e.type)) lines.push(`  display: ${e.display_name}`);
    if (e.attrKeys?.length) lines.push(`  attrs: ${e.attrKeys.join(', ')}`);
    if (e.requiredFields?.length) lines.push(`  required: ${e.requiredFields.join(', ')}`);
    if (flags.length) lines.push(`  flags: ${flags.join('; ')}`);
    if (e.example) lines.push(`  example: ${e.example}`);
    lines.push(`  IR: { ref, kind: ${IR_KIND[e.type] ?? 'action'}, type: ${e.type}, name, attributes: { … } }`);
  }
  return lines.join('\n');
}

export function summary(d) {
  const steps = Object.values(d.steps);
  const byTier = (t) => steps.filter((s) => s.confidence === t).length;
  const sections = {};
  for (const s of steps) sections[s.section ?? 'other'] = (sections[s.section ?? 'other'] ?? 0) + 1;
  return [
    `${d.stepCount} step types (${byTier('verified-live')} verified-live, ${byTier('bundle-derived')} bundle-derived, ${byTier('live-schema')} marketplace live-schema) · ${d.triggerCount} trigger types`,
    `step sections: ${Object.entries(sections).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`,
    `search: node engine/query-catalog.mjs <term>   full index: references/capabilities.md`,
  ].join('\n');
}

export function renderMarkdown(d) {
  const steps = Object.values(d.steps);
  const trigs = Object.values(d.triggers);
  const native = steps.filter((s) => s.confidence !== 'live-schema');
  const market = steps.filter((s) => s.confidence === 'live-schema');
  const out = [];
  out.push('# Capabilities index — every step & trigger the engine can build');
  out.push('');
  out.push('> GENERATED from `engine/catalog.data.json` — do not hand-edit.');
  out.push('> Regenerate: `node engine/query-catalog.mjs --md > references/capabilities.md`');
  out.push('> Look one type up (full shape card): `node engine/query-catalog.mjs <term>`');
  out.push('');
  out.push(`**${d.stepCount} step types / ${d.triggerCount} trigger types.** ` +
    'This index — not your recall of "what GHL supports" — is the capability truth. ' +
    'NEVER tell the user a step or trigger "isn\'t supported", and never substitute a ' +
    'webhook/custom-code workaround for a native action, without searching here first.');
  out.push('');
  out.push('Legend: ✅ verified-live (round-tripped against a live account) · ◐ bundle-derived · ▫ live-schema (marketplace).');
  out.push('');
  out.push('## Native steps — by section (with authorable attribute keys)');
  const bySection = {};
  for (const s of native) (bySection[s.section ?? 'other'] ??= []).push(s);
  for (const [sec, list] of Object.entries(bySection).sort()) {
    out.push('', `### ${sec}`);
    for (const s of list.sort((a, b) => a.type.localeCompare(b.type))) {
      const bits = [];
      if (s.attrKeys?.length) bits.push(`attrs: \`${s.attrKeys.join('`, `')}\``);
      if (s.isMultipathContainer) bits.push(`container → IR kind \`${IR_KIND[s.type] ?? s.type}\``);
      if (s.premium) bits.push('premium');
      out.push(`- ${TIER_MARK[s.confidence]} \`${s.type}\`${bits.length ? ' — ' + bits.join('; ') : ''}`);
    }
  }
  out.push('', '## Containers / control flow (IR node kinds)', '');
  out.push('| IR kind | step type | shape |');
  out.push('|---|---|---|');
  out.push('| `if_else` | `if_else` | N≥2 branches, one optional `else: true` |');
  out.push('| `split` | `workflow_split` | weighted/random branches |');
  out.push('| `ai_decision` | `workflow_ai_decision_maker` | Default + N LLM branches |');
  out.push('| `wait` | `wait` | plain wait, or multipath on outcomes |');
  out.push('| `goto` | `goto` | must be last node in its branch |');
  out.push('| `onFound`/`onNotFound` | `find_contact`, `find_opportunity`, `lc_merge_contact` | pre-set 2-branch finders |');
  out.push('', '## Marketplace steps (▫ live-schema — build fine, RUN only if the app is installed)', '');
  out.push(market.map((s) => `\`${s.type}\``).sort().join(', '));
  out.push('', '## Triggers — by category (with filterable fields)');
  const byCat = {};
  for (const t of trigs) (byCat[t.category ?? 'other'] ??= []).push(t);
  for (const [cat, list] of Object.entries(byCat).sort()) {
    out.push('', `### ${cat}`);
    for (const t of list.sort((a, b) => a.type.localeCompare(b.type))) {
      const rows = (t.filterRows ?? []).map((r) => `${r.label} (\`${r.value}\`)`).join(', ');
      out.push(`- ${TIER_MARK[t.confidence] ?? ''} \`${t.type}\` (${t.masterType})${rows ? ' — filters: ' + rows : ''}`);
    }
  }
  out.push('');
  return out.join('\n');
}

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
