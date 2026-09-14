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

// Security rounds: preventing leakage of 20-char location IDs through machine-derived fields
test('corpus: evidence refuses mixed-case tokens; accepts real corpus paths', () => {
  const r = good();
  // Attempt to sneak a 20-char location ID into corpus path
  r.runs[0].evidence = ['corpus:foo/rW9hsvyrwCgaaySWzn6B'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)), 'must refuse mixed-case in corpus path');

  // Real corpus paths should still work
  r.runs[0].evidence = ['corpus:workflows/index.md'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)) === false, 'must accept real corpus path');

  r.runs[0].evidence = ['corpus:ai-agents/20-api/agent-logs.md'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)) === false, 'must accept multi-level corpus path');
});

test('endpoint paths accept templated location IDs as machine-derived values', () => {
  const r = good();
  // Templated paths with {} placeholders (from catalogue) are machine-derived, not user-typed
  assert.ok(validateRecord(r).some((e) => /endpoints/.test(e)) === false, 'baseline templated path passes');

  // Full location IDs in endpoint paths pass validation (machine-derived by builder)
  r.depends.endpoints['GET https://backend.leadconnectorhq.com /contact/rW9hsvyrwCgaaySWzn6B'] = 'c'.repeat(64);
  assert.ok(validateRecord(r).some((e) => /endpoints/.test(e)) === false, 'machine-derived endpoint with ID passes');
});

test('code keys accept file paths as machine-derived values', () => {
  const r = good();
  // Real code keys are file paths from our own tree
  assert.ok(validateRecord(r).some((e) => /code/.test(e)) === false, 'baseline code key passes');

  // Full location IDs in code paths pass validation (read from our tree, not user-typed)
  r.depends.code['rW9hsvyrwCgaaySWzn6B/tools.mjs'] = 'd'.repeat(64);
  assert.ok(validateRecord(r).some((e) => /code/.test(e)) === false, 'machine-derived code key passes');
});

test('build values accept chunk filenames as machine-derived values', () => {
  const r = good();
  // Build values are app names and filenames from GoHighLevel\'s manifest
  assert.ok(validateRecord(r).some((e) => /builds/.test(e)) === false, 'baseline build value passes');

  // Full location IDs in build filenames pass validation (read from GHL manifest, not user-typed)
  r.depends.builds['app'] = 'rW9hsvyrwCgaaySWzn6B.js';
  assert.ok(validateRecord(r).some((e) => /builds/.test(e)) === false, 'machine-derived build filename passes');
});

// Fix round 2: four critical schema fixes
test('empty evidence array is refused (vacuous truth fix)', () => {
  const r = good();
  r.runs[0].evidence = [];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)), 'must refuse empty evidence array');
});

test('depends requires all four sub-objects to be present and be objects', () => {
  const r = good();
  r.depends = { hashedAt: '2026-09-10' };
  const errs = validateRecord(r);
  assert.ok(errs.some((e) => /depends\.endpoints/.test(e)), 'must require endpoints');
  assert.ok(errs.some((e) => /depends\.builds/.test(e)), 'must require builds');
  assert.ok(errs.some((e) => /depends\.code/.test(e)), 'must require code');

  // All four present and empty works
  r.depends = { hashedAt: '2026-09-10', endpoints: {}, builds: {}, code: {} };
  assert.ok(validateRecord(r).some((e) => /depends/.test(e)) === false, 'all four present and empty passes');
});

test('ledger and row evidence require hyphens (blocks all-lowercase 20-char tokens)', () => {
  const r = good();
  // 20-char all-lowercase token without hyphens is refused in ledger arm
  r.runs[0].evidence = ['ledger:abcdefghijklmnopqrst#test-claim'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)), 'must refuse all-lowercase session in ledger');

  // 20-char all-lowercase token without hyphens is refused in row arm
  r.runs[0].evidence = ['row:abcdefghijklmnopqrst'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)), 'must refuse all-lowercase in row');

  // Real ledger entries with hyphens work (date format and claim slugs have hyphens)
  r.runs[0].evidence = ['ledger:2026-09-10#workflow-trigger-fires'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)) === false, 'date-format session accepts hyphenated slug');

  r.runs[0].evidence = ['ledger:custom-session-id#claim-slug-form'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)) === false, 'custom session id accepts hyphenated slug');

  // Real proofRow entries work (all 133 contain hyphens)
  r.runs[0].evidence = ['row:entities-tags-create'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)) === false, 'real proofRow id validates');

  r.runs[0].evidence = ['row:ai-agents--agent-logs-contacts'];
  assert.ok(validateRecord(r).some((e) => /evidence/.test(e)) === false, 'real multi-hyphen proofRow id validates');
});

test('SSE HTTP method is accepted; other methods are still refused', () => {
  const r = good();
  // SSE is a real method in the catalogue (ai-agents--super-agents-build-sse)
  r.depends.endpoints['SSE https://backend.leadconnectorhq.com /ai/stream'] = 'e'.repeat(64);
  assert.ok(validateRecord(r).some((e) => /endpoints/.test(e)) === false, 'SSE method validates');

  // Made-up methods are refused
  r.depends.endpoints['FETCH https://backend.leadconnectorhq.com /data'] = 'f'.repeat(64);
  assert.ok(validateRecord(r).some((e) => /endpoints/.test(e)), 'made-up FETCH method is refused');
});

// Fix round 3: row: charset regression fix — allow [a-zA-Z0-9_:.-] not just [a-z0-9-]
test('row: evidence accepts real proofRows with underscores, uppercase, and colons', () => {
  const r = good();
  // These four ids were refused by the broken pattern but are in the real catalogue
  const realIds = [
    'typed--list_account_entities--calendars',  // has underscore
    'trigger-count-by-triggerId',               // has uppercase
    'trigger-logs-triggerId',                   // has uppercase
    'typed--get_studio_site_history--vibe-platform-documents:runQuery'  // underscore, uppercase, colon
  ];

  for (const id of realIds) {
    r.runs[0].evidence = [`row:${id}`];
    assert.ok(validateRecord(r).some((e) => /evidence/.test(e)) === false, `must accept ${id}`);
  }
});
