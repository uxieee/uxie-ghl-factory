import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIR, IRError, collectRefs } from './ir.mjs';

const validIR = () => ({
  name: 'W', triggers: [{ ref: 't1', type: 'contact_tag', name: 'T', filters: [] }],
  graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['x'] } },
    { ref: 'b', kind: 'if_else', name: 'B', branches: [
      { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail' }], then: [
        { ref: 'w', kind: 'wait', name: 'W', config: { unit: 'days', value: 1, when: 'after' } } ] },
      { ref: 'n', name: 'No', else: true, then: [] },
    ] },
  ],
});

test('valid IR passes and defaults active=true', () => {
  const out = parseIR(validIR());
  assert.equal(out.triggers[0].active, true);
});

test('duplicate ref rejected', () => {
  const ir = validIR(); ir.graph[0].ref = 'a'; ir.graph[1].ref = 'a';
  assert.throws(() => parseIR(ir), (e) => e instanceof IRError && e.code === 'DUP_REF');
});

test('unresolved goto rejected', () => {
  const ir = validIR();
  ir.graph.push({ ref: 'g', kind: 'goto', target: 'nope' });
  assert.throws(() => parseIR(ir), (e) => e.code === 'GOTO_UNRESOLVED');
});

test('non-terminal goto rejected', () => {
  const ir = validIR();
  ir.graph[1].branches[0].then.push({ ref: 'g', kind: 'goto', target: 'a' });
  ir.graph[1].branches[0].then.push({ ref: 'after', kind: 'action', type: 'add_contact_tag', name: 'X', attributes: {} });
  assert.throws(() => parseIR(ir), (e) => e.code === 'GOTO_NOT_TERMINAL');
});

test('if_else with <2 branches rejected', () => {
  const ir = validIR(); ir.graph[1].branches = [ir.graph[1].branches[0]];
  assert.throws(() => parseIR(ir), (e) => e.code === 'IFELSE_ARITY');
});

test('branch with both conditions and else rejected', () => {
  const ir = validIR(); ir.graph[1].branches[1].conditions = [{ conditionType: 'x' }];
  assert.throws(() => parseIR(ir), (e) => e.code === 'BRANCH_SHAPE');
});

test('collectRefs finds nested refs', () => {
  assert.deepEqual(new Set(collectRefs(validIR())), new Set(['t1', 'a', 'b', 'y', 'w', 'n']));
});
