// wf-readonly-runtime-proof.mjs against in-memory answers: credit needs a non-empty complete answer and an agreeing second read; empty is FAIL (no credit); an auth code stops the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeProof, RUNTIME_TOOLS } from '../../skills/create-ghl-workflow/scripts/wf-readonly-runtime-proof.mjs';
import { createDeclaredMarker } from '../../skills/create-ghl-workflow/scripts/declared-marker.mjs';

const WID = '0a0b0c0d-1e1f-4a2b-8c3d-9e0f1a2b3c4d';
const ans = (over = {}) => ({
  get_workflow_step_counts: { ok: true, data: { count: 6, statistics: [{ count: 4 }, { count: 2 }], complete: true } },
  get_workflow_heat_map: { ok: true, data: { workflows: [{ workflowId: WID, count: 3 }], total: 3, absent: [] } },
  ...over,
});
function run(a) {
  const calls = []; const lines = []; const mk = createDeclaredMarker(RUNTIME_TOOLS);
  const call = mk.wrapCall(async (n) => { calls.push(n); const v = a[n]; return typeof v === 'function' ? v() : v; });
  const chk = (c, m, d) => mk.check(c, m, d, (cond, msg) => lines.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`));
  return runRuntimeProof({ call, workflowId: WID, chk, mk, say: (l) => lines.push(l), now: Date.UTC(2026, 10, 23) }).then((r) => ({ r, calls, lines, mk }));
}
test('happy path: both tools credited, only the two tools called', async () => {
  const { r, calls, lines } = await run(ans());
  assert.equal(r.halted, false); assert.equal(lines.filter((l) => l.startsWith('FAIL')).length, 0, lines.join('\n'));
  assert.ok(calls.every((n) => RUNTIME_TOOLS.includes(n)));
  assert.equal(lines.filter((l) => l.startsWith('PASS')).length, 2);
});
test('empty step counts and a zero heat map are FAIL (no credit)', async () => {
  const { lines } = await run(ans({ get_workflow_step_counts: { ok: true, data: { count: 0, statistics: [], complete: true } }, get_workflow_heat_map: { ok: true, data: { workflows: [], total: 0, absent: [WID] } } }));
  assert.equal(lines.filter((l) => l.startsWith('FAIL')).length, 2);
});
test('heat map named but second read disagrees: FAIL', async () => {
  let n = 0;
  const { lines } = await run(ans({ get_workflow_heat_map: () => { n += 1; return { ok: true, data: { workflows: [{ workflowId: WID, count: n }], total: n, absent: [] } }; } }));
  assert.ok(lines.some((l) => l.startsWith('FAIL') && /heat_map/.test(l)));
});
test('groupings that disagree: step counts FAIL', async () => {
  let n = 0;
  const { lines } = await run(ans({ get_workflow_step_counts: () => { n += 1; return { ok: true, data: { count: n, statistics: [{ count: n }], complete: true } }; } }));
  assert.ok(lines.some((l) => l.startsWith('FAIL') && /step_counts/.test(l)));
});
test('TOKEN_EXPIRED stops the run before the heat map', async () => {
  const { r, calls } = await run(ans({ get_workflow_step_counts: { ok: false, code: 'TOKEN_EXPIRED' } }));
  assert.equal(r.halted, true); assert.ok(!calls.includes('get_workflow_heat_map'));
});
