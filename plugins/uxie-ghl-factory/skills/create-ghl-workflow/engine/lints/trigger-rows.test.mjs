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

// R-74 (backlog 8): `contact.tags` is TWO catalogue rows with one value — "Has tag"
// (index-of-true) and "Doesn't have tag" (index-of-false). Reading only the first row flagged the
// UI's own "Doesn't have tag" as off-menu on every customer_reply trigger.
test('a field that appears as several rows unions their operators — index-of-false on a tag row is on-menu', () => {
  const twoRows = { trigger: () => ({ filterRows: [
    { label: 'Has tag', value: 'contact.tags', type: 'select', id: 'has-tag', operator: 'index-of-true' },
    { label: 'Doesn\'t have tag', value: 'contact.tags', type: 'select', id: 'doesnot-have-tag', operator: 'index-of-false' },
  ] }) };
  assert.deepEqual(lintTriggerRows(trg('customer_reply', [{ field: 'contact.tags', operator: 'index-of-false', value: 'vip', type: 'tags' }]), twoRows), []);
  assert.deepEqual(lintTriggerRows(trg('customer_reply', [{ field: 'contact.tags', operator: 'index-of-true', value: 'vip', type: 'tags' }]), twoRows), []);
  const off = lintTriggerRows(trg('customer_reply', [{ field: 'contact.tags', operator: 'contains', value: 'vip', type: 'tags' }]), twoRows);
  assert.deepEqual(codes(off), ['TRIGGER_ROW_OPERATOR']);
  assert.match(off[0].msg, /\[index-of-true, index-of-false\]/);
});
