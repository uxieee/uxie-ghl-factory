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
    // `proven` is the FLOOR, not the value: a shipped tool calls this path on every run, so it can
    // never be weaker. It may be stronger — an overlay row is a human who probed the endpoint on a
    // live account, and until 0.64.0 those rows were the only ones in the catalogue that could not
    // carry one. Anything OTHER than those two is drift and still fails here.
    const key = `${e.method} ${e.path}`;
    assert.ok(['proven', 'proven-live'].includes(e.reach),
      `${e.id} is called by a shipped tool, so it is proven or better — got ${e.reach}`);
    if (e.reach !== 'proven') {
      assert.equal(e.reach, overlay[key]?.reach,
        `${e.id} claims ${e.reach} but no overlay row says so — a stronger verdict needs a human who probed it`);
    }
  }
});

test('an overlay row aimed at an adopted endpoint reaches it, rather than orphaning', () => {
  // The gap this closes: adopted rows never consulted the overlay, so a curated trap note aimed at
  // one silently orphaned — on exactly the rows where a note is worth most, because a shipped tool
  // calls them every run. `attach-offer-user` is the case that found it: its 200 says
  // "successfully queued" for an empty body, and nothing in the catalogue said so.
  const adopted = catalog.endpoints.filter((e) => e.tree === 'typed-tool');
  const annotated = adopted.filter((e) => overlay[`${e.method} ${e.path}`]);
  assert.ok(annotated.length, 'no adopted row is annotated — if that is deliberate, delete this test');
  for (const e of annotated) {
    const o = overlay[`${e.method} ${e.path}`];
    if (o.note) assert.equal(e.note, o.note, `${e.id} dropped its overlay note`);
    if (o.summary) assert.equal(e.summary, o.summary, `${e.id} dropped its overlay summary`);
  }
});

test('one row per endpoint — no method+origin+path ships twice', () => {
  // Three endpoints shipped TWICE (2026-09-07): a source-only row from the corpus and a
  // `typed-tool` twin marked proven. The adoption guard compares a capability's path against the
  // catalogue, and `normalize` stripped parameter NAMES but not the QUERY STRING — so the six
  // capabilities that carry required query switches matched nothing, lost their `coveredBy` on the
  // real row, and were adopted as duplicates. An agent reading the source-only twin was told
  // nothing covered a path a shipped tool calls on every run.
  const seen = new Map();
  const dupes = [];
  for (const e of catalog.endpoints) {
    const key = `${e.method} ${e.origin}${e.path}`;
    if (seen.has(key)) dupes.push(`${key}  (${seen.get(key).tree} + ${e.tree})`);
    seen.set(key, e);
  }
  assert.deepEqual(dupes, []);
});

test('every typed-tool capability is matched to a row or adopted — none silently unmatched', () => {
  // The other half of the same defect: a capability that matches no row must become an adopted
  // row, never vanish. Compares the way the build does, query stripped.
  const norm = (p) => String(p).split('?')[0].replace(/\{[A-Za-z0-9_]+\}/g, '{p}').replace(/\/$/, '');
  const rows = new Set(catalog.endpoints.map((e) => `${e.method} ${norm(e.path)}`));
  const manifest = read('capability-manifest.json');
  const orphans = manifest
    .map((c) => ({ ...c, key: `${c.method} ${norm(c.path.replace(/\{loc\}/g, '{locationId}').replace(/\{wid\}/g, '{workflowId}'))}` }))
    .filter((c) => !rows.has(c.key))
    .map((c) => `${c.tool}: ${c.method} ${c.path}`);
  assert.deepEqual(orphans, []);
});

test('sidecar proof promotes reach exactly as far as it is allowed to', () => {
  // `proof: executed` means the surface author called it live and read writes back on a separate
  // request; `observed` means it was read out of the app's request builders and never called.
  // Executed promotes to `proven`. It must NOT reach `proven-live`, which is reserved for a dated
  // overlay note this build can point at. Observed promotes nothing.
  // Keyed with the ORIGIN: several endpoints exist on both hosts (the sidecar declares
  // backend for /ai-wrapper while the harvester's prefix table files a page-scraped twin on
  // services), and a key without the host silently compares one against the other.
  const byKey = new Map(catalog.endpoints.map((e) => [`${e.method} ${e.origin}${e.path}`, e]));
  for (const row of source.endpoints) {
    const e = byKey.get(`${row.method} ${row.origin}${row.path}`);
    if (!e || !row.proof) continue;
    assert.equal(e.proof, row.proof, `${row.method} ${row.path} lost its proof in the build`);
    // Resolved the way the BUILD resolves it: by shape when no key matches exactly, because a
    // route's parameter names are ours and the catalogue renames them. Comparing exact keys here
    // reported a curated reach as an unearned promotion.
    const shape = (m, path) => `${m} ${path.replace(/\{[^}]*\}/g, '{}')}`;
    const curatedKey = overlay[`${row.method} ${row.path}`]
      ? `${row.method} ${row.path}`
      : Object.keys(overlay).find((k) => shape(...k.split(/ (.*)/s).slice(0, 2)) === shape(row.method, row.path));
    const curated = overlay[curatedKey]?.reach;
    if (curated) { assert.equal(e.reach, curated, 'the hand-curated overlay must outrank sidecar proof'); continue; }
    assert.equal(e.reach, row.proof === 'executed' ? 'proven' : 'source-only',
      `${row.method} ${row.path} carries proof:${row.proof} and reach:${e.reach}`);
  }
  assert.ok(catalog.endpoints.some((e) => e.proof === 'executed'), 'no executed rows reached the catalogue at all');
});

test('a folded spelling that names a location survives on the row, for the guard to read', () => {
  // The catalogue folds /lists/dynamic/{locationId} into /lists/dynamic/{smartListId}: one route,
  // one row. The location guard decides whether a path targets another account by finding
  // {locationId} in a template, so the fold must not take that word out of its reach.
  const row = catalog.endpoints.find((e) => e.method === 'GET' && e.path === '/lists/dynamic/{smartListId}');
  assert.ok(row, 'the smart-list row must be in the catalogue');
  assert.ok((row.aka ?? []).includes('/lists/dynamic/{locationId}'),
    'the location-bearing spelling must survive as aka');
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
