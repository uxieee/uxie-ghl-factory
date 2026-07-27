// SERVER:test/audit-canary-exec.test.mjs — the canary EXECUTOR, driven with no account.
//
// The executor takes an injected `call`, so every judgement it makes is testable offline. That
// matters more here than anywhere else in this repository: there is exactly one live canary,
// a wrong judge either burns it or — far worse — passes a run that should have failed and
// mints a receipt attesting to reads that never happened.
//
// So each test below feeds a response the LIVE ACCOUNT COULD PLAUSIBLY RETURN and asserts the
// verdict, rather than asserting the judge's internals. The shapes are the ones observed on
// GROM AU 2026-07-27 (bare-array logs, `{rows,count}` roster, `{items,total}` agent studio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_TOOL_NAMES } from '../core/audit-profile.mjs';
import { CANARY_STEPS, judgeStep, executeCanary, buildReceipt, artefactHashes } from '../scripts/audit-canary.mjs';

const INPUT = Object.freeze({
  approver: 'Xander Roque',
  locationId: 'LOC1',
  workflowId: 'WF1',
  fromDate: 1_000_000,
  toDate: 2_000_000,
});

const stepById = (id) => CANARY_STEPS.find((s) => s.id === id);
const ok = (data) => ({ ok: true, data });

// A window that read cleanly: one terminal partition, no warnings.
const healthyWindow = (over = {}) => ok({
  complete: true,
  warnings: [],
  pagination: { logPages: { pages: 2, streams: 1, budget: 200, rowsReturned: 3, exhausted: false, terminatedCleanly: true } },
  enrollments: { rows: [], complete: true, windowScoped: true, contactFiltered: false },
  componentCompleteness: { enrollments: true },
  stepRosters: [],
  ...over,
});

test('the plan and the executable steps are the same seven reads, in the same order', () => {
  // Two lists describing one thing is how they drift. The prose plan is what a human approves;
  // the step list is what actually runs, and a canary that ran something other than the
  // approved plan would be the single worst outcome this file can prevent.
  assert.equal(CANARY_STEPS.length, 7);
  assert.deepEqual(CANARY_STEPS.map((s) => s.id), [
    'registry', 'window-small', 'window-wide', 'roster',
    'enrollments-and-roster', 'ai-bundle', 'honest-incompleteness',
  ]);
  for (const step of CANARY_STEPS) {
    assert.ok(step.why && step.expect, `${step.id} must state why it runs and what would pass`);
    if (step.tool !== null) assert.equal(typeof step.args, 'function', `${step.id} must build its own args`);
  }
});

test('every executable step calls an audit-profile tool and nothing else', () => {
  // The canary may not reach a tool the audit registry does not publish — that would prove
  // something about a server nobody is going to run.
  for (const step of CANARY_STEPS) {
    if (step.tool === null) continue;
    assert.ok(AUDIT_TOOL_NAMES.includes(step.tool), `${step.id} calls ${step.tool}, which is not in the audit profile`);
  }
});

test('the registry step passes only on the exact published list, in order', () => {
  const step = stepById('registry');
  assert.equal(judgeStep(step, { tools: [...AUDIT_TOOL_NAMES] }).pass, true);
  // A superset is a FAILURE, not a pass: an audit server publishing a seventh tool is not the
  // artefact that was reviewed, whatever that tool does.
  assert.equal(judgeStep(step, { tools: [...AUDIT_TOOL_NAMES, 'raw_request'] }).pass, false);
  assert.equal(judgeStep(step, { tools: [...AUDIT_TOOL_NAMES].reverse() }).pass, false, 'order is part of the contract');
  assert.equal(judgeStep(step, { tools: [] }).pass, false);
});

test('a tool answering ok:false fails its step and names the code', () => {
  const verdict = judgeStep(stepById('roster'), { ok: false, code: 'TOKEN_EXPIRED' });
  assert.equal(verdict.pass, false);
  assert.match(verdict.detail, /ok:false/);
  assert.equal(verdict.observed.code, 'TOKEN_EXPIRED');
});

test('a log walk that never reached the end of the cursor fails, even with ok:true', () => {
  // THE POINT OF THE WHOLE FILE. `ok:true` is not proof. This judge used to demand a
  // full-binary-tree relation over partition counts — a property that could never hold
  // against the real endpoint, which is why the two window steps were the two the first
  // live canary failed. What it demands now is that the CURSOR WAS FOLLOWED TO EXHAUSTION:
  // a page came back contributing no new ids, so the endpoint had nothing further to give.
  const stalled = healthyWindow({
    pagination: { logPages: { pages: 4, streams: 1, budget: 200, rowsReturned: 400, exhausted: false, terminatedCleanly: false } },
  });
  const verdict = judgeStep(stepById('window-wide'), stalled);
  assert.equal(verdict.pass, false);
  assert.match(verdict.detail, /not walked to the end/);

  const walked = healthyWindow({
    pagination: { logPages: { pages: 4, streams: 1, budget: 200, rowsReturned: 400, exhausted: false, terminatedCleanly: true } },
  });
  assert.equal(judgeStep(stepById('window-wide'), walked).pass, true);
});

test('a window that issued no execution-log page at all fails, on its own merits', () => {
  // `{pages: 0, terminatedCleanly: true}` would sail past the cursor check — a walk that
  // never ran has trivially "not failed to terminate". Only the `pages < 1` guard rejects
  // it, which is what makes that line load-bearing rather than redundant.
  const neverRead = healthyWindow({
    pagination: { logPages: { pages: 0, streams: 0, budget: 200, rowsReturned: 0, exhausted: false, terminatedCleanly: true } },
  });
  const verdict = judgeStep(stepById('window-small'), neverRead);
  assert.equal(verdict.pass, false, 'a window that read no log page cannot pass');
  assert.match(verdict.detail, /no execution-log page/);
});

test('an exhausted page budget PASSES the canary, but only when it also warned', () => {
  // Running out of budget is an honest outcome and a canary that failed on it would be
  // demanding the rail lie about busy workflows. What must NOT pass is pagination and the
  // warning vocabulary disagreeing about whether it happened.
  const spent = { pages: 200, streams: 1, budget: 200, rowsReturned: 20000, exhausted: true, terminatedCleanly: false };
  const honest = healthyWindow({
    complete: false,
    warnings: [{ code: 'LOG_PAGE_BUDGET_EXHAUSTED', component: 'runtime_events', detail: 'x', occurrences: 1, detailSamples: ['x'] }],
    pagination: { logPages: spent },
  });
  assert.equal(judgeStep(stepById('window-wide'), honest).pass, true,
    'reporting an exhausted budget honestly is a pass, not a failure');

  const silent = healthyWindow({ pagination: { logPages: spent } });
  assert.equal(judgeStep(stepById('window-wide'), silent).pass, false,
    'pagination said the budget ran out and the warnings did not — that disagreement must fail');
});

test('a roster claiming complete without reconciling its own total fails', () => {
  const step = stepById('roster');
  const lying = ok({
    complete: true, warnings: [], workflows: [{ _id: 'a' }],
    uniqueCount: 1, reportedTotal: 55,
    envelopeShape: { rowsKeys: ['rows'], totalKeys: ['count'] },
  });
  assert.equal(judgeStep(step, lying).pass, false);

  // The live shape from GROM AU: `{rows, count}`, reconciled.
  const honest = ok({
    complete: true, warnings: [], workflows: [{ _id: 'a' }],
    uniqueCount: 1, reportedTotal: 1,
    envelopeShape: { rowsKeys: ['rows'], totalKeys: ['count'] },
  });
  const verdict = judgeStep(step, honest);
  assert.equal(verdict.pass, true);
  assert.deepEqual(verdict.observed.envelopeShape, { rowsKeys: ['rows'], totalKeys: ['count'] });
});

test('a roster that read no page at all fails rather than passing as empty', () => {
  const unread = ok({ complete: false, warnings: [{ code: 'ROSTER_PAGE_READ_FAILED' }], workflows: null });
  assert.equal(judgeStep(stepById('roster'), unread).pass, false);
});

test('an INCOMPLETE roster still passes when it says why — incompleteness is not failure', () => {
  // The distinction the audit contract rests on: "I could not read all of it, and here is the
  // code" is a correct result. Only a claim the evidence does not support is a failure.
  const incomplete = ok({
    complete: false, warnings: [{ code: 'ROSTER_TOTAL_UNAVAILABLE' }],
    workflows: [{ _id: 'a' }], uniqueCount: 1, reportedTotal: null,
    envelopeShape: { rowsKeys: ['rows'], totalKeys: [] },
  });
  const verdict = judgeStep(stepById('roster'), incomplete);
  assert.equal(verdict.pass, true);
  assert.match(verdict.detail, /incomplete, honestly/);
});

test('the AI bundle fails if any of the three components is missing entirely', () => {
  const step = stepById('ai-bundle');
  const twoOnly = ok({ complete: false, warnings: [], components: { conversation_ai: {}, voice_ai: {} } });
  assert.equal(judgeStep(step, twoOnly).pass, false);

  // The live envelopes: voice answers a bare array (no total), studio `{items, total}`.
  const all = ok({
    complete: true, warnings: [],
    components: {
      conversation_ai: { applicable: true, complete: true, envelopeShape: { rowsKeys: ['employees'], totalKeys: ['totalCount'] } },
      voice_ai: { applicable: true, complete: true, envelopeShape: { rowsKeys: ['<bare-array>'], totalKeys: [] } },
      agent_studio: { applicable: true, complete: true, envelopeShape: { rowsKeys: ['items'], totalKeys: ['total'] } },
    },
  });
  const verdict = judgeStep(step, all);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.observed.components.voice_ai.envelopeShape.rowsKeys[0], '<bare-array>');
});

test('the honest-incompleteness step fails if the rail quietly succeeded', () => {
  const step = stepById('honest-incompleteness');
  // An unsealed step id that produced a COMPLETE window means the seal did not hold.
  assert.equal(judgeStep(step, healthyWindow()).pass, false);

  // Incomplete, but blaming something else — the seal still did not fire.
  const wrongReason = healthyWindow({ complete: false, warnings: [{ code: 'RATE_LIMITED' }] });
  assert.equal(judgeStep(step, wrongReason).pass, false);

  // Incomplete AND named, but published [] for a roster it never read — the forbidden shape.
  const emptyArray = healthyWindow({
    complete: false, warnings: [{ code: 'STEP_ROSTER_UNSEALED' }],
    stepRosters: [{ stepId: 'canary-unsealed-step-id', contacts: [], total: null, complete: false }],
  });
  const bad = judgeStep(step, emptyArray);
  assert.equal(bad.pass, false);
  assert.match(bad.detail, /\[\] instead of null/);

  // The correct behaviour.
  const correct = healthyWindow({
    complete: false, warnings: [{ code: 'STEP_ROSTER_UNSEALED' }],
    stepRosters: [{ stepId: 'canary-unsealed-step-id', contacts: null, total: null, complete: false }],
  });
  assert.equal(judgeStep(step, correct).pass, true);
});

test('enrollments is judged as the OBJECT it is, not the array it looks like', () => {
  // REGRESSION, caught by the first live canary run (GROM AU 2026-07-27). This judge
  // originally asserted `Array.isArray(d.enrollments)` and failed a perfectly healthy run.
  // The contract publishes `{rows, complete, windowScoped, contactFiltered}` on purpose: the
  // walk is always window-scoped, so a bare array invites a reader to compare its length
  // against the ALL-TIME `enrollmentTotals.total` — the one subtraction the collector exists
  // to prevent. The lesson is the general one: a canary judge that asserts a plausible shape
  // instead of the documented one burns the run and blames the server.
  const live = healthyWindow({
    enrollments: { rows: [{ _id: '01KX00WHXPKCJDR1VSD75M5PR3' }], complete: true, windowScoped: true, contactFiltered: false },
    componentCompleteness: { enrollments: true },
  });
  const verdict = judgeStep(stepById('enrollments-and-roster'), live);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.observed.enrollments.rows, 1);
  assert.equal(verdict.observed.enrollments.windowScoped, true);
  assert.match(verdict.detail, /windowScoped/);

  // Still caught: complete:true over an object with no row list is a false claim.
  const noRows = healthyWindow({
    enrollments: { complete: true, windowScoped: true },
    componentCompleteness: { enrollments: true },
  });
  assert.equal(judgeStep(stepById('enrollments-and-roster'), noRows).pass, false);
});

test('enrollments claimed complete but published nothing fails', () => {
  const step = stepById('enrollments-and-roster');
  const lying = healthyWindow({ enrollments: null, componentCompleteness: { enrollments: true } });
  assert.equal(judgeStep(step, lying).pass, false);
  assert.equal(judgeStep(step, healthyWindow()).pass, true);
});

test('the executor runs every step even when one fails, and never throws', async () => {
  // A canary that stopped at the first failure would hide whether the problem was local to one
  // surface or general to the rail — the first question anyone asks about a failed run.
  const calls = [];
  const call = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === null) return { tools: [...AUDIT_TOOL_NAMES] };
    if (tool === 'list_workflows_complete') throw new Error('socket hang up');
    if (tool === 'get_ai_configuration_bundle') return { ok: false, code: 'HTTP_403' };
    return healthyWindow({
      complete: false, warnings: [{ code: 'STEP_ROSTER_UNSEALED' }],
      stepRosters: [{ stepId: 'canary-unsealed-step-id', contacts: null }],
    });
  };
  const steps = await executeCanary(call, INPUT);
  assert.equal(steps.length, 7, 'every step must be attempted');
  assert.equal(calls.length, 7);
  assert.equal(steps.find((s) => s.id === 'roster').pass, false);
  assert.match(steps.find((s) => s.id === 'roster').detail, /transport failed: socket hang up/);
  assert.equal(steps.find((s) => s.id === 'ai-bundle').pass, false);
  assert.equal(steps.find((s) => s.id === 'registry').pass, true, 'a later failure must not retract an earlier pass');
});

test('the executor builds each step arguments from the approved window only', async () => {
  const seen = [];
  await executeCanary(async (tool, args) => {
    seen.push({ tool, args });
    return tool === null ? { tools: [...AUDIT_TOOL_NAMES] } : healthyWindow();
  }, INPUT);
  for (const { tool, args } of seen) {
    if (tool === null) continue;
    assert.equal(args.locationId, INPUT.locationId, 'no step may read another location');
    if (Object.hasOwn(args, 'fromDate')) {
      assert.ok(args.fromDate >= 0 && args.toDate <= INPUT.toDate, 'no step may read outside the approved window');
      assert.ok(args.fromDate < args.toDate, 'every window must stay closed');
    }
  }
});

test('a receipt binds the verdict to the exact artefacts that produced it', async () => {
  const steps = await executeCanary(async (tool) => (
    tool === null ? { tools: [...AUDIT_TOOL_NAMES] } : healthyWindow({
      complete: false, warnings: [{ code: 'STEP_ROSTER_UNSEALED' }],
      stepRosters: [{ stepId: 'canary-unsealed-step-id', contacts: null }],
      workflows: [], uniqueCount: 0, reportedTotal: 0,
      components: { conversation_ai: {}, voice_ai: {}, agent_studio: {} },
    })
  ), INPUT);
  const hashes = artefactHashes();
  const receipt = buildReceipt({ input: INPUT, steps, hashes, stampedAt: '2026-07-27T00:00:00.000Z' });

  // Without these three a receipt could be replayed against a DIFFERENT build, which is the
  // one thing a proof index may never allow.
  assert.match(receipt.artefacts.bundleHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(receipt.artefacts.capabilityManifestHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(receipt.artefacts.toolProfileHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.approver, 'Xander Roque');
  assert.deepEqual(receipt.window, { fromDate: INPUT.fromDate, toDate: INPUT.toDate });
  assert.equal(receipt.stepsTotal, 7);
  assert.ok(['pass', 'partial'].includes(receipt.verdict));
});

test('a receipt with any failed step is partial, never pass', () => {
  const steps = [{ id: 'registry', pass: true }, { id: 'roster', pass: false }];
  const receipt = buildReceipt({ input: INPUT, steps, hashes: artefactHashes(), stampedAt: 'x' });
  assert.equal(receipt.verdict, 'partial');
  assert.equal(receipt.stepsPassed, 1);
});

test('the receipt records no credential, under any key', () => {
  const receipt = buildReceipt({
    input: { ...INPUT }, steps: [{ id: 'registry', pass: true, observed: {} }],
    hashes: artefactHashes(), stampedAt: 'x',
  });
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /ey[A-Za-z0-9._-]{20,}/, 'a receipt must never carry a JWT');
  assert.doesNotMatch(serialized, /Bearer\s/i);
  assert.doesNotMatch(serialized, /token/i, 'no field named for a credential belongs in a receipt');
});
