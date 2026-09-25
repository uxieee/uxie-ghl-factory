// W2-2: every workflow_goal condition must carry an `id`, or GHL refuses the save with
// "ID is required" (live 2026-09-25). The compiler mints the missing ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('g'), catalog: loadCatalog() });
const goalIR = (conditions) => ({
  name: 'Goal', triggers: [],
  graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag a', attributes: { tags: ['a'] } },
    { ref: 'g', kind: 'action', type: 'workflow_goal', name: 'Goal',
      attributes: { type: 'workflow_goal', action: 'continue', op: 'or', segments: [{ op: 'or', conditions }] } },
  ],
});
const goalConditions = (ir) => compile(ir, ctx()).autoSaveBody.workflowData.templates
  .find((t) => t.type === 'workflow_goal').attributes.segments.flatMap((s) => s.conditions);

test('a goal condition authored without an id gets a fresh one, distinct per condition', () => {
  const cs = goalConditions(goalIR([
    { goal_condition: 'add_contact_tag', extras: { tags: ['x'] } },
    { goal_condition: 'add_contact_tag', extras: { tags: ['y'] } },
  ]));
  assert.equal(cs.length, 2);
  for (const c of cs) assert.ok(typeof c.id === "string" && c.id.length > 0, "condition id minted");
  assert.notEqual(cs[0].id, cs[1].id);
  assert.deepEqual(cs.map((c) => c.extras.tags[0]), ['x', 'y']);
});

test('an author-supplied condition id is kept verbatim (control)', () => {
  const [c] = goalConditions(goalIR([{ id: 'keep-me', goal_condition: 'add_contact_tag', extras: { tags: ['x'] } }]));
  assert.equal(c.id, 'keep-me');
});

test('non-goal steps are untouched: no id lands on an add_contact_tag', () => {
  const t = compile(goalIR([{ goal_condition: 'add_contact_tag', extras: { tags: ['x'] } }]), ctx())
    .autoSaveBody.workflowData.templates.find((x) => x.type === 'add_contact_tag');
  assert.equal(t.attributes.segments, undefined);
});
