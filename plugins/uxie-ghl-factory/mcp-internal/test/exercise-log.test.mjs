import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExerciseLog, assertionId } from '../core/exercise-log.mjs';

test('assertionId is stable across the numbers a message interpolates', () => {
  assert.equal(assertionId('export round-trips 14 steps'), assertionId('export round-trips 9 steps'));
  assert.equal(assertionId('Export round-trips 14 steps'), 'export-round-trips-steps');
});

test('assertions attribute to the most recently called tool; none before the first call', async () => {
  const log = createExerciseLog();
  log.result(false, 'setup before any tool');
  const build = log.wrap({ name: 'build_workflow', handler: async () => 'built' });
  const exp = log.wrap({ name: 'export_workflow', handler: async () => 'json' });
  assert.equal(await build.handler({}, {}), 'built');
  log.result(true, 'build returned an id');
  await exp.handler({}, {}); await exp.handler({}, {});
  log.result(true, 'export has steps');
  log.result(false, 'export keeps 14 triggers');
  assert.deepEqual(log.entries(), [
    { tool: 'build_workflow', calls: 1, passed: 1, failed: 0, failures: [] },
    { tool: 'export_workflow', calls: 2, passed: 1, failed: 1, failures: ['export-keeps-triggers'] },
  ]);
});

test('write goes to GHL_EXERCISED_OUT only when set', () => {
  const log = createExerciseLog();
  const file = join(mkdtempSync(join(tmpdir(), 'ex-')), 'out.json');
  process.env.GHL_EXERCISED_OUT = file;
  log.write();
  delete process.env.GHL_EXERCISED_OUT;
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), []);
  assert.doesNotThrow(() => log.write());
});

// ── fix round 2: explicit subject, for read-back assertions that prove a DIFFERENT tool ─────────

test('an explicit subject overrides the most-recently-called tool', async () => {
  const log = createExerciseLog();
  const write = log.wrap({ name: 'repair_workflow', handler: async () => 'wrote' });
  const read = log.wrap({ name: 'export_workflow', handler: async () => 'read' });
  await write.handler({}, {});
  await read.handler({}, {}); // the read-back — 'last' is now export_workflow
  log.subject('repair_workflow'); // but this assertion proves repair_workflow's effect
  log.result(true, 'the repair landed, read back on a separate request');
  assert.deepEqual(log.entries(), [
    { tool: 'repair_workflow', calls: 1, passed: 1, failed: 0, failures: [] },
    { tool: 'export_workflow', calls: 1, passed: 0, failed: 0, failures: [] },
  ]);
});

test('clearing the subject restores the last-called fallback', async () => {
  const log = createExerciseLog();
  const a = log.wrap({ name: 'build_workflow', handler: async () => 'a' });
  const b = log.wrap({ name: 'export_workflow', handler: async () => 'b' });
  await a.handler({}, {});
  log.subject('build_workflow');
  log.result(true, 'attributed by explicit subject');
  log.subject(null); // clear — back to fallback
  await b.handler({}, {}); // last is now export_workflow
  log.result(true, 'attributed by fallback, since no subject is set');
  assert.deepEqual(log.entries(), [
    { tool: 'build_workflow', calls: 1, passed: 1, failed: 0, failures: [] },
    { tool: 'export_workflow', calls: 1, passed: 1, failed: 0, failures: [] },
  ]);
});

test('a subject naming a tool that was never called still gets an entry, with calls: 0', () => {
  const log = createExerciseLog();
  log.subject('publish_workflow');
  log.result(false, 'publish leg SKIPPED because a precondition failed');
  assert.deepEqual(log.entries(), [
    { tool: 'publish_workflow', calls: 0, passed: 0, failed: 1, failures: ['publish-leg-skipped-because-a-precondition-failed'] },
  ]);
});

test('subject(false) suppresses attribution entirely — a control proves no tool', async () => {
  const log = createExerciseLog();
  const build = log.wrap({ name: 'build_workflow', handler: async () => 'built' });
  await build.handler({}, {}); // last is now build_workflow
  log.subject(false); // a raw-endpoint control — attribute to nothing, not to the bystander
  log.result(true, 'GHL\'s own validator calls an invented key VALID');
  log.result(false, 'the same control, a second assertion');
  assert.deepEqual(log.entries(), [
    { tool: 'build_workflow', calls: 1, passed: 0, failed: 0, failures: [] },
  ]);
});

test('the exit handler writes what had been driven so far, even mid-run', async () => {
  const log = createExerciseLog();
  const build = log.wrap({ name: 'build_workflow', handler: async () => 'built' });
  await build.handler({}, {});
  log.result(true, 'built fine');
  const file = join(mkdtempSync(join(tmpdir(), 'ex-')), 'exit.json');
  process.env.GHL_EXERCISED_OUT = file;
  const onExit = () => log.write();
  process.on('exit', onExit);
  process.emit('exit', 0); // simulate the process ending mid-run, as a crash would trigger
  process.off('exit', onExit);
  delete process.env.GHL_EXERCISED_OUT;
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), [
    { tool: 'build_workflow', calls: 1, passed: 1, failed: 0, failures: [] },
  ]);
});
