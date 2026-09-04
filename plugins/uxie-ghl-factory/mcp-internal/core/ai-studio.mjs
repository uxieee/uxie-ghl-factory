// AI Studio — the `vibe` surface. Corpus: knowledge/corpus/ai-studio/.
//
// The product is called `vibe` everywhere internally; "AI Studio" is only the sidebar label.
// The rules encoded here are the ones that silently return a WRONG answer rather than erroring:
//
//  1. TERMINAL STATE is `buildStatus`, never `thinkingStatus`. Measured 2026-09-04:
//     thinkingStatus reached "completed" at 3s while buildStatus was still "validating", and
//     only reached "ready" at 48s. A poller keyed on thinkingStatus reports a half-built site
//     as finished.
//  2. `POST /projects` REWRITES the submitted name and derives the slug from the rewrite
//     ("TEST-CAP-AISTUDIO-01" was stored as "Cap AIStudio"). A 201 is not evidence your name
//     survived. PATCH /name stores the literal but does NOT update the slug.
//  3. `alt_id` is NOT enforced on by-id reads — /projects/{id} and /files returned the full
//     record under another location's alt_id and under none at all. Verify alt_id on the
//     RETURNED record, never assume the request scoped anything.
//  4. `routes` returns soft-deleted rows (`deleted: true`). Filter them.
//  5. Publish journals a Firestore system row; UNPUBLISH JOURNALS NOTHING. Current state comes
//     from `published_at` on the project, never from the journal.
//  6. Chat history has no REST endpoint (GET /chat is 405). It is in Firestore.
//  7. `PATCH /star` is a TOGGLE — a `starred` key is ignored. No setter is exposed.

export const FIRESTORE_PROJECT = 'highlevel-backend';
export const FIRESTORE_DB = 'vibe-platform';
export const MESSAGES = 'vibe-messages';
export const DIFFS = 'vibe-message-diffs';

// GHL's own PUBLIC web client key, shipped in the AI Studio bundle. Not a secret; it identifies
// the Firebase project and cannot authorise anything on its own. Never read from a tool argument.
export const FIREBASE_KEY = 'AIzaSyB_w3vXmsI7WeQtrIOkjR6xTRVN5uOieiE';

export function plain(v) {
  if (v === null || v === undefined) return v;
  const k = Object.keys(v)[0];
  switch (k) {
    case 'stringValue': case 'booleanValue': case 'timestampValue': return v[k];
    case 'integerValue': case 'doubleValue': return Number(v[k]);
    case 'nullValue': return null;
    case 'arrayValue': return (v.arrayValue.values ?? []).map(plain);
    case 'mapValue': return Object.fromEntries(
      Object.entries(v.mapValue.fields ?? {}).map(([a, b]) => [a, plain(b)]));
    default: return v;
  }
}

// Two hops: the backend mints a Firebase CUSTOM token for this location, then Google exchanges
// it for an idToken. Cached per location with a safety margin, because the exchange is a second
// network round trip on every history read otherwise.
export async function getIdToken({ gwJwt, locationId, cache, fetchImpl = fetch, nowMs = Date.now }) {
  const hit = cache.get(locationId);
  if (hit && hit.expiresAt > nowMs() + 60_000) return hit.idToken;

  const r = await gwJwt.call('POST', `/oauth/2/login/signin/refresh?version=2&location_id=${locationId}`, {});
  const custom = r?.json?.token;
  if (!custom) {
    const e = new Error(`could not mint a Firebase custom token for this location (status ${r?.status})`);
    e.code = 'FIREBASE_SIGNIN_FAILED';
    e.remediation = 'Check the Bearer credential reaches this location; /vibe-ai is Bearer-only.';
    throw e;
  }
  const res = await fetchImpl(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_KEY}`,
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const body = await res.json();
  if (!res.ok || !body?.idToken) {
    // The upstream message is a status string, never the credential; the token itself is never
    // interpolated into an error.
    const e = new Error(`Firebase token exchange failed: ${body?.error?.message ?? res.status}`);
    e.code = 'FIREBASE_SIGNIN_FAILED';
    throw e;
  }
  const ttlMs = (Number(body.expiresIn) || 3600) * 1000;
  cache.set(locationId, { idToken: body.idToken, expiresAt: nowMs() + ttlMs });
  return body.idToken;
}

// Firestore returns one array element per matched document, PLUS bookkeeping elements that carry
// only `readTime`. Filtering on `.document` is not defensive coding; the bare rows are always there.
export async function runQuery({ gwFirebase, idToken, collection, projectId, orderBy = null, limit = 300 }) {
  const structuredQuery = {
    from: [{ collectionId: collection }],
    where: { fieldFilter: { field: { fieldPath: 'projectId' }, op: 'EQUAL', value: { stringValue: projectId } } },
    limit,
  };
  if (orderBy) structuredQuery.orderBy = [{ field: { fieldPath: orderBy }, direction: 'ASCENDING' }];
  const path = `/v1/projects/${FIRESTORE_PROJECT}/databases/${FIRESTORE_DB}/documents:runQuery`;
  const res = await gwFirebase.call('POST', path, { structuredQuery },
    { headers: { authorization: `Bearer ${idToken}` } });
  const rows = Array.isArray(res.json) ? res.json : [];
  return rows.filter((x) => x.document).map((x) =>
    Object.fromEntries(Object.entries(x.document.fields ?? {}).map(([k, v]) => [k, plain(v)])));
}
