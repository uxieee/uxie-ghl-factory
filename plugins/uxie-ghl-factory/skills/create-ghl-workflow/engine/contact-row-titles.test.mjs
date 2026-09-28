// bl-256: create_update_contact rows get the drawer titles (the builder's Email/Phone rule reads the TITLE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('c'), catalog: loadCatalog() });
const one = (fields) => compile({ name: 'W', triggers: [], graph: [{ ref: 'c', kind: 'action', type: 'create_update_contact', name: 'Upsert', attributes: { type: 'create_update_contact', fields } }] }, ctx())
  .autoSaveBody.workflowData.templates[0].attributes.fields;

test('untitled standard rows get the drawer titles, so the Email/Phone rule passes', () => {
  const f = one([{ field: 'email', value: '{{contact.email}}' }, { field: 'firstName', value: 'A' }]);
  assert.equal(f[0].title, 'Email'); assert.equal(f[1].title, 'First Name');
});

test('the object-map form from the IR docs compiles to titled rows', () => {
  const f = one({ email: '{{inboundWebhookRequest.email}}', lastName: 'X' });
  assert.deepEqual(f.map((r) => [r.field, r.title, r.value]), [['email', 'Email', '{{inboundWebhookRequest.email}}'], ['lastName', 'Last Name', 'X']]);
});

test('an authored title is kept, and a custom-field row is left alone (controls)', () => {
  const f = one([{ field: 'email', title: 'Email', value: '{{contact.email}}' }, { field: 'CUSTOMID123', title: '', value: 'v' }]);
  assert.equal(f[0].title, 'Email'); assert.equal(f[1].title, '');
});
