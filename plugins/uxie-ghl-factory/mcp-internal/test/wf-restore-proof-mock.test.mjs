// MOCK RUN of wf-restore-proof.mjs. Response shapes are the handlers' own (core/tools.mjs): list_workflow_versions -> data.versions[{versionId,version,status,name}];
// restore_workflow_version refuses a 0-step target even on the preview (VALIDATION_FAILED "holds 0 steps"), refuses the version the workflow is already on, previews as
// CONFIRM_REQUIRED with data.preview.steps.{target,current}, and returns restored/verified/to{status,steps}. GHL writes a version RECORD only at create (empty) and at each
// publish; the workflow's own version number goes up on every save. That is why the base must be chosen by its step count, not by position (an earlier version of the proof picked versions[0], the empty v1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRestoreProof, RESTORE_TOOLS, Halt, Stopped, makeStopControl, makeRestoreSignalHandler } from '../../skills/create-ghl-workflow/scripts/wf-restore-proof.mjs';
import { createDeclaredMarker } from '../../skills/create-ghl-workflow/scripts/declared-marker.mjs';

function world({ failPublish = false, noPublishRecord = false, trigger0 = false, exportFailAt = 0, publishThrows = false, unpublishFails = false, triggerAfterEdit = false, editThrows = false, strictBody = null, strictStatus = 200, authOn = null, buildLost = false, restoreTriggers = 0 } = {}) {
  const w = { f: null, log: [], confirmedRestores: 0, exports: 0 };
  const ok = (data) => ({ ok: true, data });
  const fail = (code, detail, data) => ({ ok: false, code, detail, ...(data ? { data } : {}) });
  const call = async (n, a) => {
    w.log.push(n);
    const f = w.f;
    if (authOn && authOn.tool === n && (authOn.nth ?? 1) === (w.log.filter((x) => x === n).length)) return fail(authOn.code, 'auth');
    switch (n) {
      case 'build_workflow': if (buildLost) { w.f = { wid: 'W1', name: a.spec.name, steps: 1, status: 'draft', version: 1, records: [{ version: 1, steps: 0 }], triggers: 0 }; return fail('TRANSPORT_FAILED', 'lost'); } w.f = { wid: 'W1', name: a.spec.name, steps: 1, status: 'draft', version: 1, records: [{ version: 1, steps: 0 }], triggers: trigger0 ? 1 : 0 }; return ok({ wid: 'W1' });
      case 'export_workflow': w.exports++; if (w.exports === exportFailAt) return fail('TRANSPORT_FAILED', 'down'); return ok({ workflow: { name: f.name, status: f.status, workflowData: { templates: Array.from({ length: f.steps }, (_, i) => ({ id: `s${i}`, type: 'add_contact_tag' })) } }, triggers: Array.from({ length: f.triggers }, (_, i) => ({ id: `t${i}` })) });
      case 'get_workflow': return ok({ status: f.status });
      case 'publish_workflow':
        if (a.confirm !== true) return fail('CONFIRM_REQUIRED', 'preview', { preview: true });
        if (failPublish) return fail('ENGINE_ABORT', 'publish refused');
        f.version += 1; f.status = 'published'; if (!noPublishRecord) f.records.push({ version: f.version, steps: f.steps });
        if (publishThrows) throw new Error('socket hang up after the publish landed');
        return ok({ verify: { totalTriggers: 0 } });
      case 'unpublish_workflows': if (unpublishFails) return fail('TRANSPORT_FAILED', 'down'); f.version += 1; f.status = 'draft'; return ok({ unpublished: a.workflowIds });
      case 'edit_workflow': if (editThrows) throw new Error('edit blew up'); f.steps += 1; f.version += 1; if (triggerAfterEdit) f.triggers = 1; return ok({ edited: true });
      case 'list_workflow_versions': return ok({ versions: [...f.records].reverse().map((r) => ({ versionId: `id${r.version}`, version: r.version, status: 'x', name: f.name })) }); // newest first, like the handler
      case 'restore_workflow_version': {
        if (a.workflowName !== f.name) return fail('VALIDATION_FAILED', 'target proof failed: workflow is named differently. Nothing was written.');
        if (f.version === a.version) return fail('VALIDATION_FAILED', `version ${a.version} is the version the workflow is already on. Nothing was written.`);
        const rec = f.records.find((r) => r.version === a.version);
        if (rec.steps === 0 && f.steps > 0) return fail('VALIDATION_FAILED', `version ${a.version} holds 0 steps and the workflow now has ${f.steps}`, { versionSteps: 0, currentSteps: f.steps });
        if (a.confirm !== true) return fail('CONFIRM_REQUIRED', 'preview', { preview: { steps: { target: rec.steps, current: f.steps } } });
        w.confirmedRestores++; f.steps = rec.steps; f.version += 1; f.status = 'draft';
        return ok({ restored: true, verified: true, to: { status: 'draft', steps: f.steps, name: f.name, triggers: Array.from({ length: restoreTriggers }, (_, i) => ({ id: `t${i}` })) } });
      }
      default: throw new Error(`unexpected tool ${n}`);
    }
  };
  const gw = { call: async (m, path) => { w.log.push(`GET trigger`); w.gwCalls = (w.gwCalls ?? 0) + 1; return { ok: strictStatus === 200, status: strictStatus, json: strictBody ?? Array.from({ length: w.f.triggers }, (_, i) => ({ id: `t${i}` })) }; } };
  return { w, call, gw };
}
async function run(opts) {
  const { w, call, gw } = world(opts); const lines = []; const left = []; const said = [];
  const mk = createDeclaredMarker(RESTORE_TOOLS);
  const check = (c, m) => lines.push({ c, m });
  const res = await runRestoreProof({ call, gw, LOCATION: 'L', NAME: (s) => `TEST-CONF-W9-WF-${s}-000001`, STAMP: '000001', check, left, mk, say: (s) => said.push(s) });
  return { w, lines, left, said, mk, res };
}

test('the base is the first version WITH steps, not versions[0]; the restore reads back one step, draft', async () => {
  const r = await run();
  assert.deepEqual(r.lines.filter((l) => !l.c), []);
  assert.equal(r.w.confirmedRestores, 1);
  assert.equal(r.w.f.steps, 1); assert.equal(r.w.f.status, 'draft');
  const e = r.mk.entries().find((x) => x.tool === 'restore_workflow_version');
  assert.ok(e.passed >= 4 && e.failed === 0);
  assert.deepEqual(r.mk.entries().map((x) => x.tool), ['restore_workflow_version']); // no other tool is credited
});
test('every publish is followed by an unpublish and a SEPARATE draft read; LEFT is printed from the final read', async () => {
  const r = await run();
  const i = r.w.log.indexOf('publish_workflow'); const j = r.w.log.indexOf('unpublish_workflows');
  assert.ok(i >= 0 && j > i && r.w.log.slice(j).includes('get_workflow'));
  assert.ok(r.said.some((s) => /final read ok=true status=draft steps=1 triggers=0/.test(s)));
});
test('a refused publish still gets its unpublish and draft read-back', async () => {
  const r = await go({ failPublish: true }); // round 2 point 4: a publish that is not ok is taken down, read back, then HALTED (no base search)
  assert.ok(r.w.log.includes('unpublish_workflows')); assert.equal(r.w.f.status, 'draft');
  assert.equal(r.w.confirmedRestores, 0);
  assert.ok(r.err instanceof Halt && r.outcome.halted === true);
});
test('no version with steps: the base check FAILS loudly and nothing is confirmed', async () => {
  const r = await run({ noPublishRecord: true });
  assert.equal(r.w.confirmedRestores, 0);
  assert.ok(r.lines.some((l) => !l.c && /base version exists/.test(l.m)));
  assert.ok(!r.w.log.includes('restore_workflow_version') || r.w.f.steps === 2);
});

// ── QA's eight points (2026-11-22) ──
test('1: a probe with a trigger, or an export that failed, is NEVER published', async () => {
  const a = await run({ trigger0: true });
  assert.ok(!a.w.log.includes('publish_workflow')); assert.ok(!a.w.log.includes('edit_workflow'));
  assert.ok(a.lines.some((l) => !l.c && /READ before any publish/.test(l.m)));
  const b = await run({ exportFailAt: 1 });
  assert.ok(!b.w.log.includes('publish_workflow')); // a failed read is not "n=0, triggers=0"
  assert.ok(b.lines.some((l) => !l.c && /READ before any publish/.test(l.m)));
});
test('2: a publish call that throws is PUBLISHED-OR-UNKNOWN even when the read after the unpublish says draft: the run halts', async () => {
  const r = await run({ publishThrows: true }).catch((e) => ({ err: e }));
  assert.ok(r.err instanceof Halt, 'a publish that threw is PUBLISHED-OR-UNKNOWN: halt');
});
test('2b: the unpublish is sent for a publish that threw (flag set before the call)', async () => {
  const { w, call, gw } = world({ publishThrows: true }); const mk = createDeclaredMarker(RESTORE_TOOLS);
  await assert.rejects(runRestoreProof({ call, gw, LOCATION: 'L', NAME: (s) => `TEST-CONF-W9-WF-${s}-000001`, STAMP: '000001', check: () => {}, left: [], mk, say: () => {} }), Halt);
  assert.ok(w.log.includes('unpublish_workflows')); assert.equal(w.f.status, 'draft'); assert.equal(w.confirmedRestores, 0);
});
test('3: a failed unpublish halts: PUBLISHED-OR-UNKNOWN, one retry, no edit, preview or restore', async () => {
  const { w, call, gw } = world({ unpublishFails: true }); const said = []; const mk = createDeclaredMarker(RESTORE_TOOLS);
  await assert.rejects(runRestoreProof({ call, gw, LOCATION: 'L', NAME: (s) => `TEST-CONF-W9-WF-${s}-000001`, STAMP: '000001', check: () => {}, left: [], mk, say: (s) => said.push(s) }), Halt);
  assert.equal(w.log.filter((n) => n === 'unpublish_workflows').length, 3); // the call, ONE retry, and the finally's one unpublish (round 2 point 3)
  assert.ok(!w.log.includes('edit_workflow') && !w.log.includes('restore_workflow_version') && !w.log.includes('list_workflow_versions'));
  assert.ok(said.some((s) => /PUBLISHED-OR-UNKNOWN workflow W1/.test(s)));
  assert.ok(said.some((s) => /^LEFT workflow W1/.test(s) && /status=published/.test(s))); // the finally still says what was read
});
test('4: signal handler: stops new calls, waits for the one in flight, unpublishes, reads back; second signal is a no-op; exit 3 when not proven', async () => {
  for (const [draft, code] of [[true, 143], [false, 3]]) {
    const ctl = makeStopControl(); const printed = []; let exited = null; let downCalls = 0;
    let release; const slow = ctl.guard(() => new Promise((r) => { release = r; }));
    const h = makeRestoreSignalHandler({ ctl, down: async () => { downCalls++; return draft; }, flows: new Set(['W1']), left: ['workflow W1'], mk: { write() {} }, print: (s) => printed.push(s), exit: (c) => { exited = c; }, timeoutMs: 1000 });
    const p1 = h('SIGTERM'); const p2 = h('SIGINT');
    await assert.rejects(ctl.guard(async () => 1), Stopped); // nothing new is sent after the stop
    assert.equal(downCalls, 0); // still waiting for the call in flight
    release(1); await p1; await p2;
    assert.equal(downCalls, 1); assert.equal(exited, code); assert.equal(printed.filter((s) => /STOPPED by/.test(s)).length, 1);
    void slow;
  }
});
test('5: the confirmed restore is not sent if the pre-restore read shows a trigger; the finally still reads and prints LEFT', async () => {
  const r = await run({ triggerAfterEdit: true });
  assert.equal(r.w.confirmedRestores, 0);
  assert.ok(r.lines.some((l) => !l.c && /right before the confirmed restore/.test(l.m)));
  assert.ok(r.said.some((s) => /^LEFT workflow W1/.test(s)));
});
test('5b: an ok:false read of the edited state (3rd export) stops before the version walk and sends no restore', async () => {
  const r = await run({ exportFailAt: 3 });
  assert.ok(!r.w.log.includes('list_workflow_versions')); assert.equal(r.w.confirmedRestores, 0);
  assert.ok(r.lines.some((l) => !l.c && /PRECONDITION/.test(l.m)));
});
test('8: a throw mid-run still gets the final read and the LEFT line', async () => {
  const { w, call, gw } = world({ editThrows: true }); const said = []; const mk = createDeclaredMarker(RESTORE_TOOLS);
  await assert.rejects(runRestoreProof({ call, gw, LOCATION: 'L', NAME: (s) => `TEST-CONF-W9-WF-${s}-000001`, STAMP: '000001', check: () => {}, left: [], mk, say: (s) => said.push(s) }), /edit blew up/);
  assert.ok(said.some((s) => /^LEFT workflow W1.*status=draft/.test(s)));
  void w;
});

// ---- QA round 2 (points 1-6) ----
const NM = (s) => `TEST-CONF-W9-WF-${s}-000001`;
async function go(opts) {
  const { w, call, gw } = world(opts); const lines = []; const left = []; const said = []; const outcome = {};
  const mk = createDeclaredMarker(RESTORE_TOOLS); let err = null;
  try { await runRestoreProof({ call, gw, LOCATION: 'L', NAME: NM, STAMP: '000001', check: (c, m) => lines.push({ c, m }), left, mk, say: (s) => said.push(s), outcome }); } catch (e) { err = e; }
  return { w, lines, left, said, outcome, err };
}
test('point 1: a strict trigger GET that is not a 200 array of length 0 blocks the publish', async () => {
  for (const o of [{ strictBody: { data: [] } }, { strictStatus: 500 }, { strictBody: [{ id: 'x' }] }]) {
    const r = await go(o);
    assert.ok(!r.w.log.includes('publish_workflow'), JSON.stringify(o));
  }
});
test('point 2: TOKEN_EXPIRED / ACCESS_DENIED at the first export, first preview and unpublish stop the run', async () => {
  for (const [tool, code] of [['export_workflow', 'TOKEN_EXPIRED'], ['restore_workflow_version', 'ACCESS_DENIED'], ['unpublish_workflows', 'TOKEN_EXPIRED']]) {
    const r = await go({ authOn: { tool, nth: 1, code } });
    assert.ok(r.said.some((s) => s.includes(`AUTH STOP code=${code}`)), tool);
    assert.equal(r.w.confirmedRestores, 0, tool);
    if (tool === 'export_workflow') assert.ok(!r.w.log.includes('publish_workflow') && !r.w.log.includes('edit_workflow'));
    if (tool === 'restore_workflow_version') assert.ok(!r.w.log.filter((n) => n === 'restore_workflow_version').length || r.w.log.filter((n) => n === 'restore_workflow_version').length === 1);
  }
});
test('point 3: a final read that is not draft after a publish gets an unpublish and halts when still unproven', async () => {
  const r = await go({ unpublishFails: true });
  assert.equal(r.outcome.halted, true);
  assert.ok(r.said.some((s) => s.includes('PUBLISHED-OR-UNKNOWN')));
});
test('point 4: a publish that is not ok is taken down, read back, and halts before any edit', async () => {
  const r = await go({ failPublish: true });
  assert.ok(!r.w.log.includes('edit_workflow'));
  assert.ok(r.w.log.includes('unpublish_workflows'));
  assert.equal(r.outcome.halted, true);
});
test('point 5: to.triggers must be an array of length 0 after the restore', async () => {
  const r = await go({ restoreTriggers: 1 });
  assert.ok(r.lines.some((l) => !l.c && /to\.triggers/.test(l.m)));
});
test('point 6: both location tags are in LEFT; a lost build answer prints LEFT with the intended name and UNKNOWN', async () => {
  const ok = await go({});
  assert.ok(ok.left.some((x) => /test-conf-w9-wf-000001-restore-a/.test(x)) && ok.left.some((x) => /test-conf-w9-wf-000001-restore-b/.test(x)));
  const lost = await go({ buildLost: true });
  assert.ok(lost.said.some((s) => /LEFT intended workflow TEST-CONF-W9-WF-wf-restore2-000001/.test(s) && /UNKNOWN/.test(s)));
  assert.equal(lost.outcome.unknownBuild, true);
});
