// bl-389: insertAfter took one step per op, and afterId could not name a ref an EARLIER op in the same call minted — a
// multi-step insert meant several ops on one anchor, last-step-first. bl-380: an anchor id had to be the full UUID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from './edit-driver.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('a'), catalog: loadCatalog(), warn: () => {} });
const live = () => [
  { id: 'aaaa1111-0000-4000-8000-000000000001', type: 'add_contact_tag', name: 'Head', order: 0, parentKey: null, next: 'bbbb2222-0000-4000-8000-000000000002', attributes: { tags: ['h'] } },
  { id: 'bbbb2222-0000-4000-8000-000000000002', type: 'add_contact_tag', name: 'Tail', order: 1, parentKey: 'aaaa1111-0000-4000-8000-000000000001', next: null, attributes: { tags: ['t'] } },
];
const tag = (ref, t) => ({ ref, kind: 'action', type: 'add_contact_tag', name: ref, attributes: { tags: [t] } });
const chain = (tpls) => { const byId = new Map(tpls.map((t) => [t.id, t])); const out = []; let cur = tpls.find((t) => !t.parentKey); while (cur) { out.push(cur.name); cur = byId.get(cur.next); } return out; };

test('insertAfter {steps:[...]} inserts the steps in the order written', () => {
  const c = ctx();
  const r = applyOps(live(), [{ op: 'insertAfter', afterId: 'aaaa1111-0000-4000-8000-000000000001', steps: [tag('one', 'a'), tag('two', 'b'), tag('three', 'c')] }], { ctx: c, idGen: c.idGen });
  assert.deepEqual(chain(r.templates), ['Head', 'one', 'two', 'three', 'Tail']);
  assert.equal(r.diff.createdSteps.length, 3);
});

test('a later op may anchor on a ref an earlier op in the same call minted', () => {
  const c = ctx();
  const r = applyOps(live(), [
    { op: 'insertAfter', afterId: 'aaaa1111-0000-4000-8000-000000000001', step: tag('first', 'a') },
    { op: 'insertAfter', afterId: 'first', step: tag('second', 'b') },
  ], { ctx: c, idGen: c.idGen });
  assert.deepEqual(chain(r.templates), ['Head', 'first', 'second', 'Tail']);
});

test('a unique id prefix (8+ characters) resolves to the step; an ambiguous or short one is refused by name', () => {
  const c = ctx();
  const r = applyOps(live(), [{ op: 'insertBefore', beforeId: 'bbbb2222', step: tag('mid', 'm') }], { ctx: c, idGen: c.idGen });
  assert.deepEqual(chain(r.templates), ['Head', 'mid', 'Tail']);
  const twins = [...live(), { ...live()[1], id: 'bbbb2222-9999-4000-8000-000000000009', name: 'Twin', parentKey: null }];
  assert.throws(() => applyOps(twins, [{ op: 'insertBefore', beforeId: 'bbbb2222', step: tag('x', 'x') }], { ctx: ctx(), idGen: makeSeededIdGen('b') }), /matches 2 steps/);
  assert.throws(() => applyOps(live(), [{ op: 'insertBefore', beforeId: 'bbbb', step: tag('x', 'x') }], { ctx: ctx(), idGen: makeSeededIdGen('c') }), /no step with id 'bbbb'/);
});

test('steps[] refuses a branching step anywhere but last, and step together with steps', () => {
  const branching = { ref: 'gate', kind: 'if_else', name: 'Gate', branches: [{ ref: 'y', name: 'Y', conditions: [{ conditionType: 'contact_detail', tag: 'v' }], then: [] }, { ref: 'n', name: 'N', else: true, then: [] }] };
  assert.throws(() => applyOps(live(), [{ op: 'insertAfter', afterId: 'aaaa1111-0000-4000-8000-000000000001', steps: [branching, tag('after', 'z')] }], { ctx: ctx(), idGen: makeSeededIdGen('d') }), /branching step .* last/);
  assert.throws(() => applyOps(live(), [{ op: 'insertAfter', afterId: 'aaaa1111-0000-4000-8000-000000000001', step: tag('a', 'a'), steps: [tag('b', 'b')] }], { ctx: ctx(), idGen: makeSeededIdGen('e') }), /either step \(one\) or steps/);
});

test('the op-shape check (run by edit_workflow before any op is applied) accepts insertAfter {steps} without step', async () => {
  const { checkOpShape } = await import('./edit-driver.mjs');
  assert.doesNotThrow(() => checkOpShape({ op: 'insertAfter', afterId: 'x', steps: [tag('a', 'a')] }));
  assert.throws(() => checkOpShape({ op: 'insertAfter', afterId: 'x' }), /missing required argument\(s\) \[step\]/);
});

test('expansion is what lets the pre-passes see steps[]: name resolution walks op.step only', async () => {
  const { opsNeedResolution, expandInsertSteps } = await import('./edit-driver.mjs');
  const ops = [{ op: 'insertAfter', afterId: 'x', steps: [{ ref: 'o', kind: 'action', type: 'create_opportunity', name: 'Opp', attributes: { pipeline: 'Sales', stage: 'New' } }] }];
  assert.equal(opsNeedResolution(ops), false, 'unexpanded: the pipeline NAME inside steps[] is invisible');
  assert.equal(opsNeedResolution(expandInsertSteps(ops)), true);
});

// Final review W6a (Important #4): readable ids are allowed (READABLE_STEP_ID warns), so a prefix match on any string
// silently retargeted: deleteStep 'welcome-sms' deleted 'welcome-sms-followup'. Prefixes now match UUID-shaped input only.
test('a non-UUID anchor never prefix-matches: welcome-sms does not hit welcome-sms-followup', () => {
  const tpls = [{ id: 'welcome-sms-followup', type: 'add_contact_tag', name: 'Follow-up', order: 0, parentKey: null, next: null, attributes: { tags: ['f'] } }];
  assert.throws(() => applyOps(tpls, [{ op: 'deleteStep', stepId: 'welcome-sms' }], { ctx: ctx(), idGen: makeSeededIdGen('f') }), /no step with id 'welcome-sms'/);
});

// Final review W6a (Important #5): the account resolver looks a modifyStep's stored type up by the EXACT id, before
// applyOps resolved the prefix — a prefix anchor's stage NAME reached the wire unresolved.
test('resolvePrefixAnchors turns a UUID prefix into the full id before the pre-passes run', async () => {
  const { resolvePrefixAnchors } = await import('./edit-driver.mjs');
  const out = resolvePrefixAnchors([{ op: 'modifyStep', stepId: 'bbbb2222', attrPatch: { pipeline: 'Main' } }, { op: 'insertAfter', afterId: 'first', step: tag('x', 'x') }], live());
  assert.equal(out[0].stepId, 'bbbb2222-0000-4000-8000-000000000002');
  assert.equal(out[1].afterId, 'first', 'a ref is left for applyOps to resolve');
});

test('resolveOps (used by the tool AND the CLI) resolves names on a modifyStep anchored by a UUID prefix', async () => {
  const { resolveOps } = await import('./edit-driver.mjs');
  const { buildResolvers } = await import('./resolve.mjs');
  const stored = [{ id: 'bbbb2222-0000-4000-8000-000000000002', type: 'internal_update_opportunity', name: 'Move', attributes: {} }];
  const resolvers = buildResolvers({ pipelines: [{ id: 'P1', name: 'Main', stages: [{ id: 'S2', name: 'Engaged' }] }], calendars: [], users: [], forms: [], agents: [], customFields: [] });
  const { ops } = resolveOps([{ op: 'modifyStep', stepId: 'bbbb2222', attrPatch: { pipeline: 'Main', stage: 'Engaged' } }], resolvers, stored);
  assert.equal(ops[0].attrPatch.pipelineId, 'P1');
  assert.equal(ops[0].attrPatch.stageId, 'S2');
});
