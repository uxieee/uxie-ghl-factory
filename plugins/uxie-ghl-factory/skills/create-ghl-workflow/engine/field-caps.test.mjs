import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_CAPS, checkFieldCaps, describeCap } from './field-caps.mjs';

const step = (type, attributes, id = 's') => ({ id, type, name: `Step ${id}`, attributes });

test('the four measured caps are the whole table — conversationai_continue has none', () => {
  assert.deepEqual(FIELD_CAPS, {
    conversationai_objective: { instructions: 1000 },
    conversationai_ai_message: { message: 600 },
    conversationai_book_appointment: { promptInstructions: 500 },
    conversationai_ai_splitter: { description: 500 },
  });
  assert.equal(FIELD_CAPS.conversationai_continue, undefined);
});

test('a value AT the cap passes; one over it is reported with length and cap', () => {
  assert.deepEqual(checkFieldCaps([step('conversationai_ai_message', { message: 'x'.repeat(600) })]), []);
  const f = checkFieldCaps([step('conversationai_ai_message', { message: 'x'.repeat(601) })]);
  assert.deepEqual(f, [{ stepId: 's', name: 'Step s', type: 'conversationai_ai_message', field: 'message', length: 601, cap: 600 }]);
  assert.match(describeCap(f[0]), /601 characters; the builder's cap is 600/);
});

test('scope restricts reporting; garbage never throws', () => {
  const doc = [step('conversationai_book_appointment', { promptInstructions: 'y'.repeat(550) }, 'a'),
    step('conversationai_ai_splitter', { description: 'z'.repeat(501) }, 'b'), null, {}];
  assert.deepEqual(checkFieldCaps(doc).map((f) => f.stepId), ['a', 'b']);
  assert.deepEqual(checkFieldCaps(doc, { scope: new Set(['b']) }).map((f) => f.stepId), ['b']);
  assert.deepEqual(checkFieldCaps([step('conversationai_continue', { message: 'q'.repeat(900) })]), []);
});
