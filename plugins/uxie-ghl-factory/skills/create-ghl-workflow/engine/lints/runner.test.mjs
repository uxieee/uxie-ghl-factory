// RC-F: check_workflow ran ONE lint layer (the marketplace action schema) while the build path ran
// about ten, so recon on a live account found nothing that only the build path checks. A client
// shipped a literal {{appointment.date}} for three weeks under a clean check_workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLints } from './runner.mjs';
import { loadDoctrinePack } from './doctrine.mjs';
import { loadCatalog } from '../catalog.mjs';

const catalog = loadCatalog();
const doc = () => ({
  templates: [
    { id: 'g', type: 'goto', name: 'Dead jump', next: null, parentKey: null, order: 0, attributes: { type: 'goto', targetNodeId: 'ghost' } },
    { id: 's', type: 'sms', name: 'Text', next: null, parentKey: null, order: 1, attributes: { body: 'See you {{appointment.date}}' } },
    { id: 'n', type: 'internal_notification', name: 'Ping', next: 'r1', parentKey: null, order: 2, attributes: { type: 'notification', notification: { body: 'b', title: 't', userType: 'all' } } },
    { id: 'r1', type: 'remove_from_workflow', name: 'R1', next: 'r2', parentKey: 'n', order: 3, attributes: {} },
    { id: 'r2', type: 'remove_from_workflow', name: 'R2', next: null, parentKey: 'r1', order: 4, attributes: {} },
  ],
  triggers: [],
});
const rules = (list) => list.map((f) => f.rule).sort();

test('platform carries the dead goto and the invented merge tag as ERRORS; hygiene carries the rest as warnings', () => {
  const r = runLints(doc(), { catalog });
  assert.ok(r.platform.some((f) => f.rule === 'dangling-ref' && f.severity === 'error'));
  assert.ok(r.platform.some((f) => f.rule === 'merge-tag' && f.severity === 'error' && /appointment\.date/.test(f.msg)));
  assert.deepEqual(rules(r.hygiene), ['notification-no-redirect', 'remove-chain']);
  assert.ok(r.hygiene.every((f) => f.severity === 'warning'));
});

test('packs are selectable: platform alone runs no hygiene', () => {
  const r = runLints(doc(), { catalog, packs: ['platform'] });
  assert.deepEqual(r.hygiene, []);
  assert.ok(r.platform.length > 0);
});

test('a doctrine pack states CLIENT policy the engine never defines', () => {
  const { rules: pack, errors } = loadDoctrinePack({ requireRedirectPage: true, sendWindow: { start: '08:00', end: '18:00' } });
  assert.deepEqual(errors, []);
  const r = runLints(doc(), { catalog, packs: ['doctrine'], doctrinePack: pack });
  assert.ok(r.doctrine.some((f) => f.rule === 'requireRedirectPage' && f.severity === 'error'),
    'the same shape hygiene only warns about is an ERROR when the account requires it');

  const late = { templates: [{ id: 'w', type: 'wait', name: 'W', attributes: { type: 'time', window: { condition: 'when', start: '06:00', end: '22:00' } } }] };
  const w = runLints(late, { catalog, packs: ['doctrine'], doctrinePack: pack });
  assert.ok(w.doctrine.some((f) => f.rule === 'sendWindow' && /06:00-22:00/.test(f.msg)));
});

test('a malformed doctrine pack reports WHY rather than silently doing nothing', () => {
  assert.deepEqual(loadDoctrinePack('{not json').rules, null);
  assert.match(loadDoctrinePack('{not json').errors[0], /not valid JSON/);
  assert.match(loadDoctrinePack({ sendWindow: { start: '8am', end: '6pm' } }).errors[0], /HH:MM/);
  const r = runLints(doc(), { catalog, packs: ['doctrine'] });
  assert.deepEqual(r.doctrine, []);
  assert.ok(r.notEvaluable.some((x) => /no pack supplied/.test(x)));
});

test('"could not look" is never reported as "nothing found"', () => {
  const r = runLints(doc(), { catalog: null });
  assert.ok(r.notEvaluable.some((x) => /workflowRules \(no catalog/.test(x)));
  assert.ok(r.notEvaluable.some((x) => /mergeTags \(no catalog/.test(x)));
  assert.deepEqual(r.platform.filter((f) => f.rule === 'merge-tag'), [], 'no catalog means no merge-tag verdict at all');
});

// Live: a manual-call saved with assignedUser:'' / standardAssignedUser:'' is still QUEUED by GHL
// and the contact waits behind it indefinitely — an unassigned manual task is parked, not skipped.
// Two contacts sat on one for hours, receiving none of the sends below it. GHL has no validator
// for this shape (catalog: steps['manual-call'].enforcement.provenZero = "no-ghl-validator").
test('an unassigned manual task warns; assigning either user field silences it', () => {
  const manual = (attrs, type = 'manual-call') => ({ templates: [
    { id: 'm', type, name: 'Call task', next: null, parentKey: null, order: 0, attributes: attrs },
  ], triggers: [] });

  for (const [attrs, type] of [
    [{ assignedUser: '', standardAssignedUser: '' }, 'manual-call'],
    [{}, 'manual-sms'],
    [{ assignedUser: '', standardAssignedUser: '' }, 'manual_call'],
    [{ assignedUser: '' }, 'manual_sms'],
  ]) {
    const r = runLints(manual(attrs, type), { catalog, packs: ['hygiene'] });
    const hit = r.hygiene.find((f) => f.rule === 'manual-task-unassigned');
    assert.ok(hit, `${type} ${JSON.stringify(attrs)} must fire`);
    assert.equal(hit.severity, 'warning');
    assert.match(hit.msg, /waits behind it indefinitely/);
  }

  for (const attrs of [
    { assignedUser: 'user_1', standardAssignedUser: '' },
    { assignedUser: '', standardAssignedUser: 'user_1' },
  ]) {
    const r = runLints(manual(attrs), { catalog, packs: ['hygiene'] });
    assert.deepEqual(r.hygiene.filter((f) => f.rule === 'manual-task-unassigned'), [],
      `assigned ${JSON.stringify(attrs)} must stay silent`);
  }
});

// Two clean-room fixtures: conversationai_book_appointment has no field for WHICH appointment it
// acts on, and its measured defaults are wrong both ways — it offered to move an already-attended
// visit to times that had already passed, and with three future bookings it silently picked the
// soonest and never asked. Both were closed purely by wording in promptInstructions, so a stock
// or empty promptInstructions ships those defaults.
test('a book-appointment with stock or empty promptInstructions warns; real steering wording is silent', () => {
  const book = (attrs) => ({ templates: [
    { id: 'b', type: 'conversationai_book_appointment', name: 'Book appt', next: null, parentKey: null, order: 0, attributes: attrs },
  ], triggers: [] });

  for (const attrs of [
    { calendarId: 'CAL' },
    { calendarId: 'CAL', promptInstructions: '' },
    { calendarId: 'CAL', promptInstructions: '   ' },
    { calendarId: 'CAL', promptInstructions: 'Get the customer to book an appointment' },
  ]) {
    const r = runLints(book(attrs), { catalog, packs: ['hygiene'] });
    const hit = r.hygiene.find((f) => f.rule === 'book-appointment-unsteered');
    assert.ok(hit, `${JSON.stringify(attrs)} must fire`);
    assert.equal(hit.severity, 'warning');
    // the message must name BOTH measured defaults and point at promptInstructions as the fix
    assert.match(hit.msg, /already pass/);
    assert.match(hit.msg, /soonest/);
    assert.match(hit.msg, /promptInstructions/);
  }

  const r = runLints(book({ calendarId: 'CAL',
    promptInstructions: 'Only act on the next UPCOMING confirmed appointment; if there are several, ask which one first.' }),
  { catalog, packs: ['hygiene'] });
  assert.deepEqual(r.hygiene.filter((f) => f.rule === 'book-appointment-unsteered'), []);
});

// Live (2026-08-30/31): in a flow bot a GLOBAL prohibition did not reach a node whose local
// instruction implied a narrower job — a medical-handover node produced the exact sentences the
// global prompt banned twice. The fix was a frozen behavioural block appended to every speaking
// node, and the audit then found FOUR variants of that block across 13 continue nodes. A rule
// meant to be constant must be repeated byte-identically: variation invites the model to read the
// differences as meaningful.
const RULE_A = 'Never state or imply that the patient has been seen by a doctor today.';
const RULE_B = 'Always confirm the callback number before ending the conversation.';
const BLOCK = `${RULE_A} ${RULE_B}`;
const RULE_A_VARIANT = 'Never state or imply that the patient has been seen by a nurse today.';
const drift = (r) => r.hygiene.filter((f) => f.rule === 'flow-bot-rules-drift');
const speak = (id, instructions, type = 'conversationai_continue') => ({
  id, type, name: `Node ${id}`, next: null, parentKey: null, order: 0,
  attributes: { instructions },
});
const flow = (...templates) => ({ templates, triggers: [] });

test('flow-bot-rules-drift: a one-word VARIANT of a shared rule sentence warns once, naming the node and both sentences', () => {
  const r = runLints(flow(
    speak('a', `Greet the caller by name. ${BLOCK}`),
    speak('b', `Take the reason for the call. ${BLOCK}`),
    speak('c', `Collect the best callback time. ${BLOCK}`),
    speak('d', `Hand over to the clinic. ${RULE_A_VARIANT} ${RULE_B}`),
  ), { catalog, packs: ['hygiene'] });
  const hits = drift(r);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  const [hit] = hits;
  assert.equal(hit.severity, 'warning');
  assert.equal(hit.stepId, 'd');
  assert.match(hit.msg, /^'Node d' carries a VARIANT of a rule sentence that 3 other node\(s\) carry verbatim/);
  assert.ok(hit.msg.includes('seen by a doctor today'), 'names the verbatim sentence');
  assert.ok(hit.msg.includes('seen by a nurse today'), 'names the variant');
  assert.match(hit.msg, /byte-identical/);
});

test('flow-bot-rules-drift: a speaking node that carries NONE of a core rule block warns once, aggregated', () => {
  const r = runLints(flow(
    speak('a', `Greet the caller by name. ${BLOCK}`),
    speak('b', `Take the reason for the call. ${BLOCK}`),
    speak('c', `Collect the best callback time. ${BLOCK}`),
    speak('d', 'Help the caller reschedule their consultation with the specialist team.'),
  ), { catalog, packs: ['hygiene'] });
  const hits = drift(r);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  const [hit] = hits;
  assert.equal(hit.severity, 'warning');
  assert.equal(hit.stepId, 'd');
  assert.match(hit.msg, /^'Node d' \(conversationai_continue\) carries none of 2 behavioural rule sentence\(s\) the other speaking nodes share/);
  assert.match(hit.msg, /narrower job/);
  assert.match(hit.msg, /byte-identically, with its positive half/);
});

test('flow-bot-rules-drift: byte-identical blocks everywhere are silent', () => {
  const r = runLints(flow(
    speak('a', `Greet the caller by name. ${BLOCK}`),
    speak('b', `Take the reason for the call. ${BLOCK}`),
    speak('c', `Collect the best callback time. ${BLOCK}`),
    speak('d', `Hand over to the clinic. ${BLOCK}`),
  ), { catalog, packs: ['hygiene'] });
  assert.deepEqual(drift(r), []);
});

test('flow-bot-rules-drift: one speaking node has nothing to compare against', () => {
  const r = runLints(flow(speak('a', `Greet the caller by name. ${BLOCK}`)), { catalog, packs: ['hygiene'] });
  assert.deepEqual(drift(r), []);
});

test('flow-bot-rules-drift: conversationai_custom_message is sent VERBATIM to the lead, so it is neither inspected nor counted', () => {
  const custom = (id, message) => ({ id, type: 'conversationai_custom_message', name: `Custom ${id}`,
    next: null, parentKey: null, order: 0, attributes: { message } });
  // a variant of the block in a custom message would be a VARIANT hit if the node were inspected
  const variant = runLints(flow(
    speak('a', `Greet the caller by name. ${BLOCK}`),
    speak('b', `Take the reason for the call. ${BLOCK}`),
    custom('x', `${RULE_A_VARIANT} ${RULE_B}`),
  ), { catalog, packs: ['hygiene'] });
  assert.deepEqual(drift(variant), []);
  // a custom message WITHOUT the block would be a "carries none" hit if the node were counted
  // (2 of 3 speaking nodes would make the block core)
  const absent = runLints(flow(
    speak('a', `Greet the caller by name. ${BLOCK}`),
    speak('b', `Take the reason for the call. ${BLOCK}`),
    custom('x', 'Thanks for calling, we will be in touch shortly.'),
  ), { catalog, packs: ['hygiene'] });
  assert.deepEqual(drift(absent), []);
  // and a custom message never lifts the speaking count to two on its own
  const alone = runLints(flow(
    speak('a', `Greet the caller by name. ${BLOCK}`),
    custom('x', `Hand over to the clinic. ${RULE_A_VARIANT} ${RULE_B}`),
  ), { catalog, packs: ['hygiene'] });
  assert.deepEqual(drift(alone), []);
});

test('flow-bot-rules-drift: sentences under 40 characters are not rules', () => {
  const r = runLints(flow(
    speak('a', 'Be warm. Be brief. Ask for the callback number.'),
    speak('b', 'Be warm. Be brief. Ask for the callback number.'),
    speak('c', 'Be warm. Be kind. Ask for the callback time.'),
    speak('d', 'Greet the caller.'),
  ), { catalog, packs: ['hygiene'] });
  assert.deepEqual(drift(r), []);
});

test('flow-bot-rules-drift: every speaking type is read from ITS prompt field', () => {
  const node = (id, type, field, text) => ({ id, type, name: `Node ${id}`, next: null, parentKey: null, order: 0,
    attributes: { [field]: text } });
  const r = runLints(flow(
    node('a', 'conversationai_continue', 'instructions', `Greet the caller by name. ${BLOCK}`),
    node('b', 'conversationai_objective', 'instructions', `Get the reason for the call. ${BLOCK}`),
    node('c', 'conversationai_ai_message', 'message', `Write a short confirmation. ${BLOCK}`),
    node('d', 'conversationai_ai_splitter', 'description', `Decide whether the caller is a patient or a carer. ${BLOCK}`),
    node('e', 'conversationai_book_appointment', 'promptInstructions', `Book the next available slot. ${RULE_A_VARIANT} ${RULE_B}`),
  ), { catalog, packs: ['hygiene'] });
  const hits = drift(r);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].stepId, 'e');
  assert.match(hits[0].msg, /4 other node\(s\) carry verbatim/);
});

test('flow-bot-rules-drift: non-string or missing prompt fields never throw', () => {
  const r = runLints(flow(
    speak('a', 42),
    speak('b', null),
    speak('c', undefined),
    speak('d', { nested: 'object' }),
    { id: 'e', type: 'conversationai_continue', name: 'No attrs', next: null, parentKey: null, order: 0 },
    { id: 'f', type: 'conversationai_ai_message', name: 'No attrs', next: null, parentKey: null, order: 0, attributes: null },
  ), { catalog, packs: ['hygiene'] });
  assert.deepEqual(r.notEvaluable.filter((x) => /flow-bot-rules-drift/.test(x)), [], 'the rule must not crash');
  assert.deepEqual(drift(r), []);
});

test('nothing throws on an empty or hostile document', () => {
  for (const d of [{ templates: [] }, { templates: null }, {}, { templates: [null, {}, { id: 'x' }] }, null]) {
    const r = runLints(d, { catalog });
    assert.ok(Array.isArray(r.platform) && Array.isArray(r.hygiene));
  }
});
