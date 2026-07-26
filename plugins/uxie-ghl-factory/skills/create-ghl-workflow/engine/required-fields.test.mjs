// Required-field enforcement for the conversationai_* family.
//
// The defect these cover: a flow bot built with minimal attributes reported
//   authored: 9, compiled: 14, steps: 14, verify: { pass: 14, issues: [] }, warnings: []
// while the builder showed "Resolve 7 Errors" and refused to publish it. Seven of the
// nine node types carry fields the builder treats as required and the engine neither
// defaulted nor demanded. Live-mapped on AU wdzEoUZnXO9tB3PPzcot 2026-07-25.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { CATALOG_CORRECTIONS, REQUIRED_FIELDS, enforceRequiredFields, requiredKeysFor, isSupplied } from './required-fields.mjs';
import CATALOG_DATA from './catalog.data.json' with { type: 'json' };

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog() });
const flowTrigger = { ref: 't', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [], convTriggerBotId: 'AGENT1' };

const build = (node) => compile(
  { name: 'X', workflowType: 'agent', triggers: [flowTrigger], graph: [{ ref: 'n', kind: 'action', ...node }] },
  ctx(),
).autoSaveBody.workflowData.templates;
const attrsOf = (node) => build(node).find((s) => s.type === node.type).attributes;
const throws = (node, code) => assert.throws(() => build(node), (e) => e.code === code, `expected ${code}`);

// --- the three defaultable fields ------------------------------------------------

test('ai_message: omitted waitForReply is DEFAULTED, not left for the builder to reject', () => {
  const a = attrsOf({ type: 'conversationai_ai_message', name: 'Ask', attributes: { message: 'hi' } });
  assert.equal(a.waitForReply, true);
});

test('custom_message: omitted waitForReply is defaulted too', () => {
  const a = attrsOf({ type: 'conversationai_custom_message', name: 'Say', attributes: { message: 'hi' } });
  assert.equal(a.waitForReply, true);
});

// The requirement is PRESENCE, not truthiness — live-proven: "waitForReply: false is
// accepted and satisfies the requirement". An authored false must survive, not be
// overwritten by the default.
test('waitForReply:false is honoured — the requirement is presence, not truthiness', () => {
  const a = attrsOf({ type: 'conversationai_ai_message', name: 'Ask', attributes: { message: 'hi', waitForReply: false } });
  assert.equal(a.waitForReply, false);
});

test('ai_splitter: omitted description falls back to the node name', () => {
  const t = build({ type: 'conversationai_ai_splitter', name: 'Route by intent',
    branches: [{ name: 'A', then: [] }] });
  assert.equal(t.find((s) => s.type === 'conversationai_ai_splitter').attributes.description, 'Route by intent');
});

test('ai_splitter: an UNNAMED node has nothing to derive a description from and is rejected', () => {
  // Defaulting to '' here would just re-create the defect — an empty description is
  // exactly what the builder rejects.
  assert.throws(
    () => compile({ name: 'X', workflowType: 'agent', triggers: [flowTrigger],
      graph: [{ ref: 'n', kind: 'action', type: 'conversationai_ai_splitter', branches: [{ name: 'A', then: [] }] }] }, ctx()),
    (e) => e.code === 'REQUIRED_FIELD' && /description/.test(e.message));
});

test('end: omitted sleepEnabled is defaulted to the no-op value', () => {
  const a = attrsOf({ type: 'conversationai_end', name: 'End', attributes: {} });
  assert.equal(a.sleepEnabled, false);
});

// --- the three that cannot be defaulted ------------------------------------------

test('book_appointment without calendarId is a hard error, not an undefined attribute', () => {
  throws({ type: 'conversationai_book_appointment', name: 'Book', attributes: {} }, 'REQUIRED_FIELD');
});

test('book_appointment WITH calendarId still compiles', () => {
  const a = attrsOf({ type: 'conversationai_book_appointment', name: 'Book', attributes: { calendarId: 'CAL1' } });
  assert.equal(a.calendarId, 'CAL1');
});

test('transfer_bot without assignedEmployeeId is a hard error', () => {
  throws({ type: 'conversationai_transfer_bot', name: 'Hand over', attributes: {} }, 'REQUIRED_FIELD');
});

test('services_booking without services is a hard error naming the precondition', () => {
  assert.throws(
    () => build({ type: 'conversationai_services_booking', name: 'Book service', attributes: { description: 'd' } }),
    (e) => e.code === 'REQUIRED_FIELD' && /commerce service/.test(e.message),
    'the error must say the account needs a configured commerce service');
});

// --- the two attested-clean types -------------------------------------------------

test('objective and continue require nothing — they are attested clean', () => {
  assert.deepEqual(requiredKeysFor('conversationai_objective'), []);
  assert.deepEqual(requiredKeysFor('conversationai_continue'), []);
  assert.equal(attrsOf({ type: 'conversationai_objective', name: 'Ask', attributes: { objective: 'find out' } }).objective, 'find out');
  assert.deepEqual(attrsOf({ type: 'conversationai_continue', name: 'Continue', attributes: {} }).__customInputs__, {});
});

// --- conversationai_end's corrected key names -------------------------------------

test('end: the WRONG documented keys are now rejected instead of silently persisting', () => {
  // Authoring `reactivate:false` was accepted and persisted as an unknown key while the
  // actually-required sleepEnabled stayed unset — the node kept its error badge and
  // nothing in the pipeline said so.
  assert.throws(
    () => build({ type: 'conversationai_end', name: 'End', attributes: { customMessage: 'bye', reactivate: false, duration: 1 } }),
    (e) => e.code === 'ATTR_KEY' && /sleepEnabled/.test(e.message),
    'the error must point at the real key names');
});

test('end: sleepEnabled:true without its schedule halves is rejected', () => {
  throws({ type: 'conversationai_end', name: 'End', attributes: { sleepEnabled: true } }, 'REQUIRED_FIELD');
  const a = attrsOf({ type: 'conversationai_end', name: 'End',
    attributes: { message: '', sleepEnabled: true, sleepDuration: 1, sleepUnit: 'hours' } });
  assert.equal(a.sleepUnit, 'hours');
});

// --- the overlay itself ------------------------------------------------------------

// A correction that the generator has since started emitting itself is dead weight that
// silently shadows real data. Fail loudly so it gets deleted rather than rotting.
test('every catalog correction is still NEEDED (the generated data still disagrees)', () => {
  for (const [type, fix] of Object.entries(CATALOG_CORRECTIONS)) {
    const generated = CATALOG_DATA.steps[type];
    assert.ok(generated, `${type} vanished from the generated catalog — revisit this correction`);
    assert.ok(fix.reason, `${type} correction must carry a reason`);
    const { reason, ...patch } = fix;
    const stillDiffers = Object.entries(patch).some(([k, v]) =>
      JSON.stringify(generated[k]) !== JSON.stringify(v));
    assert.ok(stillDiffers,
      `the generated catalog now matches the ${type} correction — DELETE it from CATALOG_CORRECTIONS`);
  }
});

test('corrections reach the compiler through loadCatalog, not just the raw JSON', () => {
  const c = loadCatalog();
  assert.deepEqual(c.step('conversationai_end').attrKeys,
    ['message', 'sleepEnabled', 'sleepDuration', 'sleepUnit', 'type', '__customInputs__']);
  assert.equal(c.step('conversationai_end').confidence, 'verified-live');
  assert.deepEqual(c.step('conversationai_continue').attrKeys, ['type', '__customInputs__']);
  assert.ok(!c.step('conversationai_transfer_bot').attrKeys.includes('prompt'));
  // the attested set is surfaced separately from the generated advisory one
  assert.deepEqual(c.step('conversationai_book_appointment').attestedRequiredFields, ['calendarId']);
});

// The whole reason enforcement is NOT driven off the generated `requiredFields`.
test('the generated requiredFields stays ADVISORY — enforcing it would reject every goto', () => {
  const goto = loadCatalog().step('goto');
  assert.deepEqual(goto.requiredFields, ['placement', 'targetNodeId'],
    'generated (marketplace-schema) set, kept for query-catalog display');
  assert.ok(!goto.attrKeys.includes('placement'),
    'placement is not in the emitted shape — enforcing the generated set would break goto');
  assert.equal(goto.attestedRequiredFields, undefined, 'goto has no attested set, so nothing is enforced');
});

test('all nine conversationai_* types are mapped — an absent entry means "not yet mapped"', () => {
  const inCatalog = loadCatalog().allSteps().filter((t) => t.startsWith('conversationai_'));
  assert.equal(inCatalog.length, 9);
  for (const t of inCatalog) assert.ok(REQUIRED_FIELDS[t], `${t} is unmapped in REQUIRED_FIELDS`);
});

// --- unit-level helpers -------------------------------------------------------------

test('enforceRequiredFields does not mutate the caller attrs', () => {
  const attrs = { message: 'hi' };
  const out = enforceRequiredFields({ type: 'conversationai_ai_message', ref: 'n' }, attrs);
  assert.equal(attrs.waitForReply, undefined);
  assert.equal(out.waitForReply, true);
});

test('an unmapped type passes through untouched', () => {
  const attrs = { body: 'x' };
  assert.equal(enforceRequiredFields({ type: 'sms', ref: 'n' }, attrs), attrs);
});

test('isSupplied applies presence vs non-empty per field', () => {
  assert.equal(isSupplied('conversationai_ai_message', 'waitForReply', { waitForReply: false }), true);
  assert.equal(isSupplied('conversationai_ai_message', 'waitForReply', {}), false);
  assert.equal(isSupplied('conversationai_ai_splitter', 'description', { description: '  ' }), false);
  assert.equal(isSupplied('conversationai_services_booking', 'services', { services: [] }), false);
});
