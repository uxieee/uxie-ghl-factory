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

test('from_email is planned for a full literal address — and NOT for a merge field or a bare local part (controls)', () => {
  const keys = (from_email) => planReadinessChecks({ settings: { senderAddress: { from_email } } }).map((p) => p.key);
  assert.ok(keys('hello@acme.example').includes('from_email'));
  assert.equal(planReadinessChecks({ settings: { senderAddress: { from_email: 'hello@acme.example' } } }).find((p) => p.key === 'from_email').fromEmail, 'hello@acme.example');
  assert.equal(keys('{{user.email}}').includes('from_email'), false);
  assert.equal(keys('hello').includes('from_email'), false);
  assert.equal(keys(undefined).includes('from_email'), false);
});

test('from_email POSTs {fromEmail, domain-from-the-address} and reports GHL\'s verdict as an advisory row', async () => {
  const sent = [];
  const call = async (method, path, body) => {
    sent.push({ method, path, body });
    return { ok: true, status: 200, json: { isFromEmailAllowed: false, code: 'free_webmail_blocked', message: 'Free webmail is blocked', fromEmailSuggestions: ['hello@mail.acme.example'] } };
  };
  const [row] = await runReadinessChecks([{ key: 'from_email', why: ['settings.senderAddress.from_email'], fromEmail: 'Someone@Gmail.com' }], { call, loc: 'LOC' });
  assert.deepEqual(sent, [{ method: 'POST', path: '/workflow/LOC/email/validate-from-email', body: { fromEmail: 'Someone@Gmail.com', domain: 'gmail.com' } }]);
  assert.equal(row.checked, true);
  assert.equal(row.ok, false);
  assert.equal(row.code, 'free_webmail_blocked');
  assert.deepEqual(row.suggestions, ['hello@mail.acme.example']);
  assert.match(row.detail, /free_webmail_blocked/);
  assert.match(row.detail, /per-step From/i);
});

test('CONTROL: an allowed address is ok:true; an unreadable answer is checked:false with ok:null — never a guess', async () => {
  const allowed = await runReadinessChecks([{ key: 'from_email', why: ['x'], fromEmail: 'a@acme.example' }],
    { call: async () => ({ ok: true, status: 200, json: { isFromEmailAllowed: true, code: 'success' } }), loc: 'LOC' });
  assert.equal(allowed[0].ok, true);
  const dead = await runReadinessChecks([{ key: 'from_email', why: ['x'], fromEmail: 'a@acme.example' }],
    { call: async () => ({ ok: false, status: 500, json: {} }), loc: 'LOC' });
  assert.equal(dead[0].checked, false);
  assert.equal(dead[0].ok, null);
});

test('CONTROL: a hand-built plan entry with no literal From address sends NOTHING — never a guessed body', async () => {
  const sent = [];
  const call = async (method, path, body) => { sent.push({ method, path, body }); return { ok: true, status: 200, json: { isFromEmailAllowed: true, code: 'success' } }; };
  for (const entry of [{ key: 'from_email', why: ['hand-built'] }, { key: 'from_email', why: ['bare local part'], fromEmail: 'hello' }]) {
    const [row] = await runReadinessChecks([entry], { call, loc: 'LOC' });
    assert.deepEqual(sent, [], 'a write-method route is never reached without a literal address');
    assert.equal(row.checked, false);
    assert.equal(row.ok, null);
    assert.match(row.detail, /nothing sent/);
  }
});

// ── ai_agent model ids are per-account and GHL retires them IN PLACE ─────────────────────────
// Measured on the designated sandbox 2026-09-21: 32 models, defaultModelId gpt-5.6-luna, and
// gpt-5 / gpt-5.1 / gpt-5.2 / gpt-5-mini / gpt-4.1 all `deprecated: true`. Our catalogue freezes
// a model literal into ai_agent's uiDefaults, so a step that omits one is written with whatever
// was current the day the catalogue was captured. Before this check nothing in the engine read
// the account's roster at all.
const MODELS = {
  defaultModelId: 'gpt-5.6-luna',
  models: [
    { id: 'gpt-5.6-luna', deprecated: false, recommended: true },
    { id: 'gpt-5-nano', deprecated: false, recommended: false },
    { id: 'gpt-5.2', deprecated: true, recommended: false },
  ],
};
const agentStep = (model) => ({ id: 'z', type: 'ai_agent', name: 'A', attributes: { model } });
const runOne = (templates, json) => runReadinessChecks(
  planReadinessChecks({ templates, catalog: { steps: { ai_agent: {} } } }),
  { loc: 'L', call: async () => ({ ok: true, status: 200, json }) },
);

test('a model the account does not offer is reported ok:false, naming it', async () => {
  const [r] = await runOne([agentStep('gpt-4o-imaginary')], MODELS);
  assert.equal(r.key, 'ai_model');
  assert.equal(r.checked, true);
  assert.equal(r.ok, false);
  assert.match(r.detail, /NOT offered on this location: gpt-4o-imaginary/);
});

test('a DEPRECATED model still runs, so it warns rather than failing', async () => {
  const [r] = await runOne([agentStep('gpt-5.2')], MODELS);
  assert.equal(r.ok, true, 'deprecated is served — failing the check would block a working build');
  assert.match(r.detail, /DEPRECATED.*gpt-5\.2/);
});

test('a model that is offered and current passes, and reports the account default', async () => {
  const [r] = await runOne([agentStep('gpt-5.6-luna')], MODELS);
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.detail, /NOT offered|DEPRECATED/);
  assert.match(r.detail, /its default is gpt-5\.6-luna/);
});

test('an unreadable model list is UNVERIFIED, never "fine"', async () => {
  // The distinction this whole module exists for: ok:null means we could not look, and the detail
  // must not let that be read as a pass.
  const [r] = await runOne([agentStep('anything')], null);
  assert.equal(r.checked, false);
  assert.equal(r.ok, null);
  assert.match(r.detail, /NOT thereby known to be good/);
});

test('a merge-field model is not judged, and a workflow with no ai_agent plans no check', async () => {
  // {{...}} resolves at run time; asserting on the literal would be a false alarm.
  assert.equal(planReadinessChecks({ templates: [agentStep('{{contact.model}}')], catalog: { steps: { ai_agent: {} } } })
    .some((e) => e.key === 'ai_model'), false);
  assert.equal(planReadinessChecks({ templates: [{ id: 'q', type: 'sms', name: 'S' }], catalog: { steps: { sms: {} } } })
    .some((e) => e.key === 'ai_model'), false);
});
