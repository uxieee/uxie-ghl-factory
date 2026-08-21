import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { evaluateIfElseVocab, checkIfElseVocab } from './ifelse-vocab.mjs';

const catalog = loadCatalog();
const V = catalog.ifElseConditions;
const node = (conds) => [{ id: 'c1', type: 'if_else', nodeType: 'condition-node', name: 'Cond', attributes: { if: true, branches: [{ name: 'Yes', segments: [{ operator: 'and', conditions: conds }] }] } }];
const cond = (o) => ({ conditionType: 'contact_detail', conditionSubType: 'email', conditionOperator: '==', conditionValue: 'x', ...o });
const fires = (conds, ctx = {}) => evaluateIfElseVocab(node(conds), V, ctx).map((f) => f.msg);

test('catalog carries the if/else vocabulary with corpus evidence', () => {
  assert.ok(V.groups.length > 50 && V.operatorTable.string && V.dateFieldOperators.includes('inTheNext'));
  assert.deepEqual(V.dynamicLeafGroups, ['contact_detail', 'opportunities']);
  assert.deepEqual(V.legacyOperators, { select: ['is'] });
});

test('a picker-legal condition passes; a misspelled subtype and an illegal operator refuse', () => {
  assert.deepEqual(fires([cond()]), []);
  // contact_detail is a dynamic-leaf group: offline an unknown subtype is unknowable (a custom field id);
  // a NON-dynamic group refuses a misspelled subtype outright
  assert.deepEqual(fires([cond({ conditionSubType: 'emial' })]), []);
  assert.match(fires([{ conditionType: 'appointment', conditionSubType: 'appointmentReschedule', conditionOperator: '==', conditionValue: true }])[0], /not a field of 'appointment'/);
  assert.match(fires([cond({ conditionSubType: 'emial' })], { customFields: [{ id: 'KL8gawfrMk1OafgTo3lF', dataType: 'TEXT' }] })[0], /matches no custom field/);
  assert.match(fires([cond({ conditionOperator: 'between' })])[0], /operator 'between' is not legal/);   // string leaf: no between
  assert.match(fires([cond({ conditionType: 'contct_detail' })])[0], /conditionType 'contct_detail'/);
});

test('corpus-evidenced tolerances: legacy `is` on select leaves; custom-field ids under contact_detail/opportunities', () => {
  assert.deepEqual(fires([{ conditionType: 'appointment', conditionSubType: 'appointmentRescheduled', conditionOperator: 'is', conditionValue: true }]), []);
  assert.deepEqual(fires([cond({ conditionSubType: 'KL8gawfrMk1OafgTo3lF', conditionOperator: '==' })]), []);        // no field list → unknowable, never wrong
  // with the account's custom fields known, the field's dataType decides the operator set
  const ctx = { customFields: [{ id: 'KL8gawfrMk1OafgTo3lF', dataType: 'NUMERICAL' }] };
  assert.deepEqual(fires([cond({ conditionSubType: 'KL8gawfrMk1OafgTo3lF', conditionOperator: '>' })], ctx), []);
  assert.match(fires([cond({ conditionSubType: 'KL8gawfrMk1OafgTo3lF', conditionOperator: 'contain' })], ctx)[0], /operator 'contain' is not legal/);
  assert.match(fires([cond({ conditionSubType: 'ZZZZZZZZZZZZZZZZZZZZ', conditionOperator: '==' })], ctx)[0], /matches no custom field/);
});

test('runtime-populated groups are never judged; date rules are', () => {
  assert.deepEqual(fires([{ conditionType: 'chatgpt', conditionSubType: 'anything.goes', conditionOperator: 'weird', conditionValue: 'x' }]), []);
  const date = (o) => ({ conditionType: 'contact_detail', conditionSubType: 'last_appointment', conditionOperator: '==', ...o });
  assert.deepEqual(fires([date({ conditionValueOperator: 'inTheNext', conditionValueUnit: 'days', conditionValue: 3 })]), []);
  assert.match(fires([date({ conditionValueOperator: 'inTheNext', conditionValue: 3 })])[0], /requires conditionValueUnit/);
  assert.match(fires([date({ conditionValueOperator: 'soonish' })])[0], /date sub-operator 'soonish'/);
});

test('checkIfElseVocab throws IFELSE_VOCAB at compile; hatch skips; the engine\'s own tag expansion passes', () => {
  const bad = node([cond({ conditionOperator: 'between' })]);
  assert.throws(() => checkIfElseVocab(bad, catalog, {}), /IFELSE_VOCAB[\s\S]*between/);
  assert.deepEqual(checkIfElseVocab(bad, catalog, { skipIfElseVocab: true }), []);
  const ctx = { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog };
  const built = compile({ name: 'V', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'c', kind: 'if_else', name: 'Has tag?', branches: [
      { name: 'Yes', conditions: [{ conditionType: 'contact_detail', tag: 'vip' }], then: [{ ref: 's', kind: 'action', type: 'sms', name: 'S', attributes: { body: 'hi' } }] },
      { name: 'No', conditions: [{ conditionType: 'contact_detail', tag: 'vip', not: true }], then: [] } ] }] }, ctx);
  assert.ok(built.autoSaveBody.workflowData.templates.some((t) => t.type === 'if_else'));
});
