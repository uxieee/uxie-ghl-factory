// create_funnel — the site/funnel CONTAINER, before build_funnel_page and edit_funnel can write into it.
//
// Every body is the one GHL's own "New …" screen sends, captured on the sandbox
// (knowledge sniffs/funnels-wave1-2026-09-26 live-object.{funnel-create,website,webinar,blog-site}.json,
// sniffs/funnels-wave10-e-plan-2026-09-28/live-object.store-blank-install.json):
//
//   funnel, website  POST /funnels/funnel/create {locationId, name, type}
//   store            POST /templates/template/load {templateId:<GHL blank store>, locationId, product:"stores", extras:{name}}
//   webinar          POST /templates/template/load {companyId, templateId:<GHL blank live webinar>, locationId,
//                    product:"webinars", subProduct:"live", parentId:"", extras:{name, webinarProperties}}
//   blog             POST /blogs/site {locationId, title, description}
//
// "Quick start" (store) and "Blank Live" (webinar) ARE template installs in the UI — there is no
// create-store / create-webinar call on that path. The blank store's Contact Us page embeds a form id
// from GHL's template account, which does not exist on the location (measured: 401 on read while the
// location's own form reads 200) — so a store comes back with a dangling form reference to rebind.

export const KINDS = Object.freeze(['funnel', 'website', 'store', 'webinar', 'blog']);

// GHL's own blank templates, as the New store / New webinar screens load them (captured 2026-09-28 / 2026-09-25).
export const BLANK_TEMPLATES = Object.freeze({ store: '6841a9953740196dc6e4031a', webinar: '684001d9bd9f6a3e0b118e89' });

// ── webinar start: a wall-clock day + time in a named timezone → the UTC instant ─────────────────────────────
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;

/** The wall-clock parts of instant `ms` in `timeZone` (Intl; no dependency). */
function wallParts(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}` };
}

/** UTC ms of wall time `day` `hhmm` in `timeZone`, or null when that wall time does not exist there (a DST gap). */
export function zonedToUtc(day, hhmm, timeZone) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms) => { const w = wallParts(ms, timeZone); const [wy, wmo, wd] = w.day.split('-').map(Number); const [wh, wmi] = w.hhmm.split(':').map(Number); return Date.UTC(wy, wmo - 1, wd, wh, wmi) - ms; };
  let ms = asUtc - offsetAt(asUtc);
  ms = asUtc - offsetAt(ms); // second pass settles a DST edge
  const back = wallParts(ms, timeZone);
  return back.day === day && back.hhmm === hhmm ? ms : null;
}

/** The session start GHL must store as endDate: `date`'s calendar day at `startTime` in `timezone`, in UTC. */
export function webinarStartUtc({ timezone, date, startTime }) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { return { refuse: `webinar.timezone ${JSON.stringify(timezone)} is not an IANA timezone (e.g. America/New_York)` }; }
  let day;
  if (DAY.test(date)) day = date;
  else if (INSTANT.test(date)) {
    const ms = Date.parse(date);
    if (Number.isNaN(ms)) return { refuse: `webinar.date ${JSON.stringify(date)} is not a valid date-time` };
    const wall = wallParts(ms, timezone);
    if (wall.hhmm !== startTime) {
      return { refuse: `webinar.date ${date} is ${wall.day} ${wall.hhmm} in ${timezone}, not the startTime ${startTime}: its offset disagrees with the webinar timezone. Pass the calendar day alone (e.g. "${date.slice(0, 10)}") and the tool converts ${startTime} ${timezone} to UTC.` };
    }
    day = wall.day;
  } else return { refuse: 'webinar.date is the calendar day of the session, "YYYY-MM-DD" (an ISO date-time is accepted only when its offset agrees with webinar.timezone)' };
  const ms = zonedToUtc(day, startTime, timezone);
  if (ms === null) return { refuse: `${day} ${startTime} does not exist in ${timezone} (a daylight-saving gap); pick another start time` };
  return { utc: new Date(ms).toISOString().replace('.000Z', 'Z'), day };
}

export const STORE_DANGLING_FORM_NOTE = 'The blank store\'s "Contact Us" page embeds a form that lives in GHL\'s template account, not on this location: it renders no working form until you bind one of yours (build_funnel_page edit mode, set the form element\'s formId). audit_site reports it as a dangling reference.';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The request create_funnel sends for one kind. Pure, so the preview IS the request.
 * webinar: {timezone, date ("YYYY-MM-DD", or an ISO date-time whose offset agrees), startTime "HH:mm", endTime "HH:mm",
 * formId, videoUrl} — the wizard's own fields; the wizard stores the START as endDate/endTime and the END as webinarEndTime.
 * endDate is sent as the start converted from `timezone` to UTC. GHL's own one-off wizard sends the BROWSER's offset
 * instead, so the session runs at the saver's local time (knowledge funnels rule 47); this tool does not copy that.
 */
export function planCreateFunnel({ kind, name, locationId, companyId, description, webinar, formName }) {
  if (!KINDS.includes(kind)) return { refuse: `kind must be one of ${KINDS.join(', ')}` };
  if (typeof name !== 'string' || !name.trim()) return { refuse: 'name is required' };
  const n = name.trim();
  switch (kind) {
    case 'funnel':
    case 'website':
      return { method: 'POST', path: '/funnels/funnel/create', body: { locationId, name: n, type: kind } };
    case 'blog':
      return { method: 'POST', path: '/blogs/site', body: { locationId, title: n, description: description ?? '' } };
    case 'store':
      return { method: 'POST', path: '/templates/template/load', body: { templateId: BLANK_TEMPLATES.store, locationId, product: 'stores', extras: { name: n } } };
    case 'webinar': {
      const w = webinar ?? {};
      const missing = ['timezone', 'date', 'startTime', 'endTime', 'formId'].filter((k) => !w[k]);
      if (missing.length) return { refuse: `a webinar needs webinar.{${missing.join(', ')}} — the New webinar wizard requires them (the registration form must be one of this location's forms)` };
      if (!HHMM.test(w.startTime) || !HHMM.test(w.endTime)) return { refuse: 'webinar.startTime and webinar.endTime are "HH:mm" (24h)' };
      const start = webinarStartUtc(w);
      if (start.refuse) return { refuse: start.refuse };
      if (!companyId) return { refuse: 'this credential carries no company id, and the webinar template load sends one' };
      return {
        method: 'POST', path: '/templates/template/load', sessionStart: start.utc,
        body: {
          companyId, templateId: BLANK_TEMPLATES.webinar, locationId, product: 'webinars', subProduct: 'live', parentId: '',
          extras: { name: n, webinarProperties: {
            timezone: w.timezone, endDate: start.utc, endTime: w.startTime, webinarEndTime: w.endTime,
            recurring: false, recurringSettings: {}, webinarType: 'live', formId: w.formId, formName: formName ?? '',
            videoUrl: w.videoUrl ?? '', videoName: '', videoId: '', templateName: 1,
          } },
        },
      };
    }
    default: return { refuse: `unknown kind ${kind}` };
  }
}

/** The new document's id from the create response, per route. null when the route does not echo one (blog). */
export function createdId(kind, json) {
  if (kind === 'funnel' || kind === 'website') return json?.id ?? null;
  if (kind === 'store' || kind === 'webinar') return json?.data?.target?.assetId ?? null;
  return json?.id ?? json?._id ?? json?.data?._id ?? json?.data?.id ?? null;
}

/** The fetch read-back type each kind must show. A store is a website document with isStoreActive. */
export const EXPECT_TYPE = Object.freeze({ funnel: 'funnel', website: 'website', store: 'website', webinar: 'webinar', blog: 'blog' });

/** Every document on the location (untyped list: funnels, websites, stores, webinars and blogs), walked to `count`. */
export async function listAllDocuments(gw, locationId, { pageSize = 100, maxPages = 50 } = {}) {
  const byId = new Map();
  let count = null;
  for (let offset = 0, i = 0; i < maxPages; i++) {
    const r = await gw.call('GET', `/funnels/funnel/list?locationId=${encodeURIComponent(locationId)}&limit=${pageSize}&offset=${offset}`);
    if (!r.ok) return { res: r, rows: null };
    const page = r.json?.funnels ?? r.json?.data ?? [];
    count = r.json?.count ?? count;
    const before = byId.size;
    for (const f of page) byId.set(f._id ?? f.id, f);
    offset += page.length;
    // Stop on an empty or short page, on reaching `count`, or on a page that added nothing new (a server that
    // ignores offset would otherwise be walked to maxPages).
    if (!page.length || page.length < pageSize || (count != null && byId.size >= count) || byId.size === before) return { res: r, rows: [...byId.values()], count: count ?? byId.size, pages: i + 1 };
  }
  return { res: null, rows: [...byId.values()], count: count ?? byId.size, truncated: true };
}
