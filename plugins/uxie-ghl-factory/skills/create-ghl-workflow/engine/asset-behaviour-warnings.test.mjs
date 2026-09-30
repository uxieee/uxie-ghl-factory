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
  asset('create_recurring_invoice', ['userId', 'templateId', 'endType', 'endDate', 'count', 'numOfWeek', 'dayOfWeek'].map((field) => ({ field }))),
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

// create_recurring_invoice (coordinator ruling 2026-09-30; knowledge live-W37-rec-*.json)
const rec = (over) => ({ userId: 'U', templateId: 'T', endType: 'after', count: 1, numOfWeek: 1, dayOfWeek: 'mo', endDate: '', ...over });
test('create_recurring_invoice warns RECURRING_COUNT_IGNORED when count and endDate are both stored; CONTROL: no endDate does not', () => {
  assert.ok(warningsFor('create_recurring_invoice', rec({ endDate: '2026-10-31' })).some((m) => /RECURRING_COUNT_IGNORED/.test(m)));
  assert.equal(warningsFor('create_recurring_invoice', rec({ endDate: '' })).some((m) => /RECURRING_COUNT_IGNORED/.test(m)), false);
});
test('create_recurring_invoice refuses numOfWeek 0 and a numeric dayOfWeek; CONTROL: the drawer values pass', () => {
  assert.throws(() => warningsFor('create_recurring_invoice', rec({ numOfWeek: 0 })), (e) => e.code === 'MARKETPLACE_VALUE_REFUSED' && /numOfWeek 0/.test(e.message));
  assert.throws(() => warningsFor('create_recurring_invoice', rec({ dayOfWeek: 1 })), (e) => e.code === 'MARKETPLACE_VALUE_REFUSED' && /dayOfWeek/.test(e.message));
  assert.doesNotThrow(() => warningsFor('create_recurring_invoice', rec({ dayOfWeek: 'td', numOfWeek: -2 })));
});
