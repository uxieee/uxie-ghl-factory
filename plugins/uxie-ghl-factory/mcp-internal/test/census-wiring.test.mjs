// Wiring of the census (QA 2026-11-22): the strict Agent Studio folders read is always made when Agent Studio is complete (foldered or not) and is what clears it; the two contact-creating proof modules refuse without a census gate.
// Shapes: the listing {items, folders, total, totalAgents, totalFolders, page, pageSize, hasMore} and a folder's members {agents[], total, page, pageSize, hasMore, traceId} (committed, read 2026-09-28). Ids are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convAiCensus } from '../../skills/create-ghl-workflow/scripts/convai-census.mjs';
import { runMultipathInsertProof } from '../../skills/create-ghl-workflow/scripts/multipath-insert-proof.mjs';
import { runDeleteBranchProof } from '../../skills/create-ghl-workflow/scripts/delete-branch-proof.mjs';
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '../../skills/create-ghl-workflow/scripts');
const LOC = 'locAAAAAAAAAAAAAAAAA';
import { getAiConfigurationBundle } from '../core/audit-configuration.mjs';
import { makeAuditCircuit, makeAuditGateway, makeAuditLimiter } from '../core/audit-gateway.mjs';
// The component is built by the REAL audit-configuration code over a fake gateway (it has no totalFolders key: that is why the folders read is always required).
const rail = (name, respond) => ({ rail: name, async callWithMeta(method, target) { const [path, search = ''] = String(target).split('?'); return { status: 200, ok: true, json: {}, retryAfterMs: null, capturedAt: '2026-11-22T00:00:00Z', ...respond({ method, path, query: Object.fromEntries(new URLSearchParams(search)) }) }; } });
const draftDetail = (id) => ({ id, status: 'draft', hasPublishedVersion: false, hasUnpublishedChanges: false, versionId: 'v', config: { triggers: [] } });
const realBundle = async ({ items = ['agent-0001', 'agent-0002'], folders = [], total = items.length } = {}) => {
  const ai = rail('ai', ({ path }) => {
    if (path === '/agent-studio/agents/agents-with-folders') return { json: { items: items.map((id) => ({ id })), folders: folders.map((id) => ({ id })), total, totalAgents: total, totalFolders: folders.length, page: 1, pageSize: 100, hasMore: false } };
    if (path.startsWith('/agent-studio/')) return { json: draftDetail(path.split('/').pop()) };
    if (path === '/voice-ai/agents/simple') return { json: { agents: [] } };
    return { json: { agents: [], employees: [], totalCount: 0, total: 0 } };
  });
  const auditGateway = makeAuditGateway({ gateways: { backend: rail('jwt', () => ({ json: { workflows: [], total: 0 } })), ai }, locationId: 'LOC1',
    limiter: makeAuditLimiter({ minimumDelayMs: 0, jitterMs: 0, sleepImpl: async () => {}, randomImpl: () => 0, nowImpl: () => 0 }), circuit: makeAuditCircuit() });
  return getAiConfigurationBundle({ auditGateway, input: { locationId: 'LOC1', companyId: 'COMP1' } });
};
const asCall = (data) => async () => ({ ok: true, data });
// the strict reader's routes, answering the committed shapes (folders: {fold-0001: [member ids]})
const reader = ({ items = ['agent-0001', 'agent-0002'], folders = {}, total = items.length, calls = [] } = {}) => async (path) => {
  calls.push(path);
  if (/agents-with-folders/.test(path)) return { ok: true, json: { items: items.map((id) => ({ id })), folders: Object.keys(folders).map((id) => ({ id })), total, totalAgents: total, totalFolders: Object.keys(folders).length, page: 1, pageSize: 100, hasMore: false } };
  const f = /folderId=([A-Za-z0-9_-]+)/.exec(path);
  if (f && folders[f[1]]) return { ok: true, json: { agents: folders[f[1]].map((id) => ({ id })), total: folders[f[1]].length, page: 1, pageSize: 100, hasMore: false, traceId: 't-0001' } };
  return { ok: false };
};
test('the real component has no totalFolders key', async () => {
  const b = await realBundle(); assert.equal('totalFolders' in b.components.agent_studio, false); assert.equal(b.components.agent_studio.complete, true);
});
test('0 folders: the strict read is made (even so) and clears; the reader is called', async () => {
  const calls = [], b = await realBundle();
  const c = await convAiCensus({ call: asCall(b), read: reader({ calls }), locationId: LOC });
  assert.equal(c.ok, true); assert.equal(c.blocks, false); assert.ok(calls.length >= 1); assert.equal(c.otherComponents.foldersRead.ok, true);
});
test('1 folder: foldered agent is in the judged set, the read clears it', async () => {
  const ids = ['agent-0001', 'agent-0002', 'agent-0003'], b = await realBundle({ items: ids, folders: ['fold-0001'] });
  const c = await convAiCensus({ call: asCall(b), read: reader({ items: ids, folders: { 'fold-0001': ['agent-0003'] } }), locationId: LOC });
  assert.equal(c.blocks, false); assert.equal(c.otherComponents.foldersRead.totalFolders, 1);
});
test('no reader, no location, a failed read, a bad location, or a different union = block (zero agents included)', async () => {
  const b = await realBundle(), zero = await realBundle({ items: [] });
  for (const args of [{}, { read: reader() }, { locationId: LOC }, { read: async () => ({ ok: false }), locationId: LOC }, { read: reader(), locationId: 'a.b' }, { read: reader({ items: ['agent-0001', 'agent-0002', 'agent-0003'], total: 3 }), locationId: LOC }]) {
    const c = await convAiCensus({ call: asCall(b), ...args });
    assert.equal(c.blocks, true, JSON.stringify(Object.keys(args))); assert.match(c.reason, /strict folders read did not prove/);
  }
  assert.equal((await convAiCensus({ call: asCall(zero) })).blocks, true, 'zero agents, no reader');
  assert.equal((await convAiCensus({ call: asCall(zero), read: reader({ items: [] }), locationId: LOC })).blocks, false, 'zero agents with a read');
});
test('a component that carries a totalFolders key must agree with the proof', async () => {
  const b = await realBundle(); b.components.agent_studio.totalFolders = 5;
  assert.equal((await convAiCensus({ call: asCall(b), read: reader(), locationId: LOC })).blocks, true);
});
test('a live studio agent still blocks even when the folders read passes', async () => {
  const b = await realBundle(); b.components.agent_studio.items[0].detail = { ...draftDetail('agent-0001'), status: 'published', hasPublishedVersion: true, config: { triggers: [{ type: 'chat', name: 'x', enabled: true, config: {}, triggerMessage: '' }] } };
  assert.equal((await convAiCensus({ call: asCall(b), read: reader(), locationId: LOC })).blocks, true);
});
const proofArgs = (calls) => ({
  call: async (n) => { calls.push(n); return { ok: true, data: { wid: 'wid-0001', verify: { status: 'published', totalTriggers: 0 }, pipelines: [{ id: 'pipe-0001' }], workflow: { status: 'published', workflowData: { templates: [] } } } }; },
  gw: { call: async (m, p) => { calls.push(`gw ${m} ${p}`); return { json: {} }; } }, LOCATION: LOC, NAME: (s) => `TEST-CONF-${s}`, STAMP: '123456', left: [], log: null,
});
test('both proofs: no gate = nothing built; a refusing gate = no publish; a gate that refuses before the first contact = no contact and the probe is still taken down', async () => {
  for (const run of [runMultipathInsertProof, runDeleteBranchProof]) {
    // no gate: nothing at all is built
    let calls = [], checks = [];
    await run({ ...proofArgs(calls), check: (ok, name) => checks.push([ok, name]) });
    assert.ok(!calls.includes('build_workflow') && !calls.some((c) => /^gw /.test(c)), `${run.name}: nothing built without a census`);
    assert.ok(checks.some(([ok, name]) => ok === false && /no census gate/.test(name)));
    // the first (pre-publish) read refuses: built as a draft, never published, no contact
    calls = []; let n = 0;
    await run({ ...proofArgs(calls), check: () => {}, census: async () => { n += 1; return false; } });
    assert.equal(n, 1); assert.ok(!calls.includes('publish_workflow') && !calls.some((c) => /^gw POST/.test(c)), `${run.name}: a refusing gate sends no publish`);
    // the pre-contact read refuses: published once, no contact, and unpublish_workflows still runs (the gate never exits)
    calls = []; n = 0;
    await run({ ...proofArgs(calls), check: () => {}, census: async () => { n += 1; return n < 2; } });
    assert.equal(n, 2, `${run.name}: the census is read again before the first contact`);
    assert.ok(calls.includes('publish_workflow') && !calls.some((c) => /^gw POST/.test(c)) && calls.includes('unpublish_workflows'), `${run.name}: no contact, probe taken down`);
    // every read clean: it goes on to the contact create
    calls = [];
    await run({ ...proofArgs(calls), check: () => {}, census: async () => true });
    assert.ok(calls.some((c) => /^gw POST \/contacts\//.test(c)), `${run.name}: a clean census lets it proceed`);
  }
});
test('source: the census is awaited before the publish and before every POST /contacts/ in both proofs; conformance hands over the non-exiting gate and stops after a refusal', () => {
  for (const f of ['multipath-insert-proof.mjs', 'delete-branch-proof.mjs']) {
    const s = readFileSync(join(SCRIPTS, f), 'utf8'), first = s.indexOf('await census('), second = s.indexOf('await census(', first + 10);
    assert.ok(first > 0 && first < s.indexOf("'publish_workflow'") && second > s.indexOf("'publish_workflow'") && second < s.indexOf("gw.call('POST', '/contacts/'"), f);
    assert.ok(s.indexOf("typeof census !== 'function'") < s.indexOf("'build_workflow'"), `${f}: a missing census is refused before the build`);
  }
  const src = readFileSync(join(SCRIPTS, 'conformance.mjs'), 'utf8');
  assert.equal((src.match(/census: proofCensus \}\);\nawait stopIfProofRefused\(\);/g) ?? []).length, 2);
  assert.match(src, /censusGate\(label, \{ exit: false \}\)/);
  assert.match(src, /convAiCensus\(\{ call, companyId: process\.env\.GHL_COMPANY_ID, runS: RUN_S, read: censusRead, locationId: LOCATION \}\)/);
  assert.match(src, /publishedTriggerCensus\(\{[^\n]*convAi, runS: RUN_S \}\)/);
  assert.match(src, /method: 'GET', path, host: 'ai'/);
});
