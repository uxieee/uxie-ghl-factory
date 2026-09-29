// bl-326 (client QA report 2026-09-29): a secret in a NAME/VALUE header row was returned unredacted by export_workflow and
// get_workflow_logs, because scrubSecrets redacts by property NAME and a pair row's names are the generic key/value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets, ok, REDACTED, containsSecrets } from '../core/errors.mjs';
import { refuseRedactedWrite } from '../core/raw-request-guards.mjs';

const FAKE = 'TEST-CONF-fake-0000';

test('a secret-named header pair has its VALUE redacted; benign headers stay', () => {
  const out = scrubSecrets({ attributes: { headers: [
    { key: 'X-Hook-Secret', value: FAKE }, { key: 'Content-Type', value: 'application/json' }, { key: 'Accept', value: '*/*' },
    { key: 'Authorization', value: 'Basic abc' }, { key: 'X-Api-Key', value: 'k1' }, { key: 'X-Signature', value: 'sig' } ] } });
  const h = out.attributes.headers;
  assert.deepEqual(h.map((r) => r.value), [REDACTED, 'application/json', '*/*', REDACTED, REDACTED, REDACTED]);
  assert.deepEqual(h.map((r) => r.key), ['X-Hook-Secret', 'Content-Type', 'Accept', 'Authorization', 'X-Api-Key', 'X-Signature'], 'names stay readable');
  assert.doesNotMatch(JSON.stringify(out), new RegExp(FAKE));
});

test('every pair-shaped field is covered: parameters, keyValueData, customData, and a `name` pair', () => {
  const out = scrubSecrets({ parameters: [{ key: 'api_key', value: 'P1' }], body: { keyValueData: [{ key: 'token', value: 'T1' }] },
    customData: [{ key: 'X-Auth-Token', value: 'C1' }], deep: { a: [{ b: { headers: [{ name: 'x-hook-secret', value: 'N1' }] } }] } });
  const s = JSON.stringify(out);
  for (const v of ['P1', 'T1', 'C1', 'N1']) assert.doesNotMatch(s, new RegExp(`"${v}"`), v);
});

test('a header MAP (headers: {name: value}) redacts the secret-named property', () => {
  const out = scrubSecrets({ headers: { 'X-Hook-Secret': FAKE, Accept: 'x' } });
  assert.deepEqual(out.headers, { 'X-Hook-Secret': REDACTED, Accept: 'x' });
});

test('CONTROLS: identifiers and rich data rows are NOT redacted', () => {
  const out = scrubSecrets({ headers: [{ key: 'Idempotency-Key', value: 'idem-1' }, { key: 'X-Request-Id', value: 'r1' }],
    customValues: [{ id: 'cv1', name: 'Email Signature', value: '<p>Thanks</p>', fieldKey: '{{ custom_values.sig }}' }],
    note: { name: 'Author', value: 'Xander' } });
  assert.equal(out.headers[0].value, 'idem-1'); assert.equal(out.headers[1].value, 'r1');
  assert.equal(out.customValues[0].value, '<p>Thanks</p>');
  assert.equal(out.note.value, 'Xander');
});

test('empty and already-redacted values pass through (no manufactured placeholder)', () => {
  const out = scrubSecrets({ headers: [{ key: 'X-Hook-Secret', value: '' }, { key: 'X-Api-Key', value: REDACTED }, { key: 'X-Token', value: null }] });
  assert.deepEqual(out.headers.map((r) => r.value), ['', REDACTED, null]);
});

test('ok() applies the pair rule at the contract boundary', () => {
  assert.equal(ok({ headers: [{ key: 'X-Hook-Secret', value: FAKE }] }).data.headers[0].value, REDACTED);
});

test('write-back: a redacted PAIR value is still refused on every whole-document write path (guard unchanged)', () => {
  const step = { id: 's1', name: 'Hook', type: 'custom_webhook', attributes: { headers: [{ key: 'X-Hook-Secret', value: REDACTED }] } };
  const r = refuseRedactedWrite([step]);
  assert.ok(r, 'a scrubbed header pair must not be writable back over the real secret');
  assert.match(r.message, /attributes\.headers/);
  assert.equal(refuseRedactedWrite([{ ...step, attributes: { headers: [{ key: 'Accept', value: 'x' }] } }]), null);
});

test('the INPUT guard is unchanged: a real value in a generic pair is not refused (authoring a webhook header still works)', () => {
  assert.equal(containsSecrets({ attributes: { headers: [{ key: 'X-Hook-Secret', value: FAKE }] } }), false);
});
