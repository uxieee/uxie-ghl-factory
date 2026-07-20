import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, fail, fromHttp, CODES, containsSecrets, scrubSecrets } from '../core/errors.mjs';

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

test('PREVIEW_STALE is a stable machine-branchable error code', () => {
  assert.equal(CODES.PREVIEW_STALE, 'PREVIEW_STALE');
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
  assert.equal(success.data.nested.tokenId, '<redacted>');
  assert.doesNotMatch(JSON.stringify({ success, failure }), /tid-live-secret/);
});

test('common auth key variants and labeled path/query credentials are detected and scrubbed', () => {
  const values = [
    'opaque-refresh-value', 'opaque-cookie-value', 'opaque-session-value',
    'opaque-session-credentials-value',
  ];
  const keyed = {
    refreshToken: values[0],
    cookie: values[1],
    sessionCredential: values[2],
    session_credentials: values[3],
  };
  const labeled = [
    `/callback?refresh_token=${values[0]}&safe=1`,
    `/sessions/accessToken/${values[1]}`,
    `Cookie: ${values[2]}`,
    `/session_credentials/${values[3]}`,
  ];

  assert.equal(containsSecrets(keyed), true);
  for (const value of labeled) assert.equal(containsSecrets(value), true, value);
  const scrubbed = JSON.stringify(scrubSecrets({ keyed, labeled }));
  for (const value of values) assert.doesNotMatch(scrubbed, new RegExp(value));
  assert.match(scrubbed, /<redacted>/);
});

test('secret-keyed objects and arrays are detected and their full subtrees are scrubbed', () => {
  const nestedObjectMarker = 'nested-object-marker';
  const nestedArrayMarker = 'nested-array-marker';
  const value = {
    refresh_token: { nestedObjectMarker },
    sessionToken: [{ nestedArrayMarker }],
    credentials: { nested: ['safe-looking-child'] },
    safe: { nested: ['preserved'] },
  };

  assert.equal(containsSecrets(value), true);
  assert.deepEqual(scrubSecrets(value), {
    refresh_token: '<redacted>',
    sessionToken: '<redacted>',
    credentials: '<redacted>',
    safe: { nested: ['preserved'] },
  });
});
