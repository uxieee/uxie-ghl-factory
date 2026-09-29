// payment_received: the drawer offers extra rows once a Source (or a product) is chosen, a select stores the option VALUE not its
// label. Drawer walk 2026-09-30 (sniffs live-W29-f-payment_received-*.json) + PaymentReceived.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const run = (filters) => {
  const warnings = [];
  const ctx = { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('s'), catalog: loadCatalog(), warn: (m) => warnings.push(m) };
  const r = compile({ name: 'W', triggers: [{ ref: 't', type: 'payment_received', name: 'P', filters }],
    graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }] }, ctx);
  return { conditions: r.triggerBodies[0].conditions, warnings };
};

test('a Funnel sub-source and transaction type are stored with the drawer operator, title and type', () => {
  const { conditions, warnings } = run([{ field: 'payment.source', value: 'funnel' }, { field: 'payment.funnel.sub_source', value: 'upsell' }, { field: 'payment.funnel.transaction_type', value: 'sale' }]);
  assert.deepEqual(conditions.slice(1), [
    { field: 'payment.funnel.sub_source', value: 'upsell', operator: '==', title: 'Sub-Source', type: 'select' },
    { field: 'payment.funnel.transaction_type', value: 'sale', operator: '==', title: 'Transaction type', type: 'select' }]);
  assert.deepEqual(warnings.filter((w) => /TRIGGER_FILTER/.test(w)), []);
});

test('every source-dependent row resolves under ITS source', () => {
  for (const [src, field] of [['website', 'payment.website.sub_source'], ['invoice', 'payment.invoice.sub_source'], ['external', 'payment.external.sub_source'],
    ['website', 'payment.website.transaction_type'], ['calendar', 'payment.calendar.id'], ['form', 'payment.form.id']]) {
    const { conditions } = run([{ field: 'payment.source', value: src }, { field: field, value: 'x' }]);
    const row = conditions.find((c) => c.field === field);
    assert.ok(row.operator && row.title && row.type, field);
  }
});

test('the form row is a multi-select: is-any-of, and a list value survives', () => {
  const { conditions } = run([{ field: 'payment.source', value: 'form' }, { field: 'payment.form.id', value: ['F1', 'F2'] }]);
  const row = conditions.find((c) => c.field === 'payment.form.id');
  assert.equal(row.operator, 'is-any-of'); assert.deepEqual(row.value, ['F1', 'F2']);
});

test('a row under the WRONG source is refused (a Funnel sub-source is not offered under Invoice)', () => {
  assert.throws(() => run([{ field: 'payment.source', value: 'invoice' }, { field: 'payment.funnel.sub_source', value: 'upsell' }]),
    (e) => e.code === 'TRIGGER_FILTER_PARENT' && /only while payment\.source is 'funnel'/.test(e.message));
  assert.throws(() => run([{ field: 'payment.funnel.sub_source', value: 'upsell' }]), (e) => e.code === 'TRIGGER_FILTER_PARENT');
});

test('a title that names several rows is refused, the field id is accepted (control)', () => {
  assert.throws(() => run([{ field: 'payment.source', value: 'funnel' }, { field: 'Sub-Source', value: 'upsell' }]), (e) => e.code === 'TRIGGER_FILTER_AMBIGUOUS');
  assert.throws(() => run([{ field: 'payment.source', value: 'funnel' }, { field: 'Transaction type', value: 'sale' }]), (e) => e.code === 'TRIGGER_FILTER_AMBIGUOUS');
  assert.equal(run([{ field: 'payment.source', value: 'calendar' }, { field: 'Calendar', value: 'C1' }]).conditions[1].field, 'payment.calendar.id');
});

test('an off-menu operator on a dependent row is refused', () => {
  assert.throws(() => run([{ field: 'payment.source', value: 'funnel' }, { field: 'payment.funnel.sub_source', operator: 'is-any-of', value: 'upsell' }]), (e) => e.code === 'FILTER_OPERATOR');
  assert.equal(run([{ field: 'payment.source', value: 'funnel' }, { field: 'payment.funnel.sub_source', operator: '!=', value: 'upsell' }]).conditions[1].operator, '!=');
});

test('an option LABEL is mapped to the stored value; a stored value and a wrong one are handled', () => {
  assert.equal(run([{ field: 'Source', value: 'Website' }]).conditions[0].value, 'website');
  assert.equal(run([{ field: 'Source', value: 'Manual payment' }]).conditions[0].value, 'manual');
  assert.equal(run([{ field: 'Payment status', value: 'Success' }]).conditions[0].value, 'succeeded');
  assert.equal(run([{ field: 'Payment status', value: 'succeeded' }]).conditions[0].value, 'succeeded');
  const bad = run([{ field: 'Payment status', value: 'paid' }]);
  assert.equal(bad.conditions[0].value, 'paid');
  assert.ok(bad.warnings.some((w) => /TRIGGER_FILTER_VALUE_UNKNOWN/.test(w) && /succeeded = "Success"/.test(w)));
});

test('the Global product row defaults to is-in-array with a SCALAR id (== and a one-element array both render wrong in the drawer)', () => {
  assert.deepEqual(run([{ field: 'payment.global_product_ids', value: 'P1' }]).conditions[0], { field: 'payment.global_product_ids', operator: 'is-in-array', value: 'P1', title: 'Global product', type: 'select_with_pagination' });
  assert.equal(run([{ field: 'payment.global_product_ids', operator: 'is-in-array', value: ['P1'] }]).conditions[0].value, 'P1');
  assert.equal(run([{ field: 'payment.global_product_ids', operator: 'is-not-in-array', value: 'P1' }]).conditions[0].operator, 'is-not-in-array');
  assert.throws(() => run([{ field: 'payment.global_product_ids', operator: '==', value: 'P1' }]), (e) => e.code === 'FILTER_OPERATOR');
  assert.throws(() => run([{ field: 'payment.global_product_ids', value: ['P1', 'P2'] }]), (e) => e.code === 'FILTER_VALUE');
});
