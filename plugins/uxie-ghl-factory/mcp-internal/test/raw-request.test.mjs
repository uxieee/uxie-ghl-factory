import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const rawRequestTool = () => TOOLS.find((candidate) => candidate.name === 'raw_request');

function fixture({ throwAfterApply = false, throwError = null, response } = {}) {
  const calls = [];
  let made = 0;
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (throwError) throw throwError;
      if (throwAfterApply) throw new Error('transport lost after raw write applied');
      return response ?? { status: 200, ok: true, json: { accepted: true } };
    },
  };
  return {
    calls,
    made: () => made,
    deps: {
      state: { tokenFile: '/fixture/token.txt' },
      makeGw: () => { made++; return gw; },
    },
  };
}

test('raw_request schema accepts confirmed non-GET requests with an optional body', () => {
  const parsed = rawRequestTool().inputSchema.safeParse({
    locationId: 'LOC', method: 'POST', path: '/widgets', body: { name: 'Widget' }, confirm: true,
  });
  assert.equal(parsed.success, true);
});

test('HEAD and OPTIONS normalize as arbitrary non-GET methods and require confirmation', async () => {
  for (const supplied of [' head ', 'options']) {
    const expected = supplied.trim().toUpperCase();
    const previewFixture = fixture();
    const preview = await rawRequestTool().handler({
      locationId: 'LOC', method: supplied, path: '/capabilities',
    }, previewFixture.deps);
    assert.equal(preview.code, 'CONFIRM_REQUIRED', supplied);
    assert.equal(preview.data.preview.method, expected, supplied);
    assert.equal(previewFixture.made(), 0, supplied);

    const confirmedFixture = fixture();
    const confirmed = await rawRequestTool().handler({
      locationId: 'LOC', method: supplied, path: '/capabilities', confirm: true,
    }, confirmedFixture.deps);
    assert.equal(confirmed.ok, true, supplied);
    assert.equal(confirmedFixture.calls[0].method, expected, supplied);
  }
});

test('invalid HTTP method tokens fail validation before gateway construction', async () => {
  for (const method of ['', 'POST /widgets', 'GET\r\nAuthorization: nope']) {
    const parsed = rawRequestTool().inputSchema.safeParse({ locationId: 'LOC', method, path: '/x' });
    assert.equal(parsed.success, false, JSON.stringify(method));

    const fx = fixture();
    const result = await rawRequestTool().handler({ locationId: 'LOC', method, path: '/x' }, fx.deps);
    assert.equal(result.ok, false, JSON.stringify(method));
    assert.equal(result.code, 'VALIDATION_FAILED', JSON.stringify(method));
    assert.equal(fx.made(), 0, JSON.stringify(method));
  }
});

test('non-GET raw_request without confirmation returns a scrubbed intent preview and makes no gateway', async () => {
  const fx = fixture();
  const result = await rawRequestTool().handler({
    locationId: 'LOC', method: 'PATCH', path: '/widgets/1', body: { enabled: true },
  }, fx.deps);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(result.data.preview, {
    method: 'PATCH', path: '/widgets/1', body: { enabled: true },
  });
  assert.equal(fx.made(), 0);
  assert.equal(fx.calls.length, 0);
});

test('confirmed non-GET raw_request sends the exact method, path, and body through the gateway', async () => {
  const fx = fixture();
  const body = { enabled: true };
  const result = await rawRequestTool().handler({
    locationId: 'LOC', method: 'PATCH', path: '/widgets/1', body, confirm: true,
  }, fx.deps);

  assert.equal(result.ok, true);
  assert.deepEqual(fx.calls, [{ method: 'PATCH', path: '/widgets/1', body }]);
  assert.equal(result.data.status, 200);
  assert.deepEqual(result.data.json, { accepted: true });
  assert.equal(result.data.partialProgress.write.acknowledged, true);
  assert.equal(result.data.partialProgress.write.ambiguous, false);
});

test('raw write applied then transport throws is an urgent ambiguous failure', async () => {
  const fx = fixture({ throwAfterApply: true });
  const result = await rawRequestTool().handler({
    locationId: 'LOC', method: 'POST', path: '/widgets', body: { name: 'Widget' }, confirm: true,
  }, fx.deps);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.match(result.detail, /transport lost after raw write applied/);
  assert.match(result.remediation, /URGENT/i);
  assert.match(result.remediation, /raw request/i);
  assert.doesNotMatch(result.remediation, /workflow|draft|republish|triggers/i);
  assert.equal(result.data.partialProgress.write.attempted, true);
  assert.equal(result.data.partialProgress.write.acknowledged, false);
  assert.equal(result.data.partialProgress.write.ambiguous, true);
});

test('raw_request rejects credentials in path, body, or unknown args without echoing or gateway access', async () => {
  const secret = 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz.signature';
  const cases = [
    { locationId: 'LOC', method: 'POST', path: `/widgets?jwt=${secret}`, confirm: true },
    { locationId: 'LOC', method: 'POST', path: '/widgets', body: { authorization: `Bearer ${secret}` }, confirm: true },
    { locationId: 'LOC', method: 'POST', path: '/widgets', surprise: { apiKey: secret }, confirm: true },
  ];

  for (const args of cases) {
    const fx = fixture();
    const result = await rawRequestTool().handler(args, fx.deps);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'VALIDATION_FAILED');
    assert.doesNotMatch(JSON.stringify(result), /eyJ/);
    assert.equal(fx.made(), 0);
    assert.equal(fx.calls.length, 0);
  }
});

test('raw_request rejects opaque common credentials before preview or confirmed gateway access', async () => {
  const secrets = ['opaque-refresh-value', 'opaque-session-value', 'opaque-cookie-value'];
  const cases = [
    { locationId: 'LOC', method: 'POST', path: `/widgets?refreshToken=${secrets[0]}` },
    { locationId: 'LOC', method: 'POST', path: '/widgets', body: { sessionToken: secrets[1] } },
    { locationId: 'LOC', method: 'POST', path: '/widgets', cookie: secrets[2], confirm: true },
  ];

  for (const args of cases) {
    const fx = fixture();
    const result = await rawRequestTool().handler(args, fx.deps);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'VALIDATION_FAILED');
    for (const secret of secrets) assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.equal(fx.made(), 0);
    assert.equal(fx.calls.length, 0);
  }
});

test('raw_request fails closed for secret-keyed nested objects and arrays across previews and upstream failures', async () => {
  const previewMarker = 'preview-nested-marker';
  const successMarker = 'success-nested-marker';
  const httpMarker = 'http-nested-marker';
  const transportMarker = 'transport-nested-marker';

  const previewFixture = fixture();
  const preview = await rawRequestTool().handler({
    locationId: 'LOC', method: 'POST', path: '/widgets',
    body: { refresh_token: { previewMarker } },
  }, previewFixture.deps);
  assert.equal(preview.code, 'VALIDATION_FAILED');
  assert.doesNotMatch(JSON.stringify(preview), new RegExp(previewMarker));
  assert.equal(previewFixture.made(), 0);

  const successFixture = fixture({
    response: { status: 200, ok: true, json: { sessionToken: [{ successMarker }], safe: true } },
  });
  const success = await rawRequestTool().handler({
    locationId: 'LOC', method: 'POST', path: '/widgets', confirm: true,
  }, successFixture.deps);
  assert.equal(success.ok, true);
  assert.equal(success.data.json.sessionToken, '<redacted>');
  assert.doesNotMatch(JSON.stringify(success), new RegExp(successMarker));

  const httpFixture = fixture({
    response: { status: 500, ok: false, json: { credentials: { nested: [httpMarker] } } },
  });
  const http = await rawRequestTool().handler({
    locationId: 'LOC', method: 'POST', path: '/widgets', confirm: true,
  }, httpFixture.deps);
  assert.equal(http.code, 'HTTP_500');
  assert.doesNotMatch(JSON.stringify(http), new RegExp(httpMarker));

  const transportFixture = fixture({
    throwError: new Error(JSON.stringify({ refresh_token: [{ transportMarker }] })),
  });
  const transport = await rawRequestTool().handler({
    locationId: 'LOC', method: 'POST', path: '/widgets', confirm: true,
  }, transportFixture.deps);
  assert.equal(transport.code, 'ENGINE_ABORT');
  assert.doesNotMatch(JSON.stringify(transport), new RegExp(transportMarker));
});

test('confirmed raw HTTP and transport failures scrub opaque credentials from upstream errors', async () => {
  const httpSecret = 'opaque-access-value';
  const httpFixture = fixture({
    response: { status: 500, ok: false, json: { refresh_token: httpSecret } },
  });
  const httpResult = await rawRequestTool().handler({
    locationId: 'LOC', method: 'POST', path: '/widgets', confirm: true,
  }, httpFixture.deps);
  assert.equal(httpResult.code, 'HTTP_500');
  assert.doesNotMatch(JSON.stringify(httpResult), new RegExp(httpSecret));
  assert.match(httpResult.remediation, /raw request/i);
  assert.doesNotMatch(httpResult.remediation, /workflow|draft|republish|triggers/i);

  const transportSecret = 'opaque-session-value';
  const transportFixture = fixture({
    throwError: new Error(`socket lost; session_token=${transportSecret}`),
  });
  const transportResult = await rawRequestTool().handler({
    locationId: 'LOC', method: 'POST', path: '/widgets', confirm: true,
  }, transportFixture.deps);
  assert.equal(transportResult.code, 'ENGINE_ABORT');
  assert.doesNotMatch(JSON.stringify(transportResult), new RegExp(transportSecret));
});

test('raw write remediations stay endpoint-specific even for workflow-shaped HTTP codes', async () => {
  const fx = fixture({ response: { status: 409, ok: false, json: { message: 'conflict' } } });
  const result = await rawRequestTool().handler({
    locationId: 'LOC', method: 'POST', path: '/arbitrary-resource', confirm: true,
  }, fx.deps);

  assert.equal(result.code, 'VERSION_CONFLICT');
  assert.match(result.remediation, /raw request|target resource|endpoint/i);
  assert.doesNotMatch(result.remediation, /workflow|draft|republish|triggers/i);
});
