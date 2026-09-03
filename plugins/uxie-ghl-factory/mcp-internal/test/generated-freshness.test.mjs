import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const root = mkdtempSync(join(tmpdir(), 'freshness-test-'));
  const mcp = join(root, 'mcp-internal');
  mkdirSync(join(mcp, 'scripts'), { recursive: true });
  cpSync(join(MCP, 'catalog'), join(mcp, 'catalog'), { recursive: true });
  cpSync(join(MCP, 'capability-manifest.json'), join(mcp, 'capability-manifest.json'));
  cpSync(join(MCP, 'scripts/build-endpoint-catalog.mjs'), join(mcp, 'scripts/build-endpoint-catalog.mjs'));
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
  const knowledge = mkdtempSync(join(tmpdir(), 'freshness-knowledge-'));
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

test('an unknown check name is refused, not silently ignored', () => {
  const { code, out } = run('--only', 'catalog');
  assert.equal(code, 2);
  assert.match(out, /unknown check "catalog"/);
});
