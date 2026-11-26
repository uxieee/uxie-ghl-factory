// w9-d18 (bl-1272, bl-1273, bl-1275): what the live suite now expects after batch 1 run 3, read from its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../skills/create-ghl-workflow/scripts/conformance.mjs', import.meta.url), 'utf8');

test('bl-1275: every temp file the suite writes is removed at exit, and the LEFT IN PLACE list says so', () => {
  assert.match(src, /const tempFiles = \[\]/);
  assert.match(src, /process\.on\('exit', \(\) => \{[^}]*tempFiles[^}]*rmSync/s);
  assert.equal((src.match(/tempFiles\.push\(/g) ?? []).length, 3, 'the scrubbed, unrestorable and honest templates files are all tracked');
  assert.ok(!/left\.push\(`templates file \$\{[a-zA-Z]+\}`\)/.test(src), 'no bare "templates file" residue line is left');
});

test('bl-1273: the placeholder-refusal call is a PREVIEW (no confirm) on a placeholder with nothing stored to restore from', () => {
  assert.match(src, /call\('repair_workflow', \{ workflowId: wid, templatesPath: unrestorableTmp \}\)/);
  assert.ok(!/templatesPath: (scrubTmp|unrestorableTmp), confirm: true/.test(src), 'a refusal probe must never carry confirm:true');
  assert.match(src, /suiteUnrestorable/);
});

test('bl-1273 / bl-112: a scrubbed export whose webhook authorization placeholder IS restorable is previewed and writes nothing', () => {
  assert.match(src, /call\('repair_workflow', \{ workflowId: wid, templatesPath: scrubTmp \}\)/);
  assert.match(src, /bl-112/);
});

test('bl-1272: the validator, differential and publish expectations match what HighLevel answers now, and the lost coverage is announced', () => {
  assert.match(src, /v\.data\?\.valid === true && v\.data\?\.layer == null/);
  assert.match(src, /NOT EXERCISED: no pre-existing server finding on this fixture \(bl-1272\)/);
  assert.match(src, /pub\.ok === false && pub\.code === 'CONFIRM_REQUIRED'/);
  assert.ok(!/Bot is required/.test(src.replace(/\/\/.*$/gm, '')), 'no live assertion still expects the old "Bot is required" verdict');
});

// w9-d18 batch 2: a second stop point, so a live run can cover sections 5-6b (read rail, account rail, raw_request refusals, the
// redacted-payload guard, the From-address preflight, the account settings READ rail) without reaching set_workflow_error_alerts,
// which writes an account setting and restores it.
test('batch 2: --through accepts settings-rail, which stops right before the set_workflow_error_alerts section and still goes through finish()', () => {
  assert.match(src, /THROUGH !== 'publish' && THROUGH !== 'settings-rail'/);
  const stop = src.indexOf("if (THROUGH === 'settings-rail') await finish(");
  const alerts = src.indexOf("// ── set_workflow_error_alerts: read → merge → write → read back, then RESTORED");
  const settingsRail = src.indexOf('// ── 6b. the account-level settings rail');
  assert.ok(stop > settingsRail && stop < alerts, 'the stop point sits after the settings READ rail and before the alerts write');
  assert.ok(src.indexOf("if (THROUGH === 'publish') await finish(") < src.indexOf('// ── 5. the read rail'), 'the publish stop point is unchanged');
});

// w9-d18 QA fixes: a differential that cannot tell "triggers sent" from "triggers dropped", and temp files left behind on SIGTERM/SIGINT.
test('QA: edit_workflow reports how many triggers its server validation sent, and the differential asserts at least one', () => {
  const tools = readFileSync(new URL('../core/tools.mjs', import.meta.url), 'utf8');
  assert.match(tools, /server: \{ ran: v\.server\.ran, [^\n]*triggersSent: Array\.isArray\(triggers\) \? triggers\.length : 0/);
  assert.match(src, /seen\?\.triggersSent >= 1/);
});

test('QA: SIGTERM and SIGINT await the pending error-alert restore (bounded) and then exit 143/130', () => {
  const blk = src.slice(src.indexOf('// SIGNALS-BEGIN'), src.indexOf('// SIGNALS-END'));
  assert.match(blk, /await Promise\.race\(\[pendingRestore\(\), new Promise\(\(r\) => setTimeout\(\(\) => r\(false\), 20000\)\)\]\)/);
  assert.match(blk, /UNRESTORED — snapshot \$\{pendingRestorePath\}/);
  assert.match(blk, /process\.on\('SIGTERM', \(\) => \{ void exitAfterRestore\(143\); \}\)/);
  assert.match(blk, /process\.on\('SIGINT', \(\) => \{ void exitAfterRestore\(130\); \}\)/);
  assert.match(src, /pendingRestore = absoluteRestore;/);
});

test('QA: a real SIGTERM waits for the pending restore, then exits 143 and removes temp files; a restore that fails prints UNRESTORED', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const blk = src.slice(src.indexOf('// SIGNALS-BEGIN'), src.indexOf('// SIGNALS-END'));
  for (const failing of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'sigterm-test-'));
    const f = join(dir, 'x.json'); const marker = join(dir, 'restored');
    writeFileSync(f, '{}');
    const prog = `import { rmSync, writeFileSync } from 'node:fs'; const tempFiles=[${JSON.stringify(f)}];
process.on('exit', () => { for (const f of tempFiles) { try { rmSync(f, { force: true }); } catch {} } });
${blk}
pendingRestorePath = '/snap/path';
pendingRestore = async () => { await new Promise((r) => setTimeout(r, 300)); if (!${failing}) writeFileSync(${JSON.stringify(marker)}, 'x'); return !${failing}; };
console.log('ready'); setInterval(()=>{}, 1000);`;
    const child = spawn('node', ['--input-type=module', '-e', prog], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stderr.on('data', (b) => { out += b; });
    await new Promise((r) => child.stdout.once('data', r));
    child.stdout.on('data', (b) => { out += b; });
    const code = await new Promise((r) => { child.on('close', r); child.kill('SIGTERM'); });
    try {
      assert.equal(code, 143);
      assert.equal(existsSync(f), false, 'temp file removed');
      assert.equal(existsSync(marker), !failing, 'the restore ran to completion before exit (or failed)');
      assert.equal(/UNRESTORED — snapshot \/snap\/path/.test(out), failing);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

// w9-d18 batch 3 (draft): the account-level error-alert write is bracketed, and there is a stop point after it.
test('batch 3: --through=error-alerts stops after list_workflow_templates and before 6c', () => {
  assert.match(src, /THROUGH !== 'error-alerts'/);
  const stop = src.indexOf("if (THROUGH === 'error-alerts') await finish(");
  assert.ok(stop > src.indexOf("log.subject('list_workflow_templates')"), 'after the templates read');
  assert.ok(stop < src.indexOf('// ── 6c. the ES index'), 'before section 6c');
});

test('batch 3: the error-alert section snapshots the original OUTSIDE the repo and restores it absolutely in a finally', () => {
  const sec = src.slice(src.indexOf("log.subject('set_workflow_error_alerts')"), src.indexOf("log.subject('list_workflow_templates')"));
  assert.match(sec, /error-alerts-original-\$\{STAMP\}\.json/);
  assert.match(sec, /mode: 0o600/);
  assert.match(sec, /\} finally \{\s*await absoluteRestore\(\)/);
  assert.ok(!/tempFiles\.push\(snapshotPath\)/.test(sec), 'the snapshot must survive a SIGTERM so a human can restore from it');
  assert.ok(!/console\.log\([^)]*original\.users(?!\.length)/.test(sec), 'recipient ids are never printed');
});

test('FIX-1: the recipient is chosen at runtime: lowercased email matches Xander\'s pattern, EXACTLY one spare match, else nothing is added; only the count is printed', () => {
  const sec = src.slice(src.indexOf("log.subject('set_workflow_error_alerts')"), src.indexOf("log.subject('list_workflow_templates')"));
  assert.match(sec, /const OWN_EMAIL = \/\^xander\\\+w9\[a-z0-9-\]\*@xanderroque\\\.com\$\//); // batch 4 narrowed this to one named +tag
  assert.match(sec, /String\(u\.email \?\? ''\)\.toLowerCase\(\)/);
  assert.match(sec, /candidates\.length !== 1/);
  assert.match(sec, /not exercised: not exactly one Xander-owned spare user \(matched \$\{candidates\.length\}\)/);
  assert.ok(!/console\.log\([^)]*u\.email/.test(sec), 'an email is never printed');
});

test('FIX-2: isActive is flipped only from true, or when every recipient in place is Xander-owned', () => {
  const sec = src.slice(src.indexOf("log.subject('set_workflow_error_alerts')"), src.indexOf("log.subject('list_workflow_templates')"));
  assert.match(sec, /original\.isActive === true \|\| \(original\.users\.length > 0 && original\.users\.every\(\(id\) => ownIds\.has\(id\)\)\)/, 'an EMPTY recipient list must not count as all-own (every() is true on [])');
  assert.match(sec, /not exercised: isActive is false and a recipient in place is not Xander-owned/);
});

test('nit: no check detail prints a user-id array', () => {
  const sec = src.slice(src.indexOf("log.subject('set_workflow_error_alerts')"), src.indexOf("log.subject('list_workflow_templates')"));
  assert.ok(!/JSON\.stringify\(\{ original, (end|final) \}\)/.test(sec));
  assert.ok(!/before: beforeFlip\.users/.test(sec));
});

// w9-d18 batch 4
test('batch 4: the error-alert recipient selector is ONE named +tag (xander+w9…), not every Xander-owned address', () => {
  const sec = src.slice(src.indexOf("log.subject('set_workflow_error_alerts')"), src.indexOf("log.subject('list_workflow_templates')"));
  assert.match(sec, /const OWN_EMAIL = \/\^xander\\\+w9\[a-z0-9-\]\*@xanderroque\\\.com\$\//);
  assert.ok(!/console\.log\([^)]*u\.email/.test(sec), 'an email is never printed');
});

test('batch 4: the invalid-fixture PROBE is a preview (no confirm), checks the version is unmoved, and sits before the error-alerts stop', () => {
  const i = src.indexOf("log.subject('edit_workflow'); // PROBE");
  assert.ok(i > src.indexOf("log.subject('list_workflow_templates')") && i < src.indexOf("if (THROUGH === 'error-alerts') await finish("));
  const probe = src.slice(i, src.indexOf("if (THROUGH === 'error-alerts') await finish("));
  assert.match(probe, /allowValidationFailure: true/);
  assert.ok(!/confirm: true/.test(probe), 'the probe must never carry confirm:true');
  assert.match(probe, /PROBE: nothing was written/);
  assert.match(probe, /OBSERVATION \(not a pass or fail\)/);
});

// w9-d18 batch 5
test('batch 5: --through=custom-code stops after test_custom_code (section 8) and before the RUNTIME enrolment block', () => {
  assert.match(src, /THROUGH !== 'custom-code'/);
  const stop = src.indexOf("if (THROUGH === 'custom-code') await finish(");
  assert.ok(stop > src.indexOf("log.subject('test_custom_code')"), 'after the sandbox section');
  assert.ok(stop < src.indexOf('// ── RUNTIME'), 'before the runtime block (real enrolments)');
});

// w9-d18 batch 6
test('batch 6: --through=runtime-core skips the first-party block and stops after the runtime probe is unpublished', () => {
  assert.match(src, /THROUGH !== 'runtime-core'/);
  const gate = src.indexOf("pub.ok && ids.length === 4 && THROUGH !== 'runtime-core'");
  const comment = src.indexOf('const COMMENT');
  assert.ok(gate > 0 && gate < comment, 'the first-party block (member contact, badge, grant) is gated off');
  const stop = src.indexOf("if (THROUGH === 'runtime-core') await finish(");
  assert.ok(stop > src.indexOf("check(un.ok === true && st === 'draft'"), 'after the probe is a draft again');
  assert.ok(stop < src.indexOf('await runMultipathInsertProof('), 'before the multipath proof');
});
test('batch 6: --through=pre-copy stops before copy_workflow_to_location', () => {
  const stop = src.indexOf("if (THROUGH === 'pre-copy') await finish(");
  assert.ok(stop > src.indexOf('await runEntityPagingProof('));
  assert.ok(stop < src.indexOf('await runCopyWorkflowProof('));
});
test('batch 6: a stop point that does not exist still exits 2', () => {
  assert.match(src, /only: publish, settings-rail, error-alerts, custom-code, runtime-core, pre-copy/);
});

// w9-d18 batch 7
test('batch 7: the member contact is a +w9 tag address with DND, fenced by a read-back, and no example.com fixture remains', () => {
  assert.ok(!/test-conf-member-\$\{STAMP\}@example\.com/.test(src));
  assert.match(src, /email: `xander\+w9-member-\$\{STAMP\}@xanderroque\.com`/);
  assert.match(src, /FENCE: the member contact has a \+w9 tag address and DND on, read back/);
});
