import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, rehash, backfillFrom, applyLabel, syncLabels } from '../../../../scripts/proof.mjs';

const computed = (over = {}) => ({ surfaces: ['workflows'], depends: {
  hashedAt: '2026-09-14', endpoints: { 'POST https://backend.leadconnectorhq.com /workflow/{}': 'a'.repeat(64) },
  builds: { 'builder-chunks': 'assets/index-A.js' }, code: { 'x/tools.mjs#build_workflow': 'b'.repeat(64) }, ...over } });

test('appendRun creates a record, then appends — never replaces', () => {
  const run1 = { at: '2026-09-14', result: 'pass', how: 'manual', evidence: ['row:workflow-create'] };
  const r1 = appendRun(null, run1, computed());
  assert.equal(r1.tool, undefined, 'the caller sets tool');
  const r2 = appendRun({ tool: 'build_workflow', ...r1 }, { ...run1, at: '2026-09-15', result: 'fail' }, computed());
  assert.equal(r2.runs.length, 2);
  assert.equal(r2.runs[0].result, 'pass');
});

test('rehash moves builds only, and refuses when code or an endpoint changed', () => {
  const rec = { tool: 'build_workflow', ...computed(), runs: [{ at: '2026-09-10', result: 'pass', how: 'manual', evidence: [] }] };
  const moved = rehash(rec, computed({ builds: { 'builder-chunks': 'assets/index-B.js' }, hashedAt: '2026-09-20' }));
  assert.equal(moved.depends.builds['builder-chunks'], 'assets/index-B.js');
  assert.equal(moved.depends.hashedAt, rec.depends.hashedAt, 'rehash never moves hashedAt');
  assert.equal(moved.runs.at(-1).at, '2026-09-10', 'rehash never moves a run date');
  assert.throws(() => rehash(rec, computed({ code: { 'x/tools.mjs#build_workflow': 'c'.repeat(64) } })), /stale/);
});

test('backfill takes live labels only, keeps their date and class, cites proofRows, skips audit composites', () => {
  const descriptions = {
    build_workflow: { description: 'Build — proof: live-runtime (2026-09-10); risk: write', proof: 'live-runtime (2026-09-10)', proofRows: ['workflow-create'] },
    pin_webhook_sample: { description: 'Pin — proof: live-canary (2026-08-22); risk: write', proof: 'live-canary (2026-08-22)', proofRows: [] },
    list_courses: { description: 'List — proof: documented; risk: read', proof: 'documented' },
    list_workflows_complete: { description: 'x — proof: external-receipt-required; risk: read', proof: 'external-receipt-required' },
  };
  const recs = backfillFrom(descriptions, { compute: () => computed() }, '2026-09-14');
  assert.deepEqual(recs.map((r) => r.tool).sort(), ['build_workflow', 'pin_webhook_sample']);
  const pin = recs.find((r) => r.tool === 'pin_webhook_sample');
  assert.deepEqual(pin.runs[0], { at: '2026-08-22', result: 'pass', how: 'manual', proofClass: 'live-canary', evidence: [], backfilled: true });
  assert.deepEqual(recs.find((r) => r.tool === 'build_workflow').runs[0].evidence, ['row:workflow-create']);
});

test('applyLabel rewrites the proof field and the clause inside the description', () => {
  const e = applyLabel({ description: 'Build — proof: live-runtime (2026-09-10); risk: write', proof: 'live-runtime (2026-09-10)' }, 'failing (2026-09-20)');
  assert.equal(e.proof, 'failing (2026-09-20)');
  assert.equal(e.description, 'Build — proof: failing (2026-09-20); risk: write');
});

test('syncLabels skips audit composites and tools with no entry, and reports what changed', () => {
  const descriptions = { build_workflow: { description: 'B — proof: live-runtime (2026-09-10); risk: write', proof: 'live-runtime (2026-09-10)' } };
  const records = {
    build_workflow: { tool: 'build_workflow', runs: [{ at: '2026-09-20', result: 'pass', how: 'suite', evidence: [] }] },
    raw_request: { tool: 'raw_request', runs: [{ at: '2026-09-20', result: 'pass', how: 'manual', evidence: [] }] },
  };
  const { next, changed } = syncLabels(descriptions, records);
  assert.deepEqual(changed, ['build_workflow']);
  assert.equal(next.build_workflow.proof, 'live-runtime (2026-09-20)');
  assert.equal(syncLabels(next, records).changed.length, 0);
});
