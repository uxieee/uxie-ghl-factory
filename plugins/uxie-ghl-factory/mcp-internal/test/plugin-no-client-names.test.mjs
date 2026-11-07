// w7-4 (orchestrator DECISION, second fail): the public plugin holds no client build names. Knowledge sniffs may keep them.
// The forbidden names are stored as SHA-256 digests, so this public file holds no plaintext client name.
// `dist/` is skipped: the rebuild-and-diff test already holds dist equal to the source it bundles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS = join(HERE, '..', '..', '..'); // mcp-internal/test -> mcp-internal -> uxie-ghl-factory -> plugins
const SKIP_DIRS = new Set(['dist', 'node_modules', '.git']);
const TEXT_EXT = /\.(mjs|cjs|js|ts|json|md|html|css|txt|yml|yaml)$/i;
const ROUND_ID = /^T1[67][a-d]$/i;
// SHA-256 of the lowercase single-word or two-word forbidden names (a client build's codename, its client, and its market).
const FORBIDDEN_DIGESTS = new Set([
  '6ea43e45ff5cd60af903bca062eb931cf0e6e336a7cb03dd9358586574476715', // a build codename
  'f4e84b010041170abbad72ca0d88448a5163e7184ce647d737187f3d1f9f5502', // a client account name
]);
const FORBIDDEN_BIGRAMS = new Set([
  'b94cac36517fb7abb03916e7f5cbac5a3d138a5497b39dffb4c587f4af7671fc', // a two-word market phrase
]);
const digest = (s) => createHash('sha256').update(s).digest('hex');

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* files(p);
    } else if (TEXT_EXT.test(name)) {
      yield p;
    }
  }
}

/** True when a line names a forbidden build: a single token, a two-word phrase, or a round id. */
function namesClient(line, digests = FORBIDDEN_DIGESTS, bigrams = FORBIDDEN_BIGRAMS) {
  const words = line.match(/[A-Za-z0-9]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if (digests.has(digest(w))) return true;
    if (ROUND_ID.test(words[i])) return true;
    if (i + 1 < words.length && bigrams.has(digest(`${w} ${words[i + 1].toLowerCase()}`))) return true;
  }
  return false;
}

test('the plugin source names no client build (digest-checked; round ids checked by pattern)', () => {
  const hits = [];
  for (const f of files(PLUGINS)) {
    if (basename(f) === 'plugin-no-client-names.test.mjs') continue; // this file holds the digests
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (namesClient(line)) hits.push(`${relative(PLUGINS, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('the matcher catches a digest-listed word, a round id, and a listed phrase; it passes ordinary text', () => {
  const probe = new Set([digest('probeword')]);
  const probePhrase = new Set([digest('probe one')]);
  assert.equal(namesClient('const x = "probeword";', probe, probePhrase), true);
  assert.equal(namesClient('a probe one build', probe, probePhrase), true);
  assert.equal(namesClient('source: round T17b', probe, probePhrase), true);
  assert.equal(namesClient('"name": "Franchise Support Team"', probe, probePhrase), false);
  assert.equal(namesClient('const fontSize = 12;', probe, probePhrase), false);
});
