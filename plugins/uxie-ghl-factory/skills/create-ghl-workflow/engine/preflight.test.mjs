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
  assert.deepEqual(keys, ['email_provider', 'facebook', 'gated_type', 'instagram', 'premium', 'sms_number', 'whatsapp']);
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
