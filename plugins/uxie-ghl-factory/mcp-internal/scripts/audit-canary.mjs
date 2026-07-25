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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AUDIT_CAPABILITIES } from '../core/audit-capabilities.mjs';
import { AUDIT_TOOL_NAMES } from '../core/audit-profile.mjs';
import { sha256Of } from '../core/audit-proof.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const AUDIT_BUNDLE = resolve(ROOT, 'dist/audit-server.mjs');
export const AUDIT_MANIFEST = resolve(ROOT, 'audit-capability-manifest.json');

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
  'get_workflow_runtime_window over a window requiring multiple log time partitions',
  'list_workflows_complete — a complete multi-page roster',
  'get_workflow_runtime_window — a complete enrollment walk and one step roster',
  'get_ai_configuration_bundle — every applicable AI discovery and detail surface',
  'an expired-auth or safety-bound case, to prove incompleteness is reported honestly',
]);

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
  // Deliberately does NOT execute the live plan yet. Wiring the executor is the second half
  // of Task 7 and must not land before a human has approved a specific account and window;
  // shipping a runnable one now would mean the only thing standing between this repository
  // and a live account is a flag nobody has reviewed.
  if (liveBlockers(input).length === 0) {
    console.log('');
    console.log('The live executor is intentionally not wired yet. Approve the canary first.');
  }
  process.exitCode = 0;
}
