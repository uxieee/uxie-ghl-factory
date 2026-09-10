import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP_OUTPUTS, findOutputRefs, checkStepOutputRefs } from './step-outputs.mjs';

test('findOutputRefs parses {{ns.N.field}} (incl. bracketed task-notification), ignores non-output namespaces', () => {
  const refs = findOutputRefs('Hi {{contact.first_name}} — {{custom_webhook.2.response.status}} and {{[task-notification].1.title}} and {{chatgpt.1.response}}');
  assert.deepEqual(refs.map((r) => [r.type, r.n, r.field]), [
    ['custom_webhook', 2, 'response.status'], ['task-notification', 1, 'title'], ['chatgpt', 1, 'response'],
  ]);
  assert.deepEqual(findOutputRefs('{{contact.email}} {{custom_values.x}}'), []);
});

test('a reference with no matching producer warns; a matching one (by stepIndex) passes', () => {
  const warns = [];
  const T = [
    { id: 'w', type: 'custom_webhook', name: 'Hook', stepIndex: 2, attributes: { saveResponse: true, webhookResponse: { status: 200 } } },
    { id: 's', type: 'sms', name: 'S', attributes: { body: 'x {{custom_webhook.2.response.ok}} y {{custom_webhook.9.response}}' } },
  ];
  const findings = checkStepOutputRefs(T, { warn: (m) => warns.push(m) });
  assert.equal(findings.length, 1);
  assert.match(warns[0], /no custom_webhook step answers to 9/);
});

test("Xander's trap: referencing a webhook whose saveResponse is off warns with the UI's rule", () => {
  const warns = [];
  const T = [
    { id: 'w', type: 'custom_webhook', name: 'Hook', stepIndex: 1, attributes: { saveResponse: false } },
    { id: 's', type: 'sms', name: 'S', attributes: { body: '{{custom_webhook.1.response.data}}' } },
  ];
  checkStepOutputRefs(T, { warn: (m) => warns.push(m) });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /Save response from this Webhook/);
});

test('custom_code refs warn when no run-test output exists; occurrence order stands in when stepIndex is absent', () => {
  const warns = [];
  const T = [
    { id: 'c', type: 'custom_code', name: 'Code', attributes: { code: 'x', output: {} } },
    { id: 's', type: 'sms', name: 'S', attributes: { body: '{{custom_code.1.output.total}}' } },
  ];
  checkStepOutputRefs(T, { warn: (m) => warns.push(m) });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /no run-test output/);
  assert.equal(STEP_OUTPUTS.custom_code.fieldsFrom({ output: { a: 1, b: 2 } }).join(','), 'output.a,output.b');
});

test('hatch skips; fixed field lists are as harvested', () => {
  const T = [{ id: 's', type: 'sms', name: 'S', attributes: { body: '{{chatgpt.3.response}}' } }];
  assert.deepEqual(checkStepOutputRefs(T, { skipStepOutputCheck: true }), []);
  assert.deepEqual(STEP_OUTPUTS.datetime_formatter.fields, ['date', 'datetime', 'days']);
  assert.equal(STEP_OUTPUTS['task-notification'].ns, '[task-notification]');
});

// A producer with NO stepIndex is the case we do not get to be confident about, so the check
// stays quiet on both readings of it.
//
// A peer account has four math_operation steps with no stepIndex at all whose consumers reference
// {{math_operation.0.result}}, and two production sends on different days rendered the real,
// changing number — so the runtime resolves a 0-based reference against an unnumbered producer.
// The previous code assumed the 1-based occurrence and would have warned on all four, which is a
// false positive on a workflow that demonstrably works.
//
// One account cannot tell us whether that is a 0-based rule or leniency about the base. Guessing
// either way turns an advisory into noise, so an unnumbered producer answers to both.
test('an unnumbered producer answers to either occurrence number, and warns on neither', () => {
  const warns = [];
  const ctx = { warn: (m) => warns.push(m) };
  const producer = { id: 'p', type: 'math_operation', name: 'Slots', attributes: {} };
  const consumer = (n) => ({ id: `c${n}`, type: 'send_email', name: 'Mail',
    attributes: { subject: `{{math_operation.${n}.result}} open` } });

  checkStepOutputRefs([producer, consumer(0)], ctx);
  checkStepOutputRefs([producer, consumer(1)], ctx);
  assert.deepEqual(warns, [], `an unnumbered producer must satisfy both readings, got: ${warns.join(' | ')}`);

  // it is not blanket-silent though: a number that is neither occupied still warns
  checkStepOutputRefs([producer, consumer(7)], ctx);
  assert.equal(warns.length, 1, 'a reference to a position no producer occupies must still warn');
  assert.match(warns[0], /answers to 7/);
});

test('a producer WITH a stepIndex answers to that number only', () => {
  // when the field is written, producer and consumer have an explicit key to agree on and there
  // is nothing to be lenient about
  const warns = [];
  const ctx = { warn: (m) => warns.push(m) };
  const producer = { id: 'p', type: 'math_operation', name: 'Slots', stepIndex: 3, attributes: {} };
  checkStepOutputRefs([producer, { id: 'c', type: 'send_email', name: 'M',
    attributes: { subject: '{{math_operation.3.result}}' } }], ctx);
  assert.deepEqual(warns, [], 'the stored number matches');

  checkStepOutputRefs([producer, { id: 'c', type: 'send_email', name: 'M',
    attributes: { subject: '{{math_operation.1.result}}' } }], ctx);
  assert.equal(warns.length, 1, 'a different number does not');
});
