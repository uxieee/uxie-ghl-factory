// raw_request refuses a POST/PUT/PATCH with nothing to send (workflows wave21). The pure predicate first, then the
// handler: a refused call makes NO gateway and sends nothing, allowEmptyBody opens only the general rule (never the
// path-scoped ones), and DELETE / non-empty writes are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { refuseEmptyWriteBody } from '../core/raw-request-guards.mjs';

const raw = () => TOOLS.find((t) => t.name === 'raw_request');
const L = 'LOC1';
function fixture() {
  const calls = []; let made = 0;
  const gw = { loc: L, uid: 'u', call: async (method, path, body) => { calls.push({ method, path, body }); return { ok: true, status: 200, json: { ok: true } }; } };
  return { calls, made: () => made, deps: { state: { tokenFile: '/fixture/token.txt' }, makeGw: () => { made++; return gw; } } };
}
// Every shape that is empty AS SENT: no body, null, {}, [], and a key whose value JSON.stringify drops.
const EMPTY = [undefined, null, {}, [], { contactId: undefined }];

test('refuseEmptyWriteBody: every empty shape on POST/PUT/PATCH is refused; allowEmptyBody opens it', () => {
  for (const method of ['POST', 'PUT', 'PATCH']) for (const body of EMPTY) {
    assert.equal(refuseEmptyWriteBody({ method, body })?.rule, 'empty-write-body', `${method} ${JSON.stringify(body)}`);
    assert.equal(refuseEmptyWriteBody({ method, body, allowEmptyBody: true }), null);
  }
});

test('refuseEmptyWriteBody CONTROL: GET, DELETE and a non-empty body are never refused', () => {
  for (const body of EMPTY) for (const method of ['GET', 'DELETE']) assert.equal(refuseEmptyWriteBody({ method, body }), null);
  for (const body of [{ name: 'x' }, [{ id: 1 }], { flag: false }, { n: 0 }]) assert.equal(refuseEmptyWriteBody({ method: 'POST', body }), null, JSON.stringify(body));
});

test('the measured slip: POST /opportunities/ with {} and confirm:true is EMPTY_WRITE_BODY — no gateway made, nothing sent', async () => {
  const f = fixture();
  const out = await raw().handler({ locationId: L, method: 'POST', path: '/opportunities/', body: {}, confirm: true }, f.deps);
  assert.equal(out.ok, false); assert.equal(out.code, 'EMPTY_WRITE_BODY');
  assert.match(out.remediation, /allowEmptyBody/);
  assert.equal(f.made(), 0); assert.equal(f.calls.length, 0);
});

test('refused BEFORE the confirm gate: no preview is offered for an empty write', async () => {
  const f = fixture();
  const out = await raw().handler({ locationId: L, method: 'PUT', path: '/widgets/1' }, f.deps);
  assert.equal(out.code, 'EMPTY_WRITE_BODY'); assert.equal(f.made(), 0);
});

test('a pre-serialized "{}" string is parsed back and refused the same way', async () => {
  const f = fixture();
  const out = await raw().handler({ locationId: L, method: 'PATCH', path: '/widgets/1', body: '{}', confirm: true }, f.deps);
  assert.equal(out.code, 'EMPTY_WRITE_BODY'); assert.equal(f.calls.length, 0);
});

test('allowEmptyBody:true sends a bodiless write once (a bodiless enrol)', async () => {
  const f = fixture();
  const out = await raw().handler({ locationId: L, method: 'POST', path: '/contacts/C1/workflow/W1', confirm: true, allowEmptyBody: true }, f.deps);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(f.calls.map((c) => [c.method, c.path, c.body]), [['POST', '/contacts/C1/workflow/W1', undefined]]);
});

test('allowEmptyBody does NOT open a path-scoped rule: an empty start-workflow body stays refused by its own rule', async () => {
  const f = fixture();
  const out = await raw().handler({ locationId: L, method: 'POST', path: `/workflow/${L}/W1/start-workflow`, body: {}, confirm: true, allowEmptyBody: true }, f.deps);
  assert.equal(out.code, 'VALIDATION_FAILED'); assert.match(out.detail, /PHANTOM/); assert.equal(f.calls.length, 0);
});

test('the path-scoped rule keeps its more specific message: an empty pipeline-position PATCH names targetPosition', async () => {
  const f = fixture();
  const out = await raw().handler({ locationId: L, method: 'PATCH', path: '/opportunities/pipelines/P1/position', body: {}, confirm: true }, f.deps);
  assert.equal(out.code, 'VALIDATION_FAILED'); assert.match(out.detail, /targetPosition/); assert.equal(f.calls.length, 0);
});

test('CONTROL: DELETE with no body and a non-empty POST are sent', async () => {
  const f = fixture();
  assert.equal((await raw().handler({ locationId: L, method: 'DELETE', path: '/widgets/1', confirm: true }, f.deps)).ok, true);
  assert.equal((await raw().handler({ locationId: L, method: 'POST', path: '/widgets', body: { name: 'x' }, confirm: true }, f.deps)).ok, true);
  assert.deepEqual(f.calls.map((c) => c.method), ['DELETE', 'POST']);
});
