import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintContactLessSteps } from './contact-less-steps.mjs';
import { compile } from '../compiler.mjs';
import { makeSeededIdGen } from '../idgen.mjs';
import { loadCatalog } from '../catalog.mjs';
const fc = { id: 'f', type: 'find_contact', name: 'Find' }, cu = { id: 'c', type: 'create_update_contact', name: 'Upsert' };

test('warns when runs carry a contact: no trigger, or a contact trigger', () => {
  assert.equal(lintContactLessSteps([fc], []).length, 1);
  assert.match(lintContactLessSteps([fc], [{ type: 'contact_tag' }])[0].msg, /FOUND/);
  assert.match(lintContactLessSteps([cu], [{ type: 'inbound_webhook' }, { type: 'form_submission' }])[0].msg, /form_submission/);
});

test('silent for an inbound_webhook-only workflow and when the steps are absent (controls)', () => {
  assert.deepEqual(lintContactLessSteps([fc, cu], [{ type: 'inbound_webhook' }]), []);
  assert.deepEqual(lintContactLessSteps([{ id: 'x', type: 'add_contact_tag' }], []), []);
});

test('the build surfaces it as a warning', () => {
  const warns = [];
  compile({ name: 'W', triggers: [], graph: [{ ref: 'f', kind: 'action', type: 'find_contact', name: 'Find', find: { fields: [{ field: 'email', title: 'Email', type: 'string', date: '', value: '{{contact.email}}' }] }, onFound: [], onNotFound: [] }] },
    { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('l'), catalog: loadCatalog(), warn: (m) => warns.push(m) });
  assert.ok(warns.some((m) => m.startsWith('CONTACT_STEP_IN_CONTACT_RUN')));
});
