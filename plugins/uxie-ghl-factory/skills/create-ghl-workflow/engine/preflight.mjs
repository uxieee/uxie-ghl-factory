// ACCOUNT-READINESS PRE-FLIGHT (G15) — "it compiled, but will it FUNCTION on this account?"
//
// A workflow can be byte-perfect and still be dead on a given location: no SMS number
// provisioned, WhatsApp unverified, Instagram/Facebook not connected, email domain still
// warming, a gated type (loop) not allowlisted, premium steps with no verifiable credit state.
// This module plans and runs ONLY the checks the compiled workflow actually needs, and reports
// advisorily — it never blocks a build (the account can be fixed after the draft exists).
//
// Signals (none of them writes or sends, all on the engine's Bearer rail; SMS/WhatsApp/IG/Email
// live-proven GROM AU 2026-08-22):
//   SMS        GET /phone-system/numbers?locationId=            {phoneNumbers:[{value,title}]}
//   WhatsApp   GET /phone-system/whatsapp/location/{loc}/phone-numbers   [{displayPhoneNumber,
//              codeVerificationStatus, accountMode, …}]
//   Instagram  GET /workflow/{loc}/instagram/connected-accounts?unique=true   {pages:[…]}
//   Email      GET /workflow/{loc}/email/location-email-provider   {provider:{domain,…},
//              warmupInfo:{warmupStage,warmupStatus,warmupMode}, type}
//   From addr  POST /workflow/{loc}/email/validate-from-email  {fromEmail, domain} -> {isFromEmailAllowed,
//              code, message, fromEmailSuggestions}. The builder's own check, and the ONLY non-GET here.
//              🔴 NO SEND OBSERVED 2026-09-19 — read that as the weak claim it is. No inbox or
//              conversation read-back has been done against this route, so "it sends nothing" rests on
//              the route's purpose and on no delivery having been noticed, NOT on a measurement. The
//              2026-09-19 differential (free webmail -> free_webmail_blocked, a real company domain ->
//              success, a domain with no DNS -> dmarc_record_not_found) proves only that the route
//              discriminates by DOMAIN; a differential over return codes cannot see whether mail left
//              the building. Establishing send-nothing by read-back is OWED, and until it is done this
//              is the one signal here whose safety is asserted rather than proven.
//              Covers the workflow-level From only — a per-step From override is not read.
//   Premium    GET /saas-billing-v2/billing-config/LOCATION/{loc}/{product}?optIn=true
//              product = workflow_premium_actions | workflow_ai   {data:[{config:{optIn,enabled,
//              basePrice,markup}, productAvailability}]}   (live-proven test sub-account 2026-09-18)
//              This is the builder's OWN call (SaasService.checkForWorkflowBillingPlan) and it gates
//              the step drawer on `config.optIn`. 🔴 The `optIn` query param switches the ANSWER by
//              its PRESENCE, not its value: with it (even `optIn=false`) the route returns the
//              effective opt-in the agency roster also reports; without it, a raw `optIn:false`.
//              🔴 `config.enabled` is NOT the gate — it was false on every sub-account of an agency
//              whose premium steps run daily. It is reported, never judged.
//   SMS ready  GET /phone-system/twilio-accounts?entityId={loc}&entityType=LOCATION  (UPPERCASE)
//              Raw fields only. What each status value MEANS for deliverability is not established,
//              so this check never sets ok:false — it puts the fields in front of a human.
// Known-unverifiable from this rail (reported as `checked:false`, never guessed): wallet BALANCE,
// Facebook page linkage (no discovery route recovered), Slack (/integration/slack/integrations
// 404s on this rail), review platforms.

const SMS_TYPES = new Set(['sms', 'manual-sms']);
const IG_TYPES = new Set(['instagram-dm', 'ig_interactive_messenger']);
const IG_TRIGGERS = new Set(['ig_comment_on_post', 'ig_follower_added']);
const FB_TYPES = new Set(['messenger', 'fb_interactive_messenger']);
const FB_TRIGGERS = new Set(['facebook_comment_on_post', 'facebook_lead_gen']);
const PREMIUM_PRODUCTS = Object.freeze(['workflow_premium_actions', 'workflow_ai']);
const isWhatsApp = (t) => /whatsapp/i.test(t ?? '');

/** Pure: which checks does THIS compiled workflow need? Returns [{key, why:[…]}]. */
export function planReadinessChecks({ templates = [], triggerTypes = [], settings = {}, catalog = null } = {}) {
  const plan = new Map();
  const need = (key, why) => { const e = plan.get(key) ?? { key, why: [] }; if (!e.why.includes(why)) e.why.push(why); plan.set(key, e); };
  for (const t of templates) {
    const ty = t?.type; if (!ty) continue;
    if (SMS_TYPES.has(ty)) { need('sms_number', `step '${t.name ?? t.id}' (${ty})`); need('sms_readiness', `step '${t.name ?? t.id}' (${ty})`); }
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
  if (settings?.senderAddress?.from_email) {
    need('email_provider', 'settings.senderAddress.from_email');
    // Only a full LITERAL address can be judged: a merge field resolves at send time, and a bare
    // local part is legal under "All Domains" (GHL appends the sending domain itself).
    const from = String(settings.senderAddress.from_email).trim();
    if (!from.includes('{{') && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
      need('from_email', 'settings.senderAddress.from_email');
      plan.get('from_email').fromEmail = from;
    }
  }
  return [...plan.values()];
}

/**
 * Run the planned checks (reads, plus one POST that validates and sends nothing; every failure
 * degrades to checked:false, never throws).
 * Returns [{key, why, checked, ok, detail}] — `ok` is null when the signal cannot be verified
 * from this rail (premium/facebook), so the caller can say "unverified", not "fine".
 */
export async function runReadinessChecks(plan, { call, loc }) {
  const g = async (p) => { try { const r = await call('GET', p); return r?.ok ? r.json : null; } catch { return null; } };
  const post = async (p, body) => { try { const r = await call('POST', p, body); return r?.ok ? r.json : null; } catch { return null; } };
  const lq = new URLSearchParams({ locationId: String(loc) });
  const lp = encodeURIComponent(String(loc));
  const out = [];
  for (const entry of plan) { const { key, why } = entry;
    if (key === 'sms_number') {
      const j = await g(`/phone-system/numbers?${lq}`);
      const nums = Array.isArray(j?.phoneNumbers) ? j.phoneNumbers : [];
      out.push({ key, why, checked: j != null, ok: nums.length > 0, detail: nums.length ? `${nums.length} number(s): ${nums.map((n) => n.title ?? n.value).join(', ')}` : 'NO SMS number provisioned on this location — SMS steps will not send' });
    } else if (key === 'sms_readiness') {
      // A location with a good number can still be unable to send. RAW FIELDS ONLY: the two
      // booleans GHL names itself (suspended, cool-off) are the only things judged; every STATUS
      // STRING is printed as-is, because what each value means for delivery is not established.
      const j = await g(`/phone-system/twilio-accounts?${new URLSearchParams({ entityId: String(loc), entityType: 'LOCATION' })}`);
      const c = j?.compliance ?? {};
      const reg = (r) => `brand=${r?.brandData?.status || '∅'}, campaign=${r?.campaignStatus || '∅'}`;
      const suspended = j?.blacklistConfig?.isLocationSuspended === true;
      const coolOff = j?.isvConfiguration?.isLocationInCoolOffPeriod === true;
      out.push({
        key, why, checked: j != null, ok: j == null ? null : (suspended || coolOff ? false : null),
        detail: j == null ? 'SMS account state not readable'
          : `${suspended ? '🔴 LOCATION SUSPENDED for SMS. ' : ''}${coolOff ? '🔴 location is in an SMS COOL-OFF period. ' : ''}`
            + `subaccount=${j.twilioSubaccount?.status ?? '∅'}; suspended=${j.blacklistConfig?.isLocationSuspended ?? '∅'} (till ${j.blacklistConfig?.smsSuspensionTill ?? '∅'}); `
            + `coolOff=${j.isvConfiguration?.isLocationInCoolOffPeriod ?? '∅'} (limit suspension till ${j.isvConfiguration?.smsLimitSuspensionTill || '∅'}); `
            + `A2P customerProfile=${c.customerProfileStatus || '∅'}; starter[${reg(c.starterRegistration)}]; standard[${reg(c.standardRegistration)}]; `
            + `brands=${Array.isArray(c.brands) ? c.brands.length : '∅'}, campaigns=${Array.isArray(c.campaigns) ? c.campaigns.length : '∅'}; tollFree=${j.tollFreeData && Object.keys(j.tollFreeData).length ? 'present' : '∅'}. `
            + 'Status strings are reported, not judged: an empty A2P registration matters for US/CA long-code traffic and may be irrelevant elsewhere.',
      });
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
      // Both product keys, always: which premium type bills under which key is source-known only
      // for chatgpt + ai_agent (workflow_ai), so the verdict never depends on a guessed mapping.
      const rows = [];
      for (const product of PREMIUM_PRODUCTS) {
        const j = await g(`/saas-billing-v2/billing-config/LOCATION/${lp}/${product}?optIn=true`);
        const d = Array.isArray(j?.data) ? j.data[0] : null;
        rows.push({ product, read: d?.config != null, config: d?.config ?? null, available: d?.productAvailability ?? null });
      }
      const read = rows.filter((r) => r.read);
      const off = read.filter((r) => r.config.optIn !== true);
      const fmt = (r) => r.read ? `${r.product}: optIn=${r.config.optIn}, enabled=${r.config.enabled}, basePrice=${r.config.basePrice}, available=${r.available}` : `${r.product}: not readable`;
      out.push({
        key, why: [`premium step type(s): ${why.join(', ')}`],
        checked: read.length === rows.length,
        // optIn:false is NOT ok:false — GHL's builder falls back to a reselling subscription this
        // rail does not read, so the honest answer is "unverified", with the reason.
        ok: read.length === rows.length && off.length === 0 ? true : null,
        detail: `${rows.map(fmt).join(' | ')}${off.length ? ` — NOT opted in: ${off.map((r) => r.product).join(', ')}${off.some((r) => r.product === 'workflow_ai') ? ' (workflow_ai bills chatgpt + ai_agent steps)' : ''}. GHL's builder shows the "enable premium actions" wall for this product unless the location holds a workflow reselling subscription, which is not checked here` : ''}. Wallet balance is not read.`,
        products: rows,
      });
    } else if (key === 'facebook') {
      out.push({ key, why, checked: false, ok: null, detail: 'Facebook page linkage has no discovery route on this rail — verify the page connection in Integrations before relying on FB steps/triggers' });
    } else if (key === 'from_email') {
      const fromEmail = String(entry.fromEmail ?? '');
      // Never send a guessed body to a write-method route. planReadinessChecks only ever sets a
      // full literal address, but this module is shared and a hand-built entry could arrive
      // without one — that would POST {fromEmail:'', domain:''} rather than report nothing known.
      if (!fromEmail.includes('@')) {
        out.push({ key, why, checked: false, ok: null, detail: 'no literal From address on this plan entry — nothing sent' });
        continue;
      }
      const j = await post(`/workflow/${lp}/email/validate-from-email`, { fromEmail, domain: fromEmail.slice(fromEmail.lastIndexOf('@') + 1).toLowerCase() });
      const readable = j != null && typeof j.isFromEmailAllowed === 'boolean';
      const suggestions = Array.isArray(j?.fromEmailSuggestions) ? j.fromEmailSuggestions : [];
      out.push({
        key, why, checked: readable, ok: readable ? j.isFromEmailAllowed : null,
        ...(readable ? { code: j.code ?? null, suggestions } : {}),
        detail: !readable ? 'From-address verdict not readable'
          : `GHL's own From-address check: ${j.isFromEmailAllowed ? 'allowed' : '🔴 NOT allowed'} (code ${j.code ?? '∅'})${j.message ? ` — ${j.message}` : ''}`
            + `${suggestions.length ? `; GHL suggests: ${suggestions.join(', ')}` : ''}. Advisory: the build is not blocked. `
            + 'Covers the workflow-level From only — a per-step From override on an email step is not checked.',
      });
    } else {
      out.push({ key, why, checked: false, ok: null, detail: 'no signal known for this check' });
    }
  }
  return out;
}
