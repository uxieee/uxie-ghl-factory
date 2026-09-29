// URL redirects (Settings → Domains & URL Redirects → URL Redirects) — domain-scoped, not funnel-scoped.
// Every shape here was captured from GHL's own screen and executed live on a sandbox, 2026-09-28
// (knowledge sniffs/funnels-wave5-route-2026-09-28; corpus funnels/20-api/url-redirects.md).
//
//   list    GET    /funnels/lookup/redirect/list?locationId=&limit=&offset=&search=  → {data:[{_id,path,…}], count}
//   exists  POST   /funnels/lookup/exists {domain, path, locationId}                  → {exists}
//   create  POST   /funnels/lookup/redirect {domain, path, action, locationId, type:"redirect", target}
//             action "url"     target = an absolute URL                         (Redirect To → Custom URL)
//             action "funnel"  target = a STEP id of a funnel                   (Redirect To → Funnel + Step)
//             action "website" target = a STEP id of a website (its page)       (Redirect To → Website + Page)
//             action "all"     path "*", target = a URL                         (Entire Domain (/*) → Custom Domain)
//           bodies captured from the screen with the save BLOCKED, 2026-09-30 (knowledge sniffs/funnels-wave37-f5-redirects-2026-09-30)
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

/** The redirect's target as the screen stores it. `to` = {type:'funnel'|'website', funnelId, stepId} is resolved against the funnel document (which must be
 *  on this location, of that type, and hold the step); a URL target is validated. Returns {action, target} or {error}. */
export function resolveTo({ to, target, funnelDoc }) {
  if (!to) { const bad = validateTarget(target); return bad ? { error: bad } : { action: 'url', target }; }
  if (target) return { error: 'name a URL `target` OR a step target `to`, not both' };
  if (!['funnel', 'website'].includes(to.type)) return { error: 'to.type must be "funnel" or "website"' };
  if (!to.funnelId || !to.stepId) return { error: 'to needs funnelId and stepId (the step the redirect lands on)' };
  if (!funnelDoc) return { error: `funnel ${to.funnelId} was not found on this location` };
  if ((funnelDoc._id ?? funnelDoc.id) !== to.funnelId) return { error: `the document read is not ${to.funnelId}` };
  if (to.type === 'website' ? funnelDoc.type !== 'website' : funnelDoc.type === 'website') return { error: `${funnelDoc.name} is a ${funnelDoc.type}, not a ${to.type}` };
  if (!(funnelDoc.steps ?? []).some((st) => st.id === to.stepId)) return { error: `${funnelDoc.name} has no step ${to.stepId} (${(funnelDoc.steps ?? []).map((st) => `${st.name}: ${st.id}`).join(', ') || 'none'})` };
  return { action: to.type, target: to.stepId };
}

/** `entireDomain` is the screen's "Entire Domain (/*)": every path of the domain, so it is a separate, doubly-confirmed form. */
export const ENTIRE_DOMAIN = Object.freeze({ path: '*', action: 'all' });

export function planCreate({ domain, path, target, action = 'url', entireDomain = false, locationId }) {
  if (!domain || !target) return { error: 'create needs domain and a target' };
  if (entireDomain) {
    if (path && !['*', '/*'].includes(String(path))) return { error: 'entireDomain redirects every path of the domain; do not also name a path' };
    const bad = validateTarget(target);
    if (bad) return { error: `an entire-domain redirect goes to a URL: ${bad}` };
    return {
      entireDomain: true,
      request: { method: 'POST', path: '/funnels/lookup/redirect', body: { domain, path: ENTIRE_DOMAIN.path, action: ENTIRE_DOMAIN.action, locationId, type: 'redirect', target } },
      normalizedPath: ENTIRE_DOMAIN.path,
    };
  }
  if (!path) return { error: 'create needs a path (or entireDomain:true)' };
  const p = normPath(path);
  if (p === '/') return { error: 'path "/" would redirect the domain root; use entireDomain:true for the screen\'s "Entire Domain (/*)" form' };
  const reserved = reservedPrefix(p);
  if (reserved) return { error: `path ${p} is under the reserved prefix ${reserved}: GHL stores it but its exact path answers 404 in public (the storefront/blog router takes it first)` };
  if (action === 'url') { const bad = validateTarget(target); if (bad) return { error: bad }; }
  return {
    exists: { method: 'POST', path: '/funnels/lookup/exists', body: { domain, path: p, locationId } },
    request: { method: 'POST', path: '/funnels/lookup/redirect', body: { domain, path: p, action, locationId, type: 'redirect', target } },
    normalizedPath: p,
  };
}

/** Target check for update/delete: exactly one listed row whose id AND path both match. */
export function resolveTarget(rows, { redirectId, path }) {
  const p = ['*', '/*'].includes(String(path).trim()) ? '*' : normPath(path); // the entire-domain row's path is stored as "*"
  const byId = rows.filter((r) => rowId(r) === redirectId);
  if (byId.length !== 1) return { error: `no single redirect with id ${redirectId} on this location (${byId.length} found)` };
  if (byId[0].path !== p && byId[0].path_lowercase !== p.toLowerCase()) return { error: `redirect ${redirectId} is ${byId[0].path}, not ${p} — refusing` };
  return { row: byId[0] };
}

export function planUpdate({ redirectId, target, action = 'url', locationId }) {
  if (action === 'url' || action === 'all') { const bad = validateTarget(target); if (bad) return { error: bad }; }
  return { request: { method: 'PATCH', path: `/funnels/lookup/redirect/${encodeURIComponent(redirectId)}`, body: { action, target, locationId } } };
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
