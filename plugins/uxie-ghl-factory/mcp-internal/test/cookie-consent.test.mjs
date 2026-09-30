// edit_funnel set-cookie-consent. The defaults, the option strings and the whole-object save are the builder's own, captured on the sandbox
// (knowledge sniffs/funnels-wave4-page-2026-09-26/live-page.cookie-consent.json; sniffs/funnels-wave45-f8-2026-09-30 for Don't ask, Center floating, Top banner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { planCookieConsent, cookieConsentNotApplied, CC_DEFAULTS, POSITIONS } from '../core/cookie-consent.mjs';

const funnel = { _id: 'F1', steps: [{ id: 'S1', pages: ['P1', 'P2'] }] };
const plan = (cc, stored = null, extra = {}) => planCookieConsent({ funnel, locationId: 'L', stored, cc, ...extra });

test('a first enable saves the builder\'s own defaults with the page id, and needs the disclaimer acknowledged', () => {
  assert.match(plan({ enabled: true }).refuse, /acknowledged: true/);
  const p = plan({ enabled: true, acknowledged: true });
  assert.equal(p.path, '/funnels/funnel/cookie-consent');
  assert.deepEqual(p.body, { ...CC_DEFAULTS, locationId: 'L', funnelId: 'F1', pageId: 'P1', isCookieEnabled: true });
  assert.equal(p.body.style, CC_DEFAULTS.style, 'the compiled CSS is kept, not regenerated');
  assert.equal(p.enabling, true);
});

test('the option strings are the ones the panel saved (Don\'t ask, Center floating, Top banner)', () => {
  const p = plan({ complianceType: 'do-not-ask', position: 'center-floating' }, { ...CC_DEFAULTS, isCookieEnabled: true });
  assert.equal(p.body.complianceType, 'do-not-ask');
  assert.equal(p.body.layoutSettings.position, 'popup-banner position-center');
  assert.deepEqual(p.body.layoutSettings, { ...CC_DEFAULTS.layoutSettings, position: 'popup-banner position-center' }, 'the rest of layoutSettings is kept');
  assert.equal(plan({ position: 'top-banner' }, { ...CC_DEFAULTS, isCookieEnabled: true }).body.layoutSettings.position, 'top-banner');
  assert.deepEqual(Object.keys(POSITIONS), ['bottom-banner', 'top-banner', 'center-floating']);
});

test('message, expiry and button texts land on the stored keys; a stored value the call does not name is kept', () => {
  const stored = { ...CC_DEFAULTS, isCookieEnabled: true, bgColor: '#123456', policyLink: 'https://x.example/p' };
  const p = plan({ message: 'Hi', consentExpiration: 30, buttons: { ok: 'Got it' } }, stored);
  assert.deepEqual([p.body.msgDescription, p.body.consentExpiration, p.body.okBtnText, p.body.bgColor, p.body.policyLink], ['Hi', 30, 'Got it', '#123456', 'https://x.example/p']);
  assert.deepEqual(p.changes.map((c) => c.key), ['message', 'consentExpiration', 'buttons.ok']);
});

test('refusals: unknown key, bad values, no-op, no banner yet, left/right floating', () => {
  const on = { ...CC_DEFAULTS, isCookieEnabled: true };
  assert.match(plan({ bgColor: '#fff' }, on).refuse, /takes enabled.*not bgColor/);
  assert.match(plan({ complianceType: 'inform' }, on).refuse, /ask-opt-in, do-not-ask/);
  assert.match(plan({ position: 'left-floating' }, on).refuse, /not offered|one of/);
  assert.match(plan({ consentExpiration: 0 }, on).refuse, /1 to 3650/);
  assert.match(plan({ message: '' }, on).refuse, /1 to 1000/);
  assert.match(plan({ buttons: { nope: 'x' } }, on).refuse, /buttons\.nope/);
  assert.match(plan({ complianceType: 'ask-opt-in' }, on).refuse, /nothing to change/);
  assert.match(plan({ message: 'x' }).refuse, /no cookie banner yet/);
  assert.match(planCookieConsent({ funnel: { _id: 'F', steps: [] }, locationId: 'L', stored: null, cc: { enabled: true, acknowledged: true } }).refuse, /no page/);
  assert.equal(plan({ enabled: false }, on).body.isCookieEnabled, false, 'turning it off needs no acknowledgement');
});

test('cookieConsentNotApplied compares each changed field with the read-back', () => {
  const p = plan({ complianceType: 'do-not-ask', position: 'top-banner', message: 'M', buttons: { acceptAll: 'A' }, enabled: true, acknowledged: true });
  const good = { ...p.body };
  assert.deepEqual(cookieConsentNotApplied(good, p), []);
  const bad = cookieConsentNotApplied({ ...good, complianceType: 'ask-opt-in', layoutSettings: { position: 'bottom-banner' } }, p);
  assert.deepEqual(bad.map((b) => b.key).sort(), ['complianceType', 'position']);
});

test('edit_funnel set-cookie-consent: previews, writes the whole object once, and verifies on a separate GET', async () => {
  const calls = []; let saved = null;
  const d = { state: {}, rereadOptions: { tries: 3, delays: [0, 0, 0] }, makeGw: () => ({ uid: 'U', call: async (m, p, b) => {
    calls.push({ m, p, b });
    if (p.startsWith('/funnels/funnel/fetch/')) return { ok: true, status: 200, json: { data: { _id: 'F1', name: 'Fun', type: 'funnel', steps: [{ id: 'S1', pages: ['P1'] }], ...(saved ? { cookieConsent: 'https://cdn.example/cookie-consent.json' } : {}) } } };
    if (p.startsWith('/funnels/funnel/cookie-consent') && m === 'GET') return saved ? { ok: true, status: 200, json: structuredClone(saved) } : { ok: false, status: 404, json: { message: 'Data url not found' } };
    if (p === '/funnels/funnel/cookie-consent' && m === 'POST') { saved = structuredClone(b); return { ok: true, status: 201, json: {} }; }
    throw new Error(`unexpected ${m} ${p}`);
  } }) };
  const ef = (args) => TOOLS.find((t) => t.name === 'edit_funnel').handler({ locationId: 'L', funnelId: 'F1', op: 'set-cookie-consent', ...args }, d);
  const refused = await ef({ cookieConsent: { enabled: true }, confirm: true });
  assert.equal(refused.ok, false);
  assert.equal(calls.filter((c) => c.m === 'POST').length, 0);
  const cc = { enabled: true, acknowledged: true, complianceType: 'do-not-ask', position: 'top-banner' };
  const pre = await ef({ cookieConsent: cc });
  assert.equal(pre.code, 'CONFIRM_REQUIRED');
  assert.equal(calls.filter((c) => c.m === 'POST').length, 0);
  const r = await ef({ cookieConsent: cc, confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.enabled, r.data.position, r.data.funnelBannerUrl], [true, 'top-banner', 'https://cdn.example/cookie-consent.json']);
  assert.equal(saved.complianceType, 'do-not-ask');
});
