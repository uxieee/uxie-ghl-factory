// The proof chain that decides whether an audit may claim Full evidence.
//
// Nothing in this file mints a receipt. It defines the chain, verifies it, and answers one
// question for the weekly auditor: does every capability this run needs hold an unexpired
// receipt bound to the artefacts that actually ran? The answer defaults to no.
//
// The chain is ACYCLIC and each link is a hash of the thing before it:
//
//   descriptors + profile  ->  manifestHash        (audit-capability-manifest.json)
//   manifest               ->  bundleHash          (dist/audit-server.mjs)
//   bundle + manifest      ->  attestationHash     (an immutable canary attestation)
//   attestationHash        ->  proof index entries (one per capability EXERCISED)
//
// The proof index is deliberately NOT bundled, and neither the manifest nor the bundle
// carries its hash. A bundle that contained the hash of the proof about itself would let a
// rebuild silently re-bless itself; keeping the index outside means any bundle-affecting
// change invalidates every receipt bound to the old bundle, which is the intended behaviour.
import { createHash } from 'node:crypto';

export const PROOF_INDEX_SCHEMA_VERSION = '1.0';

// A receipt is worth nothing after this, no matter how clean the canary was. Thirty days is
// the plan's ceiling: an account's entitlements, agent roster and rate limits all drift, and
// a proof of "this route answered in this shape" ages with them.
export const MAX_RECEIPT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// What a canary observed. `live_runtime` is the only class that can support a Full audit;
// `offline_contract` is what every capability holds today.
export const PROOF_CLASSES = Object.freeze(['live_runtime', 'offline_contract']);

const proofError = (code, detail) => {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
};

export const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

export const sha256Of = (value) => `sha256:${createHash('sha256').update(
  typeof value === 'string' ? value : JSON.stringify(canonical(value)),
).digest('hex')}`;

const HASH = /^sha256:[0-9a-f]{64}$/;
const isHash = (value) => typeof value === 'string' && HASH.test(value);
const isIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
  && /^\d{4}-\d{2}-\d{2}T/.test(value);

// An attestation is immutable evidence of ONE bounded canary run. Its own hash is what the
// proof index points at, so it is computed over the attestation with `attestationHash`
// omitted — a hash covering its own placeholder could never be recomputed by a verifier.
export function attestationHash(attestation) {
  const { attestationHash: _omitted, ...rest } = attestation;
  return sha256Of(rest);
}

const ATTESTATION_FIELDS = Object.freeze([
  'schemaVersion', 'targetHash', 'approvedWindows', 'callTraceHashes', 'responseHashes',
  'effectiveLogPageSize', 'reconciliations', 'toolProfileHash', 'capabilityManifestHash',
  'bundleHash', 'approver', 'provenAt', 'expiresAt', 'attestationHash',
]);

export function validateAttestation(attestation) {
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    throw proofError('PROOF_ATTESTATION_MALFORMED', 'an attestation must be an object');
  }
  const keys = Object.keys(attestation).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...ATTESTATION_FIELDS].sort())) {
    throw proofError('PROOF_ATTESTATION_MALFORMED',
      `attestation fields drifted: expected ${[...ATTESTATION_FIELDS].sort().join(',')}`);
  }
  for (const field of ['targetHash', 'toolProfileHash', 'capabilityManifestHash', 'bundleHash', 'attestationHash']) {
    if (!isHash(attestation[field])) {
      throw proofError('PROOF_ATTESTATION_MALFORMED', `${field} must be a sha256 digest`);
    }
  }
  // The target is recorded as a PSEUDONYMOUS HASH and as provenance only. A canary proves a
  // route answered in a shape; naming the account in a durable artefact would put a client
  // identifier into a file whose whole purpose is to be copied around and diffed.
  for (const field of ['provenAt', 'expiresAt']) {
    if (!isIso(attestation[field])) throw proofError('PROOF_ATTESTATION_MALFORMED', `${field} must be an ISO timestamp`);
  }
  if (typeof attestation.approver !== 'string' || attestation.approver.trim() === '') {
    throw proofError('PROOF_ATTESTATION_MALFORMED', 'an attestation needs a named human approver');
  }
  const provenAt = Date.parse(attestation.provenAt);
  const expiresAt = Date.parse(attestation.expiresAt);
  if (expiresAt <= provenAt) throw proofError('PROOF_ATTESTATION_MALFORMED', 'expiresAt must follow provenAt');
  if (expiresAt - provenAt > MAX_RECEIPT_AGE_MS) {
    throw proofError('PROOF_EXPIRY_TOO_LONG', `an attestation may not outlive ${MAX_RECEIPT_AGE_MS} ms`);
  }
  if (attestation.attestationHash !== attestationHash(attestation)) {
    throw proofError('PROOF_ATTESTATION_TAMPERED', 'attestationHash does not cover this attestation');
  }
  return attestation;
}

const ENTRY_FIELDS = Object.freeze([
  'capabilityId', 'attestationHash', 'capabilityDescriptorHash', 'provenAt', 'expiresAt', 'proofClass',
]);

export function validateProofIndex(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    throw proofError('PROOF_INDEX_MALFORMED', 'a proof index must be an object');
  }
  if (index.schemaVersion !== PROOF_INDEX_SCHEMA_VERSION) {
    throw proofError('PROOF_INDEX_MALFORMED', `unknown proof-index schemaVersion ${index.schemaVersion}`);
  }
  if (!Array.isArray(index.receipts)) throw proofError('PROOF_INDEX_MALFORMED', 'receipts must be an array');
  const seen = new Set();
  for (const entry of index.receipts) {
    if (!entry || typeof entry !== 'object') throw proofError('PROOF_INDEX_MALFORMED', 'a receipt must be an object');
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...ENTRY_FIELDS].sort())) {
      throw proofError('PROOF_INDEX_MALFORMED', `receipt fields drifted for ${entry.capabilityId}`);
    }
    if (typeof entry.capabilityId !== 'string' || entry.capabilityId === '') {
      throw proofError('PROOF_INDEX_MALFORMED', 'a receipt needs a capabilityId');
    }
    // One receipt per capability. Two receipts for one capability would let a verifier pick
    // whichever still happens to be unexpired, which is choosing the answer.
    if (seen.has(entry.capabilityId)) {
      throw proofError('PROOF_INDEX_DUPLICATE_RECEIPT', `${entry.capabilityId} has more than one receipt`);
    }
    seen.add(entry.capabilityId);
    for (const field of ['attestationHash', 'capabilityDescriptorHash']) {
      if (!isHash(entry[field])) throw proofError('PROOF_INDEX_MALFORMED', `${entry.capabilityId}.${field} must be a sha256 digest`);
    }
    for (const field of ['provenAt', 'expiresAt']) {
      if (!isIso(entry[field])) throw proofError('PROOF_INDEX_MALFORMED', `${entry.capabilityId}.${field} must be ISO`);
    }
    if (!PROOF_CLASSES.includes(entry.proofClass)) {
      throw proofError('PROOF_INDEX_MALFORMED', `${entry.capabilityId} has unknown proofClass ${entry.proofClass}`);
    }
  }
  return index;
}

// Hash one descriptor exactly as the manifest row does, so a receipt is bound to the policy
// that was actually enforced rather than to a capability NAME that could be redefined.
export function capabilityDescriptorHash(descriptor) {
  return sha256Of(descriptor);
}

/**
 * The only question this module exists to answer.
 *
 * Returns `{ evidenceClass, proven, unproven, reasons }` where `evidenceClass` is
 * `complete_full` only when EVERY applicable capability holds an unexpired `live_runtime`
 * receipt whose attestation is valid and bound to the exact artefacts supplied. Anything
 * else is `partial`. There is no path to `complete_full` through an absent receipt, an
 * expired one, a wrong hash, or a proof index that fails validation.
 */
export function resolveEvidenceClass({
  applicableCapabilityIds,
  descriptorsById,
  proofIndex,
  attestationsByHash,
  toolProfileHash,
  capabilityManifestHash,
  bundleHash,
  now,
}) {
  const reasons = [];
  const proven = [];
  const unproven = [];
  const at = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(at)) throw proofError('PROOF_CLOCK_REQUIRED', 'resolveEvidenceClass needs an explicit clock');

  const applicable = [...new Set(applicableCapabilityIds ?? [])];
  if (applicable.length === 0) {
    // No capability applicable means nothing was read, which cannot be a Full audit either.
    return { evidenceClass: 'partial', proven, unproven, reasons: ['NO_APPLICABLE_CAPABILITY'] };
  }

  let index = null;
  try {
    index = validateProofIndex(proofIndex ?? { schemaVersion: PROOF_INDEX_SCHEMA_VERSION, receipts: [] });
  } catch (error) {
    // A malformed index proves nothing at all; every capability is unproven.
    return {
      evidenceClass: 'partial',
      proven,
      unproven: applicable,
      reasons: [error.code],
    };
  }

  const receiptFor = new Map(index.receipts.map((entry) => [entry.capabilityId, entry]));
  for (const capabilityId of applicable) {
    const entry = receiptFor.get(capabilityId);
    if (!entry) { unproven.push(capabilityId); reasons.push(`NO_RECEIPT:${capabilityId}`); continue; }
    if (entry.proofClass !== 'live_runtime') {
      unproven.push(capabilityId); reasons.push(`NOT_LIVE_PROVEN:${capabilityId}`); continue;
    }
    if (Date.parse(entry.expiresAt) <= at) {
      unproven.push(capabilityId); reasons.push(`RECEIPT_EXPIRED:${capabilityId}`); continue;
    }
    const descriptor = descriptorsById?.get?.(capabilityId) ?? descriptorsById?.[capabilityId];
    if (!descriptor) { unproven.push(capabilityId); reasons.push(`NO_DESCRIPTOR:${capabilityId}`); continue; }
    if (entry.capabilityDescriptorHash !== capabilityDescriptorHash(descriptor)) {
      // The descriptor changed since the canary. The receipt attests to a policy that is no
      // longer the one being enforced, so it attests to nothing about this run.
      unproven.push(capabilityId); reasons.push(`DESCRIPTOR_CHANGED:${capabilityId}`); continue;
    }
    const attestation = attestationsByHash?.get?.(entry.attestationHash) ?? attestationsByHash?.[entry.attestationHash];
    if (!attestation) { unproven.push(capabilityId); reasons.push(`NO_ATTESTATION:${capabilityId}`); continue; }
    try { validateAttestation(attestation); }
    catch (error) { unproven.push(capabilityId); reasons.push(`${error.code}:${capabilityId}`); continue; }
    if (attestation.attestationHash !== entry.attestationHash) {
      unproven.push(capabilityId); reasons.push(`ATTESTATION_MISBOUND:${capabilityId}`); continue;
    }
    if (Date.parse(attestation.expiresAt) <= at) {
      unproven.push(capabilityId); reasons.push(`ATTESTATION_EXPIRED:${capabilityId}`); continue;
    }
    // The three artefact links. Any drift in the profile, the manifest or the bundle means
    // the thing that was canaried is not the thing that ran.
    if (attestation.toolProfileHash !== toolProfileHash) {
      unproven.push(capabilityId); reasons.push(`PROFILE_CHANGED:${capabilityId}`); continue;
    }
    if (attestation.capabilityManifestHash !== capabilityManifestHash) {
      unproven.push(capabilityId); reasons.push(`MANIFEST_CHANGED:${capabilityId}`); continue;
    }
    if (attestation.bundleHash !== bundleHash) {
      unproven.push(capabilityId); reasons.push(`BUNDLE_CHANGED:${capabilityId}`); continue;
    }
    proven.push(capabilityId);
  }

  return {
    evidenceClass: unproven.length === 0 ? 'complete_full' : 'partial',
    proven,
    unproven,
    reasons,
  };
}
