import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('README describes the workflow write tools truthfully', () => {
  assert.doesNotMatch(readme, /Status: Plan 4 internal surface/i);
  assert.match(readme, /\| `build_workflow` \|[^\n]*draft[^\n]*never publish/i);
  assert.match(readme, /\| `edit_workflow` \|[^\n]*preview[^\n]*confirm[^\n]*never publish/i);
  assert.match(readme, /\| `publish_workflow` \|[^\n]*preview[^\n]*confirm/i);
});

// This guard's PURPOSE is to stop the README claiming live proof it does not have.
// Originally it asserted the writes were "not been live-called". Task 5 ran on GROM AU
// 2026-07-21, so the claim flipped — and the guard flips with it: a live-proof claim is
// now only allowed if a dated write-tool ledger backs it up. The invariant is unchanged
// (never claim more than the evidence), only which side of it we are on.
test('any live-proof claim for the write tools is backed by a dated ledger', () => {
  const claimsLive = /LIVE-PROVEN/i.test(readme);
  if (!claimsLive) {
    assert.match(readme, /not been live-called/i,
      'without a live-proof claim the README must say the writes were not live-called');
    return;
  }
  assert.match(readme, /Live proof ledger — write tools \(Task 5\)/i, 'live claim needs its ledger');
  assert.match(readme, /\d{4}-\d{2}-\d{2}/, 'ledger must carry a date');
  assert.match(readme, /GROM AU/, 'ledger must name the account');
  // The write tools each need a ledger row, so the claim cannot outrun the evidence.
  for (const tool of ['build_workflow', 'edit_workflow', 'publish_workflow', 'fast_forward_contacts']) {
    assert.match(readme, new RegExp(`\\| \`?${tool}\``, 'i'), `${tool} needs a ledger row`);
  }
  assert.match(readme, /deleted afterwards|Cleanup/i, 'ledger must show canary cleanup');
});

test('the historical read-only ledger is preserved', () => {
  assert.match(readme, /Historical live proof ledger/i);
});

// ---------------------------------------------------------------------------
// Task 6: the audit profile's documentation freeze
// ---------------------------------------------------------------------------
//
// These guards exist for one reason: the README is where an operator decides whether an
// audit's evidence can be trusted, and every incentive during a build is to describe the
// contract as slightly better proven than it is. Each assertion below names a specific
// overclaim that would otherwise be easy to make.

const section = (heading) => {
  const index = readme.indexOf(heading);
  assert.notEqual(index, -1, `README is missing the section: ${heading}`);
  const rest = readme.slice(index + heading.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
};

test('the audit profile section documents the exact runtime-window inputs and output', () => {
  const body = section('## Audit profile');
  for (const field of ['locationId', 'workflowId', 'fromDate', 'toDate', 'eventTypes', 'stepIds',
    'maxLogPartitions', 'minPartitionMs', 'maxEnrollmentPages', 'maxStepRosterPages']) {
    assert.ok(body.includes(field), `the runtime-window input ${field} is undocumented`);
  }
  for (const field of ['runtimeEvents', 'enrollments', 'stepRosters', 'enrollmentTotals',
    'workflowDefinition', 'complete', 'truncated', 'warnings', 'configurationBinding',
    'componentCompleteness', 'capabilityVersion']) {
    assert.ok(body.includes(field), `the runtime-window output field ${field} is undocumented`);
  }
  assert.match(body, /pageSize[^\n]*20/, 'the pinned page size must be stated');
});

test('time-partition completeness and saturation behaviour are documented', () => {
  const body = section('## Audit profile');
  assert.match(body, /\[fromDate, toDate\)/, 'the half-open analytical window must be stated');
  assert.match(body, /midpoint/i, 'the split rule must be stated');
  assert.match(body, /saturat/i, 'saturation must be named');
  assert.match(body, /minPartitionMs/, 'the partition floor must be named');
  assert.match(body, /complete[^\n]*false/i, 'saturation must be tied to an incompleteness verdict');
});

test('the short-lived elevated Bearer credential limitation is documented', () => {
  const body = section('## Audit profile');
  assert.match(body, /short-lived/i, 'the credential lifetime limitation must be stated');
  assert.match(body, /token-id|agency/i, 'the elevated credential must be named');
  assert.match(body, /services\.leadconnectorhq\.com|AI (rail|host)/i, 'the host the elevated credential reaches must be named');
});

test('the audit profile exclusions are documented by name', () => {
  const body = section('## Audit profile');
  for (const excluded of ['raw_request', 'set_token_file', 'list_account_entities']) {
    assert.ok(body.includes(excluded), `the exclusion of ${excluded} must be stated by name`);
  }
  assert.match(body, /confirm/i, 'the absence of confirmation-gated tools must be stated');
  // The honest half: the bundle still CONTAINS the write code. A reader must not infer
  // artefact purity from an exclusion list.
  assert.match(body, /dead code|unreachable|still contains|tree-shak/i,
    'the README must not imply the audit bundle is structurally incapable of writing');
});

test('credential refresh and partial-run behaviour are documented', () => {
  const body = section('## Audit profile');
  assert.match(body, /refresh|re-?capture|expire/i, 'credential refresh must be described');
  assert.match(body, /partial|resume|checkpoint/i, 'partial-run behaviour must be described');
});

test('the YAML-as-specification boundary is documented', () => {
  const body = section('## Audit profile');
  assert.match(body, /YAML/, 'the API YAML must be named');
  assert.match(body, /specification|capability documentation/i, 'the YAML must be called a specification');
  assert.match(body, /not[^\n]*runtime proof|never[^\n]*proof/i,
    'the README must say the YAML is not runtime proof');
});

test('the human-gated live-canary stop line is documented', () => {
  const body = section('## Audit profile');
  assert.match(body, /canary/i, 'the canary must be named');
  assert.match(body, /explicit[^\n]*approval|human-gated|stop/i, 'the gate must be stated');
  assert.match(body, /Full/, 'the Full-audit consequence must be stated');
});

test('the README does not claim live proof for the audit composites', () => {
  const body = section('## Audit profile');
  // The composites are offline-proven only until Task 7. A dated live claim here would
  // outrun the evidence exactly the way the write-tool ledger guard above prevents.
  assert.match(body, /offline/i, 'the offline-only status must be stated');
  assert.match(body, /external-receipt-required|proof index|receipt/i,
    'the per-capability receipt model must be named');
  assert.doesNotMatch(body, /LIVE-PROVEN/i,
    'no audit composite may claim LIVE-PROVEN before the Task 7 canary');
});

test('the capabilities with no docs-matrix row are recorded, not hidden', () => {
  const body = section('## Audit profile');
  assert.match(body, /matrix/i, 'the docs-matrix gap must be stated');
  for (const route of ['/voice-ai/agents/simple', '/agent-studio/agents/agents-with-folders']) {
    assert.ok(body.includes(route), `the uncited route ${route} must be named`);
  }
});

test('the unvalidated live assumptions are recorded as canary obligations', () => {
  const body = section('## Audit profile');
  assert.match(body, /canary/i);
  assert.match(body, /timestamp|ISO/i, 'the unvalidated timestamp grammar must be recorded');
});

// ---------------------------------------------------------------------------
// Code-derived assertions
// ---------------------------------------------------------------------------
//
// Everything above greps the README against itself, which can only detect a MISSING keyword,
// never a FALSE statement. An adversarial review falsified nine separate claims — inverted
// the split rule, quadrupled every budget default, asserted the bundle "cannot write", and
// claimed the composites were "fully verified live" — and all of those greps still passed.
// These three compare the prose to importable values instead, so the numbers, the field list
// and the gap count cannot drift from the code without failing here.

test('the documented budget defaults and page sizes equal the code', async () => {
  const module = await import('../core/workflow-runtime-window.mjs');
  const body = section('## Audit profile');
  const defaults = module.RUNTIME_WINDOW_DEFAULTS;
  for (const [name, value] of Object.entries(defaults)) {
    if (typeof value !== 'number') continue;
    assert.ok(
      new RegExp(`\`${name}\`[^.]*?\\b${value}\\b`).test(body),
      `README must state ${name}'s real default of ${value}`,
    );
  }
  for (const [label, value] of [['LOG_PAGE_SIZE', module.LOG_PAGE_SIZE],
    ['ENROLLMENT_PAGE_SIZE', module.ENROLLMENT_PAGE_SIZE],
    ['STEP_ROSTER_PAGE_SIZE', module.STEP_ROSTER_PAGE_SIZE]]) {
    assert.ok(body.includes(String(value)), `README must state the pinned ${label} of ${value}`);
  }
  assert.match(body, /`pageSize`[^\n]*\b20\b/, 'the pinned execution-log page size must be stated');
});

test('the documented runtime-window output list equals the real contract, both directions', async () => {
  const { RUNTIME_WINDOW_RESULT_KEYS } = await import('../core/workflow-runtime-window.mjs');
  assert.ok(Array.isArray(RUNTIME_WINDOW_RESULT_KEYS) && RUNTIME_WINDOW_RESULT_KEYS.length > 0,
    'core/workflow-runtime-window.mjs must export RUNTIME_WINDOW_RESULT_KEYS so the README can be checked against it');
  const body = section('## Audit profile');
  const outputParagraph = body.slice(body.indexOf('Output:'), body.indexOf('**Time-partition'));
  const documented = [...outputParagraph.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((match) => match[1]);
  assert.deepEqual([...documented].sort(), [...RUNTIME_WINDOW_RESULT_KEYS].sort(),
    'the documented output field list must equal the contract exactly — no omission, no invention');
});

test('the documented count of uncited routes equals tool-descriptions.json', () => {
  const catalog = JSON.parse(readFileSync(new URL('../tool-descriptions.json', import.meta.url), 'utf8'));
  const uncited = Object.values(catalog)
    .filter((entry) => entry && typeof entry === 'object' && Array.isArray(entry.undocumentedCapabilities))
    .flatMap((entry) => entry.undocumentedCapabilities);
  const body = section('## Audit profile');
  const words = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight' };
  assert.match(
    body, new RegExp(`${words[uncited.length]} audit routes? carry no row`, 'i'),
    `README must state the real uncited-route count of ${uncited.length}`,
  );
  for (const capability of uncited) {
    const path = typeof capability === 'string' ? capability : capability.path;
    assert.ok(body.includes(path), `the uncited route ${path} must be named in the README`);
  }
});
