import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

// D2 — nothing in test/ read the endpoint catalogue at all, which is exactly why a hardcoded "222"
// outlived it reaching 235 and shipped stale in two places in the same file.
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(resolve(HERE, '..', p), 'utf8'));
const catalog = read('catalog/internal-endpoints.json');
const source = read('catalog/internal-endpoints.source.json');
const overlay = read('catalog/endpoint-overlay.json').rows;

test('the declared count matches the array', () => {
  assert.equal(catalog.count, catalog.endpoints.length);
});

test('no shipped description states an endpoint count that disagrees with the catalogue', () => {
  for (const t of TOOLS) {
    for (const m of t.description.matchAll(/\b(\d{3,4})\s+internal endpoints?\b/g)) {
      assert.equal(Number(m[1]), catalog.endpoints.length,
        `${t.name} advertises ${m[1]} endpoints; the catalogue holds ${catalog.endpoints.length}`);
    }
  }
});

test('every id is unique — it is what describe_endpoint addresses', () => {
  const ids = catalog.endpoints.map((e) => e.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(dupes)], [], 'duplicate endpoint ids');
});

test('paths are full wire paths and origins carry no path', () => {
  for (const e of catalog.endpoints) {
    assert.ok(e.path.startsWith('/'), `${e.id} path is not absolute`);
    assert.match(e.origin, /^https?:\/\/[^/]+$/, `${e.id} origin carries a path`);
    assert.ok(!e.path.includes('%7B'), `${e.id} carries percent-encoded braces`);
    // Every non-parameter segment must have a literal — a path of nothing but {params} is a
    // base-class template, not an endpoint.
    assert.match(e.path.replace(/\{[^}]*\}/g, ''), /[a-zA-Z]/, `${e.id} has no literal path segment`);
  }
});

test('the compiled catalogue is the source artefact plus adopted typed-tool rows', () => {
  // The compiler ADOPTS endpoints our own typed tools call that no source tree produced a row for
  // — their front-end has no mineable bundle. So the compiled count is source + adopted, and the
  // delta must be exactly those rows rather than drift.
  const adopted = catalog.endpoints.filter((e) => e.tree === 'typed-tool');
  assert.equal(catalog.endpoints.length, source.endpoints.length + adopted.length,
    'compiled catalogue is stale — run `node scripts/build-endpoint-catalog.mjs`');
  for (const e of adopted) {
    assert.ok(e.coveredBy.length, `${e.id} was adopted from a tool but names none`);
    assert.equal(e.reach, 'proven', `${e.id} is called by a shipped tool, so it is proven`);
  }
});

test('every overlay key resolves to a row', () => {
  // When the miner corrects a path, the overlay key attached to it orphans. That is intended and
  // must be LOUD: a corrected path is exactly when a human should re-check the note on it.
  const known = new Set(catalog.endpoints.map((e) => `${e.method} ${e.path}`));
  const orphans = Object.keys(overlay).filter((k) => !known.has(k));
  assert.deepEqual(orphans, [], 'orphaned overlay keys');
});

test('a facet marked resolved actually carries properties', () => {
  for (const e of catalog.endpoints) {
    for (const facet of ['body', 'returns']) {
      if (e[facet]?.confidence === 'resolved') {
        assert.ok(Array.isArray(e[facet].properties) && e[facet].properties.length,
          `${e.id} ${facet} claims resolved with no properties`);
      }
    }
  }
});

test('rawCallable is false only for a reason the row states', () => {
  const GATEWAY_SENDS = new Set(['channel', 'source', 'version']);
  for (const e of catalog.endpoints.filter((x) => x.rawCallable === false)) {
    const odd = (e.extraHeaders ?? []).filter((h) => !GATEWAY_SENDS.has(h.toLowerCase()));
    const nonJson = e.transport !== 'json' || !['json', 'text'].includes(e.responseMode);
    assert.ok(odd.length || nonJson,
      `${e.id} is marked not raw-callable but nothing on the row explains why`);
  }
});

test('the endpoints the plugin actually calls every day are present', () => {
  // Each of these was ABSENT from every catalogue before the compiler rewrite, while typed tools
  // called them daily. Their absence is the clearest measure of what the old miner could not see.
  const must = [
    'POST /workflow/{locationId}/trigger',
    'GET /workflows/logs/v2',
    'GET /workflows/sticky-notes-all',
    'POST /workflow/{locationId}/validate-assets',
  ];
  const known = new Set(catalog.endpoints.map((e) => `${e.method} ${e.path}`));
  for (const m of must) assert.ok(known.has(m), `${m} is missing from the catalogue`);
});
