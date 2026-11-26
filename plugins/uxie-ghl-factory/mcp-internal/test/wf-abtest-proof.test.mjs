// wf-abtest-proof.mjs against an in-memory gateway. Rules tested: the write fence (one workflow, one contact, listed routes), the preconditions (TEST-CONF draft, empty paths),
// the happy path crediting all five tools, the unpublish on every exit, an auth stop, and that the file holds no real id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fenceGateway, inspectWorkflow, runAbTestProof, AB_TOOLS, FenceError, WRITE_ROUTES } from '../../skills/create-ghl-workflow/scripts/wf-abtest-proof.mjs';
import { createDeclaredMarker } from '../../skills/create-ghl-workflow/scripts/declared-marker.mjs';

const LOC = 'LOCMOCK0000000000001';
const WID = '0a0b0c0d-1e1f-4a2b-8c3d-9e0f1a2b3c4d';
const OTHER = '99999999-1e1f-4a2b-8c3d-9e0f1a2b3c4d';
const STEP = '11111111-1e1f-4a2b-8c3d-9e0f1a2b3c4d';
const PA = '22222222-1e1f-4a2b-8c3d-9e0f1a2b3c4d'; const PB = '33333333-1e1f-4a2b-8c3d-9e0f1a2b3c4d';
const CID = 'CONTACTMOCK00000001'; const TID = 'TRIGGERMOCK000000001';
const NAME = 'TEST-CONF-MOCK-ab';

const doc = (over = {}) => ({ ok: true, status: 200, json: { _id: WID, name: NAME, status: 'draft', workflowData: { templates: [
  { id: STEP, type: 'workflow_ab_test', attributes: { paths: [{ id: PA, name: 'A' }, { id: PB, name: 'B' }] } },
  { id: PA, type: 'transition', parentKey: STEP, next: null }, { id: PB, type: 'transition', parentKey: STEP, next: null }] }, ...over } });
const trigs = { ok: true, status: 200, json: [{ id: TID, actions: [{ workflow_id: WID, type: 'add_to_workflow' }] }] };
const scopeOf = () => ({ location: LOC, ids: new Set([WID, STEP, PA, PB]), triggers: new Set([TID]), contactId: CID });

test('fence: GET passes; the listed writes pass for the one workflow and contact', async () => {
  const seen = []; const gw = fenceGateway({ call: async (m, p) => { seen.push(`${m} ${p}`); return { ok: true }; }, readBackUntil: async () => ({}) }, scopeOf());
  assert.equal(gw.readBackUntil, undefined);
  await gw.call('GET', `/workflow/${LOC}/anything`);
  await gw.call('POST', `/workflow/${LOC}/test-workflow/${WID}`, { contactId: CID });
  await gw.call('POST', `/workflow/${LOC}/split/ab-test/declare-winner?workflowId=${WID}&stepId=${STEP}`, { pathId: PA });
  await gw.call('PUT', `/workflow/${LOC}/${WID}`, { anything: OTHER }); // the publish PUT carries the whole document: only its path is scanned
  await gw.call('PUT', `/workflow/${LOC}/trigger/${TID}`, { active: true });
  await gw.call('PUT', `/workflow/${LOC}/change-status`, { ids: [WID], status: 'draft' });
  assert.equal(seen.length, 6);
});

test('fence: another workflow, contact, trigger, route or method throws before any request', async () => {
  const seen = []; const gw = fenceGateway({ call: async (m, p) => { seen.push(m); return { ok: true }; } }, scopeOf());
  const bad = [
    ['POST', `/workflow/${LOC}/test-workflow/${OTHER}`, { contactId: CID }],
    ['POST', `/workflow/${LOC}/test-workflow/${WID}`, { contactId: 'SOMEONEELSE00000001' }],
    ['POST', `/workflow/${LOC}/split/ab-test/declare-winner?workflowId=${OTHER}&stepId=${STEP}`, {}],
    ['PUT', `/workflow/${LOC}/change-status`, { ids: [WID, OTHER] }],
    ['PUT', `/workflow/${LOC}/trigger/ELSETRIGGER0000000001`, {}],
    ['PUT', `/workflow/OTHERLOC0000000000/${WID}`, {}],
    ['DELETE', `/workflow/${LOC}/${WID}`, {}], ['POST', `/workflow/${LOC}/${WID}/trigger`, {}], ['POST', `/contacts/${CID}/tags`, { tags: ['x'] }], ['PATCH', `/workflow/${LOC}/${WID}`, {}],
  ];
  for (const [m, p, b] of bad) await assert.rejects(() => gw.call(m, p, b), FenceError, `${m} ${p}`);
  assert.equal(seen.length, 0);
  assert.ok(WRITE_ROUTES.every(([m]) => ['POST', 'PUT'].includes(m)));
});

test('inspectWorkflow is deny-by-default: any template that is not the A/B step or a transition refuses, wherever it sits', () => {
  for (const type of ['internal_notification', 'send_email', 'sms', 'add_contact_tag', 'wait', 'some_future_step']) for (const parentKey of [undefined, STEP, 'other']) {
    const d = doc(); d.json.workflowData.templates.push({ id: 'zz', type, parentKey });
    assert.match(inspectWorkflow(d, { workflowId: WID, name: NAME }).why ?? '', parentKey === STEP ? /holds a step|deny by default/ : /deny by default/, `${type} ${parentKey}`);
  }
});

test('inspectWorkflow: refuses a wrong id, a non TEST-CONF name, a published workflow, a missing A/B step, and a path that holds a step', () => {
  const t = (over, want) => assert.match(inspectWorkflow(doc(over), { workflowId: WID, name: NAME, triggers: [] }).why ?? '', want);
  assert.equal(inspectWorkflow(doc(), { workflowId: WID, name: NAME, triggers: trigs.json }).why, null);
  assert.deepEqual(inspectWorkflow(doc(), { workflowId: WID, name: NAME, triggers: trigs.json }).triggerIds, [TID]);
  t({ _id: OTHER }, /id does not match/); t({ name: 'Real client flow' }, /not the expected TEST-CONF name/); t({ status: 'published' }, /not a draft/);
  t({ workflowData: { templates: [] } }, /no A\/B step/);
  const filled = doc(); filled.json.workflowData.templates.push({ id: 'z', type: 'send_email', parentKey: PA });
  assert.match(inspectWorkflow(filled, { workflowId: WID, name: NAME }).why, /holds a step/);
  assert.match(inspectWorkflow(doc(), { workflowId: WID, name: 'TEST-CONF-OTHER' }).why, /name is not the expected/);
});

// a small stateful mock of the account
function world(over = {}) {
  const st = { status: 'draft', runs: [], winner: null, entered: 2, writes: [] };
  const gw = { call: async (m, p, body) => {
    if (m !== 'GET') st.writes.push(`${m} ${p.split('?')[0]}`);
    if (m === 'GET' && p.includes('/trigger')) return trigs;
    if (m === 'GET') return { ok: true, status: 200, json: { ...doc().json, status: st.status } };
    if (m === 'POST' && p.includes('/test-workflow/')) { st.runs.unshift({ requestId: 'REQ1' }); return { ok: true, status: 200, json: { requestId: 'REQ1' } }; }
    return { ok: true, status: 200, json: {} };
  } };
  const tools = {
    list_workflow_test_runs: () => ({ ok: true, data: { runs: [...st.runs] } }),
    get_workflow_test_run: () => ({ ok: true, data: { progress: { events: [{ status: 'finished' }] }, stepEvents: { e: 1 } } }),
    get_step_latest_test_result: () => ({ ok: true, data: { present: false, reason: 'none' } }),
    get_ab_test_stats: () => ({ ok: true, data: { paths: [{ pathId: PA, entered: st.entered }, { pathId: PB, entered: st.entered }], absent: [], winnerPathId: st.winner } }),
    publish_workflow: () => { st.status = 'published'; return { ok: true }; },
    unpublish_workflows: () => { st.status = 'draft'; return { ok: true }; },
    declare_ab_test_winner: (a) => (a.confirm === true ? (st.winner = PA, { ok: true, data: { declared: true } }) : { ok: false, code: 'CONFIRM_REQUIRED' }),
    ...over,
  };
  return { st, gw, tools };
}
function run(w, extra = {}) {
  const lines = []; const mk = createDeclaredMarker(AB_TOOLS);
  const call = mk.wrapCall(async (n, a) => { const f = w.tools[n]; if (!f) throw new Error(`no mock for ${n}`); return f(a); });
  const chk = (c, m, d) => mk.check(c, m, d, (cond, msg) => lines.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`));
  const ctl = { scope: scopeOf() };
  return runAbTestProof({ call, gw: w.gw, LOCATION: LOC, workflowId: WID, workflowName: NAME, contactId: CID, chk, mk, say: (l) => lines.push(l), ctl, sleep: async () => {}, pollMs: 0, polls: 2, ...extra })
    .then((out) => ({ out, lines, mk, ctl }));
}
const credited = (r) => new Set(r.mk.entries().filter((e) => e.failed === 0 && e.passed > 0).map((e) => e.tool));

test('happy path: all five tools credited, one write of each kind, the workflow ends a draft', async () => {
  const w = world(); const r = await run(w);
  assert.equal(r.lines.filter((l) => l.startsWith('FAIL')).length, 0, r.lines.join('\n'));
  assert.deepEqual([...credited(r)].sort(), [...AB_TOOLS].sort());
  assert.equal(w.st.runs.length, 1); assert.equal(w.st.status, 'draft'); assert.equal(w.st.winner, PA);
  assert.equal(w.st.writes.filter((x) => x.includes('test-workflow')).length, 1);
  assert.equal(r.out.published, true); assert.equal(r.out.declared, true);
});

test('a published or non TEST-CONF workflow: nothing is written and nothing is credited', async () => {
  const w = world(); w.st.status = 'published';
  const r = await run(w);
  assert.equal(r.out.halted, true); assert.deepEqual(w.st.writes, []); assert.equal(credited(r).size, 0);
  const w2 = world(); const r2 = await run(w2, { workflowName: 'TEST-CONF-OTHER' });
  assert.equal(r2.out.halted, true); assert.deepEqual(w2.st.writes, []);
});

test('a failure after the publish still unpublishes, and the draft is read back', async () => {
  const w = world({ declare_ab_test_winner: () => { throw new Error('boom'); } });
  const r = await run(w);
  assert.equal(r.out.halted, true); assert.equal(w.st.status, 'draft');
  assert.ok(r.lines.some((l) => /^PASS FENCE: the workflow reads back as a draft/.test(l)));
});

test('an unpublish that does not take is reported UNKNOWN', async () => {
  const w = world({ unpublish_workflows: () => ({ ok: true }) });
  const r = await run(w);
  assert.equal(r.out.unknown, true);
  assert.ok(r.lines.some((l) => /^FAIL FENCE/.test(l)));
});

test('an auth code stops the run after the baseline: no write is attempted', async () => {
  const w = world({ list_workflow_test_runs: () => ({ ok: false, code: 'TOKEN_EXPIRED' }) });
  const r = await run(w);
  assert.equal(r.out.halted, true); assert.equal(r.out.reason, 'TOKEN_EXPIRED'); assert.deepEqual(w.st.writes, []);
});

test('an empty stats total is not credited', async () => {
  const w = world(); w.st.entered = 0; const r = await run(w);
  assert.ok(!credited(r).has('get_ab_test_stats'));
});

test('the file holds no real id, no delete, and no contact or tag write route', () => {
  const src = readFileSync(new URL('../../skills/create-ghl-workflow/scripts/wf-abtest-proof.mjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(src));
  assert.ok(!/\bDELETE\b|rmSync|unlinkSync|\/contacts\b|create_contact|build_workflow/.test(src));
});
