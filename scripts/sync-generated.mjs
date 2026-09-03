#!/usr/bin/env node
// Bring every generated artefact the plugin ships up to date with its source, in place.
//
//   npm run sync          # regenerate type-cards, source, catalogue, manifests, dist; then gate
//
// This is the "when things enter the corpus, the plugin gets updated" step. It is what
// knowledge/'s post-commit hook runs, what release.mjs runs as its regenerate step, and what
// you run by hand after editing tools.mjs or the overlay. It writes ONLY generated files; it
// never commits — read the list it prints, then commit them with whatever you were doing.
//
// Order matters: type-cards before the skill's copy of them, source must land before the catalogue is compiled, the catalogue before the
// manifests are compared against it, and the bundles last because they embed all of it.
// Regeneration is idempotent — a second run changes nothing — and the freshness gate at the
// end asserts exactly that, so a generator that writes somewhere the gate does not read is
// caught here and not at push time.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = join(REPO, 'plugins/uxie-ghl-factory');
const MCP = join(PLUGIN, 'mcp-internal');
const KNOWLEDGE = resolve(REPO, '..', 'knowledge');
const quiet = process.argv.includes('--quiet');

// What this script is allowed to write. Reported by CONTENT hash, not by git status: a file that
// was already dirty (a hand edit, a stale copy from another branch) and gets restored to what
// regeneration produces is a change worth seeing, and git status would call it "clean".
const GENERATED = [
  'plugins/uxie-ghl-factory/skills/create-ghl-workflow/catalog/type-cards.json',
  'plugins/uxie-ghl-factory/mcp-internal/catalog/internal-endpoints.source.json',
  'plugins/uxie-ghl-factory/mcp-internal/catalog/internal-endpoints.json',
  'plugins/uxie-ghl-factory/mcp-internal/capability-manifest.json',
  'plugins/uxie-ghl-factory/mcp-internal/audit-capability-manifest.json',
  'plugins/uxie-ghl-factory/mcp-internal/dist/server.mjs',
  'plugins/uxie-ghl-factory/mcp-internal/dist/audit-server.mjs',
  'plugins/uxie-ghl-factory/skills/ghl-system-conventions/catalog/type-cards.json',
  'plugins/uxie-ghl-factory/skills/ghl-system-conventions/references/ghl-types-index.md',
];
const digest = (rel) => {
  const p = join(REPO, rel);
  return existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12) : 'missing';
};
const git = (...argv) => execFileSync('git', argv, { cwd: REPO, encoding: 'utf8' }).trim();
const before = Object.fromEntries(GENERATED.map((f) => [f, digest(f)]));

const run = (label, cmd, argv, cwd = REPO) => {
  if (!quiet) console.log(`sync: ${label}`);
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
    console.error(`sync: ${label} FAILED — nothing after it was run`);
    process.exit(1);
  }
};

const hasKnowledge = existsSync(join(KNOWLEDGE, 'scripts'));
if (hasKnowledge) {
  run('type-cards  ← knowledge/corpus/workflows/30-types', 'node', [join(KNOWLEDGE, 'scripts/build-type-catalog.mjs')]);
  run('source      ← knowledge/catalog (stitched + delivered)', 'node', [join(KNOWLEDGE, 'scripts/merge-endpoint-catalogs.mjs')]);
} else if (!quiet) {
  console.log('sync: knowledge/ not present — type-cards and source left as shipped');
}
run('skill-types ← type-cards.json copied into ghl-system-conventions + index rendered', 'node', [join(REPO, 'scripts/build-skill-types.mjs')]);
run('catalogue   ← source + overlay + capability manifest', 'node', [join(MCP, 'scripts/build-endpoint-catalog.mjs')], MCP);
run('manifests   ← TOOLS + audit descriptors', 'npm', ['run', '-s', 'manifest'], MCP);
run('dist        ← everything above, embedded', 'npm', ['run', '-s', 'build'], MCP);

const changed = GENERATED.filter((f) => digest(f) !== before[f]);
if (changed.length) {
  const status = new Map(git('status', '--porcelain').split('\n').filter(Boolean).map((l) => [l.slice(3), l.slice(0, 2).trim()]));
  console.log(`sync: ${changed.length} generated file(s) rewritten:`);
  for (const f of changed) {
    const st = status.get(f);
    console.log(`   ${f}  ${st ? `(${st} — commit it with your work)` : '(now identical to the committed copy)'}`);
  }
} else if (!quiet) {
  console.log('sync: everything was already current');
}

const gate = spawnSync('node', [join(REPO, 'scripts/check-generated-freshness.mjs')], { cwd: REPO, encoding: 'utf8' });
if (gate.status !== 0) {
  process.stderr.write(`${gate.stdout}${gate.stderr}`);
  console.error('sync: STILL STALE after regenerating — a generator is not idempotent, or writes somewhere the gate does not read');
  process.exit(1);
}
if (!quiet) console.log('sync: freshness gate green');
