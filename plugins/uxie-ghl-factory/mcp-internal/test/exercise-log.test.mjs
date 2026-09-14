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
