// Each test pins one live-observed defect class. The false-positive tests matter as much as the
// detection ones: an auditor that cries wolf on popupId (776 occurrences on one account) gets
// switched off, and an auditor that reports "clean" for a check it never ran is worse than none.
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPage, judge, judgeRendered, judgeVersions, judgeRouting, normaliseTag, placeholderKind, REF_CLASS, judgePathCollisions } from '../core/site-audit.mjs';

const LOC = 'LOC_OWN';
const page = ({ els = [], popups = [], extra = {} } = {}) => ({
  sections: [{ id: 's1', elements: els }], popupsList: popups, ...extra,
});
const el = (prop, value, text = null) => ({ type: 'element', meta: 'form', extra: { [prop]: { value, ...(text ? { text } : {}) } } });
const known = {
  forms: new Set(['REAL_FORM']), calendars: new Set(['REAL_CAL']), surveys: new Set(['REAL_SURVEY']),
  customValues: new Set([normaliseTag('{{ custom_values.real_one }}')]),
};
const run = (pd) => judge({ scans: [scanPage({ pageData: pd, pageId: 'P1', pageName: 'Home' })], known, locationId: LOC });

test('a formId pointing outside the account is HIGH, and the finding quotes the misleading name', () => {
  const f = run(page({ els: [el('formId', 'FOREIGN', 'Electrician Form')] }));
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'high');
  assert.equal(f[0].check, 'dangling-references');
  assert.match(f[0].detail, /does not exist in this account/);
  assert.match(f[0].detail, /survives a visual check/, 'the name beside the wrong id is WHY this is missed');
});

test('a resolvable reference produces nothing', () => {
  assert.deepEqual(run(page({ els: [el('formId', 'REAL_FORM', 'Contact')] })), []);
});

test('calendarId is checked the same way — formId is not special', () => {
  const f = run(page({ els: [el('calendarId', 'GONE', 'Schedule an Appointment')] }));
  assert.equal(f.length, 1);
  assert.equal(f[0].prop, 'calendarId');
  assert.match(f[0].detail, /calendar that does not exist/);
});

test('the literal "none" and an unsubstituted merge tag are both caught, and named apart', () => {
  const a = run(page({ els: [el('formId', 'none', 'You do not have any forms yet')] }));
  assert.equal(a[0].placeholder, 'empty');
  const b = run(page({ els: [el('formId', '{{ webinar_formId }}', 'Webinar Form')] }));
  assert.equal(b[0].placeholder, 'unsubstituted-merge-tag');
});

test('popupId is PAGE-LOCAL: resolving inside the page is clean, and this is the false-positive guard', () => {
  const ok = run(page({ els: [el('popupId', 'hl_main_popup-AAA')] }, ), );
  assert.ok(ok.length >= 0);
  const clean = judge({ scans: [scanPage({ pageData: page({ els: [el('popupId', 'hl_main_popup-AAA')], popups: [{ id: 'hl_main_popup-AAA' }] }), pageId: 'P1' })], known, locationId: LOC });
  assert.deepEqual(clean, [], 'a popup defined on the page must never be reported — 776 uses on one real account');
  const bad = judge({ scans: [scanPage({ pageData: page({ els: [el('popupId', 'hl_main_popup-MISSING')] }), pageId: 'P1' })], known, locationId: LOC });
  assert.equal(bad[0].check, 'page-local-references');
  assert.equal(bad[0].severity, 'medium');
});

test('storeProductPriceId is a SENTINEL and is never reported', () => {
  assert.equal(REF_CLASS.storeProductPriceId, 'sentinel');
  assert.deepEqual(run(page({ els: [el('storeProductPriceId', 'all')] })), []);
});

test('a reference with no account list is reported as NOT CHECKED, never as clean', () => {
  const f = run(page({ els: [el('productId', 'SOMETHING')] }));
  assert.equal(f.length, 1);
  assert.equal(f[0].notChecked, true);
  assert.equal(f[0].severity, 'unknown');
  assert.match(f[0].detail, /NOT checked/);
});

test('a foreign locationId is caught as a key AND inside a widget URL', () => {
  const byKey = run(page({ extra: { settings: { locationId: 'OTHER_ACCOUNT' } } }));
  assert.equal(byKey[0].check, 'foreign-location');
  const byUrl = run(page({ els: [{ type: 'element', meta: 'custom-code',
    extra: { code: { value: '<iframe src="https://x/reputation/widgets/review_widget/OTHERLOCATION12345678"></iframe>' } } }] }));
  assert.ok(byUrl.some((x) => x.check === 'foreign-location'), 'the review-widget case hides the id in a URL, not a key');
  assert.deepEqual(run(page({ extra: { settings: { locationId: LOC } } })), [], 'the account\'s own id is not a finding');
});

test('a merge tag with no matching custom value is caught, and spacing does not matter', () => {
  assert.deepEqual(run(page({ extra: { t: '{{custom_values.real_one}}' } })), [],
    'the account key carries spaces, the page usually omits them — both must match');
  const f = run(page({ extra: { t: '{{ custom_values.missing_one }}' } }));
  assert.equal(f[0].check, 'merge-tags');
  assert.match(f[0].detail, /renders as blank/);
});

test('judgeVersions reports a pinned page and stays quiet on the two clean regimes', () => {
  const v = (t, s) => ({ pageType: t, updated_at: { _seconds: s } });
  assert.deepEqual(judgeVersions({ versions: [v('draft', 9), v('draft', 5)], pageId: 'P' }), [],
    'never published — the public URL serves the newest draft, which is correct');
  assert.deepEqual(judgeVersions({ versions: [v('live', 9), v('draft', 5)], pageId: 'P' }), [],
    'published and current — nothing stacked behind it');
  const f = judgeVersions({ versions: [v('draft', 900), v('draft', 500), v('live', 100)], pageId: 'P' });
  assert.equal(f[0].draftsSincePublish, 2);
  assert.equal(f[0].staleBySeconds, 800);
});

test('the render leg catches what a document scan structurally cannot', () => {
  const dead = judgeRendered({ html: '<div>Unable to find form</div>', url: 'u' });
  assert.equal(dead[0].severity, 'high');
  const links = judgeRendered({ html: '<a href="https://app.gohighlevel.com/v2/preview/ABC123">x</a>', url: 'u' });
  assert.equal(links[0].count, 1);
  // Compared against the SERVED page, not a stored draft: a pinned page serves its published
  // version, and a draft-vs-schema check would report stale schema for a page whose schema is fine.
  const stale = judgeRendered({ url: 'u',
    html: '<h1>NEW HEADLINE</h1><script type="application/ld+json">{"name":"OLD HEADLINE"}</script>' });
  assert.match(stale[0].detail, /ONE PUBLISH BEHIND/);
  assert.deepEqual(stale[0].names, ['OLD HEADLINE']);
  const fresh = judgeRendered({ url: 'u',
    html: '<h1>NEW HEADLINE</h1><script type="application/ld+json">{"name":"NEW HEADLINE"}</script>' });
  assert.deepEqual(fresh, []);
  // The generator labels its own elements "HEADING [heading-S0C00]" — never page copy, never a finding.
  assert.deepEqual(judgeRendered({ url: 'u',
    html: '<h1>X</h1><script type="application/ld+json">{"name":"HEADING [heading-S0C00]"}</script>' }), []);
});

test('placeholderKind and normaliseTag behave at the edges', () => {
  assert.equal(placeholderKind('none'), 'empty');
  assert.equal(placeholderKind(''), 'empty');
  assert.equal(placeholderKind(null), 'empty');
  assert.equal(placeholderKind('{{ x }}'), 'unsubstituted-merge-tag');
  assert.equal(placeholderKind('REAL'), null);
  assert.equal(normaliseTag('{{ custom_values.A_b }}'), '{{custom_values.a_b}}');
});

test('repeated identical bindings collapse to one finding with an occurrence count', () => {
  const els = [el('formId', 'FOREIGN', 'Contact'), el('formId', 'FOREIGN', 'Contact'), el('formId', 'FOREIGN', 'Contact')];
  const f = run(page({ els }));
  assert.equal(f.length, 1, 'one broken binding is one thing to fix, however many times it appears');
  assert.equal(f[0].occurrences, 3);
});

test('media from another account is INFO and says do not repoint it; a bound widget is HIGH', () => {
  const media = run(page({ els: [{ type: 'element', meta: 'image',
    extra: { url: { value: 'https://storage.googleapis.com/msgsndr/OTHERLOCATION12345678/media/x.png' } } }] }));
  assert.equal(media[0].severity, 'info');
  assert.equal(media[0].media, true);
  assert.match(media[0].detail, /Do not repoint/, 'a naive fix-all sweep deletes the site\'s images');
  const widget = run(page({ els: [{ type: 'element', meta: 'custom-code',
    extra: { code: { value: '<iframe src="https://x/reputation/widgets/review_widget/OTHERLOCATION12345678">' } } }] }));
  assert.equal(widget.find((x) => x.check === 'foreign-location').severity, 'high');
});

const row = (typeId, path, extra = {}) => ({ typeId, path, type: 'step', deleted: false, ...extra });

test('judgeRouting: a step with no routing row is HIGH — it 404s in public', () => {
  const f = judgeRouting({ rows: [], steps: [{ id: 'S1', name: 'Upsell', url: '/upsell' }] });
  assert.equal(f[0].severity, 'high');
  assert.match(f[0].detail, /NO routing row/);
});

test('judgeRouting: a step whose record matches ANY of its rows is not drift', () => {
  // Live-observed: one step carrying both /upsell-8618 and /upsell, same typeId, neither deleted.
  // The first version of this check kept one row from a Map and reported a false drift.
  const rows = [row('S1', '/upsell-8618'), row('S1', '/upsell')];
  const f = judgeRouting({ rows, steps: [{ id: 'S1', name: 'Upsell', url: '/upsell-8618' }] });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'info', 'aliases are worth mentioning, not worth alarming about');
  assert.match(f[0].detail, /serve as aliases/);
});

test('judgeRouting: real drift is caught when NO row serves the record\'s path', () => {
  const f = judgeRouting({ rows: [row('S1', '/thank-you-1265')], steps: [{ id: 'S1', name: 'TY', url: '/thank-you' }] });
  assert.equal(f[0].severity, 'medium');
  assert.match(f[0].detail, /NO routing row serves that path/);
});

test('judgeRouting: two rows sharing one path is undefined behaviour and is reported', () => {
  const rows = [row('S1', '/home'), row('S2', '/home')];
  const f = judgeRouting({ rows, steps: [{ id: 'S1', name: 'A', url: '/home' }, { id: 'S2', name: 'B', url: '/home' }] });
  assert.ok(f.some((x) => /share this path/.test(x.detail)));
});

test('judgeRouting: deleted rows are ignored', () => {
  const rows = [row('S1', '/old', { deleted: true }), row('S1', '/new')];
  const f = judgeRouting({ rows, steps: [{ id: 'S1', name: 'A', url: '/new' }] });
  assert.deepEqual(f, []);
});

test('judgePathCollisions names the cross-document claimant BEFORE an attach can rename it', () => {
  const docs = [
    { _id: 'f1', name: 'Live Website', domainId: 'dom1', steps: [{ id: 's1', name: 'TY', url: '/thank-you' }] },
    { _id: 'f2', name: 'New Funnel', domainId: null, steps: [{ id: 's2', name: 'Thanks', url: '/thank-you' }] },
  ];
  const rowsByFunnel = new Map([
    ['f1', [{ domain: 'x.example.com', path: '/thank-you', type: 'step', typeId: 's1', deleted: false }]],
    ['f2', []],
  ]);
  const f = judgePathCollisions({ docs, rowsByFunnel, focusIds: new Set(['f2']) });
  assert.equal(f.length, 1);
  assert.equal(f[0].check, 'path-collision');
  assert.equal(f[0].severity, 'medium');       // f2 is the document the caller asked about
  assert.equal(f[0].value, '/thank-you');
  assert.match(f[0].pageName, /New Funnel/);
  // 🔴 The whole point is naming WHO holds it — the claimant is invisible from the attaching document.
  assert.match(f[0].detail, /Live Website/);
});

test('judgePathCollisions stays silent when the colliding document is already attached', () => {
  // Its collision is history: the attach already resolved it, and judgeRouting reports the fallout.
  const docs = [
    { _id: 'f1', name: 'A', domainId: 'dom1', steps: [{ id: 's1', name: 'x', url: '/p' }] },
    { _id: 'f2', name: 'B', domainId: 'dom1', steps: [{ id: 's2', name: 'y', url: '/p' }] },
  ];
  const rowsByFunnel = new Map([
    ['f1', [{ domain: 'x.example.com', path: '/p', type: 'step', typeId: 's1', deleted: false }]],
    ['f2', [{ domain: 'x.example.com', path: '/p-4821', type: 'step', typeId: 's2', deleted: false }]],
  ]);
  assert.deepEqual(judgePathCollisions({ docs, rowsByFunnel }), []);
});

test('judgePathCollisions reports two live rows holding the identical domain+path', () => {
  const docs = [{ _id: 'f1', name: 'A', domainId: 'd' }, { _id: 'f2', name: 'B', domainId: 'd' }];
  const rowsByFunnel = new Map([
    ['f1', [{ domain: 'x.example.com', path: '/p', type: 'step', typeId: 's1', deleted: false }]],
    ['f2', [{ domain: 'x.example.com', path: '/p', type: 'page', typeId: 'p1', deleted: false }]],
  ]);
  const f = judgePathCollisions({ docs, rowsByFunnel });
  assert.equal(f.length, 1);
  assert.equal(f[0].value, 'x.example.com/p');
  assert.match(f[0].detail, /A \[step\]/);
  assert.match(f[0].detail, /B \[page\]/);
});

test('judgePathCollisions ignores a deleted row, which holds nothing', () => {
  const docs = [
    { _id: 'f1', name: 'A', domainId: 'd', steps: [] },
    { _id: 'f2', name: 'B', domainId: null, steps: [{ id: 's', name: 'y', url: '/p' }] },
  ];
  const rowsByFunnel = new Map([['f1', [{ domain: 'x.example.com', path: '/p', type: 'step', typeId: 's1', deleted: true }]], ['f2', []]]);
  assert.deepEqual(judgePathCollisions({ docs, rowsByFunnel }), []);
});

test('judgePathCollisions on a location with no domain finds nothing to collide with', () => {
  const docs = [
    { _id: 'f1', name: 'A', domainId: null, steps: [{ id: 's1', name: 'x', url: '/p' }] },
    { _id: 'f2', name: 'B', domainId: null, steps: [{ id: 's2', name: 'y', url: '/p' }] },
  ];
  assert.deepEqual(judgePathCollisions({ docs, rowsByFunnel: new Map() }), []);
});

test('judgePathCollisions drops a neighbour-only forecast to info, so a sweep cannot drown the audit', () => {
  const docs = [
    { _id: 'f1', name: 'Live Website', domainId: 'dom1', steps: [{ id: 's1', name: 'TY', url: '/thank-you' }] },
    { _id: 'f2', name: 'Asked About', domainId: null, steps: [{ id: 's2', name: 'a', url: '/thank-you' }] },
    { _id: 'f3', name: 'Half-built Neighbour', domainId: null, steps: [{ id: 's3', name: 'b', url: '/thank-you' }] },
  ];
  const rowsByFunnel = new Map([
    ['f1', [{ domain: 'x.example.com', path: '/thank-you', type: 'step', typeId: 's1', deleted: false }]],
    ['f2', []], ['f3', []],
  ]);
  const f = judgePathCollisions({ docs, rowsByFunnel, focusIds: new Set(['f2']) });
  const byName = Object.fromEntries(f.map((x) => [x.pageName, x.severity]));
  assert.equal(byName['Asked About / a'], 'medium');
  assert.equal(byName['Half-built Neighbour / b'], 'info');
  assert.match(f.find((x) => x.severity === 'info').detail, /swept as a neighbour/);
});

// 🔴 A REGRESSION PIN, not a behaviour test. `/funnels/lookup/list` answers 200 with `{"data":[]}`
// if it is given `limit` OR `offset` — either alone, any value. Measured on one funnel seconds
// apart: no params 20 rows; limit=100, limit=500, offset=0, offset=1 all 0 rows. An empty row set
// on a funnel that HAS a domain is what makes judgeRouting report "NO routing row … 404s in public"
// at HIGH on every step, so someone adding pagination here silently resurrects that false positive.
test('audit_site never passes limit or offset to lookup/list, which would zero the rows', async () => {
  const src = await readFile(new URL('../core/tools.mjs', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/\/funnels\/lookup\/list\?[^`]*/g)].map((m) => m[0]);
  assert.ok(calls.length > 0, 'expected at least one lookup/list call to guard');
  for (const c of calls) {
    assert.doesNotMatch(c, /\blimit=/, `lookup/list must not paginate: ${c}`);
    assert.doesNotMatch(c, /\boffset=/, `lookup/list must not paginate: ${c}`);
  }
});
