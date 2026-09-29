// Funnel/website document operations behind get_funnel and edit_funnel.
//
// Every write here was captured from GHL's own UI and executed live on the sandbox before it was
// written down (knowledge/sniffs/funnels-wave1-2026-09-26, funnels-wave4-page-2026-09-26). The
// bodies below are those captured shapes, not guesses. What the UI does that looks wrong is kept
// here as a note on the result, because a caller cannot see it from a 2xx:
//
//  - update-settings is a FULL write. Omitted optional keys are left alone, but five keys are
//    required (locationId, allowPaymentModeOption, imageOptimization, isGdprCompliant,
//    isOptimisePageLoad) and a partial body without them 422s. We always send the UI's whole body,
//    built from a fresh read, so a settings edit never changes a field the caller did not name.
//  - funnelPath is the funnel ROOT lookup row: changing it moves that row in place, the old path 404s.
//  - a step created WITHOUT a top-level domainId gets NO lookup row and 404s in public. So
//    create-step refuses on a funnel with no domain rather than making an unreachable step.
//  - moving a step's path is one PUT; Cloudflare may serve the old path for minutes (max-age 60 +
//    stale-while-revalidate 30) — measured 90 s to ~3 min. The UI never invalidates the cache on unpublish either.
//  - publish / unpublish / edit-redirect are ONE route: PUT /funnels/lookup/multiple over the step
//    AND page lookup rows. No page version is created by it.
//  - custom security headers and split-test routing apply to the EXACT-CASE path only; a case-varied
//    URL serves the same page without them.
import { randomUUID } from 'node:crypto';

export const SETTINGS_KEYS = Object.freeze({
  // update-settings key : where the value lives on GET /funnels/funnel/fetch
  funnelName: 'name',
  funnelPath: 'url',
  domainId: 'domainId',
  faviconUrl: 'faviconUrl',
  headTrackingCode: 'trackingCodeHead',
  bodyTrackingCode: 'trackingCodeBody',
  paymentMode: 'isLivePaymentMode',
  chatWidgetId: 'chatWidgetId',
  imageOptimization: 'imageOptimization',
  isGdprCompliant: 'isGdprCompliant',
  isOptimisePageLoad: 'isOptimisePageLoad',
  requireCreditCard: 'requireCreditCard',
  storeCurrencyFormatting: 'storeCurrencyFormatting',
  autoGenerateSchema: 'autoGenerateSchema',
});

export const CACHE_NOTE = 'The public domain is behind Cloudflare (cache-control max-age 60 + stale-while-revalidate 30): the exact path can keep serving the previous state for a few minutes (measured 90 s to ~3 min after a path move or unpublish). Do not retry the write; re-read after that window. A case-varied URL skips the cache but ALSO skips split-test routing and custom security headers, so it is not the same request.';
export const EXACT_CASE_NOTE = 'Custom security headers and split-test routing apply to the EXACT-CASE path only: a case-varied URL (e.g. /My-Page for /my-page) serves the same page WITHOUT the headers and without the split. A CSP or X-Frame-Options set here can be bypassed by changing the URL case.';

const body = (r) => r?.json?.data ?? r?.json ?? null;
const enc = encodeURIComponent;

export async function readFunnel(gw, locationId, funnelId) {
  const r = await gw.call('GET', `/funnels/funnel/fetch/${enc(funnelId)}?locationId=${enc(locationId)}`);
  return { res: r, funnel: r.ok ? body(r) : null };
}

export async function readLookups(gw, locationId, funnelId) {
  const r = await gw.call('GET', `/funnels/lookup/list?locationId=${enc(locationId)}&funnelId=${enc(funnelId)}`);
  const rows = Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json) ? r.json : [];
  return { res: r, rows };
}

// Every page record of a document, archived ones included (deleted:true) — the step overview's "Archived pages" source.
export async function readFunnelPages(gw, locationId, funnelId) {
  const r = await gw.call('GET', `/funnels/page/list?funnelId=${enc(funnelId)}&locationId=${enc(locationId)}`);
  const pages = Array.isArray(r.json) ? r.json : Array.isArray(r.json?.data) ? r.json.data : [];
  return { res: r, pages };
}

export const stepView = (s, i) => ({
  id: s.id, name: s.name, url: s.url, type: s.type, pages: s.pages ?? [], sequence: s.sequence ?? i,
  split: s.split === true, controlTraffic: s.control_traffic ?? s.controlTraffic ?? null,
});

export const lookupView = (r) => ({
  id: r._id, type: r.type, typeId: r.typeId, path: r.path, domain: r.domain,
  publishStatus: r.publishStatus ?? null, action: r.action ?? null, target: r.target ?? null,
});

export function settingsFrom(funnel) {
  const out = {};
  for (const [key, src] of Object.entries(SETTINGS_KEYS)) out[key] = funnel?.[src] ?? null;
  return out;
}

// The UI's own update-settings body, from a fresh read, with the caller's overrides applied. Every derived value is
// derived the way the Settings page derives it (funnelWebsiteApp funnels.da6ddfb… onMounted + the `ti` watcher, body
// `tR`), never defaulted by this tool — a default the UI does not use changes a field the caller never named
// (knowledge sniffs/funnels-completeness-2026-09-29 notes-B, B-D1/B-D2/B-D3):
//  - autoGenerateSchema: the UI reads an ABSENT key as false (`=== true`). This tool wrote `?? true`, so any settings
//    edit on a document that never stored it turned ON "auto-generate schema on publish".
//  - allowPaymentModeOption / paymentMode: the Live/Test option is offered when the funnel already stores
//    isLivePaymentMode, or when the location has NO Stripe publishable key (then the mode is
//    `location.stripeConnectMode || true`). Otherwise the UI sends allowPaymentModeOption:false and no paymentMode.
//    A caller who names paymentMode asks for the option, so it is sent with allowPaymentModeOption:true.
//  - stopAllSplitTestsAndReset: null, except when the caller confirmed a domain change of a funnel that has one — then
//    the object the UI's ConfirmDomainUpdateModal sends, {locationId, funnelId, userId}.
// `ctx.location` is the location record (GET /locations/{id}); it is only read when the derivation needs it.
export function paymentModeFields(funnel, location, overrides = {}) {
  if ('paymentMode' in overrides) return { allowPaymentModeOption: true, paymentMode: overrides.paymentMode };
  if (funnel.isLivePaymentMode !== undefined && funnel.isLivePaymentMode !== null) return { allowPaymentModeOption: true, paymentMode: funnel.isLivePaymentMode };
  const offered = !location?.stripe?.publishable_key;
  return offered ? { allowPaymentModeOption: true, paymentMode: location?.stripeConnectMode || true } : { allowPaymentModeOption: false };
}
export const needsLocationForSettings = (funnel, overrides = {}) => !('paymentMode' in overrides) && (funnel.isLivePaymentMode === undefined || funnel.isLivePaymentMode === null);

export function settingsBody(locationId, funnel, overrides = {}, ctx = {}) {
  const funnelId = funnel._id ?? funnel.id;
  return {
    locationId, funnelId,
    funnelPath: funnel.url, funnelName: funnel.name, domainId: funnel.domainId ?? '',
    faviconUrl: funnel.faviconUrl ?? '', headTrackingCode: funnel.trackingCodeHead ?? '', bodyTrackingCode: funnel.trackingCodeBody ?? '',
    ...paymentModeFields(funnel, ctx.location, overrides), chatWidgetId: funnel.chatWidgetId ?? '',
    imageOptimization: funnel.imageOptimization ?? true, isGdprCompliant: funnel.isGdprCompliant ?? false,
    isOptimisePageLoad: funnel.isOptimisePageLoad ?? true,
    stopAllSplitTestsAndReset: ctx.resetSplitTests ? { locationId, funnelId, userId: ctx.userId } : null,
    requireCreditCard: funnel.requireCreditCard ?? true, storeCurrencyFormatting: funnel.storeCurrencyFormatting ?? false,
    autoGenerateSchema: funnel.autoGenerateSchema === true,
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'paymentMode')),
  };
}

// A DOMAIN CHANGE on a funnel that already has one is what the UI guards with ConfirmDomainUpdateModal: "this will stop
// and delete any variation step in split testing / delete stats associated with split testing". Websites and webinars
// skip the modal. Returns why a confirm is needed, or null.
export function domainChangeGuard(funnel, overrides = {}) {
  if (!('domainId' in overrides)) return null;
  const was = funnel.domainId ?? ''; const next = overrides.domainId ?? '';
  if (!was || next === was) return null;
  if (funnel.type === 'website' || funnel.type === 'webinar') return null;
  return next ? 'changing' : 'removing';
}

// The Settings page LISTS no domain that carries a regex/wildcard redirect (getBulkRegexRedirects → the domain select
// drops every domain in the answer). `rows` is GET /funnels/lookup/redirect/regex/bulk's answer.
export const regexRedirectOn = (domainUrl, rows) => (Array.isArray(rows) ? rows : rows?.data ?? []).filter((r) => r?.domain === domainUrl);

// Compare what was asked for against what read back. A key the server normalised (e.g. a path
// given without its leading slash) is reported, never silently accepted as a match.
export function settingsDiff(requested, after) {
  const got = settingsFrom(after);
  return Object.entries(requested).map(([k, want]) => {
    const have = got[k];
    const same = k === 'funnelPath' ? normPath(have) === normPath(want) : JSON.stringify(have ?? '') === JSON.stringify(want ?? '');
    return { key: k, requested: want, readBack: have, applied: same };
  });
}

// "Only the named fields change", checked rather than claimed: every settings key the caller did NOT name, before vs
// after. A key the document never stored that now reads back as exactly what the UI's body sent is a DEFAULT the save
// materialised (the UI's own save does the same); anything else is an unrequested change.
export function settingsSideEffects(requested, before, after, sentBody) {
  const was = settingsFrom(before); const now = settingsFrom(after);
  const materialised = []; const changed = [];
  for (const k of Object.keys(SETTINGS_KEYS)) {
    if (k in requested) continue;
    if (JSON.stringify(was[k] ?? null) === JSON.stringify(now[k] ?? null)) continue;
    if (was[k] == null && JSON.stringify(now[k]) === JSON.stringify(sentBody?.[k])) materialised.push({ key: k, readBack: now[k] });
    else changed.push({ key: k, before: was[k], after: now[k] });
  }
  return { materialised, changed };
}

export const normPath = (p) => (p == null ? p : `/${String(p).replace(/^\/+/, '')}`);

// ── plans: pure, so the preview a caller sees IS the request that confirm:true sends ─────────────

export function planCreateStep({ funnel, step }) {
  if (!funnel.domainId) {
    return { refuse: 'this funnel has no domain attached. A step created without a domainId gets NO lookup row and 404s in public (measured). Attach a domain first (settings op with domainId), then create the step.' };
  }
  const id = step.id ?? randomUUID();
  return {
    method: 'POST', path: '/funnels/funnel/create-step',
    body: {
      step: { id, name: step.name, url: String(step.url).replace(/^\/+/, ''), pages: [], type: step.type ?? 'optin_funnel_page', split: false, control_traffic: 100 },
      funnelId: funnel._id ?? funnel.id,
      domainId: funnel.domainId,
    },
    stepId: id,
  };
}

export function planUpdateStep({ funnel, stepId, name, url, domainName }) {
  const s = (funnel.steps ?? []).find((x) => x.id === stepId);
  if (!s) return { refuse: `step ${stepId} is not on this funnel` };
  const b = { stepId, name: name ?? s.name };
  if (url !== undefined) {
    if (!domainName) return { refuse: 'moving a step path needs the funnel\'s domain name, and it could not be resolved from the domain list' };
    Object.assign(b, { url: normPath(url), domainName });
  }
  return { method: 'PUT', path: `/funnels/funnel/step/${enc(funnel._id ?? funnel.id)}`, body: b };
}

// Store pages follow a fixed order: the builder does not let them be dragged ("Store pages cannot be reordered"; the funnel list's
// reorderNotAllowedTitle), so the tool does not send that PATCH for a funnel that has one. The server's own enforcement is unmeasured —
// the refusal mirrors the product's, it is not a proven server rule.
const isStoreStep = (s) => s?.type === 'store' || /^store-/.test(s?.key ?? '');

export function planReorder({ funnel, order }) {
  const steps = funnel.steps ?? [];
  const ids = steps.map((s) => s.id);
  const same = order.length === ids.length && new Set(order).size === order.length && order.every((id) => ids.includes(id));
  if (!same) {
    return { refuse: `order must name EVERY step exactly once (${ids.length} on this funnel). The route replaces the whole steps array; a subset would drop steps.` };
  }
  if (funnel.type === 'store' || steps.some(isStoreStep)) {
    return { refuse: 'store pages follow a fixed order and cannot be reordered (the page builder refuses the drag: "Store pages cannot be reordered"). Nothing was sent.' };
  }
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  // The UI sends each step's FULL stored object with `sequence` set; a step that carries more than the plain eight keys (a split test's
  // split_started_at / route_all_requests / additional_routes, a custom product page's key / products) keeps them — the PATCH replaces the
  // whole array, so a key left out is a key dropped.
  return {
    method: 'PATCH', path: `/funnels/funnel/update/${enc(funnel._id ?? funnel.id)}`,
    body: { steps: order.map((id, i) => {
      const { control_traffic, ...rest } = byId[id];
      return { ...rest, controlTraffic: control_traffic ?? rest.controlTraffic ?? 100, pages: rest.pages ?? [], split: rest.split === true, sequence: i + 1 };
    }) },
  };
}

export function planCloneStep({ funnel, stepId, locationId, userId }) {
  if (!(funnel.steps ?? []).some((s) => s.id === stepId)) return { refuse: `step ${stepId} is not on this funnel` };
  if (!userId) return { refuse: 'this credential carries no user id, and clone-funnel-step requires one' };
  const fid = funnel._id ?? funnel.id;
  return { method: 'POST', path: '/funnels/funnel/clone-funnel-step/', body: { stepId, funnelId: fid, funnels: [fid], locationId, userId } };
}

// Delete is behind a target check: the caller names the step by id AND its current name, and both
// must match a single step on a fresh read.
export function planDeleteStep({ funnel, stepId, expectName }) {
  const hits = (funnel.steps ?? []).filter((s) => s.id === stepId);
  if (hits.length !== 1) return { refuse: `step ${stepId} is not on this funnel (found ${hits.length})` };
  if (typeof expectName !== 'string' || hits[0].name !== expectName) {
    return { refuse: `target check failed: step ${stepId} is named ${JSON.stringify(hits[0].name)}, not ${JSON.stringify(expectName)}. Nothing was deleted.` };
  }
  return { method: 'POST', path: '/funnels/funnel/delete-step', body: { funnelId: funnel._id ?? funnel.id, stepId }, target: stepView(hits[0], 0) };
}

// publish / unpublish a page = its step AND page lookup rows, as the UI writes them.
export function planPublishState({ funnel, lookups, pageId, publish, redirect, user }) {
  const step = (funnel.steps ?? []).find((s) => (s.pages ?? []).includes(pageId));
  if (!step) return { refuse: `page ${pageId} is not on any step of this funnel` };
  const rows = lookups.filter((r) => (r.type === 'page' || r.type === 'step' || r.type === 'redirect' || r.type === 'not_found_page')
    && (r.typeId === pageId || r.typeId === step.id));
  if (!rows.length) return { refuse: 'this page has no lookup rows (no public path), so there is nothing to publish or unpublish. Attach a domain / move the step path first.' };
  if (!publish && step.split === true) {
    return { refuse: 'this step is running a split test. The UI stops the split when the page is unpublished; that path is not proven here, so it is refused. End the split first.' };
  }
  const who = { publishStatusUpdatedBy: user?.id, ...(user?.name ? { publishStatusUpdatedByName: user.name } : {}) };
  let fields;
  if (publish) fields = (r) => ({ target: '', action: null, publishStatus: 'live', type: r.typeId === pageId ? 'page' : 'step' });
  else if (!redirect || redirect.type === '404') fields = () => ({ target: '', action: null, publishStatus: 'unpublished', type: 'not_found_page' });
  else if (redirect.type === 'url') {
    const u = String(redirect.url ?? '');
    if (!/^https?:\/\//i.test(u)) return { refuse: 'redirect.url must be an absolute http(s) URL' };
    fields = () => ({ target: u, action: 'url', publishStatus: 'unpublished', type: 'redirect' });
  } else return { refuse: `redirect.type ${JSON.stringify(redirect.type)} is not supported (404 | url). Redirect-to-step is not proven.` };
  return {
    method: 'PUT', path: '/funnels/lookup/multiple',
    body: { lookups: rows.map((r) => ({ lookupId: r._id, ...fields(r), ...who })) },
    rows: rows.map(lookupView), step: stepView(step, 0),
  };
}

export function planAddHeader({ funnel, locationId, key, value }) {
  if (!/^[A-Za-z0-9-]+$/.test(String(key ?? ''))) return { refuse: 'header name must be a token (letters, digits, dashes)' };
  const existing = (funnel.securityHeaders ?? []).find((h) => String(h.key).toLowerCase() === String(key).toLowerCase());
  if (existing) return { refuse: `header ${existing.key} already exists on this funnel; editing/removing is not proven here` };
  return { method: 'POST', path: '/funnels/funnel/headers', body: { locationId, funnelId: funnel._id ?? funnel.id, key, value: String(value ?? '') } };
}

// Delete a whole funnel/website document. Measured (sniffs/funnels-wave10-e-plan-2026-09-28
// live-object.funnel-delete.json): POST /funnels/funnel/delete {funnelId, locationId, userId} → 201
// {domains, paths} naming every path it freed; fetch then 400s "Funnel does not exist or is deleted".
// GHL itself deletes a funnel with LIVE steps without a word, and the edge keeps serving the dead page
// ~70 s. So this refuses while any step/page row still serves: unpublish those pages first.
export const SERVING = (r) => (r.type === 'step' || r.type === 'page') && r.publishStatus !== 'unpublished';

export function planDeleteFunnel({ funnel, lookups, expectName, locationId, userId }) {
  const fid = funnel._id ?? funnel.id;
  if (typeof expectName !== 'string' || funnel.name !== expectName) {
    return { refuse: `target check failed: funnel ${fid} is named ${JSON.stringify(funnel.name)}, not ${JSON.stringify(expectName)}. Nothing was deleted.` };
  }
  if (!userId) return { refuse: 'this credential carries no user id, and the delete route requires one' };
  const live = lookups.filter(SERVING);
  if (live.length) {
    return { refuse: `${live.length} public path(s) still serve on this document: ${live.map((r) => `${r.domain ?? ''}${r.path}`).join(', ')}. Unpublish each page first (edit_funnel unpublish-page), then delete. Nothing was deleted.` };
  }
  return {
    method: 'POST', path: '/funnels/funnel/delete', body: { funnelId: fid, locationId, userId },
    target: { id: fid, name: funnel.name, type: funnel.type, steps: (funnel.steps ?? []).length, lookupRows: lookups.length },
  };
}

// Split tests — the step overview's own calls (sniffs/funnels-wave1-2026-09-26 ui-cap-split.json,
// funnels-wave10-e-plan-2026-09-28 live-object.split-test-lifecycle.json):
//   add-variation   POST /funnels/funnel/clone-control-page/ {locationId, stepName, pageId, domainName}
//                   → PUT /funnels/funnel/step/{funnelId} {stepId, pages:[control, variation]}
//                   → POST /funnels/lookup/create {type:"page", typeId, path, funnelId, locationId, domain}
//   start           PUT /funnels/funnel/step/{funnelId} {stepId, split:true, control_traffic, split_started_at,
//                   split_ended_at:null, route_all_requests:true, additional_routes:[]}
//   declare-winner  POST /funnels/funnel/update-funnel-and-page {funnelId, locationId, archivePageId, stepId,
//                   funnelStepDetails:{stepId, pages:[winner], split:false, control_traffic:100,
//                   additional_routes:[], route_all_requests:false, split_ended_at}}
// The UI mints the variation's path from the step NAME (/w1r-optin for "W1R Optin"), which can collide
// with a real step; here the caller names it and it is pre-checked. Timestamps are the UI's display string.
export const splitStamp = (d = new Date()) => {
  const off = -d.getTimezoneOffset(); const sign = off >= 0 ? '+' : '-'; const a = Math.abs(off);
  const hh = d.getHours() % 12 || 12; const mm = String(d.getMinutes()).padStart(2, '0'); const ss = String(d.getSeconds()).padStart(2, '0');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${hh}:${mm}:${ss} ${d.getHours() < 12 ? 'AM' : 'PM'} UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

export function planSplit({ funnel, stepId, action, controlTraffic, winnerPageId, variationPath, domainName, locationId, now }) {
  const fid = funnel._id ?? funnel.id;
  const step = (funnel.steps ?? []).find((s) => s.id === stepId);
  if (!step) return { refuse: `step ${stepId} is not on this funnel` };
  const pages = step.pages ?? [];
  const put = (body) => ({ method: 'PUT', path: `/funnels/funnel/step/${enc(fid)}`, body: { stepId, ...body } });
  switch (action) {
    case 'add-variation': {
      if (pages.length !== 1) return { refuse: `step has ${pages.length} pages; a variation can only be added to a step with exactly one (the control)` };
      if (!domainName) return { refuse: 'the funnel has no domain, so the variation would get no public path. Attach a domain first.' };
      if (typeof variationPath !== 'string' || !variationPath.trim()) return { refuse: 'add-variation needs variationPath: the public path for the variation page (the UI would mint one from the step name, which can collide)' };
      return {
        steps: [
          { method: 'POST', path: '/funnels/funnel/clone-control-page/', body: { locationId, stepName: step.name, pageId: pages[0], domainName } },
          put({ pages: [pages[0], '<variation pageId from clone-control-page>'] }),
          { method: 'POST', path: '/funnels/lookup/create', body: { type: 'page', typeId: '<variation pageId>', path: normPath(variationPath.trim()), funnelId: fid, locationId, domain: domainName } },
        ],
        exists: { domain: domainName, path: normPath(variationPath.trim()), locationId },
        step: stepView(step, 0),
      };
    }
    case 'start': {
      if (pages.length !== 2) return { refuse: `step has ${pages.length} page(s); start needs a control and one variation (add-variation first)` };
      const ct = controlTraffic ?? 50;
      if (!Number.isInteger(ct) || ct < 0 || ct > 100) return { refuse: 'controlTraffic is an integer 0..100 (the share the control gets)' };
      return { ...put({ split: true, control_traffic: ct, split_started_at: splitStamp(now), split_ended_at: null, route_all_requests: true, additional_routes: [] }), step: stepView(step, 0) };
    }
    case 'declare-winner': {
      if (pages.length !== 2) return { refuse: `step has ${pages.length} page(s); there is no variation to decide` };
      if (!pages.includes(winnerPageId)) return { refuse: `winnerPageId must be one of this step's pages: ${pages.join(', ')}` };
      const loser = pages.find((p) => p !== winnerPageId);
      return {
        method: 'POST', path: '/funnels/funnel/update-funnel-and-page',
        body: { funnelId: fid, locationId, archivePageId: loser, stepId,
          funnelStepDetails: { stepId, pages: [winnerPageId], split: false, control_traffic: 100, additional_routes: [], route_all_requests: false, split_ended_at: splitStamp(now) } },
        target: { winner: winnerPageId, archived: loser, step: stepView(step, 0) },
      };
    }
    default: return { refuse: 'split-test action is add-variation | start | declare-winner' };
  }
}

// ── bounded re-read: a write that landed is never reported as failed because one read lagged ──
export async function reread(readFn, okFn, { tries = 5, delays = [0, 500, 1000, 2000, 3000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (delays[i]) await sleep(delays[i]);
    last = await readFn();
    if (okFn(last)) return { value: last, attempts: i + 1, settled: true };
  }
  return { value: last, attempts: tries, settled: false };
}

// ── Object operations (knowledge sniffs/funnels-wave13-objects-2026-09-28; each body is the UI's captured one) ──

// Clone a whole funnel/website into THIS location. The funnels list's Clone modal sends ONE call,
// POST /funnels/funnel/clone-funnel-to-locations {funnelId, funnelName, locationIds}, answered {ok:true} with NO
// id, so the copy is found afterwards by its exact name — which is why the name must be unused beforehand.
// The copy keeps the source's funnelPath and step urls but has NO domain and NO lookup rows: it serves nothing
// until a domain is attached, and attaching the source's domain collides on every path.
export const CLONE_FUNNEL_NOTE = 'The copy has NO domain and NO public paths (no lookup rows), and it keeps the SOURCE\'s funnel path and step urls. Attach a domain with settings {domainId, funnelPath}: on the source\'s domain GHL silently renames every colliding step/page path with a numeric suffix (measured /x → /x-5424), so read get_funnel view lookups after the attach and move the step paths with update-step url (a path move is refused before a domain is attached).';
export function planCloneFunnel({ funnel, name, locationId, existing }) {
  const n = String(name ?? '').trim();
  if (!n) return { refuse: 'clone-funnel needs name: the copy\'s name (the route returns no id; the copy is found by this exact name)' };
  const clash = (existing ?? []).filter((f) => String(f.name ?? '').trim().toLowerCase() === n.toLowerCase());
  if (clash.length) return { refuse: `a document named ${JSON.stringify(clash[0].name)} already exists on this location (${clash.map((f) => f._id ?? f.id).join(', ')}); the copy could not be told apart from it. Pick an unused name.` };
  return { method: 'POST', path: '/funnels/funnel/clone-funnel-to-locations', body: { funnelId: funnel._id ?? funnel.id, funnelName: n, locationIds: [locationId] }, name: n };
}

// Archive ("delete") one page of a step. The step overview's trash sends POST /funnels/funnel/update-funnel-and-page
// {funnelId, locationId, funnelStepDetails:{stepId, pages:<the rest>}, archivePageId, stepId}. Its modal says the page
// is permanently deleted; it is ARCHIVED (listed under Archived pages, restorable). The server refuses the only page
// of a step ("Cannot delete the only page in a step"); on a running split the UI also ends the split — unproven here,
// so refused.
export function planArchivePage({ funnel, pageId, expectName, pageRecord, locationId }) {
  const step = (funnel.steps ?? []).find((s) => (s.pages ?? []).includes(pageId));
  if (!step) return { refuse: `page ${pageId} is not on any step of this funnel` };
  if ((step.pages ?? []).length < 2) return { refuse: `page ${pageId} is the only page of step ${JSON.stringify(step.name)}; GHL refuses to archive the only page of a step (delete the step instead)` };
  if (step.split === true) return { refuse: 'this step is running a split test; archiving a page also ends the split in the UI, which is not proven here. Declare a winner (split-test declare-winner) instead.' };
  if (typeof expectName !== 'string' || pageRecord?.name !== expectName) {
    return { refuse: `target check failed: page ${pageId} is named ${JSON.stringify(pageRecord?.name ?? null)}, not ${JSON.stringify(expectName)}. Nothing was archived.` };
  }
  const fid = funnel._id ?? funnel.id;
  return {
    method: 'POST', path: '/funnels/funnel/update-funnel-and-page',
    body: { funnelId: fid, locationId, funnelStepDetails: { stepId: step.id, pages: step.pages.filter((p) => p !== pageId) }, archivePageId: pageId, stepId: step.id },
    target: { pageId, name: pageRecord.name, step: stepView(step, 0) },
  };
}

// Restore an archived page: POST /funnels/funnel/update-funnel-and-page {funnelId, locationId, restoreArchivePageId}.
// Archived pages are the step's rows in GET /funnels/page/list with deleted:true. The UI refuses while the step runs
// a split or already has a second page. The restored page gets a NEW public path minted from the page NAME — not its
// old path, which stays 404 — so links to the old path stay dead.
export function planRestorePage({ funnel, pageId, pages, locationId }) {
  const rec = (pages ?? []).find((p) => (p._id ?? p.id) === pageId);
  if (!rec) return { refuse: `page ${pageId} is not a page of this funnel` };
  if (rec.deleted !== true) return { refuse: `page ${pageId} is not archived (deleted:false); nothing to restore` };
  const step = (funnel.steps ?? []).find((s) => s.id === rec.stepId);
  if (!step) return { refuse: `the archived page's step ${rec.stepId} is no longer on this funnel; the UI offers restore only from the step` };
  if (step.split === true) return { refuse: 'cannot restore a page while the step runs a split test (the UI refuses the same)' };
  if ((step.pages ?? []).length > 1) return { refuse: 'the step already has a variation; the UI refuses to restore a page then. Archive the variation first.' };
  return { method: 'POST', path: '/funnels/funnel/update-funnel-and-page', body: { funnelId: funnel._id ?? funnel.id, locationId, restoreArchivePageId: pageId }, target: { pageId, name: rec.name, step: stepView(step, 0) } };
}

// A step product — what the step's order form lists and a one-click up/down-sell button sells: the step's Products
// tab → POST /funnels/order-form/products {locationId, funnel, step, name, displayText, product, price, bumpProduct,
// quantity:{max, allowMultiple}, authorizeAmount:0} (captured from the UI). It points to a catalogue product and ONE of
// its prices; its own _id is what a sell-product button stores as productId {id}. `prices` is the product's price list
// (GET /products/{id}/price) — a price of another product is refused, as the UI's price picker only offers the product's.
// The step's Products tab list: GET /funnels/order-form/products/?locationId&funnel&step → {products:[…]} with product
// and price POPULATED (a by-id read returns them as bare ids). Both shapes are accepted by stepProductView.
export async function readStepProducts(gw, locationId, funnelId, stepId) {
  const q = `locationId=${encodeURIComponent(locationId)}&funnel=${encodeURIComponent(funnelId)}&step=${encodeURIComponent(stepId)}`;
  const res = await gw.call('GET', `/funnels/order-form/products/?${q}`);
  return { res, rows: (res.json?.products ?? []).filter((r) => r.deleted !== true) };
}
export function stepProductView(r) {
  const idOf = (x) => (x && typeof x === 'object' ? x._id : x) ?? null;
  return { stepProductId: r._id, name: r.name, displayText: r.displayText ?? '',
    product: { id: idOf(r.product), name: typeof r.product === 'object' ? r.product?.name ?? null : null },
    price: { id: idOf(r.price), ...(typeof r.price === 'object' ? { name: r.price?.name, amount: r.price?.amount, currency: r.price?.currency, type: r.price?.type } : {}) },
    quantity: r.quantity ?? null, bump: r.bumpProduct === true };
}
export const STEP_PRODUCT_NOTE = 'The returned stepProductId is what a sell-product button needs: extra.productId = {value: {id: <stepProductId>}}. An order form on this step lists every step product.';
export function planAddStepProduct({ funnel, stepId, expectName, product, prices, existing, priceId, displayText, quantity, bump, locationId }) {
  const step = (funnel.steps ?? []).find((s) => s.id === stepId);
  if (!step) return { refuse: `step ${stepId} is not on this funnel` };
  if (typeof expectName !== 'string' || step.name !== expectName) {
    return { refuse: `target check failed: step ${stepId} is named ${JSON.stringify(step.name ?? null)}, not ${JSON.stringify(expectName)}. Nothing was added.` };
  }
  if (!product?._id) return { refuse: 'the product did not read back from this location' };
  const price = (prices ?? []).find((p) => p._id === priceId);
  if (!price) {
    return { refuse: `price ${priceId} is not a price of product ${JSON.stringify(product.name)} (its prices: ${(prices ?? []).map((p) => `${p._id} ${JSON.stringify(p.name)}`).join(', ') || 'none'})` };
  }
  const dup = (existing ?? []).find((e) => String(e.product?._id ?? e.product) === product._id && String(e.price?._id ?? e.price) === priceId && e.deleted !== true);
  if (dup) return { refuse: `this step already lists ${JSON.stringify(product.name)} at that price (step product ${dup._id}); nothing was added` };
  const q = quantity ?? {};
  return {
    method: 'POST', path: '/funnels/order-form/products',
    body: { locationId, funnel: funnel._id ?? funnel.id, step: stepId, name: product.name, displayText: displayText ?? '', product: product._id, price: priceId,
      bumpProduct: bump === true, quantity: { max: q.max ?? 1, allowMultiple: q.allowMultiple === true }, authorizeAmount: 0 },
    target: { step: stepView(step, 0), product: { id: product._id, name: product.name }, price: { id: price._id, name: price.name, amount: price.amount, currency: price.currency, type: price.type } },
  };
}

// Import a page from another step (any funnel/website/webinar on the location) as a new page of a target step: the
// step overview's "Create variation → Use existing → Import". POST /funnels/funnel/clone-funnel-step/ {stepId:<source
// step>, funnelId:<target funnel>, funnels:[<target funnel>], locationId, userId, stepIdToImportInto, pageIndexToImportInto,
// pageIndexToImport, funnelIdToImport:<source funnel>}. Products on the source page are NOT imported (the UI warns so).
export const IMPORT_PAGE_NOTE = 'Products attached to the source page are NOT imported (GHL\'s own warning). The page is a copy with a new id; it gets its own public path.';
export function planImportPage({ funnel, stepId, source, sourceStepId, sourcePageIndex = 0, locationId, userId }) {
  const target = (funnel.steps ?? []).find((s) => s.id === stepId);
  if (!target) return { refuse: `target step ${stepId} is not on this funnel` };
  if ((target.pages ?? []).length !== 1) return { refuse: `target step has ${(target.pages ?? []).length} pages; import adds a variation, so the step must have exactly one` };
  if (target.split === true) return { refuse: 'the target step runs a split test' };
  const src = (source?.steps ?? []).find((s) => s.id === sourceStepId);
  if (!src) return { refuse: `source step ${sourceStepId} is not on the source funnel` };
  const idx = Number(sourcePageIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= (src.pages ?? []).length) return { refuse: `sourcePageIndex must be 0..${(src.pages ?? []).length - 1} (the source step's pages)` };
  if (!userId) return { refuse: 'this credential carries no user id, and clone-funnel-step requires one' };
  const fid = funnel._id ?? funnel.id;
  return {
    method: 'POST', path: '/funnels/funnel/clone-funnel-step/',
    body: { stepId: sourceStepId, funnelId: fid, funnels: [fid], locationId, userId, stepIdToImportInto: stepId,
      pageIndexToImportInto: String(target.pages.length), pageIndexToImport: String(idx), funnelIdToImport: source._id ?? source.id },
    target: { step: stepView(target, 0), sourcePageId: src.pages[idx] },
  };
}

// Add an online store to a FUNNEL: the page builder's Store → Add to funnel → Import theme sends
// POST /funnels/store/create-in-funnel {funnelId, domainName, importTheme:true} → 5 store steps at DOMAIN-LEVEL generic
// paths. Those paths are held per domain, so any other document on the domain holding one of them makes a collision:
// every path is pre-checked. Measured side effect: the builder's next save of the checkout page (step1.enableBillingAddress)
// posts /leadgen-common/custom-field/billing-address, which CREATED a "Billing Info" contact-field folder + 7 billing
// address fields location-wide (a second call created no duplicate fields). This op itself never sends that call.
// create-in-funnel alone leaves the 5 pages EMPTY (0 sections; each path answered 200 with a blank page), so the op then
// fills each with its store element, as the builder's own saves do (sniffs/funnels-wave14-object-tools-2026-09-29).
export const STORE_PATHS = Object.freeze(['/store-product-list', '/store-product-detail', '/store-cart', '/store-checkout', '/store-thank-you',
  '/store-product-list-page', '/store-product-detail-page', '/store-cart-page', '/store-checkout-page', '/store-thank-you-page']);
export const BILLING_FIELDS_NOTE = 'LOCATION-WIDE side effect: when a checkout page with the billing address enabled is saved in the builder, GHL creates a "Billing Info" contact custom-field folder and 7 "Billing Address - …" contact fields on the location (measured; a second call created no duplicate fields; a duplicate folder could not be ruled out, folders are not listable). They are not removed with the store.';
export function planAddStore({ funnel, domainName, taken }) {
  if (funnel.type && funnel.type !== 'funnel') return { refuse: `add-store adds a store to a FUNNEL; this document is a ${funnel.type} (a website store is made with create_funnel kind store)` };
  if (funnel.isStoreActive === true) return { refuse: 'this funnel already has a store (isStoreActive)' };
  if (!domainName) return { refuse: 'the funnel has no domain; the store pages would get no public paths. Attach a domain first.' };
  if ((taken ?? []).length) return { refuse: `${taken.length} store path(s) are already held on ${domainName}: ${taken.join(', ')}. The store\'s paths are fixed and held per DOMAIN; what GHL does when they collide (suffix, fail or steal) is unmeasured, so nothing was sent. Free them or use a funnel on another domain.` };
  return { method: 'POST', path: '/funnels/store/create-in-funnel', body: { funnelId: funnel._id ?? funnel.id, domainName, importTheme: true },
    then: 'GHL creates the 5 pages EMPTY (a blank public page); each is then autosaved with its one store element (build_funnel_page compose). The builder\'s imported theme (header, colours, typography) is NOT applied.' };
}

// Checkout-type nodes whose billing address is on (extra.step1.value.enableBillingAddress) — the builder's own trigger
// (storeCustomFieldOptions, run on every page save) for the location-wide billing fields. This plugin's autosave does
// not send that call; a later builder save of the page does.
export const BILLING_ON_SAVE_NOTE = 'This page has a checkout with the billing address enabled. This tool\'s write does not touch contact fields, but the next save of this page IN THE BUILDER creates a "Billing Info" contact custom-field folder + 7 "Billing Address - …" contact fields on the location if they are not there (measured; a repeat created no duplicate fields).';
export function billingCheckouts(pageData) {
  const out = [];
  const walk = (nodes) => { for (const n of nodes ?? []) { if (n?.extra?.step1?.value?.enableBillingAddress) out.push({ id: n.id, meta: n.meta }); } };
  for (const s of pageData?.sections ?? []) walk(s.elements);
  return out;
}
