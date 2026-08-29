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
