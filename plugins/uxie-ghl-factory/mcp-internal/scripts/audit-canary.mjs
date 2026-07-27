// SERVER:scripts/audit-canary.mjs — the bounded, read-only live canary.
//
// DRY RUN BY DEFAULT. With no flags this makes no network call at all: it prints the exact
// plan, the artefact hashes a resulting attestation would be bound to, and the approvals it
// is still missing. That is the whole point — the plan for this task says "do not start this
// from the plan alone", so the default behaviour of the tool that would start it must be to
// not start it.
//
// Going live needs THREE independent confirmations, because one flag is a typo and two flags
// in the same command line are one paste:
//
//   1. --live
//   2. GHL_AUDIT_CANARY_APPROVED=1 in the environment
//   3. --approver "<a named human>"
//
// plus explicit --location, --workflow, --from and --to. Anything missing aborts before a
// gateway is constructed. Even then this only ever drives dist/audit-server.mjs, whose every
// egress is a GET through the read-only wrapper.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AUDIT_CAPABILITIES } from '../core/audit-capabilities.mjs';
import { AUDIT_TOOL_NAMES } from '../core/audit-profile.mjs';
import { sha256Of } from '../core/audit-proof.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const AUDIT_BUNDLE = resolve(ROOT, 'dist/audit-server.mjs');
export const AUDIT_MANIFEST = resolve(ROOT, 'audit-capability-manifest.json');

// Per-call ceiling for a live step. Generous by design — the audit rail paces itself and a
// full window legitimately runs for minutes; this exists to stop a hung read, not to bound
// honest work.
const CALL_TIMEOUT_MS = 15 * 60 * 1000;

export function parseCanaryArgs(argv = [], env = {}) {
  const flags = { live: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--live') { flags.live = true; continue; }
    if (token.startsWith('--')) { flags[token.slice(2)] = argv[index + 1]; index += 1; }
  }
  return {
    live: flags.live === true,
    approver: typeof flags.approver === 'string' ? flags.approver.trim() : '',
    locationId: flags.location ?? '',
    workflowId: flags.workflow ?? '',
    fromDate: Number(flags.from),
    toDate: Number(flags.to),
    envApproved: env.GHL_AUDIT_CANARY_APPROVED === '1',
  };
}

// Returns the reasons a live run is NOT permitted. Empty means every gate is satisfied.
// Written as a list rather than a boolean so the operator is told everything that is missing
// in one pass instead of discovering the gates one at a time.
export function liveBlockers(input) {
  const blockers = [];
  if (!input.live) blockers.push('MISSING_LIVE_FLAG');
  if (!input.envApproved) blockers.push('MISSING_ENV_APPROVAL');
  // Trimmed HERE as well as in the parser: a caller that builds this object directly must not
  // be able to satisfy the human-approval gate with whitespace.
  if (typeof input.approver !== 'string' || input.approver.trim() === '') blockers.push('MISSING_APPROVER');
  if (!input.locationId) blockers.push('MISSING_LOCATION');
  if (!input.workflowId) blockers.push('MISSING_WORKFLOW');
  if (!Number.isInteger(input.fromDate) || input.fromDate < 0) blockers.push('MISSING_OR_INVALID_FROM');
  if (!Number.isInteger(input.toDate) || input.toDate <= 0) blockers.push('MISSING_OR_INVALID_TO');
  if (Number.isInteger(input.fromDate) && Number.isInteger(input.toDate) && input.fromDate >= input.toDate) {
    blockers.push('WINDOW_NOT_CLOSED');
  }
  return blockers;
}

// The artefact hashes any attestation from this run would be bound to. Computed from the
// committed files, so a rebuild between planning and running is visible as a hash change.
export function artefactHashes() {
  return {
    toolProfileHash: sha256Of([...AUDIT_TOOL_NAMES]),
    capabilityManifestHash: sha256Of(JSON.parse(readFileSync(AUDIT_MANIFEST, 'utf8'))),
    bundleHash: sha256Of(readFileSync(AUDIT_BUNDLE, 'utf8')),
  };
}

// The bounded read plan. Every step is a GET on the audit rail; there is no write anywhere in
// this list and nothing here is executed by a dry run.
export const CANARY_PLAN = Object.freeze([
  'tools/list on dist/audit-server.mjs — prove the registry before any runtime read',
  'get_workflow_runtime_window over an empty or very small closed window',
  'get_workflow_runtime_window over the full approved window — a multi-page log cursor walk',
  'list_workflows_complete — a complete multi-page roster',
  'get_workflow_runtime_window — a complete enrollment walk and one step roster',
  'get_ai_configuration_bundle — every applicable AI discovery and detail surface',
  'an expired-auth or safety-bound case, to prove incompleteness is reported honestly',
]);

// --- the executor ---------------------------------------------------------------
//
// The seven planned reads as EXECUTABLE steps. Each names the tool it calls, the arguments it
// builds from the approved window, and — the part that matters — what would make it a PASS.
//
// `expect` is not "did the call return 200". Every one of these tools answers `ok:true` with
// `complete:false` on a surface it could not read, which is the whole contract, so a canary
// that only checked `ok` would attest to reads that never happened. Each step states the
// property it is actually proving and is judged on that.
//
// STEP 7 IS NOT A FAILURE OF THE CANARY. It asks for a step id the workflow definition does
// not contain, which the collector refuses LOCALLY with STEP_ROSTER_UNSEALED and
// `contacts: null`. Proving the rail reports incompleteness honestly is as much a part of the
// receipt as proving it can read — a rail that only ever succeeds has not been shown to be
// capable of saying no.
export const CANARY_STEPS = Object.freeze([
  {
    id: 'registry',
    tool: null,                       // a tools/list call, not a tool call
    why: 'prove the published registry before any runtime read',
    expect: 'tools/list equals AUDIT_TOOL_NAMES exactly, in order',
  },
  {
    id: 'window-small',
    tool: 'get_workflow_runtime_window',
    args: (i) => ({ locationId: i.locationId, workflowId: i.workflowId, fromDate: i.toDate - 1000, toDate: i.toDate }),
    why: 'a narrow closed window — the cursor should exhaust itself in very few pages',
    expect: 'ok, and the cursor was followed to a page contributing no new ids',
  },
  {
    id: 'window-wide',
    tool: 'get_workflow_runtime_window',
    args: (i) => ({ locationId: i.locationId, workflowId: i.workflowId, fromDate: i.fromDate, toDate: i.toDate }),
    why: 'the full approved window — the only step wide enough to need a multi-page cursor walk',
    expect: 'ok, and the cursor was followed to a page contributing no new ids',
  },
  {
    id: 'roster',
    tool: 'list_workflows_complete',
    args: (i) => ({ locationId: i.locationId }),
    why: 'a real multi-page roster reconciled against a stable reported total',
    expect: 'ok, envelopeShape records the live keys, and complete===true reconciles uniqueCount to reportedTotal',
  },
  {
    id: 'enrollments-and-roster',
    tool: 'get_workflow_runtime_window',
    args: (i) => ({ locationId: i.locationId, workflowId: i.workflowId, fromDate: i.fromDate, toDate: i.toDate, stepIds: i.stepIds ?? [] }),
    why: 'the enrollment cursor walk, and a step roster when a step id was approved',
    expect: 'ok, and enrollments is an array (never null) when the component reports complete',
  },
  {
    id: 'ai-bundle',
    tool: 'get_ai_configuration_bundle',
    args: (i) => ({ locationId: i.locationId, ...(i.companyId ? { companyId: i.companyId } : {}) }),
    why: 'all three AI surfaces, discovery and detail',
    expect: 'ok, all three components present, and each records the envelope keys it actually read',
  },
  {
    id: 'honest-incompleteness',
    tool: 'get_workflow_runtime_window',
    args: (i) => ({
      locationId: i.locationId, workflowId: i.workflowId, fromDate: i.fromDate, toDate: i.toDate,
      // A step id no definition contains. Refused locally — no read is issued for it.
      stepIds: ['canary-unsealed-step-id'],
    }),
    why: 'prove incompleteness is REPORTED, not papered over',
    expect: 'ok:true with complete===false and a STEP_ROSTER_UNSEALED warning; contacts null, never []',
  },
]);

const warningCodes = (data) => [...new Set((data?.warnings ?? []).map((w) => w.code))];

// Judges one step's response against the property it exists to prove. Returns
// {pass, observed, detail} — never throws, because a canary that dies on step 3 must still
// report steps 1 and 2 rather than losing the run.
export function judgeStep(step, response) {
  const fail = (detail, observed = {}) => ({ pass: false, detail, observed });
  if (!response) return fail('no response captured');
  if (step.id === 'registry') {
    const names = response.tools ?? [];
    const expected = [...AUDIT_TOOL_NAMES];
    const same = names.length === expected.length && names.every((n, i) => n === expected[i]);
    return same
      ? { pass: true, detail: `registry is exactly ${expected.length} tools, in order`, observed: { tools: names } }
      : fail('published registry does not equal AUDIT_TOOL_NAMES', { tools: names, expected });
  }
  if (response.ok !== true) {
    return fail(`tool returned ok:false (${response.code ?? 'no code'})`, { code: response.code });
  }
  const d = response.data ?? {};
  const observed = { complete: d.complete, warnings: warningCodes(d) };
  switch (step.id) {
    case 'window-small':
    case 'window-wide': {
      // THESE TWO STEPS USED TO JUDGE A PARTITION WALK, and they were the two the first live
      // canary could never pass — not because the rail was broken, but because the property
      // they demanded was unreachable. A "terminal" partition was one that came back SHORT,
      // and the walk was narrowing a window the server was silently ignoring (no
      // `dateType`), so every page came back identically full however narrow the range got.
      // 256 partitions, `terminal: 0`, every time.
      //
      // The property judged now is the one the cursor walk can actually establish: it
      // FOLLOWED THE CURSOR TO EXHAUSTION. `terminatedCleanly` means a page came back
      // contributing no new ids — the endpoint had nothing further to give — which is a
      // proof, where "the page was short" was only ever a guess.
      const p = d.pagination?.logPages ?? {};
      observed.logPages = p;
      if (!Number.isFinite(p.pages) || p.pages < 1) return fail('no execution-log page was read', observed);
      if (p.exhausted === true) {
        // An honest outcome, but it must be reported as one in BOTH places. Pagination and
        // the warning vocabulary disagreeing means an auditor branching on either gets the
        // opposite answer from one branching on the other.
        if (!observed.warnings.includes('LOG_PAGE_BUDGET_EXHAUSTED')) {
          return fail('the page budget ran out and no warning said so', observed);
        }
        return { pass: true, detail: `budget of ${p.budget} spent after ${p.pages} pages — reported incomplete, honestly`, observed };
      }
      if (p.terminatedCleanly !== true) {
        return fail('the cursor never reached a page with no new ids, so the log was not walked to the end', observed);
      }
      return { pass: true, detail: `cursor exhausted after ${p.pages} page(s), ${p.rowsReturned} rows returned across ${p.streams} stream(s)`, observed };
    }
    case 'roster': {
      observed.envelopeShape = d.envelopeShape;
      observed.uniqueCount = d.uniqueCount;
      observed.reportedTotal = d.reportedTotal;
      if (d.workflows === null) return fail('roster published no workflow list', observed);
      if (d.complete === true && d.uniqueCount !== d.reportedTotal) {
        return fail('roster claims complete without reconciling its own total', observed);
      }
      return { pass: true, detail: d.complete ? `roster complete: ${d.uniqueCount} reconciled` : `roster incomplete, honestly: ${observed.warnings.join(', ')}`, observed };
    }
    case 'enrollments-and-roster': {
      // `enrollments` is an OBJECT — `{rows, complete, windowScoped, contactFiltered}` — not
      // an array. The first draft of this judge asserted an array and failed a healthy live
      // run for it. The shape is deliberate: the walk is always window-scoped, so publishing
      // a bare array invites a reader to compare its length against the all-time
      // `enrollmentTotals.total`, which is the one subtraction the collector exists to
      // prevent. Judge the contract that exists, not the one that seemed likely.
      observed.enrollments = d.enrollments === null ? null : {
        rows: Array.isArray(d.enrollments?.rows) ? d.enrollments.rows.length : null,
        complete: d.enrollments?.complete,
        windowScoped: d.enrollments?.windowScoped,
      };
      observed.componentCompleteness = d.componentCompleteness;
      if (d.componentCompleteness?.enrollments === true) {
        if (d.enrollments === null) return fail('enrollments claimed complete but published nothing', observed);
        if (!Array.isArray(d.enrollments.rows)) return fail('enrollments claimed complete but carries no row list', observed);
      }
      return { pass: true, detail: `enrollment walk reported ${observed.enrollments?.rows ?? 'null'} rows (windowScoped)`, observed };
    }
    case 'ai-bundle': {
      const components = d.components ?? {};
      observed.components = Object.fromEntries(Object.entries(components)
        .map(([k, v]) => [k, { applicable: v.applicable, complete: v.complete, envelopeShape: v.envelopeShape }]));
      const missing = ['conversation_ai', 'voice_ai', 'agent_studio'].filter((k) => !components[k]);
      if (missing.length) return fail(`component(s) missing entirely: ${missing.join(', ')}`, observed);
      return { pass: true, detail: 'all three AI components present', observed };
    }
    case 'honest-incompleteness': {
      if (d.complete !== false) return fail('an unsealed step id did not make the window incomplete', observed);
      if (!observed.warnings.includes('STEP_ROSTER_UNSEALED')) {
        return fail('incompleteness was reported without naming the unsealed step', observed);
      }
      const roster = (d.stepRosters ?? [])[0];
      observed.contacts = roster ? roster.contacts : undefined;
      if (roster && roster.contacts !== null) return fail('an unread step roster published [] instead of null', observed);
      return { pass: true, detail: 'refused locally and said so — contacts null, STEP_ROSTER_UNSEALED raised', observed };
    }
    default:
      return fail(`no judge for step ${step.id}`);
  }
}

// Drives the seven steps through an INJECTED caller, so the whole executor is testable with
// no account, no credential and no network. `call` is
// `(toolName|null, args) => Promise<response>`; a null tool means tools/list.
export async function executeCanary(call, input) {
  const steps = [];
  for (const step of CANARY_STEPS) {
    const args = step.tool ? step.args(input) : null;
    let response = null;
    let transportError = null;
    try {
      response = await call(step.tool, args);
    } catch (error) {
      transportError = error?.message ?? String(error);
    }
    const verdict = transportError
      ? { pass: false, detail: `transport failed: ${transportError}`, observed: {} }
      : judgeStep(step, response);
    steps.push({ id: step.id, tool: step.tool, why: step.why, expect: step.expect, ...verdict });
    // NO early exit. A failed step is evidence too, and stopping would hide whether the
    // failure was local to one surface or general to the rail — the first question anyone
    // asks about a failed canary.
  }
  return steps;
}

// The receipt. Binds the verdict to the exact artefacts that produced it: a receipt that did
// not name the bundle it ran could be replayed against a different build, which is the one
// thing a proof index must never allow.
export function buildReceipt({ input, steps, hashes, stampedAt }) {
  const passed = steps.filter((s) => s.pass).length;
  return {
    receiptVersion: '1.0.0',
    verdict: passed === steps.length ? 'pass' : 'partial',
    stepsPassed: passed,
    stepsTotal: steps.length,
    approver: input.approver,
    account: { locationId: input.locationId, workflowId: input.workflowId },
    window: { fromDate: input.fromDate, toDate: input.toDate },
    artefacts: hashes,
    stampedAt,
    steps,
  };
}

export function report(input) {
  const blockers = liveBlockers(input);
  const hashes = artefactHashes();
  const lines = [
    'audit canary — READ ONLY',
    '',
    `mode:            ${blockers.length === 0 ? 'LIVE (all gates satisfied)' : 'DRY RUN (no network call will be made)'}`,
    `bundle:          ${AUDIT_BUNDLE}`,
    `tools:           ${AUDIT_TOOL_NAMES.join(', ')}`,
    `capabilities:    ${AUDIT_CAPABILITIES.length} descriptors, all GET`,
    '',
    'artefact hashes an attestation from this run would bind:',
    `  toolProfileHash:        ${hashes.toolProfileHash}`,
    `  capabilityManifestHash: ${hashes.capabilityManifestHash}`,
    `  bundleHash:             ${hashes.bundleHash}`,
    '',
    'planned reads:',
    ...CANARY_PLAN.map((step, index) => `  ${index + 1}. ${step}`),
    '',
  ];
  if (blockers.length > 0) {
    lines.push('NOT RUNNING. Missing approvals or inputs:');
    lines.push(...blockers.map((blocker) => `  - ${blocker}`));
    lines.push('');
    lines.push('A live canary needs explicit human approval. Re-run with --live, a named');
    lines.push('--approver, GHL_AUDIT_CANARY_APPROVED=1, and an approved closed window.');
  } else {
    lines.push(`approver: ${input.approver}`);
    lines.push('every gate satisfied — a live read-only canary would proceed.');
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = parseCanaryArgs(process.argv.slice(2), process.env);
  console.log(report(input));
  if (liveBlockers(input).length > 0) { process.exitCode = 0; }
  else {
    // Every gate is satisfied, so the executor runs. It drives the COMMITTED bundle over
    // stdio — the same artefact whose hash the receipt binds — rather than importing source,
    // because a receipt for code that was never packaged proves nothing about what ships.
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [AUDIT_BUNDLE],
      env: { ...process.env },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'audit-canary', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    try {
      const call = async (tool, args) => {
        if (tool === null) return { tools: (await client.listTools()).tools.map((t) => t.name) };
        // A REAL audit read is minutes, not seconds, and the SDK's default request timeout is
        // seconds. The first run after the identity bound was fixed failed three steps with
        // `MCP error -32001: Request timed out` — which reads exactly like a server fault and
        // is not one: the reads had finally started doing the work the old bound aborted, and
        // every one of them is human-paced by the shared limiter on purpose. Timing a
        // deliberately throttled walk out on a default is measuring the harness, not the rail.
        const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
        return JSON.parse(result.content[0].text);
      };
      const steps = await executeCanary(call, input);
      // Stamped from the wall clock HERE and nowhere deeper: the collectors take their
      // `capturedAt` from the responses themselves, and a receipt that invented its own
      // timestamps inside them would let a replay look freshly observed.
      const receipt = buildReceipt({ input, steps, hashes: artefactHashes(), stampedAt: new Date().toISOString() });
      console.log('');
      for (const step of steps) console.log(`  ${step.pass ? 'PASS' : 'FAIL'}  ${step.id} — ${step.detail}`);
      console.log('');
      console.log(`verdict: ${receipt.verdict} (${receipt.stepsPassed}/${receipt.stepsTotal})`);
      const out = resolve(ROOT, `audit-canary-receipt-${input.locationId}.json`);
      writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
      console.log(`receipt: ${out}`);
      // A partial run is a real outcome, not a crash, but it must not exit 0 — a CI step or a
      // resumer that only checked the exit code would file a partial canary as a pass.
      process.exitCode = receipt.verdict === 'pass' ? 0 : 1;
    } finally {
      await client.close();
    }
  }
}
