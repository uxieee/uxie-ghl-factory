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

test('type:"if_else" with no kind is inferred as kind:"if_else" and validated like one (F5-14)', () => {
  const ir = validIR();
  ir.graph[1] = { ref: 'b', type: 'if_else', name: 'B', branches: [
    { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail' }], then: [] },
    { ref: 'n', name: 'No', else: true, then: [] } ] };
  const out = parseIR(ir);
  assert.equal(out.graph[1].kind, 'if_else');
  const ir2 = validIR();
  ir2.graph[1] = { ref: 'b', type: 'if_else', name: 'B', branches: [
    { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail' }], then: [] } ] };
  assert.throws(() => parseIR(ir2), (e) => e.code === 'IFELSE_ARITY', 'the arity rule must now reach a type-spelled if_else');
});

test('type:"workflow_split" / "ai_decision" / goto-with-target are inferred too', () => {
  const ir = validIR();
  ir.graph[1] = { ref: 's', type: 'workflow_split', name: 'S', mode: 'random', paths: [{ ref: 'p1', then: [] }, { ref: 'p2', then: [] }] };
  assert.equal(parseIR(ir).graph[1].kind, 'split');
  const ir2 = validIR();
  ir2.graph[1] = { ref: 'd', type: 'ai_decision', name: 'D', branches: [{ ref: 'x', name: 'X', then: [] }] };
  assert.equal(parseIR(ir2).graph[1].kind, 'ai_decision');
  const ir3 = validIR();
  ir3.graph.push({ ref: 'g', type: 'goto', name: 'Back', target: 'a' });
  assert.equal(parseIR(ir3).graph.at(-1).kind, 'goto');
});

test('branches/paths/target on a node no container handler reads are refused (NODE_KEY), not silently dropped', () => {
  const ir = validIR();
  ir.graph[0] = { ref: 'a', kind: 'action', type: 'sms', name: 'A', attributes: { body: 'x' }, branches: [{ ref: 'y2', name: 'Y', then: [] }] };
  assert.throws(() => parseIR(ir), (e) => e.code === 'NODE_KEY' && /branches/.test(e.message));
  const ir2 = validIR();
  ir2.graph[0] = { ref: 'a', kind: 'action', type: 'sms', name: 'A', attributes: { body: 'x' }, paths: [] };
  assert.throws(() => parseIR(ir2), (e) => e.code === 'NODE_KEY' && /paths/.test(e.message));
});

// C-17, live: a build with `parentId` set to the folder every other Standard workflow lives in
// returned ok:true, a clean asset pre-flight, verify.pass 2 — and a workflow at the ROOT of the
// account. `parentId` was read by nothing and mentioned by nothing. The engine already refuses
// unknown keys one level down (NODE_KEY); the top level had no registry at all, so a typo'd
// `setings:` dies the same silent death.
test('an unknown TOP-LEVEL key is refused (TOP_KEY), not silently swallowed', () => {
  const ir = validIR();
  ir.parentId = 'ec63f9bf-0f2c-484c-a335-44afceb5879a';
  assert.throws(() => parseIR(ir), (e) => e.code === 'TOP_KEY' && /parentId/.test(e.message));

  const typo = validIR();
  typo.setings = { allowMultiple: true };
  assert.throws(() => parseIR(typo), (e) => e.code === 'TOP_KEY' && /setings/.test(e.message));
});

test('every top-level key the pipeline actually reads still parses', () => {
  const ir = validIR();
  Object.assign(ir, {
    name: 'W', settings: {}, stickyNotes: [], senderDefault: {},
    sampleWebhookPayload: {}, pinWebhookSample: false, workflowType: 'agent',
  });
  assert.ok(parseIR(ir));
});
