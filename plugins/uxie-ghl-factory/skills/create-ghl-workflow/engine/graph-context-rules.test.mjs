// Graph-context rules: the two GHL validators that need the whole template list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGraphContextRules } from './graph-context-rules.mjs';

const run = (templates) => checkGraphContextRules(templates, {});

test('goto: a step after a goto is unreachable and is reported', () => {
  const f = run([
    { id: 'a', type: 'sms', next: 'g' },
    { id: 'g', type: 'goto', name: 'Jump', next: 'z' },
    { id: 'z', type: 'sms' },
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0], /unreachable/);
});

test('goto: a goto at the end of its branch is fine', () => {
  assert.deepEqual(run([
    { id: 'a', type: 'sms', next: 'g' },
    { id: 'g', type: 'goto', name: 'Jump', next: null },
  ]), []);
});

test('goto: a goto with no parent pointing at it is not judged', () => {
  assert.deepEqual(run([{ id: 'g', type: 'goto', name: 'Orphan', next: 'z' }]), []);
});

test('math: a reference to a deleted upstream step is reported', () => {
  // {{math_operation.3.result}} with only one math step present — nothing resolves it.
  const f = run([
    { id: 'm1', type: 'math_operation', name: 'Second', stepIndex: 1,
      attributes: { selectField: '{{math_operation.3.result}}', selectFieldtype: 'numerical' } },
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0], /does not exist/);
});

test('math: a type that drifted from its upstream step is reported', () => {
  const f = run([
    { id: 'm0', type: 'math_operation', name: 'First', stepIndex: 0,
      attributes: { selectField: '{{contact.score}}', selectFieldtype: 'date' } },
    { id: 'm1', type: 'math_operation', name: 'Second', stepIndex: 1,
      attributes: { selectField: '{{math_operation.0.result}}', selectFieldtype: 'numerical' } },
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0], /types drifted apart/);
});

test('math: matching types are silent', () => {
  assert.deepEqual(run([
    { id: 'm0', type: 'math_operation', name: 'First', stepIndex: 0,
      attributes: { selectField: '{{contact.score}}', selectFieldtype: 'numerical' } },
    { id: 'm1', type: 'math_operation', name: 'Second', stepIndex: 1,
      attributes: { selectField: '{{math_operation.0.result}}', selectFieldtype: 'numerical' } },
  ]), []);
});

test('math: GHL falls back to template ORDER when stepIndex is unset, and so do we', () => {
  // No stepIndex anywhere — GHL indexes the math steps positionally. mathOps[0] is First.
  const f = run([
    { id: 'm0', type: 'math_operation', name: 'First',
      attributes: { selectField: '{{contact.score}}', selectFieldtype: 'date' } },
    { id: 'm1', type: 'math_operation', name: 'Second',
      attributes: { selectField: '{{math_operation.0.result}}', selectFieldtype: 'numerical' } },
  ]);
  assert.equal(f.length, 1, 'the positional fallback must resolve, not silently miss');
});

test('a non-reference selectField is never judged against upstream', () => {
  assert.deepEqual(run([
    { id: 'm0', type: 'math_operation', name: 'Only',
      attributes: { selectField: '{{contact.score}}', selectFieldtype: 'numerical' } },
  ]), []);
});

test('the hatch disables the whole layer', () => {
  const f = checkGraphContextRules([
    { id: 'a', type: 'sms', next: 'g' },
    { id: 'g', type: 'goto', name: 'Jump', next: 'z' },
  ], { skipGraphContextRules: true });
  assert.deepEqual(f, []);
});

test('findings reach the caller through warn, prefixed', () => {
  const warns = [];
  checkGraphContextRules([
    { id: 'a', type: 'sms', next: 'g' },
    { id: 'g', type: 'goto', name: 'Jump', next: 'z' },
  ], { warn: (m) => warns.push(m) });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /^GRAPH_CONTEXT: /);
});
