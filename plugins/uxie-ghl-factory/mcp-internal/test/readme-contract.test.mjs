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
// The receipt-gated composites' documentation freeze
// ---------------------------------------------------------------------------
//
// These guards exist for one reason: the README is where an operator decides whether a
// sweep's evidence can be trusted, and every incentive during a build is to describe the
// contract as slightly better proven than it is. Each assertion below names a specific
// overclaim that would otherwise be easy to make. They outlived the read-only audit server
// removed on 2026-09-16 because the composites and their contracts did.

const section = (heading) => {
  const index = readme.indexOf(heading);
  assert.notEqual(index, -1, `README is missing the section: ${heading}`);
  const rest = readme.slice(index + heading.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
};

test('the composites section documents the exact runtime-window inputs and output', () => {
  const body = section('## The receipt-gated composites');
  for (const field of ['locationId', 'workflowId', 'fromDate', 'toDate', 'eventTypes', 'stepIds',
    'logPageSize', 'maxLogPages', 'maxLogRetries', 'maxEnrollmentPages', 'maxStepRosterPages']) {
    assert.ok(body.includes(field), `the runtime-window input ${field} is undocumented`);
  }
  for (const field of ['runtimeEvents', 'enrollments', 'stepRosters', 'enrollmentTotals',
    'workflowDefinition', 'complete', 'truncated', 'warnings', 'configurationBinding',
    'componentCompleteness', 'capabilityVersion']) {
    assert.ok(body.includes(field), `the runtime-window output field ${field} is undocumented`);
  }
  // The three retired inputs must be named as retired, not quietly dropped from the prose:
  // the reader who would otherwise keep passing them is exactly the reader this page has.
  for (const retired of ['pageSize', 'maxLogPartitions', 'minPartitionMs']) {
    assert.ok(body.includes(retired), `the retirement of ${retired} must be stated by name`);
  }
  assert.match(body, /retired and refused, not ignored/i,
    'the README must say the retired inputs are REFUSED — silently ignoring them is the defect this replaced');
});

test('the dateType mode switch and cursor completeness are documented', () => {
  const body = section('## The receipt-gated composites');
  assert.match(body, /\[fromDate, toDate\)/, 'the half-open analytical window must be stated');
  // THE load-bearing sentence. A reader who takes one thing from this section must take away
  // that the window does nothing without its switch — every mistake made on this endpoint
  // came from assuming a parameter worked because it was accepted.
  assert.match(body, /`dateType=custom`/, 'the mode switch must be named');
  assert.match(body, /30-day default|now-30d/i, 'the silent default window must be stated');
  assert.match(body, /cursor/i, 'the cursor walk must be described');
  assert.match(body, /referenceCreatedAt/, 'the load-bearing second reference half must be named');
  assert.match(body, /no new ids/i, 'the termination rule must be stated');
  assert.match(body, /actionType/, 'the deliberately-unsent filter must be explained');
  assert.match(body, /complete[^\n]*false/i, 'incompleteness must be tied to a verdict');
});

test('the short-lived elevated Bearer credential limitation is documented', () => {
  const body = section('## The receipt-gated composites');
  assert.match(body, /short-lived/i, 'the credential lifetime limitation must be stated');
  assert.match(body, /token-id|agency/i, 'the elevated credential must be named');
  assert.match(body, /services\.leadconnectorhq\.com|AI (rail|host)/i, 'the host the elevated credential reaches must be named');
});

// The exclusions guard that stood here checked the second server's registry allowlist and
// warned against implying its BUNDLE could not write. Both went with that server on
// 2026-09-16. What survives is the completeness argument below: the composites still refuse
// to reuse the best-effort readers, and the README still has to name them.
test('the readers the composites refuse to reuse are named', () => {
  const body = section('## The receipt-gated composites');
  for (const excluded of ['list_account_entities', 'get_workflow_logs', 'list_workflows', 'get_contacts_at_step']) {
    assert.ok(body.includes(excluded), `the refusal to reuse ${excluded} must be stated by name`);
  }
});

test('credential refresh and partial-run behaviour are documented', () => {
  const body = section('## The receipt-gated composites');
  assert.match(body, /refresh|re-?capture|expire/i, 'credential refresh must be described');
  assert.match(body, /partial|resume|checkpoint/i, 'partial-run behaviour must be described');
});

test('the YAML-as-specification boundary is documented', () => {
  const body = section('## The receipt-gated composites');
  assert.match(body, /YAML/, 'the API YAML must be named');
  assert.match(body, /specification|capability documentation/i, 'the YAML must be called a specification');
  assert.match(body, /not[^\n]*runtime proof|never[^\n]*proof/i,
    'the README must say the YAML is not runtime proof');
});

// The canary executor that could mint a receipt was removed on 2026-09-16 with the audit
// server. The composites still carry `proof: external-receipt-required`, so the README must
// now say plainly that NOTHING can mint that receipt any more — a frozen label pointing at
// absent machinery is exactly the overclaim these guards exist to catch.
test('the README states that the receipt machinery is gone, not merely unused', () => {
  const body = section('## The receipt-gated composites');
  assert.match(body, /removed|no longer/i, 'the removal must be stated');
  assert.match(body, /caveat|not[^\n]*a gate/i,
    'the README must say the frozen label is now a caveat rather than an enforced gate');
});

test('the README does not claim live proof for the receipt-gated composites', () => {
  const body = section('## The receipt-gated composites');
  // The composites are offline-proven only until Task 7. A dated live claim here would
  // outrun the evidence exactly the way the write-tool ledger guard above prevents.
  assert.match(body, /offline/i, 'the offline-only status must be stated');
  assert.match(body, /external-receipt-required|proof index|receipt/i,
    'the per-capability receipt model must be named');
  assert.doesNotMatch(body, /LIVE-PROVEN/i,
    'no composite may claim LIVE-PROVEN without a dated ledger, as the write tools carry');
});

test('the capabilities with no docs-matrix row are recorded, not hidden', () => {
  const body = section('## The receipt-gated composites');
  assert.match(body, /matrix/i, 'the docs-matrix gap must be stated');
  for (const route of ['/voice-ai/agents/simple', '/agent-studio/agents/agents-with-folders']) {
    assert.ok(body.includes(route), `the uncited route ${route} must be named`);
  }
});

test('the unvalidated live assumptions are recorded as canary obligations', () => {
  const body = section('## The receipt-gated composites');
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
  const body = section('## The receipt-gated composites');
  const defaults = module.RUNTIME_WINDOW_DEFAULTS;
  for (const [name, value] of Object.entries(defaults)) {
    if (typeof value !== 'number') continue;
    assert.ok(
      new RegExp(`\`${name}\`[^.]*?\\b${value}\\b`).test(body),
      `README must state ${name}'s real default of ${value}`,
    );
  }
  for (const [label, value] of [['LOG_PAGE_SIZE_MAX', module.LOG_PAGE_SIZE_MAX],
    ['ENROLLMENT_PAGE_SIZE', module.ENROLLMENT_PAGE_SIZE],
    ['STEP_ROSTER_PAGE_SIZE', module.STEP_ROSTER_PAGE_SIZE]]) {
    assert.ok(body.includes(String(value)), `README must state the ${label} of ${value}`);
  }
});

test('the documented runtime-window output list equals the real contract, both directions', async () => {
  const { RUNTIME_WINDOW_RESULT_KEYS } = await import('../core/workflow-runtime-window.mjs');
  assert.ok(Array.isArray(RUNTIME_WINDOW_RESULT_KEYS) && RUNTIME_WINDOW_RESULT_KEYS.length > 0,
    'core/workflow-runtime-window.mjs must export RUNTIME_WINDOW_RESULT_KEYS so the README can be checked against it');
  const body = section('## The receipt-gated composites');
  const outputParagraph = body.slice(body.indexOf('Output:'), body.indexOf('**Execution-log completeness'));
  const documented = [...outputParagraph.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((match) => match[1]);
  assert.deepEqual([...documented].sort(), [...RUNTIME_WINDOW_RESULT_KEYS].sort(),
    'the documented output field list must equal the contract exactly — no omission, no invention');
});

test('the documented count of uncited routes equals tool-descriptions.json', () => {
  const catalog = JSON.parse(readFileSync(new URL('../tool-descriptions.json', import.meta.url), 'utf8'));
  const uncited = Object.values(catalog)
    .filter((entry) => entry && typeof entry === 'object' && Array.isArray(entry.undocumentedCapabilities))
    .flatMap((entry) => entry.undocumentedCapabilities);
  const body = section('## The receipt-gated composites');
  const words = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight' };
  assert.match(
    body, new RegExp(`${words[uncited.length]} composite routes? carry no row`, 'i'),
    `README must state the real uncited-route count of ${uncited.length}`,
  );
  for (const capability of uncited) {
    const path = typeof capability === 'string' ? capability : capability.path;
    assert.ok(body.includes(path), `the uncited route ${path} must be named in the README`);
  }
});
