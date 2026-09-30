// create_funnel — the site/funnel CONTAINER, before build_funnel_page and edit_funnel can write into it.
//
// Every body is the one GHL's own "New …" screen sends, captured on the sandbox
// (knowledge sniffs/funnels-wave1-2026-09-26 live-object.{funnel-create,website,webinar,blog-site}.json,
// sniffs/funnels-wave10-e-plan-2026-09-28/live-object.store-blank-install.json):
//
//   funnel, website  POST /funnels/funnel/create {locationId, name, type}
//   store            POST /templates/template/load {templateId:<GHL blank store>, locationId, product:"stores", extras:{name}}
//   webinar          POST /templates/template/load {companyId, templateId:<GHL blank live | on-demand webinar>, locationId,
//                    product:"webinars", subProduct:"live"|"onDemand", parentId:"", extras:{name, webinarProperties}}
//                    (the wizard's last step is the Template library; there is no create-webinar call on that path — knowledge
//                    sniffs/funnels-wave39-f5c-webinars-2026-09-30: five blocked wizard saves)
//   blog             POST /blogs/site {locationId, title, description}
//
// "Quick start" (store) and "Blank Live" (webinar) ARE template installs in the UI — there is no
// create-store / create-webinar call on that path. The blank store's Contact Us page embeds a form id
// from GHL's template account, which does not exist on the location (measured: 401 on read while the
// location's own form reads 200) — so a store comes back with a dangling form reference to rebind.

const BLOG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const KINDS = Object.freeze(['funnel', 'website', 'store', 'webinar', 'blog']);
/** The kinds whose New screen files the document in the folder you are in (`parentId`), measured 2026-09-30: a funnel folder holds funnels, a website folder websites. */
export const FOLDER_KINDS = Object.freeze(['funnel', 'website']);

// GHL's own blank templates, as the New store / New webinar screens load them (captured 2026-09-28 / 2026-09-25).
export const BLANK_TEMPLATES = Object.freeze({ store: '6841a9953740196dc6e4031a', webinar: '684001d9bd9f6a3e0b118e89', webinarOnDemand: '683fff83bd9f6ac22b118e81' });

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
 * webinar: see planWebinar — live {timezone, date ("YYYY-MM-DD", or an ISO date-time whose offset agrees), startTime "HH:mm", endTime "HH:mm",
 * formId, videoUrl (the live link), recurring?} or on-demand {type:'onDemand', formId, timezone?} + the resolved media file `video` — the wizard's own fields; the wizard stores the START as endDate/endTime and the END as webinarEndTime.
 * endDate is sent as the start converted from `timezone` to UTC. GHL's own one-off wizard sends the BROWSER's offset
 * instead, so the session runs at the saver's local time (knowledge funnels rule 47); this tool does not copy that.
 */
export function planCreateFunnel({ kind, name, locationId, companyId, description, webinar, formName, video, now, folderId, blog }) {
  if (!KINDS.includes(kind)) return { refuse: `kind must be one of ${KINDS.join(', ')}` };
  if (typeof name !== 'string' || !name.trim()) return { refuse: 'name is required' };
  if (blog !== undefined && kind !== 'blog') return { refuse: 'blog {urlSlug, domain} belongs to kind blog only' };
  if (folderId !== undefined && !FOLDER_KINDS.includes(kind)) return { refuse: `folderId files a ${FOLDER_KINDS.join(' or ')} in a folder; for a ${kind} the folder scoping of its list was not measured, so it is not offered — create it and move it on the Sites screen` };
  if (folderId !== undefined && (typeof folderId !== 'string' || !folderId.trim())) return { refuse: 'folderId is a folder id (find_ghl_site list:true folders:true)' };
  const n = name.trim();
  switch (kind) {
    case 'funnel':
    case 'website':
      return { method: 'POST', path: '/funnels/funnel/create', body: { locationId, name: n, type: kind, ...(folderId ? { parentId: folderId } : {}) } };
    case 'blog':
    { // the Create blog screen sends {locationId, title, urlSlug, domain: <domain id>, description}; without a domain and slug those two keys are absent (measured 2026-09-30)
      if (blog?.urlSlug !== undefined && !BLOG_SLUG.test(String(blog.urlSlug))) return { refuse: 'blog.urlSlug is lower-case letters, digits and single dashes (e.g. my-blog)' };
      if ((blog?.urlSlug === undefined) !== (blog?.domainId === undefined) && blog) return { refuse: 'blog.domain and blog.urlSlug go together: the blog is served at <domain>/<slug>' };
      return { method: 'POST', path: '/blogs/site', body: { locationId, title: n, ...(blog?.urlSlug ? { urlSlug: blog.urlSlug, domain: blog.domainId } : {}), description: description ?? '' } };
    }
    case 'store':
      return { method: 'POST', path: '/templates/template/load', body: { templateId: BLANK_TEMPLATES.store, locationId, product: 'stores', extras: { name: n } } };
    case 'webinar': return planWebinar({ name: n, locationId, companyId, webinar: webinar ?? {}, formName, video, now });
    default: return { refuse: `unknown kind ${kind}` };
  }
}

// ── the webinar wizard's body (live, live + recurring, on-demand) ──────────────────────────────────────────────────
const RECURRENCE = Object.freeze(['DAILY', 'WEEKLY', 'MONTHLY']);
const WEEKDAYS = Object.freeze(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']);
/** A daily webinar's series stops at 50 sessions (the wizard's max-end-date helper answered 17 Nov for a 29 Sep start; wave18). */
export const MAX_OCCURRENCES = 50;
const isHttpUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

/**
 * The `recurringSettings` the wizard sends (captured wave39: DAILY/after, WEEKLY/by-date, MONTHLY day, MONTHLY custom).
 * Always the four list keys; `occurrences` XOR `endDate` (the screen deletes the other; endDate is that day at the start time, in UTC);
 * `repeat` is forced to 1 for DAILY; MONTHLY adds monthlyOccurenceType 'day' | 'custom'. NO_FIXED_TIME is not offered (never measured).
 */
export function planRecurrence(rec, { timezone, day, startTime }) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { refuse: 'webinar.recurring is {frequency: DAILY|WEEKLY|MONTHLY, repeat?, occurrences | endDate, weeklyDays | monthlyDay | monthlyWeek+monthlyWeekDay}' };
  const f = String(rec.frequency ?? '').toUpperCase();
  if (f === 'NO_FIXED_TIME') return { refuse: 'webinar.recurring NO_FIXED_TIME is not offered: its stored shape was never measured. Create a DAILY / WEEKLY / MONTHLY series, or set "No fixed time" on the Edit webinar screen' };
  if (!RECURRENCE.includes(f)) return { refuse: `webinar.recurring.frequency must be one of ${RECURRENCE.join(', ')}` };
  const repeat = f === 'DAILY' ? 1 : (rec.repeat ?? 1);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 12) return { refuse: 'webinar.recurring.repeat is a whole number of weeks / months, 1 to 12 (a daily series always repeats every day)' };
  if (rec.occurrences !== undefined && rec.endDate !== undefined) return { refuse: 'name the end of the series ONE way: webinar.recurring.occurrences (After) or webinar.recurring.endDate (By), not both' };
  const out = { frequency: f, repeat };
  if (rec.endDate !== undefined) {
    if (!DAY.test(rec.endDate)) return { refuse: 'webinar.recurring.endDate is the last day of the series, "YYYY-MM-DD"' };
    if (rec.endDate < day) return { refuse: `webinar.recurring.endDate ${rec.endDate} is before the first session (${day})` };
    const ms = zonedToUtc(rec.endDate, startTime, timezone);
    if (ms === null) return { refuse: `${rec.endDate} ${startTime} does not exist in ${timezone} (a daylight-saving gap); pick another end day` };
    out.endDate = new Date(ms).toISOString().replace('.000Z', 'Z');
  } else {
    const occ = rec.occurrences ?? 7; // the wizard's default
    if (!Number.isInteger(occ) || occ < 1 || occ > MAX_OCCURRENCES) return { refuse: `webinar.recurring.occurrences is a whole number, 1 to ${MAX_OCCURRENCES}` };
    out.occurrences = occ;
  }
  Object.assign(out, { weeklyDays: [], monthlyDays: [], monthlyOccurenceWeeks: [], monthlyOccurenceWeekDays: [] });
  if (f === 'WEEKLY') {
    const d = rec.weeklyDays;
    if (!Array.isArray(d) || !d.length || d.some((x) => !WEEKDAYS.includes(x)) || new Set(d).size !== d.length) return { refuse: `webinar.recurring.weeklyDays is one or more of ${WEEKDAYS.join(', ')} (no repeats)` };
    out.weeklyDays = d;
  } else if (f === 'MONTHLY') {
    const custom = rec.monthlyWeek !== undefined || rec.monthlyWeekDay !== undefined;
    if (custom && rec.monthlyDay !== undefined) return { refuse: 'MONTHLY is a day of the month (monthlyDay) OR a weekday of a week (monthlyWeek + monthlyWeekDay), not both' };
    if (custom) {
      if (!Number.isInteger(rec.monthlyWeek) || rec.monthlyWeek < 1 || rec.monthlyWeek > 4 || !WEEKDAYS.includes(rec.monthlyWeekDay)) return { refuse: `webinar.recurring.monthlyWeek is 1 to 4 (First to Fourth) and monthlyWeekDay one of ${WEEKDAYS.join(', ')} ("Last" was never measured)` };
      Object.assign(out, { monthlyOccurenceWeeks: [rec.monthlyWeek], monthlyOccurenceWeekDays: [rec.monthlyWeekDay], monthlyOccurenceType: 'custom' });
    } else {
      const md = rec.monthlyDay ?? 1;
      if (!Number.isInteger(md) || md < 1 || md > 31) return { refuse: 'webinar.recurring.monthlyDay is the day of the month, 1 to 31' };
      Object.assign(out, { monthlyDays: [md], monthlyOccurenceType: 'day' });
    }
  } else if (rec.weeklyDays !== undefined || rec.monthlyDay !== undefined || rec.monthlyWeek !== undefined) return { refuse: 'weeklyDays / monthlyDay / monthlyWeek do not apply to a DAILY series' };
  return { settings: out };
}

/**
 * planCreateFunnel's webinar case. Bodies captured from the New webinar wizard with the save blocked (wave39):
 *  live       {timezone, endDate: start in UTC, endTime, webinarEndTime, recurring, recurringSettings, webinarType:'live', formId, formName, videoUrl: the live link, videoName:'', videoId:'', templateName:1}
 *  on-demand  {timezone, endDate:'', endTime:'', webinarEndTime:'', recurring:false, recurringSettings:{}, webinarType:'demand', formId, formName, videoUrl/videoName/videoId of a Media Storage file, templateName:1}
 * No `notifications`: a new webinar has NO email set up (notifications: [] until the Edit webinar screen enables a row with a template).
 */
export function planWebinar({ name, locationId, companyId, webinar: w, formName, video, now = Date.now() }) {
  const type = w.type ?? 'live';
  if (!['live', 'onDemand'].includes(type)) return { refuse: 'webinar.type is "live" or "onDemand"' };
  if (!w.formId) return { refuse: 'a webinar needs webinar.formId — the New webinar wizard requires a registration form (one of this location\'s forms)' };
  if (!companyId) return { refuse: 'this credential carries no company id, and the webinar template load sends one' };
  const timezone = w.timezone ?? (type === 'onDemand' ? 'America/New_York' : undefined);
  if (type === 'onDemand') {
    const stray = ['date', 'startTime', 'endTime', 'recurring', 'videoUrl'].filter((k) => w[k] !== undefined);
    if (stray.length) return { refuse: `an on-demand webinar has no schedule or live link: drop webinar.{${stray.join(', ')}} (the recording is webinar.video, a Media Storage file)` };
    if (!w.video) return { refuse: 'an on-demand webinar needs webinar.video — a video file in this location\'s Media Storage (its id, or its exact name)' };
    if (!video?.url) return { refuse: `webinar.video ${JSON.stringify(w.video)} was not resolved to a Media Storage video` };
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { return { refuse: `webinar.timezone ${JSON.stringify(timezone)} is not an IANA timezone (e.g. America/New_York)` }; }
    return {
      method: 'POST', path: '/templates/template/load',
      body: {
        companyId, templateId: BLANK_TEMPLATES.webinarOnDemand, locationId, product: 'webinars', subProduct: 'onDemand', parentId: '',
        extras: { name, webinarProperties: {
          timezone, endDate: '', endTime: '', webinarEndTime: '', recurring: false, recurringSettings: {}, webinarType: 'demand',
          formId: w.formId, formName: formName ?? '', videoUrl: video.url, videoName: video.name ?? '', videoId: video.id ?? '', templateName: 1,
        } },
      },
    };
  }
  const missing = ['timezone', 'date', 'startTime', 'endTime', 'videoUrl'].filter((k) => !w[k]);
  if (missing.length) return { refuse: `a live webinar needs webinar.{${missing.join(', ')}} — the New webinar wizard requires them (videoUrl is the live link)` };
  if (w.video !== undefined) return { refuse: 'webinar.video is the on-demand recording; a live webinar takes its live link as webinar.videoUrl' };
  if (!HHMM.test(w.startTime) || !HHMM.test(w.endTime)) return { refuse: 'webinar.startTime and webinar.endTime are "HH:mm" (24h)' };
  if (w.endTime <= w.startTime) return { refuse: `webinar.endTime ${w.endTime} must be after startTime ${w.startTime} on the same day` };
  if (!isHttpUrl(w.videoUrl)) return { refuse: 'webinar.videoUrl is the live webinar link, an http(s) URL' };
  const start = webinarStartUtc(w);
  if (start.refuse) return { refuse: start.refuse };
  if (Date.parse(start.utc) <= now) return { refuse: `the webinar starts ${start.utc}, which is not in the future — the wizard's date picker does not offer past days` };
  let recurringSettings = {}; let recurring = false; let series = null;
  if (w.recurring !== undefined) {
    const r = planRecurrence(w.recurring, { timezone: w.timezone, day: start.day, startTime: w.startTime });
    if (r.refuse) return { refuse: r.refuse };
    recurring = true; recurringSettings = r.settings; series = { frequency: r.settings.frequency, occurrences: r.settings.occurrences ?? null, endDate: r.settings.endDate ?? null };
  }
  return {
    method: 'POST', path: '/templates/template/load', sessionStart: start.utc, ...(series ? { series } : {}),
    body: {
      companyId, templateId: BLANK_TEMPLATES.webinar, locationId, product: 'webinars', subProduct: 'live', parentId: '',
      extras: { name, webinarProperties: {
        timezone: w.timezone, endDate: start.utc, endTime: w.startTime, webinarEndTime: w.endTime,
        recurring, recurringSettings, webinarType: 'live', formId: w.formId, formName: formName ?? '',
        videoUrl: w.videoUrl, videoName: '', videoId: '', templateName: 1,
      } },
    },
  };
}

/** The blank store's steps as measured (Products List, Product details, Cart, Checkout, Thank you!, Contact Us, Home): fewer read back = a partial install. */
export const STORE_BLANK_STEP_COUNT = 7;

/**
 * What a template load says about itself. The UI (funnels bundle, the New store screen) treats only `data.status === 'completed'` as success
 * and shows `data.err` for `processing` / `partial-completed`; the template library also knows `error`. A 201 alone is not an install.
 * {status, complete, err}; a response with no status at all is not complete either.
 */
export function templateLoadOutcome(json) {
  const status = json?.data?.status ?? null;
  return { status, complete: status === 'completed', err: json?.data?.err ?? json?.err ?? null };
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

/**
 * The folders of one kind's tab: the list with `category=all` also returns the folders, as rows with `category: 'folder'` and the tab's `type`
 * (a Funnels-tab folder is type funnel and a Websites-tab folder type website; the two tabs do not share folders — measured 2026-09-30).
 * Each row: {id, name, type}. `rows: null` when the list could not be read.
 */
export async function listFolders(gw, locationId, type, { pageSize = 100, maxPages = 50 } = {}) {
  const byId = new Map();
  for (let offset = 0, i = 0; i < maxPages; i++) {
    const r = await gw.call('GET', `/funnels/funnel/list?locationId=${encodeURIComponent(locationId)}&type=${encodeURIComponent(type)}&category=all&limit=${pageSize}&offset=${offset}`);
    if (!r.ok) return { res: r, rows: null };
    const page = r.json?.funnels ?? r.json?.data ?? [];
    for (const f of page) if (f.category === 'folder' && f.type === type) byId.set(f._id ?? f.id, { id: f._id ?? f.id, name: f.name, type: f.type });
    offset += page.length;
    const total = r.json?.count;
    if (!page.length || page.length < pageSize || (total != null && offset >= total)) return { res: r, rows: [...byId.values()] };
  }
  return { res: null, rows: [...byId.values()], truncated: true };
}

/** The video files in a location's Media Storage that match `ref` (an id or an exact name) — the wizard's Browse → Media Storage read. limit is 20 (this list's cap is unmeasured above it). */
export async function findMediaVideo(gw, locationId, ref, { pageSize = 20, maxPages = 50 } = {}) {
  const hits = [];
  for (let offset = 0, i = 0; i < maxPages; i++) {
    const r = await gw.call('GET', `/medias/files?altId=${encodeURIComponent(locationId)}&altType=location&type=file&limit=${pageSize}&offset=${offset}&sortBy=createdAt&sortOrder=desc`);
    if (!r.ok) return { res: r, hits: null };
    const files = r.json?.files ?? [];
    for (const f of files) if (!f.deleted && String(f.contentType ?? '').startsWith('video/') && (f._id === ref || f.name === ref)) hits.push({ id: f._id, url: f.url, name: f.name });
    if (files.length < pageSize) break;
    offset += files.length;
  }
  return { hits };
}

// ── get_funnel view "webinar": the Edit webinar screen's data as one read ──────────────────────────────────────────────

/** GHL's own "Recipe - Webinar Registration Confirmation & Reminders" workflow template — the id the Edit webinar screen's "Webinar recipe" button deep-links to (funnelWebsiteApp, WEBINAR_WORKFLOW_RECIPE_ID). */
export const WEBINAR_RECIPE_TEMPLATE_ID = '5c1dabb4-d31d-46dd-b455-fdcf719560b3';

/** The webinar document + its sessions as the Edit webinar screen shows them. Pure. `sessions` is the raw webinarSessions array. */
export function webinarView(funnel, sessions, locationId, now = Date.now()) {
  const wp = funnel.webinarProperties ?? {};
  const rs = wp.recurringSettings ?? {};
  const rows = Array.isArray(wp.notifications) ? wp.notifications : [];
  const list = (sessions ?? []).map((x) => ({ start: x.sessionStart, end: x.sessionEnd, timezone: x.timezone })).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const onDemand = wp.webinarType === 'demand';
  const base = 'https://app.gohighlevel.com/v2/location';
  return {
    type: onDemand ? 'onDemand' : (wp.webinarType ?? null),
    timezone: wp.timezone ?? null,
    stored: { endDate: wp.endDate ?? null, endTime: wp.endTime ?? null, webinarEndTime: wp.webinarEndTime ?? null },
    recurring: wp.recurring === true ? {
      frequency: rs.frequency ?? null, repeat: rs.repeat ?? null, occurrences: rs.occurrences ?? null, endDate: rs.endDate ?? null, weeklyDays: rs.weeklyDays ?? [],
      monthlyDays: rs.monthlyDays ?? [], monthlyOccurenceType: rs.monthlyOccurenceType ?? null, monthlyOccurenceWeeks: rs.monthlyOccurenceWeeks ?? [], monthlyOccurenceWeekDays: rs.monthlyOccurenceWeekDays ?? [], rrule: rs.rrule ?? null,
    } : null,
    form: { id: wp.formId ?? null, name: wp.formName ?? null },
    ...(onDemand ? { video: { url: wp.videoUrl ?? null, name: wp.videoName ?? null, id: wp.videoId ?? null } } : { liveUrl: wp.videoUrl ?? null }),
    sessions: { count: list.length, next: list.find((x) => Date.parse(x.start) > now) ?? null, all: list },
    notifications: { sender: { name: wp.senderName ?? null, email: wp.senderEmailAddress ?? null }, templateFolderId: wp.templateFolderId ?? null,
      rows: rows.map((r) => ({ type: r.type, action: r.action, enabled: r.enabled === true, offset: r.offset ?? null, templateId: r.templateId ?? null })) },
    links: {
      edit: 'Sites → Webinars → ⋮ → Edit (schedule, recurrence, live link, notifications are saved there)',
      guests: wp.formId ? `${base}/${locationId}/form-builder/submissions?id=${wp.formId}&page=1&limit=25` : null,
      workflowRecipe: { templateId: WEBINAR_RECIPE_TEMPLATE_ID, title: 'Recipe - Webinar Registration Confirmation & Reminders', url: `${base}/${locationId}/automation/new-workflow?highlightedCardId=${WEBINAR_RECIPE_TEMPLATE_ID}`,
        note: 'The Edit webinar screen\'s "Webinar recipe" button opens this URL in a new tab; GHL redirects it to the Workflows list with the recipe id kept in the query. The recipe is a workflow TEMPLATE (list_workflow_templates lists it), not a workflow on this account: nothing is installed until you create one from it, and a published copy emails registrants.' },
    },
    note: 'endDate + endTime store the FIRST SESSION\'s START (webinarEndTime is its end); the sessions list is what GHL runs. A one-off webinar saved from the Edit screen carries the browser\'s UTC offset in endDate, not the webinar timezone (rule 47).',
  };
}

/**
 * What a recurring series does that its owner would not guess (measured live 2026-09-30, wave39):
 *  - GHL stores the series as an rrule with a UTC DTSTART, so every session keeps the UTC time of the first: a series that crosses a daylight-saving change
 *    runs an hour off the local time you asked for from that day on (DAILY/WEEKLY/MONTHLY alike);
 *  - the first session is the first day matching the rule ON OR AFTER the start day: a MONTHLY "first Monday" or "day 1" series that starts on the 14th
 *    begins the next month, and a WEEKLY series that does not list the start day's weekday skips it.
 * `sessions` is [{start}] sorted; `startUtc` the start the tool sent. Returns [] when there is nothing to warn about.
 */
export function sessionWarnings(sessions, { timezone, startTime, startUtc }) {
  const out = [];
  if (!sessions.length) return out;
  const first = Date.parse(sessions[0].start);
  if (first > Date.parse(startUtc)) out.push(`The first session is ${sessions[0].start}, not the start date you gave (${startUtc}): a series starts at the first day matching its rule on or after the start day.`);
  const drift = sessions.filter((x) => wallParts(Date.parse(x.start), timezone).hhmm !== startTime);
  if (drift.length) out.push(`${drift.length} of ${sessions.length} sessions run at ${wallParts(Date.parse(drift[0].start), timezone).hhmm} ${timezone}, not ${startTime}: GHL keeps the first session's UTC time, so the series drifts an hour across a daylight-saving change (first drifted session ${drift[0].start}). Split the series at the clock change to keep the local time.`);
  return out;
}
