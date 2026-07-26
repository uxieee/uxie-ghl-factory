import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIR, IRError, collectRefs, lintConditionShape } from './ir.mjs';

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

// Regression: a ref-LESS trigger used to push `undefined` into collectRefs' output, so
// parseIR's `seen` set contained undefined and `seen.has(n.target)` was TRUE for a goto
// whose target was undefined (the shape produced by authoring attributes.targetNodeId
// instead of the top-level `target` key). That silently disabled GOTO_UNRESOLVED for any
// workflow with a trigger — i.e. nearly all of them. Live-diagnosed 2026-07-25 on AU:
// the find -> not-found -> create -> goto-found pattern compiled with a dangling
// targetNodeId and the builder reported "Target node not found".
test('goto guard still fires when a ref-less trigger is present', () => {
  const ir = validIR();
  ir.triggers = [{ type: 'conv_ai_trigger', name: 'Chat Initiated' }];   // no `ref`
  ir.graph.push({ ref: 'g', kind: 'goto', name: 'G', attributes: { targetNodeId: 'a' } });
  assert.throws(() => parseIR(ir), (e) => e.code === 'GOTO_UNRESOLVED');
});

test('two ref-less triggers do not trip a spurious DUP_REF', () => {
  const ir = validIR();
  ir.triggers = [
    { type: 'conv_ai_trigger', name: 'A' },
    { type: 'contact_tag', name: 'B' },
  ];
  assert.doesNotThrow(() => parseIR(ir));
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

test('triggers: [] is legal (trigger-less workflow enrolled via add_to_workflow)', () => {
  const ir = { name: 'W', triggers: [], graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['x'] } }] };
  const norm = parseIR(ir);
  assert.deepEqual(norm.triggers, []);
});

test('lintConditionShape: rejects a condition with no conditionType', () => {
  assert.throws(
    () => lintConditionShape({ conditionSubType: 'x', conditionOperator: '==', conditionValue: 'y' }),
    (e) => e.code === 'COND_SHAPE' && /must identify what it tests/.test(e.message),
  );
});

test('lintConditionShape: names the trigger-filter vocabulary when field/operator/value leak in', () => {
  assert.throws(
    () => lintConditionShape({ field: 'contact.tags', operator: 'contains', value: 'vip' }),
    (e) => e.code === 'COND_SHAPE' && /trigger[- ]filter/i.test(e.message) && /conditionType: *'contact_detail', *tag:/.test(e.message),
  );
});

test('lintConditionShape: a well-formed condition passes through unchanged', () => {
  const c = { conditionType: 'contact_detail', conditionSubType: 'tags', conditionOperator: 'index-of-true', conditionValue: ['vip'] };
  assert.deepEqual(lintConditionShape(c), c);
});
