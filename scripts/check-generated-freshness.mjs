#!/usr/bin/env node
// Freshness gate for every GENERATED artefact the plugin ships.
//
// The plugin does not read knowledge/ at runtime; it carries COPIES, compiled by hand:
//
//   type-cards   knowledge/corpus/workflows/30-types  →  skills/create-ghl-workflow/catalog/type-cards.json
//   skill-types  that type-cards.json  →  skills/ghl-system-conventions/{catalog/type-cards.json, references/ghl-types-index.md}
//   source       knowledge/catalog/internal-endpoints.source.json  →  mcp-internal/catalog/ (delivered by the miner)
//   catalogue    source + endpoint-overlay.json + capability-manifest  →  mcp-internal/catalog/internal-endpoints.json
//   manifests    core/tools.mjs + core/audit-capabilities.mjs  →  capability-manifest.json, audit-capability-manifest.json
//   dist         everything above, embedded  →  dist/server.mjs, dist/audit-server.mjs
//
// Nothing runs these on a corpus change, and a stale copy is worse than a missing one: it looks
// like knowledge while teaching the wrong field set, the wrong reach, the wrong tool coverage.
// Users only ever receive a RELEASE, so the invariant this repo enforces is not "always synced"
// but "a release cannot be cut from stale artefacts". This gate is that invariant: it regenerates
// every artefact into a temp dir and fails on ANY difference, naming what differs.
//
// Why regenerate-and-diff rather than mtimes or hashes of inputs: a hash of the inputs cannot tell
// a harmless re-capture from real drift (check-catalog-drift.mjs learned that), and mtimes lie
// across branches — the miner writes source.json into whichever plugin branch is checked out.
// The only honest question is "would regenerating change the file?", so ask exactly that.
//
// Why it prints names, not counts: the endpoint-catalogue test asserts a COUNT (source + adopted).
// Same-count drift — a row's kind flipping, a coveredBy tool vanishing — passes it. Two of the 18
// regressions the 0.51.0 merge would have shipped were exactly that shape.
//
//   node scripts/check-generated-freshness.mjs                 # every check
//   node scripts/check-generated-freshness.mjs --only catalogue,manifests
//   node scripts/check-generated-freshness.mjs --skip dist
//   --plugin-root <dir>  --knowledge <dir>                     # for tests; defaults are this repo's
//
// Checks that need knowledge/ SKIP (exit 0, say so) when it is absent — it is a sibling repo with
// no remote, so a clone of this repo alone cannot run them. Everything else always runs.
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const list = (name) => opt(name, '').split(',').map((s) => s.trim()).filter(Boolean);

const PLUGIN = resolve(opt('--plugin-root', join(REPO, 'plugins/uxie-ghl-factory')));
const KNOWLEDGE = resolve(opt('--knowledge', join(REPO, '..', 'knowledge')));
const MCP = join(PLUGIN, 'mcp-internal');
const ONLY = list('--only');
const SKIP = list('--skip');

const CHECKS = ['type-cards', 'skill-types', 'source', 'catalogue', 'manifests', 'dist'];
for (const name of [...ONLY, ...SKIP]) {
  if (!CHECKS.includes(name)) { console.error(`freshness: unknown check "${name}" — one of ${CHECKS.join(', ')}`); process.exit(2); }
}
const wanted = (name) => (!ONLY.length || ONLY.includes(name)) && !SKIP.includes(name);

const tmp = mkdtempSync(join(tmpdir(), 'freshness-'));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const hasKnowledge = existsSync(join(KNOWLEDGE, 'scripts')) && existsSync(join(KNOWLEDGE, 'catalog'));

// ---------------------------------------------------------------------------------------------
// Diff helpers — every category is NAMED. A removal is the dangerous direction (it looks like
// coverage narrowing on purpose), so removals and changes print in full; additions are capped.
// ---------------------------------------------------------------------------------------------
const ADD_CAP = 30;
function diffById(before, after, key, label) {
  const a = new Map(before.map((x) => [key(x), x]));
  const b = new Map(after.map((x) => [key(x), x]));
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const changed = [];
  for (const [k, x] of a) {
    const y = b.get(k);
    if (!y) continue;
    const fields = [...new Set([...Object.keys(x), ...Object.keys(y)])]
      .filter((f) => JSON.stringify(x[f]) !== JSON.stringify(y[f]));
    if (fields.length) changed.push({ k, fields, x, y });
  }
  const lines = [];
  if (added.length) {
    lines.push(`${added.length} new ${label} in the regenerated artefact:`);
    for (const k of added.slice(0, ADD_CAP)) lines.push(`   + ${k}`);
    if (added.length > ADD_CAP) lines.push(`   … ${added.length - ADD_CAP} more`);
  }
  if (removed.length) {
    lines.push(`${removed.length} ${label} the shipped artefact has that regeneration DROPS:`);
    for (const k of removed) lines.push(`   - ${k}`);
  }
  if (changed.length) {
    lines.push(`${changed.length} ${label} whose content differs (shipped → regenerated):`);
    for (const { k, fields, x, y } of changed) {
      const show = fields.map((f) => `${f}: ${JSON.stringify(x[f]) ?? '∅'} → ${JSON.stringify(y[f]) ?? '∅'}`).join(' ; ');
      lines.push(`   ~ ${k} | ${show.length > 240 ? `${show.slice(0, 240)}…` : show}`);
    }
  }
  return { stale: Boolean(added.length || removed.length || changed.length), lines };
}

const results = [];
const ok = (name, note) => results.push({ name, state: 'ok', note });
const skipped = (name, note) => results.push({ name, state: 'skipped', note });
const stale = (name, lines, fix) => results.push({ name, state: 'STALE', lines, fix });
const failed = (name, err, fix) => results.push({ name, state: 'STALE', lines: [`the generator failed: ${String(err.stderr || err.message).split('\n').filter(Boolean).slice(-1)[0]}`], fix });

// ---------------------------------------------------------------------------------------------
// 1. type-cards — corpus 30-types → the create-ghl-workflow skill's type catalogue
// ---------------------------------------------------------------------------------------------
if (wanted('type-cards')) {
  const gen = join(KNOWLEDGE, 'scripts/build-type-catalog.mjs');
  const shippedPath = join(PLUGIN, 'skills/create-ghl-workflow/catalog/type-cards.json');
  const fix = 'node knowledge/scripts/build-type-catalog.mjs';
  if (!hasKnowledge || !existsSync(gen)) skipped('type-cards', 'knowledge/ not present — cannot regenerate to compare');
  else if (!existsSync(shippedPath)) stale('type-cards', ['the shipped type-cards.json is MISSING'], fix);
  else {
    const out = join(tmp, 'type-cards.json');
    try {
      execFileSync('node', [gen, out], { encoding: 'utf8', stdio: 'pipe' });
      const d = diffById(readJson(shippedPath).cards, readJson(out).cards, (c) => c.type, 'cards');
      d.stale ? stale('type-cards', d.lines, fix) : ok('type-cards', `${readJson(shippedPath).count} cards`);
    } catch (e) { failed('type-cards', e, fix); }
  }
}

// ---------------------------------------------------------------------------------------------
// 1b. skill-types — the conventions skill's standalone copy of the type catalogue + its index
// ---------------------------------------------------------------------------------------------
if (wanted('skill-types')) {
  const gen = join(REPO, 'scripts/build-skill-types.mjs');
  const skill = join(PLUGIN, 'skills/ghl-system-conventions');
  const fix = 'node scripts/build-skill-types.mjs';
  const out = join(tmp, 'skill-types');
  try {
    execFileSync('node', [gen, '--plugin-root', PLUGIN, '--out-dir', out], { encoding: 'utf8', stdio: 'pipe' });
    const lines = [];
    const shippedCards = join(skill, 'catalog/type-cards.json');
    const shippedIndex = join(skill, 'references/ghl-types-index.md');
    if (!existsSync(shippedCards)) lines.push('catalog/type-cards.json is MISSING from the skill');
    else if (readFileSync(shippedCards, 'utf8') !== readFileSync(join(out, 'type-cards.json'), 'utf8')) {
      const d = diffById(readJson(shippedCards).cards, readJson(join(out, 'type-cards.json')).cards, (c) => c.type, 'cards');
      lines.push('catalog/type-cards.json differs from create-ghl-workflow\'s:', ...(d.lines.length ? d.lines : ['same cards, different bytes']));
    }
    if (!existsSync(shippedIndex)) lines.push('references/ghl-types-index.md is MISSING from the skill');
    else if (readFileSync(shippedIndex, 'utf8') !== readFileSync(join(out, 'ghl-types-index.md'), 'utf8')) {
      const a = readFileSync(shippedIndex, 'utf8').split('\n'), b = readFileSync(join(out, 'ghl-types-index.md'), 'utf8').split('\n');
      const first = a.findIndex((l, i) => l !== b[i]);
      lines.push(`references/ghl-types-index.md differs from a fresh render (first difference at line ${first + 1}: ${JSON.stringify(a[first] ?? '')} → ${JSON.stringify(b[first] ?? '')})`);
    }
    lines.length ? stale('skill-types', lines, fix) : ok('skill-types', `${readJson(shippedCards).count} cards + index`);
  } catch (e) { failed('skill-types', e, fix); }
}

// ---------------------------------------------------------------------------------------------
// 2. source — the miner's artefact, delivered into the plugin by merge-endpoint-catalogs.mjs
// ---------------------------------------------------------------------------------------------
if (wanted('source')) {
  const theirs = join(KNOWLEDGE, 'catalog/internal-endpoints.source.json');
  const ours = join(MCP, 'catalog/internal-endpoints.source.json');
  const fix = 'node knowledge/scripts/merge-endpoint-catalogs.mjs   (delivers the artefact into the plugin)';
  if (!hasKnowledge || !existsSync(theirs)) skipped('source', 'knowledge/ not present — cannot compare the source artefact');
  else if (!existsSync(ours)) stale('source', ['the plugin has no internal-endpoints.source.json at all'], fix);
  else if (readFileSync(theirs, 'utf8') === readFileSync(ours, 'utf8')) {
    const s = readJson(ours);
    ok('source', `${s.endpoints.length} rows, generated ${s.generated}`);
  } else {
    const a = readJson(ours), b = readJson(theirs);
    const d = diffById(a.endpoints, b.endpoints, (e) => e.id, 'rows');
    const head = [`plugin copy generated ${a.generated} (${a.endpoints.length} rows); knowledge/ has ${b.generated} (${b.endpoints.length} rows)`];
    stale('source', [...head, ...(d.lines.length ? d.lines : ['same rows, different bytes (metadata or ordering)'])], fix);
  }
}

// ---------------------------------------------------------------------------------------------
// 3. catalogue — source + overlay + capability manifest → the compiled catalogue the MCP serves
// ---------------------------------------------------------------------------------------------
if (wanted('catalogue')) {
  const gen = join(MCP, 'scripts/build-endpoint-catalog.mjs');
  const shippedPath = join(MCP, 'catalog/internal-endpoints.json');
  const fix = 'cd plugins/uxie-ghl-factory/mcp-internal && node scripts/build-endpoint-catalog.mjs && npm run build';
  const out = join(tmp, 'internal-endpoints.json');
  try {
    execFileSync('node', [gen, '--out', out], { encoding: 'utf8', stdio: 'pipe' });
    const d = diffById(readJson(shippedPath).endpoints, readJson(out).endpoints, (e) => e.id, 'rows');
    d.stale ? stale('catalogue', d.lines, fix) : ok('catalogue', `${readJson(shippedPath).count} rows`);
  } catch (e) { failed('catalogue', e, fix); }
}

// ---------------------------------------------------------------------------------------------
// 4. manifests — compiled from TOOLS and the audit descriptors; never read back the other way
// ---------------------------------------------------------------------------------------------
if (wanted('manifests')) {
  const fix = 'cd plugins/uxie-ghl-factory/mcp-internal && npm run manifest && npm run build';
  try {
    const gen = await import(pathToFileURL(join(MCP, 'scripts/gen-manifest.mjs')).href);
    const render = (v) => `${JSON.stringify(v, null, 2)}\n`;
    const capShipped = readFileSync(join(MCP, 'capability-manifest.json'), 'utf8');
    const capFresh = render(gen.buildCapabilityManifest());
    const auditShipped = readFileSync(join(MCP, 'audit-capability-manifest.json'), 'utf8');
    const auditFresh = render(gen.buildAuditManifest());
    const lines = [];
    if (capShipped !== capFresh) {
      const key = (r) => `${r.tool} ${r.method} ${r.path}`;
      const d = diffById(JSON.parse(capShipped), JSON.parse(capFresh), key, 'capability rows');
      lines.push('capability-manifest.json:', ...(d.lines.length ? d.lines : ['same rows, different bytes']));
    }
    if (auditShipped !== auditFresh) {
      const a = JSON.parse(auditShipped), b = JSON.parse(auditFresh);
      lines.push('audit-capability-manifest.json:',
        `   manifestHash ${a.manifestHash} → ${b.manifestHash}`,
        `   tools ${JSON.stringify(a.tools)} → ${JSON.stringify(b.tools)}`);
    }
    lines.length ? stale('manifests', lines, fix) : ok('manifests', `${JSON.parse(capShipped).length} capability rows`);
  } catch (e) { failed('manifests', e, fix); }
}

// ---------------------------------------------------------------------------------------------
// 5. dist — the bundles EMBED the catalogues, so every check above is stale twice until rebuilt
// ---------------------------------------------------------------------------------------------
if (wanted('dist')) {
  const fix = 'cd plugins/uxie-ghl-factory/mcp-internal && npm run build';
  try {
    const cfg = await import(pathToFileURL(join(MCP, 'scripts/esbuild-config.mjs')).href);
    const { build } = createRequire(join(MCP, 'package.json'))('esbuild');
    const lines = [];
    for (const [label, options, outfile] of [
      ['dist/server.mjs', cfg.buildOptions, cfg.OUTFILE],
      ['dist/audit-server.mjs', cfg.auditBuildOptions, cfg.AUDIT_OUTFILE],
    ]) {
      // absWorkingDir: esbuild writes each module's path into the bundle as a comment, RELATIVE to
      // the working dir. `npm run build` runs inside mcp-internal, so a rebuild from anywhere else
      // is 14 KB of longer path prefixes and a false STALE. Same bytes require the same cwd.
      const result = await build(options({ write: false, logLevel: 'silent', absWorkingDir: MCP }));
      const fresh = result.outputFiles[0].text;
      const committed = existsSync(outfile) ? readFileSync(outfile, 'utf8') : '';
      if (fresh !== committed) lines.push(`${label}: ${committed.length} bytes committed, ${fresh.length} bytes when rebuilt from source`);
    }
    lines.length ? stale('dist', lines, fix) : ok('dist', 'both bundles match a rebuild from source');
  } catch (e) { failed('dist', e, fix); }
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------
const pad = (s) => s.padEnd(11);
let anyStale = false;
for (const r of results) {
  if (r.state === 'ok') console.log(`freshness: ${pad(r.name)} ok (${r.note})`);
  else if (r.state === 'skipped') console.log(`freshness: ${pad(r.name)} skipped — ${r.note}`);
  else {
    anyStale = true;
    console.error(`freshness: ${pad(r.name)} STALE`);
    for (const line of r.lines) console.error(`   ${line}`);
    console.error(`   fix: ${r.fix}`);
  }
}
if (anyStale) {
  console.error('\nfreshness: a shipped artefact no longer matches what regeneration produces. Regenerate, READ the diff above, commit.');
  process.exit(1);
}
