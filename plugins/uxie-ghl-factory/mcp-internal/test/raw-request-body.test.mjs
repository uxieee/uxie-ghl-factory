// raw_request must not double-encode its body.
//
// The gateway serializes every body with JSON.stringify, and raw_request's `body` is
// z.unknown() — so a caller handing over an already-serialized JSON STRING (the natural
// thing when hand-writing an escape-hatch payload) had it stringified a second time. The
// wire carried "{\"locationId\":...}" — a JSON string whose contents are JSON — and
// upstream answered `Unexpected token '"', ""{\"locati"... is not valid JSON`.
// Reproduced on three payloads live on AU 2026-07-25; it blocked every non-GET
// escape-hatch call, including the agent→flow link PUT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const raw = TOOLS.find((t) => t.name === 'raw_request');

// Captures what the handler hands the gateway — i.e. what JSON.stringify will be applied
// to, which is exactly where the defect lived.
function spyDeps() {
  const sent = [];
  return {
    sent,
    deps: {
      state: {},
      makeGw: () => ({
        call: async (method, path, body) => {
          sent.push({ method, path, body });
          return { ok: true, status: 200, json: { ok: true } };
        },
      }),
    },
  };
}

const LINK_BODY = { locationId: 'LOC1', isObjectiveBuilderEnabled: true, objectiveBuilderWorkflowId: 'WID1' };

test('a pre-serialized JSON string body is parsed back to an object before the gateway', async () => {
  const { sent, deps } = spyDeps();
  const r = await raw.handler({
    locationId: 'LOC1', method: 'PUT', path: '/ai-employees/employees/A1',
    body: JSON.stringify(LINK_BODY), confirm: true,
  }, deps);

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sent.length, 1);
  // The gateway must receive an OBJECT. If it receives the string, JSON.stringify turns it
  // into the double-encoded payload upstream rejects.
  assert.equal(typeof sent[0].body, 'object');
  assert.deepEqual(sent[0].body, LINK_BODY);
  assert.doesNotMatch(JSON.stringify(sent[0].body), /\\"/, 'no escaped quotes = not double-encoded');
});

test('an object body is passed through untouched (the path that always worked)', async () => {
  const { sent, deps } = spyDeps();
  await raw.handler({ locationId: 'LOC1', method: 'POST', path: '/workflow/LOC1', body: LINK_BODY, confirm: true }, deps);
  assert.deepEqual(sent[0].body, LINK_BODY);
});

test('the confirm PREVIEW shows the normalized body, not the raw string', async () => {
  // The operator approves what they see here, so the preview has to be what gets sent.
  const deps = { state: {}, makeGw: () => { throw new Error('gateway must not be constructed'); } };
  const r = await raw.handler({
    locationId: 'LOC1', method: 'PUT', path: '/ai-employees/employees/A1', body: JSON.stringify(LINK_BODY),
  }, deps);

  assert.equal(r.ok, false);
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(r.data.preview.body, LINK_BODY);
});

test('a string that is not JSON is a clear validation error, not a mangled request', async () => {
  const deps = { state: {}, makeGw: () => { throw new Error('gateway must not be constructed'); } };
  const r = await raw.handler({
    locationId: 'LOC1', method: 'POST', path: '/x', body: 'not json at all', confirm: true,
  }, deps);

  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(JSON.stringify(r), /not valid JSON/);
});

test('a body-less GET is unaffected', async () => {
  const { sent, deps } = spyDeps();
  const r = await raw.handler({ locationId: 'LOC1', method: 'GET', path: '/workflow/LOC1/list?limit=1' }, deps);
  assert.equal(r.ok, true);
  assert.equal(sent[0].body, undefined);
});

// Guards the root cause itself: if the gateway ever stops stringifying, the parse-back
// above becomes wrong and this test says so.
test('the gateway still JSON.stringifies, which is why the parse-back is needed', async () => {
  const { makeGateway } = await import('../core/gateway.mjs');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'rawbody-')), 'tok.txt');
  writeFileSync(tokenFile, `Bearer eyJhbGciOiJIUzI1NiJ9.${b64({ authClassId: 'u-1', exp })}.sig\n`);

  let wire;
  const gw = makeGateway({
    tokenFile,
    loc: 'LOC1',
    fetchImpl: async (_url, init) => { wire = init.body; return { status: 200, ok: true, text: async () => '{}' }; },
    sleepImpl: async () => {},
    randomImpl: () => 0,
  });
  await gw.call('POST', '/x', { a: 1 });
  assert.equal(wire, '{"a":1}');

  // And the shape the defect produced, for the record: a string body would arrive on the
  // wire as a JSON string containing JSON — exactly what upstream rejected.
  await gw.call('POST', '/x', '{"a":1}');
  assert.equal(wire, '"{\\"a\\":1}"');
});
