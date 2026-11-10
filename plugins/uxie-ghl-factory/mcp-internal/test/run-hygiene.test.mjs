// bl-1021 (orchestrator 2026-11-10, after run 5 crashed): three run-hygiene rules, tested before they are wired into the suite (RED first).
// 1) A START-OF-RUN SWEEP unpublishes every TEST-CONF workflow left published by an earlier run (a crash skips every finally) and reads
//    each back as draft on a separate GET. Only TEST-CONF names are touched; nothing else is published or unpublished.
// 2) A BOUNDARY METER read: the location usage is read raw at each section boundary; past the ceiling the run stops there.
// 3) A TRANSPORT failure (a GHL connect timeout) is a reported failure, never an uncaught crash; read-only calls are retried first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepPublishedTestConf, boundaryMeter, callSafe, METER_CEILING } from '../../skills/create-ghl-workflow/scripts/run-hygiene.mjs';

function fakeWorld(rows) {
  const state = new Map(rows.map((r) => [r.id, { ...r }]));
  const calls = [];
  const call = async (name, args) => {
    calls.push({ name, args });
    if (name === 'list_workflows') return { ok: true, data: { workflows: [...state.values()].map((r) => ({ id: r.id, name: r.name, status: r.status })) } };
    if (name === 'unpublish_workflows') { for (const id of args.workflowIds) state.get(id).status = 'draft'; return { ok: true, data: {} }; }
    if (name === 'get_workflow') return { ok: true, data: { id: args.workflowId, status: state.get(args.workflowId)?.status ?? null } };
    if (name === 'raw_request') return { ok: true, data: { json: { status: 'success', data: { usage: state.meter ?? 9.1 } } } };
    throw new Error('unexpected ' + name);
  };
  return { call, calls, state };
}
const checks = [];
const check = (ok, msg, extra) => { checks.push({ ok, msg, extra }); };

test('sweep: unpublishes only TEST-CONF workflows that are published, reads each back as draft, and leaves other published workflows alone', async () => {
  const w = fakeWorld([
    { id: 'a', name: 'TEST-CONF-flowentry-036448', status: 'published' },
    { id: 'b', name: 'TEST-CONF-runtime-377034', status: 'published' },
    { id: 'e', name: 'TEST-CONF-W9W9-manual-probe', status: 'published' },
    { id: 'c', name: 'Real client flow', status: 'published' },
    { id: 'd', name: 'TEST-CONF-draft-3', status: 'draft' },
  ]);
  const out = await sweepPublishedTestConf({ call: w.call, check, sinceIso: '2026-11-10T00:00:00.000Z' });
  assert.deepEqual(out.cleared.map((x) => x.id).sort(), ['a', 'b']);
  assert.equal(w.state.get('c').status, 'published', 'a non-TEST-CONF workflow must never be touched');
  assert.equal(w.state.get('a').status, 'draft');
  assert.ok(w.calls.some((c) => c.name === 'get_workflow' && c.args.workflowId === 'a'), 'the read-back is a separate get_workflow call');
  assert.equal(out.residualPublished.length, 0);
  assert.deepEqual(out.otherPublished.map((x) => x.id), ['e'], 'another lane TEST-CONF flow is logged, never touched');
});

test('sweep: a workflow that will not come back to draft is reported, not silently passed', async () => {
  const w = fakeWorld([{ id: 'x', name: 'TEST-CONF-stuck-000001', status: 'published' }]);
  w.call.stuck = true;
  const stuckCall = async (name, args) => (name === 'get_workflow' ? { ok: true, data: { status: 'published' } } : w.call(name, args));
  const out = await sweepPublishedTestConf({ call: stuckCall, check, sinceIso: '2026-11-10T00:00:00.000Z' });
  assert.deepEqual(out.residualPublished.map((x) => x.id), ['x']);
});

test('meter: a boundary read returns the usage and stops only past the ceiling (9.38)', async () => {
  assert.equal(METER_CEILING, 9.38);
  const w = fakeWorld([]);
  w.state.meter = 9.285262;
  const ok = await boundaryMeter({ call: w.call, label: 'section A', logPath: null });
  assert.equal(ok.usage, 9.285262);
  assert.equal(ok.stop, false);
  w.state.meter = 9.39;
  const hi = await boundaryMeter({ call: w.call, label: 'section B', logPath: null });
  assert.equal(hi.stop, true, 'past 9.38 the run must stop at this boundary');
});

test('transport: a read-only call that times out is retried, then reported as a failure, never thrown', async () => {
  let n = 0;
  const flaky = async () => { n++; throw new TypeError('fetch failed'); };
  const r = await callSafe(flaky, 'get_workflow', { workflowId: 'W' }, { retries: 2, sleep: async () => {} });
  assert.equal(n, 3, 'one call plus two retries for a read');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TRANSPORT_FAILED');
});

test('transport: a write that times out is NOT retried (it may have landed), and is reported', async () => {
  let n = 0;
  const flaky = async () => { n++; throw new TypeError('fetch failed'); };
  const r = await callSafe(flaky, 'unpublish_workflows', { workflowIds: ['W'] }, { retries: 2, sleep: async () => {} });
  assert.equal(n, 1, 'a write is never retried');
  assert.equal(r.code, 'TRANSPORT_FAILED');
});

// Wiring, read from the suite source: the sweep runs before the first section, every top-level section header is preceded by a meter
// read, a transport failure is routed through callSafe, and an unhandled rejection is reported rather than crashing the run.
test('wiring: the suite sweeps TEST-CONF published workflows before its first section, reads the meter at every section, and never crashes on a rejection', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../skills/create-ghl-workflow/scripts/conformance.mjs', import.meta.url), 'utf8');
  const sweepAt = src.indexOf('await sweepPublishedTestConf(');
  const firstSection = src.indexOf("// ── 1. stepIndex");
  assert.ok(sweepAt > 0, 'the start-of-run sweep is missing');
  assert.ok(firstSection > 0 && sweepAt < firstSection, 'the sweep must run before the first section');
  const headers = src.match(/^console\.log\('\\n[^']*'\);/gm) ?? [];
  const metered = src.match(/await boundaryMeter\(/g) ?? [];
  assert.ok(headers.length > 0 && metered.length >= headers.length, `every top-level section header needs a meter read (${metered.length} reads for ${headers.length} headers)`);
  assert.ok(/callSafe\(/.test(src), 'call must route through callSafe');
  assert.ok(/process\.on\('unhandledRejection'/.test(src), 'an unhandled rejection must be reported, not crash the run');
});

// orchestrator 2026-11-10 (after run 6's meter rose 9.285262 -> 9.355048 against a 9.558494 hard stop): the stop threshold is 9.38.
test('the meter stop threshold is 9.38 (orchestrator 2026-11-10)', () => {
  assert.equal(METER_CEILING, 9.38);
});
