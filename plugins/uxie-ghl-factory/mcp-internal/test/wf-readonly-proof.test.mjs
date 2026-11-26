// wf-readonly-proof.mjs against an in-memory tool answer set. Rules tested: the fence (GET and the one linked-assets POST only), id shape and count, a credit needs ok + complete +
// a separate agreeing read, an empty answer is shape-only (no credit), an absent skills route is a finding and not a failure, an auth code stops the run, nothing is created.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIds, fenceGateway, runReadonlyProof, READONLY_TOOLS, WID_RE, CID_RE, FenceError, LINKED_ASSETS_ROUTE } from '../../skills/create-ghl-workflow/scripts/wf-readonly-proof.mjs';
import { createDeclaredMarker } from '../../skills/create-ghl-workflow/scripts/declared-marker.mjs';

const LOC = 'LOCMOCK0000000000001';
const WID = '0a0b0c0d-1e1f-4a2b-8c3d-9e0f1a2b3c4d';
const CID = 'CONTACTMOCK00000001';
const NOW = Date.UTC(2026, 10, 23);

function answers(over = {}) {
  const base = {
    list_workflow_error_notifications: { ok: true, data: { notifications: [{}, {}], totalCount: 2, complete: true } },
    list_ai_agent_skills: (a) => (a.ids ? { ok: true, data: { resolved: a.ids.map((id) => ({ id })), unresolved: [] } } : { ok: true, data: { skills: [{ id: 's1' }, { id: 's2' }], total: 2, complete: true } }),
    get_workflow_step_counts: { ok: true, data: { count: 5, statistics: [{ count: 3 }, { count: 2 }], complete: true } },
    get_workflow_heat_map: { ok: true, data: { workflows: [{ workflowId: WID, count: 4 }], total: 4, absent: [] } },
    get_workflow_linked_assets: { ok: true, data: { count: 1, complete: true, workflows: [{ id: WID }] } },
    get_contact_workflow_journey: { ok: true, data: { count: 1, complete: true, workflowStatuses: [{ workflowId: WID }] } },
    get_contact_workflow_history: { ok: true, data: { runs: [{ runId: 'r1', workflowId: WID }], nextCursor: null } },
  };
  return { ...base, ...over };
}
function harness(ans, extra = {}) {
  const calls = [];
  const call = async (n, a) => { calls.push(n); const v = ans[n]; return typeof v === 'function' ? v(a) : v; };
  const lines = []; const credited = new Set();
  const mk = createDeclaredMarker(READONLY_TOOLS);
  const wrapped = mk.wrapCall(call);
  const chk = (c, m, d) => { mk.check(c, m, d, (cond, msg) => lines.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`)); };
  return { calls, lines, mk, wrapped, chk, say: (l) => lines.push(l), credited, ...extra };
}
const run = (h, over = {}) => runReadonlyProof({ call: h.wrapped, LOCATION: LOC, workflowIds: [WID], contactIds: [CID], chk: h.chk, mk: h.mk, say: h.say, now: NOW, ...over });
const credits = (h) => new Set(h.mk.entries().filter((e) => e.pass !== false && e.ok !== false).map((e) => e.tool));

test('parseIds: shape, count and presence are enforced', () => {
  assert.deepEqual(parseIds(WID, WID_RE, 'x'), [WID]);
  assert.throws(() => parseIds('', WID_RE, 'x'), /required/);
  assert.throws(() => parseIds('nope', WID_RE, 'x'), /wrong shape/);
  assert.throws(() => parseIds([WID, WID.replace('1', '2'), WID.replace('1', '3'), WID.replace('1', '4')].join(','), WID_RE, 'x'), /at most/);
  assert.ok(CID_RE.test(CID));
});

test('fence: GET and the linked-assets POST pass; every other method or route throws before the gateway', async () => {
  const seen = [];
  const gw = fenceGateway({ call: async (m, p) => { seen.push(`${m} ${p}`); return { ok: true }; }, other: 1 });
  await gw.call('GET', '/workflow/x/y?a=1');
  await gw.call('POST', LINKED_ASSETS_ROUTE, {});
  for (const [m, p] of [['POST', '/workflow/x/trigger'], ['PUT', '/workflow/x'], ['DELETE', '/workflow/x'], ['PATCH', LINKED_ASSETS_ROUTE]]) {
    await assert.rejects(() => gw.call(m, p, {}), FenceError);
  }
  assert.equal(seen.length, 2);
  assert.equal(gw.other, 1);
});

test('happy path: every one of the seven tools is credited and no call falls outside the list', async () => {
  const h = harness(answers()); const r = await run(h);
  assert.equal(r.halted, false);
  assert.equal(h.lines.filter((l) => l.startsWith('FAIL')).length, 0, h.lines.join('\n'));
  for (const t of READONLY_TOOLS) assert.ok(h.calls.includes(t), `${t} called`);
  assert.ok(h.calls.every((n) => READONLY_TOOLS.includes(n)));
  assert.equal(h.lines.filter((l) => l.startsWith('PASS')).length, 7);
});

test('a tool outside the list is refused by the fence in the proof itself', async () => {
  const h = harness(answers());
  const r = await runReadonlyProof({ call: h.wrapped, LOCATION: LOC, workflowIds: [WID], contactIds: [CID], chk: h.chk, mk: h.mk, say: h.say, now: NOW });
  assert.equal(r.halted, false);
  const bad = harness(answers(), {});
  bad.wrapped = async () => { throw new FenceError('read-only fence: tool update_x is not on the list'); };
  const r2 = await run(bad);
  assert.equal(r2.halted, true);
});

test('an empty journey, empty history and an empty window are shape-only: no FAIL claimed, no credit', async () => {
  const h = harness(answers({
    get_contact_workflow_journey: { ok: true, data: { count: 0, complete: true, workflowStatuses: [] } },
    get_contact_workflow_history: { ok: true, data: { runs: [], nextCursor: null } },
    get_workflow_step_counts: { ok: true, data: { count: 0, statistics: [], complete: true } },
  }));
  await run(h);
  const fails = h.lines.filter((l) => l.startsWith('FAIL'));
  assert.equal(fails.length, 3, h.lines.join('\n')); // the three NOT credited as proven are reported as FAIL lines so no run reads as green
});

test('history whose workflow is missing from the journey does not pass', async () => {
  const h = harness(answers({ get_contact_workflow_journey: { ok: true, data: { count: 1, complete: true, workflowStatuses: [{ workflowId: 'other' }] } } }));
  await run(h);
  assert.ok(h.lines.some((l) => l.startsWith('FAIL') && /get_contact_workflow_history/.test(l)));
});

test('an incomplete error-notification walk does not pass', async () => {
  const h = harness(answers({ list_workflow_error_notifications: { ok: true, data: { notifications: [{}], totalCount: 2, complete: false } } }));
  await run(h);
  assert.ok(h.lines.some((l) => l.startsWith('FAIL') && /list_workflow_error_notifications/.test(l)));
});

test('step counts: two groupings that disagree do not pass', async () => {
  let n = 0;
  const h = harness(answers({ get_workflow_step_counts: () => { n += 1; return n === 1 ? { ok: true, data: { count: 5, statistics: [{ count: 5 }], complete: true } } : { ok: true, data: { count: 4, statistics: [{ count: 4 }], complete: true } }; } }));
  await run(h);
  assert.ok(h.lines.some((l) => l.startsWith('FAIL') && /get_workflow_step_counts/.test(l)));
});

test('an absent skills route is a FINDING and the run goes on', async () => {
  const h = harness(answers({ list_ai_agent_skills: { ok: false, code: 'NOT_FOUND' } }));
  const r = await run(h);
  assert.equal(r.halted, false);
  assert.ok(h.lines.some((l) => /^FINDING list_ai_agent_skills/.test(l)));
  assert.equal(h.lines.filter((l) => l.startsWith('FAIL')).length, 0, h.lines.join('\n'));
  assert.ok(h.calls.includes('get_contact_workflow_history'));
});

test('TOKEN_EXPIRED stops the run: no further call', async () => {
  const h = harness(answers({ get_workflow_step_counts: { ok: false, code: 'TOKEN_EXPIRED' } }));
  const r = await run(h);
  assert.equal(r.halted, true);
  assert.equal(r.reason, 'TOKEN_EXPIRED');
  assert.ok(!h.calls.includes('get_workflow_heat_map'));
  assert.ok(!h.calls.includes('get_contact_workflow_history'));
});

test('the file has no write route, no delete and no real id', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../skills/create-ghl-workflow/scripts/wf-readonly-proof.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\b(DELETE|PUT|PATCH)\b/.test(src.replace(/the one linked-assets/g, '')) || /not allowed/.test(src));
  assert.ok(!/rmSync|unlinkSync|build_workflow|publish_workflow|create_contact/.test(src));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(src));
});

test('fence: callWithMeta and stream follow the same rule, and readBackUntil is dropped; no fetch is made on a refusal', async () => {
  const seen = [];
  const rec = (k) => async (m, p) => { seen.push(`${k} ${m} ${p}`); return { ok: true }; };
  const gw = fenceGateway({ call: rec('call'), callWithMeta: rec('meta'), stream: rec('stream'), readBackUntil: async () => ({}), loc: 'L' });
  assert.equal(gw.readBackUntil, undefined);
  assert.equal(gw.loc, 'L');
  await gw.callWithMeta('GET', '/workflow/x');
  await gw.stream('GET', '/workflow/x');
  await gw.callWithMeta('POST', LINKED_ASSETS_ROUTE, {});
  const before = seen.length;
  for (const k of ['callWithMeta', 'stream', 'call']) {
    for (const [m, p] of [['POST', '/workflow/x/trigger'], ['PUT', '/workflow/x'], ['DELETE', '/workflow/x'], ['PATCH', LINKED_ASSETS_ROUTE]]) {
      await assert.rejects(() => gw[k](m, p, {}), FenceError);
    }
  }
  assert.equal(seen.length, before, 'no underlying method ran for a refused request');
});
