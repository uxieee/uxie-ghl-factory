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
