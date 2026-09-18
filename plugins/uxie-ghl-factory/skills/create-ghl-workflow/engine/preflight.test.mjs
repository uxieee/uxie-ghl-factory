import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReadinessChecks, runReadinessChecks } from './preflight.mjs';

const T = [
  { id: 'a', type: 'sms', name: 'S' }, { id: 'b', type: 'email', name: 'E' },
  { id: 'c', type: 'whatsapp', name: 'W' }, { id: 'd', type: 'instagram-dm', name: 'I' },
  { id: 'e', type: 'loop', name: 'L' }, { id: 'f', type: 'chatgpt', name: 'G' },
];
const catalog = { steps: { loop: { gate: { kind: 'allowlist' } }, chatgpt: { premium: true }, sms: {}, email: {}, whatsapp: {}, 'instagram-dm': {} } };

test('planReadinessChecks plans only what the workflow uses, with reasons', () => {
  const plan = planReadinessChecks({ templates: T, triggerTypes: ['ig_comment_on_post', 'facebook_lead_gen'], settings: { senderAddress: { from_number: '+1' } }, catalog });
  const keys = plan.map((p) => p.key).sort();
  assert.deepEqual(keys, ['email_provider', 'facebook', 'gated_type', 'instagram', 'premium', 'sms_number', 'sms_readiness', 'whatsapp']);
  const sms = plan.find((p) => p.key === 'sms_number');
  assert.ok(sms.why.some((w) => w.includes("'S' (sms)")) && sms.why.includes('settings.senderAddress.from_number'));
  assert.deepEqual(planReadinessChecks({ templates: [{ id: 'x', type: 'add_contact_tag' }] }), [], 'a tag-only workflow needs no checks');
});

test('runReadinessChecks: signals verified, unverifiable signals say so (ok null), failures degrade to checked:false', async () => {
  const call = async (_m, p) => {
    if (p.startsWith('/phone-system/numbers')) return { ok: true, json: { phoneNumbers: [{ value: '+61400000000', title: 'AU' }] } };
    if (p.includes('/whatsapp/')) return { ok: true, json: [{ displayPhoneNumber: '+971 58', codeVerificationStatus: 'NOT_VERIFIED' }] };
    if (p.includes('/instagram/')) return { ok: true, json: { pages: [] } };
    if (p.includes('/email/location-email-provider')) throw new Error('down');
    return { ok: false, json: {} };
  };
  const plan = planReadinessChecks({ templates: T, triggerTypes: [], settings: {}, catalog });
  const res = await runReadinessChecks(plan, { call, loc: 'L' });
  const by = Object.fromEntries(res.map((r) => [r.key, r]));
  assert.equal(by.sms_number.ok, true); assert.match(by.sms_number.detail, /AU/);
  assert.equal(by.whatsapp.ok, true); assert.match(by.whatsapp.detail, /none VERIFIED yet/);
  assert.equal(by.instagram.ok, false); assert.match(by.instagram.detail, /no Instagram account connected/);
  assert.equal(by.email_provider.checked, false, 'a thrown signal degrades, never throws');
  assert.equal(by.gated_type.ok, null); assert.equal(by.premium.ok, null);
  assert.match(by.premium.why[0], /chatgpt/);
});

// PREMIUM + SMS READINESS — shapes are the live responses of the test sub-account, 2026-09-18.
const billing = (optIn) => ({ ok: true, json: { data: [{ productAvailability: true, config: { optIn, enabled: false, basePrice: 0.01, markup: 5 } }] } });
const premiumPlan = [{ key: 'premium', why: ['custom_code'] }];

test('premium: asks the builder\'s own per-location route for BOTH products, with the optIn param present', async () => {
  const seen = [];
  const res = await runReadinessChecks(premiumPlan, { loc: 'L', call: async (_m, p) => { seen.push(p); return billing(true); } });
  assert.deepEqual(seen, [
    '/saas-billing-v2/billing-config/LOCATION/L/workflow_premium_actions?optIn=true',
    '/saas-billing-v2/billing-config/LOCATION/L/workflow_ai?optIn=true',
  ]);
  assert.equal(res[0].checked, true); assert.equal(res[0].ok, true);
  assert.match(res[0].detail, /enabled=false/, 'enabled is REPORTED — and an all-false enabled still reads ok, because it is not the gate');
});

test('premium: a product not opted in is UNVERIFIED (null), never false — the reselling fallback is not read', async () => {
  const res = await runReadinessChecks(premiumPlan, { loc: 'L', call: async (_m, p) => billing(!p.includes('workflow_ai')) });
  assert.equal(res[0].checked, true); assert.equal(res[0].ok, null);
  assert.match(res[0].detail, /NOT opted in: workflow_ai/);
  assert.match(res[0].detail, /reselling subscription/);
});

test('premium: an unreadable product is checked:false, not a pass', async () => {
  const res = await runReadinessChecks(premiumPlan, { loc: 'L', call: async (_m, p) => (p.includes('workflow_ai') ? { ok: false, json: null } : billing(true)) });
  assert.equal(res[0].checked, false); assert.equal(res[0].ok, null);
  assert.match(res[0].detail, /workflow_ai: not readable/);
});

const twilio = (over = {}) => ({ ok: true, json: { twilioSubaccount: { status: 'active' }, blacklistConfig: { isLocationSuspended: false, smsSuspensionTill: null }, isvConfiguration: { isLocationInCoolOffPeriod: false, smsLimitSuspensionTill: '' }, compliance: { customerProfileStatus: '', brands: [], campaigns: [], starterRegistration: { campaignStatus: '', brandData: { status: '' } }, standardRegistration: { campaignStatus: '', brandData: { status: '' } } }, tollFreeData: {}, ...over } });
const smsPlan = [{ key: 'sms_readiness', why: ['step sms'] }];

test('sms_readiness: UPPERCASE entityType, raw fields, and an empty A2P registration is NOT judged', async () => {
  const seen = [];
  const res = await runReadinessChecks(smsPlan, { loc: 'L', call: async (_m, p) => { seen.push(p); return twilio(); } });
  assert.deepEqual(seen, ['/phone-system/twilio-accounts?entityId=L&entityType=LOCATION']);
  assert.equal(res[0].checked, true); assert.equal(res[0].ok, null, 'status strings are never turned into a verdict');
  assert.match(res[0].detail, /subaccount=active/);
});

test('sms_readiness: the two booleans GHL names itself ARE judged', async () => {
  const s = await runReadinessChecks(smsPlan, { loc: 'L', call: async () => twilio({ blacklistConfig: { isLocationSuspended: true, smsSuspensionTill: '2026-10-01' } }) });
  assert.equal(s[0].ok, false); assert.match(s[0].detail, /SUSPENDED/); assert.match(s[0].detail, /2026-10-01/);
  const c = await runReadinessChecks(smsPlan, { loc: 'L', call: async () => twilio({ isvConfiguration: { isLocationInCoolOffPeriod: true, smsLimitSuspensionTill: '' } }) });
  assert.equal(c[0].ok, false); assert.match(c[0].detail, /COOL-OFF/);
});
