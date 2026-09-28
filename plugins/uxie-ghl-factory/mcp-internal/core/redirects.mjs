// URL redirects (Settings → Domains & URL Redirects → URL Redirects) — domain-scoped, not funnel-scoped.
// Every shape here was captured from GHL's own screen and executed live on a sandbox, 2026-09-28
// (knowledge sniffs/funnels-wave5-route-2026-09-28; corpus funnels/20-api/url-redirects.md).
//
//   list    GET    /funnels/lookup/redirect/list?locationId=&limit=&offset=&search=  → {data:[{_id,path,…}], count}
//   exists  POST   /funnels/lookup/exists {domain, path, locationId}                  → {exists}
//   create  POST   /funnels/lookup/redirect {domain, path, action:"url", locationId, type:"redirect", target}
//   update  PATCH  /funnels/lookup/redirect/{id} {action, target, locationId}          (the source is locked)
//   delete  DELETE /funnels/lookup/redirect/{id}?locationId=
//   stats   POST   /stats/url-redirect {locationId, fromDate, toDate, rows:[{key:{domainName,pageUrl,fullUrl}}]}

// The storefront/blog router owns these prefixes. A redirect under one is ACCEPTED and stored (201)
// but its exact path answers 404 in public — only a case-varied path reaches the 301 (proven by
// differential, live-route.reserved-paths.json). So create refuses them.
export const RESERVED_PREFIXES = Object.freeze(['/b/', '/c/', '/product/', '/collections/', '/post/', '/category/', '/author/', '/tag/']);

export const normPath = (p) => `/${String(p ?? '').trim().replace(/^\/+/, '')}`;
export const reservedPrefix = (path) => RESERVED_PREFIXES.find((r) => normPath(path).toLowerCase().startsWith(r)) ?? null;
export const rowId = (r) => r?._id ?? r?.id ?? null;

export function validateTarget(target) {
  try { const u = new URL(target); return u.protocol === 'https:' || u.protocol === 'http:' ? null : 'target must be an http(s) URL'; } catch { return 'target must be an absolute http(s) URL'; }
}

export function planCreate({ domain, path, target, locationId }) {
  if (!domain || !path || !target) return { error: 'create needs domain, path and target' };
  const p = normPath(path);
  if (p === '/') return { error: 'path "/" would redirect the domain root; the screen\'s "Entire Domain (/*)" form is a separate, unmapped surface' };
  const reserved = reservedPrefix(p);
  if (reserved) return { error: `path ${p} is under the reserved prefix ${reserved}: GHL stores it but its exact path answers 404 in public (the storefront/blog router takes it first)` };
  const bad = validateTarget(target);
  if (bad) return { error: bad };
  return {
    exists: { method: 'POST', path: '/funnels/lookup/exists', body: { domain, path: p, locationId } },
    request: { method: 'POST', path: '/funnels/lookup/redirect', body: { domain, path: p, action: 'url', locationId, type: 'redirect', target } },
    normalizedPath: p,
  };
}

/** Target check for update/delete: exactly one listed row whose id AND path both match. */
export function resolveTarget(rows, { redirectId, path }) {
  const p = normPath(path);
  const byId = rows.filter((r) => rowId(r) === redirectId);
  if (byId.length !== 1) return { error: `no single redirect with id ${redirectId} on this location (${byId.length} found)` };
  if (byId[0].path !== p && byId[0].path_lowercase !== p.toLowerCase()) return { error: `redirect ${redirectId} is ${byId[0].path}, not ${p} — refusing` };
  return { row: byId[0] };
}

export function planUpdate({ redirectId, target, locationId }) {
  const bad = validateTarget(target);
  if (bad) return { error: bad };
  return { request: { method: 'PATCH', path: `/funnels/lookup/redirect/${encodeURIComponent(redirectId)}`, body: { action: 'url', target, locationId } } };
}

export function planDelete({ redirectId, locationId }) {
  return { request: { method: 'DELETE', path: `/funnels/lookup/redirect/${encodeURIComponent(redirectId)}?locationId=${encodeURIComponent(locationId)}` } };
}

/** Walk every page of the list (the screen pages by 10). `search` narrows by path text. */
export async function listRedirects(gw, locationId, search = '') {
  const rows = [];
  for (let offset = 0, guard = 0; guard < 100; guard++) {
    const r = await gw.call('GET', `/funnels/lookup/redirect/list?locationId=${encodeURIComponent(locationId)}&limit=10&offset=${offset}&search=${encodeURIComponent(search)}`);
    if (!r.ok) return { res: r, rows: null };
    const page = Array.isArray(r.json?.data) ? r.json.data : [];
    rows.push(...page);
    offset += page.length;
    if (!page.length || offset >= (r.json?.count ?? 0)) return { res: r, rows, count: r.json?.count ?? rows.length };
  }
  return { res: null, rows, count: rows.length, truncated: true };
}

export const statsBody = (locationId, rows, fromDate, toDate) => ({
  locationId, fromDate, toDate,
  rows: rows.map((r) => ({ key: { domainName: r.domain, pageUrl: r.path, fullUrl: r.target } })),
});
