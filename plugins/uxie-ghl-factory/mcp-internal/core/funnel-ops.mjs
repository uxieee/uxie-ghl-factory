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

// The UI's own update-settings body, from a fresh read, with the caller's overrides applied.
export function settingsBody(locationId, funnel, overrides = {}) {
  return {
    locationId, funnelId: funnel._id ?? funnel.id,
    funnelPath: funnel.url, funnelName: funnel.name, domainId: funnel.domainId ?? '',
    faviconUrl: funnel.faviconUrl ?? '', headTrackingCode: funnel.trackingCodeHead ?? '', bodyTrackingCode: funnel.trackingCodeBody ?? '',
    allowPaymentModeOption: true, paymentMode: funnel.isLivePaymentMode ?? true, chatWidgetId: funnel.chatWidgetId ?? '',
    imageOptimization: funnel.imageOptimization ?? true, isGdprCompliant: funnel.isGdprCompliant ?? false,
    isOptimisePageLoad: funnel.isOptimisePageLoad ?? true, stopAllSplitTestsAndReset: null,
    requireCreditCard: funnel.requireCreditCard ?? true, storeCurrencyFormatting: funnel.storeCurrencyFormatting ?? false,
    autoGenerateSchema: funnel.autoGenerateSchema ?? true,
    ...overrides,
  };
}

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

export function planReorder({ funnel, order }) {
  const steps = funnel.steps ?? [];
  const ids = steps.map((s) => s.id);
  const same = order.length === ids.length && new Set(order).size === order.length && order.every((id) => ids.includes(id));
  if (!same) {
    return { refuse: `order must name EVERY step exactly once (${ids.length} on this funnel). The route replaces the whole steps array; a subset would drop steps.` };
  }
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  return {
    method: 'PATCH', path: `/funnels/funnel/update/${enc(funnel._id ?? funnel.id)}`,
    body: { steps: order.map((id, i) => {
      const s = byId[id];
      return { controlTraffic: s.control_traffic ?? s.controlTraffic ?? 100, id: s.id, name: s.name, pages: s.pages ?? [], sequence: i + 1, split: s.split === true, type: s.type, url: s.url };
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
