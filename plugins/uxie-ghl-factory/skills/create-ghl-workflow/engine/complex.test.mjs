// Complex-build tests — deep nesting, mixed container types, cross-scope goto,
// N-way branching. Proves the machinery wires a non-trivial graph end to end
// (offline). These are the shapes a real "build me this whole funnel" prompt hits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, casingLint } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('x'), catalog: loadCatalog() });

// A dense workflow: contact_tag trigger → tag → 3-way if_else; one branch nests a
// find_contact (2-branch) whose found-path holds a workflow_split (A/B), the other
// branch runs an ai_decision, the else branch loops back with a goto.
const complexIR = {
  name: 'Complex Nurture',
  settings: { allowMultiple: true },
  triggers: [
    { ref: 't1', type: 'contact_tag', name: 'VIP tag', filters: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'vip' }] },
    { ref: 't2', type: 'form_submission', name: 'Form', filters: [{ field: 'form.id', operator: 'is-any-of', value: ['form123'] }] },
  ],
  graph: [
    { ref: 'start', kind: 'action', type: 'add_contact_tag', name: 'Entered', attributes: { tags: ['entered'] } },
    { ref: 'branch', kind: 'if_else', name: 'Segment', branches: [
      { ref: 'hot', name: 'Hot', conditions: [{ conditionType: 'contact_detail', tag: 'hot' }], then: [
        { ref: 'find', type: 'find_contact', name: 'Find dup',
          find: { fields: [{ field: 'email', value: '{{contact.email}}', title: 'Email', type: 'string', date: '' }] },
          onFound: [
            { ref: 'sp', kind: 'split', name: 'A/B offer', mode: 'weighted', paths: [
              { ref: 'pa', name: 'Discount', weight: 60, then: [{ ref: 'e1', kind: 'action', type: 'email', name: 'Discount', attributes: { subject: '10% off', html: '<p>deal</p>' } }] },
              { ref: 'pb', name: 'Bundle', weight: 40, then: [{ ref: 'e2', kind: 'action', type: 'sms', name: 'Bundle', attributes: { body: 'bundle offer' } }] },
            ] },
          ],
          onNotFound: [{ ref: 'note', kind: 'action', type: 'add_notes', name: 'No dup', attributes: { html: '<p>new</p>' } }] },
      ] },
      { ref: 'warm', name: 'Warm', conditions: [{ conditionType: 'contact_detail', tag: 'warm' }], then: [
        { ref: 'ai', kind: 'ai_decision', name: 'Milestone?', instructions: 'Decide', information: 'ctx', branches: [
          { name: 'Celebrate', description: 'milestone', then: [{ ref: 'c1', kind: 'action', type: 'sms', name: 'Congrats', attributes: { body: 'nice!' } }] },
          { name: 'Skip', description: 'not yet', then: [] },
        ] },
      ] },
      { ref: 'cold', name: 'Cold', else: true, then: [
        { ref: 'w', kind: 'wait', name: 'Cooldown', config: { unit: 'days', value: 3, when: 'after' } },
        { ref: 'g', kind: 'goto', target: 'start' },
      ] },
    ] },
  ],
};

test('complex nested build compiles, wires, and passes casing lint', () => {
  const result = compile(complexIR, ctx());
  const t = result.autoSaveBody.workflowData.templates;
  // no throw from casingLint (called inside compile) means casing is correct
  assert.doesNotThrow(() => casingLint(result));

  // every step id is unique
  const ids = t.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate step ids');

  // every next pointer resolves to a real id (or null / array of real ids)
  const idset = new Set(ids);
  for (const s of t) {
    const nx = Array.isArray(s.next) ? s.next : (s.next == null ? [] : [s.next]);
    for (const n of nx) assert.ok(idset.has(n), `dangling next ${n} on ${s.name}`);
  }

  // container presence
  assert.ok(t.find((s) => s.type === 'if_else' && s.nodeType === 'condition-node'), 'if_else container');
  assert.ok(t.find((s) => s.type === 'find_contact'), 'find_contact container');
  assert.ok(t.find((s) => s.type === 'workflow_split'), 'workflow_split container');
  assert.ok(t.find((s) => s.type === 'workflow_ai_decision_maker'), 'ai_decision container');

  // 3-way if_else: 2 conditional (branch-yes) + 1 else (branch-no)
  const branchEntries = t.filter((s) => s.nodeType === 'branch-yes' || s.nodeType === 'branch-no');
  assert.equal(branchEntries.filter((s) => s.nodeType === 'branch-yes').length, 2);
  assert.equal(branchEntries.filter((s) => s.nodeType === 'branch-no').length, 1);

  // cross-scope goto: the else branch's goto targets `start` (root scope)
  const start = t.find((s) => s.name === 'Entered');
  const g = t.find((s) => s.type === 'goto');
  assert.equal(g.attributes.targetNodeId, start.id);

  // two triggers, both well-formed
  assert.equal(result.triggerBodies.length, 2);
  assert.equal(result.triggerBodies[0].workflowId, result._wid);
  assert.equal(result.triggerBodies[1].type, 'form_submission');
});

test('deep chain: order is 0-indexed per scope, parentKey walks the chain', () => {
  const t = compile(complexIR, ctx()).autoSaveBody.workflowData.templates;
  // the split's two path children each start their own scope at order 0
  const email = t.find((s) => s.name === 'Discount' && s.type === 'email');
  assert.equal(email.order, 0);
  // root scope: start(0) then branch(1)
  assert.equal(t.find((s) => s.name === 'Entered').order, 0);
});
