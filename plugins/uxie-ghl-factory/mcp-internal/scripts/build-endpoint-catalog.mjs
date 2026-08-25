#!/usr/bin/env node
// Compile the shipped endpoint catalogue: the source artefact from knowledge/, plus this repo's
// own overlay, plus the two facts that are true of THIS SERVER rather than of GHL.
//
// WHY THIS IS A SEPARATE STEP FROM THE MINER
// ------------------------------------------
// knowledge/ owns what the GHL source says: origin, path, transport, params, types. It has no
// remote and must never depend on the plugin. This repo owns what a caller needs on top -- whether
// a typed tool already covers a row, whether raw_request can even make the call, and the curated
// kind/summary/note/reach. Merging in the miner would put a plugin dependency inside knowledge/,
// which the repo's one-way rule forbids and which would make the miner unrunnable on its own.
//
// The overlay is HAND-MAINTAINED and this script never writes to it. Regeneration therefore cannot
// erase a summary, a trap or a live reach result -- the failure mode that made an earlier design
// lose its own findings on every rebuild.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SOURCE = resolve(ROOT, 'catalog/internal-endpoints.source.json');
const OVERLAY = resolve(ROOT, 'catalog/endpoint-overlay.json');
const MANIFEST = resolve(ROOT, 'capability-manifest.json');
const OUT = resolve(ROOT, 'catalog/internal-endpoints.json');

const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8')).rows ?? {};
// Read the capability manifest rather than importing TOOLS: tools.mjs reads the catalogue this
// script writes, so importing it here would make the build depend on its own output.
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// One canonical notation for the join. Typed tools write {loc}/{wid}; the miner writes
// {locationId}/{workflowId}. Comparing them literally is why the old join matched 17 of 158.
const normalize = (p) => String(p).replace(/\{[A-Za-z0-9_]+\}/g, '{p}').replace(/\/$/, '');

const coverage = new Map();
for (const row of manifest) {
  const key = `${row.method} ${normalize(row.path)}`;
  if (!coverage.has(key)) coverage.set(key, new Set());
  coverage.get(key).add(row.tool);
}

// Whether raw_request can actually make this call. It handles JSON REST on two fused host/auth
// modes and nothing else: the gateway JSON.stringifies every ordinary body and res.text()s every
// ordinary response, and raw_request exposes no header parameter and never calls gw.stream().
// A row that fails this test gets NO callWith, because an instruction that cannot work is worse
// than silence.
// Channel/Source/Version are NOT endpoint-specific: core/gateway.mjs sends all three on every
// single call. Counting them as "extra" marked 106 perfectly callable rows unreachable on the
// first run of this script. What actually blocks raw_request is a header it has no way to set --
// developer_version, x-workflow-id, sourceid.
// What the gateway puts on every raw_request. `sourceid` joined the list once raw_request started
// sending it (it is the locationId, which the tool already requires).
//
// AND A CORRECTION WORTH KEEPING: extraHeaders records what the FRONT-END PINS, which is not the
// same as what the SERVER REQUIRES. Treating the two as one marked all 160 memberships rows
// unreachable. Live-proven 2026-08-25 on the designated test sub-account:
// GET /membership/locations/{loc}/products returns 200 WITHOUT sourceid, on both the backend and
// services origins. A pinned header is a hint about the caller, not a requirement of the callee.
const GATEWAY_SENDS = new Set(['channel', 'source', 'version', 'sourceid']);
const rawCallable = (row) => row.transport === 'json'
  && (row.responseMode === 'json' || row.responseMode === 'text')
  && (row.extraHeaders ?? []).every((h) => GATEWAY_SENDS.has(String(h).toLowerCase()));

const unmatchedOverlay = [];
const seen = new Set(Object.keys(overlay));

const endpoints = source.endpoints.map((row) => {
  const key = `${row.method} ${row.path}`;
  const extra = overlay[key] ?? {};
  seen.delete(key);
  const covered = [...(coverage.get(`${row.method} ${normalize(row.path)}`) ?? [])].sort();
  return {
    id: row.id,
    method: row.method,
    url: `${row.origin}${row.path}`,
    path: row.path,
    origin: row.origin,
    rail: row.authRail === 'bearer+token-id' ? 'ai' : 'workflow',
    kind: extra.kind ?? (row.method === 'GET' ? 'read' : row.method === 'DELETE' ? 'destructive' : 'write'),
    ...(extra.summary ? { summary: extra.summary } : {}),
    ...(extra.note ? { note: extra.note } : {}),
    reach: extra.reach ?? 'source-only',
    coveredBy: covered,
    rawCallable: rawCallable(row),
    transport: row.transport,
    responseMode: row.responseMode,
    extraHeaders: row.extraHeaders ?? [],
    operation: row.operation,
    service: row.service,
    pathParams: [...String(row.path).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => ({ name: m[1] })),
    // Keys LEARNED FROM THE WIRE. The F2 ledger called the endpoint, it answered 400/422, and GHL
    // named what it wanted. The static extractor cannot reach these: the builder passes them through
    // a spread it can only honestly mark open-map. They are merged in front of the mined keys and
    // marked required, because the endpoint said so.
    query: [
      ...(extra.requiredQuery ?? [])
        .filter((n) => !(row.query ?? []).some((q) => q.name === n))
        .map((n) => ({ name: n, type: 'string', required: true, source: 'live-probe' })),
      ...(row.query ?? []),
    ],
    body: row.body ?? null,
    returns: row.returns ?? null,
    confidence: row.confidence,
    sources: row.sources,
  };
});

for (const key of seen) unmatchedOverlay.push(key);

// G10 — an overlay key that matches no row. Named, never counted: when the miner corrects a path,
// that is exactly the moment a human should re-check the note attached to it.
if (unmatchedOverlay.length) {
  console.error('\nORPHANED OVERLAY KEYS — these match no row:');
  for (const k of unmatchedOverlay) console.error(`  ${k}`);
}

// G6, reported and NOT gated -- deliberately, and this is worth being straight about. The spec
// asks that every non-GET row carry a curated kind. That is 106 rows of hand work that has not
// been done, and gating on it now would either block the build or invite someone to bulk-fill the
// file with guesses, which is worse than the honest default. The default is `write`, which is
// already demoted for read-shaped intents; what curation buys is `destructive`, and that list is
// seeded from the endpoints known to do real damage. The count is printed so it cannot be
// forgotten, and it should shrink.
const uncurated = endpoints.filter((e) => e.method !== 'GET' && e.method !== 'DELETE' && !overlay[`${e.method} ${e.path}`]?.kind);

const withSummary = endpoints.filter((e) => e.summary).length;
const withNote = endpoints.filter((e) => e.note).length;
const covered = endpoints.filter((e) => e.coveredBy.length).length;

writeFileSync(OUT, `${JSON.stringify({
  generated: source.generated,
  source: source.source,
  note: 'Compiled from internal-endpoints.source.json (mined by knowledge/) plus this repo\'s '
      + 'endpoint-overlay.json. `path` is the FULL wire path raw_request takes; `origin` is scheme '
      + 'and host only. A row proves the GHL builder calls that path — not that your token reaches '
      + 'it, and not that calling it is safe. rawCallable:false means raw_request cannot make this '
      + 'call at all (multipart, SSE, blob, or an endpoint-specific header).',
  count: endpoints.length,
  endpoints,
}, null, 2)}\n`);

console.log(`endpoints        : ${endpoints.length}`);
console.log(`with a summary   : ${withSummary}`);
console.log(`with a trap note : ${withNote}`);
console.log(`covered by a tool: ${covered}`);
console.log(`raw-callable     : ${endpoints.filter((e) => e.rawCallable).length}`);
console.log(`reach refused    : ${endpoints.filter((e) => e.reach === 'refused').length}`);
console.log(`uncurated non-GET: ${uncurated.length}`);
if (unmatchedOverlay.length) process.exit(1);
