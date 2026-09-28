// build_workflow must not answer ok:true when a trigger did not land (coordinator 2026-09-28). Live case: ivr_incoming_call
// refused with "missing trigger conditions" while the build reported success (knowledge live-3BR-t1-trigger-drafts.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { triggerWriteFailure } from '../core/tools.mjs';

test('control: every trigger landed with its filters → no failure', () => {
  assert.equal(triggerWriteFailure({ wid: 'W', triggers: { authored: 2, posted: 2, persisted: 2, failed: [], payloadMismatches: [] } }), null);
});

test('a refused trigger POST fails the build and names the workflow that exists and the trigger that does not', () => {
  const m = triggerWriteFailure({ wid: 'W1', triggers: { authored: 1, posted: 0, failed: [{ type: 'ivr_incoming_call', name: 'IVR', status: 400, error: '{"message":"Failed to create trigger due to missing trigger conditions"}' }] } });
  assert.match(m, /Workflow W1 EXISTS/); assert.match(m, /'IVR' \(ivr_incoming_call\) HTTP 400/); assert.match(m, /missing trigger conditions/);
});

test('a trigger stored WITHOUT its filters fails the build too (it would fire on everything)', () => {
  const m = triggerWriteFailure({ wid: 'W2', triggers: { authored: 1, posted: 1, failed: [], payloadMismatches: [{ type: 'form_submission', name: 'One form', missing: ['form.id'] }] } });
  assert.match(m, /WITHOUT the filters/); assert.match(m, /'One form' missing \[form\.id\]/);
});

test('a persisted-count difference alone (possible list lag) stays a warning, not a failure', () => {
  assert.equal(triggerWriteFailure({ wid: 'W3', triggers: { authored: 2, posted: 2, persisted: 1, failed: [], payloadMismatches: [] } }), null);
});

test('build_workflow returns VERIFY_FAILED on a trigger write failure instead of ok (source contract)', () => {
  const src = readFileSync(new URL('../core/tools.mjs', import.meta.url), 'utf8');
  const build = src.slice(src.indexOf("name: 'build_workflow',"), src.indexOf("const unresolved = report.unresolved ?? [];"));
  assert.match(build, /const triggerFailure = triggerWriteFailure\(report\);/);
  assert.match(build, /fail\(CODES\.VERIFY_FAILED, triggerFailure/);
});
