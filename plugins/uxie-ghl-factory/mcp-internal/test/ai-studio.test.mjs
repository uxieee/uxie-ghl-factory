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

import { plain } from '../core/ai-studio.mjs';

test('plain() decodes Firestore typed values', () => {
  assert.equal(plain({ stringValue: 'a' }), 'a');
  assert.equal(plain({ integerValue: '3' }), 3);
  assert.equal(plain({ booleanValue: true }), true);
  assert.equal(plain({ nullValue: null }), null);
  assert.deepEqual(plain({ arrayValue: { values: [{ stringValue: 'x' }] } }), ['x']);
  assert.deepEqual(plain({ mapValue: { fields: { k: { stringValue: 'v' } } } }), { k: 'v' });
  assert.deepEqual(plain({ arrayValue: {} }), []);           // absent `values` is an empty array
});

import { getIdToken } from '../core/ai-studio.mjs';

test('getIdToken exchanges the custom token and caches per location', async () => {
  let refreshCalls = 0, exchangeCalls = 0;
  const gwJwt = { call: async () => (refreshCalls++, { status: 200, ok: true, json: { token: 'CUSTOM' } }) };
  const fetchImpl = async () => (exchangeCalls++, { ok: true, json: async () => ({ idToken: 'ID', expiresIn: '3600' }) });
  const cache = new Map();
  const a = await getIdToken({ gwJwt, locationId: 'L1', cache, fetchImpl });
  const b = await getIdToken({ gwJwt, locationId: 'L1', cache, fetchImpl });
  assert.equal(a, 'ID');
  assert.equal(b, 'ID');
  assert.equal(refreshCalls, 1, 'second call must come from cache');
  assert.equal(exchangeCalls, 1);
});

test('getIdToken never leaks the token in a thrown error', async () => {
  const gwJwt = { call: async () => ({ status: 200, ok: true, json: { token: 'SUPERSECRET' } }) };
  const fetchImpl = async () => ({ ok: false, json: async () => ({ error: { message: 'nope' } }) });
  await assert.rejects(
    () => getIdToken({ gwJwt, locationId: 'L1', cache: new Map(), fetchImpl }),
    (e) => !String(e.message).includes('SUPERSECRET'),
  );
});

import { runQuery } from '../core/ai-studio.mjs';

test('runQuery filters on projectId, orders, and decodes rows', async () => {
  let sent = null;
  const gwFirebase = { call: async (m, p, body) => { sent = { m, p, body }; return { status: 200, ok: true, json: [
    { document: { fields: { id: { stringValue: 'm1' }, order: { integerValue: '1' } } } },
    { readTime: '…' },                                   // a result row with no document
  ] }; } };
  const rows = await runQuery({ gwFirebase, idToken: 'ID', collection: 'vibe-messages', projectId: 'P1', orderBy: 'order', limit: 5 });
  assert.deepEqual(rows, [{ id: 'm1', order: 1 }]);
  assert.equal(sent.m, 'POST');
  assert.match(sent.p, /vibe-platform\/documents:runQuery$/);
  const q = sent.body.structuredQuery;
  assert.deepEqual(q.from, [{ collectionId: 'vibe-messages' }]);
  assert.deepEqual(q.where.fieldFilter, { field: { fieldPath: 'projectId' }, op: 'EQUAL', value: { stringValue: 'P1' } });
  assert.deepEqual(q.orderBy, [{ field: { fieldPath: 'order' }, direction: 'ASCENDING' }]);
  assert.equal(q.limit, 5);
});

test('firebase rail attaches idToken authorization header on valid host', async () => {
  let capturedHeaders = null;
  const fetchImpl = async (url, options) => {
    capturedHeaders = options.headers;
    return { status: 200, ok: true, text: async () => '[]' };
  };
  const gw = makeGateway({ tokenFile: TOK, loc: 'LOCATION_ID', rail: 'firebase', fetchImpl, throttleMs: 0, jitterMs: 0 });
  await gw.call('POST', '/v1/x', {}, { headers: { authorization: 'Bearer TESTID' } });
  assert.equal(capturedHeaders.authorization, 'Bearer TESTID');
});
