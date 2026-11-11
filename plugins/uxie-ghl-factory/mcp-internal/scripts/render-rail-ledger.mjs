#!/usr/bin/env node
// The skills' routing statements, generated from the rail ledger (W4, 2026-10-29). A skill marks where a product's rail
// table goes with `<!-- rail-ledger:<product> -->` … `<!-- /rail-ledger:<product> -->` (or `summary` for the one-line-per-
// product table); this fills every marker pair from catalog/rail-ledger.json and writes the whole ledger to
// skills/ghl-orientation/references/rail-ledger.md. Prose beside a block stays hand-written.
//
//   node scripts/render-rail-ledger.mjs           rewrite the blocks and the reference (run by `npm run sync`)
//   node scripts/render-rail-ledger.mjs --check   list what a render would change; exit 1 if anything would
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATED = '_generated from the rail ledger (mcp-internal/catalog/rail-ledger.json) — do not edit; the whole ledger is `ghl-orientation/references/rail-ledger.md`._';
const BLOCK = /<!-- rail-ledger:([a-z-]+) -->\n[\s\S]*?<!-- \/rail-ledger:\1 -->/g;
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const list = (xs) => (xs?.length ? xs.map((x) => `\`${x}\``).join(', ') : '—');

/** The markdown a marker pair holds, without the markers. */
export function renderBlock(ledger, key) {
  if (key === 'summary') {
    const rows = Object.keys(ledger.products).map((p) => {
      const rs = ledger.rows.filter((r) => r.product === p);
      const decided = rs.filter((r) => !r.decision.startsWith('undecided'));
      const routes = [...new Set(rs.map((r) => r.routing.current))].join(', ') || '—';
      return `| ${p} | ${rs.map((r) => r.job).join(', ') || '—'} | ${decided.length ? decided.map((r) => `${r.job}: ${r.decision}`).join(', ') : 'none yet'} | ${routes} |`;
    });
    return [GENERATED, '', '| Product | Jobs both rails serve | Decided | Routed today |', '|---|---|---|---|', ...rows].join('\n');
  }
  const product = ledger.products[key];
  if (!product) throw new Error(`rail-ledger: unknown product "${key}"`);
  const rs = ledger.rows.filter((r) => r.product === key);
  return [
    GENERATED, '',
    '| Job | Decision | Routed today | Internal | Public |', '|---|---|---|---|---|',
    ...rs.map((r) => `| ${r.job} | ${r.decision} | ${r.routing.current} | ${cell(list(r.internal.tools))} | ${cell(list(r.public.actions))} |`),
    '',
    ...rs.map((r) => `- **${r.job}:** ${r.routing.why}`),
    '',
    `Internal only: ${product.internalOnly.length ? product.internalOnly.join('; ') : 'nothing recorded'}.`,
    `Public only: ${product.publicOnly.length ? product.publicOnly.join('; ') : 'nothing recorded'}.`,
  ].join('\n');
}

/** Refuses a marker without its partner, then fills every pair. */
export function applyBlocks(text, ledger) {
  const opens = [...text.matchAll(/<!-- rail-ledger:([a-z-]+) -->/g)].map((m) => m[1]);
  const closes = [...text.matchAll(/<!-- \/rail-ledger:([a-z-]+) -->/g)].map((m) => m[1]);
  const keys = new Set([...opens, ...closes]);
  for (const k of keys) if (opens.filter((x) => x === k).length !== closes.filter((x) => x === k).length) throw new Error(`rail-ledger: unpaired marker for "${k}"`);
  for (const k of keys) if (k !== 'summary' && !ledger.products[k]) throw new Error(`rail-ledger: unknown product "${k}"`);
  const out = text.replace(BLOCK, (_, k) => `<!-- rail-ledger:${k} -->\n${renderBlock(ledger, k)}\n<!-- /rail-ledger:${k} -->`);
  if ([...out.matchAll(/<!-- rail-ledger:/g)].length !== opens.length) throw new Error('rail-ledger: unpaired marker (nested or out of order)');
  return out;
}

/** The text with every generated block removed — what a deny-list should search. */
export const stripBlocks = (text) => text.replace(BLOCK, '');

/** The whole ledger, for skills/ghl-orientation/references/rail-ledger.md. */
export function renderReference(ledger) {
  const owners = {};
  for (const u of ledger.unledgered) { const o = /belongs to (.+)$/.exec(u.reason)?.[1] ?? 'unassigned'; owners[o] = (owners[o] ?? 0) + 1; }
  const out = [
    '# Rail ledger', '',
    GENERATED.replace('; the whole ledger is `ghl-orientation/references/rail-ledger.md`', ''), '',
    'For every GoHighLevel product both the public and the internal API serve, and each job both serve: what each rail',
    'does, how the plugin routes it today and why, and the decision. A decision is taken only once both rails are proven on',
    'the sandbox and every criterion is known, in this order: capability, correctness, auth, writeSemantics, efficiency,',
    'rateLimits. The first criterion that is not `equal` decides `pool-<rail>`; all `equal` gives `both`. `undecided` means',
    'not proven yet; `undecided-public-not-released` means GHL has not released the public side to our accounts.', '',
    '## Summary', '', renderBlock(ledger, 'summary').split('\n').slice(2).join('\n'),
  ];
  for (const p of Object.keys(ledger.products)) {
    const rs = ledger.rows.filter((r) => r.product === p);
    out.push('', `## ${p}`, '', renderBlock(ledger, p).split('\n').slice(2).join('\n'));
    const notes = rs.flatMap((r) => (r.notes ?? []).map((n) => `- **${r.job}:** ${n}`));
    if (notes.length) out.push('', 'Evidence:', '', ...notes);
    const decided = rs.filter((r) => r.criteria);
    for (const r of decided) {
      out.push('', `Criteria for ${r.job} (${r.decision}):`, '',
        ...Object.entries(r.criteria).map(([c, v]) => `- ${c}: ${v}${r.criteriaNotes?.[c] ? ` — ${r.criteriaNotes[c]}` : ''}`));
    }
  }
  out.push('', '## Shared paths outside these products', '',
    `${ledger.unledgered.length} paths both rails serve belong to products outside the ledger; their rail choice is owned by:`, '',
    ...Object.entries(owners).sort().map(([o, n]) => `- ${o}: ${n}`), '');
  return out.join('\n');
}

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : []; });

/** Renders every skill block and the reference. With write:false, reports what would change. */
export function renderAll({ skillsDir, ledger, write }) {
  const stale = [];
  const put = (p, next) => {
    const prev = existsSync(p) ? readFileSync(p, 'utf8') : null;
    if (prev === next) return;
    stale.push(relative(skillsDir, p));
    if (write) writeFileSync(p, next);
  };
  for (const p of walk(skillsDir)) {
    if (p.endsWith('references/rail-ledger.md')) continue;
    const text = readFileSync(p, 'utf8');
    if (!text.includes('rail-ledger:')) continue;
    put(p, applyBlocks(text, ledger));
  }
  put(join(skillsDir, 'ghl-orientation/references/rail-ledger.md'), renderReference(ledger));
  return { stale };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const MCP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const ledger = JSON.parse(readFileSync(join(MCP, 'catalog/rail-ledger.json'), 'utf8'));
  const check = process.argv.includes('--check');
  const { stale } = renderAll({ skillsDir: resolve(MCP, '../skills'), ledger, write: !check });
  for (const f of stale) console.log(`${check ? 'stale' : 'rendered'}: skills/${f}`);
  if (check && stale.length) process.exit(1);
}
