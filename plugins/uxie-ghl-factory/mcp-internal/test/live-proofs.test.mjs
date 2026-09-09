import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_SURFACES, PROOFS, selectProofs, tail4, parseSummary } from '../../../../scripts/run-live-proofs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '../../../../scripts/run-live-proofs.mjs');

// The live proofs are the only thing that can catch a SERVER-SIDE behaviour change: every other
// test in this repo runs against fixtures and would pass on the day GHL changed an endpoint. These
// tests are about the runner's guards, because the runner writes to a live account.

test('there is NO default location — the account must be named by the caller', () => {
  // A default is how a scheduled job eventually runs against a client. This asserts the absence of
  // one, which is the part a test can actually settle.
  //
  // It deliberately does NOT shape-match for a location id. The first version of this test flagged
  // `surfacesWithNoLiveProof` — a 22-character identifier — because GHL ids and long camelCase
  // names are the same shape, and this project has already been burned by exactly that heuristic.
  // Hard-coded real ids are the repo privacy gate's job (scripts/check-privacy.mjs, which runs in
  // pretest over every file including this one) and it matches known values, not shapes.
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /GHL_LIVE_PROOF_LOCATION/, 'the location comes from the environment');
  assert.ok(!/GHL_LIVE_PROOF_LOCATION\s*(\?\?|\|\|)/.test(src), 'there must be NO default location');
  assert.match(src, /deliberately no default/, 'and the refusal must say why, not just fail');
});

test('a location is redacted to its last four characters', () => {
  // Enough to tell two accounts apart in a log; not enough to be one.
  assert.equal(tail4('rW9hsvyrwCgaaySWzn6B'), '…zn6B');
  assert.equal(tail4('abcd'), '…abcd');
  assert.equal(tail4('abc'), null);
  assert.equal(tail4(null), null);
});

test('every registered proof asserts EFFECTS, and declares what it creates', () => {
  // A suite that only checks for a 200 would report green on exactly the failure this exists to
  // catch, so the registry records what each one does rather than assuming.
  assert.ok(PROOFS.length >= 1);
  for (const p of PROOFS) {
    assert.ok(p.name && p.script, 'a proof needs a name and a script');
    assert.ok(Array.isArray(p.surfaces) && p.surfaces.length, `${p.name} names no surface`);
    assert.equal(typeof p.creates, 'boolean', `${p.name} does not say whether it creates objects`);
    assert.equal(typeof p.tearsDown, 'boolean', `${p.name} does not say whether it tears down`);
    // Nothing is deleted is the standing rule; a suite that creates and does NOT tear down has to
    // say so, so the operator knows artifacts are accumulating on the test account.
    if (p.creates && !p.tearsDown) assert.ok(p.note, `${p.name} creates and never tears down — it must say so`);
  }
});

test('--only selects by name and REFUSES an unknown one', () => {
  // Silently running nothing because of a typo is the worst outcome: it looks like a clean run.
  assert.deepEqual(selectProofs('memberships').map((p) => p.name), ['memberships']);
  assert.equal(selectProofs(null).length, PROOFS.length);
  const bad = selectProofs('membershipz');
  assert.ok(bad.error);
  assert.match(bad.error, /unknown proof/);
  assert.match(bad.error, /Known: /, 'it names the valid ones rather than just refusing');
});

test('the suite summary is parsed, and SKIPS are kept separate from passes', () => {
  // The 4 skips are the member-session writes that cannot run unattended. Folding them into
  // "passed" would overstate coverage on every receipt, every month, forever.
  assert.deepEqual(parseSummary('RESULT: 22 passed, 0 failed, 4 skipped (member-side, unattendable)'),
    { passed: 22, failed: 0, skipped: 4 });
  assert.deepEqual(parseSummary('11 passed, 2 failed'), { passed: 11, failed: 2, skipped: null });
});

test('an unparseable summary is null, never a zero', () => {
  // `?? 0` here would turn "the suite printed nothing we understood" into "0 failures", which is a
  // green receipt for a run nobody verified.
  assert.equal(parseSummary('the suite crashed before printing anything'), null);
  assert.equal(parseSummary(''), null);
  assert.equal(parseSummary(undefined), null);
});

test('the receipt records what is NOT proven, and derives it so it cannot contradict the registry', () => {
  // A receipt showing only what passed reads as a clean bill of health for the whole product, so
  // every receipt has to state the gap. This was a hand-written array until 2026-09-10, when the
  // funnels suite landed and a receipt printed `covered: funnels` while STILL listing funnels as
  // unproven — a report contradicting its own coverage. It is derived from the registry now.
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /surfacesWithNoSuite/, 'the receipt must say which surfaces have no suite at all');
  assert.match(src, /surfacesNotProvenThisRun/, '"no suite exists" and "not exercised today" are different claims');
  assert.ok(!/surfacesWithNoLiveProof:\s*\[/.test(src),
    'the uncovered list must be DERIVED from PROOFS, never re-hardcoded — that is what drifted');

  assert.ok(ALL_SURFACES.length >= 12, `the denominator must be the real surface list, got ${ALL_SURFACES.length}`);
  const covered = new Set(PROOFS.flatMap((p) => p.surfaces ?? []));
  const noSuite = ALL_SURFACES.filter((sf) => !covered.has(sf));
  assert.ok(noSuite.length >= 10, `expected the real gap to be recorded, got ${noSuite.length}`);
  assert.ok(noSuite.includes('workflows'), 'the largest surface has no conformance suite and must be listed');
  for (const sf of covered) {
    assert.ok(ALL_SURFACES.includes(sf), `${sf} is claimed by a suite but is not in ALL_SURFACES — the denominator is wrong`);
    assert.ok(!noSuite.includes(sf), `${sf} is both proven and listed as unproven`);
  }
});

