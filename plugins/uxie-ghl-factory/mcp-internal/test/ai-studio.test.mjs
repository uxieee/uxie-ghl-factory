import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGateway, FIRESTORE_HOST } from '../core/gateway.mjs';

const HERE_DIR = dirname(fileURLToPath(import.meta.url));
const TOK = join(HERE_DIR, 'fixtures', 'tok.txt');

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

// M1 (Minor): `h.authorization = overrides.authorization` used to run with no guard — a
// firebase-rail call whose `options.headers` was `null` (not merely omitted; the default
// parameter only fires on `undefined`) threw an opaque TypeError instead of a coded, remediable
// error. Guarded and coded instead of silently 500-ing.
test('a firebase-rail call with no idToken header fails with a coded error, not an opaque TypeError', async () => {
  const gw = makeGateway({ tokenFile: TOK, loc: 'LOCATION_ID', rail: 'firebase', throttleMs: 0, jitterMs: 0 });
  await assert.rejects(
    () => gw.call('POST', '/v1/x', {}, { headers: null }),
    (e) => e.code === 'TOKEN_MISSING' && /idToken/i.test(e.message),
  );
  await assert.rejects(
    () => gw.call('POST', '/v1/x', {}),
    (e) => e.code === 'TOKEN_MISSING',
    'omitting options entirely must fail the same coded way',
  );
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

// C2 (Critical): `Array.isArray(res.json) ? res.json : []` used to be the ONLY check. Firestore's
// 401/403 body is an OBJECT, not an array, so a dead credential silently became `rows: []` and a
// site with a full history read as having none. res.ok must be checked FIRST — a non-ok response
// must never be read as an empty collection.
test('runQuery throws (never returns []) on a 401 from Firestore', async () => {
  const gwFirebase = { call: async () => ({ status: 401, ok: false, json: { error: { message: 'invalid idToken' } } }) };
  await assert.rejects(
    () => runQuery({ gwFirebase, idToken: 'DEAD', collection: 'vibe-messages', projectId: 'P1' }),
    (e) => e.code === 'FIRESTORE_AUTH_REJECTED',
  );
});

test('runQuery throws on a non-auth non-ok status too — never silently empty', async () => {
  const gwFirebase = { call: async () => ({ status: 500, ok: false, json: { error: 'boom' } }) };
  await assert.rejects(
    () => runQuery({ gwFirebase, idToken: 'ID', collection: 'vibe-messages', projectId: 'P1' }),
    (e) => e.code === 'FIRESTORE_QUERY_FAILED',
  );
});

import { queryProjectHistory } from '../core/ai-studio.mjs';

test('queryProjectHistory drops the cached idToken and retries ONCE on a 401, then succeeds', async () => {
  const cache = new Map();
  cache.set('LOC', { idToken: 'STALE', expiresAt: Date.now() + 3_600_000 });
  let mintCalls = 0;
  const gwJwt = { call: async () => (mintCalls += 1, { status: 200, ok: true, json: { token: `CUSTOM-${mintCalls}` } }) };
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ idToken: `FRESH-${body.token}`, expiresIn: '3600' }) };
  };
  let calls = 0;
  const gwFirebase = {
    call: async (m, p, body, opts) => {
      calls += 1;
      if (opts.headers.authorization === 'Bearer STALE') {
        return { status: 401, ok: false, json: { error: { message: 'invalid idToken' } } };
      }
      return { status: 200, ok: true, json: [{ document: { fields: { id: { stringValue: 'm1' } } } }] };
    },
  };
  const rows = await queryProjectHistory({ gwJwt, gwFirebase, locationId: 'LOC', cache,
    collection: 'vibe-messages', projectId: 'P1', fetchImpl });
  assert.deepEqual(rows, [{ id: 'm1' }]);
  assert.equal(calls, 2, 'must retry exactly once after the 401');
  assert.notEqual(cache.get('LOC').idToken, 'STALE', 'the stale cached token must have been replaced');
});

test('queryProjectHistory surfaces CODES.AUTH_REJECTED when even a FRESH token is rejected', async () => {
  const gwJwt = { call: async () => ({ status: 200, ok: true, json: { token: 'CUSTOM' } }) };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ idToken: 'STILL-DEAD', expiresIn: '3600' }) });
  const gwFirebase = { call: async () => ({ status: 401, ok: false, json: { error: { message: 'invalid idToken' } } }) };
  await assert.rejects(
    () => queryProjectHistory({ gwJwt, gwFirebase, locationId: 'LOC', cache: new Map(),
      collection: 'vibe-messages', projectId: 'P1', fetchImpl }),
    (e) => e.code === 'AUTH_REJECTED',
  );
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
  const out = await awaitTurn({ firestore, projectId: 'P1', messageId: 'm1', waitMs: 20, pollMs: 5,
    nowMs: (() => { let t = 0; return () => (t += 10); })(), sleep: async () => {} });
  assert.equal(out.pending, true);
  assert.equal(out.messageId, 'm1');
  assert.equal(out.resumeWith, 'get_studio_generation_status');
});

// FIX 3 — the row matching messageId is present the whole time but never goes terminal
// (buildStatus stays "validating"). The pending payload must carry ITS observed buildStatus, not
// null: this is the hook by which a live-fire pass discovers the real "failed" string, since
// "failed" has never once been observed live (see rule 1 above). Losing this silently would erase
// that negative-knowledge trail.
test('awaitTurn reports the matching-but-non-terminal row\'s buildStatus in the pending payload', async () => {
  const firestore = { messages: async () => [{ role: 'assistant', id: 'm1', buildStatus: 'validating' }] };
  const out = await awaitTurn({ firestore, projectId: 'P1', messageId: 'm1', waitMs: 20, pollMs: 5,
    nowMs: (() => { let t = 0; return () => (t += 10); })(), sleep: async () => {} });
  assert.equal(out.pending, true);
  assert.equal(out.buildStatus, 'validating',
    'the pending payload must report the matching row\'s observed buildStatus, not hardcode null');
});

// C1 (Critical): `awaitTurn` used to take `rows.filter(role==='assistant').pop()` with NO
// correlation to the turn just started. On any project with prior history the previous
// assistant row is already terminal, so the FIRST poll — microseconds after the 202, before
// Firestore has written the new row — returned the PREVIOUS turn's versionId/summary/diffs as
// THIS generation's result. This proves the fix: a prior terminal row for a DIFFERENT message id
// must never resolve the call; it must keep polling and only resolve once the row whose
// `id === messageId` itself goes terminal.
test('awaitTurn does not resolve on a stale terminal row from a PREVIOUS turn — only on messageId', async () => {
  // Poll 1: only the stale, already-terminal previous turn exists. Poll 2: the NEW turn's row
  // (the one awaitTurn was actually asked to wait for) shows up, also terminal.
  let call = 0;
  const firestore = {
    messages: async () => {
      call += 1;
      if (call === 1) {
        return [{ role: 'assistant', id: 'PREV-TURN', buildStatus: 'ready', versionId: 'V-OLD' }];
      }
      return [
        { role: 'assistant', id: 'PREV-TURN', buildStatus: 'ready', versionId: 'V-OLD' },
        { role: 'assistant', id: 'THIS-TURN', buildStatus: 'ready', versionId: 'V-NEW' },
      ];
    },
  };
  const out = await awaitTurn({ firestore, projectId: 'P1', messageId: 'THIS-TURN',
    waitMs: 1000, pollMs: 1, nowMs: Date.now, sleep: async () => {} });
  assert.equal(call, 2, 'must poll again rather than resolving on the first (stale) read');
  assert.equal(out.pending, false);
  assert.equal(out.assistant.id, 'THIS-TURN');
  assert.equal(out.assistant.versionId, 'V-NEW', 'must never report the PREVIOUS turn\'s versionId');
});

// Confirm this test would have FAILED against the old (pre-fix) behaviour: pop() of the
// role==='assistant' rows on poll 1 returns PREV-TURN (already terminal), which is exactly the
// wrong-turn bug C1 describes. Documented here rather than re-run against old code, since the
// old implementation no longer exists in this file to import side-by-side.
test('awaitTurn ignores a terminal row that never matches messageId, until the deadline', async () => {
  const firestore = { messages: async () => [{ role: 'assistant', id: 'SOMEONE-ELSES-TURN', buildStatus: 'ready' }] };
  const out = await awaitTurn({ firestore, projectId: 'P1', messageId: 'MY-TURN',
    waitMs: 15, pollMs: 5, nowMs: (() => { let t = 0; return () => (t += 10); })(), sleep: async () => {} });
  assert.equal(out.pending, true, 'a terminal row for a different message id must never resolve this turn');
  assert.equal(out.messageId, 'MY-TURN');
  assert.equal(out.buildStatus, null, 'no row ever matched messageId, so there is no status to report');
});

import { containsSecrets } from '../core/errors.mjs';

test('a secrets map may use conventional secret NAMES', () => {
  assert.equal(containsSecrets({ secrets: { API_KEY: 'x', SESSION_TOKEN: 'y' } }), false);
});

test('the exemption is narrow — it does not spread', () => {
  assert.equal(containsSecrets({ apiKey: 'x' }), true, 'a bare credential arg is still refused');
  assert.equal(containsSecrets({ notSecrets: { API_KEY: 'x' } }), true, 'only a `secrets` map is exempt');
  assert.equal(containsSecrets({ secrets: { A: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x' } }), true,
    'a real credential VALUE inside the map is still caught');
});

test('the exemption is not reachable through an array', () => {
  assert.equal(containsSecrets({ secrets: [{ apiKey: 'x' }] }), true, 'exemption must not apply to array elements');
  assert.equal(containsSecrets({ secrets: [[{ apiKey: 'x' }]] }), true, 'nor to nested array elements');
});

// I1 (Important): the exemption used to fire wherever a child key was literally `secrets`, AT
// ANY DEPTH, on any tool — so a raw_request body carrying `{ secrets: { cookie: '…' } } }` passed
// a guard that refuses the structurally identical `{ config: { cookie: '…' } } }`. The exemption
// exists ONLY for set_studio_secrets's own top-level `secrets` ARGUMENT (depth 0 of the tool's
// argument object), so a `secrets` key found anywhere deeper — including one level down, as here
// — must now be caught like any other object. This test used to assert `false`; that was the bug.
test('a `secrets` key nested inside another argument is NOT exempt — only the top-level argument is', () => {
  assert.equal(containsSecrets({ list: [{ secrets: { apiKey: 'x' } }] }), true,
    'a `secrets` map one level below the top-level args object must be scanned normally');
});

// The exact raw_request-shaped case the finding calls out: before the fix this returned `false`
// (passed the guard) while the structurally identical `config` version correctly returned `true`
// — an inconsistency that let a `secrets`-named key anywhere in a body smuggle a credential past
// the guard it exists to enforce.
test('the exemption does not widen a raw_request body just because a key is named `secrets`', () => {
  assert.equal(containsSecrets({ body: { secrets: { cookie: 'abcdefghijklmnop' } } }), true);
  assert.equal(containsSecrets({ body: { config: { cookie: 'abcdefghijklmnop' } } }), true,
    'unchanged control case — both must refuse identically');
});

test('nested secrets maps are still caught', () => {
  assert.equal(containsSecrets({ secrets: { secrets: { apiKey: 'x' } } }), true);
});

import { classifySite } from '../core/ai-studio.mjs';

test('the resolver reports which surface owns a host', () => {
  const studio = [{ id: 'S1', name: 'Lyceum', slug: 'mindful-lyceum',
                    custom_domains: ['example.com', 'www.example.com'], primary_custom_domain: 'example.com' }];
  const funnels = [{ _id: 'F1', name: 'Optin', url: '/optin' }];
  assert.deepEqual(classifySite('example.com', studio, funnels),
    { surface: 'ai-studio', id: 'S1', name: 'Lyceum', matchedOn: 'custom_domain' });
  assert.equal(classifySite('www.example.com', studio, funnels).surface, 'ai-studio', 'www is matched');
  assert.equal(classifySite('mindful-lyceum', studio, funnels).matchedOn, 'slug');
  assert.equal(classifySite('Optin', studio, funnels).surface, 'funnel');
  assert.equal(classifySite('nothing-here.com', studio, funnels).surface, 'not-found');
});

import { TOOLS } from '../core/tools.mjs';

const findGhlSiteTool = () => TOOLS.find((t) => t.name === 'find_ghl_site');

// find_ghl_site queries two disjoint collections on TWO DIFFERENT credential rails
// (AI Studio on jwt/Bearer, funnels on token-id — /funnels refuses Bearer). If the
// token-id call fails, a `?? []` fallback would silently read as "the site does not
// exist" — the exact failure mode this tool exists to prevent. Prove it does not.
test('a failed funnels/token-id call is reported, never silently read as not-found', async () => {
  let sawFunnelsCall = false;
  const gwByRail = { jwt: { call: async () => ({ status: 200, ok: true, json: [] }) } };
  const deps = {
    state: {},
    makeGw: (opts) => {
      if (opts.rail === 'token-id') {
        sawFunnelsCall = true;
        return { call: async () => ({ status: 500, ok: false, json: { error: 'boom' } }) };
      }
      return gwByRail.jwt;
    },
  };
  const result = await findGhlSiteTool().handler({ locationId: 'LOC', site: 'anything.com' }, deps);
  assert.equal(sawFunnelsCall, true, 'the funnels rail must actually be tried');
  assert.equal(result.ok, true);
  assert.notEqual(result.data.surface, 'not-found', 'a rail failure must never be reported as "does not exist"');
  assert.equal(result.data.funnelsChecked, false);
  assert.match(result.data.warning, /funnels|token-id/i);
});

test('a successful funnels call reports funnelsChecked:true', async () => {
  const deps = {
    state: {},
    makeGw: (opts) => (opts.rail === 'token-id'
      ? { call: async () => ({ status: 200, ok: true, json: { funnels: [] } }) }
      : { call: async () => ({ status: 200, ok: true, json: [] }) }),
  };
  const result = await findGhlSiteTool().handler({ locationId: 'LOC', site: 'nothing-here.com' }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.funnelsChecked, true);
  assert.equal(result.data.surface, 'not-found');
});

// FIX 1: `type=funnel` silently excludes every `type=website` record — the exact class of
// object someone is most likely to ask this resolver about — reintroducing the false
// "does not exist" through a different door. knowledge/sniffs/ai-studio-2026-09-04/sweep-19.mjs
// is the probe the disjointness finding rests on, and it calls this endpoint with NO `type`.
test('the funnels call is untyped — no type or category filter narrows the collection', async () => {
  let funnelsPath = null;
  const deps = {
    state: {},
    makeGw: (opts) => (opts.rail === 'token-id'
      ? { call: async (method, path) => { funnelsPath = path; return { status: 200, ok: true, json: { funnels: [] } }; } }
      : { call: async () => ({ status: 200, ok: true, json: [] }) }),
  };
  await findGhlSiteTool().handler({ locationId: 'LOC', site: 'a-website.com' }, deps);
  assert.ok(funnelsPath, 'the funnels rail must be called');
  assert.doesNotMatch(funnelsPath, /[?&]type=/, 'no type filter — it would exclude type=website records');
  assert.doesNotMatch(funnelsPath, /[?&]category=/, 'no category filter either');
  assert.match(funnelsPath, /[?&]locationId=LOC/);
});

const getStudioPreviewTool = () => TOOLS.find((t) => t.name === 'get_studio_preview');

// FIX 3: after ensureSandbox provisions, the tool must return the FRESH sandbox state, not the
// pre-provision snapshot it already had in hand. Not-ready on the first read, ready on the
// second (post-provision) read.
test('get_studio_preview re-reads the sandbox after provisioning and returns fresh values', async () => {
  let getSandboxCalls = 0;
  let ensureCalled = false;
  const gw = {
    call: async (method, path) => {
      if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) return { status: 200, ok: true, json: { id: 'P1', alt_id: 'LOC' } };
      if (method === 'POST' && path.includes('/sandbox')) { ensureCalled = true; return { status: 200, ok: true, json: { queued: true } }; }
      if (method === 'GET' && path.includes('/sandbox')) {
        getSandboxCalls += 1;
        return getSandboxCalls === 1
          ? { status: 200, ok: true, json: { ready: false, url: null } }
          : { status: 200, ok: true, json: { ready: true, url: 'https://fresh.vibepreview.com' } };
      }
      return { status: 404, ok: false, json: {} };
    },
  };
  const result = await getStudioPreviewTool().handler({ locationId: 'LOC', projectId: 'P1' }, { state: {}, makeGw: () => gw });
  assert.equal(ensureCalled, true, 'ensureSandbox must be called when not ready');
  assert.equal(getSandboxCalls, 2, 'the sandbox must be re-read after provisioning');
  assert.equal(result.ok, true);
  assert.equal(result.data.ready, true, 'the returned ready must be the POST-provision value');
  assert.equal(result.data.url, 'https://fresh.vibepreview.com', 'the returned url must be the POST-provision value');
  assert.equal(result.data.provisioning, true);
});

test('get_studio_preview reports honestly when the re-read is still not ready', async () => {
  const gw = {
    call: async (method, path) => {
      if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) return { status: 200, ok: true, json: { id: 'P1', alt_id: 'LOC' } };
      if (method === 'POST' && path.includes('/sandbox')) return { status: 200, ok: true, json: { queued: true } };
      if (method === 'GET' && path.includes('/sandbox')) return { status: 200, ok: true, json: { ready: false, url: null } };
      return { status: 404, ok: false, json: {} };
    },
  };
  const result = await getStudioPreviewTool().handler({ locationId: 'LOC', projectId: 'P1' }, { state: {}, makeGw: () => gw });
  assert.equal(result.data.ready, false);
  assert.equal(result.data.provisioning, true);
  assert.match(result.data.note, /still shows not-ready|poll again/i);
});

test('get_studio_preview does not re-read when already ready', async () => {
  let getSandboxCalls = 0;
  const gw = {
    call: async (method, path) => {
      if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) return { status: 200, ok: true, json: { id: 'P1', alt_id: 'LOC' } };
      if (method === 'GET' && path.includes('/sandbox')) { getSandboxCalls += 1; return { status: 200, ok: true, json: { ready: true, url: 'https://x.vibepreview.com' } }; }
      return { status: 404, ok: false, json: {} };
    },
  };
  const result = await getStudioPreviewTool().handler({ locationId: 'LOC', projectId: 'P1' }, { state: {}, makeGw: () => gw });
  assert.equal(getSandboxCalls, 1, 'no re-read needed when already ready');
  assert.equal(result.data.provisioning, false);
  assert.equal(result.data.ready, true);
});

// -----------------------------------------------------------------------------------------------
// Task 7 — build tools
// -----------------------------------------------------------------------------------------------

import { answerBodyFor } from '../core/ai-studio.mjs';

test('answer dispatch is chosen by the stored question, not by the caller', () => {
  const base = { sessionId: 'S', questionMessageId: 'Q', loc: 'L' };
  const integration = answerBodyFor({ ...base,
    question: { kind: 'integration_input', integrationPrompt: { items: [{ id: 'CAL1' }] } },
    answer: 'CAL1' });
  assert.equal(integration.answer_type, 'integration_input');
  assert.equal(integration.integration_action, 'connect');
  assert.equal(integration.integration_item_id, 'CAL1');

  const dismissed = answerBodyFor({ ...base,
    question: { kind: 'integration_input', integrationPrompt: { items: [{ id: 'CAL1' }] } },
    answer: 'dismiss' });
  assert.equal(dismissed.integration_action, 'dismiss');
  assert.equal('integration_item_id' in dismissed, false, 'dismiss carries no item id');

  const plainAnswer = answerBodyFor({ ...base, question: { questions: [{ type: 'text' }] }, answer: 'hello' });
  assert.equal(plainAnswer.answer_type, undefined, 'a plain answer sends no answer_type');
  assert.equal(plainAnswer.message, 'hello');
  assert.equal(plainAnswer.is_answer, true);
});

// -----------------------------------------------------------------------------------------------
// Task 7 review fix — handler-level coverage. The brief specified one test (answerBodyFor above);
// the review ruled that a floor, not a ceiling, for six tools with real spend, real credential
// wiring, and a runtime-only trap the harness cannot catch by construction.
// -----------------------------------------------------------------------------------------------

// Review fix #1 (Important): the usage-policy refusal is the ONLY spend control in the whole
// design — spend is deliberately reported, never capped (see the LANDMINE-2 comment in
// core/tools.mjs). If this branch silently broke, nothing else would stop a runaway generation.
// The mock THROWS on /chat and /ai-wrapper/usage so a regression that keeps going past the
// refusal fails LOUDLY here rather than passing by accident.
test('generate_studio_site refuses when the usage policy says no, and never reaches chat', async () => {
  const generateTool = TOOLS.find((t) => t.name === 'generate_studio_site');
  let chatCalled = false;
  const gw = {
    call: async (method, path) => {
      // C3: assertProjectLocation's alt_id check runs BEFORE the usage-policy read.
      if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) {
        return { status: 200, ok: true, json: { id: 'P1', alt_id: 'LOC' } };
      }
      if (path.includes('/usage/policy')) {
        return { status: 200, ok: true, json: { allowed: false, reasonCode: 'PLAN_LIMIT_REACHED' } };
      }
      if (path.includes('/chat')) { chatCalled = true; throw new Error('chat must never be called after a refused policy'); }
      if (path.includes('/ai-wrapper/usage')) throw new Error('usage snapshot must never be read after a refused policy');
      throw new Error(`unexpected call: ${method} ${path}`);
    },
  };
  const fb = { call: async () => { throw new Error('firestore must never be read after a refused policy'); } };
  const deps = { state: {}, makeGw: (opts) => (opts.rail === 'firebase' ? fb : gw) };
  const result = await generateTool.handler({ locationId: 'LOC', projectId: 'P1', prompt: 'build me a site' }, deps);
  assert.equal(result.ok, false);
  assert.match(result.detail, /PLAN_LIMIT_REACHED/, 'the reasonCode must reach the caller');
  assert.equal(chatCalled, false, 'the chat call must never be reached once the policy refuses');
});

// Review fix #2 (Important): set_studio_secrets only works because Task 5 added a narrow
// exemption letting conventional secret NAMES through the credential guard inside a `secrets`
// map (core/errors.mjs). That exemption is unit-tested in isolation already; this proves it is
// actually WIRED to this tool, end to end through guard() — a regression here would be the
// exemption being narrowed later with nobody noticing this tool depends on it.
test('set_studio_secrets passes the credential guard via the secrets-map exemption and reaches the handler', async () => {
  const tool = TOOLS.find((t) => t.name === 'set_studio_secrets');
  let putBody = null;
  const gw = {
    call: async (method, path, body) => {
      if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) {
        return { status: 200, ok: true, json: { id: 'P1', alt_id: 'LOC' } };
      }
      if (method === 'PUT' && path.includes('/secrets')) { putBody = body; return { status: 200, ok: true, json: {} }; }
      if (method === 'GET' && path.includes('/secrets')) {
        return { status: 200, ok: true, json: { secrets: [{ name: 'API_KEY', created_at: '2026-09-04T00:00:00Z' }] } };
      }
      throw new Error(`unexpected call: ${method} ${path}`);
    },
  };
  const deps = { state: {}, makeGw: () => gw };
  const result = await tool.handler(
    { locationId: 'LOC', projectId: 'P1', secrets: { API_KEY: 'sk-live-secret-value' } }, deps);
  assert.equal(result.ok, true, 'a conventional secret NAME must not be refused by the credential guard (Task 5 exemption)');
  assert.ok(putBody, 'the write must have reached the upstream call');
  assert.deepEqual(result.data.names, ['API_KEY']);
  assert.deepEqual(result.data.missing, []);
  assert.ok(!JSON.stringify(result.data).includes('sk-live-secret-value'),
    'the read-back must never surface the secret VALUE, only its name');
});

// Review fix #3 (Important): `session_id`/`sessionId` normalise to `sessionid`, on the credential
// denylist in core/errors.mjs — a tool declaring either would be refused by guard() at RUNTIME,
// a failure invisible to every handler-level test in this file because they call handlers
// directly and never route through guard()'s containsSecrets check on a REAL argument key. This
// walks every declared argument key of the six Task 7 build tools and proves none would be
// refused, so a future PR that adds a `sessionId` parameter to one of them fails here instead of
// failing silently the first time an agent calls the tool for real.
test('none of the six build tools declares an argument key the credential guard would refuse', () => {
  const BUILD_TOOLS = ['create_studio_site', 'generate_studio_site', 'get_studio_generation_status',
    'answer_studio_question', 'cancel_studio_generation', 'set_studio_secrets'];
  for (const name of BUILD_TOOLS) {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} must be registered`);
    for (const key of Object.keys(tool.inputSchema.shape)) {
      assert.equal(containsSecrets({ [key]: 'x' }), false,
        `${name}'s "${key}" argument would be refused by the credential guard at runtime`);
    }
  }
});

// Review fix #4 (Minor): the untested fallback on the pending path is `turn.messageId ?? messageId`
// — when awaitTurn times out having never seen an assistant row (turn.messageId is null), the
// tool must still hand back the id chat() minted when the turn STARTED, never null. waitSeconds:0
// makes awaitTurn's deadline already-elapsed on its first check, so it returns pending with no
// firestore read at all — the fb mock throws if that assumption ever breaks.
test('generate_studio_site returns the chat-started message id when the turn times out with no assistant row', async () => {
  const tool = TOOLS.find((t) => t.name === 'generate_studio_site');
  const gw = {
    call: async (method, path) => {
      if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) {
        return { status: 200, ok: true, json: { id: 'P1', alt_id: 'LOC' } };
      }
      if (path.includes('/usage/policy')) return { status: 200, ok: true, json: { allowed: true } };
      if (path.includes('/ai-wrapper/usage')) return { status: 200, ok: true, json: { snapshots: [] } };
      if (method === 'POST' && path.includes('/chat')) return { status: 200, ok: true, json: { message_id: 'M-STARTED' } };
      throw new Error(`unexpected call: ${method} ${path}`);
    },
  };
  const fb = { call: async () => { throw new Error('firestore must never be read when waitSeconds:0 elapses before the first poll'); } };
  const deps = { state: {}, makeGw: (opts) => (opts.rail === 'firebase' ? fb : gw) };
  const result = await tool.handler(
    { locationId: 'LOC', projectId: 'P1', prompt: 'build me a site', waitSeconds: 0 }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.pending, true);
  assert.equal(result.data.messageId, 'M-STARTED',
    'the pending path must fall back to the chat-started message id, never null');
});

// FIX 4 — a chat 202 with no message_id used to fall through into awaitTurn, poll to the full
// ~120s ceiling for nothing (nothing could ever match a null messageId), and return
// `{ pending: true, messageId: null, note: 'nothing was lost' }` — a lie, because
// get_studio_generation_status REQUIRES messageId: z.string() and cannot resume a null handle.
// The fix refuses immediately instead of entering the wait at all.
test('generate_studio_site refuses immediately when the chat receipt carries no message_id, and never polls firestore', async () => {
  const tool = TOOLS.find((t) => t.name === 'generate_studio_site');
  const gw = {
    call: async (method, path) => {
      if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) {
        return { status: 200, ok: true, json: { id: 'P1', alt_id: 'LOC' } };
      }
      if (path.includes('/usage/policy')) return { status: 200, ok: true, json: { allowed: true } };
      if (path.includes('/ai-wrapper/usage')) return { status: 200, ok: true, json: { snapshots: [] } };
      // 202 accepted, but no message_id in the receipt.
      if (method === 'POST' && path.includes('/chat')) return { status: 202, ok: true, json: {} };
      throw new Error(`unexpected call: ${method} ${path}`);
    },
  };
  const fb = { call: async () => { throw new Error('firestore must never be polled when there is no message_id to wait for'); } };
  const deps = { state: {}, makeGw: (opts) => (opts.rail === 'firebase' ? fb : gw) };
  const result = await tool.handler(
    { locationId: 'LOC', projectId: 'P1', prompt: 'build me a site' }, deps);
  assert.equal(result.ok, false, 'must refuse rather than return an unresumable pending handle');
  assert.equal(result.code, CODES.VALIDATION_FAILED);
  assert.match(result.detail, /no message_id/, 'must say the receipt carried no message_id');
  assert.doesNotMatch(JSON.stringify(result), /nothing was lost/,
    'must never claim nothing was lost when the resume handle itself is missing');
});

// ----------------------------------------------------------------------------------------------------
// Task 8 — ship tools (confirmation-gated publish and unpublish)
// ----------------------------------------------------------------------------------------------------

test('publish and unpublish refuse without confirm', async () => {
  const deps = { state: {}, makeGw: () => { throw new Error('no account call may happen'); } };
  for (const name of ['publish_studio_site', 'unpublish_studio_site']) {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} is registered`);
    const res = await tool.handler({ locationId: 'L', projectId: 'P', versionId: 'V' }, deps);
    const text = JSON.stringify(res);
    assert.match(text, /confirm/i, `${name} must refuse and say why`);
  }
});

test('unpublish read-back is the only evidence it happened', async () => {
  const unpublishTool = TOOLS.find((t) => t.name === 'unpublish_studio_site');
  assert.ok(unpublishTool, 'unpublish_studio_site is registered');

  // Case 1: unpublish succeeds and read-back shows published_at null — tool claims success
  const gw1 = {
    call: async (method, path) => {
      if (method === 'POST' && path.includes('/unpublish')) {
        return { status: 200, ok: true, json: { status: 'unpublished' } };
      }
      if (method === 'GET' && path.includes('/projects')) {
        return { status: 200, ok: true, json: { alt_id: 'LOC', published_at: null, published_version_id: null } };
      }
      throw new Error(`unexpected call: ${method} ${path}`);
    },
  };
  const result1 = await unpublishTool.handler(
    { locationId: 'LOC', projectId: 'P1', confirm: true },
    { state: {}, makeGw: () => gw1 }
  );
  assert.equal(result1.ok, true, 'tool must report success when read-back shows published_at null');
  assert.equal(result1.data.appliedVerified, true, 'appliedVerified must be true when published_at is null');

  // Case 2: unpublish write succeeds but read-back still shows a non-null published_at — tool does NOT claim success
  const gw2 = {
    call: async (method, path) => {
      if (method === 'POST' && path.includes('/unpublish')) {
        return { status: 200, ok: true, json: { status: 'still_published' } };
      }
      if (method === 'GET' && path.includes('/projects')) {
        return { status: 200, ok: true, json: { alt_id: 'LOC', published_at: '2026-09-04T00:00:00Z', published_version_id: 'V1' } };
      }
      throw new Error(`unexpected call: ${method} ${path}`);
    },
  };
  const result2 = await unpublishTool.handler(
    { locationId: 'LOC', projectId: 'P1', confirm: true },
    { state: {}, makeGw: () => gw2 }
  );
  assert.equal(result2.ok, true, 'tool returns ok structure');
  assert.equal(result2.data.appliedVerified, false, 'appliedVerified must be false when published_at is still non-null — read-back overrides the write response');
});

test('publish reports the live URL and verified state from read-back', async () => {
  const publishTool = TOOLS.find((t) => t.name === 'publish_studio_site');
  assert.ok(publishTool, 'publish_studio_site is registered');

  const gw = {
    call: async (method, path, body) => {
      if (method === 'POST' && path.includes('/publish')) {
        return { status: 200, ok: true, json: { status: 'published', live_url: 'https://test-site.vibepreview.com' } };
      }
      if (method === 'GET' && path.includes('/projects')) {
        return { status: 200, ok: true, json: { alt_id: 'LOC', published_at: '2026-09-04T00:00:00Z', published_version_id: 'V123' } };
      }
      throw new Error(`unexpected call: ${method} ${path}`);
    },
  };
  const result = await publishTool.handler(
    { locationId: 'LOC', projectId: 'P1', versionId: 'V123', confirm: true },
    { state: {}, makeGw: () => gw }
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.liveUrl, 'https://test-site.vibepreview.com', 'live URL from publish response');
  assert.equal(result.data.publishedAt, '2026-09-04T00:00:00Z', 'published_at from read-back, not publish response');
  assert.equal(result.data.publishedVersionId, 'V123', 'published_version_id from read-back');
  assert.equal(result.data.appliedVerified, true, 'appliedVerified must be true when read-back shows a published_at');
});

// ----------------------------------------------------------------------------------------------------
// C3 (Important) — `alt_id` is not enforced on by-id reads (ai-studio.mjs header, rule 3), so a
// registration bound to location A could read (or write, or SPEND MONEY on) location B's project
// just by naming its id — `locationId` is allowlist-guarded, `projectId` is a free string. Every
// project-scoped AI Studio tool must verify the RETURNED record's alt_id against the bound
// location before doing anything else. One parameterised test over the whole tool list, per the
// review's own preference over twelve near-identical copies.
// ----------------------------------------------------------------------------------------------------

import { CODES } from '../core/errors.mjs';

const PROJECT_SCOPED_STUDIO_TOOLS = [
  { name: 'get_studio_site', extraArgs: {} },
  { name: 'read_studio_site_content', extraArgs: {} },
  { name: 'get_studio_site_history', extraArgs: {} },
  { name: 'get_studio_site_diffs', extraArgs: {} },
  { name: 'get_studio_preview', extraArgs: {} },
  { name: 'generate_studio_site', extraArgs: { prompt: 'build me a site' } },
  { name: 'get_studio_generation_status', extraArgs: { messageId: 'M1' } },
  { name: 'answer_studio_question', extraArgs: { questionMessageId: 'M1', answer: 'hi' } },
  { name: 'cancel_studio_generation', extraArgs: { messageId: 'M1' } },
  { name: 'set_studio_secrets', extraArgs: { secrets: { API_KEY: 'x' } } },
  { name: 'publish_studio_site', extraArgs: { versionId: 'V1', confirm: true } },
  { name: 'unpublish_studio_site', extraArgs: { confirm: true } },
];

test('every project-scoped AI Studio tool refuses when the returned project belongs to a different location', async () => {
  assert.equal(PROJECT_SCOPED_STUDIO_TOOLS.length, 12, 'covering all twelve project-scoped tools, not a subset');
  for (const { name, extraArgs } of PROJECT_SCOPED_STUDIO_TOOLS) {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} must be registered`);
    let otherCallsMade = 0;
    const gw = {
      call: async (method, path) => {
        // The ONLY call any of these tools may make before refusing: the project GET the check
        // itself performs. Anything else means the mismatch check did not run FIRST.
        if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) {
          return { status: 200, ok: true, json: { id: 'P1', alt_id: 'FOREIGN-LOCATION' } };
        }
        otherCallsMade += 1;
        throw new Error(`${name}: unexpected call before the alt_id check refused — ${method} ${path}`);
      },
    };
    const fb = { call: async () => { throw new Error(`${name}: firestore must never be reached — the alt_id check must refuse first`); } };
    const deps = { state: {}, makeGw: (opts) => (opts.rail === 'firebase' ? fb : gw) };
    const result = await tool.handler({ locationId: 'LOC', projectId: 'P1', ...extraArgs }, deps);
    assert.equal(result.ok, false, `${name} must refuse a project bound to a different location`);
    assert.equal(result.code, CODES.VALIDATION_FAILED, `${name} must use the same code as get_studio_site's original check`);
    assert.match(result.detail, /different sub-account/, `${name} must use get_studio_site's wording`);
    assert.equal(otherCallsMade, 0, `${name} must refuse BEFORE reaching any read or write beyond the project GET`);
  }
});

// The parameterised test above proves the REFUSAL path. This proves the check does not fire as a
// false positive when the record legitimately belongs to the bound location — get_studio_site
// already covered this; confirmed here for one representative write tool too, since a false
// positive on a write is the more expensive failure mode. (An absent alt_id is NOT a false-positive
// case any more — see the fail-closed tests below: a missing alt_id now refuses, by design.)
test('the alt_id check does not false-positive when the project genuinely matches', async () => {
  const tool = TOOLS.find((t) => t.name === 'set_studio_secrets');
  let putBody = null;
  const gw = {
    call: async (method, path, body) => {
      if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) {
        return { status: 200, ok: true, json: { id: 'P1', alt_id: 'LOC' } };
      }
      if (method === 'PUT' && path.includes('/secrets')) { putBody = body; return { status: 200, ok: true, json: {} }; }
      if (method === 'GET' && path.includes('/secrets')) {
        return { status: 200, ok: true, json: { secrets: [{ name: 'API_KEY' }] } };
      }
      throw new Error(`unexpected call: ${method} ${path}`);
    },
  };
  const result = await tool.handler({ locationId: 'LOC', projectId: 'P1', secrets: { API_KEY: 'x' } }, { state: {}, makeGw: () => gw });
  assert.equal(result.ok, true);
  assert.ok(putBody, 'the write must have reached the upstream call once alt_id matched');
});

// ----------------------------------------------------------------------------------------------------
// FIX 1 (blocking) — assertProjectLocation FAILS OPEN in three shapes, all executed against the
// real handlers before this fix: (a) 200 with a record carrying NO alt_id at all
// (unpublish_studio_site executed), (b) 500 with an unrecognised body (publish_studio_site
// executed), (c) 404 with a null body (set_studio_secrets' PUT executed). One parameterised test
// over every project-scoped tool, covering all three bypass shapes plus the happy path and the
// genuine-mismatch path — each of the three bypass cases must FAIL (refuse) against the fixed
// code, and must have PASSED (wrongly executed) against the pre-fix code.
// ----------------------------------------------------------------------------------------------------

const FAIL_CLOSED_BYPASS_SHAPES = [
  {
    label: 'boundary GET returns 200 with a record carrying no alt_id at all',
    response: { status: 200, ok: true, json: { id: 'P1' } },
  },
  {
    label: 'boundary GET returns 500 with an unrecognised body',
    response: { status: 500, ok: false, json: { error: 'internal server error' } },
  },
  {
    label: 'boundary GET returns 404 with a null body',
    response: { status: 404, ok: false, json: null },
  },
];

test('every project-scoped AI Studio tool fails CLOSED on all three real bypass shapes (absent alt_id, unrecognised failure status, null body)', async () => {
  for (const { label, response } of FAIL_CLOSED_BYPASS_SHAPES) {
    for (const { name, extraArgs } of PROJECT_SCOPED_STUDIO_TOOLS) {
      const tool = TOOLS.find((t) => t.name === name);
      assert.ok(tool, `${name} must be registered`);
      let otherCallsMade = 0;
      const gw = {
        call: async (method, path) => {
          if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) return response;
          otherCallsMade += 1;
          throw new Error(`${name} / ${label}: unexpected call before the boundary check refused — ${method} ${path}`);
        },
      };
      const fb = { call: async () => { throw new Error(`${name} / ${label}: firestore must never be reached — the boundary check must refuse first`); } };
      const deps = { state: {}, makeGw: (opts) => (opts.rail === 'firebase' ? fb : gw) };
      const result = await tool.handler({ locationId: 'LOC', projectId: 'P1', ...extraArgs }, deps);
      assert.equal(result.ok, false, `${name} must refuse on: ${label}`);
      assert.equal(result.code, CODES.VALIDATION_FAILED, `${name} must use VALIDATION_FAILED on: ${label}`);
      assert.equal(otherCallsMade, 0, `${name} must refuse BEFORE reaching any read or write beyond the project GET, on: ${label}`);
    }
  }
});

// A boundary GET that outright THROWS (StudioApi.#vibe throws on a recognised studioError hint —
// e.g. the Bearer-only rail mistake) must ALSO be treated as "not verified", never as a pass.
test('every project-scoped AI Studio tool fails CLOSED when the boundary GET itself throws', async () => {
  for (const { name, extraArgs } of PROJECT_SCOPED_STUDIO_TOOLS) {
    const tool = TOOLS.find((t) => t.name === name);
    let otherCallsMade = 0;
    const gw = {
      call: async (method, path) => {
        if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) {
          const e = new Error('boundary GET failed'); e.code = 'STUDIO_REQUEST_FAILED'; throw e;
        }
        otherCallsMade += 1;
        throw new Error(`${name}: unexpected call before the boundary check refused`);
      },
    };
    const fb = { call: async () => { throw new Error(`${name}: firestore must never be reached — the boundary check must refuse first`); } };
    const deps = { state: {}, makeGw: (opts) => (opts.rail === 'firebase' ? fb : gw) };
    const result = await tool.handler({ locationId: 'LOC', projectId: 'P1', ...extraArgs }, deps);
    assert.equal(result.ok, false, `${name} must refuse when the boundary GET throws`);
    assert.equal(result.code, CODES.VALIDATION_FAILED, `${name} must use VALIDATION_FAILED when the boundary GET throws`);
    assert.equal(otherCallsMade, 0, `${name} must refuse BEFORE reaching any read or write beyond the project GET`);
  }
});

// The happy path: alt_id present and matching must still pass, for every project-scoped tool —
// not just the one representative case above — so the fail-closed fix does not overshoot into
// refusing legitimate calls.
test('every project-scoped AI Studio tool passes the boundary check when alt_id genuinely matches', async () => {
  for (const { name } of PROJECT_SCOPED_STUDIO_TOOLS) {
    const tool = TOOLS.find((t) => t.name === name);
    const gw = {
      call: async (method, path) => {
        if (method === 'GET' && /\/projects\/P1(\?|$)/.test(path)) {
          return { status: 200, ok: true, json: { id: 'P1', alt_id: 'LOC' } };
        }
        // Every other call after the boundary check passes is allowed through with an inert ok
        // response — this test only proves the check does not refuse a genuine match, not the
        // full behaviour of each tool past that point (already covered elsewhere).
        return { status: 200, ok: true, json: {} };
      },
    };
    const fb = { call: async () => [] };
    const deps = { state: {}, makeGw: (opts) => (opts.rail === 'firebase' ? fb : gw) };
    const result = await tool.handler({ locationId: 'LOC', projectId: 'P1',
      ...(PROJECT_SCOPED_STUDIO_TOOLS.find((t) => t.name === name).extraArgs) }, deps);
    // A downstream failure past the boundary check is fine here (the generic mock does not give
    // every build tool a fully realistic response) — only the boundary check itself must never be
    // what refused. If it had, the detail would carry its own wording.
    if (result.ok === false) {
      assert.doesNotMatch(result.detail ?? '', /different sub-account|could not verify which sub-account/,
        `${name} must not have been refused BY THE BOUNDARY CHECK on a genuinely matching project`);
    }
  }
});

// ----------------------------------------------------------------------------------------------------
// I2 — the fifteen AI Studio tools' fallback strings must agree with the catalogue: `documented`,
// never the earlier `engine source`. Guards against the fallback drifting back out of sync with
// the catalogue label it is supposed to mirror when the catalogue entry is absent or too short.
// ----------------------------------------------------------------------------------------------------

const AI_STUDIO_TOOL_NAMES = [
  'find_ghl_site', 'list_studio_sites', 'get_studio_site', 'read_studio_site_content',
  'get_studio_site_history', 'get_studio_site_diffs', 'get_studio_preview', 'create_studio_site',
  'generate_studio_site', 'get_studio_generation_status', 'answer_studio_question',
  'cancel_studio_generation', 'set_studio_secrets', 'publish_studio_site', 'unpublish_studio_site',
];

test('all fifteen AI Studio tools ship "proof: documented" and none claims live proof', () => {
  assert.equal(AI_STUDIO_TOOL_NAMES.length, 15);
  for (const name of AI_STUDIO_TOOL_NAMES) {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} must be registered`);
    assert.match(tool.description, /proof: documented/,
      `${name}'s description must carry "proof: documented" — labels must not drift upward until a live-fire pass earns it`);
    assert.doesNotMatch(tool.description, /proof: (?:external-receipt-required|engine source)\b/,
      `${name} must not claim a stronger proof status than the catalogue actually earned`);
  }
});

// The test above checks the SHIPPED description, which is dominated by tool-descriptions.json
// (the catalogue) whenever a catalogue entry exists and is at least as long as the hand-written
// fallback — which is true for all 15 tools today, so that test alone would NOT catch a
// regression of the fallback string itself (describe()'s comment: "either way, a missing catalog
// degrades gracefully to each tool's hardcoded fallback string" — the catalogue is not always
// present). This test reads the actual SOURCE TEXT of the `describe(name, fallback)` call sites
// for these 15 tools, so it fails if the fallback string itself regresses even though the catalog
// currently masks it.
test('the AI Studio tools\' describe() FALLBACK strings (not just the catalogue-shipped text) say documented', () => {
  const source = readFileSync(resolve(HERE_DIR, '../core/tools.mjs'), 'utf8');
  for (const name of AI_STUDIO_TOOL_NAMES) {
    // Find the describe('<name>', ...) call site and check ITS fallback string, not the
    // shipped/catalogue-resolved description — the source regex intentionally does not care
    // whether the catalogue is currently masking it.
    const call = new RegExp(`describe\\('${name}'[\\s\\S]{0,1600}?\\)\\)?,`);
    const match = call.exec(source);
    assert.ok(match, `must find the describe() call site for ${name}`);
    assert.doesNotMatch(match[0], /proof: engine source/,
      `${name}'s describe() fallback string must not still read "proof: engine source"`);
  }
});
