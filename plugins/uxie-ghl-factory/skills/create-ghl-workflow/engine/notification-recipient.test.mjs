// bl-260: no implicit userType 'all' (it notifies every user on the account).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('n'), catalog: loadCatalog() });
const one = (attributes) => compile({ name: 'W', triggers: [], graph: [{ ref: 'n', kind: 'action', type: 'internal_notification', name: 'N', attributes }] }, ctx())
  .autoSaveBody.workflowData.templates[0].attributes;

test('a notification that names no recipient is refused, not broadcast', () => {
  assert.throws(() => one({ type: 'notification', notification: { title: 't', body: 'b' } }), (e) => e.code === 'MISSING_FIELD' && /every user/.test(e.message));
  assert.throws(() => one({ type: 'email', email: { subject: 's', html: '<p>x</p>' } }), (e) => e.code === 'MISSING_FIELD');
});

test('each explicit recipient still compiles (controls)', () => {
  assert.equal(one({ type: 'notification', notification: { userType: 'user', selectedUser: 'U1', title: 't', body: 'b' } }).notification.userType, 'user');
  assert.equal(one({ type: 'notification', notification: { selectedUser: 'U1', title: 't', body: 'b' } }).notification.userType, 'user');
  assert.equal(one({ type: 'email', email: { to: 'x@example.invalid', subject: 's', html: '<p>x</p>' } }).email.userType, 'custom_email');
  assert.equal(one({ type: 'email', email: { userType: 'all', subject: 's', html: '<p>x</p>' } }).email.userType, 'all');
});
