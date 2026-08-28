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
import { CATALOG_CORRECTIONS, TRIGGER_CORRECTIONS, REQUIRED_FIELDS, enforceRequiredFields, requiredKeysFor, isSupplied } from './required-fields.mjs';
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

// The assets-endpoint schema records this checkbox's default as `true` and the committed
// capture agrees, so defaulting to true reproduces what the BUILDER produces for an
// untouched node. The schedule halves come along with it.
test('end: omitted sleepEnabled defaults to the attested platform default, with its schedule', () => {
  const a = attrsOf({ type: 'conversationai_end', name: 'End', attributes: {} });
  assert.equal(a.sleepEnabled, true);
  assert.equal(a.sleepDuration, 1);
  assert.equal(a.sleepUnit, 'hours');
});

test('end: authoring sleepEnabled:false opts out and pulls in no schedule', () => {
  const a = attrsOf({ type: 'conversationai_end', name: 'End', attributes: { sleepEnabled: false } });
  assert.equal(a.sleepEnabled, false);
  assert.equal(a.sleepDuration, undefined);
  assert.equal(a.sleepUnit, undefined);
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
    () => build({ type: 'conversationai_services_booking', name: 'Book service', attributes: {} }),
    (e) => e.code === 'REQUIRED_FIELD' && /commerce service/.test(e.message),
    'the error must say the account needs a configured commerce service');
});

// --- the two attested-clean types -------------------------------------------------

test('continue requires nothing; objective requires only its objective', () => {
  assert.deepEqual(requiredKeysFor('conversationai_continue'), []);
  assert.deepEqual(requiredKeysFor('conversationai_objective'), ['objective']);
  assert.equal(attrsOf({ type: 'conversationai_objective', name: 'Ask', attributes: { objective: 'find out' } }).objective, 'find out');
  assert.deepEqual(attrsOf({ type: 'conversationai_continue', name: 'Continue', attributes: {} }).__customInputs__, {});
  throws({ type: 'conversationai_objective', name: 'Ask', attributes: {} }, 'REQUIRED_FIELD');
});

// Required per the schema, but never seen as a live builder error because the probe always
// supplied it. Absence of an observed error is not evidence of optionality.
test('the message nodes require their message', () => {
  throws({ type: 'conversationai_ai_message', name: 'Ask', attributes: {} }, 'REQUIRED_FIELD');
  throws({ type: 'conversationai_custom_message', name: 'Say', attributes: {} }, 'REQUIRED_FIELD');
});

// `continue` has an optional `instructions`; the committed capture was {} only because
// nothing was authored, which is not evidence the key does not exist.
test('continue accepts its optional instructions field', () => {
  assert.equal(attrsOf({ type: 'conversationai_continue', name: 'C', attributes: { instructions: 'keep going' } }).instructions, 'keep going');
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

test('end: sleepEnabled:true fills a missing schedule, but an EMPTY one is still rejected', () => {
  const a = attrsOf({ type: 'conversationai_end', name: 'End', attributes: { sleepEnabled: true } });
  assert.equal(a.sleepDuration, 1);
  assert.equal(a.sleepUnit, 'hours');
  // An explicitly blank unit is not something a default can rescue — reactivation would
  // persist as an incomplete schedule.
  throws({ type: 'conversationai_end', name: 'End', attributes: { sleepEnabled: true, sleepUnit: '' } }, 'REQUIRED_FIELD');
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
      `the generated catalog now matches the ${type} correction — DELETE that entry from `
      + `CATALOG_CORRECTIONS in required-fields.mjs. This is the expected end state: someone `
      + `captured a real step-example for ${type}, so the overlay is now dead weight. See the `
      + `"HOW TO RETIRE THIS FILE" block at the top of required-fields.mjs.`);
  }
});

// Same idea as the step-side loop above, adapted to TRIGGER_CORRECTIONS' shape: a fix here is
// a MAPPER (correctFilterRows), not a literal-value patch, so staleness means the mapper no
// longer changes anything when run over the still-generated filterRows. Generalises the
// bespoke conv_ai_autonomous_trigger eq->== check (convai-nodes.test.mjs) so a second trigger
// correction gets this staleness guard for free instead of needing its own bespoke test.
test('every trigger correction is still NEEDED (correctFilterRows still changes something)', () => {
  for (const [type, fix] of Object.entries(TRIGGER_CORRECTIONS)) {
    const generated = CATALOG_DATA.triggers[type];
    assert.ok(generated, `${type} vanished from the generated catalog — revisit this correction`);
    assert.ok(fix.reason, `${type} correction must carry a reason`);
    // FAIL LOUDLY on a shape this loop does not know how to check, rather than silently
    // skipping it — a differently-shaped future correction (e.g. a literal-value patch, no
    // correctFilterRows at all) would otherwise escape the "checked for free" guarantee this
    // loop exists to provide, exactly like the entry it was generalised from.
    if (!fix.correctFilterRows) {
      assert.fail(
        `${type}'s TRIGGER_CORRECTIONS entry has no correctFilterRows — this loop only knows `
        + `how to check that shape for staleness. Extend this loop to cover the new shape `
        + `(e.g. a generic literal-patch diff, mirroring the CATALOG_CORRECTIONS loop above) `
        + `before shipping a differently-shaped trigger correction, or add it here yourself.`,
      );
    }
    const before = generated.filterRows ?? [];
    const after = fix.correctFilterRows(before);
    assert.notDeepEqual(after, before,
      `correctFilterRows for ${type} no longer changes the generated filterRows — DELETE that `
      + `entry from TRIGGER_CORRECTIONS in required-fields.mjs.`);
  }
});

test('corrections reach the compiler through loadCatalog, not just the raw JSON', () => {
  const c = loadCatalog();
  assert.deepEqual(c.step('conversationai_end').attrKeys,
    ['message', 'sleepEnabled', 'sleepDuration', 'sleepUnit', 'type', '__customInputs__']);
  assert.equal(c.step('conversationai_end').confidence, 'verified-live');
  assert.deepEqual(c.step('conversationai_continue').attrKeys, ['instructions', 'type', '__customInputs__']);
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
  assert.equal(isSupplied('conversationai_services_booking', 'conversationai_services', { conversationai_services: [] }), false);
});

// ── wait: the two "jump to a named step" couplings ────────────────────────────────────
// Both are the same defect shape: the author picks a branch that means "go to a specific
// step" and never names the step. GHL accepts the node, so the reference is simply absent
// and the branch has nowhere to go at runtime. The appointment one is GHL's OWN rule
// (validateAppointmentWait, corpus/workflows/30-types/steps/wait.md:58) which the generated
// enforcement block never carried across — wait has 19 throw rules and none covered it.

const waitNode = (attributes) => ({ type: 'wait', ref: 'W1', name: 'Wait', attributes });

test('wait: appointmentCondition specific-step without a target is refused', () => {
  assert.throws(
    () => enforceRequiredFields(waitNode({ type: 'appointment', appointmentCondition: 'specific-step' }), {
      type: 'appointment', appointmentCondition: 'specific-step',
    }),
    (e) => e.code === 'REQUIRED_FIELD' && /appointmentSpecificStep/.test(e.message));
});

test('wait: appointmentCondition specific-step WITH a target passes', () => {
  const attrs = { type: 'appointment', appointmentCondition: 'specific-step', appointmentSpecificStep: 'step-1' };
  assert.doesNotThrow(() => enforceRequiredFields(waitNode(attrs), attrs));
});

test('wait: a non-jump appointmentCondition does not demand a target', () => {
  const attrs = { type: 'appointment', appointmentCondition: 'next' };
  assert.doesNotThrow(() => enforceRequiredFields(waitNode(attrs), attrs));
});

test('wait: specificDatePassed specific_step without a target is refused', () => {
  assert.throws(
    () => enforceRequiredFields(waitNode({ type: 'specific_date', specificDatePassed: 'specific_step' }), {
      type: 'specific_date', specificDatePassed: 'specific_step',
    }),
    (e) => e.code === 'REQUIRED_FIELD' && /specificDateStep/.test(e.message));
});

test('wait: specificDatePassed specific_step WITH a target passes', () => {
  const attrs = { type: 'specific_date', specificDatePassed: 'specific_step', specificDateStep: 'step-2' };
  assert.doesNotThrow(() => enforceRequiredFields(waitNode(attrs), attrs));
});

test('wait: an empty-string target counts as missing, not supplied', () => {
  assert.throws(
    () => enforceRequiredFields(waitNode({ type: 'appointment', appointmentCondition: 'specific-step', appointmentSpecificStep: '' }), {
      type: 'appointment', appointmentCondition: 'specific-step', appointmentSpecificStep: '',
    }),
    (e) => e.code === 'REQUIRED_FIELD');
});

// ── the send-nothing family ───────────────────────────────────────────────────────────
// email/messenger/instagram-dm all had a payload field GHL requires and the engine did not.
// The email one is the worst of the three because the engine ACTIVELY produces it:
// compiler.mjs's envelope writes `html: a.html ?? ''` on the inline path, so "subject, no
// body" became a step that saves clean, opens clean, and sends a blank email.

const node = (type, attributes) => ({ type, ref: 'N1', name: type, attributes });

test('email: inline path with no html is refused', () => {
  assert.throws(
    () => enforceRequiredFields(node('email', { subject: 'Hi' }), { subject: 'Hi' }),
    (e) => e.code === 'REQUIRED_FIELD' && /html/.test(e.message));
});

test('email: the engine-written empty html is still treated as missing', () => {
  assert.throws(
    () => enforceRequiredFields(node('email', { subject: 'Hi', html: '' }), { subject: 'Hi', html: '' }),
    (e) => e.code === 'REQUIRED_FIELD' && /html/.test(e.message));
});

test('email: the template path carries its body in the template, so html is not demanded', () => {
  const attrs = { subject: 'Hi', template_id: 'tpl-1' };
  assert.doesNotThrow(() => enforceRequiredFields(node('email', attrs), attrs));
});

test('email: an inline body passes', () => {
  const attrs = { subject: 'Hi', html: '<p>hello</p>' };
  assert.doesNotThrow(() => enforceRequiredFields(node('email', attrs), attrs));
});

for (const type of ['messenger', 'instagram-dm']) {
  test(`${type}: no body and no attachment is refused`, () => {
    assert.throws(
      () => enforceRequiredFields(node(type, {}), {}),
      (e) => e.code === 'REQUIRED_FIELD' && /body/.test(e.message));
  });

  test(`${type}: an attachment alone satisfies it, matching GHL's sms rule`, () => {
    const attrs = { attachments: ['file-1'] };
    assert.doesNotThrow(() => enforceRequiredFields(node(type, attrs), attrs));
  });

  test(`${type}: a urlAttachment alone satisfies it too`, () => {
    const attrs = { urlAttachments: ['https://example.com/a.png'] };
    assert.doesNotThrow(() => enforceRequiredFields(node(type, attrs), attrs));
  });

  test(`${type}: a body passes`, () => {
    const attrs = { body: 'hello' };
    assert.doesNotThrow(() => enforceRequiredFields(node(type, attrs), attrs));
  });
}

// ── the appointment wait's past-time branch ───────────────────────────────────────────
// GHL's own Wait model assigns SKIP_SENDING_OPTION on creation (Wait.ts:756) and 94 of the
// 102 stored appointmentCondition values in the corpus are 'skip'. Emitting it is what makes
// an engine-built appointment wait match a UI-built one.

test('wait: an appointment wait takes GHL\'s own default of skip', () => {
  const attrs = { type: 'appointment', appointmentStartAfter: { when: 'before', type: 'hours', value: 24 } };
  const out = enforceRequiredFields(node('wait', attrs), attrs);
  assert.equal(out.appointmentCondition, 'skip');
});

test('wait: every appointment-like variant gets it', () => {
  for (const type of ['appointment', 'service_booking', 'rental_booking', 'attendee_event_date', 'overdue']) {
    const attrs = { type };
    assert.equal(enforceRequiredFields(node('wait', attrs), attrs).appointmentCondition, 'skip', type);
  }
});

test('wait: an explicit choice is never overwritten', () => {
  const attrs = { type: 'appointment', appointmentCondition: 'exit' };
  assert.equal(enforceRequiredFields(node('wait', attrs), attrs).appointmentCondition, 'exit');
});

test('wait: a non-appointment variant gets no appointmentCondition at all', () => {
  const attrs = { type: 'time', startAfter: { type: 'hours', value: 1 } };
  assert.equal('appointmentCondition' in enforceRequiredFields(node('wait', attrs), attrs), false);
});

test('wait: the default is only ever one of GHL\'s four enum values', () => {
  const attrs = { type: 'appointment' };
  const legal = new Set(['skip', 'next', 'specific-step', 'exit']);
  assert.ok(legal.has(enforceRequiredFields(node('wait', attrs), attrs).appointmentCondition));
});

// ── the sub-validators the guard-AST extractor could not reach ────────────────────────
// validateConditionWait / validateTimeWait sit behind a `switch` on attributes.type, and the
// extractor only translates flat `if (!attributes.x)` guards — so whole sub-validators were
// dropped. workflow_split and the contact actions were missed for a different reason: their
// rules loop over a row array. GHL's severity is mirrored, not promoted.

const warnings = [];
const warnCtx = { warn: (m) => warnings.push(m) };
const run = (type, attrs) => {
  warnings.length = 0;
  return enforceRequiredFields({ type, ref: 'N', name: type, attributes: attrs }, attrs, warnCtx);
};

test('wait/condition: a branch with no segments is refused', () => {
  assert.throws(() => run('wait', { type: 'condition', condition: { branches: [{ name: 'Yes', segments: [] }] } }),
    (e) => e.code === 'REQUIRED_FIELD' && /branches\[0\] with no segments/.test(e.message));
});

test('wait/condition: a segment with no conditions is refused, and names its index', () => {
  assert.throws(() => run('wait', { type: 'condition', condition: { branches: [{ segments: [{ conditions: [] }] }] } }),
    (e) => /branches\[0\]\.segments\[0\] with no conditions/.test(e.message));
});

test('wait/condition: a populated branch passes', () => {
  const attrs = { type: 'condition', condition: { branches: [{ segments: [{ conditions: [{ conditionType: 'contact_detail' }] }] }] } };
  assert.doesNotThrow(() => run('wait', attrs));
});

test('wait/time: an exact window with no start is refused; window.condition "when" is untouched', () => {
  assert.throws(() => run('wait', { type: 'time', window: { condition: 'exact' } }),
    (e) => /window\.condition:"exact" without window\.start/.test(e.message));
  assert.doesNotThrow(() => run('wait', { type: 'time', window: { condition: 'exact', start: '09:00' } }));
  assert.doesNotThrow(() => run('wait', { type: 'time', window: { condition: 'when' } }));
});

test('workflow_split: random-split weights that miss 100 WARN rather than throw', () => {
  const attrs = { condition: 'random-split', paths: [{ id: 'p1' }, { id: 'p2' }],
    extras: { weightDistribution: { p1: 30, p2: 30 } } };
  assert.doesNotThrow(() => run('workflow_split', attrs));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /totalling 60, not 100/);
});

test('workflow_split: weights summing to 100 are silent, and even-split is not judged', () => {
  run('workflow_split', { condition: 'random-split', paths: [{ id: 'p1' }, { id: 'p2' }],
    extras: { weightDistribution: { p1: 55.5, p2: 44.5 } } });
  assert.equal(warnings.length, 0);
  run('workflow_split', { condition: 'even-split', paths: [{ id: 'p1' }] });
  assert.equal(warnings.length, 0);
});

test('create_update_contact: an empty row warns; false, 0 and currentDate are real values', () => {
  run('create_update_contact', { fields: [{ field: 'firstName', value: '' }] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /firstName/);

  run('create_update_contact', { fields: [
    { field: 'optedIn', value: false }, { field: 'score', value: 0 },
    { field: 'signupDate', date: 'currentDate' }, { field: 'email', value: 'a@example.com' }] });
  assert.equal(warnings.length, 0, 'GHL exempts false, 0 and currentDate');
});

test('find_contact: the same row rule applies, also as a warning', () => {
  run('find_contact', { fields: [{ field: 'email', value: null }] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /no value: email/);
});

// ── the wiring itself ─────────────────────────────────────────────────────────────────
// Live-caught 2026-08-25: a wait is authored as `kind:'wait'` with no `type`, and takes a
// dedicated builder instead of the generic normalizeAttrs path where enforceRequiredFields is
// wired. Every wait rule above was therefore DEAD in the real compile path, while these unit
// tests passed because they call enforceRequiredFields directly. The regression test has to go
// through compile(), not through the function.

test('a wait compiled end-to-end actually receives the appointment default', async () => {
  const { compile } = await import('./compiler.mjs');
  const { loadCatalog } = await import('./catalog.mjs');
  const { makeSeededIdGen } = await import('./idgen.mjs');
  const ctx = { loc: 'L', cid: 'C', uid: 'U', companyAge: 1, idGen: makeSeededIdGen('w'), catalog: loadCatalog() };
  const built = compile({
    name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'w', kind: 'wait', name: 'Before appt',
      attributes: { type: 'appointment', appointmentStartAfter: { when: 'before', type: 'hours', value: 24, distributed: {} } } }],
  }, ctx);
  const wait = built.autoSaveBody.workflowData.templates.find((t) => t.type === 'wait');
  assert.equal(wait.attributes.appointmentCondition, 'skip',
    'the coupled/default rules must run on the wait path, not only via enforceRequiredFields');
});

test('a wait compiled end-to-end is refused when its jump target is missing', async () => {
  const { compile } = await import('./compiler.mjs');
  const { loadCatalog } = await import('./catalog.mjs');
  const { makeSeededIdGen } = await import('./idgen.mjs');
  const ctx = { loc: 'L', cid: 'C', uid: 'U', companyAge: 1, idGen: makeSeededIdGen('w2'), catalog: loadCatalog() };
  assert.throws(() => compile({
    name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'w', kind: 'wait', name: 'Before appt',
      attributes: { type: 'appointment', appointmentCondition: 'specific-step',
        appointmentStartAfter: { when: 'before', type: 'hours', value: 24, distributed: {} } } }],
  }, ctx), (e) => /appointmentSpecificStep/.test(e.message));
});

// ── text-content rules ────────────────────────────────────────────────────────────────
// Two of GHL's three text checks are mirrored EXACTLY. The third — the Handlebars parse in
// isValidHandleBar — is deliberately not, because reimplementing a template parser with regexes
// would disagree with GHL at the edges, and an edge-wrong validator is worse than none.

test('handlebars: a bracket inside a bracket segment is refused', () => {
  assert.throws(() => run('sms', { body: 'hi {{contact.[a[0]].name}}' }),
    (e) => e.code === 'REQUIRED_FIELD' && /nested bracket/.test(e.message));
});

test('handlebars: the two forms GHL calls VALID still pass', () => {
  assert.doesNotThrow(() => run('sms', { body: 'hi {{prefix.[key with spaces].id}}' }));
  assert.doesNotThrow(() => run('sms', { body: 'hi {{prefix.[0].name}}' }));
});

test('handlebars: block helpers are skipped, not scanned as paths', () => {
  assert.doesNotThrow(() => run('sms', { body: '{{#each items}}x{{/each}}' }));
});

test('handlebars: plain text and an empty body are untouched', () => {
  assert.doesNotThrow(() => run('sms', { body: 'no handlebars here at all' }));
  assert.doesNotThrow(() => run('chatgpt', { promptText: '' }));
});

test('handlebars: the rule reaches every field GHL runs it over', () => {
  const bad = '{{a.[x[0]].b}}';
  assert.throws(() => run('chatgpt', { promptText: bad }), (e) => /promptText/.test(e.message));
  assert.throws(() => run('workflow_ai_generate_image', { prompt: bad }), (e) => /prompt/.test(e.message));
  assert.throws(() => run('event_start_date', { value: bad }), (e) => /value/.test(e.message));
  assert.throws(() => run('add_appointment_booking_ai_bot', { first_message: bad }),
    (e) => /first_message/.test(e.message));
});

test('sms spam words: a blocked word is refused and named', () => {
  assert.throws(() => run('sms', { body: 'try our new CBD range' }),
    (e) => e.code === 'REQUIRED_FIELD' && /cbd/.test(e.message));
});

test('sms spam words: GHL\'s list is blunt, and we mirror it rather than soften it', () => {
  // 'joint' is on GHL's list, so this innocent sentence genuinely cannot be saved in GHL.
  assert.throws(() => run('sms', { body: "let's discuss the joint venture" }),
    (e) => /joint/.test(e.message));
});

test('sms spam words: matching is whole-word, so a substring does not trip it', () => {
  assert.doesNotThrow(() => run('sms', { body: 'your appointment is confirmed' }));  // contains "pot"? no
  assert.doesNotThrow(() => run('sms', { body: 'we will call you shortly' }));
});

test('sms spam words: the gate is scoped to sms — messenger and instagram-dm are untouched', () => {
  // WorkflowValidator.ts:227 filters on type === 'sms' only.
  assert.doesNotThrow(() => run('messenger', { body: 'our CBD range is here' }));
  assert.doesNotThrow(() => run('instagram-dm', { body: 'our CBD range is here' }));
});

// ── money, bounds and body-shape guards ───────────────────────────────────────────────
// All of these are result:'warning' in GHL, so all of them warn here. Mirroring the TIER is as
// much the point as mirroring the rule — promoting one would refuse a document GHL opens.

test('stripe: a non-numeric or negative amount warns, a merge tag does not', () => {
  run('stripe_one_time_charge', { amount: 'abc' });
  assert.equal(warnings.length, 1);
  run('stripe_one_time_charge', { amount: '-5' });
  assert.equal(warnings.length, 1);
  run('stripe_one_time_charge', { amount: '{{contact.total}}' });
  assert.equal(warnings.length, 0, 'a merge tag resolves at runtime and cannot be judged now');
  run('stripe_one_time_charge', { amount: '19.99' });
  assert.equal(warnings.length, 0);
});

test('google_adword: same positive-value rule on conversion_value', () => {
  run('google_adword', { conversion_value: '0' });
  assert.equal(warnings.length, 1);
  run('google_adword', { conversion_value: '{{x}}' });
  assert.equal(warnings.length, 0);
});

test('math_operation: division by zero warns; other operators do not', () => {
  run('math_operation', { operators: [{ operator: 'div', value: 0 }] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /divides by zero/);
  run('math_operation', { operators: [{ operator: 'div', value: 2 }, { operator: 'add', value: 0 }] });
  assert.equal(warnings.length, 0);
});

test('ivr_connect_call: the bound is on users + customNumbers COMBINED', () => {
  run('ivr_connect_call', { users: [], customNumbers: [] });
  assert.match(warnings[0], /rings nobody/);
  run('ivr_connect_call', { users: ['u1'], customNumbers: [] });
  assert.equal(warnings.length, 0, 'one destination in either list is enough');
  run('ivr_connect_call', { users: Array(6).fill('u'), customNumbers: Array(6).fill('n') });
  assert.match(warnings[0], /dials 12 numbers/);
});

test('custom_webhook: a json contentType with unparseable body warns', () => {
  run('custom_webhook', { body: { contentType: 'application/json', rawData: '{not json' } });
  assert.equal(warnings.length, 1);
  run('custom_webhook', { body: { contentType: 'application/json', rawData: '{"a":1}' } });
  assert.equal(warnings.length, 0);
});

test('custom_webhook: form-encoded rows with an empty key or null value warn', () => {
  run('custom_webhook', { body: { contentType: 'application/x-www-form-urlencoded',
    keyValueData: [{ key: 'a', value: '1' }, { key: '  ', value: '2' }] } });
  assert.equal(warnings.length, 1);
  run('custom_webhook', { body: { contentType: 'application/x-www-form-urlencoded',
    keyValueData: [{ key: 'a', value: '1' }] } });
  assert.equal(warnings.length, 0);
});

test('every warn-tier rule warns rather than throws', () => {
  // The tier is the contract. A throw here would refuse a workflow the builder opens happily.
  for (const [type, attrs] of [
    ['stripe_one_time_charge', { amount: 'abc' }],
    ['google_adword', { conversion_value: '0' }],
    ['math_operation', { operators: [{ operator: 'div', value: 0 }] }],
    ['ivr_connect_call', { users: [], customNumbers: [] }],
    ['custom_webhook', { body: { contentType: 'application/json', rawData: 'x' } }],
  ]) {
    assert.doesNotThrow(() => run(type, attrs), `${type} must warn, not throw`);
  }
});

test('wait: a branching timeout of 0 is refused, and only when branching is on', () => {
  // GHL guards this at the CALL SITE with convertToMultipath && startAfter, then errors on
  // value === 0. The generated catalog scoped it to recurring_schedule at warn tier — a variant
  // it can never reach, at the wrong severity.
  assert.throws(() => run('wait', { type: 'reply', convertToMultipath: true, startAfter: { value: 0 } }),
    (e) => e.code === 'REQUIRED_FIELD' && /timeout of 0/.test(e.message));
  assert.doesNotThrow(() => run('wait', { type: 'reply', convertToMultipath: true, startAfter: { value: 12 } }));
  // Without branching the timeout guard does not apply at all.
  assert.doesNotThrow(() => run('wait', { type: 'time', startAfter: { value: 0 } }));
});

test('workflow_goal stepIds are covered by the dangling-ref registry, not by enforcement', async () => {
  // GHL's goalActionValidator checks extras.stepIds against the template list. That is a GRAPH
  // check, not an attribute check, so it belongs in graph-refs — and it is already there. This
  // test exists so the audit's "workflow_goal has zero coverage" is not acted on twice.
  const { STEP_REF_FIELDS } = await import('./graph-refs.mjs');
  const paths = STEP_REF_FIELDS.filter(([t]) => t === 'workflow_goal').map(([, p]) => p);
  assert.ok(paths.includes('segments[].conditions[].extras.stepIds'), 'goal stepIds must stay ref-checked');
});

// ── the invariant that broke twice ────────────────────────────────────────────────────
// Nine step types take a DEDICATED attribute builder; enforceRequiredFields is wired into the
// generic path. Every dedicated type therefore reached GHL having run none of its rules.
//
// Found first on `wait` and patched per-branch — which fixed one symptom and left `email` and
// `custom_webhook` dead, including email.html, the rule that stops a step SENDING A BLANK EMAIL.
// It shipped in v0.30.0 doing nothing. 866 unit tests could not see it, because they call
// enforceRequiredFields directly and so never exercise the dispatch.
//
// This test asserts the INVARIANT rather than the three instances: any type that has both a
// dedicated builder and a coupled rule must enforce that rule through compile(). A tenth builder
// added without wiring will fail here.

test('every dedicated-builder type with a coupled rule enforces it through compile()', async () => {
  const { DEDICATED_ATTRIBUTES, compile } = await import('./compiler.mjs');
  const { COUPLED_FIELDS } = await import('./required-fields.mjs');
  const { loadCatalog } = await import('./catalog.mjs');
  const { makeSeededIdGen } = await import('./idgen.mjs');

  assert.equal(DEDICATED_ATTRIBUTES.length, 9, 'a builder was added or removed — wire it and update this');

  // One input per dedicated type that owns a coupled rule, chosen to trip that rule.
  const TRIPS = {
    email: { node: { type: 'email', attributes: { subject: 'Hi' } }, expect: /html/ },
    custom_webhook: {
      node: { type: 'custom_webhook', attributes: { url: 'https://example.com/h', method: 'POST',
        body: { contentType: 'application/json', rawData: '{not json' } } },
      warns: /parseable JSON/,
    },
    wait: { node: { kind: 'wait', attributes: { type: 'appointment', appointmentCondition: 'specific-step',
      appointmentStartAfter: { when: 'before', type: 'hours', value: 1, distributed: {} } } },
      expect: /appointmentSpecificStep/ },
  };

  const dedicatedWithRules = Object.keys(TRIPS);
  for (const key of dedicatedWithRules) {
    assert.ok(COUPLED_FIELDS[key], `${key} must still own a coupled rule for this test to mean anything`);
  }

  for (const [type, spec] of Object.entries(TRIPS)) {
    const warnings = [];
    const ctx = { loc: 'L', cid: 'C', uid: 'U', companyAge: 1, catalog: loadCatalog(),
      idGen: makeSeededIdGen('ded' + type), warn: (m) => warnings.push(m) };
    const ir = { name: 'T', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
      graph: [{ ref: 's', name: 'S', kind: spec.node.kind ?? 'action', ...spec.node }] };

    if (spec.expect) {
      assert.throws(() => compile(ir, ctx), (e) => spec.expect.test(e.message),
        `${type}: its coupled rule did not fire through compile() — the seam is bypassed again`);
    } else {
      assert.doesNotThrow(() => compile(ir, ctx));
      assert.ok(warnings.some((w) => spec.warns.test(w)),
        `${type}: its warn-tier rule did not fire through compile()`);
    }
  }
});

// Folded from two tests: the first half is a real regression guard (it fails if
// CONDITIONAL_DEFAULTS.add_to_workflow is deleted outright — out.input_trigger_params would
// come back undefined, not false); the second half used to live as its own test
// ('an author-supplied input_trigger_params is respected') but passed even with that whole
// entry deleted, since nothing else in the pipeline overrides a supplied value either — it
// pinned a property, not a regression. Kept here instead, where it DOES guard something: a
// mutation that forces input_trigger_params unconditionally (dropping the `=== undefined`
// guard) fails this assertion specifically.
test('add_to_workflow always ships a boolean input_trigger_params, defaulting to false but never overriding a supplied value', async () => {
  const { enforceRequiredFields } = await import('./required-fields.mjs');
  const node = { type: 'add_to_workflow', name: 'Enrol' };

  const defaulted = enforceRequiredFields(node, { workflow_id: 'wf-1', type: 'add_to_workflow' }, {});
  assert.equal(defaulted.input_trigger_params, false);
  assert.equal(typeof defaulted.input_trigger_params, 'boolean', 'the UI drawer writes the STRING "False", which the validator rejects with "Expected boolean"');

  const supplied = enforceRequiredFields(node, { workflow_id: 'wf-1', type: 'add_to_workflow', input_trigger_params: true }, {});
  assert.equal(supplied.input_trigger_params, true,
    'CONDITIONAL_DEFAULTS.add_to_workflow must only fill an ABSENT value, never override one the author supplied');
});

// The UI drawer writes the STRING "False" here (see the comment above
// CONDITIONAL_DEFAULTS.add_to_workflow), which GHL's save validator rejects with "Expected
// boolean" — and "False" is truthy, so a naive `!!value` coercion would turn a value GHL
// rejects into one that looks accepted, hiding the defect instead of catching it. Refuse
// outright rather than coerce.
test('add_to_workflow refuses a non-boolean input_trigger_params instead of coercing it', async () => {
  const { enforceRequiredFields } = await import('./required-fields.mjs');
  const node = { type: 'add_to_workflow', name: 'Enrol' };
  for (const badValue of ['False', null, 0]) {
    assert.throws(
      () => enforceRequiredFields(node, { workflow_id: 'wf-1', type: 'add_to_workflow', input_trigger_params: badValue }, {}),
      (e) => e.code === 'ATTR_TYPE' && /input_trigger_params/.test(e.message) && /boolean/.test(e.message),
      `input_trigger_params: ${JSON.stringify(badValue)} must be refused, not coerced`,
    );
  }
});

test('a blocking objective without a closing message is refused', async () => {
  const { enforceRequiredFields } = await import('./required-fields.mjs');
  const node = { type: 'conversationai_objective', name: 'Capture outcome' };
  assert.throws(
    () => enforceRequiredFields(node, {
      objective: 'Capture the target outcome', proceedIfNotMet: true, maxAttempts: '5',
    }, {}),
    /closingMessage/,
  );
});

test('a non-blocking objective needs no closing message', async () => {
  const { enforceRequiredFields } = await import('./required-fields.mjs');
  const node = { type: 'conversationai_objective', name: 'Capture name' };
  assert.doesNotThrow(() => enforceRequiredFields(node, {
    objective: 'Capture the first name', proceedIfNotMet: false, maxAttempts: '5',
  }, {}));
});

test('a blocking objective WITH a closing message is accepted', async () => {
  const { enforceRequiredFields } = await import('./required-fields.mjs');
  const node = { type: 'conversationai_objective', name: 'Capture outcome' };
  assert.doesNotThrow(() => enforceRequiredFields(node, {
    objective: 'Capture the target outcome',
    proceedIfNotMet: true,
    closingMessage: "I'll have the team pick this up and point you the right way.",
    maxAttempts: '5',
  }, {}));
});

// Regression test for the ATTR_KEY / COUPLED_FIELDS bind discovered 2026-08-27: the three
// tests above only drive enforceRequiredFields() in isolation, which passed even while the
// full compile() pipeline still threw ATTR_KEY on `closingMessage` (attrKeys had not been
// extended). This one drives the real pipeline end to end, the way convai-nodes.test.mjs does,
// so a future regression on either side (COUPLED_FIELDS OR attrKeys) fails here.
test('a blocking objective compiles end to end and carries closingMessage + tags on the compiled step', () => {
  const a = attrsOf({
    type: 'conversationai_objective',
    name: 'Capture outcome',
    attributes: {
      objective: 'Capture the target outcome',
      proceedIfNotMet: true,
      closingMessage: 'Handing this off to the team.',
      tags: '',
      maxAttempts: '5',
    },
  });
  assert.equal(a.proceedIfNotMet, true);
  assert.equal(a.closingMessage, 'Handing this off to the team.');
  assert.equal(a.tags, '');
});
