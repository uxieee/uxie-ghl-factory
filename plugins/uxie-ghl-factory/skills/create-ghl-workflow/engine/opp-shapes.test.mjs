import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOppFieldShape } from './opp-shapes.mjs';

test('OPP_SHAPE: name + SINGLE_OPTIONS/select throws (strong support, 4 accounts)', () => {
  assert.throws(
    () => checkOppFieldShape({ filterField: 'name', value: 'x', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' }, { ref: 'w1' }),
    (e) => e.code === 'OPP_SHAPE' && /4 accounts/.test(e.message) && /set: \[string\]/.test(e.message),
  );
});

test('OPP_SHAPE: monetaryValue + valueFieldType number WARNS (thin support, 2 accounts)', () => {
  const warnings = [];
  checkOppFieldShape({ filterField: 'monetaryValue', value: '5', dataType: 'NUMERICAL', valueFieldType: 'number' },
    { ref: 'w2', warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /monetaryValue valueFieldType 'number' not attested \(set: \[numerical\], n=17, 2 accounts\)/);
});

test('OPP_SHAPE: absent value is always legal (dialect)', () => {
  const warnings = [];
  checkOppFieldShape({ filterField: 'name', value: 'x', valueFieldType: 'string' }, { ref: 'w3', warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 0); // dataType absent — not flagged
});

test('OPP_SHAPE: attested shape passes silently', () => {
  const warnings = [];
  checkOppFieldShape({ filterField: 'status', value: 'open', dataType: 'SINGLE_OPTIONS', valueFieldType: 'select' }, { ref: 'w4', warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 0);
});

test('OPP_SHAPE: unknown filterField is not judged here (Task 3 classifies it)', () => {
  assert.doesNotThrow(() => checkOppFieldShape({ filterField: 'contact.some_custom', value: 'x', valueFieldType: 'string' }, { ref: 'w5' }));
});
