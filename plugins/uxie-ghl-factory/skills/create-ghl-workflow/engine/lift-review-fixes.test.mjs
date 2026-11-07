// W6b final review: five ways an EDITED lifted spec, or a NEW build from one, went wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { liftWorkflow } from './lift.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { ALL, code } from './fixtures/all-containers.mjs';

const catalog = loadCatalog();
const ctx = (seed, extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen(seed), catalog, warn: () => {}, ...extra });
const T = (b) => b.autoSaveBody.workflowData.templates;
const SCOPES = ['then', 'onFound', 'onNotFound', 'onBooked', 'onNotBooked', 'onEvent', 'onTimeout', 'default'];
const findNode = (nodes, pred) => { for (const n of nodes ?? []) { if (pred(n)) return n; for (const k of SCOPES) { const x = findNode(n[k], pred); if (x) return x; } for (const b of [...(n.branches ?? []), ...(n.paths ?? [])]) { const x = findNode(b.then, pred); if (x) return x; } } return null; };
function lifted(mutate = () => {}, triggers = []) {
  const built = compile(structuredClone(ALL), ctx('w'));
  const doc = { name: 'x', workflowData: { templates: structuredClone(T(built)) }, meta: built.autoSaveBody.meta };
  mutate(doc.workflowData.templates, built._refMap);
  return { built, doc, l: liftWorkflow({ doc, triggers }, { catalog }) };
}
const pinned = (ir, seed = 'p') => compile(structuredClone(ir), ctx(seed, { pinIds: true, pins: ir.stored.pins }));

test('I2: deleting an array row does not shift a stored-only key onto the next row', () => {
  const { l, doc, built } = lifted((ts, ref) => {
    const fo = ts.find((t) => t.id === ref.get('fo'));
    fo.attributes.__customInputFields__ = [
      { __customInputs__: {}, filterField: 'pipeline_id', value: 'eq', secondValue: 'P1', dataType: 'STRING_PIPELINE' },
      { __customInputs__: {}, filterField: 'monetary_value', value: 'gt', secondValue: '5', dataType: 'MONETARY' },
    ];
  });
  const ir = structuredClone(l.ir);
  findNode(ir.graph, (n) => n.ref === built._refMap.get('fo')).find.filters.shift();
  const rows = T(pinned(ir)).find((t) => t.id === built._refMap.get('fo')).attributes.__customInputFields__;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].dataType, 'STRING_PIPELINE', 'the deleted row\'s stored dataType landed on the survivor');
  assert.ok(doc);
});

test('I3: a copied node does not keep a stored stepIndex, and every index of a type stays unique', () => {
  const { l } = lifted();
  const ir = structuredClone(l.ir);
  const c1 = findNode(ir.graph, (n) => n.type === 'custom_code');
  const lane = findNode(ir.graph, (n) => Array.isArray(n.branches) && n.kind === 'if_else').branches[1];
  lane.then.push({ ...structuredClone(c1), ref: 'c1copy' });
  const codes = T(pinned(ir)).filter((t) => t.type === 'custom_code').map((t) => t.stepIndex);
  assert.equal(new Set(codes).size, codes.length, `duplicate stepIndex: ${codes}`);
});

test('I3: a node retyped in place drops its old stepIndex and the old type\'s residual', () => {
  const { l, built } = lifted((ts, ref) => { ts.find((t) => t.id === ref.get('code1')).attributes.uiOnlyKey = 'stale'; });
  const ir = structuredClone(l.ir);
  const n = findNode(ir.graph, (x) => x.ref === built._refMap.get('code1'));
  Object.assign(n, { type: 'add_contact_tag', attributes: { tags: ['t'] } });
  const step = T(pinned(ir)).find((t) => t.id === built._refMap.get('code1'));
  assert.equal(step.stepIndex, undefined);
  assert.equal(step.attributes.uiOnlyKey, undefined);
});

test('I4: a NEW build renames the source trigger id inside a frozen step to the new trigger', () => {
  const TRIG = 'SOURCE-TRIGGER-ID-0001';
  const { l, built } = lifted((ts, ref) => {
    const ie = ts.find((t) => t.id === ref.get('ie'));
    ie.attributes.branches[0].segments.push({ __segmentId: 'SEG-2', operator: 'or', conditions: [{ conditionType: 'trigger', conditionSubType: 'trigger', conditionOperator: 'is', conditionValue: TRIG }] });
  }, [{ id: TRIG, type: 'contact_tag', name: 'Tag', conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'go', title: 'Tag Added', type: 'select', id: 'tag-added' }] }]);
  assert.ok(l.ir.stored.frozen[built._refMap.get('ie')], 'the two-segment if/else is frozen');
  const fresh = compile(structuredClone(l.ir), ctx('n'));
  const wire = JSON.stringify(T(fresh));
  assert.ok(!wire.includes(TRIG), 'the source trigger id stayed in the copy');
  assert.ok(wire.includes(fresh.triggerBodies[0]._placeholderId), 'routes on the new trigger');
});

test('I5: a node added to an exported spec gets a fresh id, not its ref', () => {
  const { l } = lifted();
  const ir = structuredClone(l.ir);
  findNode(ir.graph, (n) => n.kind === 'if_else').branches[1].then.push(code('c1copy'));
  const ts = T(pinned(ir));
  assert.ok(!ts.some((t) => t.id === 'c1copy'));
  const added = ts.find((t) => t.name === 'c1copy');
  assert.match(added.id, /^p0{7}-0{4}-4000-8000-\d{12}$/, 'minted by the id generator');
});
