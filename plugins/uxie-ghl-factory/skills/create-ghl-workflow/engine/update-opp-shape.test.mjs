import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const baseCtx = (over = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog(), ...over });
// assocGuaranteed:true (+kind/name) so the OPP_UNASSOCIATED invariant doesn't abort
// BEFORE field resolution — we want the classifier exercised, not the association guard.
const oppUpdate = (updates) => ({
  triggers: [{ type: 'contact_tag', name: 'T', filters: [] }],
  graph: [{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Upd', assocGuaranteed: true, attributes: { updates } }],
});
const oppFields = (built) => built.autoSaveBody.workflowData.templates
  .find((t) => t.attributes?.__customInputFields__)?.attributes.__customInputFields__ ?? [];
const fieldOf = (built, ff) => oppFields(built).find((x) => x.filterField === ff);

test('updates[] name with no dataType resolves to attested string, no SINGLE_OPTIONS', () => {
  const built = compile(oppUpdate([{ field: 'name', value: 'Deal X' }]), baseCtx());
  const f = fieldOf(built, 'name');
  assert.equal(f.valueFieldType, 'string');
  assert.equal('dataType' in f, false);
});

test('updates[] genuinely unknown field throws OPP_FIELD_UNKNOWN', () => {
  assert.throws(
    () => compile(oppUpdate([{ field: 'contact.not_a_field', value: 'x' }]), baseCtx({ customFields: [] })),
    (e) => e.code === 'OPP_FIELD_UNKNOWN' && /neither a standard opportunity field/.test(e.message),
  );
});

test('updates[] known custom field warns and passes through (row 2, join pending)', () => {
  const warnings = [];
  const ctx = baseCtx({ customFields: [{ id: 'cf1', name: 'Deposit Amount', fieldKey: 'contact.deposit_amount', dataType: 'MONETORY' }], warn: (m) => warnings.push(m) });
  const built = compile(oppUpdate([{ field: 'cf1', value: '2000' }]), ctx);
  assert.ok(fieldOf(built, 'cf1'), 'custom field emitted');
  assert.equal(warnings.filter((w) => /custom field/.test(w)).length, 1);
});

// Regression: the edit path builds a ctx WITHOUT customFields. A real custom field then
// misses ctx.customFields (undefined) and used to fall through to the OPP_FIELD_UNKNOWN
// throw — a false throw that hard-failed a previously-working edit on a live account. The
// engine may only claim a field is "unknown" when it actually HAS the account's field list.
test('updates[] custom field with NO customFields list does NOT throw — degrades to passthrough + warns', () => {
  const warnings = [];
  const ctx = baseCtx({ warn: (m) => warnings.push(m) });   // note: NO customFields key
  assert.equal('customFields' in ctx, false, 'ctx must have no customFields list');
  let built;
  assert.doesNotThrow(() => { built = compile(oppUpdate([{ field: 'contact.deposit_amount', value: '2000' }]), ctx); });
  const f = fieldOf(built, 'contact.deposit_amount');
  assert.ok(f, 'field emitted as authored');
  assert.equal(f.valueFieldType, 'string');
  assert.equal(warnings.filter((w) => /not classified \(no customFields list/.test(w)).length, 1);
});

// monetaryValue name-path (the fallback, NOT updates[]) must emit the attested
// valueFieldType 'numerical'. 'number' is 0-attested in the live corpus.
test("update_opportunity name-path monetaryValue emits valueFieldType 'numerical'", () => {
  const spec = {
    triggers: [{ type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Upd', assocGuaranteed: true, attributes: { value: 2000 } }],
  };
  const built = compile(spec, baseCtx());
  const opp = built.autoSaveBody.workflowData.templates.find((t) => t.attributes?.__customInputFields__);
  const mv = opp.attributes.__customInputFields__.find((x) => x.filterField === 'monetaryValue');
  assert.ok(mv, 'monetaryValue field emitted');
  assert.equal(mv.valueFieldType, 'numerical');
});

// --- monetaryValue numeric-value fix (2026-07-18) --------------------------------
// GROUND TRUTH: factory-findings-2026-07-18/opportunity-monetaryvalue-plugin-bug.md.
// The builder stores monetaryValue as a NUMBER and won't load a stringified value into
// its model — a create/update-opportunity node whose Opportunity Value was emitted as a
// string ("180") renders EMPTY in the builder and a later UI save silently blanks it.
// The builder-native shape is { value:180 (number), valueFieldType:'numerical',
// dataType:'NUMERICAL' }. The engine used to emit String(a.value) — assert it now emits
// a NUMBER across BOTH the create and update paths, and that string fields are untouched.
const oppCreate = (attributes) => ({
  triggers: [{ type: 'contact_tag', name: 'T', filters: [] }],
  graph: [{ ref: 'c', kind: 'action', type: 'create_opportunity', name: 'Create',
    attributes: { pipelineId: 'P', stageId: 'S', ...attributes } }],
});
const createFieldOf = (spec, ff) => {
  const built = compile(spec, baseCtx());
  const opp = built.autoSaveBody.workflowData.templates.find((t) => t.attributes?.__customInputFields__);
  return opp.attributes.__customInputFields__.find((x) => x.filterField === ff);
};

test('create_opportunity monetaryValue compiles to the builder-native shape (numeric value + numerical + NUMERICAL)', () => {
  const mv = createFieldOf(oppCreate({ name: 'Deal', value: 180 }), 'monetaryValue');
  assert.ok(mv, 'monetaryValue field emitted');
  assert.equal(mv.value, 180);
  assert.equal(typeof mv.value, 'number');
  assert.equal(mv.valueFieldType, 'numerical');
  assert.equal(mv.dataType, 'NUMERICAL');
});

test('create_opportunity monetaryValue authored as a numeric STRING still emits a number', () => {
  const mv = createFieldOf(oppCreate({ value: '2000' }), 'monetaryValue');
  assert.equal(mv.value, 2000);
  assert.equal(typeof mv.value, 'number');
  assert.equal(mv.valueFieldType, 'numerical');
});

test('create_opportunity name (string field) keeps string value + dataType TEXT, never coerced', () => {
  const nm = createFieldOf(oppCreate({ name: '2024 Deal', value: 180 }), 'name');
  assert.equal(nm.value, '2024 Deal');
  assert.equal(typeof nm.value, 'string');
  assert.equal(nm.valueFieldType, 'string');
  assert.equal(nm.dataType, 'TEXT');
});

test('update_opportunity name-path monetaryValue emits a NUMBER + NUMERICAL, not a string', () => {
  const spec = {
    triggers: [{ type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Upd', assocGuaranteed: true, attributes: { value: '2000' } }],
  };
  const mv = fieldOf(compile(spec, baseCtx()), 'monetaryValue');
  assert.equal(mv.value, 2000);
  assert.equal(typeof mv.value, 'number');
  assert.equal(mv.valueFieldType, 'numerical');
  assert.equal(mv.dataType, 'NUMERICAL');
});

test('update_opportunity updates[] monetaryValue coerces a string value to a number', () => {
  const mv = fieldOf(compile(oppUpdate([{ field: 'monetaryValue', value: '2000' }]), baseCtx()), 'monetaryValue');
  assert.equal(mv.value, 2000);
  assert.equal(typeof mv.value, 'number');
  assert.equal(mv.valueFieldType, 'numerical');
});

test('monetaryValue authored as a merge-field token is NOT coerced (survives as a string)', () => {
  const mv = fieldOf(compile(oppUpdate([{ field: 'monetaryValue', value: '{{contact.deal_value}}' }]), baseCtx()), 'monetaryValue');
  assert.equal(mv.value, '{{contact.deal_value}}');
  assert.equal(typeof mv.value, 'string');
});
