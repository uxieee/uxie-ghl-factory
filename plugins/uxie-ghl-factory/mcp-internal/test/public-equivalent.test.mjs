import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicEquivalentFor, railDecisionFor } from '../scripts/rail-join.mjs';

// W4 (2026-10-29): each catalogue row names its public twins and the rail-ledger decision for its path, both joined by
// opKey from the copies knowledge ships (catalog/public-ops.json, catalog/rail-ledger.json).
const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = resolve(HERE, '..');
const shipped = JSON.parse(readFileSync(join(MCP, 'catalog/internal-endpoints.json'), 'utf8')).endpoints;

const ops = [
  { id: 'voice-ai__get-agent', method: 'GET', opKey: 'GET /voice-ai/agents/{}', deprecated: false },
  { id: 'voice-ai-v3__get-agent', method: 'GET', opKey: 'GET /voice-ai/agents/{}', deprecated: false },
  { id: 'emails__fetch-template', method: 'GET', opKey: 'GET /emails/builder', deprecated: true },
  { id: 'emails-v3__fetch-template', method: 'GET', opKey: 'GET /emails/builder', deprecated: false },
  { id: 'old__only', method: 'GET', opKey: 'GET /old/only', deprecated: true },
];

test('PUT /opportunities/pipelines/{id} lists opportunities-v3__update-pipeline first', () => {
  const row = shipped.find((e) => e.method === 'PUT' && /^\/opportunities\/pipelines\/\{[^}]+\}$/.test(e.path));
  assert.ok(row, 'the catalogue carries the pipeline update path');
  assert.equal(row.publicEquivalent?.[0], 'opportunities-v3__update-pipeline');
  assert.deepEqual(row.railDecision && { product: row.railDecision.product, job: row.railDecision.job }, { product: 'pipelines', job: 'edit' });
});

test('GET /voice-ai/agents/:agentId joins by opKey', () => {
  assert.deepEqual(publicEquivalentFor({ method: 'GET', path: '/voice-ai/agents/:agentId' }, ops), ['voice-ai-v3__get-agent', 'voice-ai__get-agent']);
});

test('an endpoint with no public twin has no publicEquivalent', () => {
  assert.equal(publicEquivalentFor({ method: 'GET', path: '/workflow/{locationId}/list' }, ops), null);
  const row = shipped.find((e) => e.method === 'GET' && e.path === '/workflow/{locationId}/list');
  assert.ok(row && !('publicEquivalent' in row));
});

test('a deprecated twin is dropped when a live one exists', () => {
  assert.deepEqual(publicEquivalentFor({ method: 'GET', path: '/emails/builder' }, ops), ['emails-v3__fetch-template']);
  assert.deepEqual(publicEquivalentFor({ method: 'GET', path: '/old/only/' }, ops), ['old__only'], 'a deprecated-only twin is still named');
});

test('railDecision comes from the ledger row that claims the opKey', () => {
  const ledger = { rows: [{ product: 'voice-ai', job: 'read', decision: 'undecided', sharedPaths: ['GET /voice-ai/agents/{agentId}'] }] };
  assert.deepEqual(railDecisionFor({ method: 'GET', path: '/voice-ai/agents/:id' }, ledger), { product: 'voice-ai', job: 'read', decision: 'undecided' });
  assert.equal(railDecisionFor({ method: 'DELETE', path: '/voice-ai/agents/:id' }, ledger), null);
});

test('the build fails when a ledger copy is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'rail-join-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(join(MCP, 'catalog'), join(root, 'catalog'), { recursive: true });
    cpSync(join(MCP, 'capability-manifest.json'), join(root, 'capability-manifest.json'));
    for (const f of ['build-endpoint-catalog.mjs', 'rail-join.mjs']) cpSync(join(MCP, 'scripts', f), join(root, 'scripts', f));
    rmSync(join(root, 'catalog/rail-ledger.json'));
    const r = spawnSync('node', [join(root, 'scripts/build-endpoint-catalog.mjs'), '--out', join(root, 'out.json')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /rail-ledger\.json/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('about 160 catalogue rows carry a publicEquivalent', () => {
  const n = shipped.filter((e) => e.publicEquivalent?.length).length;
  assert.ok(n >= 130 && n <= 200, `${n} rows`);
});

test('search_endpoints and describe_endpoint show the public twin and the ledger decision', async () => {
  const { TOOLS } = await import('../core/tools.mjs');
  const tool = (n) => TOOLS.find((t) => t.name === n);
  const deps = { state: { tokenFile: '/nonexistent' }, makeGw: () => { throw new Error('no network in this test'); } };
  const row = shipped.find((e) => e.method === 'PUT' && /^\/opportunities\/pipelines\/\{[^}]+\}$/.test(e.path));
  const d = await tool('describe_endpoint').handler({ id: row.id }, deps);
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.data.publicEquivalent.actions[0], 'opportunities-v3__update-pipeline');
  assert.deepEqual([d.data.railDecision.product, d.data.railDecision.job], ['pipelines', 'edit']);
  assert.match(d.data.railDecision.why, /Not decided yet/);
  const s = await tool('search_endpoints').handler({ intent: 'update pipeline stages', method: 'PUT', limit: 20 }, deps);
  const hit = s.data.results.find((x) => x.id === row.id);
  assert.ok(hit, 'the pipeline update row is found');
  assert.equal(hit.publicEquivalent[0], 'opportunities-v3__update-pipeline');
  assert.equal(hit.railDecision.decision, 'undecided');
});

test('a decided row stamps its decision only on the paths its read proved; its other paths read undecided', () => {
  const ledger = { rows: [{ product: 'forms', job: 'read', decision: 'pool-internal', sharedPaths: ['GET /forms', 'GET /surveys'], provenPaths: ['GET /forms'] }] };
  assert.deepEqual(railDecisionFor({ method: 'GET', path: '/forms/' }, ledger), { product: 'forms', job: 'read', decision: 'pool-internal' });
  assert.deepEqual(railDecisionFor({ method: 'GET', path: '/surveys' }, ledger), { product: 'forms', job: 'read', decision: 'undecided', decidedOn: ['GET /forms'] });
  const stamped = shipped.find((e) => e.method === 'GET' && e.path === '/surveys');
  assert.ok(stamped, 'the catalogue carries GET /surveys');
  assert.equal(stamped.railDecision?.decision, 'undecided', 'GET /surveys was never read, so it carries no decision');
});
