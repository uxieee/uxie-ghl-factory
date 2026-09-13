import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord, labelFor, AUDIT_COMPOSITES } from '../../../../scripts/lib/proof-record.mjs';

const good = () => ({
  tool: 'build_workflow', surfaces: ['workflows'],
  runs: [{ at: '2026-09-10', result: 'pass', how: 'suite', suite: 'workflows', evidence: ['receipt:2026-09-10-1412'], location: '…zn6B' }],
  depends: {
    hashedAt: '2026-09-10',
    endpoints: { 'POST https://backend.leadconnectorhq.com /workflow/{}': 'a'.repeat(64) },
    builds: { 'builder-chunks': 'assets/index-Bbegn_x5.js', formSurveyApp: 212, missingApp: null },
    code: { 'plugins/uxie-ghl-factory/mcp-internal/core/tools.mjs#build_workflow': 'b'.repeat(64) },
  },
});

test('a well-formed record has no errors', () => assert.deepEqual(validateRecord(good()), []));

test('unknown keys are refused at every level', () => {
  const r = good(); r.note = 'free text'; r.runs[0].contact = 'x';
  const errs = validateRecord(r);
  assert.ok(errs.some((e) => /unknown key "note"/.test(e)));
  assert.ok(errs.some((e) => /unknown key "contact"/.test(e)));
});

test('evidence must be one of the allowlisted forms — never a sniff path', () => {
  const r = good(); r.runs[0].evidence = ['sniff:sniffs/agent-logs/live-04-responseDetails-hJPQx.json'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)));
});

test('a full location id is refused; last four only', () => {
  const r = good(); r.runs[0].location = 'rW9hsvyrwCgaaySWzn6B';
  assert.ok(validateRecord(r).some((e) => /location/.test(e)));
});

test('labels: latest fail wins; otherwise the latest pass and its class', () => {
  const r = good();
  assert.equal(labelFor(r), 'live-runtime (2026-09-10)');
  r.runs.push({ at: '2026-09-20', result: 'fail', how: 'suite', evidence: ['receipt:2026-09-20-0900'], failures: ['export-round-trips'] });
  assert.equal(labelFor(r), 'failing (2026-09-20)');
  const c = good(); c.runs[0].proofClass = 'live-canary';
  assert.equal(labelFor(c), 'live-canary (2026-09-10)');
});

test('the three audit composites are named, and match the frozen test', () => {
  assert.deepEqual([...AUDIT_COMPOSITES].sort(), ['get_ai_configuration_bundle', 'get_workflow_runtime_window', 'list_workflows_complete']);
});
