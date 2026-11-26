// wf-error-alerts-proof.mjs against an in-memory error-alert settings store. Every rule in its header has a test: no write on a bad first read, null refused, an unreadable
// later read is UNKNOWN (no PUT built from it), a third-party change or a tool wipe is NOT repaired, the signal handler restores, the snapshot is never deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runErrorAlertsProof, makeSignalHandler, readAlertSettings, sameSettings, exactAddressRe } from '../../skills/create-ghl-workflow/scripts/wf-error-alerts-proof.mjs';
import { createDeclaredMarker } from '../../skills/create-ghl-workflow/scripts/declared-marker.mjs';

const LOC = 'LOCMOCK0000000000001';
const SPARE = 'uSpare';
const TOK = /^mock-alert-user$/;

function world(over = {}) {
  const w = { settings: { isActive: false, users: ['uOriginal'] }, puts: [], toolWrites: 0, readFail: () => false, readNull: false, readShape: null, toolWipesOnRemove: false, onAdd: null, ...over };
  const gw = { call: async (m, p, body) => {
    if (m === 'GET' && p.includes('/error-notification/settings')) {
      if (w.readFail(w)) return { ok: false, status: 503, json: null };
      if (w.readNull) return { ok: true, status: 200, json: null };
      if (w.readShape) return { ok: true, status: 200, json: w.readShape };
      return { ok: true, status: 200, json: { isActive: w.settings.isActive, users: [...w.settings.users] } };
    }
    if (m === 'GET' && p.startsWith('/users/')) return { ok: true, status: 200, json: { users: [{ id: SPARE, email: 'mock-alert-user' }, { id: 'uOriginal', email: 'someone-else' }] } };
    if (m === 'PUT' && p.endsWith('/settings/users')) { w.puts.push(['users', body.users.length]); w.settings.users = [...body.users]; return { ok: true, status: 200, json: {} }; }
    if (m === 'PUT' && p.endsWith('/settings/is-active')) { w.puts.push(['isActive']); w.settings.isActive = body.isActive; return { ok: true, status: 200, json: {} }; }
    return { ok: true, status: 200, json: {} };
  } };
  const call = async (n, a) => {
    if ((a.addUsers ?? []).includes('zzNotAUserId')) return { ok: false, code: 'VALIDATION_FAILED', detail: 'not a user' };
    if (a.confirm !== true) return { ok: false, code: 'CONFIRM_REQUIRED', detail: 'preview' };
    w.toolWrites++;
    if (a.addUsers?.length) { await w.onAdd?.(w); w.settings.users = [...new Set([...w.settings.users, ...a.addUsers])]; }
    if (a.removeUsers?.length) w.settings.users = w.toolWipesOnRemove ? [] : w.settings.users.filter((u) => !a.removeUsers.includes(u));
    return { ok: true, data: { verified: true } };
  };
  return { w, gw, call };
}

async function run(wo = {}, extra = {}) {
  const { w, gw, call } = world(wo);
  const dir = mkdtempSync(join(tmpdir(), 'wf-alerts-test-'));
  const lines = []; const printed = []; const ctl = {};
  const mk = createDeclaredMarker(['set_workflow_error_alerts']);
  const chk = (c, m, d) => { lines.push([Boolean(c), m]); mk.check(c, m, d, () => {}); };
  const res = await runErrorAlertsProof({ call: mk.wrapCall(call), gw, LOCATION: LOC, STAMP: '123456', chk, mk, alertUserRe: TOK, snapshotDir: dir, ctl, print: (x) => printed.push(x), ...extra });
  const files = readdirSync(dir);
  const snap = files.length ? JSON.parse(readFileSync(join(dir, files[0]), 'utf8')) : null;
  const mode = files.length ? statSync(join(dir, files[0])).mode & 0o777 : null;
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { w, res, lines, printed, files, snap, mode, ctl, mk, cleanup };
}
const failing = (r) => r.lines.filter(([c]) => !c).map(([, m]) => m);

test('a healthy run: restored, a separate read-back, FENCE passes, the snapshot is 0600 and is KEPT (never deleted by the module)', async () => {
  const r = await run();
  try {
    assert.deepEqual(failing(r), []);
    assert.equal(r.res.exercised, true); assert.equal(r.res.unknown, false);
    assert.deepEqual(r.w.settings, { isActive: false, users: ['uOriginal'] });
    assert.equal(r.files.length, 1, 'the snapshot is still there');
    assert.equal(r.mode, 0o600);
    assert.deepEqual(r.snap.original, { isActive: false, users: ['uOriginal'] });
    assert.ok(r.lines.some(([c, m]) => c && /^FENCE: the error-alert settings read back equal/.test(m)));
    assert.equal(r.w.puts.length, 0, 'the module itself wrote nothing; only the tool under test did');
    const e = r.mk.entries(); assert.deepEqual(e.map((x) => x.tool), ['set_workflow_error_alerts']); assert.ok(e[0].passed > 0 && e[0].failed === 0);
  } finally { r.cleanup(); }
});

test('W1: a failed FIRST read (503) writes NOTHING and creates no snapshot; the tool is not exercised and that is a FAIL', async () => {
  const r = await run({ readFail: () => true });
  try {
    assert.equal(r.w.puts.length, 0); assert.equal(r.w.toolWrites, 0); assert.equal(r.files.length, 0);
    assert.equal(r.res.exercised, false); assert.equal(r.res.wrote, false);
    assert.ok(failing(r).some((m) => /NOT exercised: the first settings read is not a valid 200/.test(m)));
  } finally { r.cleanup(); }
});

test('W1: an odd first shape (non-string user, missing isActive) writes nothing either', async () => {
  for (const shape of [{ isActive: false, users: [7] }, { users: [] }, { isActive: 'yes', users: [] }, 'oops']) {
    const r = await run({ readShape: shape });
    try { assert.equal(r.w.puts.length + r.w.toolWrites, 0, JSON.stringify(shape)); assert.equal(r.files.length, 0); assert.equal(r.res.exercised, false); } finally { r.cleanup(); }
  }
});

test('W2: a bare null (never configured) is REFUSED before any write and asks for an orchestrator ruling', async () => {
  const r = await run({ readNull: true });
  try {
    assert.equal(r.w.puts.length + r.w.toolWrites, 0); assert.equal(r.files.length, 0);
    assert.equal(r.res.needsRuling, true); assert.equal(r.res.exercised, false);
    assert.ok(r.printed.some((l) => l.startsWith('ORCHESTRATOR RULING NEEDED')));
  } finally { r.cleanup(); }
});

test('W1: a failed read AFTER the add is state UNKNOWN: no PUT is built from it, the snapshot is kept, the result is unknown (exit 3)', async () => {
  let added = false;
  const r = await run({ readFail: (w) => added }, {});
  // arm the failure from the tool's own add
  r.cleanup();
  const { w, gw, call } = world({ onAdd: (x) => { added = true; } });
  w.readFail = () => added;
  const dir = mkdtempSync(join(tmpdir(), 'wf-alerts-test-'));
  const lines = []; const printed = [];
  const mk = createDeclaredMarker(['set_workflow_error_alerts']);
  try {
    const res = await runErrorAlertsProof({ call, gw, LOCATION: LOC, STAMP: '123456', chk: (c, m) => lines.push([Boolean(c), m]), mk, alertUserRe: TOK, snapshotDir: dir, print: (x) => printed.push(x) });
    assert.equal(res.unknown, true);
    assert.equal(w.puts.length, 0, 'no PUT was built from an unreadable state');
    assert.equal(readdirSync(dir).length, 1, 'the snapshot is kept');
    assert.ok(printed.some((l) => /alert state UNKNOWN/.test(l) && /KEPT/.test(l)));
    assert.ok(lines.some(([c, m]) => !c && /alert state UNKNOWN|FENCE/.test(m)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('W5: a THIRD-PARTY change (someone adds a recipient between the preview and the add) is NOT overwritten: no PUT, loud stop, snapshot kept', async () => {
  const { w, gw, call } = world({});
  let preview = true;
  const wrapped = async (n, a) => { if (a.confirm !== true && !(a.addUsers ?? []).includes('zzNotAUserId')) { const r = await call(n, a); w.settings.users.push('uStranger'); return r; } return call(n, a); };
  const dir = mkdtempSync(join(tmpdir(), 'wf-alerts-test-')); const printed = []; const lines = [];
  try {
    const res = await runErrorAlertsProof({ call: wrapped, gw, LOCATION: LOC, STAMP: '123456', chk: (c, m) => lines.push([Boolean(c), m]), mk: createDeclaredMarker(['set_workflow_error_alerts']), alertUserRe: TOK, snapshotDir: dir, print: (x) => printed.push(x) });
    assert.equal(res.unknown, true); assert.equal(w.puts.length, 0, 'the module never PUT');
    assert.ok(w.settings.users.includes('uStranger'), "the third party's change is still there");
    assert.equal(w.toolWrites, 0, 'and the run stopped before the confirmed add');
    assert.equal(readdirSync(dir).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('W5: the tool under test WIPING the list on remove is unexplained: no repair PUT, UNKNOWN, snapshot kept (a human restores from it)', async () => {
  const r = await run({ toolWipesOnRemove: true });
  try {
    assert.equal(r.w.puts.length, 0); assert.equal(r.res.unknown, true);
    assert.deepEqual(r.w.settings.users, []);
    assert.equal(r.files.length, 1);
    assert.ok(failing(r).some((m) => /RESTORED|FENCE|UNKNOWN/.test(m)));
  } finally { r.cleanup(); }
});

test('an EXPLAINED difference (the tool left the candidate in) IS repaired with the snapshot, then read back equal', async () => {
  const { w, gw, call } = world({});
  const wrapped = async (n, a) => (a.removeUsers?.length && a.confirm ? { ok: true, data: { verified: true } } : call(n, a)); // the remove silently does nothing
  const dir = mkdtempSync(join(tmpdir(), 'wf-alerts-test-')); const lines = [];
  try {
    const res = await runErrorAlertsProof({ call: wrapped, gw, LOCATION: LOC, STAMP: '123456', chk: (c, m) => lines.push([Boolean(c), m]), mk: createDeclaredMarker(['set_workflow_error_alerts']), alertUserRe: TOK, snapshotDir: dir, print: () => {} });
    assert.deepEqual(w.settings, { isActive: false, users: ['uOriginal'] });
    assert.equal(w.puts.length, 1);
    assert.equal(res.unknown, false);
    assert.ok(lines.some(([c, m]) => !c && /^RESTORED/.test(m)), "the tool's own failed restore is still a FAIL");
    assert.ok(lines.some(([c, m]) => c && /^FENCE/.test(m)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('W3: SIGTERM inside the section runs the validated restore, prints LEFT, writes the marker and exits 143 when it reads back equal', async () => {
  const ctl = {}; const printed = []; let exitCode = null; let wrote = 0;
  const handler = makeSignalHandler({ ctl, left: ['workflow X'], mk: { write: () => { wrote++; } }, print: (x) => printed.push(x), exit: (c) => { exitCode = c; throw new Error('exit'); }, timeoutMs: 2000 });
  const { w, gw, call } = world({});
  w.onAdd = async () => { await handler('SIGTERM').catch(() => {}); throw new Error('process died'); }; // the signal lands while the add is in flight, then the process is gone
  const dir = mkdtempSync(join(tmpdir(), 'wf-alerts-test-'));
  try {
    await runErrorAlertsProof({ call, gw, LOCATION: LOC, STAMP: '123456', chk: () => {}, mk: createDeclaredMarker(['set_workflow_error_alerts']), alertUserRe: TOK, snapshotDir: dir, ctl, print: () => {} }).catch(() => {});
    assert.equal(exitCode, 143); assert.equal(wrote, 1);
    assert.ok(printed.some((l) => /LEFT IN PLACE/.test(l)) && printed.some((l) => /workflow X/.test(l)));
    assert.deepEqual(w.settings, { isActive: false, users: ['uOriginal'] }, 'the settings are the snapshot after the signal');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('W3: a SIGTERM whose restore cannot read back says "alert state UNKNOWN" with the snapshot path and exits 3', async () => {
  const ctl = { restore: async () => ({ state: 'unknown', why: 'the read failed' }), snapshotPath: '/nowhere/snap.json' }; const printed = []; let exitCode = null;
  const handler = makeSignalHandler({ ctl, mk: { write: () => {} }, print: (x) => printed.push(x), exit: (c) => { exitCode = c; } });
  await handler('SIGTERM');
  assert.equal(exitCode, 3);
  assert.ok(printed.some((l) => /alert state UNKNOWN/.test(l) && /snap\.json/.test(l)));
});

test('readAlertSettings: the validated shapes', async () => {
  const gw = (r) => ({ call: async () => r });
  assert.deepEqual((await readAlertSettings(gw({ ok: true, status: 200, json: { isActive: true, users: ['a'] } }), LOC)).value, { isActive: true, users: ['a'] });
  assert.equal((await readAlertSettings(gw({ ok: true, status: 200, json: null }), LOC)).never, true);
  for (const bad of [{ ok: false, status: 429, json: null }, { ok: true, status: 200, json: { isActive: true } }, { ok: true, status: 200, json: { isActive: true, users: [{}] } }]) assert.equal((await readAlertSettings(gw(bad), LOC)).valid, false);
  assert.equal((await readAlertSettings({ call: async () => { throw new Error('x'); } }, LOC)).valid, false);
  assert.ok(sameSettings({ isActive: false, users: ['b', 'a'] }, { isActive: false, users: ['a', 'b'] }) && !sameSettings({ isActive: false, users: [] }, { isActive: true, users: [] }));
  const AT = String.fromCharCode(64); const addr = (l, d) => `${l}${AT}${d}`; // no email literal in this file (public repo privacy gate)
  const re = exactAddressRe(addr('Owner+Tag', 'Example.test'));
  assert.ok(re.test(addr('owner+tag', 'example.test')) && !re.test(addr('owner+tag', 'example.test.evil')) && !re.test(addr('xowner+tag', 'example.test')) && !re.test(`${addr('owner+tag', 'example.test')}\n`));
  for (const bad of ['', addr('a', 'b'), addr('*', 'example.test'), `${addr('a', 'example.test')},${addr('b', 'example.test')}`, `a b${AT}example.test`, undefined]) assert.throws(() => exactAddressRe(bad), /exact email/);
});

test('X2: a SIGTERM during the add waits for that call, then ONE restore runs; the section sends nothing more (no second restore, no later write)', async () => {
  const { makeStopControl } = await import('../../skills/create-ghl-workflow/scripts/stop-control.mjs');
  const { w, gw, call } = world();
  const dir = mkdtempSync(join(tmpdir(), 'wf-alerts-test-'));
  try {
    const stopCtl = makeStopControl(); const ctl = {}; const exits = []; const printed = [];
    const mk = createDeclaredMarker(['set_workflow_error_alerts']);
    const handler = makeSignalHandler({ ctl, stop: (t) => stopCtl.stop(t), left: [], mk, print: (x) => printed.push(x), exit: (c) => exits.push(c), timeoutMs: 2000 });
    let handled;
    w.onAdd = async () => { handled = handler('SIGTERM'); };
    const gwG = { call: (m, p, b) => stopCtl.guard(() => gw.call(m, p, b)) };
    const callG = (n, a) => stopCtl.guard(() => call(n, a));
    const getsAfter = [];
    const res = await runErrorAlertsProof({ call: mk.wrapCall(callG), gw: gwG, restoreGw: gw, stopped: () => stopCtl.stopped, LOCATION: LOC, STAMP: '123456', chk: (c, m, d) => mk.check(c, m, d, () => {}), mk, alertUserRe: TOK, snapshotDir: dir, ctl, print: (x) => printed.push(x) });
    await handled;
    assert.deepEqual(exits, [143], 'restored and read back equal: 143');
    assert.deepEqual(w.settings, { isActive: false, users: ['uOriginal'] });
    assert.equal(w.puts.filter((p) => p[0] === 'users').length, 1, 'exactly one restore PUT');
    assert.equal(w.toolWrites, 1, 'only the add reached the tool; the remove was never sent');
    assert.equal(res.unknown, true, 'the section itself reports it did not finish');
    assert.ok(readdirSync(dir).length === 1, 'the snapshot is kept');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('X2b: a request still in flight when the wait ends makes the alert state UNKNOWN and exit 3, even if the restore reads equal', async () => {
  const { makeStopControl } = await import('../../skills/create-ghl-workflow/scripts/stop-control.mjs');
  const stopCtl = makeStopControl(); const out = []; const exits = [];
  void stopCtl.guard(() => new Promise((r) => setTimeout(r, 120)));
  await makeSignalHandler({ ctl: { restore: async () => ({ state: 'equal' }), snapshotPath: '/x/snap.json' }, stop: (t) => stopCtl.stop(t), left: [], mk: createDeclaredMarker(['set_workflow_error_alerts']), print: (x) => out.push(x), exit: (c) => exits.push(c), timeoutMs: 30 })('SIGTERM');
  assert.ok(out.some((l) => /alert state UNKNOWN/.test(l) && /snapshot is KEPT/.test(l)), out.join('|'));
  assert.deepEqual(exits, [3]);
});

test('the entry takes the recipient from GHL_ALERT_RECIPIENT and refuses before any token, gateway or tool import; no address literal lives in the script', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../skills/create-ghl-workflow/scripts/wf-error-alerts-proof.mjs', import.meta.url), 'utf8');
  const entry = src.slice(src.indexOf('// CLI'));
  assert.ok(entry.indexOf('exactAddressRe(process.env.GHL_ALERT_RECIPIENT)') > 0 && entry.indexOf('exactAddressRe(process.env.GHL_ALERT_RECIPIENT)') < entry.indexOf("await import(join(CORE, 'tools.mjs'))"));
  assert.ok(!new RegExp(`[A-Za-z0-9._+-]+${String.fromCharCode(64)}[A-Za-z0-9-]+\\.[a-z]{2,}`).test(src.replace(/\/\/.*$/gm, '')), 'no email literal in the code');
});
