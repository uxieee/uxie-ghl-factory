// Page SEO is FIRESTORE-DIRECT — the builder's own write path; no backend REST route writes it.
//
// Measured 2026-09-28 (knowledge sniffs/funnels-wave9-page-redirect-tools-2026-09-28): the builder's SEO
// panel writes `funnel_pages/{pageId}.meta` in the (default) Firestore database through the Write
// channel (updateMask ["meta"], currentDocument.exists). GET /funnels/page/{id}.meta reads that
// document and the PUBLIC page renders it (<title>, <meta name=description|keywords|author>). The
// autosave body's `meta` lands on the DRAFT VERSION only — it is what the builder panel shows, and it
// never reaches the record; five transport/body variants were tried and none moved it.
//
// Here the same write goes through Firestore REST (PATCH with an update mask), with a location-scoped
// idToken minted the way ai-studio.mjs mints one.
import { getIdToken } from './ai-studio.mjs';
import { SEO_KEYS } from './page-edit.mjs';

const DOC = (pageId) => `/v1/projects/highlevel-backend/databases/(default)/documents/funnel_pages/${encodeURIComponent(pageId)}`;

const toValue = (v) => {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (v && typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: v == null ? '' : String(v) };
};

/** The PATCH the builder's write amounts to: every one of the 8 keys, mask exactly `meta`, never create. */
export function metaPatch(pageId, meta) {
  const fields = Object.fromEntries(SEO_KEYS.map((k) => [k, toValue(meta[k])]));
  return {
    path: `${DOC(pageId)}?updateMask.fieldPaths=meta&currentDocument.exists=true`,
    body: { fields: { meta: { mapValue: { fields } } } },
  };
}

/**
 * The target check the PATCH needs beyond the step/page one: the page RECORD must resolve and belong
 * to the bound location and to this funnel. A Firestore write is not scoped by the backend, so this
 * is the only thing standing between a wrong pageId and someone else's page.
 */
export function checkRecord(record, { pageId, locationId, funnelId }) {
  if (!record || (record._id ?? record.id) !== pageId) return { ok: false, reason: `GET /funnels/page/${pageId} did not return that page` };
  if (record.locationId !== locationId) return { ok: false, reason: `page ${pageId} belongs to another location` };
  if (record.funnelId !== funnelId) return { ok: false, reason: `page ${pageId} belongs to funnel ${record.funnelId}, not ${funnelId}` };
  if (record.deleted === true) return { ok: false, reason: `page ${pageId} is deleted` };
  return { ok: true };
}

/** One PATCH, retried ONCE with a fresh idToken if Firestore rejects the credential. Never silent. */
export async function writeMeta({ gwJwt, gwFirebase, locationId, cache, pageId, meta }) {
  const { path, body } = metaPatch(pageId, meta);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const idToken = await getIdToken({ gwJwt, locationId, cache });
    const res = await gwFirebase.call('PATCH', path, body, { headers: { authorization: `Bearer ${idToken}` } });
    if (res.ok) return { status: res.status, attempts: attempt };
    if ((res.status === 401 || res.status === 403) && attempt === 1) { cache.delete(locationId); continue; }
    const e = new Error(`Firestore page-meta write failed (status ${res.status}${res.json?.error?.status ? `, ${res.json.error.status}` : ''})`);
    e.code = res.status === 401 || res.status === 403 ? 'FIRESTORE_AUTH_REJECTED'
      : res.status === 404 || res.json?.error?.status === 'NOT_FOUND' || res.json?.error?.status === 'FAILED_PRECONDITION' ? 'FIRESTORE_DOC_MISSING'
        : 'FIRESTORE_WRITE_FAILED';
    e.status = res.status;
    e.remediation = e.code === 'FIRESTORE_AUTH_REJECTED'
      ? 'Firestore rejected the location idToken twice. Re-capture the credential; the SEO was NOT written.'
      : e.code === 'FIRESTORE_DOC_MISSING'
        ? 'No funnel_pages document for this pageId (the write never creates one). Check the pageId; the SEO was NOT written.'
        : 'The SEO was NOT written. Inspect the status before retrying.';
    throw e;
  }
  return null;
}
