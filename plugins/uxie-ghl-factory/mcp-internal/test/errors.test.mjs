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

// 401 vs 403 are different failures and must not share a code.
//
// Folding 403 into TOKEN_EXPIRED told the caller to re-authenticate for something
// re-authentication cannot fix. Live on AU 2026-07-27, DELETE on an agent-type workflow
// returned 403 {"error":true,"msg":"Workflows with type \"agent\" cannot be deleted"} and
// was reported as an expired token — on a JWT that was demonstrably still valid. A
// bad-token control on the same endpoint returned 401 "Unauthorized", so the two are
// cleanly separable by status.
test('403 is ACCESS_DENIED, not TOKEN_EXPIRED, and says re-auth will not help', () => {
  const r = fromHttp(403, { error: true, msg: 'Workflows with type "agent" cannot be deleted' });
  assert.equal(r.ok, false);
  assert.equal(r.code, CODES.ACCESS_DENIED);
  assert.match(r.detail, /cannot be deleted/);
  assert.match(r.remediation, /NOT an expired token/);
  assert.doesNotMatch(r.remediation, /Re-capture the JWT with/);
});

test('401 stays TOKEN_EXPIRED but sends the agent to a CONTROL before a re-capture', () => {
  const r = fromHttp(401, 'Unauthorized');
  assert.equal(r.code, CODES.TOKEN_EXPIRED);
  // The remediation is addressed to the agent, not the user. It used to open "Run
  // /uxie-ghl-factory:internal-connect", and a slash command is something a USER types -- so the
  // agent read it as "ask the human" and stopped mid-task, on a credential that expires hourly.
  //
  // 2026-09-08: it then went too far the other way. It opened "RE-CAPTURE IT YOURSELF, do not ask
  // and do not stop", and a 401 is NOT proof the credential is dead -- one endpoint 401'd three
  // times while another call succeeded on either side of it, then answered 200 with no
  // re-capture. internal-connect opens a browser and needs a human, so an unconditional
  // re-capture instruction interrupts a person for a blip that clears on retry.
  //
  // The order is what this test pins: retry, then a control read, and only then re-capture.
  assert.match(r.remediation, /FIRST: retry this exact call/);
  assert.match(r.remediation, /control read/);
  assert.match(r.remediation, /do NOT re-capture/);
  assert.match(r.remediation, /ONLY IF/);
  // Still the agent's own job once the control confirms it, and still bounded.
  assert.match(r.remediation, /invoke the `uxie-ghl-factory:internal-connect` skill yourself/);
  assert.match(r.remediation, /One re-capture per failure/);
  assert.doesNotMatch(r.remediation, /^Run \//);
});

// R-98 (backlog 11): GHL step HTML carries `data-cv-token="true">{{message.body}}` — a builder
// marker, not a credential. The labelled-secret rule read `token="true"` as a secret and
// export_workflow returned `<redacted>` where the visitor's message belonged; a clone built from
// that export silently lost it. A `data-*` attribute NAME is exempt from the labelled rule only.
test('an HTML data-* attribute whose name ends in a secret label is not scrubbed; real labels still are', () => {
  const html = '<span data-cv-token="true">{{message.body}}</span><p data-token-id="x">{{contact.first_name}}</p>';
  assert.equal(scrubSecrets({ html }).html, html);
  assert.equal(containsSecrets({ html }), false);
  // the labelled rule still bites outside an attribute name
  assert.match(scrubSecrets({ s: 'token=abc123def' }).s, /<redacted>/);
  assert.match(scrubSecrets({ s: 'x-api-key: sk_live_abcdef' }).s, /<redacted>/);
  assert.equal(containsSecrets({ s: 'x-api-key: sk_live_abcdef' }), true);
  // and a JWT inside a data attribute is still caught by the token-shape rule
  assert.match(scrubSecrets({ s: `<a data-token="ey${'a'.repeat(30)}">` }).s, /<redacted>/);
});

// A 401 whose BODY is a validation error is not an auth failure, and reporting it as one sends
// the caller to re-capture a working credential over a typo. Proven by differential on
// 2026-09-08: POST /opportunities/pipelines/permissions with {} answered 401
// "pipelineId can't be undefined"; the SAME call with the SAME credential, one key added,
// answered 422. 29 calls that session, all on one token.
test('a 401 carrying COMMON_*_UNDEFINED is VALIDATION_FAILED, not TOKEN_EXPIRED', () => {
  const f = fromHttp(401, {
    statusCode: 401, error: 'Unauthorized',
    message: "pipelineId can't be undefined", code: 'COMMON_PIPELINE_ID_UNDEFINED',
  });
  assert.equal(f.code, CODES.VALIDATION_FAILED);
  assert.match(f.remediation, /do NOT re-capture/);
});

test("a 401 whose message is \"<field> can't be undefined\" is VALIDATION_FAILED even with no code", () => {
  assert.equal(fromHttp(401, { message: "locationId can't be undefined" }).code, CODES.VALIDATION_FAILED);
  // GHL sends `message` as an array on some routes and a bare string on others
  assert.equal(fromHttp(401, { message: ["pipelineId can't be undefined"] }).code, CODES.VALIDATION_FAILED);
});

// The exception must stay narrow. A real expiry says Unauthorized and names no field; widening
// this to "any 401 with a message" would swallow the failure the code exists to report.
test('a plain 401 still maps to TOKEN_EXPIRED', () => {
  assert.equal(fromHttp(401, { message: 'unauthorized' }).code, CODES.TOKEN_EXPIRED);
  assert.equal(fromHttp(401, { statusCode: 401, error: 'Unauthorized' }).code, CODES.TOKEN_EXPIRED);
  assert.equal(fromHttp(401, 'Unauthorized').code, CODES.TOKEN_EXPIRED);
  assert.equal(fromHttp(401, null).code, CODES.TOKEN_EXPIRED);
  // near-misses that must NOT be treated as validation
  assert.equal(fromHttp(401, { code: 'COMMON_SOMETHING_ELSE' }).code, CODES.TOKEN_EXPIRED);
  assert.equal(fromHttp(401, { message: 'the token is undefined' }).code, CODES.TOKEN_EXPIRED);
});

// 422 is unaffected: GHL uses BOTH statuses for the same class of fault, which is exactly why
// the check reads the body rather than the status.
test('422 remains VALIDATION_FAILED whatever its body says', () => {
  assert.equal(fromHttp(422, { message: ['name should not be empty'] }).code, CODES.VALIDATION_FAILED);
  assert.equal(fromHttp(422, { code: 'COMMON_LOCATION_ID_UNDEFINED' }).code, CODES.VALIDATION_FAILED);
});
