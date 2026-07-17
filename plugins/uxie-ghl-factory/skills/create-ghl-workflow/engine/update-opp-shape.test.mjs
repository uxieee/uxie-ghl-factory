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
