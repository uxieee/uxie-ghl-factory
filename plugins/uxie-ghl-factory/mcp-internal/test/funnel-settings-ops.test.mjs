// edit_funnel, f5b: security-header edit / delete, Meta pixel events add / edit / delete, and unpublishing a page with a redirect to another STEP.
// Bodies are the screen's (knowledge sniffs/funnels-wave38-f5b-settings-2026-09-30 ui-cap.*.BLOCKED.json — the saves were blocked, nothing sent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEditHeader, planDeleteHeader, planAddEvent, planEditEvent, planDeleteEvent, planPublishState, META_EVENTS } from '../core/funnel-ops.mjs';
import { TOOLS } from '../core/tools.mjs';

const FUNNEL = () => ({ _id: 'F1', name: 'TEST-CONF-FUN-X', type: 'funnel', domainId: 'D1',
  securityHeaders: [{ key: 'X-Test-Conf-Fun-Tool', value: 'tcf-tool' }, { key: 'X-Content-Type-Options', value: 'nosniff' }],
  steps: [{ id: 'S1', name: 'Optin', pages: ['P1'] }, { id: 'S2', name: 'Thanks', pages: ['P2'] }, { id: 'S3', name: 'NoDomain', pages: ['P3'] }] });

test('edit-header: PUT with the stored key (case as stored), only the value changes; unknown key, same value and non-string refused', () => {
  const p = planEditHeader({ funnel: FUNNEL(), locationId: 'L', key: 'x-test-conf-fun-tool', value: 'tcf-tool-v2' });
  assert.deepEqual(p.body, { locationId: 'L', funnelId: 'F1', key: 'X-Test-Conf-Fun-Tool', value: 'tcf-tool-v2' });
  assert.equal(p.method, 'PUT'); assert.equal(p.path, '/funnels/funnel/headers');
  assert.match(planEditHeader({ funnel: FUNNEL(), locationId: 'L', key: 'X-Nope', value: 'a' }).refuse, /no header X-Nope/);
  assert.match(planEditHeader({ funnel: FUNNEL(), locationId: 'L', key: 'X-Test-Conf-Fun-Tool', value: 'tcf-tool' }).refuse, /already has this value/);
  assert.match(planEditHeader({ funnel: FUNNEL(), locationId: 'L', key: 'X-Test-Conf-Fun-Tool' }).refuse, /new value/);
});

test('delete-header: the target check is the EXACT key and its current value; the body is the screen\'s', () => {
  const p = planDeleteHeader({ funnel: FUNNEL(), locationId: 'L', key: 'X-Test-Conf-Fun-Tool', expectValue: 'tcf-tool' });
  assert.deepEqual(p.body, { locationId: 'L', funnelId: 'F1', key: 'X-Test-Conf-Fun-Tool' }); assert.equal(p.path, '/funnels/funnel/headers/delete'); assert.equal(p.method, 'POST');
  assert.match(planDeleteHeader({ funnel: FUNNEL(), locationId: 'L', key: 'x-test-conf-fun-tool', expectValue: 'tcf-tool' }).refuse, /exact key/);
  assert.match(planDeleteHeader({ funnel: FUNNEL(), locationId: 'L', key: 'X-Content-Type-Options', expectValue: 'other' }).refuse, /target check failed/);
  assert.match(planDeleteHeader({ funnel: FUNNEL(), locationId: 'L', key: 'X-Content-Type-Options' }).refuse, /target check failed/);
});

test('add-event: the screen\'s POST body; funnel level takes no pageIds, page level needs pages of this funnel; a duplicate is refused; a token turns the API on', () => {
  const ok = planAddEvent({ funnel: FUNNEL(), locationId: 'L', event: { pixelId: '1234567890123456', level: 'funnel', events: ['page_view'] } });
  assert.deepEqual(ok.body, { funnelId: 'F1', type: 'funnel', locationId: 'L', conversionEnabled: false, level: 'funnel', pixelId: '1234567890123456', events: ['page_view'], provider: 'facebook' });
  const page = planAddEvent({ funnel: FUNNEL(), locationId: 'L', event: { pixelId: '1234567890123456', level: 'page', pageIds: ['P1'], events: ['purchase'] } });
  assert.deepEqual([page.body.pageIds, page.body.conversionEnabled, 'accessToken' in page.body], [['P1'], false, false]);
  assert.match(planAddEvent({ funnel: FUNNEL(), locationId: 'L', event: { pixelId: '1234567890123456', level: 'funnel', events: ['page_view'], conversionApi: { accessToken: 'x' } } }).refuse, /credential/);
  for (const [ev, re] of [[{ pixelId: 'abc', level: 'funnel', events: ['page_view'] }, /digits/], [{ pixelId: '1234567', level: 'funnel', events: [] }, /non-empty/], [{ pixelId: '1234567', level: 'funnel', events: ['nope'] }, /non-empty list/],
    [{ pixelId: '1234567', level: 'funnel', events: ['page_view', 'page_view'] }, /twice/], [{ pixelId: '1234567', level: 'funnel', pageIds: ['P1'], events: ['page_view'] }, /takes no pageIds/],
    [{ pixelId: '1234567', level: 'page', events: ['page_view'] }, /needs pageIds/], [{ pixelId: '1234567', level: 'page', pageIds: ['PX'], events: ['page_view'] }, /not pages of this funnel/],
    [{ pixelId: '1234567', level: 'nope', events: ['page_view'] }, /level/]]) {
    assert.match(planAddEvent({ funnel: FUNNEL(), locationId: 'L', event: ev }).refuse, re, JSON.stringify(ev));
  }
  assert.match(planAddEvent({ funnel: FUNNEL(), locationId: 'L', event: { pixelId: '1234567890123456', level: 'funnel', events: ['page_view'] }, existing: [{ pixelId: '1234567890123456', level: 'funnel', pageIds: [] }] }).refuse, /already has a funnel-level event/);
  assert.match(planAddEvent({ funnel: { ...FUNNEL(), type: 'website' }, locationId: 'L', event: { pixelId: '1234567890123456', level: 'funnel', events: ['page_view'] } }).refuse, /funnel only/);
  assert.deepEqual([...META_EVENTS], ['page_view', 'view_content', 'initiate_checkout', 'add_payment_info', 'purchase']);
});

const ROW = { _id: 'E1', pixelId: '1234567890123456', level: 'funnel', pageIds: [], conversionEnabled: false, events: ['page_view'] };
test('edit-event: the screen\'s PATCH body (an unnamed field keeps its value); the target check is id AND pixel; an API-on event needs its token again', () => {
  const p = planEditEvent({ funnel: FUNNEL(), locationId: 'L', rows: [ROW], eventId: 'E1', expectPixelId: '1234567890123456', event: { events: ['page_view', 'view_content'] } });
  assert.deepEqual(p.body, { conversionEnabled: false, type: 'funnel', accessToken: '', level: 'funnel', pageIds: [], pixelId: '1234567890123456', events: ['page_view', 'view_content'] });
  assert.equal(p.method, 'PATCH'); assert.equal(p.path, '/funnels/event/E1');
  assert.match(planEditEvent({ funnel: FUNNEL(), locationId: 'L', rows: [ROW], eventId: 'E1', expectPixelId: '999999999', event: {} }).refuse, /target check failed/);
  assert.match(planEditEvent({ funnel: FUNNEL(), locationId: 'L', rows: [ROW], eventId: 'E9', expectPixelId: '1', event: {} }).refuse, /no single meta event/);
  const on = { ...ROW, conversionEnabled: true };
  assert.match(planEditEvent({ funnel: FUNNEL(), locationId: 'L', rows: [on], eventId: 'E1', expectPixelId: ROW.pixelId, event: { events: ['purchase'] } }).refuse, /token is not readable/);
  assert.match(planEditEvent({ funnel: FUNNEL(), locationId: 'L', rows: [ROW], eventId: 'E1', expectPixelId: ROW.pixelId, event: { conversionApi: { accessToken: 'x' } } }).refuse, /only be false/);
  assert.equal(planEditEvent({ funnel: FUNNEL(), locationId: 'L', rows: [on], eventId: 'E1', expectPixelId: ROW.pixelId, event: { conversionApi: false } }).body.conversionEnabled, false);
  const lv = planEditEvent({ funnel: FUNNEL(), locationId: 'L', rows: [ROW], eventId: 'E1', expectPixelId: ROW.pixelId, event: { level: 'page', pageIds: ['P2'] } });
  assert.deepEqual([lv.body.level, lv.body.pageIds], ['page', ['P2']]);
});

test('delete-event: DELETE /funnels/event/{id}, no body, id AND pixel proven', () => {
  const p = planDeleteEvent({ rows: [ROW], eventId: 'E1', expectPixelId: ROW.pixelId });
  assert.deepEqual([p.method, p.path, p.body], ['DELETE', '/funnels/event/E1', undefined]);
  assert.match(planDeleteEvent({ rows: [ROW], eventId: 'E1', expectPixelId: '1' }).refuse, /target check failed/);
});

test('unpublish-page with redirect {type:"step"}: action funnel + the step id on every row; own step, unknown step and a step with no domain refused', () => {
  const lookups = [{ _id: 'R1', type: 'step', typeId: 'S1', domain: 'd.example' }, { _id: 'R1p', type: 'page', typeId: 'P1', domain: 'd.example' }, { _id: 'R2', type: 'step', typeId: 'S2', domain: 'd.example' }];
  const p = planPublishState({ funnel: FUNNEL(), lookups, pageId: 'P1', publish: false, redirect: { type: 'step', stepId: 'S2' }, user: { id: 'U', name: 'N' } });
  assert.deepEqual(p.body.lookups.map((l) => [l.lookupId, l.action, l.target, l.type, l.publishStatus]), [['R1', 'funnel', 'S2', 'redirect', 'unpublished'], ['R1p', 'funnel', 'S2', 'redirect', 'unpublished']]);
  assert.match(planPublishState({ funnel: FUNNEL(), lookups, pageId: 'P1', publish: false, redirect: { type: 'step', stepId: 'S1' } }).refuse, /own step/);
  assert.match(planPublishState({ funnel: FUNNEL(), lookups, pageId: 'P1', publish: false, redirect: { type: 'step', stepId: 'S9' } }).refuse, /not a step of this funnel/);
  assert.match(planPublishState({ funnel: FUNNEL(), lookups, pageId: 'P1', publish: false, redirect: { type: 'step', stepId: 'S3' } }).refuse, /no domain attached/);
});

// ---- through the tool, on a stateful fake ----
const tool = TOOLS.find((t) => t.name === 'edit_funnel');
function deps() {
  const db = { funnel: FUNNEL(), events: [{ ...ROW }], calls: [] };
  return { db, state: {}, rereadOptions: { tries: 2, delays: [0, 0] }, makeGw: () => ({ uid: 'U1', call: async (method, path, body) => {
    db.calls.push({ method, path, body });
    if (method === 'GET' && path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { data: structuredClone(db.funnel) } };
    if (method === 'GET' && path.startsWith('/funnels/funnel/headers')) return { ok: true, status: 200, json: { securityHeaders: structuredClone(db.funnel.securityHeaders) } };
    if (method === 'GET' && path.startsWith('/funnels/domain/')) return { ok: true, status: 200, json: { domains: [{ id: 'D1', url: 'sandbox.example.test' }] } };
    if (method === 'POST' && path === '/funnels/domain/invalidate-cache') return { ok: true, status: 201, json: { status: 'ok' } };
    if (method === 'GET' && path.startsWith('/funnels/event')) return { ok: true, status: 200, json: { events: structuredClone(db.events) } };
    if (method === 'PUT' && path === '/funnels/funnel/headers') { db.funnel.securityHeaders.find((h) => h.key === body.key).value = body.value; return { ok: true, status: 200, json: {} }; }
    if (method === 'POST' && path === '/funnels/funnel/headers/delete') { db.funnel.securityHeaders = db.funnel.securityHeaders.filter((h) => h.key !== body.key); return { ok: true, status: 201, json: {} }; }
    if (method === 'POST' && path === '/funnels/event') { const r = { _id: 'ENEW', ...body, pageIds: body.pageIds ?? [] }; db.events.push(r); return { ok: true, status: 201, json: r }; }
    if (method === 'PATCH' && path.startsWith('/funnels/event/')) { Object.assign(db.events.find((e) => e._id === path.split('/').pop()), body); return { ok: true, status: 200, json: {} }; }
    if (method === 'DELETE' && path.startsWith('/funnels/event/')) { db.events = db.events.filter((e) => e._id !== path.split('/').pop()); return { ok: true, status: 200, json: {} }; }
    throw new Error(`unexpected ${method} ${path}`);
  } }) };
}
const run = (args, d) => tool.handler({ locationId: 'L', funnelId: 'F1', ...args }, d);
const writes = (d) => d.db.calls.filter((c) => c.method !== 'GET');

test('tool: edit-header previews then writes the PUT and reads it back; delete-header refuses a wrong expectValue without a write, then deletes', async () => {
  const d = deps();
  const pre = await run({ op: 'edit-header', header: { key: 'X-Test-Conf-Fun-Tool', value: 'v2' } }, d);
  assert.equal(pre.code, 'CONFIRM_REQUIRED'); assert.equal(writes(d).length, 0);
  const r = await run({ op: 'edit-header', header: { key: 'X-Test-Conf-Fun-Tool', value: 'v2' }, confirm: true }, d);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.data.headers.find((h) => h.key === 'X-Test-Conf-Fun-Tool').value, 'v2');
  const bad = await run({ op: 'delete-header', header: { key: 'X-Test-Conf-Fun-Tool', expectValue: 'tcf-tool' }, confirm: true }, d);
  assert.equal(bad.code, 'VALIDATION_FAILED'); assert.equal(writes(d).length, 1);
  const del = await run({ op: 'delete-header', header: { key: 'X-Test-Conf-Fun-Tool', expectValue: 'v2' }, confirm: true }, d);
  assert.equal(del.ok, true, JSON.stringify(del)); assert.ok(!del.data.headers.some((h) => h.key === 'X-Test-Conf-Fun-Tool')); assert.ok(del.data.headers.some((h) => h.key === 'X-Content-Type-Options'));
});

test('tool: add / edit / delete an event, each read back; an access token is refused by the tool layer (a credential)', async () => {
  const d = deps();
  const ev = { pixelId: '2222222222', level: 'funnel', events: ['page_view', 'purchase'] };
  const cred = await run({ op: 'add-event', event: { ...ev, conversionApi: { accessToken: 'SECRET-TOKEN' } }, confirm: true }, d);
  assert.equal(cred.code, 'VALIDATION_FAILED'); assert.ok(!JSON.stringify(cred).includes('SECRET-TOKEN')); assert.equal(writes(d).length, 0);
  const pre = await run({ op: 'add-event', event: ev }, d);
  assert.equal(pre.code, 'CONFIRM_REQUIRED', JSON.stringify(pre).slice(0, 300)); assert.equal(pre.data.preview.request.body.conversionEnabled, false);
  const add = await run({ op: 'add-event', event: ev, confirm: true }, d);
  assert.equal(add.ok, true, JSON.stringify(add)); assert.equal(add.data.event.eventId, 'ENEW'); assert.equal(add.data.event.conversionApi, false);
  assert.deepEqual(add.data.cache, { called: true, domain: 'sandbox.example.test', status: 201, ok: true });
  assert.deepEqual(d.db.calls.find((c) => c.path === '/funnels/domain/invalidate-cache').body, { event: 'funnel_settings', domains: ['sandbox.example.test'], locationId: 'L' });
  const edit = await run({ op: 'edit-event', event: { eventId: 'E1', expectPixelId: ROW.pixelId, events: ['page_view', 'view_content', 'initiate_checkout'] }, confirm: true }, d);
  assert.equal(edit.ok, true, JSON.stringify(edit)); assert.deepEqual(edit.data.event.events, ['page_view', 'view_content', 'initiate_checkout']);
  const wrong = await run({ op: 'delete-event', event: { eventId: 'E1', expectPixelId: '5' }, confirm: true }, d);
  assert.equal(wrong.code, 'VALIDATION_FAILED'); assert.ok(d.db.events.some((e) => e._id === 'E1'));
  const del = await run({ op: 'delete-event', event: { eventId: 'E1', expectPixelId: ROW.pixelId }, confirm: true }, d);
  assert.equal(del.ok, true, JSON.stringify(del)); assert.ok(!d.db.events.some((e) => e._id === 'E1')); assert.ok(d.db.events.some((e) => e._id === 'ENEW'));
  assert.equal((await run({ op: 'delete-event', event: { expectPixelId: '1' }, confirm: true }, d)).code, 'VALIDATION_FAILED');
});
