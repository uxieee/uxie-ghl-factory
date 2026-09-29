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

// ---- review round 2 (coordinator, 2026-09-30): exact short names, hmac, and a value-shape net ----
const EXACT = ['key', 'auth', 'pwd', 'pass', 'jwt', 'hmac', 'sig', 'session', 'sessionid', 'sid', 'apikey'];

test('EXACT names are secrets as the whole name, with or without a leading x- and in any case', () => {
  for (const n of EXACT) for (const name of [n, n.toUpperCase(), `X-${n}`, `x-${n}`]) {
    assert.equal(scrubSecrets({ headers: [{ key: name, value: 'plain-value' }] }).headers[0].value, REDACTED, `pair ${name}`);
    assert.equal(scrubSecrets({ params: { [name]: 'plain-value' } }).params[name], REDACTED, `map ${name}`);
  }
  assert.equal(scrubSecrets({ headers: [{ name: 'key', value: 'AIza-not-really' }] }).headers[0].value, REDACTED, 'lean name pair');
});

test('substring hmac: x-shopify-hmac-sha256 is redacted', () => {
  assert.equal(scrubSecrets({ headers: [{ key: 'X-Shopify-Hmac-Sha256', value: 'abc' }] }).headers[0].value, REDACTED);
});

test('CONTROLS: whole-name matching leaves Idempotency-Key, contentKey, Keyword, Passenger, Signal alone', () => {
  const names = ['Idempotency-Key', 'contentKey', 'Keyword', 'Passenger', 'Signal', 'Sidebar', 'Authority'];
  const rows = scrubSecrets({ headers: names.map((key) => ({ key, value: 'v' })), params: Object.fromEntries(names.map((n) => [n, 'v'])) });
  assert.deepEqual(rows.headers.map((r) => r.value), names.map(() => 'v'));
  assert.deepEqual(Object.values(rows.params), names.map(() => 'v'));
});

const SHAPES = {
  bearer: 'Bearer TEST-CONF-fake-000000000000', basic: 'Basic dGVzdDp0ZXN0LWNvbmY=', jwt: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.',
  stripe: 'sk_test_TESTCONFfake', pit: 'pit-00000000-0000-0000-0000-000000000000', google: `AIza${'x'.repeat(35)}`,
  github: `ghp_${'a'.repeat(36)}`, slack: 'xoxb-000-000-fake',
};
test('VALUE SHAPE: a credential-looking value is redacted under an innocuous name (pair row and header map)', () => {
  for (const [k, v] of Object.entries(SHAPES)) {
    assert.equal(scrubSecrets({ headers: [{ key: 'X-Anything', value: v }] }).headers[0].value, REDACTED, `pair ${k}`);
    assert.equal(scrubSecrets({ headers: { 'X-Anything': v } }).headers['X-Anything'], REDACTED, `map ${k}`);
  }
});

test('VALUE SHAPE near-misses stay: "Bearer" alone, short Bearer, short Basic, eyJ without dots, sk_ without live/test, short AIza', () => {
  const near = ['Bearer', 'Bearer abc', 'Basic abc', 'eyJhbGciOiJub25l', 'sk_dev_abc', 'AIza123', 'pit-short', 'ghp_short', 'xoxz-1', 'plain'];
  const out = scrubSecrets({ headers: near.map((value) => ({ key: 'X-Anything', value })) });
  assert.deepEqual(out.headers.map((r) => r.value), near);
});

test('VALUE SHAPE does not touch a value outside a pair row or header map', () => {
  const out = scrubSecrets({ note: { text: 'note about Bearer TEST-CONF-fake-000000000000?' }, description: 'sk_test_ is a prefix' });
  assert.equal(out.description, 'sk_test_ is a prefix');
});
