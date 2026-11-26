#!/usr/bin/env node
// LIVE: pause and restore of ONE TEST-CONF flow that carries two triggers, to prove the pause comparator (pause-flow.mjs) before it is ever pointed
// at a non-TEST flow again. Born from a restore where the byte-equal check failed on the publish's own re-stamped
// date_updated and nothing else could be proven (the pre-pause list was not kept).
//
//   GHL_LOCATION='<locId>' node pause-restore-proof.mjs
//
// What it does, in order, and nothing else:
//   1. builds TEST-CONF-W9-DRIFT-pause-restore-<stamp>: two contact_tag triggers, each on a tag nothing in this script (or the suite) ever adds, one step that tags;
//   2. publishes it and reads back that it is published with both triggers active;
//   3. pauseFlow (unpublish, read back as draft, the trigger list read and kept masked) then restoreFlow (publish, read back, the lists diffed field by field,
//      server-stamped fields excluded);
//   4. takes it down again in a finally and reads it back as a draft.
// Fences: NO contact is created, NO enrolment, no phone, no email. The triggers cannot fire: their tags are random to this run and never written.
// Nothing is deleted. The flow stays, named TEST-CONF-*, as a draft.
import { unpublishAndAssertDraft } from './probe-readback.mjs';
import { confirmedCall } from './two-step.mjs';
import { pauseFlow, restoreFlow, pauseRecord, diffTriggers, SERVER_STAMPED_TRIGGER_FIELDS } from './pause-flow.mjs';

export async function runPauseRestoreProof({ call, gw, LOCATION, NAME, STAMP, check, left, onWid = null }) {
  const TAG_A = `test-conf-w9-drift-${STAMP}-pause-never-a`, TAG_B = `test-conf-w9-drift-${STAMP}-pause-never-b`;
  const nameOf = NAME('pause-restore');
  const trig = (ref, tag) => ({ ref, type: 'contact_tag', name: `pause-restore never ${ref}`, filters: [{ field: 'tagsAdded', operator: 'index-of-true', value: [tag] }] });
  const b = await call('build_workflow', { spec: { name: nameOf, triggers: [trig('a', TAG_A), trig('b', TAG_B)], graph: [
    { ref: 'x', kind: 'action', type: 'add_contact_tag', name: 'Tag (never reached)', attributes: { tags: [`test-conf-w9-drift-${STAMP}-pause-step`] } }] } });
  const wid = b.data?.wid;
  check(b.ok === true && typeof wid === 'string', 'build_workflow creates the two-trigger TEST-CONF flow', `${b.code ?? ''} ${String(b.detail ?? '').slice(0, 200)}`);
  if (!wid) return { ok: false, built: false };
  onWid?.(wid);
  left.push(`workflow ${wid} (${nameOf}, two contact_tag triggers on tags nothing adds; published for the proof and unpublished after)`);
  let rec = null;
  try {
    const p = await confirmedCall(call, 'publish_workflow', { workflowId: wid });
    check(p.ok === true, 'publish_workflow publishes the two-trigger flow', `${p.code ?? ''} ${String(p.detail ?? '').slice(0, 200)}`);
    const g = await call('get_workflow', { workflowId: wid });
    const trs = await gw.call('GET', `/workflow/${encodeURIComponent(LOCATION)}/trigger?workflowId=${encodeURIComponent(wid)}`);
    const list = trs.json?.triggers ?? (Array.isArray(trs.json) ? trs.json : []);
    check(g.data?.status === 'published' && list.length >= 2 && list.every((t) => t.active === true), 'PRECONDITION: published, with at least 2 triggers, all active', JSON.stringify([g.data?.status, list.length, list.map((t) => t.active)]));
    if (!(p.ok === true && list.length >= 2)) return { ok: false };
    rec = await pauseFlow({ call, gw, LOCATION, id: wid, name: nameOf, unpublish: unpublishAndAssertDraft, beforeUnpublish: (r) => left.push(`PAUSED, NOT RESTORED: workflow ${r.id} (${r.name}) is a draft until the restore reads back`) });
    check(rec.paused === true, 'PAUSE: the flow reads back as a draft (id and name read back before)', JSON.stringify([rec.refused ?? null, rec.paused]));
    check(Array.isArray(rec.triggersBeforeMasked) && rec.triggersBeforeMasked.length === list.length, 'the masked pre-pause trigger list is kept in the record', String(rec.triggersBeforeMasked?.length));
    const done = await restoreFlow({ call, gw, LOCATION, rec, publish: confirmedCall });
    if (done.restored === true) { const i = left.findIndex((l) => l.startsWith(`PAUSED, NOT RESTORED: workflow ${wid}`)); if (i >= 0) left.splice(i, 1); }
    check(done.restored === true, 'RESTORE: the flow is published again', JSON.stringify([done.restored, done.statusBeforeRestore]));
    check(done.triggersEqual === true, 'RESTORE: the trigger list is equal to before, field by field (server-stamped fields excluded)', JSON.stringify(done.triggerDiff ?? null).slice(0, 400));
    // Informational, not a pass condition: did the publish re-stamp date_updated on the triggers, as an earlier restore showed?
    check(true, `INFO: the raw trigger JSON ${done.triggersRawEqual ? 'was' : 'was NOT'} byte-equal across the pause (excluded fields: ${SERVER_STAMPED_TRIGGER_FIELDS.join(', ')})`);
    // The comparator must still SEE a real change: prove it on the live list, offline, with one field flipped.
    const afterRes = await gw.call('GET', `/workflow/${encodeURIComponent(LOCATION)}/trigger?workflowId=${encodeURIComponent(wid)}`);
    const afterList = afterRes.json?.triggers ?? (Array.isArray(afterRes.json) ? afterRes.json : []); // the SAME shape tolerance as the precondition read above
    check(afterList.length >= 2, 'CONTROL input: the trigger list read back after the restore has at least 2 rows', String(afterList.length));
    const flipped = afterList.map((t, i) => (i === 0 ? { ...t, active: !t.active } : t));
    const d = diffTriggers(afterList, flipped);
    check(d.length === 1 && d[0].path === 'triggers[0].active', 'CONTROL: the comparator reports one flipped field on the live list by path', JSON.stringify(d));
    return { ok: done.ok === true, record: pauseRecord(done) };
  } finally {
    // Whatever happened, the flow is taken down and read back as a draft. A paused-and-unrestored flow is already a draft; this is then a no-op read.
    await unpublishAndAssertDraft(call, check, wid, 'pause-restore proof, take down');
    if (rec) console.log(`RECORD pause ${JSON.stringify([pauseRecord(rec)])}`);
  }
}

// CLI: the same gateway set-up the conformance suite uses, so the runner can start this file directly.
if (process.argv[1]?.endsWith('pause-restore-proof.mjs')) {
  // GATE first: before any auth or tool import. Unknown flag -> 2; --smoke/--dry -> 0 with no call; live needs D18_RUNNER_S + QA_CLEARED + a passed --go.
  (await import('./entry-gate.mjs')).enforce(process.env, process.argv.slice(2));
  const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
  if (!LOCATION) { console.error("GHL_LOCATION is required.\n  GHL_LOCATION='<locationId>' node pause-restore-proof.mjs"); process.exit(1); }
  const { makeGatewayFactory, TOOLS } = await import('../../../mcp-internal/core/tools.mjs');
  const { DEFAULT_TOKEN_FILE } = await import('../../../mcp-internal/core/auth.mjs');
  const { makeStamp } = await import('./published-trigger-census.mjs');
  const { callSafe } = await import('./run-hygiene.mjs');
  const STAMP = makeStamp();
  const NAME = (s) => `TEST-CONF-W9-DRIFT-${s}-${STAMP}`;
  const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE, engineVersion: 'workflows-pause-restore-proof', allowedLocations: new Set([LOCATION]) };
  const deps = { state, makeGw: (o = {}) => makeGatewayFactory({ state })(o) };
  const { handleStop, trackInflight } = await import('./pause-signal.mjs');
  const st = { wid: null, name: NAME('pause-restore'), inflight: new Set() };
  const rawCall = (n, args) => callSafe((nm, a) => TOOLS.find((t) => t.name === nm).handler({ locationId: LOCATION, ...a }, deps), n, args);
  const call = trackInflight(st, rawCall);
  const gw = deps.makeGw({ loc: LOCATION, state });
  const gwT = { call: trackInflight(st, (...x) => gw.call(...x)) };
  let passed = 0, failed = 0;
  const check = (cond, m, extra) => { if (cond) { passed++; console.log(`  PASS  ${m}`); } else { failed++; console.log(`  FAIL  ${m}${extra ? `  — ${extra}` : ''}`); } };
  const left = [];
  console.log(`pause-restore proof, stamp ${STAMP}`);
  let res = { ok: false };
  // A runner kill never claims a take-down it did not prove: see pause-signal.mjs (UNKNOWN + exit 3 unless a separate read-back says draft after in-flight calls settled).
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { void handleStop({ sig, st, call: rawCall }); });
  try { res = await runPauseRestoreProof({ call, gw: gwT, LOCATION, NAME, STAMP, check, left, onWid: (w) => { st.wid = w; } }); }
  catch (e) { failed++; console.log(`  FAIL  the proof threw: ${String(e?.message ?? e).slice(0, 200)}`); }
  // Once a signal has been taken, ONLY the handler may exit: main waits here forever so it can never exit first or print a result over the handler's.
  if (st.stopped) await new Promise(() => {});
  console.log('\nLEFT IN PLACE (nothing is deleted):'); for (const l of left) console.log(`  ${l}`);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 && res.ok === true ? 0 : 1);
}
