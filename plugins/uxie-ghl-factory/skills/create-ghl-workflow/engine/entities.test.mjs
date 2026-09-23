// fetchEntities was 21 hand-written GETs beside 21 hand-written projections, so adding an account
// object meant editing three files and a tool description that had already drifted from both — it
// advertised six kinds while returning twenty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTITY_REGISTRY, entityCapabilities, registryResolvers } from './entities.mjs';
import { fetchEntities } from './orchestrate.mjs';

test('every registry row is well formed and unique', () => {
  const keys = ENTITY_REGISTRY.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const e of ENTITY_REGISTRY) {
    assert.equal(typeof e.path('LOC'), 'string', e.key);
    assert.ok(e.path('LOC').startsWith('/'), e.key);
    assert.equal(typeof e.pick, 'function', e.key);
    assert.equal(typeof e.project, 'function', e.key);
  }
  assert.equal(entityCapabilities().length, ENTITY_REGISTRY.length);
  assert.ok(entityCapabilities().every((c) => c.method === 'GET' && !c.path.includes('?')),
    'a capability row states the endpoint, not one call\'s arguments');
});

test('fetchEntities returns every registry key, and a failing leg degrades to [] without throwing', async () => {
  const calls = [];
  const gw = { loc: 'LOC', call: async (m, p) => { calls.push(p); return p.includes('/users/') ? { ok: false, json: {} } : { ok: true, json: {} }; } };
  const out = await fetchEntities(gw);
  for (const e of ENTITY_REGISTRY) assert.ok(Array.isArray(out[e.key]), `${e.key} must be an array`);
  assert.deepEqual(out.users, [], 'a 404 is [] for that key, never a thrown sweep');
  assert.ok(Array.isArray(out.agents), 'agents is a MERGE of two endpoints and stays hand-written');
  assert.equal(calls.length, ENTITY_REGISTRY.length + 2, 'one call per row, plus the two agent endpoints');
});

test('projections survive whichever envelope the endpoint uses', async () => {
  const gw = { loc: 'LOC', call: async (m, p) => {
    if (p.includes('/opportunities/pipelines')) return { ok: true, json: { pipelines: [{ id: 'P1', name: 'Main', stages: [{ id: 'S1', name: 'New' }] }] } };
    if (p.includes('/opportunities/lost-reason')) return { ok: true, json: { data: [{ id: 'LR1', name: 'Too expensive' }] } };
    if (p.includes('/call-dispositions')) return { ok: true, json: [{ id: 'D1', name: 'Booked' }] };
    return { ok: true, json: {} };
  } };
  const out = await fetchEntities(gw);
  assert.deepEqual(out.pipelines, [{ id: 'P1', name: 'Main', stages: [{ id: 'S1', name: 'New' }] }]);
  assert.deepEqual(out.lostReasons, [{ id: 'LR1', name: 'Too expensive' }]);
  assert.deepEqual(out.callDispositions, [{ id: 'D1', name: 'Booked' }], 'a bare array envelope works too');
});

test('the registry carries lost reasons and call dispositions with the right resolver semantics', () => {
  const lr = ENTITY_REGISTRY.find((e) => e.key === 'lostReasons');
  assert.ok(lr && lr.path('LOC').startsWith('/opportunities/lost-reason'));
  assert.equal(lr.resolver.name, 'lostReasonId');
  const cd = ENTITY_REGISTRY.find((e) => e.key === 'callDispositions');
  assert.ok(cd && cd.path('LOC').includes('/phone-system/call-dispositions'));
  assert.equal(cd.resolver.name, 'callDisposition');
  assert.equal(cd.resolver.value({ id: 'X', name: 'Booked' }), 'Booked',
    'dispositions are matched BY NAME at runtime, so the resolver returns the name it validated, not an id');
});

test('registryResolvers builds name lookups from projected rows, case-insensitively', () => {
  const r = registryResolvers({ lostReasons: [{ id: 'LR1', name: 'Too expensive' }], callDispositions: [{ id: 'D1', name: 'Booked' }] });
  assert.equal(r.lostReasonId('Too expensive'), 'LR1');
  assert.equal(r.lostReasonId('  too EXPENSIVE '), 'LR1');
  assert.equal(r.lostReasonId('nope'), undefined);
  assert.equal(r.callDisposition('booked'), 'Booked');
  assert.equal(r.callDisposition(''), undefined);
});

test('events and eventTickets read the two arrays of ONE options envelope, as {id,name}', () => {
  const ev = ENTITY_REGISTRY.find((e) => e.key === 'events');
  const tk = ENTITY_REGISTRY.find((e) => e.key === 'eventTickets');
  const envelope = { events: [{ value: 'EV1', label: 'Open Day' }], eventTickets: [{ value: 'TK1', label: 'VIP' }], traceId: 't' };
  assert.deepEqual(ev.pick(envelope).map(ev.project), [{ id: 'EV1', name: 'Open Day' }]);
  assert.deepEqual(tk.pick(envelope).map(tk.project), [{ id: 'TK1', name: 'VIP' }]);
  assert.equal(ev.path('L'), tk.path('L'), 'same endpoint');
  assert.deepEqual(ev.pick({ traceId: 't' }), [], 'an envelope with no events array is an empty list, not a crash');
});

// ── Paged legs and unreadable legs (2026-09-23) ─────────────────────────────────────────────────
// The workflows leg read ONE page of 200 while the sandbox holds 1,125; documentTemplates asked for
// limit=100 and was refused (422, max 21) on every call. Both looked exactly like an account with
// fewer (or no) objects.
const wfRow = (i) => ({ _id: `w${i}`, name: `WF ${String(i).padStart(4, '0')}`, status: 'draft', type: 'workflow' });
const pagedGw = (total, { ignoreOffset = false, status = {} } = {}) => {
  const calls = [];
  return { calls, loc: 'LOC', call: async (m, p) => {
    calls.push(p);
    for (const [frag, code] of Object.entries(status)) if (p.includes(frag)) return { ok: false, status: code, json: { message: ['nope'] } };
    if (p.includes('/workflow/LOC/list')) {
      const u = new URLSearchParams(p.split('?')[1]);
      const off = ignoreOffset ? 0 : Number(u.get('offset')), lim = Number(u.get('limit'));
      return { ok: true, status: 200, json: { rows: Array.from({ length: Math.max(0, Math.min(lim, total - off)) }, (_, k) => wfRow(off + k)), count: total } };
    }
    return { ok: true, status: 200, json: {} };
  } };
};

test('the workflows leg walks every page to the envelope count, with agent workflows included', async () => {
  const gw = pagedGw(250);
  const out = await fetchEntities(gw);
  assert.equal(out.workflows.length, 250, 'a name past the first page must be resolvable');
  const wf = gw.calls.filter((p) => p.includes('/workflow/LOC/list'));
  assert.deepEqual(wf.map((p) => new URLSearchParams(p.split('?')[1]).get('offset')), ['0', '100', '200']);
  assert.ok(wf.every((p) => p.includes('includeObjectiveBuilder=true') && p.includes('limit=100')));
});

test('a service that ignores the offset returns page one again: the walk stops, it never loops or duplicates', async () => {
  const gw = pagedGw(250, { ignoreOffset: true });
  const out = await fetchEntities(gw);
  assert.equal(out.workflows.length, 100);
  assert.equal(gw.calls.filter((p) => p.includes('/workflow/LOC/list')).length, 2);
});

test('documentTemplates asks within the service limit (21), and a refused leg is recorded as UNREADABLE, not empty', async () => {
  const gw = pagedGw(0, { status: { '/proposals/templates': 422 } });
  const out = await fetchEntities(gw);
  const tp = gw.calls.find((p) => p.includes('/proposals/templates'));
  assert.equal(new URLSearchParams(tp.split('?')[1]).get('limit'), '21');
  assert.deepEqual(out.documentTemplates, []);
  assert.deepEqual(out.unreadable.filter((u) => u.key === 'documentTemplates'), [{ key: 'documentTemplates', status: 422 }]);
  assert.ok(!Object.keys(out).includes('unreadable'), 'the key set stays the registry\'s');
});
