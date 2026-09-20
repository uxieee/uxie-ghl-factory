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

test('the per-workflow change-status door refuses published — draft passes (control), and the BULK route now refuses published under its OWN rule', () => {
  const one = `/workflow/${L}/change-status/${W}`;
  const hit = refuseRawRequest({ method: 'PUT', path: one, body: { status: 'published', updatedBy: 'u' } });
  assert.equal(hit?.rule, 'change-status-publish-door');
  assert.match(hit.hint, /publish_workflow/);
  assert.equal(refuseRawRequest({ method: 'PUT', path: one, body: { status: 'draft', updatedBy: 'u' } }), null);
  // The bulk route has no trailing workflow id. It is what publish_workflow and unpublish_workflows
  // call — but they call it through the gateway, never through raw_request, so this guard cannot
  // touch them; it only closes the same bypass for a caller reaching the bulk route directly.
  const bulkHit = refuseRawRequest({ method: 'PUT', path: `/workflow/${L}/change-status`, body: { workflowIds: [W], status: 'published', updatedBy: 'u' } });
  assert.equal(bulkHit?.rule, 'bulk-change-status-publish-door');
  assert.match(bulkHit.hint, /publish_workflow/);
});

test('the BULK publish door is refused for published, whatever case or padding — draft still passes (control), and a GET on the same path is never refused', () => {
  const bulk = `/workflow/${L}/change-status`;
  for (const status of ['PUBLISHED', 'published ', ' Published']) {
    const hit = refuseRawRequest({ method: 'PUT', path: bulk, body: { workflowIds: [W], status, updatedBy: 'u' } });
    assert.equal(hit?.rule, 'bulk-change-status-publish-door', JSON.stringify(status));
  }
  // CONTROL: bulk unpublish must stay reachable — unpublish_workflows relies on exactly this shape.
  assert.equal(refuseRawRequest({ method: 'PUT', path: bulk, body: { workflowIds: [W], status: 'draft', updatedBy: 'u' } }), null);
  assert.equal(refuseRawRequest({ method: 'PUT', path: bulk, body: { workflowIds: [W], status: 'DRAFT', updatedBy: 'u' } }), null);
  // Method scoping: a GET on the bulk path is never refused.
  assert.equal(refuseRawRequest({ method: 'GET', path: bulk, body: undefined }), null);
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

// ---- the WIRE shape, not the JS value ---------------------------------------------------------
// Every predicate has to ask what the GATEWAY will send. JSON.stringify drops a key whose value is
// undefined, and an array is not a plain object — so the body a caller holds and the body GHL
// receives are not the same value, and it is the second one that does the damage.

test('start-workflow: an ARRAY body is refused — it serialises to the same nothing; a non-empty one is not (control)', () => {
  const path = `/workflow/${L}/${W}/start-workflow`;
  assert.equal(refuseRawRequest({ method: 'POST', path, body: [] })?.rule, 'start-workflow-empty-body');
  assert.equal(refuseRawRequest({ method: 'POST', path, body: [{ contactId: 'c1' }] }), null);
});

test('a key whose value is undefined is NOT a key on the wire — both emptiness rules see through it', () => {
  const sw = `/workflow/${L}/${W}/start-workflow`;
  assert.equal(refuseRawRequest({ method: 'POST', path: sw, body: { contactId: undefined } })?.rule, 'start-workflow-empty-body');
  assert.equal(refuseRawRequest({ method: 'POST', path: sw, body: { contactId: 'c1' } }), null);
  const perm = `/workflow/${L}/permission/${W}`;
  assert.equal(refuseRawRequest({ method: 'PUT', path: perm, body: { permission: undefined } })?.rule, 'permission-needs-key');
  assert.equal(refuseRawRequest({ method: 'PUT', path: perm, body: { permission: 0 } }), null);
  const rss = `/workflow/${L}/${W}/remove-stuck-statuses/${S}`;
  assert.equal(refuseRawRequest({ method: 'POST', path: rss, body: { statusIds: undefined } })?.rule, 'remove-stuck-statuses-needs-statusIds');
  assert.equal(refuseRawRequest({ method: 'POST', path: rss, body: { statusIds: ['s1'] } }), null);
});

test('the publish door is closed whatever case or padding the status arrives in — draft still passes (control)', () => {
  const one = `/workflow/${L}/change-status/${W}`;
  for (const status of ['PUBLISHED', 'published ', ' Published']) {
    assert.equal(refuseRawRequest({ method: 'PUT', path: one, body: { status, updatedBy: 'u' } })?.rule, 'change-status-publish-door', JSON.stringify(status));
  }
  assert.equal(refuseRawRequest({ method: 'PUT', path: one, body: { status: 'draft', updatedBy: 'u' } }), null);
  assert.equal(refuseRawRequest({ method: 'PUT', path: one, body: { status: 'DRAFT', updatedBy: 'u' } }), null);
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
