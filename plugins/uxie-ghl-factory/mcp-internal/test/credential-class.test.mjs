import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CREDENTIAL_CLASSES, credentialClassFromClaims, reachForCaller } from '../core/credential-class.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the class is the token-id (scope, role) pair, and half a pair is no class', () => {
  assert.equal(credentialClassFromClaims({ scope: 'agency', role: 'admin' }), 'agency-admin-bearer');
  assert.equal(credentialClassFromClaims({ scope: 'account', role: 'user' }), 'location-user-bearer');
  assert.equal(credentialClassFromClaims({ scope: 'agency', role: null }), null);
  assert.equal(credentialClassFromClaims(null), null);
});

test('reachForCaller says only what the evidence supports', () => {
  const split = { provenFor: ['agency-admin-bearer'], refusedFor: ['location-user-bearer'] };
  assert.equal(reachForCaller(split, 'location-user-bearer'), 'refused');
  assert.equal(reachForCaller(split, 'agency-admin-bearer'), 'proven');
  assert.equal(reachForCaller(split, 'location-admin-bearer'), 'unproven-for-your-class');
  assert.equal(reachForCaller(split, null), null, 'an unknown caller gets silence, not a guess');
  assert.equal(reachForCaller({ reach: 'proven' }, 'agency-admin-bearer'), null, 'a row with no named class says nothing about any class');
});

test('every class the shipped catalogue names is in the vocabulary', () => {
  const rows = JSON.parse(readFileSync(resolve(HERE, '../catalog/internal-endpoints.json'), 'utf8')).endpoints;
  const named = new Set(rows.flatMap((e) => [...(e.provenFor ?? []), ...(e.refusedFor ?? [])]));
  assert.ok(named.size > 0, 'expected the catalogue to name at least one class');
  for (const c of named) assert.ok(CREDENTIAL_CLASSES.includes(c), `catalogue names an unknown class '${c}'`);
  for (const e of rows) if (e.reach === 'refused') assert.ok(!e.provenFor, `${e.path}: refused yet provenFor`);
});

test('the prober in knowledge/ carries the SAME vocabulary (skipped when knowledge/ is absent)', async (t) => {
  const lib = resolve(HERE, '../../../../../knowledge/scripts/lib/reach-ledger.mjs');
  if (!existsSync(lib)) return t.skip('knowledge/ is not beside this checkout');
  const k = await import(pathToFileURL(lib).href);
  assert.deepEqual([...k.CREDENTIAL_CLASSES], [...CREDENTIAL_CLASSES]);
});
