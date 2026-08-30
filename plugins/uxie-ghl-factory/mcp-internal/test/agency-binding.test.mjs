// The response shape here was measured against the live endpoint on 2026-08-30: the rows are at
// data.json.locations and the agency's own total is at data.json.hit[0].count. A parser written
// against the obvious top-level `locations` finds nothing and silently reports an empty agency,
// which reconcile would then read as "every bound id is unknown".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryRequest, parseLocations, reconcile } from '../scripts/agency-binding.mjs';

const A = 'LOCAAA0000000000001';
const B = 'LOCBBB0000000000002';
const C = 'LOCCCC0000000000003';

const live = () => ({ ok: true, data: { status: 200, json: {
  hit: [{ count: 2 }],
  locations: [{ _id: A, name: 'Alpha' }, { _id: B, name: 'Beta' }],
} } });

test('discoveryRequest builds the measured path', () => {
  const r = discoveryRequest('COMPANY123');
  assert.equal(r.method, 'GET');
  assert.match(r.path, /^\/locations\/search\?/);
  assert.match(r.path, /companyId=COMPANY123/);
});

test('parseLocations reads the nested shape, not a top-level guess', () => {
  const { total, locations } = parseLocations(live());
  assert.equal(total, 2);
  assert.deepEqual(locations, [{ id: A, name: 'Alpha' }, { id: B, name: 'Beta' }]);
});

test('parseLocations on an unexpected shape returns empty and a null total, never a throw', () => {
  for (const bad of [null, {}, { data: {} }, { data: { json: {} } }]) {
    const { total, locations } = parseLocations(bad);
    assert.deepEqual(locations, []);
    assert.equal(total, null);
  }
});

test('reconcile splits bound against available', () => {
  const r = reconcile({ bound: [A, C], available: [{ id: A, name: 'Alpha' }, { id: B, name: 'Beta' }] });
  assert.deepEqual(r.matched, [A]);
  assert.deepEqual(r.missing, [B], 'in the agency but not bound');
  assert.deepEqual(r.unknown, [C], 'bound but not in the agency — refuses forever, silently');
});

test('reconcile on an empty agency reports nothing missing rather than everything unknown', () => {
  // An empty `available` means discovery failed or could not run. Treating that as "every bound id
  // is unknown" would tell the user their whole binding is wrong.
  const r = reconcile({ bound: [A], available: [] });
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.matched, []);
});

test('reconcile is order-independent and deduplicates', () => {
  const r = reconcile({ bound: [B, A, A], available: [{ id: A, name: 'A' }, { id: B, name: 'B' }] });
  assert.deepEqual(r.matched.slice().sort(), [A, B].sort());
});
