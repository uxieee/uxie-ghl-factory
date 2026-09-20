import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuseRawRequest, matchCatalogRow } from '../core/raw-request-guards.mjs';
import { TOOLS } from '../core/tools.mjs';

const L = 'LOC', W = 'wf-1', S = 'step-1';

test('remove-stuck-statuses is refused WITHOUT statusIds — and allowed with them (control)', () => {
  const path = `/workflow/${L}/${W}/remove-stuck-statuses/${S}?userId=u`;
  for (const body of [undefined, {}, { actionFrom: {} }, { statusIds: [] }, { statusIds: 'abc' }]) {
    assert.equal(refuseRawRequest({ method: 'POST', path, body })?.rule, 'remove-stuck-statuses-needs-statusIds', JSON.stringify(body));
  }
  assert.equal(refuseRawRequest({ method: 'POST', path, body: { statusIds: ['s1'] } }), null);
});

test('start-workflow is refused with an empty body — and allowed with a real one (control)', () => {
  const path = `/workflow/${L}/${W}/start-workflow`;
  for (const body of [undefined, null, {}]) {
    assert.equal(refuseRawRequest({ method: 'POST', path, body })?.rule, 'start-workflow-empty-body', JSON.stringify(body));
  }
  assert.equal(refuseRawRequest({ method: 'POST', path, body: { contactId: 'c1', actionFrom: { userId: 'u' } } }), null);
});

test('the per-workflow change-status door refuses published — draft, and the BULK route, pass (controls)', () => {
  const one = `/workflow/${L}/change-status/${W}`;
  const hit = refuseRawRequest({ method: 'PUT', path: one, body: { status: 'published', updatedBy: 'u' } });
  assert.equal(hit?.rule, 'change-status-publish-door');
  assert.match(hit.hint, /publish_workflow/);
  assert.equal(refuseRawRequest({ method: 'PUT', path: one, body: { status: 'draft', updatedBy: 'u' } }), null);
  // The bulk route has no trailing workflow id; it is what publish_workflow itself calls. Out of this guard's scope.
  assert.equal(refuseRawRequest({ method: 'PUT', path: `/workflow/${L}/change-status`, body: { workflowIds: [W], status: 'published', updatedBy: 'u' } }), null);
});

test('permission/{workflowId} is refused with no `permission` key — a 0 is a key (control), and /permissions is another route', () => {
  const path = `/workflow/${L}/permission/${W}`;
  for (const body of [undefined, {}, { permissions: 280 }]) {
    assert.equal(refuseRawRequest({ method: 'PUT', path, body })?.rule, 'permission-needs-key', JSON.stringify(body));
  }
  assert.equal(refuseRawRequest({ method: 'PUT', path, body: { permission: 280 } }), null);
  assert.equal(refuseRawRequest({ method: 'PUT', path, body: { permission: 0 } }), null);
  assert.equal(refuseRawRequest({ method: 'PUT', path: `/workflow/${L}/permissions`, body: {} }), null);
});

test('guards are method-scoped: a GET on the same path is never refused', () => {
  assert.equal(refuseRawRequest({ method: 'GET', path: `/workflow/${L}/${W}/start-workflow` }), null);
});

test('matchCatalogRow maps a wire path to its templated row, ignores the query, and prefers the most literal row', () => {
  const pool = [
    { id: 'a', method: 'PUT', path: '/workflow/{locationId}/{workflowId}' },
    { id: 'b', method: 'PUT', path: '/workflow/{locationId}/change-status' },
    { id: 'c', method: 'PUT', path: '/workflow/{locationId}/change-status/{workflowId}' },
    { id: 'd', method: 'GET', path: '/workflow/{locationId}/change-status' },
  ];
  assert.equal(matchCatalogRow(pool, 'PUT', '/workflow/LOC/change-status?x=1')?.id, 'b');
  assert.equal(matchCatalogRow(pool, 'PUT', '/workflow/LOC/change-status/wf-1')?.id, 'c');
  assert.equal(matchCatalogRow(pool, 'put', '/workflow/LOC/wf-1')?.id, 'a');
  assert.equal(matchCatalogRow(pool, 'DELETE', '/workflow/LOC/change-status'), null);
  assert.equal(matchCatalogRow(pool, 'PUT', '/nothing/like/this/at/all'), null);
});

// ---- handler wiring ---------------------------------------------------------------------------
const raw = () => TOOLS.find((t) => t.name === 'raw_request');
const fixture = () => {
  const calls = [];
  return { calls, deps: { state: { tokenFile: '/fixture/token.txt' }, makeGw: () => ({ loc: L, uid: 'u', call: async (m, p, b) => { calls.push({ m, p, b }); return { status: 200, ok: true, json: {} }; } }) } };
};

test('a refused shape fails VALIDATION_FAILED even WITH confirm:true, and the gateway is never reached', async () => {
  const f = fixture();
  const r = await raw().handler({ locationId: L, method: 'POST', path: `/workflow/${L}/${W}/start-workflow`, body: {}, confirm: true }, f.deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.equal(f.calls.length, 0);
});

test('the CONFIRM preview carries the catalogue trap note for a route that has one — and no `trap` key for a route that has none (control)', async () => {
  const f = fixture();
  const withNote = await raw().handler({ locationId: L, method: 'DELETE', path: `/workflow/${L}/split?workflowId=${W}&stepId=${S}` }, f.deps);
  assert.equal(withNote.code, 'CONFIRM_REQUIRED');
  assert.match(withNote.data.preview.trap.note, /WIPES A SPLIT STEP'S EXECUTION HISTORY/);
  assert.equal(withNote.data.preview.trap.kind, 'destructive');
  const without = await raw().handler({ locationId: L, method: 'POST', path: '/no/such/route/anywhere' }, f.deps);
  assert.equal(without.code, 'CONFIRM_REQUIRED');
  assert.equal(Object.hasOwn(without.data.preview, 'trap'), false);
  assert.equal(f.calls.length, 0);
});
