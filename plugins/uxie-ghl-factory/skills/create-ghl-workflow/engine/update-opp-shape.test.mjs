import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { STANDARD_OPP_FIELDS, OPP_RULEBOOK } from './opp-shapes.mjs';
import { readFileSync } from 'node:fs';

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

// --- lostReasonId + the rest of the builder's field picker (2026-08-03) ---------------
// GROUND TRUTH for the shape: a step built BY HAND in the GHL builder on a throwaway Grom UK
// workflow, read back from backend.leadconnectorhq.com/workflow/{loc}/{wid} on 2026-08-03.
// Pinned field-for-field. Do not "tidy" this literal — it is a live capture.
const HARVESTED_LOST_REASON = {
  __customInputs__: {},
  dataType: 'SINGLE_OPTIONS',
  filterField: 'lostReasonId',
  value: '<lostReasonId>',
  valueFieldType: 'select',
};

const oppUpdateAttrs = (attributes) => ({
  triggers: [{ type: 'contact_tag', name: 'T', filters: [] }],
  graph: [{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Upd', assocGuaranteed: true, attributes }],
});

test('update_opportunity lostReasonId compiles field-for-field to the harvested builder shape', () => {
  const built = compile(oppUpdateAttrs({ status: 'lost', lostReasonId: '<lostReasonId>' }), baseCtx());
  const lr = fieldOf(built, 'lostReasonId');
  assert.ok(lr, 'lostReasonId field emitted');
  // key set and every value, both directions — no extra keys, no missing keys
  assert.deepEqual(Object.keys(lr).sort(), Object.keys(HARVESTED_LOST_REASON).sort());
  assert.deepEqual(lr, HARVESTED_LOST_REASON);
});

test('create_opportunity lostReasonId compiles to the same harvested shape', () => {
  const built = compile({
    triggers: [{ type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'c', kind: 'action', type: 'create_opportunity', name: 'Create',
      attributes: { pipelineId: 'P', stageId: 'S', status: 'lost', lostReasonId: '<lostReasonId>' } }],
  }, baseCtx());
  const opp = built.autoSaveBody.workflowData.templates.find((t) => t.attributes?.__customInputFields__);
  const lr = opp.attributes.__customInputFields__.find((x) => x.filterField === 'lostReasonId');
  assert.deepEqual(lr, HARVESTED_LOST_REASON);
});

test('updates[] lostReasonId with an explicit dataType emits the harvested shape too', () => {
  const built = compile(oppUpdateAttrs({ updates: [
    { field: 'status', value: 'lost' },
    { field: 'lostReasonId', value: '<lostReasonId>', dataType: 'SINGLE_OPTIONS' },
  ] }), baseCtx());
  assert.deepEqual(fieldOf(built, 'lostReasonId'), HARVESTED_LOST_REASON);
});

// The prerequisite. The builder's own generator DELETES a lostReasonId entry whose step has no
// status:'lost' (checkForDependantOptions), so this must fail closed at compile — the
// EMPTY_STEP / OPP_UNASSOCIATED class of "builds clean, does nothing at runtime".
test('lostReasonId with NO status field fails closed', () => {
  assert.throws(
    () => compile(oppUpdateAttrs({ lostReasonId: 'LR1' }), baseCtx()),
    (e) => e.code === 'OPP_LOST_REASON_NO_LOST_STATUS' && /has no 'status' field/.test(e.message),
  );
});

test("lostReasonId with a non-lost status fails closed", () => {
  assert.throws(
    () => compile(oppUpdateAttrs({ status: 'won', lostReasonId: 'LR1' }), baseCtx()),
    (e) => e.code === 'OPP_LOST_REASON_NO_LOST_STATUS' && /status is 'won', not 'lost'/.test(e.message),
  );
});

test('lostReasonId fails closed on the updates[] path as well as the name path', () => {
  assert.throws(
    () => compile(oppUpdateAttrs({ updates: [{ field: 'lostReasonId', value: 'LR1' }] }), baseCtx()),
    (e) => e.code === 'OPP_LOST_REASON_NO_LOST_STATUS',
  );
});

test('create_opportunity lostReasonId fails closed too (status defaults to open)', () => {
  assert.throws(
    () => compile({
      triggers: [{ type: 'contact_tag', name: 'T', filters: [] }],
      graph: [{ ref: 'c', kind: 'action', type: 'create_opportunity', name: 'Create',
        attributes: { pipelineId: 'P', stageId: 'S', lostReasonId: 'LR1' } }],
    }, baseCtx()),
    (e) => e.code === 'OPP_LOST_REASON_NO_LOST_STATUS' && /status is 'open', not 'lost'/.test(e.message),
  );
});

// A merge-field status can't be proven 'lost' at compile time. Fail loud rather than emit a
// step whose reason the builder will strip.
test('lostReasonId with a merge-field status fails closed and says why', () => {
  assert.throws(
    () => compile(oppUpdateAttrs({ status: '{{contact.deal_status}}', lostReasonId: 'LR1' }), baseCtx()),
    (e) => e.code === 'OPP_LOST_REASON_NO_LOST_STATUS' && /merge-field status/.test(e.message),
  );
});

// Fidelity: the builder can only ever produce status-before-lostReason (the picker option is
// disabled until status is 'lost'), so the compiler emits that order on the updates[] path too.
test('status is reordered to precede lostReasonId', () => {
  const built = compile(oppUpdateAttrs({ updates: [
    { field: 'lostReasonId', value: 'LR1', dataType: 'SINGLE_OPTIONS' },
    { field: 'status', value: 'lost' },
  ] }), baseCtx());
  const order = oppFields(built).map((x) => x.filterField);
  assert.ok(order.indexOf('status') < order.indexOf('lostReasonId'), `status must precede lostReasonId, got ${order}`);
});

// Regression guard on the original bug: authoring a real picker field must not be rejected
// before any network call just because no sampled account happened to have written it.
test('every field in the builder picker is a STANDARD_OPP_FIELD (no OPP_FIELD_UNKNOWN)', () => {
  for (const ff of Object.keys(OPP_RULEBOOK.fields))
    assert.ok(STANDARD_OPP_FIELDS.has(ff), `${ff} missing from STANDARD_OPP_FIELDS`);
  assert.equal(STANDARD_OPP_FIELDS.size >= 9, true);
});

test('forecast fields compile with the picker-defined shapes', () => {
  const built = compile(oppUpdateAttrs({ forecastExpectedCloseDate: '2026-09-01', forecastProbability: '75' }), baseCtx());
  const d = fieldOf(built, 'forecastExpectedCloseDate');
  assert.deepEqual(d, { __customInputs__: {}, filterField: 'forecastExpectedCloseDate', value: '2026-09-01', valueFieldType: 'date', dataType: 'DATE' });
  const p = fieldOf(built, 'forecastProbability');
  assert.equal(p.valueFieldType, 'numerical');
  assert.equal(p.dataType, 'NUMERICAL');
  assert.equal(p.value, 75);            // numeric coercion, same as monetaryValue
  assert.equal(typeof p.value, 'number');
});

// The corpus file must never silently contradict the builder's own definition. If it ever does,
// one of the two is stale and a human has to decide which — don't let it pass quietly.
test('rulebook and corpus agree on every field they share', () => {
  const corpus = JSON.parse(readFileSync(new URL('../catalog/opp-field-shapes.json', import.meta.url), 'utf8'));
  for (const [ff, rule] of Object.entries(OPP_RULEBOOK.fields)) {
    const c = corpus.fields[ff];
    if (!c) continue;
    for (const key of ['valueFieldType', 'dataType'])
      if (c[key]) assert.ok(c[key].allowed.includes(rule[key]),
        `${ff}.${key}: rulebook says '${rule[key]}', corpus attests [${c[key].allowed}]`);
  }
});

// A wrong shape on a rulebook-only field is a definite defect (the builder assigns dataType
// unconditionally from its table — there is no per-account dialect to hide in), so it throws.
test('a rulebook-only field with a contradicted dataType throws OPP_SHAPE', () => {
  assert.throws(
    () => compile(oppUpdateAttrs({ updates: [
      { field: 'status', value: 'lost' },
      { field: 'lostReasonId', value: 'LR1', dataType: 'TEXT' },
    ] }), baseCtx()),
    (e) => e.code === 'OPP_SHAPE' && /contradicts the builder's own field picker/.test(e.message),
  );
});
