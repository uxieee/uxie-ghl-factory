// Page SEO lives on the page RECORD's `meta` (GET /funnels/page/{pageId}).
//
// Measured 2026-09-28 (knowledge sniffs/funnels-wave10-e-plan-2026-09-28 live-route.funnel-page-meta.json):
// POST /funnels/funnel/funnel-page/{pageId} {name, url, meta} writes it, and the new meta reads back on a
// separate GET. It is the route the UI's "Edit page details" uses for {name, url}. (The builder's SEO
// panel writes the same document Firestore-direct; this module does not.) The autosave body's `meta`
// lands on the DRAFT VERSION only — the public page renders the SERVED version's meta — so a record
// write is not a changed page until a version carrying the meta is published.
//
// The route also writes name and url. So the body carries the values from the fresh record read the
// target check just did, and the read-back verifies they are still those values: a mismatch means the
// page was renamed or moved between the read and the write, and is reported, never papered over.
import { SEO_KEYS } from './page-edit.mjs';

/** The one POST: the record's own name and url, and every one of the 8 meta keys. */
export function metaPost(pageId, record, meta) {
  return {
    method: 'POST',
    path: `/funnels/funnel/funnel-page/${encodeURIComponent(pageId)}`,
    body: { name: record.name, url: record.url, meta: Object.fromEntries(SEO_KEYS.map((k) => [k, meta[k]])) },
  };
}

/**
 * The target check the write needs beyond the step/page one: the page RECORD must resolve and belong
 * to the bound location and to this funnel, before its name/url/meta are written back.
 */
export function checkRecord(record, { pageId, locationId, funnelId }) {
  if (!record || (record._id ?? record.id) !== pageId) return { ok: false, reason: `GET /funnels/page/${pageId} did not return that page` };
  if (record.locationId !== locationId) return { ok: false, reason: `page ${pageId} belongs to another location` };
  if (record.funnelId !== funnelId) return { ok: false, reason: `page ${pageId} belongs to funnel ${record.funnelId}, not ${funnelId}` };
  if (record.deleted === true) return { ok: false, reason: `page ${pageId} is deleted` };
  if (typeof record.name !== 'string' || typeof record.url !== 'string') return { ok: false, reason: `page ${pageId}'s record has no name/url to write back` };
  return { ok: true };
}

/** Name/url that did not read back as sent — a concurrent rename or move between our read and our write. */
export function recordDrift(sent, after) {
  const drift = [];
  if (after?.name !== sent.name) drift.push({ key: 'name', sent: sent.name, readBack: after?.name ?? null });
  if (after?.url !== sent.url) drift.push({ key: 'url', sent: sent.url, readBack: after?.url ?? null });
  return drift;
}
