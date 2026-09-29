// A tag row is stored in lower case (GHL lower-cases tags; the drawer's picker shows "Select a tag" for a mixed-case value).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const run = (type, filters) => compile({ name: 'W', triggers: [{ ref: 't', type, name: 'T', filters }],
  graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }] },
{ loc: 'L', cid: 'C', uid: 'U', companyAge: 27, idGen: makeSeededIdGen('s'), catalog: loadCatalog(), warn: () => {} }).triggerBodies[0].conditions;

test('contact_tag and contact_changed tag rows are lower-cased', () => {
  assert.equal(run('contact_tag', [{ field: 'tagsAdded', value: 'VIP Lead' }])[0].value, 'vip lead');
  assert.equal(run('contact_tag', [{ field: 'tagsRemoved', value: 'Cold' }])[0].value, 'cold');
  assert.equal(run('contact_changed', [{ field: 'contact.tags', operator: 'add-index-of-true', value: 'New' }])[0].value, 'new');
});
test('CONTROLS: a merge tag and a non-tag row are left alone', () => {
  assert.equal(run('contact_tag', [{ field: 'tagsAdded', value: '{{Custom.Tag}}' }])[0].value, '{{Custom.Tag}}');
  assert.equal(run('contact_changed', [{ field: 'contact.email', operator: 'has-changed' }])[0].field, 'contact.email');
});
