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
  assert.match(warns[0], /no custom_webhook step with stepIndex 9/);
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
