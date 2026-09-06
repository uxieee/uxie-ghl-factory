import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firedEnforcement, missingRequiredFields } from './orchestrate.mjs';
import { loadCatalog } from './catalog.mjs';

// Round-trip verify used to ask only `requiredKeysFor`, which knows NINE types — all
// conversationai_*, each one paid for with a live probe. The compiler meanwhile refuses 69 types
// against `enforcement`, replayed from GHL's own publish validators. So verify could return
// {pass:N, issues:[]} for a step the builder renders with a red badge, on any of the sixty types
// the attested table has never heard of. These pin the second question being asked.

const catalog = loadCatalog();
// `allSteps()` is the type-key list; `step(type)` is the entry. There is no `.steps` map — reading
// one made two of these assertions vacuously true on an empty object.
const ALL_TYPES = catalog.allSteps();

test('the attested table really does cover only the nine conversationai types', () => {
  // Not a nicety: it is the reason the enforcement replay exists. If this ever grows, the note in
  // orchestrate.mjs is stale and should be rewritten rather than quietly left behind.
  const covered = ALL_TYPES.filter((t) => missingRequiredFields({ type: t, attributes: {} }).length);
  assert.ok(covered.length <= 9, `attested required-field coverage grew to ${covered.length}: ${covered.join(', ')}`);
  assert.ok(covered.every((t) => t.startsWith('conversationai_')), covered.join(', '));
});

test('a stored step that trips GHL\'s own guard is reported, on a type the attested table never heard of', () => {
  // create_opportunity carries GHL's mined `pipeline_required` guard and is NOT in the attested
  // table — exactly the blind spot.
  const step = { type: 'create_opportunity', id: 'x', name: 'Create', attributes: { type: 'create_opportunity', opportunity_name: 'Deal' } };
  assert.deepEqual(missingRequiredFields(step), [], 'the attested table is blind to this, which is the point');
  const fired = firedEnforcement(step, catalog);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].field, 'pipeline_id');
  assert.match(fired[0].guard, /pipeline_id/);
});

test('a complete stored step fires nothing', () => {
  const step = { type: 'create_opportunity', id: 'x', name: 'Create',
    attributes: { type: 'create_opportunity', pipeline_id: 'P', pipeline_stage_id: 'S' } };
  assert.deepEqual(firedEnforcement(step, catalog), []);
});

test('a type with no enforcement block is silent, not a crash', () => {
  assert.deepEqual(firedEnforcement({ type: 'internal_create_opportunity', attributes: {} }, catalog), []);
  assert.deepEqual(firedEnforcement({ type: 'not_a_real_type', attributes: {} }, catalog), []);
  assert.deepEqual(firedEnforcement({ type: 'create_opportunity', attributes: {} }, null), []);
});

test('warn-tier guards never become verify issues — they are compile-time advice', () => {
  // Only the throw tier is replayed. A warn rule firing here would turn a build that GHL accepts
  // into a reported issue, which is how a verifier trains people to ignore it.
  const withWarnRules = ALL_TYPES
    .filter((t) => { const m = catalog.step(t); return m?.enforcement?.warn?.length && !m?.enforcement?.throw?.length; });
  assert.ok(withWarnRules.length > 0, 'no warn-only types found — this test would be vacuous');
  for (const type of withWarnRules) {
    assert.deepEqual(firedEnforcement({ type, attributes: {} }, catalog), [], `${type} warn rules leaked into verify`);
  }
});

test('the replay covers far more types than the attested table', () => {
  const withThrow = ALL_TYPES.filter((t) => catalog.step(t)?.enforcement?.throw?.length).length;
  assert.ok(withThrow >= 40, `expected the mined throw tier to cover dozens of types, found ${withThrow}`);
});
