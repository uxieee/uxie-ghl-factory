import { test as nodeTest } from 'node:test';
import { rmSync } from 'node:fs';
// Every temp directory this file makes is registered here and removed in the finally block of its own test, so a run leaves nothing
// behind (each one holds a copy of the endpoint catalogue, about 26 MB).
const made = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); made.push(d); return d; };
const test = (name, fn) => nodeTest(name, (t) => {
  const mark = made.length;
  try {
    return fn(t);
  } finally {
    for (const d of made.splice(mark)) rmSync(d, { recursive: true, force: true });
  }
});
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectLedger } from '../scripts/lib/public-projection.mjs';

// The freshness gate (scripts/check-generated-freshness.mjs at the repo root) is what stands
// between a corpus update and a release cut from the OLD compiled artefacts. A gate that passes
// on a stale tree is worse than no gate, so this pins it from both sides: green on the real
// tree, and red — naming the row — when a shipped artefact is made stale on purpose.
//
// Fails-on-reintroduction is the whole test. Same pattern as the privacy gate's own tests.

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = resolve(HERE, '..');
const PLUGIN = resolve(MCP, '..');
const REPO = resolve(PLUGIN, '..', '..');
const GATE = join(REPO, 'scripts/check-generated-freshness.mjs');

const run = (...args) => {
  const r = spawnSync('node', [GATE, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

// A plugin root holding only what the catalogue check needs: the compiler, its inputs, and the
// shipped output. The compiler resolves everything relative to its own location, so the copy
// must keep the mcp-internal/{scripts,catalog,capability-manifest.json} shape.
function scratchPluginRoot() {
  const root = tempDir('freshness-test-');
  const mcp = join(root, 'mcp-internal');
  mkdirSync(join(mcp, 'scripts'), { recursive: true });
  cpSync(join(MCP, 'catalog'), join(mcp, 'catalog'), { recursive: true });
  cpSync(join(MCP, 'capability-manifest.json'), join(mcp, 'capability-manifest.json'));
  cpSync(join(MCP, 'scripts/build-endpoint-catalog.mjs'), join(mcp, 'scripts/build-endpoint-catalog.mjs'));
  cpSync(join(MCP, 'scripts/rail-join.mjs'), join(mcp, 'scripts/rail-join.mjs'));
  return { root, mcp };
}

test('the real tree is fresh (catalogue + manifests + skill-types — the checks that need no sibling repo)', () => {
  const { code, out } = run('--only', 'catalogue,manifests,skill-types');
  assert.equal(code, 0, out);
  assert.match(out, /freshness: catalogue\s+ok/);
  assert.match(out, /freshness: manifests\s+ok/);
  assert.match(out, /freshness: skill-types\s+ok/);
});

test('the checks that need knowledge/ either pass or say they skipped — never fail for its absence', () => {
  const { code, out } = run('--only', 'type-cards,source');
  assert.equal(code, 0, out);
  assert.match(out, /freshness: type-cards\s+(ok|skipped)/);
  assert.match(out, /freshness: source\s+(ok|skipped)/);
});

test('a compiled catalogue missing a row and carrying a flipped kind is STALE, and both rows are named', () => {
  const { root, mcp } = scratchPluginRoot();
  const path = join(mcp, 'catalog/internal-endpoints.json');
  const cat = JSON.parse(readFileSync(path, 'utf8'));
  const dropped = cat.endpoints.find((e) => e.tree !== 'typed-tool');
  const flipped = cat.endpoints.find((e) => e.id !== dropped.id && e.kind === 'read');
  cat.endpoints = cat.endpoints.filter((e) => e.id !== dropped.id);
  flipped.kind = 'destructive';
  cat.count = cat.endpoints.length;
  writeFileSync(path, `${JSON.stringify(cat, null, 2)}\n`);

  const { code, out } = run('--plugin-root', root, '--only', 'catalogue');
  assert.equal(code, 1, out);
  assert.match(out, /freshness: catalogue\s+STALE/);
  assert.ok(out.includes(`+ ${dropped.id}`), `the dropped row must be reported as new-in-regeneration:\n${out}`);
  assert.ok(out.includes(`~ ${flipped.id}`), `the flipped row must be reported as changed:\n${out}`);
  assert.match(out, /kind: "destructive" → "read"/, 'the changed FIELD is named, shipped → regenerated');
  assert.match(out, /fix: .*build-endpoint-catalog\.mjs/);
});

test('a source artefact that knowledge/ has moved past is STALE, naming the rows the plugin lacks', () => {
  const { root, mcp } = scratchPluginRoot();
  const knowledge = tempDir('freshness-knowledge-');
  mkdirSync(join(knowledge, 'scripts'));
  mkdirSync(join(knowledge, 'catalog'));
  const src = JSON.parse(readFileSync(join(mcp, 'catalog/internal-endpoints.source.json'), 'utf8'));
  const template = src.endpoints[0];
  src.endpoints.push({ ...template, id: 'freshness-test--newly-mined-row', path: '/freshness-test/newly-mined' });
  src.generated = '2099-01-01';
  writeFileSync(join(knowledge, 'catalog/internal-endpoints.source.json'), `${JSON.stringify(src, null, 2)}\n`);

  const { code, out } = run('--plugin-root', root, '--knowledge', knowledge, '--only', 'source');
  assert.equal(code, 1, out);
  assert.match(out, /freshness: source\s+STALE/);
  assert.match(out, /knowledge\/ has 2099-01-01/);
  assert.ok(out.includes('+ freshness-test--newly-mined-row'), out);
  assert.match(out, /fix: .*merge-endpoint-catalogs\.mjs/);
});

test('freshness fails on a stale public-ops snapshot and skips when public-api-mcp is absent', (t) => {
  const KNOWLEDGE = resolve(REPO, '..', 'knowledge');
  const PUBLIC = resolve(REPO, '..', 'public-api-mcp', 'data/catalog.json');
  if (!existsSync(join(KNOWLEDGE, 'scripts/snapshot-public-ops.mjs')) || !existsSync(PUBLIC)) return t.skip('knowledge/ or public-api-mcp/ not beside this repo');
  const { root, mcp } = scratchPluginRoot();
  const knowledge = tempDir('freshness-knowledge-');
  mkdirSync(join(knowledge, 'scripts')); mkdirSync(join(knowledge, 'catalog'));
  for (const f of ['snapshot-public-ops.mjs', 'check-rail-ledger.mjs']) cpSync(join(KNOWLEDGE, 'scripts', f), join(knowledge, 'scripts', f));
  // A snapshot taken before the public catalogue gained an op: the same stale bytes in knowledge and in the plugin copy,
  // so only the re-projection can see it.
  const snap = JSON.parse(readFileSync(join(mcp, 'catalog/public-ops.json'), 'utf8'));
  const gone = snap.ops.find((o) => o.id === 'opportunities-v3__update-pipeline');
  snap.ops = snap.ops.filter((o) => o !== gone);
  for (const dir of [join(knowledge, 'catalog'), join(mcp, 'catalog')]) writeFileSync(join(dir, 'public-ops.json'), `${JSON.stringify(snap, null, 2)}\n`);
  cpSync(join(mcp, 'catalog/rail-ledger.json'), join(knowledge, 'catalog/rail-ledger.json'));
  const pub = tempDir('freshness-public-');
  mkdirSync(join(pub, 'data')); cpSync(PUBLIC, join(pub, 'data/catalog.json'));

  const stale = run('--plugin-root', root, '--knowledge', knowledge, '--public-api', pub, '--only', 'rail-ledger');
  assert.equal(stale.code, 1, stale.out);
  assert.match(stale.out, /freshness: rail-ledger\s+STALE/);
  assert.ok(stale.out.includes('+ opportunities-v3__update-pipeline'), stale.out);
  assert.match(stale.out, /fix: .*snapshot-public-ops\.mjs/);

  const absent = run('--plugin-root', root, '--knowledge', knowledge, '--public-api', join(pub, 'nowhere'), '--only', 'rail-ledger');
  assert.equal(absent.code, 0, absent.out);
  assert.match(absent.out, /freshness: rail-ledger\s+ok .*public-api-mcp not present/);
});

test('rail-ledger copies that knowledge/ has moved past are STALE', () => {
  const { root, mcp } = scratchPluginRoot();
  const knowledge = tempDir('freshness-knowledge-');
  mkdirSync(join(knowledge, 'scripts')); mkdirSync(join(knowledge, 'catalog'));
  cpSync(join(mcp, 'catalog/public-ops.json'), join(knowledge, 'catalog/public-ops.json'));
  const ledger = JSON.parse(readFileSync(join(mcp, 'catalog/rail-ledger.json'), 'utf8'));
  ledger.rows[0].decision = 'both';
  writeFileSync(join(knowledge, 'catalog/rail-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  const { code, out } = run('--plugin-root', root, '--knowledge', knowledge, '--public-api', join(knowledge, 'nowhere'), '--only', 'rail-ledger');
  assert.equal(code, 1, out);
  assert.match(out, /rail-ledger\.json differs from knowledge/);
  assert.match(out, /fix: npm run sync/);
});

test('a skill block that no longer matches the ledger is STALE, naming the file', () => {
  const { root, mcp } = scratchPluginRoot();
  cpSync(join(MCP, 'scripts/render-rail-ledger.mjs'), join(mcp, 'scripts/render-rail-ledger.mjs'));
  cpSync(join(PLUGIN, 'skills'), join(root, 'skills'), { recursive: true });
  assert.equal(run('--plugin-root', root, '--only', 'rail-blocks').code, 0);
  const f = join(root, 'skills/ghl-voice-ai/SKILL.md');
  writeFileSync(f, readFileSync(f, 'utf8').replace('<!-- /rail-ledger:voice-ai -->', 'hand edit\n<!-- /rail-ledger:voice-ai -->'));
  const { code, out } = run('--plugin-root', root, '--only', 'rail-blocks');
  assert.equal(code, 1, out);
  assert.match(out, /freshness: rail-blocks\s+STALE/);
  assert.match(out, /ghl-voice-ai\/SKILL\.md/);
  assert.match(out, /fix: .*render-rail-ledger\.mjs/);
});

test('a ledger the knowledge validator refuses is STALE, even when the copies match', (t) => {
  const KNOWLEDGE = resolve(REPO, '..', 'knowledge');
  if (!existsSync(join(KNOWLEDGE, 'scripts/check-rail-ledger.mjs'))) return t.skip('knowledge/ not beside this repo');
  const { root, mcp } = scratchPluginRoot();
  const knowledge = tempDir('freshness-knowledge-');
  for (const d of ['scripts', 'catalog', 'corpus']) mkdirSync(join(knowledge, d));
  cpSync(join(KNOWLEDGE, 'scripts/check-rail-ledger.mjs'), join(knowledge, 'scripts/check-rail-ledger.mjs'));
  for (const f of ['public-ops.json', 'internal-endpoints.source.json']) cpSync(join(KNOWLEDGE, 'catalog', f), join(knowledge, 'catalog', f));
  cpSync(join(KNOWLEDGE, 'corpus/surfaces.json'), join(knowledge, 'corpus/surfaces.json'));
  cpSync(join(KNOWLEDGE, 'sniffs/rail-ledger-2026-10-29'), join(knowledge, 'sniffs/rail-ledger-2026-10-29'), { recursive: true });
  cpSync(join(KNOWLEDGE, 'sniffs/opp-wave-2026-09-25'), join(knowledge, 'sniffs/opp-wave-2026-09-25'), { recursive: true });
  // A hand edit that decides a row its read does not support — the same bytes in knowledge and in the plugin copy.
  // Knowledge's own ledger is the source (the plugin copy is projected, so the validator's sniff: refs no longer resolve).
  const ledger = JSON.parse(readFileSync(join(KNOWLEDGE, 'catalog/rail-ledger.json'), 'utf8'));
  ledger.rows.find((r) => r.product === 'calendars' && r.job === 'read').decision = 'pool-public';
  writeFileSync(join(knowledge, 'catalog', 'rail-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  writeFileSync(join(mcp, 'catalog', 'rail-ledger.json'), `${JSON.stringify(projectLedger(ledger), null, 2)}\n`);
  cpSync(join(mcp, 'catalog/public-ops.json'), join(knowledge, 'catalog/public-ops.json'));
  const { code, out } = run('--plugin-root', root, '--knowledge', knowledge, '--public-api', join(knowledge, 'nowhere'), '--only', 'rail-ledger');
  assert.equal(code, 1, out);
  assert.match(out, /freshness: rail-ledger\s+STALE/);
  assert.match(out, /calendars\/read: criterion capability must be one of/);
  assert.match(out, /fix: .*build-rail-ledger\.mjs/);
});

test('an unknown check name is refused, not silently ignored', () => {
  const { code, out } = run('--only', 'catalog');
  assert.equal(code, 2);
  assert.match(out, /unknown check "catalog"/);
});
