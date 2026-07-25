// Task 7, offline half: the proof chain that gates a Full audit.
//
// Every test here is a way the chain could say YES when it should say NO. The default answer
// is `partial`, and each assertion below is one route back to that default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  MAX_RECEIPT_AGE_MS,
  PROOF_INDEX_SCHEMA_VERSION,
  attestationHash,
  capabilityDescriptorHash,
  resolveEvidenceClass,
  sha256Of,
  validateAttestation,
  validateProofIndex,
} from '../core/audit-proof.mjs';
import { AUDIT_CAPABILITIES } from '../core/audit-capabilities.mjs';
import { AUDIT_TOOL_NAMES } from '../core/audit-profile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const NOW = Date.parse('2026-07-25T00:00:00.000Z');
const PROFILE_HASH = sha256Of([...AUDIT_TOOL_NAMES]);
const MANIFEST_HASH = sha256Of({ manifest: 'stand-in' });
const BUNDLE_HASH = sha256Of('stand-in-bundle');

const descriptorsById = new Map(AUDIT_CAPABILITIES.map((capability) => [capability.capabilityId, capability]));
const ROSTER = 'workflow_roster_list';
const LOGS = 'workflow_execution_logs';

const makeAttestation = (over = {}) => {
  const base = {
    schemaVersion: '1.0',
    targetHash: sha256Of('pseudonymous-target'),
    approvedWindows: [{ fromDate: 1, toDate: 2 }],
    callTraceHashes: [sha256Of('trace')],
    responseHashes: [sha256Of('response')],
    effectiveLogPageSize: 20,
    reconciliations: { roster: 'ok' },
    toolProfileHash: PROFILE_HASH,
    capabilityManifestHash: MANIFEST_HASH,
    bundleHash: BUNDLE_HASH,
    approver: 'a named human',
    provenAt: '2026-07-24T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
    attestationHash: '',
    ...over,
  };
  base.attestationHash = over.attestationHash ?? attestationHash(base);
  return base;
};

const makeIndex = (receipts) => ({ schemaVersion: PROOF_INDEX_SCHEMA_VERSION, receipts });

const makeReceipt = (capabilityId, attestation, over = {}) => ({
  capabilityId,
  attestationHash: attestation.attestationHash,
  capabilityDescriptorHash: capabilityDescriptorHash(descriptorsById.get(capabilityId)),
  provenAt: attestation.provenAt,
  expiresAt: attestation.expiresAt,
  proofClass: 'live_runtime',
  ...over,
});

const resolve_ = (over = {}) => resolveEvidenceClass({
  applicableCapabilityIds: [ROSTER],
  descriptorsById,
  toolProfileHash: PROFILE_HASH,
  capabilityManifestHash: MANIFEST_HASH,
  bundleHash: BUNDLE_HASH,
  now: NOW,
  ...over,
});

// ---------------------------------------------------------------------------
// the state the repository is actually in
// ---------------------------------------------------------------------------

test('no proof index exists yet, so nothing in this repository can claim Full', () => {
  // The honest starting position. If this ever fails without a canary having run, something
  // has minted a receipt from nothing.
  let present = true;
  try { readFileSync(resolve(ROOT, 'proof/audit-proof-index.json'), 'utf8'); }
  catch { present = false; }
  assert.equal(present, false, 'a proof index exists but no live canary has been approved');

  const verdict = resolve_({ proofIndex: null, attestationsByHash: new Map() });
  assert.equal(verdict.evidenceClass, 'partial');
  assert.deepEqual(verdict.unproven, [ROSTER]);
  assert.deepEqual(verdict.reasons, [`NO_RECEIPT:${ROSTER}`]);
});

// ---------------------------------------------------------------------------
// the happy path, so every refusal below is a real refusal
// ---------------------------------------------------------------------------

test('a complete, unexpired, correctly bound chain resolves to complete_full', () => {
  const attestation = makeAttestation();
  const verdict = resolve_({
    proofIndex: makeIndex([makeReceipt(ROSTER, attestation)]),
    attestationsByHash: new Map([[attestation.attestationHash, attestation]]),
  });
  assert.equal(verdict.evidenceClass, 'complete_full', JSON.stringify(verdict.reasons));
  assert.deepEqual(verdict.proven, [ROSTER]);
  assert.deepEqual(verdict.unproven, []);
});

// ---------------------------------------------------------------------------
// every route back to partial
// ---------------------------------------------------------------------------

test('an unexercised capability gets no receipt, so a run needing it is Partial', () => {
  // The plan's rule: proof of a list route does not prove an unexercised detail route.
  const attestation = makeAttestation();
  const verdict = resolve_({
    applicableCapabilityIds: [ROSTER, LOGS],
    proofIndex: makeIndex([makeReceipt(ROSTER, attestation)]),
    attestationsByHash: new Map([[attestation.attestationHash, attestation]]),
  });
  assert.equal(verdict.evidenceClass, 'partial');
  assert.deepEqual(verdict.proven, [ROSTER]);
  assert.deepEqual(verdict.unproven, [LOGS]);
});

test('an expired receipt cannot support Full', () => {
  const attestation = makeAttestation();
  const verdict = resolve_({
    proofIndex: makeIndex([makeReceipt(ROSTER, attestation, { expiresAt: '2026-07-24T12:00:00.000Z' })]),
    attestationsByHash: new Map([[attestation.attestationHash, attestation]]),
  });
  assert.equal(verdict.evidenceClass, 'partial');
  assert.deepEqual(verdict.reasons, [`RECEIPT_EXPIRED:${ROSTER}`]);
});

test('an offline_contract receipt cannot support Full', () => {
  const attestation = makeAttestation();
  const verdict = resolve_({
    proofIndex: makeIndex([makeReceipt(ROSTER, attestation, { proofClass: 'offline_contract' })]),
    attestationsByHash: new Map([[attestation.attestationHash, attestation]]),
  });
  assert.equal(verdict.evidenceClass, 'partial');
  assert.deepEqual(verdict.reasons, [`NOT_LIVE_PROVEN:${ROSTER}`]);
});

test('a changed descriptor, profile, manifest or bundle invalidates the receipt', () => {
  const attestation = makeAttestation();
  const index = makeIndex([makeReceipt(ROSTER, attestation)]);
  const attestations = new Map([[attestation.attestationHash, attestation]]);

  const descriptorChanged = new Map(descriptorsById);
  descriptorChanged.set(ROSTER, { ...descriptorsById.get(ROSTER), requiredQueryKeys: ['widened'] });
  assert.deepEqual(
    resolve_({ proofIndex: index, attestationsByHash: attestations, descriptorsById: descriptorChanged }).reasons,
    [`DESCRIPTOR_CHANGED:${ROSTER}`],
  );
  assert.deepEqual(
    resolve_({ proofIndex: index, attestationsByHash: attestations, toolProfileHash: sha256Of('other') }).reasons,
    [`PROFILE_CHANGED:${ROSTER}`],
  );
  assert.deepEqual(
    resolve_({ proofIndex: index, attestationsByHash: attestations, capabilityManifestHash: sha256Of('other') }).reasons,
    [`MANIFEST_CHANGED:${ROSTER}`],
  );
  assert.deepEqual(
    resolve_({ proofIndex: index, attestationsByHash: attestations, bundleHash: sha256Of('other') }).reasons,
    [`BUNDLE_CHANGED:${ROSTER}`],
  );
});

test('a tampered attestation is refused even when its receipt looks correct', () => {
  const attestation = makeAttestation();
  const tampered = { ...attestation, effectiveLogPageSize: 100 };   // hash no longer covers it
  const verdict = resolve_({
    proofIndex: makeIndex([makeReceipt(ROSTER, attestation)]),
    attestationsByHash: new Map([[attestation.attestationHash, tampered]]),
  });
  assert.equal(verdict.evidenceClass, 'partial');
  assert.deepEqual(verdict.reasons, [`PROOF_ATTESTATION_TAMPERED:${ROSTER}`]);
});

test('a missing attestation is refused', () => {
  const attestation = makeAttestation();
  const verdict = resolve_({
    proofIndex: makeIndex([makeReceipt(ROSTER, attestation)]),
    attestationsByHash: new Map(),
  });
  assert.deepEqual(verdict.reasons, [`NO_ATTESTATION:${ROSTER}`]);
});

test('a malformed proof index proves nothing at all', () => {
  const attestation = makeAttestation();
  for (const index of [
    { schemaVersion: '9.9', receipts: [] },
    { schemaVersion: PROOF_INDEX_SCHEMA_VERSION, receipts: 'not-an-array' },
    makeIndex([{ capabilityId: ROSTER }]),
    makeIndex([makeReceipt(ROSTER, attestation, { attestationHash: 'not-a-hash' })]),
    makeIndex([makeReceipt(ROSTER, attestation, { proofClass: 'vibes' })]),
  ]) {
    const verdict = resolve_({ proofIndex: index, attestationsByHash: new Map([[attestation.attestationHash, attestation]]) });
    assert.equal(verdict.evidenceClass, 'partial');
    assert.deepEqual(verdict.unproven, [ROSTER], JSON.stringify(index).slice(0, 80));
  }
});

test('two receipts for one capability are refused rather than letting a verifier choose', () => {
  const attestation = makeAttestation();
  assert.throws(
    () => validateProofIndex(makeIndex([makeReceipt(ROSTER, attestation), makeReceipt(ROSTER, attestation)])),
    /PROOF_INDEX_DUPLICATE_RECEIPT/,
  );
});

test('an attestation may not outlive 30 days, and needs a named human approver', () => {
  assert.throws(() => validateAttestation(makeAttestation({
    provenAt: '2026-07-24T00:00:00.000Z', expiresAt: '2026-12-24T00:00:00.000Z',
  })), /PROOF_EXPIRY_TOO_LONG/);
  assert.equal(MAX_RECEIPT_AGE_MS, 30 * 24 * 60 * 60 * 1000);
  assert.throws(() => validateAttestation(makeAttestation({ approver: '   ' })), /PROOF_ATTESTATION_MALFORMED/);
  assert.throws(() => validateAttestation(makeAttestation({ expiresAt: '2026-07-23T00:00:00.000Z' })), /PROOF_ATTESTATION_MALFORMED/);
});

test('resolving without an explicit clock is refused, so nothing can pass by wall-clock luck', () => {
  assert.throws(
    () => resolveEvidenceClass({ applicableCapabilityIds: [ROSTER], descriptorsById, now: undefined }),
    /PROOF_CLOCK_REQUIRED/,
  );
});

test('an empty applicable set is Partial, not vacuously Full', () => {
  const verdict = resolve_({ applicableCapabilityIds: [], proofIndex: null, attestationsByHash: new Map() });
  assert.equal(verdict.evidenceClass, 'partial');
  assert.deepEqual(verdict.reasons, ['NO_APPLICABLE_CAPABILITY']);
});

test('the attestation hash omits itself, so a verifier can recompute it', () => {
  const attestation = makeAttestation();
  const { attestationHash: recorded, ...rest } = attestation;
  assert.equal(recorded, sha256Of(rest));
  assert.equal(attestationHash({ ...rest, attestationHash: 'anything' }), recorded);
});

test('the proof index is NOT bundled and neither artefact carries its hash', () => {
  // Deliberate: a bundle carrying the hash of the proof about itself would let a rebuild
  // re-bless itself. Keeping the index outside means any bundle change invalidates it.
  for (const file of ['dist/audit-server.mjs', 'audit-capability-manifest.json']) {
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    assert.equal(text.includes('audit-proof-index'), false, `${file} references the proof index`);
    assert.equal(text.includes('proofIndexHash'), false, `${file} carries a proof-index hash`);
  }
});

// ---------------------------------------------------------------------------
// the canary runner: dry by default, three independent gates to go live
// ---------------------------------------------------------------------------

test('the canary refuses to run live without every gate, and names all that are missing', async () => {
  const canary = await import('../scripts/audit-canary.mjs');
  const bare = canary.parseCanaryArgs([], {});
  assert.deepEqual(canary.liveBlockers(bare).sort(), [
    'MISSING_APPROVER', 'MISSING_ENV_APPROVAL', 'MISSING_LIVE_FLAG', 'MISSING_LOCATION',
    'MISSING_OR_INVALID_FROM', 'MISSING_OR_INVALID_TO', 'MISSING_WORKFLOW',
  ].sort(), 'a bare invocation must report every missing gate at once, not one at a time');

  const full = ['--live', '--approver', 'a named human', '--location', 'loc-1',
    '--workflow', 'wf-1', '--from', '1000', '--to', '2000'];
  assert.deepEqual(
    canary.liveBlockers(canary.parseCanaryArgs(full, { GHL_AUDIT_CANARY_APPROVED: '1' })), [],
    'the fully-approved shape must be the ONLY one that clears',
  );

  // Each gate removed on its own must still block. One flag is a typo; two flags on one
  // command line are one paste; the env variable is a separate deliberate act.
  assert.deepEqual(canary.liveBlockers(canary.parseCanaryArgs(full, {})), ['MISSING_ENV_APPROVAL']);
  assert.deepEqual(
    canary.liveBlockers(canary.parseCanaryArgs(full.filter((token) => token !== '--live'), { GHL_AUDIT_CANARY_APPROVED: '1' })),
    ['MISSING_LIVE_FLAG'],
  );
  const noApprover = canary.parseCanaryArgs(full, { GHL_AUDIT_CANARY_APPROVED: '1' });
  assert.deepEqual(canary.liveBlockers({ ...noApprover, approver: '  ' }), ['MISSING_APPROVER']);
  // An open or inverted window is not a bounded canary.
  assert.deepEqual(canary.liveBlockers({ ...noApprover, fromDate: 2000, toDate: 2000 }), ['WINDOW_NOT_CLOSED']);
  assert.deepEqual(canary.liveBlockers({ ...noApprover, fromDate: 1.5 }), ['MISSING_OR_INVALID_FROM']);
});

test('the canary dry run makes no network call and states the hashes it would bind', async () => {
  const canary = await import('../scripts/audit-canary.mjs');
  const hashes = canary.artefactHashes();
  for (const value of Object.values(hashes)) assert.match(value, /^sha256:[0-9a-f]{64}$/);
  const text = canary.report(canary.parseCanaryArgs([], {}));
  assert.match(text, /DRY RUN \(no network call will be made\)/);
  assert.match(text, /NOT RUNNING/);
  assert.match(text, /explicit human approval/);
  for (const value of Object.values(hashes)) assert.ok(text.includes(value), 'the report must state the artefact hashes');
  // Every planned step is a read.
  for (const step of canary.CANARY_PLAN) {
    assert.doesNotMatch(step, /\b(write|create|update|delete|publish|edit|POST|PUT|PATCH)\b/i, step);
  }
});
