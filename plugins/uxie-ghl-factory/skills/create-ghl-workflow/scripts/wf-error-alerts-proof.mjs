#!/usr/bin/env node
// LIVE: proves set_workflow_error_alerts. It has its OWN entry and its own go-ahead, because it changes LOCATION-WIDE state
// that real people read: who GHL emails when any workflow step fails.
//
//   D18_RUNNER_S=<40-hex> QA_CLEARED=<same> GHL_LOCATION='<locId>' GHL_EXERCISED_OUT=<file> node wf-error-alerts-proof.mjs --go=<ISO>      (--smoke runs nothing)
//
// Rules this file enforces (each has a test in wf-error-alerts-proof.test.mjs):
//   1. NO WRITE unless the first read is a 200 of a validated shape (isActive a boolean, users an array of strings). It is saved to a 0600 snapshot OUTSIDE every repo
//      and read back from that file. A failed or odd read means no write at all.
//   2. A 200 with a bare null ("never configured") cannot be restored by a PUT: REFUSED before any write, "ORCHESTRATOR RULING NEEDED" is printed, the tool is not exercised.
//   3. Every later read must be valid too. An invalid one is state UNKNOWN: a FAIL, no PUT is ever built from it, the snapshot is kept, exit 3.
//   4. The repair PUTs the snapshot ONLY when the difference is explained by this run's own change (the snapshot plus the one spare +tag user it added). Anything else
//      (a third party changed it, or the tool under test wiped it) is NO PUT, a loud stop, exit 3.
//   5. The restore runs on every exit: the end of the section, a throw, SIGTERM and SIGINT (makeSignalHandler). It ends with a separate read-back.
//   6. The snapshot is NEVER deleted by this file. It stays until QA accepts the record.
// Only counts are ever printed, never a user id or an address. The recipient is the delegated +tag family only (the same pattern conformance uses).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createDeclaredMarker } from './declared-marker.mjs';
import { gateOrExit } from './d18-gate.mjs';
import { makeStopControl } from './stop-control.mjs'; // the same stop control the 8-tool entry uses (QA X2)

export const ALERT_TOOL = 'set_workflow_error_alerts';
// The recipient is ONE exact address, handed in by the runner through GHL_ALERT_RECIPIENT; no address (and no family of them) lives in this repo. Only the COUNT of matches is ever printed.
export const ADDRESS_SHAPE = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export function exactAddressRe(address) {
  const a = String(address ?? '').trim().toLowerCase();
  if (!ADDRESS_SHAPE.test(a)) throw new Error('GHL_ALERT_RECIPIENT must be one exact email address (no wildcard, no list)');
  return new RegExp(`^${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}
export class AlertStateUnknown extends Error {}

const sortedEq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export const sameSettings = (a, b) => Boolean(a && b) && a.isActive === b.isActive && sortedEq(a.users, b.users);

// A read is valid only when it is a 200 with { isActive: boolean, users: string[] }. Everything else says why it is not, and null is told apart (it is a real state, not an error).
export async function readAlertSettings(gw, LOCATION) {
  let r;
  try { r = await gw.call('GET', `/workflow/${LOCATION}/error-notification/settings`); } catch (e) { return { valid: false, why: 'the read threw' }; }
  if (!r || r.ok !== true) return { valid: false, why: `the read failed (status ${r?.status ?? 'none'})` };
  const j = r.json;
  if (j === null) return { valid: false, never: true, why: 'a 200 with a bare null: never configured' };
  if (!j || typeof j !== 'object' || typeof j.isActive !== 'boolean' || !Array.isArray(j.users) || !j.users.every((u) => typeof u === 'string')) return { valid: false, why: 'the answer has an unexpected shape' };
  return { valid: true, value: { isActive: j.isActive, users: [...j.users] } };
}

export async function runErrorAlertsProof({ call, gw, LOCATION, STAMP, chk, mk, alertUserRe, snapshotDir = null, ctl = {}, print = console.log, restoreGw = null, stopped = () => false }) {
  const rgw = restoreGw ?? gw; // the RESTORE (and only it) may use an unguarded gateway: after a stop every other request is refused
  mk.subject(ALERT_TOOL);
  print('ALERT SECTION STARTED (location-wide state)');
  const result = { exercised: false, wrote: false, unknown: false, needsRuling: false, snapshotPath: null };
  const first = await readAlertSettings(gw, LOCATION);
  if (!first.valid) {
    result.needsRuling = first.never === true;
    if (first.never) print('ORCHESTRATOR RULING NEEDED: the error-alert settings were never configured (a bare null). A PUT cannot put that back, so nothing was written.');
    else print(`NOT EXERCISED: the first settings read is not a valid 200 (${first.why}). Nothing was written.`);
    chk(false, `${ALERT_TOOL} NOT exercised: the first settings read is not a valid 200 of the expected shape; nothing was written`, first.why);
    return result;
  }
  const original = first.value;
  // the snapshot lives OUTSIDE the repo (it holds real user ids), mode 0600, and is read BACK from the file before anything is written
  const dir = snapshotDir ?? join(homedir(), '.uxie-ghl-internal-mcp');
  const snapshotPath = join(dir, `error-alerts-original-${STAMP}.json`);
  result.snapshotPath = snapshotPath;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify({ at: new Date().toISOString(), original }), { mode: 0o600 });
  } catch (e) { chk(false, `${ALERT_TOOL} NOT exercised: the snapshot could not be written; nothing was written to the account`, String(e?.message ?? e).slice(0, 80)); return result; }
  let fromFile = null;
  try { fromFile = JSON.parse(readFileSync(snapshotPath, 'utf8')).original; } catch { fromFile = null; }
  if (!(typeof fromFile?.isActive === 'boolean' && Array.isArray(fromFile?.users) && sameSettings(fromFile, original))) {
    chk(false, `${ALERT_TOOL} NOT exercised: the snapshot did not read back equal from its file; nothing was written to the account`, '');
    return result;
  }
  print(`  snapshot of the original error-alert settings kept at ${snapshotPath.replace(homedir(), '~')} (mode 0600, read back from the file; isActive=${original.isActive}, ${original.users.length} recipient(s))`);

  let candidate = null;
  const explained = (cur) => sameSettings(cur, original)
    || (candidate !== null && cur.isActive === original.isActive && sortedEq(cur.users, [...new Set([...original.users, candidate])]));
  const readOrThrow = async (when) => { const r = await readAlertSettings(gw, LOCATION); if (!r.valid) throw new AlertStateUnknown(`${when}: ${r.why}`); return r.value; };
  const expectUnchanged = async (when) => { const cur = await readOrThrow(when); if (!sameSettings(cur, original)) throw new AlertStateUnknown(`${when}: the settings differ from the snapshot and nothing this run did explains it`); return cur; };

  // THE RESTORE (also what a signal runs): read; only a valid read can lead to a write; only an explained difference is repaired; a separate read-back ends it.
  const restore = async () => {
    const cur = await readAlertSettings(rgw, LOCATION);
    if (!cur.valid) return { state: 'unknown', why: cur.why };
    if (sameSettings(cur.value, original)) return { state: 'equal' };
    if (!explained(cur.value)) return { state: 'unexplained', why: 'the settings differ from the snapshot and this run\'s own change does not explain it' };
    mk.subject(false);
    if (!sortedEq(cur.value.users, original.users)) { const w = await rgw.call('PUT', `/workflow/${LOCATION}/error-notification/settings/users`, { users: original.users }); if (!w?.ok) return { state: 'unknown', why: 'the repair write was refused' }; }
    const back = await readAlertSettings(rgw, LOCATION);
    if (!back.valid) return { state: 'unknown', why: back.why };
    return sameSettings(back.value, original) ? { state: 'restored' } : { state: 'mismatch', why: 'the read-back after the repair still differs' };
  };
  ctl.restore = restore; ctl.snapshotPath = snapshotPath; ctl.result = result;

  let problem = null;
  try {
    const ur = await gw.call('GET', `/users/?${new URLSearchParams({ locationId: LOCATION })}`);
    const rows = ur?.ok === true ? (Array.isArray(ur.json?.users) ? ur.json.users : (Array.isArray(ur.json) ? ur.json : null)) : null;
    if (rows === null) { chk(false, `${ALERT_TOOL} NOT exercised: the users list is not a valid read; nothing was written`, `status=${ur?.status ?? 'none'}`); return finish(); }
    if (!(alertUserRe instanceof RegExp)) throw new Error('alertUserRe (the exact recipient) is required');
    const ownIds = [...new Set(rows.filter((u) => alertUserRe.test(String(u?.email ?? '').toLowerCase())).map((u) => u.id ?? u._id))].filter(Boolean);
    const candidates = ownIds.filter((id) => !original.users.includes(id));
    const ghost = await call(ALERT_TOOL, { addUsers: ['zzNotAUserId'], confirm: true });
    chk(ghost.code === 'VALIDATION_FAILED', 'an id that is not a user of this location is REFUSED before any write', ghost.code);
    await expectUnchanged('after the ghost control'); chk(true, 'CONTROL: the refusal left the settings equal to the snapshot (a separate valid read)', 'compared to the snapshot');
    if (candidates.length !== 1) { print(`  not exercised: not exactly one spare +tag user (matched ${candidates.length}) — nothing was added`); chk(false, `${ALERT_TOOL} NOT exercised: the +tag recipient is not exactly one spare user of this location`, `matched=${candidates.length}`); return finish(); }
    const preview = await call(ALERT_TOOL, { addUsers: [candidates[0]] });
    await expectUnchanged('after the preview');
    chk(preview.code === 'CONFIRM_REQUIRED', 'without confirm it previews and writes nothing (a separate valid read agrees)', preview.code);
    candidate = candidates[0]; result.wrote = true;
    const added = await call(ALERT_TOOL, { addUsers: [candidate], confirm: true });
    const now = await readOrThrow('after the add');
    chk(added.ok === true && added.data?.verified === true && now.users.includes(candidate) && original.users.every((u) => now.users.includes(u)) && now.isActive === original.isActive,
      'MERGE: the new recipient is stored AND every original recipient survived — read from GHL, not from the tool', JSON.stringify({ before: original.users.length, after: now.users.length }));
    const restored = await call(ALERT_TOOL, { removeUsers: [candidate], confirm: true });
    const end = await readOrThrow('after the tool\'s own restore');
    chk(restored.ok === true && sameSettings(end, original), 'RESTORED: the settings are what this section found', `recipients ${original.users.length} -> ${end.users.length}, isActive ${original.isActive} -> ${end.isActive}`);
    result.exercised = true;
  } catch (e) {
    problem = e instanceof AlertStateUnknown ? e.message : `the section threw: ${String(e?.message ?? e).slice(0, 120)}`;
    chk(false, 'alert state UNKNOWN: a read the section rests on was not valid, or the section threw; no write was built from it', problem);
  }
  return finish();

  async function finish() {
    if (stopped()) { result.unknown = true; return result; } // a signal is being handled: the handler runs the ONE restore, after the call in flight has settled
    const rs = await restore();
    mk.subject(false);
    if (rs.state === 'equal' || rs.state === 'restored') {
      chk(true, 'FENCE: the error-alert settings read back equal to the snapshot when the section ends', `${rs.state}; recipients ${original.users.length}`);
    } else {
      result.unknown = true;
      print(`alert state UNKNOWN (${rs.state}: ${rs.why}) — the snapshot is KEPT at ${snapshotPath.replace(homedir(), '~')}; report to the orchestrator AT ONCE and restore from it by hand`);
      chk(false, 'FENCE: the error-alert settings read back equal to the snapshot when the section ends', `${rs.state}: ${rs.why}`);
    }
    if (problem) result.unknown = result.unknown || false;
    return result;
  }
}

// What a SIGTERM / SIGINT does: attempt the validated restore, say UNKNOWN with the snapshot path if it cannot read back, take the flows down, print what is left, write the marker, exit.
export function makeSignalHandler({ ctl, stop = async () => true, down = async () => {}, left = [], mk, print = console.log, exit = process.exit, timeoutMs = 30000 }) {
  let once = false;
  return async (sig) => {
    if (once) return; once = true;
    let unknown = false;
    let settled = true;
    try { settled = (await stop(timeoutMs)) === true; } catch { settled = false; }
    if (!settled) print('a request was STILL IN FLIGHT when the wait ended: it can land after the restore, so the alert state is UNKNOWN whatever the restore reads (QA X2b)');
    try {
      if (typeof ctl?.restore === 'function') {
        const rs = await Promise.race([ctl.restore(), new Promise((r) => setTimeout(() => r({ state: 'unknown', why: 'the restore timed out' }), timeoutMs))]);
        if (rs.state === 'equal' || rs.state === 'restored') print(`${sig}: error-alert settings read back equal to the snapshot`);
        else { unknown = true; print(`alert state UNKNOWN after ${sig} (${rs.state}: ${rs.why}) — the snapshot is KEPT at ${String(ctl.snapshotPath).replace(homedir(), '~')}; report to the orchestrator AT ONCE`); }
      }
    } catch (e) { unknown = true; print(`alert state UNKNOWN after ${sig} (the restore threw) — the snapshot is KEPT at ${String(ctl?.snapshotPath).replace(homedir(), '~')}; report to the orchestrator AT ONCE`); }
    if (!settled && !unknown) { unknown = true; print(`alert state UNKNOWN after ${sig} (a request was in flight when the wait ended) — the snapshot is KEPT at ${String(ctl?.snapshotPath).replace(homedir(), '~')}; report to the orchestrator AT ONCE and read the settings again`); }
    try { await down(); } catch { /* reported by the run */ }
    print('\nLEFT IN PLACE (nothing is deleted):'); for (const l of left) print(`  ${l}`);
    try { mk?.write(); } catch { print('  FAIL  the exercised marker could not be written'); }
    exit(unknown ? 3 : 143);
  };
}

// CLI
if (process.argv[1]?.endsWith('wf-error-alerts-proof.mjs')) {
  gateOrExit({ what: 'the entry point would run the set_workflow_error_alerts proof', allowed: ['--go='] }); // FIRST: before any token, gateway or tool import
  let alertUserRe; try { alertUserRe = exactAddressRe(process.env.GHL_ALERT_RECIPIENT); } catch (e) { console.error(`REFUSED: ${e.message}`); process.exit(2); } // before any token, gateway or tool import
  const { fileURLToPath } = await import('node:url');
  const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
  if (!LOCATION) { console.error('GHL_LOCATION is required.'); process.exit(2); }
  const CORE = join(fileURLToPath(new URL('.', import.meta.url)), '../../../mcp-internal/core');
  const { makeGatewayFactory, TOOLS } = await import(join(CORE, 'tools.mjs'));
  const { DEFAULT_TOKEN_FILE } = await import(join(CORE, 'auth.mjs'));
  const { makeStamp } = await import('./published-trigger-census.mjs');
  const { callSafe } = await import('./run-hygiene.mjs');
  const STAMP = makeStamp();
  const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE, engineVersion: 'workflows-wf-error-alerts-proof', allowedLocations: new Set([LOCATION]), renewer: null };
  const deps = { state, makeGw: (o = {}) => makeGatewayFactory({ state })(o) };
  const tool = (n) => TOOLS.find((t) => t.name === n);
  const mk = createDeclaredMarker([ALERT_TOOL]);
  const stopCtl = makeStopControl();
  const rawCall = (n, a) => stopCtl.guard(() => callSafe((nm, args) => tool(nm).handler({ locationId: LOCATION, ...args }, deps), n, a));
  const call = mk.wrapCall(rawCall);
  const gw0 = deps.makeGw({ loc: LOCATION, state });
  const gwG = { ...gw0, call: (...a) => stopCtl.guard(() => gw0.call(...a)) };
  let passed = 0, failed = 0;
  const check = (cond, m, extra) => { if (cond) { passed++; console.log(`  PASS  ${m}`); } else { failed++; console.log(`  FAIL  ${m}${extra ? `  — ${extra}` : ''}`); } };
  const chk = (c, m, d) => mk.check(c, m, d, check);
  const ctl = {};
  const left = [];
  const handler = makeSignalHandler({ ctl, stop: (t) => stopCtl.stop(t), left, mk });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { void handler(sig); });
  console.log(`error-alerts proof, stamp ${STAMP}`);
  let res = { unknown: true };
  try { res = await runErrorAlertsProof({ call, gw: gwG, restoreGw: gw0, stopped: () => stopCtl.stopped, LOCATION, STAMP, chk, mk, ctl, alertUserRe }); }
  catch (e) { failed++; console.log(`  FAIL  the proof threw: ${String(e?.message ?? e).slice(0, 120)}`); res = { unknown: true }; }
  if (stopCtl.stopped) await new Promise(() => {}); // a signal is being handled: ONLY the handler may exit, after its restore and read-back
  try { mk.write(); } catch (e) { console.log(`  FAIL  the exercised marker could not be written: ${String(e?.message ?? e).slice(0, 120)}`); failed++; }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(res.unknown || res.needsRuling ? 3 : (failed === 0 ? 0 : 1));
}
