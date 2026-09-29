// contact_changed on a multi-select or checkbox custom field: the drawer offers Added / Removed (add-index-of-true /
// remove-index-of-true), not Has changed / Has changed to. The compiler used to refuse the drawer's own menu.
// ContactChangedFilter.getOperatorOptions; drawer walk 2026-09-30 (live-W29-f-contact_changed-filters.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const FIELDS = [
  { id: 'cfMulti', name: 'Interests', fieldKey: 'contact.interests', dataType: 'MULTIPLE_OPTIONS', model: 'contact' },
  { id: 'cfCheck', name: 'Agreed', fieldKey: 'contact.agreed', dataType: 'CHECKBOX', model: 'contact' },
  { id: 'cfText', name: 'Nickname', fieldKey: 'contact.nickname', dataType: 'TEXT', model: 'contact' },
  { id: 'cfList', name: 'Phones', fieldKey: 'contact.phones', dataType: 'TEXTBOX_LIST', model: 'contact' },
];
const run = (type, filters) => compile({ name: 'W', triggers: [{ ref: 't', type, name: 'T', filters }],
  graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }] },
{ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('s'), catalog: loadCatalog(), customFields: FIELDS, warn: () => {} }).triggerBodies[0].conditions;

test('a multi-select / checkbox custom field takes Added / Removed', () => {
  for (const [field, id] of [['Interests', 'cfMulti'], ['Agreed', 'cfCheck']]) for (const operator of ['add-index-of-true', 'remove-index-of-true']) {
    const [row] = run('contact_changed', [{ field, operator, value: 'x' }]);
    assert.equal(row.operator, operator); assert.equal(row.id, id); assert.equal(row.field, `contact.${id}`);
  }
});

test('the old menu is refused for them, and the operator must be chosen (the drawer forces a pick)', () => {
  assert.throws(() => run('contact_changed', [{ field: 'Interests', operator: 'has-changed' }]), (e) => e.code === 'FILTER_OPERATOR');
  assert.throws(() => run('contact_changed', [{ field: 'Interests', value: 'x' }]), (e) => e.code === 'FILTER_OPERATOR_REQUIRED');
});

test('CONTROLS: a text field keeps Has changed / Has changed to', () => {
  assert.equal(run('contact_changed', [{ field: 'Nickname', operator: 'has-changed' }])[0].operator, 'has-changed');
  assert.equal(run('contact_changed', [{ field: 'Nickname', operator: '==', value: 'z' }])[0].operator, '==');
  assert.throws(() => run('contact_changed', [{ field: 'Nickname', operator: 'add-index-of-true', value: 'z' }]), (e) => e.code === 'FILTER_OPERATOR');
});

test('a text-box-list custom field is not offered by the drawer', () => {
  assert.throws(() => run('contact_changed', [{ field: 'Phones', operator: 'has-changed' }]), (e) => e.code === 'TRIGGER_FILTER_UNKNOWN');
});
