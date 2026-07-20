import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, fail, fromHttp, CODES } from '../core/errors.mjs';

test('ok wraps data', () => {
  assert.deepEqual(ok({ a: 1 }), { ok: true, data: { a: 1 } });
});

test('fail carries code, detail, remediation', () => {
  const f = fail(CODES.TOKEN_EXPIRED, 'exp 5m ago', 're-run capture');
  assert.deepEqual(f, { ok: false, code: 'TOKEN_EXPIRED', detail: 'exp 5m ago', remediation: 're-run capture' });
});

test('401 maps to TOKEN_EXPIRED with the capture remediation', () => {
  const f = fromHttp(401, { message: 'unauthorized' });
  assert.equal(f.code, CODES.TOKEN_EXPIRED);
  assert.match(f.remediation, /capture/i);
});

test('409 maps to VERSION_CONFLICT, 422 to VALIDATION_FAILED, other 4xx/5xx to HTTP_<n>', () => {
  assert.equal(fromHttp(409, {}).code, CODES.VERSION_CONFLICT);
  assert.equal(fromHttp(422, {}).code, CODES.VALIDATION_FAILED);
  assert.equal(fromHttp(500, {}).code, 'HTTP_500');
});

test('fromHttp never leaks a bearer token from the body', () => {
  const f = fromHttp(400, { echo: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def' });
  assert.ok(!/eyJ/.test(JSON.stringify(f)));
});

test('fromHttp scrubs opaque credentials under secret keys before stringifying a structured body', () => {
  const tokenId = 'opaque-token-id-value-123';
  const apiKey = 'opaque-api-key-value-456';
  const result = fromHttp(400, { error: { tokenId, nested: { apiKey } } });

  assert.doesNotMatch(JSON.stringify(result), /opaque-(?:token-id|api-key)-value/);
  assert.match(result.detail, /<redacted>/);
});

test('ok recursively scrubs a JWT-looking value returned by a read endpoint', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.abc.def';
  const result = ok({ nested: [{ authorization: `Bearer ${token}` }], [token]: true });
  assert.equal(result.data.nested[0].authorization, '<redacted>');
  assert.deepEqual(Object.keys(result.data).sort(), ['<redacted>', 'nested']);
  assert.doesNotMatch(JSON.stringify(result), /eyJ/);
});

test('success and failure contracts scrub token-id labels and secret-key scalar values', () => {
  const tokenId = 'tid-live-secret-123456789';
  const success = ok({
    tokenId,
    note: `token-id: ${tokenId}`,
    nested: { authorization: tokenId, tokenId: { present: true } },
  });
  const failure = fail(CODES.VALIDATION_FAILED, `token_id=${tokenId}`, `replace token-id: ${tokenId}`);

  assert.equal(success.data.tokenId, '<redacted>');
  assert.equal(success.data.note, 'token-id: <redacted>');
  assert.equal(success.data.nested.authorization, '<redacted>');
  assert.deepEqual(success.data.nested.tokenId, { present: true });
  assert.doesNotMatch(JSON.stringify({ success, failure }), /tid-live-secret/);
});
