// bl-1021 (orchestrator 2026-11-10, after run 5 crashed): three run-hygiene rules, tested before they are wired into the suite (RED first).
// 1) A START-OF-RUN SWEEP unpublishes every TEST-CONF workflow left published by an earlier run (a crash skips every finally) and reads
//    each back as draft on a separate GET. Only TEST-CONF names are touched; nothing else is published or unpublished.
// 2) A BOUNDARY METER read: the location usage is read raw at each section boundary; past the ceiling the run stops there.
// 3) A TRANSPORT failure (a GHL connect timeout) is a reported failure, never an uncaught crash; read-only calls are retried first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepPublishedTestConf, boundaryMeter, callSafe, METER_DELTA } from '../../skills/create-ghl-workflow/scripts/run-hygiene.mjs';

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

// orchestrator 2026-11-21 (bl-1034, bl-1271): the absolute 9.38 ceiling was passed on 11-10 by a charge from outside W9, so it guards nothing.
// The meter is a DELTA on the run's own first reading: stop when usage rises more than +0.05 over it, or when the read fails.
test('meter: the first read sets the baseline and never stops; a failed read stops', async () => {
  assert.equal(METER_DELTA, 0.05);
  const w = fakeWorld([]);
  w.state.meter = 21.29;
  const first = await boundaryMeter({ call: w.call, label: 'run start', logPath: null, baseline: null });
  assert.equal(first.usage, 21.29);
  assert.equal(first.stop, false, 'a high absolute usage is not a stop');
  w.state.meter = undefined;
  const failing = async (n, a) => (n === 'raw_request' ? { ok: false, code: 'X' } : w.call(n, a));
  const bad = await boundaryMeter({ call: failing, label: 'x', logPath: null, baseline: null });
  assert.equal(bad.usage, null);
  assert.equal(bad.stop, true, 'an unreadable meter stops the run');
});

test('meter: later reads stop only when usage rose more than +0.05 over the baseline', async () => {
  const w = fakeWorld([]);
  w.state.meter = 21.33;
  const within = await boundaryMeter({ call: w.call, label: 'A', logPath: null, baseline: 21.29 });
  assert.equal(within.stop, false, '+0.04 is inside the delta');
  w.state.meter = 21.35;
  const edge = await boundaryMeter({ call: w.call, label: 'B', logPath: null, baseline: 21.30 });
  assert.equal(edge.stop, false, 'exactly +0.05 is not past it');
  w.state.meter = 21.36;
  const over = await boundaryMeter({ call: w.call, label: 'C', logPath: null, baseline: 21.30 });
  assert.equal(over.stop, true, '+0.06 is past it');
  assert.equal(over.baseline, 21.30);
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
  const metered = src.match(/await meterGate\(/g) ?? [];
  assert.ok(headers.length > 0 && metered.length >= headers.length, `every top-level section header needs a meter read (${metered.length} reads for ${headers.length} headers)`);
  assert.ok(/callSafe\(/.test(src), 'call must route through callSafe');
  assert.ok(/process\.on\('unhandledRejection'/.test(src), 'an unhandled rejection must be reported, not crash the run');
});

// bl-1271: a meter stop must run finish() (own-stamp sweep, LEFT IN PLACE, summary) and exit 3 — never a bare process.exit(3).
test('wiring: a meter stop goes through finish(), and no section calls process.exit(3) itself', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../skills/create-ghl-workflow/scripts/conformance.mjs', import.meta.url), 'utf8');
  assert.equal((src.match(/process\.exit\(3\)/g) ?? []).length, 0);
  assert.match(src, /const meterGate = async/);
  assert.match(src, /await finish\(ABORT, 3\)/);
  assert.match(src, /await meterGate\('run start'\)/);
  assert.equal((src.match(/boundaryMeter\(/g) ?? []).length, 1, 'the one call inside meterGate');
});

test('sweep: with ownStamp only this run\'s own TEST-CONF flows are unpublished; another stamp is reported, never touched', async () => {
  const w = fakeWorld([
    { id: 'm', name: 'TEST-CONF-flowentry-123456', status: 'published' },
    { id: 'o', name: 'TEST-CONF-flowentry-654321', status: 'published' },
  ]);
  const out = await sweepPublishedTestConf({ call: w.call, check, sinceIso: '2026-11-10T00:00:00.000Z', ownStamp: '123456' });
  assert.deepEqual(out.cleared.map((x) => x.id), ['m']);
  assert.equal(w.state.get('o').status, 'published');
  assert.deepEqual(out.otherPublished.map((x) => x.id), ['o']);
});

test('safeUrl: host and path only, the signed query string never reaches a log', async () => {
  const { safeUrl } = await import('../../skills/create-ghl-workflow/scripts/run-hygiene.mjs');
  assert.equal(safeUrl('https://storage.example.com/a/b.json?X-Goog-Signature=SECRET&t=1#frag'), 'storage.example.com/a/b.json');
  assert.equal(safeUrl('not a url'), '(unparseable url)');
});

test('conformance: --through=publish stop point, --no-sweep, the 1.43.1 token check and the 412 guard are wired', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../skills/create-ghl-workflow/scripts/conformance.mjs', import.meta.url), 'utf8');
  assert.match(src, /--through=/);
  assert.match(src, /if \(THROUGH === 'publish'\) await finish/);
  assert.match(src, /if \(!NO_SWEEP\) await sweepPublishedTestConf/);
  assert.match(src, /pubRun\.waited === 0/);
  assert.match(src, /GUARD: publish_workflow with no confirm PUBLISHED/);
  assert.match(src, /safeUrl\(before\.fileUrl\)/);
});
