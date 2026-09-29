// Author-time warnings for measured asset behaviour (coordinator ruling 2026-09-29, R7-2 / R7-6 / R7-7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { buildMarketplaceIndex } from './marketplace.mjs';

const asset = (key, inputs = []) => ({ key, workflowsActionType: 'INTERNAL', version: '1.0', inputs });
const assets = { actions: [{ appName: 'X', actions: [
  asset('remove_associated_records_from_workflow', [{ field: 'associatedObject' }, { field: 'DYNAMIC', dynamicFieldsConfig: { customGenerator: "s['WorkflowId'] = { field: 'WorkflowId' }" } }]),
  asset('clear_fields_of_company_or_associated_contact', [{ field: 'associationId' }]),
] }], triggers: [] };
const warningsFor = (type, attributes, workflowType) => {
  let n = 0; const w = [];
  compile({ name: 'wf', ...(workflowType ? { workflowType } : {}), triggers: [], graph: [{ ref: 'a', kind: 'action', marketplace: true, type, name: 'S', attributes }] },
    { loc: 'L', cid: 'C', uid: 'U', companyAge: 0, idGen: () => `id-${++n}`, catalog: loadCatalog(),
      marketplace: buildMarketplaceIndex({ assets, modules: { actions: [], triggers: [] } }), warn: (m) => w.push(m) });
  return w;
};

test('remove_associated_records_from_workflow warns that it ends runs beyond the named workflow', () => {
  assert.ok(warningsFor('remove_associated_records_from_workflow', { associatedObject: 'business', WorkflowId: 'W2' }).some((m) => /REMOVE_ENDS_OTHER_RUNS/.test(m)));
});
test('company-mode clear warns CLEAR_NOT_APPLIED; CONTROL: contact mode does not', () => {
  const row = [{ __customInputs__: {}, filterField: 'business.website' }];
  assert.ok(warningsFor('clear_fields_of_company_or_associated_contact', { associationId: 'COMPANY', __customInputFields__: row }, 'business').some((m) => /CLEAR_NOT_APPLIED/.test(m)));
  const ct = [{ __customInputs__: {}, filterField: 'contact.city' }];
  assert.equal(warningsFor('clear_fields_of_company_or_associated_contact', { associationId: 'BUSINESSES_CONTACTS_ASSOCIATION', __customInputFields__: ct }, 'business').some((m) => /CLEAR_NOT_APPLIED/.test(m)), false);
});
