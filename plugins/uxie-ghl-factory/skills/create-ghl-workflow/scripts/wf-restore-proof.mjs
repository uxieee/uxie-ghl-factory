// d18 restore-only proof: restore_workflow_version, ONE tool, no contact, no other tool credited.
// A first version of this proof picked versions[0] as the base, which was the empty create snapshot. GHL writes version records only at create (the EMPTY workflow) and at each
// publish, so a restore target with steps exists only after a publish. This proof therefore: builds a one-step, ZERO-trigger flow, and ONLY after a
// separate read shows exactly that (ok, exact name, draft, one step of the built type, a real triggers array of length 0) publishes it; takes it
// straight back down and reads it back as exactly "draft" on a SEPARATE GET (anything else: PUBLISHED-OR-UNKNOWN, one retry of the unpublish, exit 3,
// no edit, preview or restore); edits it to two steps; picks the base as the first version whose restore PREVIEW answers CONFIRM_REQUIRED with a
// target step count equal to the one-step state (a 0-step version is refused on the preview too, so the choice is read-only); re-reads zero triggers and
// draft right before the confirmed restore (the handler DELETEs current triggers); restores; a separate export proves one step, a draft, same name.
// A finally makes the final draft read and the LEFT line, also on a throw. Labels are printed from what was read, not written beforehand.
import { createDeclaredMarker } from './declared-marker.mjs';
import { confirmedCall } from './two-step.mjs';
import { unpublishAndAssertDraft } from './probe-readback.mjs';
import { gateOrExit } from './d18-gate.mjs';
import { Stopped, makeStopControl } from './stop-control.mjs';
export { Stopped, makeStopControl };

export const RESTORE_TOOLS = Object.freeze(['restore_workflow_version']);
export const restoreTag = (stamp, which) => `test-conf-w9-wf-${stamp}-restore-${which}`;
export class Halt extends Error { constructor(m) { super(m); this.name = 'Halt'; } }
export class AuthStop extends Halt { constructor(code) { super(`auth stop: ${code}`); this.name = 'AuthStop'; this.code = code; } }
const AUTH_CODES = Object.freeze(['TOKEN_EXPIRED', 'ACCESS_DENIED']);

export async function runRestoreProof({ call: rawCall, gw, LOCATION, NAME, STAMP, check: report, left, mk, onWid = null, say = console.log, outcome = {} }) {
  const base = mk.wrapCall(rawCall);
  let dead = null; let cleanup = false; let published = false;
  // item 2: ONE place stops the run on a dead token. After TOKEN_EXPIRED/ACCESS_DENIED from ANY call nothing more is sent, except (in clean-up) the unpublish and the read of a flow that may be published.
  const noteAuth = (code, what) => { if (!AUTH_CODES.includes(code)) return; dead = dead ?? code; say(`AUTH STOP code=${code} on ${what}`); if (!cleanup) throw new AuthStop(code); };
  const call = async (n, a) => {
    if (dead && !(cleanup && (n === 'unpublish_workflows' || n === 'get_workflow'))) throw new AuthStop(dead);
    const r = await base(n, a); noteAuth(r?.code, n); return r;
  };
  const chk = (c, m, d) => mk.check(c, m, d, report);
  const none = (c, m, d) => { mk.subject(false); mk.check(c, m, d, report); };
  const rname = NAME('wf-restore2');
  const tagA = restoreTag(STAMP, 'a'); const tagB = restoreTag(STAMP, 'b');
  // item 1: the strict separate GET of the trigger list: status 200 AND the body itself an array. Anything else (an object, an error, an unknown 200 body) is null, never 0.
  const strictTriggers = async (wid) => {
    if (dead) throw new AuthStop(dead);
    const r = await gw.call('GET', `/workflow/${encodeURIComponent(LOCATION)}/trigger?workflowId=${encodeURIComponent(wid)}`);
    if (r?.status === 401) noteAuth('TOKEN_EXPIRED', 'GET trigger list'); if (r?.status === 403) noteAuth('ACCESS_DENIED', 'GET trigger list');
    return r?.status === 200 && Array.isArray(r?.json) ? r.json.length : null;
  };
  // a failed read is never n=0 or triggers=0: n and triggers are null unless the read answered with the real arrays
  const steps = async (wid) => {
    const e = await call('export_workflow', { workflowId: wid });
    const tpl = e?.data?.workflow?.workflowData?.templates; const trg = e?.data?.triggers;
    return { ok: e?.ok === true && !!e?.data?.workflow, n: Array.isArray(tpl) ? tpl.length : null, type: Array.isArray(tpl) ? (tpl[0]?.type ?? null) : null, status: e?.data?.workflow?.status ?? null, name: e?.data?.workflow?.name ?? null, triggers: Array.isArray(trg) ? trg.length : null };
  };
  let wid = null; let lastDraft = false;
  const takeDown = async (label) => { // bl-1021: the shared assert-draft helper (its own separate GET), then a further separate read the halt rules act on
    await unpublishAndAssertDraft(call, (c, m, d) => mk.check(c, m, d, report), wid, label);
    const rd = await call('get_workflow', { workflowId: wid }); return rd?.ok === true ? (rd?.data?.status ?? null) : null;
  };
  const halt = (why) => { outcome.halted = true; throw new Halt(why); };
  try {
    mk.subject(false);
    const b = await call('build_workflow', { spec: { name: rname, triggers: [], graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag A', attributes: { tags: [tagA] } }] } });
    wid = typeof b?.data?.wid === 'string' ? b.data.wid : null; outcome.wid = wid;
    none(b?.ok === true && wid !== null, 'build_workflow creates the restore probe (one step, no trigger)', `${b?.code ?? ''}`);
    if (wid === null) { say(`LEFT intended workflow ${rname}: the build answer is not usable, so it MAY exist: state UNKNOWN; location tag ${tagA} may exist too`); outcome.unknownBuild = true; return outcome; }
    onWid?.(wid); left.push(`workflow ${wid} (${rname}) BUILT; its state is read below`); left.push(`location tag ${tagA} (created by build_workflow)`);

    // items 1 and 4: the read the publish rests on, with the strict trigger list
    const s1 = await steps(wid); const t1 = await strictTriggers(wid);
    const ready = s1.ok && s1.name === rname && s1.status === 'draft' && s1.n === 1 && s1.type === 'add_contact_tag' && s1.triggers === 0 && t1 === 0;
    none(ready, 'READ before any publish: draft, exactly one add_contact_tag step, zero triggers on the export AND on a strict separate GET of the trigger list (a body that is an array of length 0); anything else: nothing is published', JSON.stringify({ ok: s1.ok, nameOk: s1.name === rname, n: s1.n, type: s1.type, status: s1.status, triggers: s1.triggers, strict: t1 }));
    if (!ready) return outcome;

    // item 2 of the first round: the flag is set BEFORE the call. Item 4: anything but a clean publish is taken down, read back, then halted.
    let pubThrew = null; let pub = null;
    try { published = true; lastDraft = false; pub = await confirmedCall(call, 'publish_workflow', { workflowId: wid }); }
    catch (e) { if (e instanceof Stopped || e instanceof AuthStop) throw e; pubThrew = e; }
    const pubOk = !pubThrew && pub?.ok === true && pub?.data?.verify?.totalTriggers === 0;
    none(pubOk, 'the probe published with ZERO triggers (nobody can enter it)', `${pubThrew ? 'threw' : (pub?.code ?? '')} totalTriggers=${pub?.data?.verify?.totalTriggers ?? 'n/a'}`);
    mk.subject(false);
    const status = await takeDown('restore probe');
    none(status === 'draft', 'restore probe: a further separate GET reads it as exactly draft after the unpublish', `status=${status}`);
    if (status === 'draft') lastDraft = true;
    if (status !== 'draft') {
      say(`PUBLISHED-OR-UNKNOWN workflow ${wid}: the read after the unpublish was ${status ?? 'not usable'}; retrying the unpublish once`);
      cleanup = true; let again = null; try { again = await takeDown('restore probe retry'); } catch (e) { if (e instanceof Stopped) throw e; }
      say(`after the retry a separate read says ${again ?? 'UNKNOWN'}; no edit, preview or restore will be sent`);
      if (again === 'draft') lastDraft = true;
      halt(`workflow ${wid} PUBLISHED-OR-UNKNOWN`);
    }
    if (!pubOk) halt(`the publish was not a clean zero-trigger publish (${pubThrew ? 'threw' : pub?.code ?? 'not ok'}); the flow was taken down and read back as a draft`);
    const s1b = await steps(wid); const t1b = await strictTriggers(wid);
    const down1 = s1b.ok && s1b.status === 'draft' && s1b.n === 1 && s1b.triggers === 0 && t1b === 0;
    none(down1, 'READ-BACK after the unpublish: draft, one step, zero triggers on the export and on the strict trigger GET', JSON.stringify({ n: s1b.n, status: s1b.status, triggers: s1b.triggers, strict: t1b }));
    if (!down1) halt('the state after the take-down is not exactly draft / one step / zero triggers');

    const ed = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [{ op: 'appendStep', step: { kind: 'action', type: 'add_contact_tag', name: 'Tag B', attributes: { tags: [tagB] } } }] });
    none(ed?.ok === true, 'edit_workflow appends a second step (the state the restore must undo)', `${ed?.code ?? ''}`);
    if (ed?.ok === true) left.push(`location tag ${tagB} (created by edit_workflow)`); else say(`LEFT location tag ${tagB}: the edit answer was not ok, so it MAY exist: state UNKNOWN`);
    const s2 = await steps(wid);
    const edited = s2.ok && s2.n === 2;
    none(edited, 'PRECONDITION: the edit reads back as two steps on a separate export (ok read required)', `${s2.n}`);
    if (!edited) return outcome;

    mk.subject('restore_workflow_version');
    const lv = await call('list_workflow_versions', { workflowId: wid, limit: 10, all: false });
    const nums = (lv?.data?.versions ?? []).map((v) => v.version).filter((v) => typeof v === 'number').sort((x, y) => x - y);
    let baseV = null; const tried = [];
    for (const v of nums) {
      const pv = await call('restore_workflow_version', { workflowId: wid, workflowName: rname, version: v });
      tried.push({ v, code: pv?.code ?? null, target: pv?.data?.preview?.steps?.target ?? pv?.data?.versionSteps ?? null });
      if (pv?.code === 'CONFIRM_REQUIRED' && pv?.data?.preview?.steps?.target === 1) { baseV = v; break; }
    }
    chk(baseV !== null, 'a base version exists whose restore PREVIEW answers CONFIRM_REQUIRED with a one-step target (the choice is read-only)', JSON.stringify({ versions: nums, tried }));
    if (baseV !== null) {
      mk.subject(false); const sp = await steps(wid); mk.subject('restore_workflow_version');
      chk(sp.ok && sp.n === 2, 'CONTROL: the previews changed nothing (an ok read: still two steps)', `${sp.n}`);
      const wrong = await call('restore_workflow_version', { workflowId: wid, workflowName: `${rname}-WRONG`, version: baseV, confirm: true });
      chk(wrong?.ok === false && wrong?.code === 'VALIDATION_FAILED' && /target proof failed/.test(String(wrong?.detail)), 'CONTROL: a mismatched workflow name is REFUSED by the target proof', `${wrong?.code ?? ''}`);
      // the handler DELETEs the current triggers before it writes: read draft, two steps and a STRICT zero-length trigger list right before the confirmed call
      mk.subject(false); const pre = await steps(wid); const tpre = await strictTriggers(wid); mk.subject('restore_workflow_version');
      const safe = pre.ok && pre.status === 'draft' && pre.triggers === 0 && pre.n === 2 && tpre === 0;
      chk(safe, 'READ right before the confirmed restore: draft, two steps, zero triggers on the export and on the strict trigger GET (the restore deletes triggers); otherwise it is not sent', JSON.stringify({ ok: pre.ok, status: pre.status, n: pre.n, triggers: pre.triggers, strict: tpre }));
      if (safe) {
        const done = await call('restore_workflow_version', { workflowId: wid, workflowName: rname, version: baseV, confirm: true });
        const toTrig = done?.data?.to?.triggers;
        chk(done?.ok === true && done?.data?.restored === true && done?.data?.verified === true && done?.data?.to?.status === 'draft' && done?.data?.to?.steps === 1 && Array.isArray(toTrig) && toTrig.length === 0, 'confirmed: the tool reports restored, verified, a draft, one step and to.triggers an array of length 0', `${done?.code ?? ''} ${String(done?.detail ?? '').slice(0, 140)}`);
        mk.subject(false); const s3 = await steps(wid); const t3 = await strictTriggers(wid); mk.subject('restore_workflow_version');
        chk(s3.ok && s3.n === 1 && s3.status === 'draft' && s3.name === rname && s3.triggers === 0 && t3 === 0, 'READ-BACK (separate export and strict trigger GET): one step, a DRAFT, name unchanged, zero triggers', JSON.stringify({ before: 1, edited: s2.n, restored: s3.n, status: s3.status, triggers: s3.triggers, strict: t3 }));
      }
    }
    return outcome;
  } finally {
    // the final separate read and the LEFT line, also on a throw. Once a publish was sent, anything but an exact draft read gets ONE unpublish, a separate read, PUBLISHED-OR-UNKNOWN if still unproven (outcome.halted: exit 3).
    if (wid !== null) {
      cleanup = true; mk.subject(false);
      let fin = null; let finErr = null;
      try { fin = await steps(wid); outcome.final = fin; } catch (e) { finErr = e; }
      if (fin) none(fin.ok && fin.status === 'draft', 'FINAL separate read: the probe is a draft', `status=${fin.status}`);
      if (published && !(fin?.ok && fin.status === 'draft')) {
        say(`PUBLISHED-OR-UNKNOWN workflow ${wid}: the final read was ${fin ? `status ${fin.status}` : 'not made'}; one unpublish and a separate read follow`);
        let st = null; try { st = await takeDown('restore probe final'); } catch (e) { if (!(e instanceof Stopped || e instanceof AuthStop)) st = null; }
        if (st === 'draft') say(`workflow ${wid}: a separate read after the unpublish says draft`); else { say(`PUBLISHED-OR-UNKNOWN workflow ${wid}: still not proven draft`); outcome.halted = true; }
      }
      say(`LEFT workflow ${wid} (${rname}): final read ok=${fin?.ok ?? 'n/a'} status=${fin?.status ?? 'n/a'} steps=${fin?.n ?? 'n/a'} triggers=${fin?.triggers ?? 'n/a'}${finErr ? ` (read threw: ${finErr instanceof Stopped ? 'stopped by a signal' : finErr instanceof AuthStop ? 'auth stop' : 'error'}; state UNKNOWN)` : ''}`);
    }
  }
}

// signals: stop new calls, wait for the one in flight, then unpublish and read back; a second signal is a no-op; the process exits only here
export function makeRestoreSignalHandler({ ctl, down, flows, left = [], mk, print = console.log, exit = process.exit, timeoutMs = 25000 }) {
  let once = false;
  return async (sig) => {
    if (once) return; once = true;
    print(`STOPPED by ${sig}: nothing further is sent; waiting for the call in flight`);
    let settled = false; try { settled = await ctl.stop(timeoutMs); } catch { settled = false; }
    let unknown = !settled;
    if (!settled) print('a call was STILL IN FLIGHT when the wait ended: it can land after the unpublish below, so every flow is state UNKNOWN');
    for (const w of [...flows]) {
      let ok = false;
      try { ok = (await Promise.race([down(w), new Promise((r) => setTimeout(() => r(false), timeoutMs))])) === true; } catch { ok = false; }
      if (ok && settled) print(`flow ${w} is a DRAFT (unpublished, then read back, no call in flight)`); else { unknown = true; print(`flow ${w} state UNKNOWN (PUBLISHED-OR-UNKNOWN)`); }
    }
    print('\nLEFT IN PLACE (nothing is deleted):'); for (const l of left) print(`  ${l}`);
    try { mk.write(); } catch { /* the exit code says what happened */ }
    exit(unknown ? 3 : 143);
  };
}

if (process.argv[1] && (await import('node:url')).fileURLToPath(import.meta.url) === process.argv[1]) { // fileURLToPath: a path with a space is %20 in import.meta.url
  gateOrExit({ what: 'the entry point would run the restore-only proof (build, publish+unpublish, edit, restore on a TEST-CONF flow)', allowed: ['--go='] });
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
  if (!LOCATION) { console.error('GHL_LOCATION is required.'); process.exit(2); }
  const CORE = join(fileURLToPath(new URL('.', import.meta.url)), '../../../mcp-internal/core');
  const { makeGatewayFactory, TOOLS } = await import(join(CORE, 'tools.mjs'));
  const { DEFAULT_TOKEN_FILE } = await import(join(CORE, 'auth.mjs'));
  const { makeStamp } = await import('./published-trigger-census.mjs');
  const { callSafe } = await import('./run-hygiene.mjs');
  const STAMP = makeStamp(); const NAME = (s) => `TEST-CONF-W9-WF-${s}-${STAMP}`;
  const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE, engineVersion: 'workflows-wf-restore-proof', allowedLocations: new Set([LOCATION]), renewer: null };
  const deps = { state, makeGw: (o = {}) => makeGatewayFactory({ state })(o) };
  const tool0 = (n) => TOOLS.find((t) => t.name === n);
  const rawCall0 = (n, a) => callSafe((nm, x) => tool0(nm).handler({ locationId: LOCATION, ...x }, deps), n, a); // UNGUARDED: only the signal handler's clean-up uses it
  const ctl = makeStopControl();
  const rawCall = (n, a) => ctl.guard(() => rawCall0(n, a));
  let passed = 0, failed = 0; const live = new Set();
  const check = (c, m, x) => { if (c) { passed++; console.log(`  PASS  ${m}`); } else { failed++; console.log(`  FAIL  ${m}${x ? `  — ${x}` : ''}`); } };
  const mk = createDeclaredMarker(RESTORE_TOOLS);
  const left = []; const pushLeft = left.push.bind(left); left.push = (...xs) => { for (const x of xs) console.log(`LEFT ${x}`); return pushLeft(...xs); };
  console.log(`wf-restore proof, stamp ${STAMP}, argv ${JSON.stringify(process.argv.slice(2))}`);
  const down = async (w) => { await unpublishAndAssertDraft(rawCall0, () => {}, w, 'signal clean-up'); const e = await rawCall0('get_workflow', { workflowId: w }); return e?.data?.status === 'draft'; };
  const handler = makeRestoreSignalHandler({ ctl, down, flows: live, left, mk });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { void handler(sig); });
  const outcome = {}; let halted = false;
  const gw0 = deps.makeGw({ loc: LOCATION, state }); const gwG = { ...gw0, call: (...a) => ctl.guard(() => gw0.call(...a)) };
  try { await runRestoreProof({ call: rawCall, gw: gwG, LOCATION, NAME, STAMP, check, left, mk, onWid: (w) => live.add(w), outcome }); }
  catch (e) { if (e instanceof Halt) halted = true; else if (!(e instanceof Stopped)) { failed++; console.log(`  FAIL  the proof threw: ${String(e?.message ?? e).slice(0, 200)}`); } }
  if (outcome.halted || outcome.unknownBuild) halted = true;
  if (ctl.stopped) await new Promise(() => {}); // a signal is being handled: ONLY the handler may exit
  try { mk.write(); } catch (e) { failed++; console.log(`  FAIL  the marker could not be written: ${String(e?.message ?? e).slice(0, 120)}`); }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(halted ? 3 : failed === 0 ? 0 : 1);
}
