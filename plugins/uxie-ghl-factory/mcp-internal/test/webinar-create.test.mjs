// create_funnel webinar: live, live + recurring, on-demand — the bodies the New webinar wizard sends (knowledge
// sniffs/funnels-wave39-f5c-webinars-2026-09-30: five saves captured with the save blocked), plus get_funnel view "webinar".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCreateFunnel, planWebinar, planRecurrence, BLANK_TEMPLATES, webinarView, WEBINAR_RECIPE_TEMPLATE_ID, findMediaVideo, sessionWarnings } from '../core/funnel-create.mjs';

const NOW = Date.parse('2026-09-30T00:00:00Z');
const live = { timezone: 'America/New_York', date: '2026-10-14', startTime: '09:00', endTime: '09:05', formId: 'FORM1', videoUrl: 'https://example.com/live' };
const plan = (webinar, extra = {}) => planCreateFunnel({ kind: 'webinar', name: 'W', locationId: 'L', companyId: 'C', formName: 'Reg', webinar, now: NOW, ...extra });
const props = (p) => p.body.extras.webinarProperties;

test('live webinar = the wizard\'s body (one-off)', () => {
  const p = plan(live);
  assert.equal(p.body.templateId, BLANK_TEMPLATES.webinar);
  assert.equal(p.body.subProduct, 'live');
  assert.deepEqual(props(p), { timezone: 'America/New_York', endDate: '2026-10-14T13:00:00Z', endTime: '09:00', webinarEndTime: '09:05', recurring: false, recurringSettings: {}, webinarType: 'live',
    formId: 'FORM1', formName: 'Reg', videoUrl: 'https://example.com/live', videoName: '', videoId: '', templateName: 1 });
  assert.equal('notifications' in props(p), false, 'the wizard sends no notifications: a new webinar emails nobody');
});

test('live + recurring: DAILY after, WEEKLY by date, MONTHLY day, MONTHLY custom — each the captured recurringSettings', () => {
  const rs = (recurring) => props(plan({ ...live, recurring })).recurringSettings;
  const lists = { weeklyDays: [], monthlyDays: [], monthlyOccurenceWeeks: [], monthlyOccurenceWeekDays: [] };
  assert.deepEqual(rs({ frequency: 'DAILY', occurrences: 7 }), { frequency: 'DAILY', repeat: 1, occurrences: 7, ...lists });
  assert.deepEqual(rs({ frequency: 'DAILY', repeat: 5 }).repeat, 1, 'DAILY is forced to repeat 1');
  assert.deepEqual(rs({ frequency: 'WEEKLY', weeklyDays: ['MO', 'WE'], endDate: '2026-11-11' }), { frequency: 'WEEKLY', repeat: 1, endDate: '2026-11-11T14:00:00Z', ...lists, weeklyDays: ['MO', 'WE'] },
    'By: the last day at the START time in the webinar timezone, in UTC (EST in November)');
  assert.deepEqual(rs({ frequency: 'MONTHLY', occurrences: 7 }), { frequency: 'MONTHLY', repeat: 1, occurrences: 7, ...lists, monthlyDays: [1], monthlyOccurenceType: 'day' });
  assert.deepEqual(rs({ frequency: 'MONTHLY', occurrences: 7, monthlyWeek: 1, monthlyWeekDay: 'MO' }), { frequency: 'MONTHLY', repeat: 1, occurrences: 7, ...lists, monthlyOccurenceWeeks: [1], monthlyOccurenceWeekDays: ['MO'], monthlyOccurenceType: 'custom' });
  assert.equal(props(plan({ ...live, recurring: { frequency: 'DAILY' } })).recurring, true);
  assert.equal(plan({ ...live, recurring: { frequency: 'DAILY', occurrences: 3 } }).series.occurrences, 3);
});

test('recurrence refusals: never a guess', () => {
  const r = (rec) => planRecurrence(rec, { timezone: 'America/New_York', day: '2026-10-14', startTime: '09:00' }).refuse;
  assert.match(r({ frequency: 'NO_FIXED_TIME' }), /not offered/);
  assert.match(r({ frequency: 'YEARLY' }), /DAILY, WEEKLY, MONTHLY/);
  assert.match(r({ frequency: 'DAILY', occurrences: 3, endDate: '2026-11-01' }), /ONE way/);
  assert.match(r({ frequency: 'DAILY', occurrences: 51 }), /1 to 50/);
  assert.match(r({ frequency: 'DAILY', endDate: '2026-10-01' }), /before the first session/);
  assert.match(r({ frequency: 'WEEKLY' }), /weeklyDays/);
  assert.match(r({ frequency: 'WEEKLY', weeklyDays: ['MO', 'MO'] }), /no repeats/);
  assert.match(r({ frequency: 'MONTHLY', monthlyDay: 3, monthlyWeek: 1, monthlyWeekDay: 'MO' }), /not both/);
  assert.match(r({ frequency: 'MONTHLY', monthlyWeek: 5, monthlyWeekDay: 'MO' }), /1 to 4/);
  assert.match(r({ frequency: 'DAILY', weeklyDays: ['MO'] }), /do not apply/);
  assert.match(r('daily'), /webinar\.recurring is/);
});

test('live webinar refusals: the wizard\'s rules, which the tool used to skip', () => {
  const refuse = (w, extra) => plan(w, extra).refuse;
  assert.match(refuse({ ...live, videoUrl: undefined }), /videoUrl/);
  assert.match(refuse({ ...live, videoUrl: 'not a url' }), /http\(s\)/);
  assert.match(refuse({ ...live, endTime: '09:00' }), /after startTime/);
  assert.match(refuse({ ...live, date: '2026-09-01' }), /not in the future/);
  assert.match(refuse({ ...live, video: 'x' }), /on-demand recording/);
  assert.match(refuse({ ...live, type: 'hybrid' }), /live" or "onDemand/);
  assert.match(planWebinar({ name: 'W', locationId: 'L', companyId: '', webinar: live, now: NOW }).refuse, /company id/);
});

test('on-demand webinar = the wizard\'s body: no schedule, a Media Storage video, the on-demand blank template', () => {
  const video = { id: 'V1', url: 'https://cdn.example/media/V1.mp4', name: 'rec.mp4' };
  const p = plan({ type: 'onDemand', formId: 'FORM1', video: 'rec.mp4' }, { video });
  assert.equal(p.body.templateId, BLANK_TEMPLATES.webinarOnDemand);
  assert.equal(p.body.subProduct, 'onDemand');
  assert.deepEqual(props(p), { timezone: 'America/New_York', endDate: '', endTime: '', webinarEndTime: '', recurring: false, recurringSettings: {}, webinarType: 'demand',
    formId: 'FORM1', formName: 'Reg', videoUrl: video.url, videoName: 'rec.mp4', videoId: 'V1', templateName: 1 });
  assert.match(plan({ type: 'onDemand', formId: 'FORM1' }, { video }).refuse, /webinar\.video/);
  assert.match(plan({ type: 'onDemand', formId: 'FORM1', video: 'rec.mp4' }).refuse, /not resolved/);
  assert.match(plan({ type: 'onDemand', formId: 'FORM1', video: 'rec.mp4', date: '2026-10-14', recurring: { frequency: 'DAILY' } }, { video }).refuse, /no schedule or live link: drop webinar\.\{date, recurring\}/);
});

test('findMediaVideo: id or exact name, videos only, not deleted, paged', async () => {
  const file = (i, name, contentType = 'video/mp4', deleted = false) => ({ _id: `F${i}`, name, contentType, deleted, url: `https://cdn/${i}` });
  const pages = [[file(1, 'a.mp4'), file(2, 'b.png', 'image/png')], [file(3, 'rec.mp4'), file(4, 'rec.mp4', 'video/mp4', true)]];
  const calls = [];
  const gw = { call: async (m, path) => { calls.push(path); const off = Number(/offset=(\d+)/.exec(path)[1]); return { ok: true, json: { files: pages[off / 2] ?? [] } }; } };
  assert.deepEqual((await findMediaVideo(gw, 'L', 'rec.mp4', { pageSize: 2 })).hits.map((h) => h.id), ['F3']);
  assert.deepEqual((await findMediaVideo(gw, 'L', 'F1', { pageSize: 2 })).hits.map((h) => h.id), ['F1']);
  assert.deepEqual((await findMediaVideo(gw, 'L', 'b.png', { pageSize: 2 })).hits, [], 'an image is not a webinar video');
  assert.match(calls[0], /altId=L&altType=location&type=file&limit=2&offset=0/);
});

test('get_funnel view webinar: schedule, recurrence, sessions, notification rows, guests and recipe links', () => {
  const funnel = { name: 'W', type: 'webinar', webinarProperties: { webinarType: 'live', timezone: 'America/New_York', endDate: '2026-10-14T13:00:00Z', endTime: '09:00', webinarEndTime: '09:05', recurring: true,
    recurringSettings: { frequency: 'DAILY', repeat: 1, occurrences: 2, rrule: 'DTSTART:20261014T130000Z\nRRULE:FREQ=DAILY;INTERVAL=1;COUNT=2' }, formId: 'FORM1', formName: 'Reg', videoUrl: 'https://example.com/live',
    notifications: [{ type: 'pre', action: 'confirmation', enabled: false, offset: { timeOffset: 0, unit: 'hours' } }] } };
  const sessions = [{ sessionStart: '2026-10-15T13:00:00Z', sessionEnd: '2026-10-15T13:05:00Z', timezone: 'America/New_York' }, { sessionStart: '2026-10-14T13:00:00Z', sessionEnd: '2026-10-14T13:05:00Z', timezone: 'America/New_York' }];
  const v = webinarView(funnel, sessions, 'LOC', NOW);
  assert.equal(v.type, 'live');
  assert.equal(v.recurring.rrule.includes('COUNT=2'), true);
  assert.deepEqual(v.sessions.all.map((x) => x.start), ['2026-10-14T13:00:00Z', '2026-10-15T13:00:00Z'], 'sorted by start');
  assert.equal(v.sessions.next.start, '2026-10-14T13:00:00Z');
  assert.equal(v.liveUrl, 'https://example.com/live');
  assert.deepEqual(v.notifications.rows.map((r) => [r.action, r.enabled]), [['confirmation', false]]);
  assert.equal(v.links.guests, 'https://app.gohighlevel.com/v2/location/LOC/form-builder/submissions?id=FORM1&page=1&limit=25');
  assert.equal(v.links.workflowRecipe.templateId, WEBINAR_RECIPE_TEMPLATE_ID);
  assert.match(v.links.workflowRecipe.url, /automation\/new-workflow\?highlightedCardId=5c1dabb4/);
  const od = webinarView({ webinarProperties: { webinarType: 'demand', videoUrl: 'https://cdn/x.mp4', videoName: 'x.mp4', videoId: 'V', formId: 'F' } }, [], 'LOC', NOW);
  assert.equal(od.type, 'onDemand'); assert.equal(od.recurring, null); assert.equal(od.video.id, 'V'); assert.equal(od.sessions.count, 0);
});

// ── the tool: create_funnel + get_funnel over a stateful fake gateway ───────────────────────────────────────────────────
import { TOOLS } from '../core/tools.mjs';
const tool = (n) => TOOLS.find((t) => t.name === n);
const fast = { tries: 3, delays: [0, 0, 0] };

function gwDeps({ media = [], sessionsShort = false, firstShiftDays = 0 } = {}) {
  const calls = []; const db = { doc: null };
  return {
    calls, state: {}, rereadOptions: fast, nowMs: () => NOW,
    makeGw: () => ({ uid: 'U1', call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.startsWith('/funnels/funnel/list')) return { ok: true, status: 200, json: { funnels: db.doc ? [db.doc] : [], count: db.doc ? 1 : 0 } };
      if (path.startsWith('/forms/')) return { ok: true, status: 200, json: { form: { name: 'Reg' } } };
      if (path.startsWith('/locations/')) return { ok: true, status: 200, json: { companyId: 'C1', location: { companyId: 'C1' } } };
      if (path.startsWith('/medias/files')) return { ok: true, status: 200, json: { files: media } };
      if (path === '/templates/template/load') {
        db.doc = { _id: 'NEW', name: body.extras.name, type: 'webinar', steps: [], webinarProperties: { ...body.extras.webinarProperties, notifications: [] } };
        return { ok: true, status: 201, json: { data: { target: { assetId: 'NEW' } } } };
      }
      if (path.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: structuredClone(db.doc) };
      if (path === '/funnels/funnel/webinar/sessions') {
        const wp = db.doc.webinarProperties;
        if (wp.webinarType === 'demand') return { ok: true, status: 201, json: { webinarSessions: [] } };
        const n = wp.recurring ? (wp.recurringSettings.occurrences ?? 4) : 1;
        const out = Array.from({ length: sessionsShort ? n - 1 : n }, (_, i) => ({ sessionStart: new Date(Date.parse(wp.endDate) + (i + firstShiftDays) * 86400000).toISOString(), sessionEnd: null, timezone: wp.timezone }));
        return { ok: true, status: 201, json: { webinarSessions: out } };
      }
      throw new Error(`unexpected ${method} ${path}`);
    } }),
  };
}
const cf = (args, deps) => tool('create_funnel').handler({ locationId: 'LOC', kind: 'webinar', name: 'TEST-CONF-FUN-X', confirm: true, ...args }, deps);

test('create_funnel: a recurring live webinar is verified by its session COUNT and first start; the result says no email is set up', async () => {
  const d = gwDeps();
  const r = await cf({ webinar: { ...live, recurring: { frequency: 'DAILY', occurrences: 3 } } }, d);
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.data.sessions.length, 3);
  assert.equal(r.data.sessions[0].start, '2026-10-14T13:00:00.000Z');
  assert.deepEqual(r.data.webinar.notifications, { rows: 0, enabled: 0 });
  assert.match(r.data.note, /NO webinar email is set up|No webinar email is set up/);
  const w = d.calls.find((c) => c.path === '/templates/template/load');
  assert.equal(w.body.extras.webinarProperties.recurringSettings.occurrences, 3);
  const short = await cf({ webinar: { ...live, recurring: { frequency: 'DAILY', occurrences: 3 } } }, gwDeps({ sessionsShort: true }));
  assert.equal(short.code, 'VERIFY_FAILED', 'two sessions where three were sent is not success');
});

test('create_funnel: an on-demand webinar resolves the video from Media Storage before any write, and refuses an unknown or ambiguous one', async () => {
  const media = [{ _id: 'V1', name: 'rec.mp4', contentType: 'video/mp4', deleted: false, url: 'https://cdn/V1.mp4' }];
  const d = gwDeps({ media });
  const r = await cf({ webinar: { type: 'onDemand', formId: 'FORM1', video: 'rec.mp4' } }, d);
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.data.webinar.type, 'onDemand');
  assert.equal(r.data.sessions.length, 0);
  assert.equal(d.calls.find((c) => c.path === '/templates/template/load').body.extras.webinarProperties.videoId, 'V1');
  const none = gwDeps({ media });
  const miss = await cf({ webinar: { type: 'onDemand', formId: 'FORM1', video: 'nope.mp4' } }, none);
  assert.equal(miss.code, 'VALIDATION_FAILED');
  assert.equal(none.calls.filter((c) => c.method !== 'GET').length, 0, 'nothing was sent');
  const dup = await cf({ webinar: { type: 'onDemand', formId: 'FORM1', video: 'rec.mp4' } }, gwDeps({ media: [...media, { ...media[0], _id: 'V2' }] }));
  assert.equal(dup.code, 'VALIDATION_FAILED');
  assert.match(dup.detail, /matches 2/);
});

test('get_funnel view webinar reads the document and its sessions; refuses a funnel that is not a webinar', async () => {
  const d = gwDeps();
  await cf({ webinar: { ...live, recurring: { frequency: 'DAILY', occurrences: 2 } } }, d);
  const r = await tool('get_funnel').handler({ locationId: 'LOC', funnelId: 'NEW', view: 'webinar' }, d);
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.data.webinar.sessions.count, 2);
  assert.equal(r.data.webinar.recurring.frequency, 'DAILY');
  assert.equal(r.data.webinar.links.workflowRecipe.templateId, WEBINAR_RECIPE_TEMPLATE_ID);
  d.calls.length = 0;
  const other = gwDeps();
  other.makeGw = () => ({ uid: 'U', call: async () => ({ ok: true, status: 200, json: { _id: 'F', name: 'A funnel', type: 'funnel', steps: [] } }) });
  const bad = await tool('get_funnel').handler({ locationId: 'LOC', funnelId: 'F', view: 'webinar' }, other);
  assert.equal(bad.code, 'VALIDATION_FAILED');
});

test('sessionWarnings: the two things GHL\'s series do that were measured live (wave39)', () => {
  const ny = { timezone: 'America/New_York', startTime: '09:00', startUtc: '2026-10-14T13:00:00Z' };
  // WEEKLY MO+WE by 11 Nov as GHL returned it: every session keeps 13:00Z, so those after the 1 Nov clock change run at 08:00 local
  const weekly = ['2026-10-14', '2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28', '2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11'].map((d) => ({ start: `${d}T13:00:00.000Z` }));
  const w = sessionWarnings(weekly, ny);
  assert.equal(w.length, 1);
  assert.match(w[0], /4 of 9 sessions run at 08:00 America\/New_York, not 09:00/);
  // MONTHLY "first Monday" from 14 Oct: the first session is 2 Nov, not the start date
  const monthly = ['2026-11-02', '2026-12-07', '2027-01-04'].map((d) => ({ start: `${d}T13:00:00.000Z` }));
  const m = sessionWarnings(monthly, ny);
  assert.match(m[0], /first session is 2026-11-02T13:00:00\.000Z, not the start date/);
  assert.match(m[1], /3 of 3 sessions run at 08:00/);
  // a series that never crosses a clock change and starts on its start day says nothing
  assert.deepEqual(sessionWarnings([{ start: '2026-10-14T13:00:00.000Z' }, { start: '2026-10-15T13:00:00.000Z' }], ny), []);
  assert.deepEqual(sessionWarnings([], ny), []);
});

test('create_funnel: a WEEKLY/MONTHLY series whose first session falls after the start day is created, with a warning (live: MONTHLY first Monday from 14 Oct began 2 Nov)', async () => {
  const d = gwDeps({ firstShiftDays: 19 });
  const r = await cf({ webinar: { ...live, recurring: { frequency: 'MONTHLY', occurrences: 2, monthlyWeek: 1, monthlyWeekDay: 'MO' } } }, d);
  assert.equal(r.ok, true, r.detail);
  assert.match(r.data.warnings[0], /first session is 2026-11-02/);
  const daily = await cf({ webinar: { ...live, recurring: { frequency: 'DAILY', occurrences: 2 } } }, gwDeps({ firstShiftDays: 1 }));
  assert.equal(daily.code, 'VERIFY_FAILED', 'a DAILY series must start on the start day');
});
