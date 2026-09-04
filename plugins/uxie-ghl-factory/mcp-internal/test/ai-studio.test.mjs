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

import { StudioApi, filterRoutes, nameWarning } from '../core/ai-studio.mjs';

test('routes drop soft-deleted rows', () => {
  const rows = [{ path: '/', deleted: false }, { path: '/old', deleted: true }];
  assert.deepEqual(filterRoutes(rows).map((r) => r.path), ['/']);
});

test('create warns when the server rewrote the name', () => {
  assert.equal(nameWarning('TEST-CAP-01', 'TEST-CAP-01'), null);
  const w = nameWarning('TEST-CAP-AISTUDIO-01', 'Cap AIStudio');
  assert.match(w, /rewrote/i);
  assert.match(w, /Cap AIStudio/);
});

import { studioError } from '../core/ai-studio.mjs';

test('wire errors become remediations, not raw passthrough', () => {
  assert.match(studioError(401, { error: 'authorization token required' }), /Bearer/);
  assert.match(studioError(403, { error: 'unsupported alt_type' }), /only .?location/i);
  assert.match(studioError(403, { error: 'No Location Found' }), /binding|reach/i);
  assert.match(studioError(409, { error: 'continuation answer conflicts with the existing answer' }), /already answered/i);
  assert.match(studioError(410, {}), /expired/i);
  assert.equal(studioError(200, {}), null, 'a success maps to nothing');
  assert.equal(studioError(500, { error: 'boom' }), null, 'an unrecognised error is passed through untouched');
});

test('StudioApi.getProject builds the right request', async () => {
  let capturedCall = null;
  const gw = {
    call: async (method, path, body) => {
      capturedCall = { method, path, body };
      return { status: 200, ok: true, json: { id: 'proj1' } };
    },
  };
  const api = new StudioApi({ gw, loc: 'test-location' });
  await api.getProject('proj1');
  assert.equal(capturedCall.method, 'GET');
  assert.equal(capturedCall.path, '/vibe-ai/projects/proj1?alt_id=test-location&alt_type=location');
  assert.equal(capturedCall.body, undefined);
});

test('StudioApi.getProject URL-encodes alt_id when location has special characters', async () => {
  let capturedCall = null;
  const gw = {
    call: async (method, path, body) => {
      capturedCall = { method, path, body };
      return { status: 200, ok: true, json: { id: 'proj1' } };
    },
  };
  const api = new StudioApi({ gw, loc: 'loc with&special' });
  await api.getProject('proj1');
  assert.equal(capturedCall.method, 'GET');
  // The space must become %20 and & must become %26, proving encodeURIComponent is called
  assert.match(capturedCall.path, /alt_id=loc%20with%26special/);
  assert.equal(capturedCall.body, undefined);
});

test('StudioApi.putSecrets sends secrets and alt_id/alt_type in body', async () => {
  let capturedCall = null;
  const gw = {
    call: async (method, path, body) => {
      capturedCall = { method, path, body };
      return { status: 200, ok: true, json: {} };
    },
  };
  const api = new StudioApi({ gw, loc: 'loc123' });
  await api.putSecrets('proj1', { key1: 'val1' });
  assert.equal(capturedCall.method, 'PUT');
  assert.equal(capturedCall.path, '/vibe-ai/projects/proj1/secrets');
  assert.deepEqual(capturedCall.body, { secrets: { key1: 'val1' }, alt_id: 'loc123', alt_type: 'location' });
});

test('StudioApi.unpublish sends no body', async () => {
  let capturedCall = null;
  const gw = {
    call: async (method, path, body) => {
      capturedCall = { method, path, body };
      return { status: 200, ok: true, json: {} };
    },
  };
  const api = new StudioApi({ gw, loc: 'loc123' });
  await api.unpublish('proj1');
  assert.equal(capturedCall.method, 'POST');
  assert.equal(capturedCall.path, '/vibe-ai/projects/proj1/unpublish');
  assert.equal(capturedCall.body, undefined);
});

test('StudioApi.publish sends only version_id', async () => {
  let capturedCall = null;
  const gw = {
    call: async (method, path, body) => {
      capturedCall = { method, path, body };
      return { status: 200, ok: true, json: {} };
    },
  };
  const api = new StudioApi({ gw, loc: 'loc123' });
  await api.publish('proj1', 'v123');
  assert.equal(capturedCall.method, 'POST');
  assert.equal(capturedCall.path, '/vibe-ai/projects/proj1/publish');
  assert.deepEqual(capturedCall.body, { version_id: 'v123' });
});

test('StudioApi.usageSnapshotUsd uses /ai-wrapper base with camelCase locationId', async () => {
  let capturedCall = null;
  const gw = {
    call: async (method, path) => {
      capturedCall = { method, path };
      return {
        status: 200,
        ok: true,
        json: { snapshots: [{ product: 'AI_STUDIO', used: 42.5 }] },
      };
    },
  };
  const api = new StudioApi({ gw, loc: 'test-loc-id' });
  const usd = await api.usageSnapshotUsd();
  assert.equal(usd, 42.5);
  assert.equal(capturedCall.method, 'GET');
  assert.equal(capturedCall.path, '/ai-wrapper/usage/v2/snapshots?locationId=test-loc-id');
});

test('StudioApi.usageSnapshotUsd URL-encodes locationId', async () => {
  let capturedCall = null;
  const gw = {
    call: async (method, path) => {
      capturedCall = { method, path };
      return { status: 200, ok: true, json: { snapshots: [] } };
    },
  };
  const api = new StudioApi({ gw, loc: 'loc with spaces' });
  await api.usageSnapshotUsd();
  assert.match(capturedCall.path, /locationId=loc%20with%20spaces/);
});

test('StudioApi.usageSnapshotUsd returns null when no AI_STUDIO snapshot', async () => {
  const gw = {
    call: async () => ({
      status: 200,
      ok: true,
      json: { snapshots: [{ product: 'OTHER' }] },
    }),
  };
  const api = new StudioApi({ gw, loc: 'loc123' });
  const usd = await api.usageSnapshotUsd();
  assert.equal(usd, null);
});

test('StudioApi.usageSnapshotUsd returns null when snapshots missing', async () => {
  const gw = {
    call: async () => ({
      status: 200,
      ok: true,
      json: {},
    }),
  };
  const api = new StudioApi({ gw, loc: 'loc123' });
  const usd = await api.usageSnapshotUsd();
  assert.equal(usd, null);
});

test('StudioApi throws on recognized error status with mapped message', async () => {
  const gw = {
    call: async () => ({
      status: 401,
      ok: false,
      json: { error: 'authorization token required' },
    }),
  };
  const api = new StudioApi({ gw, loc: 'loc123' });
  await assert.rejects(
    () => api.getProject('proj1'),
    (e) => e.code === 'STUDIO_REQUEST_FAILED' && /Bearer/.test(e.message),
  );
});

test('StudioApi returns response on unrecognized error status', async () => {
  const gw = {
    call: async () => ({
      status: 500,
      ok: false,
      json: { error: 'unknown error' },
    }),
  };
  const api = new StudioApi({ gw, loc: 'loc123' });
  const res = await api.getProject('proj1');
  assert.equal(res.status, 500);
  assert.equal(res.ok, false);
});

import { sessionFor, isTerminal, awaitTurn } from '../core/ai-studio.mjs';

test('session ids are owned by the server and stable per project', () => {
  const state = {};
  const a = sessionFor(state, 'P1');
  assert.equal(sessionFor(state, 'P1'), a, 'same project reuses its session');
  assert.notEqual(sessionFor(state, 'P2'), a, 'a different project gets its own');
  assert.match(a, /^[0-9a-f-]{36}$/);
});

// The bug this prevents: thinkingStatus reaches "completed" long before the build finishes.
test('thinkingStatus completed is NOT terminal while the build is validating', () => {
  assert.equal(isTerminal({ thinkingStatus: 'completed', buildStatus: 'validating' }), false);
  assert.equal(isTerminal({ thinkingStatus: 'completed', buildStatus: 'ready' }), true);
  assert.equal(isTerminal({ thinkingStatus: 'completed', buildStatus: 'failed' }), true);
  assert.equal(isTerminal({ thinkingStatus: 'completed' }), false, 'no buildStatus is not terminal');
  assert.equal(isTerminal(undefined), false);
});

test('awaitTurn returns a resumable handle when the wait ceiling is hit', async () => {
  const firestore = { messages: async () => [{ role: 'assistant', id: 'm1', buildStatus: 'validating' }] };
  const out = await awaitTurn({ firestore, projectId: 'P1', waitMs: 20, pollMs: 5,
    nowMs: (() => { let t = 0; return () => (t += 10); })(), sleep: async () => {} });
  assert.equal(out.pending, true);
  assert.equal(out.messageId, 'm1');
  assert.equal(out.resumeWith, 'get_studio_generation_status');
});
