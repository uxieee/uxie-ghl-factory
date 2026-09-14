import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, rehash, backfillFrom, applyLabel, syncLabels, backfillWrite, runsFromReceipt, applyReceiptRuns, writeReceiptRuns } from '../../../../scripts/proof.mjs';

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

test('backfillWrite stops on the first failing tool and reports count written, the tool, and that a re-run is safe', () => {
  const recs = [{ tool: 'build_workflow' }, { tool: 'get_workflow_stats' }, { tool: 'list_courses' }];
  const write = (rec) => {
    if (rec.tool === 'get_workflow_stats') {
      throw new Error('refusing to write get_workflow_stats:\n  runs[0].evidence: at least one receipt: ledger: corpus: row: commit: reference');
    }
  };
  let calls = 0;
  let err;
  try { backfillWrite(recs, (r) => { calls += 1; write(r); }); } catch (e) { err = e; }
  assert.ok(err, 'backfillWrite must throw');
  assert.equal(calls, 2, 'stops at the failing tool — never skips it and never continues past it');
  assert.match(err.message, /wrote 1 record/);
  assert.match(err.message, /get_workflow_stats failed validation/);
  assert.match(err.message, /runs\[0\]\.evidence: at least one receipt: ledger: corpus: row: commit: reference/);
  assert.match(err.message, /already written are kept/);
  assert.match(err.message, /re-run/);
  assert.match(err.message, /skips tools that already have a record/);
});

test('runsFromReceipt: one run per exercised tool; nothing from an unverified suite or an audit composite', () => {
  const receipt = { location: '…zn6B', results: [
    { name: 'workflows', summary: { passed: 54, failed: 1 }, exercised: [
      { tool: 'build_workflow', calls: 2, passed: 5, failed: 0, failures: [] },
      { tool: 'export_workflow', calls: 18, passed: 30, failed: 1, failures: ['export-keeps-triggers'] },
      { tool: 'list_workflows_complete', calls: 1, passed: 1, failed: 0, failures: [] },
    ] },
    { name: 'funnels', summary: null, exercised: [{ tool: 'audit_site', calls: 1, passed: 1, failed: 0, failures: [] }] },
    { name: 'memberships', summary: { passed: 40, failed: 0 }, exercised: [] },
  ] };
  const runs = runsFromReceipt(receipt, '2026-09-20-0930');
  assert.deepEqual(runs.map((r) => [r.tool, r.run.result]), [['build_workflow', 'pass'], ['export_workflow', 'fail']]);
  assert.deepEqual(runs[1].run, { at: '2026-09-20', result: 'fail', how: 'suite', suite: 'workflows',
    evidence: ['receipt:2026-09-20-0930'], location: '…zn6B', failures: ['export-keeps-triggers'] });
});

test('applyReceiptRuns: a tool exercised twice in one receipt keeps BOTH runs, in order — not just the last write', () => {
  // Regression for a real bug: from-receipt used to compute every write from the SAME pre-loop
  // `have` snapshot, so the second write for a repeated tool clobbered the first on disk.
  const runs = [
    { tool: 'build_workflow', run: { at: '2026-09-20', result: 'pass', how: 'suite', suite: 'workflows', evidence: ['receipt:2026-09-20-0930'] } },
    { tool: 'build_workflow', run: { at: '2026-09-20', result: 'fail', how: 'suite', suite: 'funnels', evidence: ['receipt:2026-09-20-0930'] } },
  ];
  const recs = applyReceiptRuns(runs, {}, () => computed());
  assert.equal(recs.length, 2, 'one record snapshot is produced per run, so the count reported matches what gets written');
  assert.equal(recs[1].runs.length, 2, 'the second write built on the first, not on the empty pre-loop snapshot');
  assert.deepEqual(recs[1].runs.map((r) => r.result), ['pass', 'fail']);
});

test('runsFromReceipt: an exercised entry with calls but no assertions attributed records nothing — a pass with calls, a fail with calls, a no-assertion entry with calls', () => {
  const receipt = { location: '…zn6B', results: [
    { name: 'workflows', summary: { passed: 5, failed: 1 }, exercised: [
      // setup-only or fully subject()-attributed-elsewhere: calls happened, nothing was asserted against it.
      { tool: 'setup_only', calls: 3, passed: 0, failed: 0, failures: [] },
      { tool: 'build_workflow', calls: 2, passed: 5, failed: 0, failures: [] },
      { tool: 'export_workflow', calls: 1, passed: 0, failed: 1, failures: ['export-keeps-triggers'] },
    ] },
  ] };
  const runs = runsFromReceipt(receipt, '2026-09-20-0930');
  assert.deepEqual(runs.map((r) => r.tool), ['build_workflow', 'export_workflow'],
    'setup_only asserted nothing and must not be recorded as a pass');
});

test('runsFromReceipt: a failure attributed via log.subject() with calls: 0 is still recorded — the skip is "no assertions", not "no calls"', () => {
  // Regression: the skip used to be `!e.calls`, which dropped an entry whose OWN handler never ran
  // (calls: 0) but which still carries a real assertion failure attributed to it by log.subject(name).
  // A genuine failure must reach the record whatever the call count says.
  const receipt = { location: '…zn6B', results: [
    { name: 'workflows', summary: { passed: 5, failed: 1 }, exercised: [
      { tool: 'build_workflow', calls: 2, passed: 5, failed: 0, failures: [] },
      { tool: 'attributed_only', calls: 0, passed: 0, failed: 1, failures: ['assert-on-attributed-tool'] },
    ] },
  ] };
  const runs = runsFromReceipt(receipt, '2026-09-20-0930');
  assert.deepEqual(runs.map((r) => [r.tool, r.run.result]), [['build_workflow', 'pass'], ['attributed_only', 'fail']],
    'a calls: 0, failed: 1 entry must record a failure, not be skipped silently');
});

test('writeReceiptRuns reports each written tool as it writes, so an earlier write survives a later one throwing', () => {
  const recs = [{ tool: 'build_workflow' }, { tool: 'export_workflow' }, { tool: 'list_courses' }];
  const runs = [
    { tool: 'build_workflow', run: { result: 'pass' } },
    { tool: 'export_workflow', run: { result: 'fail', failures: ['export-keeps-triggers'] } },
    { tool: 'list_courses', run: { result: 'pass' } },
  ];
  const lines = [];
  const write = (rec) => { if (rec.tool === 'list_courses') throw new Error('refusing to write list_courses: bad shape'); };
  assert.throws(() => writeReceiptRuns(recs, runs, write, (l) => lines.push(l)), /refusing to write list_courses/);
  assert.deepEqual(lines, ['pass  build_workflow', 'FAIL  export_workflow  export-keeps-triggers'],
    'the two tools already written are reported even though the third threw');
});

test('applyReceiptRuns: a tool with an existing record from an earlier receipt keeps its prior runs', () => {
  const priorRec = { tool: 'export_workflow', ...appendRun(null, { at: '2026-08-01', result: 'pass', how: 'suite', suite: 'workflows', evidence: ['receipt:2026-08-01-0930'] }, computed()) };
  const runs = [{ tool: 'export_workflow', run: { at: '2026-09-20', result: 'fail', how: 'suite', suite: 'workflows', evidence: ['receipt:2026-09-20-0930'], failures: ['x'] } }];
  const recs = applyReceiptRuns(runs, { export_workflow: priorRec }, () => computed());
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].runs.map((r) => r.at), ['2026-08-01', '2026-09-20'], 'the older run from the earlier receipt is not lost');
});
