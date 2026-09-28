// An email step's cc / bcc pass the ATTR_KEY guard (they are real builder keys, models/actions/Email.ts) but emailAttributes
// rebuilt the step from a fixed key list and dropped them — no error, and the send went out with cc:[] bcc:[] (live 2026-09-28,
// knowledge sniffs/workflows-wave1-2026-09-25/live-3AV-email-cc-attach-internal.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';

const emailStep = (attributes) => {
  let n = 0;
  return compile({ name: 'wf', triggers: [], graph: [{ ref: 'e', kind: 'action', type: 'email', name: 'E', attributes }] },
    { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: () => `id-${++n}`, catalog: loadCatalog(), warn: () => {} })
    .autoSaveBody.workflowData.templates[0].attributes;
};

test('authored cc / bcc / customSubtypeId reach the stored step', () => {
  const a = emailStep({ subject: 's', html: '<p>x</p>', cc: 'a@example.com, b@example.com', bcc: 'c@example.com', customSubtypeId: 'sub1' });
  assert.equal(a.cc, 'a@example.com, b@example.com');
  assert.equal(a.bcc, 'c@example.com');
  assert.equal(a.customSubtypeId, 'sub1');
});

test('absent cc / bcc stay absent (no empty keys invented)', () => {
  const a = emailStep({ subject: 's', html: '<p>x</p>' });
  assert.equal('cc' in a, false); assert.equal('bcc' in a, false); assert.equal('customSubtypeId' in a, false);
});

test('template mode keeps cc / bcc too', () => {
  const a = emailStep({ subject: 's', template_id: 'T1', cc: 'a@example.com', bcc: 'b@example.com' });
  assert.equal(a.cc, 'a@example.com'); assert.equal(a.bcc, 'b@example.com');
});
