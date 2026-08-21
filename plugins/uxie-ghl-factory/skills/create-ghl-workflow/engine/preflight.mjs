// ACCOUNT-READINESS PRE-FLIGHT (G15) — "it compiled, but will it FUNCTION on this account?"
//
// A workflow can be byte-perfect and still be dead on a given location: no SMS number
// provisioned, WhatsApp unverified, Instagram/Facebook not connected, email domain still
// warming, a gated type (loop) not allowlisted, premium steps with no verifiable credit state.
// This module plans and runs ONLY the checks the compiled workflow actually needs, and reports
// advisorily — it never blocks a build (the account can be fixed after the draft exists).
//
// Signals (all live-proven GROM AU 2026-08-22, all read-only, all on the engine's Bearer rail):
//   SMS        GET /phone-system/numbers?locationId=            {phoneNumbers:[{value,title}]}
//   WhatsApp   GET /phone-system/whatsapp/location/{loc}/phone-numbers   [{displayPhoneNumber,
//              codeVerificationStatus, accountMode, …}]
//   Instagram  GET /workflow/{loc}/instagram/connected-accounts?unique=true   {pages:[…]}
//   Email      GET /workflow/{loc}/email/location-email-provider   {provider:{domain,…},
//              warmupInfo:{warmupStage,warmupStatus,warmupMode}, type}
// Known-unverifiable from this rail (reported as `checked:false`, never guessed): premium
// credits/rebilling (SaaS app's plane), Facebook page linkage (no discovery route recovered),
// Slack (/integration/slack/integrations 404s on this rail), review platforms.

const SMS_TYPES = new Set(['sms', 'manual-sms']);
const IG_TYPES = new Set(['instagram-dm', 'ig_interactive_messenger']);
const IG_TRIGGERS = new Set(['ig_comment_on_post', 'ig_follower_added']);
const FB_TYPES = new Set(['messenger', 'fb_interactive_messenger']);
const FB_TRIGGERS = new Set(['facebook_comment_on_post', 'facebook_lead_gen']);
const isWhatsApp = (t) => /whatsapp/i.test(t ?? '');

/** Pure: which checks does THIS compiled workflow need? Returns [{key, why:[…]}]. */
export function planReadinessChecks({ templates = [], triggerTypes = [], settings = {}, catalog = null } = {}) {
  const plan = new Map();
  const need = (key, why) => { const e = plan.get(key) ?? { key, why: [] }; if (!e.why.includes(why)) e.why.push(why); plan.set(key, e); };
  for (const t of templates) {
    const ty = t?.type; if (!ty) continue;
    if (SMS_TYPES.has(ty)) need('sms_number', `step '${t.name ?? t.id}' (${ty})`);
    if (isWhatsApp(ty)) need('whatsapp', `step '${t.name ?? t.id}' (${ty})`);
    if (IG_TYPES.has(ty)) need('instagram', `step '${t.name ?? t.id}' (${ty})`);
    if (FB_TYPES.has(ty)) need('facebook', `step '${t.name ?? t.id}' (${ty})`);
    if (ty === 'email') need('email_provider', `step '${t.name ?? t.id}' (email)`);
    // loadCatalog() exposes a step(type) LOOKUP; raw catalog.data.json exposes .steps — accept both
    const entry = catalog?.steps?.[ty] ?? (typeof catalog?.step === 'function' ? catalog.step(ty) : null);
    if (entry?.gate) need('gated_type', `step '${t.name ?? t.id}' (${ty} is availability-gated: ${entry.gate.kind ?? 'allowlist'})`);
    if (entry?.premium) need('premium', `${ty}`);
  }
  for (const ty of triggerTypes) {
    if (IG_TRIGGERS.has(ty)) need('instagram', `trigger ${ty}`);
    if (FB_TRIGGERS.has(ty)) need('facebook', `trigger ${ty}`);
  }
  if (settings?.senderAddress?.from_number) need('sms_number', 'settings.senderAddress.from_number');
  if (settings?.senderAddress?.from_email) need('email_provider', 'settings.senderAddress.from_email');
  return [...plan.values()];
}

/**
 * Run the planned checks (read-only GETs; every failure degrades to checked:false, never throws).
 * Returns [{key, why, checked, ok, detail}] — `ok` is null when the signal cannot be verified
 * from this rail (premium/facebook), so the caller can say "unverified", not "fine".
 */
export async function runReadinessChecks(plan, { call, loc }) {
  const g = async (p) => { try { const r = await call('GET', p); return r?.ok ? r.json : null; } catch { return null; } };
  const lq = new URLSearchParams({ locationId: String(loc) });
  const lp = encodeURIComponent(String(loc));
  const out = [];
  for (const { key, why } of plan) {
    if (key === 'sms_number') {
      const j = await g(`/phone-system/numbers?${lq}`);
      const nums = Array.isArray(j?.phoneNumbers) ? j.phoneNumbers : [];
      out.push({ key, why, checked: j != null, ok: nums.length > 0, detail: nums.length ? `${nums.length} number(s): ${nums.map((n) => n.title ?? n.value).join(', ')}` : 'NO SMS number provisioned on this location — SMS steps will not send' });
    } else if (key === 'whatsapp') {
      const j = await g(`/phone-system/whatsapp/location/${lp}/phone-numbers`);
      const nums = Array.isArray(j) ? j : (Array.isArray(j?.phoneNumbers) ? j.phoneNumbers : []);
      const verified = nums.filter((n) => n.codeVerificationStatus === 'VERIFIED');
      out.push({ key, why, checked: j != null, ok: nums.length > 0, detail: nums.length ? `${nums.length} WhatsApp number(s); verification: ${nums.map((n) => `${n.displayPhoneNumber ?? '?'}=${n.codeVerificationStatus ?? '?'}`).join(', ')}${verified.length ? '' : ' — none VERIFIED yet'}` : 'no WhatsApp number connected' });
    } else if (key === 'instagram') {
      const j = await g(`/workflow/${lp}/instagram/connected-accounts?unique=true`);
      const pages = Array.isArray(j?.pages) ? j.pages : [];
      out.push({ key, why, checked: j != null, ok: pages.length > 0, detail: pages.length ? `${pages.length} connected IG account(s)` : 'no Instagram account connected — IG steps/triggers will not fire' });
    } else if (key === 'email_provider') {
      const j = await g(`/workflow/${lp}/email/location-email-provider`);
      const w = j?.warmupInfo ?? j?.provider?.warmupInfo ?? null;
      out.push({ key, why, checked: j != null, ok: j != null, detail: j ? `provider ${j.type ?? '?'}${j.provider?.domain ? ` (${j.provider.domain})` : ''}${w ? `; warmup ${w.warmupStatus ?? '?'} (stage ${w.warmupStage ?? '?'}, ${w.warmupMode ?? '?'})` : ''}` : 'email provider config not readable' });
    } else if (key === 'gated_type') {
      out.push({ key, why, checked: false, ok: null, detail: 'this type is availability-gated per location (e.g. loop allowlist) — the build may save but the type can be non-functional here; the gate list is not readable from this rail' });
    } else if (key === 'premium') {
      out.push({ key, why: [`premium step type(s): ${why.join(', ')}`], checked: false, ok: null, detail: 'premium (credit-billed) steps — wallet/rebilling state is the SaaS plane and not verifiable from this rail; confirm credits or rebilling are enabled for this location' });
    } else if (key === 'facebook') {
      out.push({ key, why, checked: false, ok: null, detail: 'Facebook page linkage has no discovery route on this rail — verify the page connection in Integrations before relying on FB steps/triggers' });
    } else {
      out.push({ key, why, checked: false, ok: null, detail: 'no signal known for this check' });
    }
  }
  return out;
}
