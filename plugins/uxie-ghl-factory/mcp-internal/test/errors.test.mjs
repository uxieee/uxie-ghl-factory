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
