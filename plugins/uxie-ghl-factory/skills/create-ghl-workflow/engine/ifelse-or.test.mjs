// If/Else OR: the builder toggles a segment's operator and|or (components/conditions/Segments.vue:69-83); the engine always
// wrote operator 'and', so an OR branch could not be authored. A branch now takes `op: 'and' | 'or'`. Unknown branch keys were
// silently ignored (e.g. `operator: 'or'` built an AND branch) — now refused with BRANCH_KEY, same class as TRIGGER_KEY / NODE_KEY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';

const T = (t) => ({ conditionType: 'contact_detail', tag: t });
const ifElse = (branch) => {
  let n = 0;
  return compile({ name: 'wf', triggers: [], graph: [{ ref: 'g', kind: 'if_else', name: 'G', branches: [
    { ref: 'y', name: 'Yes', conditions: [T('x'), T('y')], then: [], ...branch }, { ref: 'n', name: 'Else', else: true, then: [] }] }] },
  { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: () => `id-${++n}`, catalog: loadCatalog(), warn: () => {} })
    .autoSaveBody.workflowData.templates.find((t) => t.attributes?.branches?.length).attributes.branches[0];
};

test("op: 'or' writes the segment operator or; default stays and", () => {
  assert.equal(ifElse({ op: 'or' }).segments[0].operator, 'or');
  assert.equal(ifElse({}).segments[0].operator, 'and');
  assert.equal(ifElse({ op: 'and' }).segments[0].operator, 'and');
});

test('an unknown branch key is refused, not dropped', () => {
  assert.throws(() => ifElse({ operator: 'or' }), (e) => e.code === 'BRANCH_KEY' && /\[operator\]/.test(e.message));
  assert.throws(() => ifElse({ op: 'xor' }), (e) => e.code === 'BRANCH_OP');
});
