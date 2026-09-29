// edit_redirects, f5a: the screen's other Redirect-To targets — a funnel step, a website page, and "Entire Domain (/*)". The request bodies are the
// ones the screen sent, captured with the save BLOCKED (knowledge sniffs/funnels-wave37-f5-redirects-2026-09-30 ui-cap.*.BLOCKED.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCreate, planUpdate, resolveTo, ENTIRE_DOMAIN } from '../core/redirects.mjs';
import { TOOLS } from '../core/tools.mjs';

const D = 'sandbox.example.test';
const FUNNEL = { _id: 'F1', name: 'TEST-CONF-FUN-X', type: 'funnel', steps: [{ id: 'S1', name: 'Optin' }, { id: 'S2', name: 'Thanks' }] };
const SITE = { _id: 'W1', name: 'TEST-CONF-FUN-SITE', type: 'website', steps: [{ id: 'P1', name: 'Home' }] };

test('the screen\'s bodies: funnel = step id, website = step id, entire domain = path "*" + action "all"', () => {
  assert.deepEqual(planCreate({ domain: D, path: 'test-conf-fun-a', action: 'funnel', target: 'S2', locationId: 'L' }).request.body,
    { domain: D, path: '/test-conf-fun-a', action: 'funnel', locationId: 'L', type: 'redirect', target: 'S2' });
  assert.equal(planCreate({ domain: D, path: 'test-conf-fun-b', action: 'website', target: 'P1', locationId: 'L' }).request.body.action, 'website');
  const all = planCreate({ domain: D, entireDomain: true, target: 'https://example.com', locationId: 'L' });
  assert.deepEqual(all.request.body, { domain: D, path: '*', action: 'all', locationId: 'L', type: 'redirect', target: 'https://example.com' });
  assert.equal(all.entireDomain, true); assert.equal(all.exists, undefined);
  assert.deepEqual(ENTIRE_DOMAIN, { path: '*', action: 'all' });
});

test('entire domain: a path alongside it, a non-URL target and the root path "/" are refused; "/*" is the same as "*"', () => {
  assert.match(planCreate({ domain: D, entireDomain: true, path: '/x', target: 'https://e.com', locationId: 'L' }).error, /do not also name a path/);
  assert.match(planCreate({ domain: D, entireDomain: true, target: 'S1', locationId: 'L' }).error, /entire-domain redirect goes to a URL/);
  assert.match(planCreate({ domain: D, path: '/', target: 'https://e.com', locationId: 'L' }).error, /entireDomain/);
  assert.equal(planCreate({ domain: D, entireDomain: true, path: '/*', target: 'https://e.com', locationId: 'L' }).request.body.path, '*');
});

test('resolveTo: a URL, a step of a funnel, a page of a website — and every mismatch by name', () => {
  assert.deepEqual(resolveTo({ target: 'https://e.com/x' }), { action: 'url', target: 'https://e.com/x' });
  assert.match(resolveTo({ target: 'e.com/x' }).error, /absolute/);
  assert.deepEqual(resolveTo({ to: { type: 'funnel', funnelId: 'F1', stepId: 'S2' }, funnelDoc: FUNNEL }), { action: 'funnel', target: 'S2' });
  assert.deepEqual(resolveTo({ to: { type: 'website', funnelId: 'W1', stepId: 'P1' }, funnelDoc: SITE }), { action: 'website', target: 'P1' });
  assert.match(resolveTo({ to: { type: 'funnel', funnelId: 'F1', stepId: 'NOPE' }, funnelDoc: FUNNEL }).error, /no step NOPE/);
  assert.match(resolveTo({ to: { type: 'website', funnelId: 'F1', stepId: 'S1' }, funnelDoc: FUNNEL }).error, /is a funnel, not a website/);
  assert.match(resolveTo({ to: { type: 'funnel', funnelId: 'W1', stepId: 'P1' }, funnelDoc: SITE }).error, /is a website, not a funnel/);
  assert.match(resolveTo({ to: { type: 'funnel', funnelId: 'F9', stepId: 'S1' }, funnelDoc: null }).error, /was not found/);
  assert.match(resolveTo({ to: { type: 'funnel', funnelId: 'F1', stepId: 'S1' }, target: 'https://e.com', funnelDoc: FUNNEL }).error, /not both/);
  assert.match(resolveTo({ to: { type: 'funnel', funnelId: 'F1' }, funnelDoc: FUNNEL }).error, /needs funnelId and stepId/);
});

test('planUpdate: a step target is not URL-validated; a URL still is', () => {
  assert.deepEqual(planUpdate({ redirectId: 'R', action: 'funnel', target: 'S2', locationId: 'L' }).request.body, { action: 'funnel', target: 'S2', locationId: 'L' });
  assert.match(planUpdate({ redirectId: 'R', action: 'url', target: 'nope', locationId: 'L' }).error, /absolute/);
});

// ---- through the tool, on a fake gateway ----
const tool = TOOLS.find((t) => t.name === 'edit_redirects');
const gw = (rows, docs = { F1: FUNNEL, W1: SITE }, calls = []) => ({ call: async (method, path, body) => {
  calls.push({ method, path, body });
  if (path.startsWith('/funnels/funnel/fetch/')) { const d = docs[decodeURIComponent(path.split('/').pop().split('?')[0])]; return d ? { ok: true, status: 200, json: { data: d } } : { ok: false, status: 404, json: {} }; }
  if (path === '/funnels/lookup/exists') return { ok: true, status: 201, json: { exists: false } };
  if (path.startsWith('/funnels/lookup/list')) return { ok: true, status: 200, json: { data: [{ type: 'step', typeId: 'S1', domain: D }, { type: 'step', typeId: 'S2', domain: D }, { type: 'step', typeId: 'P1', domain: D }] } };
  if (path.startsWith('/funnels/lookup/redirect/list')) return { ok: true, status: 200, json: { data: rows.slice(), count: rows.length } };
  if (method === 'POST' && path === '/funnels/lookup/redirect') { rows.push({ _id: 'NEW', domain: body.domain, path: body.path, action: body.action, target: body.target }); return { ok: true, status: 201, json: { data: { id: 'NEW' } } }; }
  if (method === 'PATCH') { const r = rows.find((x) => path.endsWith(`/${x._id}`)); Object.assign(r, { action: body.action, target: body.target }); return { ok: true, status: 200, json: {} }; }
  throw new Error(`unexpected ${method} ${path}`);
} });
const run = (args, g) => tool.handler({ locationId: 'L', ...args }, { state: {}, makeGw: () => g, rereadOptions: { attempts: 1, delayMs: 0 } });
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && c.path !== '/funnels/lookup/exists' && !c.path.startsWith('/funnels/funnel/fetch'));

test('tool: a funnel-step redirect resolves the step on the funnel, writes action funnel + the step id, reads it back', async () => {
  const calls = []; const rows = [];
  const pre = await run({ op: 'create', domain: D, path: 'test-conf-fun-a', to: { type: 'funnel', funnelId: 'F1', stepId: 'S2' } }, gw(rows, undefined, calls));
  assert.equal(pre.code, 'CONFIRM_REQUIRED'); assert.equal(writes(calls).length, 0);
  const r = await run({ op: 'create', domain: D, path: 'test-conf-fun-a', to: { type: 'funnel', funnelId: 'F1', stepId: 'S2' }, confirm: true }, gw(rows, undefined, calls));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.action, 'funnel'); assert.equal(r.data.target, 'S2');
  assert.deepEqual(writes(calls).map((c) => c.body.action), ['funnel']);
});

test('tool: a step that is not on the funnel, or a funnel that does not exist, is refused before any write', async () => {
  for (const to of [{ type: 'funnel', funnelId: 'F1', stepId: 'NOPE' }, { type: 'funnel', funnelId: 'F9', stepId: 'S1' }, { type: 'website', funnelId: 'F1', stepId: 'S1' }]) {
    const calls = []; const r = await run({ op: 'create', domain: D, path: 'x', to, confirm: true }, gw([], undefined, calls));
    assert.equal(r.code, 'VALIDATION_FAILED'); assert.equal(writes(calls).length, 0);
  }
});

test('tool: a step with no domain attached is refused before any write (GHL answers 400 for it)', async () => {
  const doc = { ...FUNNEL, steps: [...FUNNEL.steps, { id: 'S3', name: 'NoDomain' }] };
  const calls = []; const r = await run({ op: 'create', domain: D, path: 'x', to: { type: 'funnel', funnelId: 'F1', stepId: 'S3' }, confirm: true }, gw([], { F1: doc }, calls));
  assert.equal(r.code, 'VALIDATION_FAILED'); assert.match(r.detail, /no domain attached/); assert.equal(writes(calls).length, 0);
});

test('tool: entireDomain needs confirmEntireDomain = the domain; without it nothing is even read; with it the body is the captured one', async () => {
  const calls = [];
  const bad = await run({ op: 'create', domain: D, entireDomain: true, target: 'https://example.com', confirm: true }, gw([], undefined, calls));
  assert.equal(bad.code, 'VALIDATION_FAILED'); assert.match(bad.detail, /EVERY page/); assert.equal(calls.length, 0);
  const wrong = await run({ op: 'create', domain: D, entireDomain: true, confirmEntireDomain: 'other.test', target: 'https://example.com', confirm: true }, gw([], undefined, calls));
  assert.equal(wrong.code, 'VALIDATION_FAILED'); assert.equal(calls.length, 0);
  const pre = await run({ op: 'create', domain: D, entireDomain: true, confirmEntireDomain: D, target: 'https://example.com' }, gw([], undefined, calls));
  assert.equal(pre.code, 'CONFIRM_REQUIRED'); assert.equal(pre.data.preview.entireDomain, true); assert.equal(writes(calls).length, 0);
  const ok = await run({ op: 'create', domain: D, entireDomain: true, confirmEntireDomain: D, target: 'https://example.com', confirm: true }, gw([], undefined, calls));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(writes(calls)[0].body, { domain: D, path: '*', action: 'all', locationId: 'L', type: 'redirect', target: 'https://example.com' });
});

test('tool: a second entire-domain redirect on the same domain is refused', async () => {
  const calls = []; const r = await run({ op: 'create', domain: D, entireDomain: true, confirmEntireDomain: D, target: 'https://example.com', confirm: true }, gw([{ _id: 'E', domain: D, path: '*', action: 'all', target: 'https://a.com' }], undefined, calls));
  assert.equal(r.code, 'VALIDATION_FAILED'); assert.equal(writes(calls).length, 0);
});

test('tool: update retargets a URL redirect to a funnel step (action changes with it) and an entire-domain row keeps action all', async () => {
  const rows = [{ _id: 'A', domain: D, path: '/test-conf-fun-a', action: 'url', target: 'https://e.com' }, { _id: 'E', domain: D, path: '*', action: 'all', target: 'https://a.com' }];
  const calls = [];
  const r = await run({ op: 'update', redirectId: 'A', path: '/test-conf-fun-a', to: { type: 'funnel', funnelId: 'F1', stepId: 'S1' }, confirm: true }, gw(rows, undefined, calls));
  assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.data.after, { action: 'funnel', target: 'S1' });
  const e = await run({ op: 'update', redirectId: 'E', path: '*', target: 'https://b.com', confirm: true }, gw(rows, undefined, calls));
  assert.equal(e.ok, true, JSON.stringify(e)); assert.deepEqual(e.data.after, { action: 'all', target: 'https://b.com' });
});

// ---- the click range (redirect stats) ----
import { siteRedirects } from '../core/tools.mjs';
test('find_ghl_site redirect clicks: the range is sent as given, the previous period and each row\'s series come back; a bad range is refused', async () => {
  const sent = [];
  const g = { call: async (method, path, body) => {
    if (path.startsWith('/funnels/domain')) return { ok: true, json: { domains: [] } };
    if (path.startsWith('/funnels/lookup/redirect/list')) return { ok: true, json: { data: [{ _id: 'A', domain: D, path: '/a', target: 'https://e.com', action: 'url' }], count: 1 } };
    if (path === '/stats/url-redirect') { sent.push(body); return { ok: true, json: { cards: { clicks: { curr: 5, prev: 2 } }, timeframe: { comparison: { fromDate: 'x', toDate: 'y' } }, rows: [{ clicks: { curr: 5 }, sparkline: { interval: '1d', series: [{ t: '2026-09-01', count: 5 }] } }] } }; }
    throw new Error(`unexpected ${method} ${path}`);
  } };
  const deps = { state: {}, makeGw: () => g };
  const r = await siteRedirects(deps, 'L', { from: '2026-06-17', to: '2026-09-29' });
  assert.equal(sent[0].fromDate, '2026-06-17'); assert.equal(sent[0].toDate, '2026-09-29');
  assert.deepEqual(r.clicks.byRow[0], { path: '/a', clicks: 5, interval: '1d', series: [{ t: '2026-09-01', count: 5 }] });
  assert.equal(r.clicks.previousPeriod, 2); assert.equal(r.clicks30d, undefined);
  const dflt = await siteRedirects(deps, 'L'); assert.ok(dflt.clicks30d); assert.equal(dflt.clicks, undefined);
  assert.match((await siteRedirects(deps, 'L', { from: '2026-9-1' })).warning, /YYYY-MM-DD/);
  assert.match((await siteRedirects(deps, 'L', { from: '2026-09-29', to: '2026-09-01' })).warning, /after/);
});
