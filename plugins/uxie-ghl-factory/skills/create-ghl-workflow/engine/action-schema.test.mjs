// Validation against GHL's OWN action schema.
//
// The fixture is a real slice of
// `GET /workflows-marketplace/location/{loc}/assets?workflowTypes=default,contacts`
// captured from AU 2026-07-27 — 11 actions, unmodified field definitions. Using the real
// payload shape matters: the response nests actions under actions[].actions[] (apps, then
// their actions), and field defaults arrive as STRINGS regardless of declared type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActionSchema, missingForStep, checkWorkflow, defaultsFor,
  checkWorkflowOffline, fetchActionSchema } from './action-schema.mjs';
import ASSETS from './fixtures/action-schema.sample.json' with { type: 'json' };

const schema = parseActionSchema(ASSETS);
const step = (type, attributes, name = 'n', id = 's1') => ({ id, name, type, attributes });

test('parses the app-nested payload into a flat type -> spec map', () => {
  assert.ok(schema.size >= 11, `expected >=11 actions, got ${schema.size}`);
  assert.ok(schema.has('conversationai_ai_message'));
  assert.ok(schema.has('contact_engagement_score'));
});

// 🔴 The boundary that stops this being oversold. The marketplace catalog does NOT carry
// the core native actions most workflows are built from — they live in the OG/bundle
// registry, which catalog.data.json already covers. Absent here means "not described by
// this source", NOT "has no required fields", so unknown types must be SKIPPED.
test('native actions are NOT in this catalog — skip them, never infer they are clean', () => {
  for (const native of ['add_contact_tag', 'send_email', 'sms', 'if_else', 'wait', 'custom_webhook']) {
    assert.equal(schema.has(native), false, `${native} unexpectedly present — re-check the coverage claim`);
    // and a step of that type must produce no findings rather than a false all-clear
    assert.deepEqual(checkWorkflow([step(native, {})], schema), []);
  }
});

test('reads the required set straight from GHL, matching the hand-mapped one', () => {
  assert.deepEqual(schema.get('conversationai_ai_message').requiredFields, ['message', 'waitForReply']);
  assert.deepEqual(schema.get('conversationai_end').requiredFields, ['sleepEnabled']);
  assert.deepEqual(schema.get('conversationai_book_appointment').requiredFields, ['calendarId']);
  assert.deepEqual(schema.get('conversationai_transfer_bot').requiredFields, ['assignedEmployeeId']);
  assert.deepEqual(schema.get('conversationai_continue').requiredFields, []);
});

// The whole point: coverage beyond the nine types anyone mapped by hand.
test('covers ordinary actions the hand-written map never knew about', () => {
  assert.deepEqual(schema.get('contact_engagement_score').requiredFields, ['operator', 'points']);
  assert.ok(schema.get('task-notification').requiredFields.includes('title'));
  assert.equal(checkWorkflowOffline([step('contact_engagement_score', {})]).length, 0,
    'the offline map is blind to this type — which is exactly why the live schema matters');
  assert.equal(checkWorkflow([step('contact_engagement_score', {})], schema).length, 1);
});

test('DYNAMIC is excluded — it is a UI pseudo-field, not an attribute', () => {
  for (const spec of schema.values()) {
    assert.ok(!spec.fields.some((f) => f.field === 'DYNAMIC'), `${spec.type} leaked DYNAMIC`);
  }
  // conversationai_end's raw inputs DO contain it; the parser must drop it.
  const raw = ASSETS.actions.flatMap((a) => a.actions).find((a) => a.key === 'conversationai_end');
  assert.ok(raw.inputs.some((f) => f.field === 'DYNAMIC'), 'fixture should still contain the pseudo-field');
});

// --- the error list ------------------------------------------------------------------

test('phrases errors exactly as the builder does, from the field title', () => {
  const errs = missingForStep(step('conversationai_custom_message', { message: 'hi' }), schema);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].field, 'waitForReply');
  assert.equal(errs[0].message, '"Wait for contact reply" is a required field');
});

// Reproduces the live case: workflow 85190383 on AU, whose builder shows
// Resolve 1 Errors → "Verbatim note" → "Wait for contact reply" is a required field.
test('reproduces the live builder error list for the known-broken workflow', () => {
  const templates = [
    step('conversationai_objective', { objective: 'find out' }, 'Capture treatment interest', 'a1'),
    step('conversationai_custom_message', { message: 'Offer', waitForReply: true }, 'Offer to book', 'b2'),
    step('conversationai_custom_message', { message: 'One moment while I check the diary.' }, 'Verbatim note', 'd72645f1-848a-4535-b6e7-f00e381c5181'),
  ];
  const errs = checkWorkflow(templates, schema);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].step, 'Verbatim note');
  assert.equal(errs[0].stepId, 'd72645f1-848a-4535-b6e7-f00e381c5181');
  assert.deepEqual(errs[0].messages, ['"Wait for contact reply" is a required field']);
});

test('empty counts as missing, not just absent', () => {
  assert.equal(checkWorkflow([step('conversationai_ai_splitter', { description: '   ' })], schema).length, 1);
  assert.equal(checkWorkflow([step('conversationai_ai_splitter', { description: 'route by intent' })], schema).length, 0);
});

test('a healthy workflow produces no errors', () => {
  assert.deepEqual(checkWorkflow([
    step('conversationai_ai_message', { message: 'hi', waitForReply: true }),
    step('conversationai_end', { sleepEnabled: true, sleepDuration: 1, sleepUnit: 'hours' }),
  ], schema), []);
});

test('an unknown type is skipped, never guessed at', () => {
  assert.deepEqual(checkWorkflow([step('some_future_action', {})], schema), []);
});

// --- defaults ------------------------------------------------------------------------

test("defaults come from GHL's own `value`, coerced by fieldType", () => {
  // checkbox default arrives as the STRING "true"
  assert.deepEqual(defaultsFor('conversationai_ai_message', schema, { message: 'hi' }), { waitForReply: true });
  assert.equal(defaultsFor('conversationai_end', schema, {}).sleepEnabled, true);
});

test('an authored value is never overwritten by the default', () => {
  assert.deepEqual(defaultsFor('conversationai_ai_message', schema, { message: 'hi', waitForReply: false }), {});
});

// --- trigger compatibility (the schema's other check) ---------------------------------

test('requiredTriggers catches a step that cannot run under the workflow trigger', () => {
  const t = [step('conversationai_ai_message', { message: 'hi', waitForReply: true })];
  assert.deepEqual(schema.get('conversationai_ai_message').requiredTriggers, ['conv_ai_autonomous_trigger', 'conv_ai_trigger']);
  assert.equal(checkWorkflow(t, schema, { triggerTypes: ['conv_ai_trigger'] }).length, 0);
  const bad = checkWorkflow(t, schema, { triggerTypes: ['contact_tag'] });
  assert.equal(bad.length, 1);
  assert.match(bad[0].messages[0], /requires one of these triggers/);
});

// --- fetch failure must never break a build -------------------------------------------

test('fetchActionSchema returns null instead of throwing when the call fails', async () => {
  assert.equal(await fetchActionSchema(async () => ({ ok: false }), 'LOC'), null);
  assert.equal(await fetchActionSchema(async () => { throw new Error('network'); }, 'LOC'), null);
  assert.equal(await fetchActionSchema(async () => ({ ok: true, json: { actions: [] } }), 'LOC'), null);
});

test('fetchActionSchema parses a good response', async () => {
  const s = await fetchActionSchema(async (m, p) => {
    assert.equal(m, 'GET');
    assert.match(p, /^\/workflows-marketplace\/location\/LOC\/assets\?workflowTypes=default,contacts$/);
    return { ok: true, json: ASSETS };
  }, 'LOC');
  assert.ok(s.size >= 11);
});
