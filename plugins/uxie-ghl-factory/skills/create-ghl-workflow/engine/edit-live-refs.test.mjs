// F5-12: a goto authored in an edit op could not reference a LIVE step — compileSubgraph ran
// the compiler on a one-node IR with an empty refMap, so REF_DANGLING / GOTO_UNRESOLVED fired
// on a target that exists on the canvas. The commit-time guard (editCommitBody) was right; the
// compile-time check never let it run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, externalRefsOf } from './edit-driver.mjs';
import { editCommitBody } from './edit.mjs';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('r'), catalog: loadCatalog() });
const chain = () => [
  { id: 's1', type: 'add_contact_tag', name: 'Tag A', next: 's2', parentKey: null, order: 0, attributes: { tags: ['a'] } },
  { id: 's2', type: 'sms', name: 'Nudge', next: 's3', parentKey: 's1', order: 1, attributes: { body: 'hi' } },
  { id: 's3', type: 'sms', name: 'Nudge', next: null, parentKey: 's2', order: 2, attributes: { body: 'again' } },
];

test('externalRefsOf: live ids, unique names, and ambiguous names (null)', () => {
  const ext = externalRefsOf(chain());
  assert.deepEqual([...ext.ids].sort(), ['s1', 's2', 's3']);
  assert.equal(ext.byName.get('Tag A'), 's1');
  assert.equal(ext.byName.get('Nudge'), null, 'a duplicated name must resolve to nothing, never to the first hit');
});

test('a goto appended in an edit op may target a LIVE step by id or by unique name', () => {
  for (const target of ['s1', 'Tag A']) {
    const { templates, diff } = applyOps(chain(), [{ op: 'appendStep', step: { kind: 'goto', type: 'goto', name: 'Back to top', target } }], { ctx: ctx(), idGen: makeSeededIdGen('g') });
    const g = templates.find((t) => t.type === 'goto');
    assert.equal(g.attributes.targetNodeId, 's1', target);
    const fresh = { status: 'draft', version: 1, workflowData: { templates: chain() } };
    assert.doesNotThrow(() => editCommitBody(fresh, templates, diff, 'uid', { allowGotoLoops: true }));
  }
});

test('an ambiguous live name is REF_AMBIGUOUS; a ghost is GOTO_UNRESOLVED', () => {
  assert.throws(() => applyOps(chain(), [{ op: 'appendStep', step: { kind: 'goto', name: 'x', target: 'Nudge' } }], { ctx: ctx(), idGen: makeSeededIdGen('g') }),
    (e) => e.code === 'REF_AMBIGUOUS' && /Nudge/.test(e.message));
  assert.throws(() => applyOps(chain(), [{ op: 'appendStep', step: { kind: 'goto', name: 'x', target: 'ghost' } }], { ctx: ctx(), idGen: makeSeededIdGen('g') }),
    (e) => e.code === 'GOTO_UNRESOLVED');
});

test('an authored ref wins a collision with a live step name', () => {
  const ops = [
    { op: 'appendStep', step: { ref: 'Tag A', kind: 'action', type: 'add_contact_tag', name: 'New tag', attributes: { tags: ['z'] } } },
    { op: 'appendStep', step: { kind: 'goto', name: 'Jump', target: 'Tag A' } },
  ];
  const { templates, opRefs } = applyOps(chain(), ops, { ctx: ctx(), idGen: makeSeededIdGen('g') });
  const minted = opRefs.get('Tag A');
  assert.ok(minted && minted !== 's1', 'the ref minted in op 1 must be recorded');
  assert.equal(templates.find((t) => t.type === 'goto').attributes.targetNodeId, minted);
});

test('a raw goto template with attributes.targetNodeId pointing at a live step passes the chokepoint', () => {
  const step = { type: 'goto', name: 'Raw jump', attributes: { targetNodeId: 's2', type: 'goto' } };
  const { templates } = applyOps(chain(), [{ op: 'appendStep', step }], { ctx: ctx(), idGen: makeSeededIdGen('g') });
  assert.equal(templates.find((t) => t.name === 'Raw jump').attributes.targetNodeId, 's2');
});

test('compile() on a fresh build is unchanged: no externalRefs, a dangling ref still throws', () => {
  const ir = { name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['a'] } }, { ref: 'g', kind: 'goto', name: 'G', target: 'nope' }] };
  assert.throws(() => compile(ir, ctx()), (e) => e.code === 'GOTO_UNRESOLVED');
});
