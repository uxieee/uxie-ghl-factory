import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGateway, FIRESTORE_HOST } from '../core/gateway.mjs';

const TOK = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tok.txt');

test('firebase rail refuses a non-Firestore target', async () => {
  const gw = makeGateway({ tokenFile: TOK, loc: 'LOCATION_ID', rail: 'firebase' });
  await assert.rejects(
    () => gw.call('POST', '/v1/x', {}, { base: 'https://evil.example.com' }),
    (e) => e.code === 'FIREBASE_RAIL_HOST_INVALID',
  );
});

test('firebase rail accepts the Firestore host', () => {
  assert.equal(FIRESTORE_HOST, 'https://firestore.googleapis.com');
});
