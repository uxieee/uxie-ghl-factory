import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleStop, trackInflight, Stopped } from '../../skills/create-ghl-workflow/scripts/pause-signal.mjs';
const world = (over = {}) => { const w = { status: 'published', log: [], ...over };
  const call = async (name, a) => { w.log.push(name); if (name === 'unpublish_workflows') { w.status = 'draft'; return { ok: true }; } if (name === 'get_workflow') return { ok: true, data: { status: w.status } }; return { ok: false }; };
  return { w, call }; };
const run = async (st, call, extra = {}) => { const out = []; let code = null; await handleStop({ sig: 'SIGTERM', st, call, print: (l) => out.push(l), exit: (c) => { code = c; }, settleMs: 200, downMs: 200, ...extra }); return { text: out.join('\n'), code }; };
test('signal during the build (no id yet): UNKNOWN naming the flow, exit 3, nothing sent', async () => {
  const { w, call } = world(); const r = await run({ wid: null, name: 'TEST-CONF-W9-DRIFT-pause-restore-1', inflight: new Set() }, call);
  assert.equal(r.code, 3); assert.match(r.text, /UNKNOWN/); assert.match(r.text, /TEST-CONF-W9-DRIFT-pause-restore-1/); assert.deepEqual(w.log, []);
});
test('an id, settled in-flight calls, a separate read-back of draft: says draft, exit 143', async () => {
  const { w, call } = world(); const r = await run({ wid: 'wf-id-0001', name: 'N', inflight: new Set() }, call);
  assert.equal(r.code, 143); assert.match(r.text, /read back as a draft on a separate read after in-flight calls settled/); assert.deepEqual(w.log, ['unpublish_workflows', 'get_workflow']);
});
test('a LATE publish still in flight at the signal cannot land after the unpublish: the stop waits for it first, then reads draft', async () => {
  const { w, call } = world({ status: 'draft' }); const st = { wid: 'wf-id-0001', name: 'N', inflight: new Set() };
  const publish = trackInflight(st, async () => { await new Promise((r) => setTimeout(r, 60)); w.status = 'published'; w.log.push('publish_landed'); });
  void publish();
  const r = await run(st, call);
  assert.ok(w.log.indexOf('publish_landed') < w.log.indexOf('unpublish_workflows'), 'the late publish landed BEFORE the unpublish');
  assert.equal(r.code, 143); assert.equal(w.status, 'draft');
});
test('in-flight calls that never settle: UNKNOWN, exit 3, never "draft"', async () => {
  const { call } = world(); const st = { wid: 'wf-id-0001', name: 'N', inflight: new Set() };
  trackInflight(st, () => new Promise(() => {}))();
  const r = await run(st, call);
  assert.equal(r.code, 3); assert.match(r.text, /UNKNOWN/); assert.match(r.text, /settled: false/); assert.ok(!/read back as a draft/.test(r.text));
});
test('read-back says published or is unreadable: UNKNOWN with id and name, exit 3', async () => {
  for (const g of [async () => ({ ok: true, data: { status: 'published' } }), async () => { throw new Error('x'); }]) {
    const call = async (n) => (n === 'get_workflow' ? g() : { ok: true });
    const r = await run({ wid: 'wf-id-0001', name: 'Named', inflight: new Set() }, call);
    assert.equal(r.code, 3); assert.match(r.text, /wf-id-0001 \(Named\)/); assert.match(r.text, /possibly published/);
  }
});
test('once signalled, a call started afterwards is refused (Stopped); the handler still uses the raw call', async () => {
  const { w, call } = world({ status: 'draft' }); const st = { wid: 'wf-id-0001', name: 'N', inflight: new Set() };
  const tracked = trackInflight(st, call);
  const slowRead = trackInflight(st, async () => { await new Promise((r) => setTimeout(r, 40)); });
  void slowRead();
  const stop = run(st, call);
  await assert.rejects(() => tracked('publish_workflow', {}), Stopped);
  assert.ok(!w.log.includes('publish_workflow'), 'the refused call never reached the world');
  await stop;
});
test("QA's sequence: a read in flight at the signal, main then starts publish: the flow ends draft or exit 3, never draft-claimed and published", async () => {
  const { w, call } = world({ status: 'draft' }); const st = { wid: 'wf-id-0001', name: 'N', inflight: new Set() };
  const tracked = trackInflight(st, call);
  const read = trackInflight(st, async () => { await new Promise((r) => setTimeout(r, 40)); return { ok: true }; });
  void read();
  const stop = run(st, call);
  const publish = tracked('publish_workflow', { workflowId: 'wf-id-0001' }).catch((e) => e);
  assert.ok((await publish) instanceof Stopped);
  const r = await stop;
  assert.equal(w.status, 'draft');
  assert.ok(r.code === 143 || r.code === 3);
  assert.ok(!(r.code === 143 && w.status === 'published'));
});
test('a second signal is a no-op: one exit, one message', async () => {
  const { call } = world(); const st = { wid: 'wf-id-0001', name: 'N', inflight: new Set() };
  const out = []; const codes = [];
  const go = () => handleStop({ sig: 'SIGINT', st, call, print: (l) => out.push(l), exit: (c) => codes.push(c), settleMs: 100, downMs: 100 });
  await Promise.all([go(), go()]);
  assert.equal(codes.length, 1); assert.equal(out.length, 1);
});
test('source: main waits forever once stopped, before any result print or process.exit, so only the handler exits', () => {
  const src = readFileSync(new URL('../../skills/create-ghl-workflow/scripts/pause-restore-proof.mjs', import.meta.url), 'utf8');
  const guard = src.indexOf('if (st.stopped) await new Promise(() => {})');
  assert.ok(guard > 0 && guard < src.indexOf("console.log('\\nLEFT IN PLACE") && guard < src.indexOf('process.exit(failed === 0'));
  assert.ok(/call: rawCall/.test(src) && /trackInflight\(st, rawCall\)/.test(src) && /trackInflight\(st, \(\.\.\.x\) => gw\.call\(\.\.\.x\)\)/.test(src));
});
test('a HUNG publish in flight at the signal: the stop does not claim a take-down, prints UNKNOWN with id and name, exits 3, and no new call starts', async () => {
  const { w, call } = world({ status: 'published' }); const st = { wid: 'wf-id-0001', name: 'Named', inflight: new Set() };
  const publish = trackInflight(st, () => new Promise(() => {}));   // never returns
  void publish('publish_workflow', {});
  const later = trackInflight(st, call);
  const stop = run(st, call);
  await assert.rejects(() => later('publish_workflow', {}), Stopped);
  const r = await stop;
  assert.equal(r.code, 3); assert.match(r.text, /UNKNOWN/); assert.match(r.text, /wf-id-0001 \(Named\)/); assert.match(r.text, /settled: false/);
  assert.ok(!/read back as a draft/.test(r.text));
});
