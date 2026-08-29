import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintTriggerRows } from './trigger-rows.mjs';
import { loadCatalog } from '../catalog.mjs';

const catalog = loadCatalog();
const trg = (type, conditions) => [{ id: 'tr1', type, name: 'T', conditions }];
const codes = (f) => f.map((x) => x.code).sort();

test('a non-string operator/type is an error; a stored operator outside the known row operator warns', () => {
  assert.deepEqual(codes(lintTriggerRows(trg('call_status', [{ field: 'custom_disposition', operator: 'contains-any', value: ['Booked'], type: { __dynamic__: 'x' } }]), catalog)), ['TRIGGER_ROW_NOT_STRING']);
  const f = lintTriggerRows(trg('call_status', [{ field: 'custom_disposition', operator: 'string-contains-any-of', value: ['Booked'], type: 'multiselect' }]), catalog);
  assert.deepEqual(codes(f), ['TRIGGER_ROW_OPERATOR']);
  assert.equal(f[0].severity, 'warning');
});

test('rows the catalog does not model are skipped; a clean stored trigger is clean', () => {
  assert.deepEqual(lintTriggerRows(trg('call_status', [{ field: 'custom_disposition', operator: 'contains-any', value: ['Booked'], type: 'multiselect', title: 'Custom disposition' }]), catalog), []);
  assert.deepEqual(lintTriggerRows(trg('some_unknown_trigger', [{ field: 'x', operator: 7 }]), catalog).map((x) => x.code), ['TRIGGER_ROW_NOT_STRING'],
    'the string check is universal; the operator check is catalog-gated');
});

test('no catalog at all still runs the universal string check and never throws', () => {
  assert.deepEqual(lintTriggerRows(trg('call_status', [{ field: 'x', type: {} }]), undefined).map((x) => x.code), ['TRIGGER_ROW_NOT_STRING']);
  assert.deepEqual(lintTriggerRows(null, catalog), []);
  assert.deepEqual(lintTriggerRows([null, {}], catalog), []);
});
