// GoGHL.ai ("Whatsapp, iMessage and SMS", MessageSync.ai, appId 67fb75c15f402353e5cfaa63) —
// the interactive-message grammars and ban-protection knowledge, as advisory compile checks.
//
// Harvested 2026-08-22 from the installed app's live schemas (a live install, read-only), the vendor
// PDFs and help.goghl.ai (reference/GOGHL-WHATSAPP.md in the research repo). The app's buttons
// and lists are MESSAGE-BODY SYNTAX (`#btn|…`, `#list|…`), so any step body can carry them and
// a malformed line sends as literal text to the contact — the worst-case failure is a customer
// reading "#btn|Welcome!|undefined|…". These checks make that impossible to ship silently.
// Severity: WARNINGS only (ctx.warn) — the syntax lives inside third-party rendering we don't
// control; hatch ctx.skipGoghlCheck.

export const GOGHL_APP_ID = '67fb75c15f402353e5cfaa63';
export const GOGHL_ACTION_KEYS = new Set([
  'send_outbound_whatsapp_message', 'send_group_message_prod', 'send_text_to_speech_message',
  'send_internal_wa_notification', 'send_imessage_action', 'send_android_sms',
  'send_internal_imessage_notification', 'send_internal_android_sms_notification',
  'wait_step', 'change_whatsapp_group_participants',
]);
export const GOGHL_TRIGGER_KEYS = new Set([
  'whatsapp_inbound_prod', 'whatsapp_outbound_prod', 'sms_inbound', 'sms_outbound',
  'imessage_inbound', 'imessage_outbound', 'whatsapp_group_inbound', 'whatsapp_group_trigger',
  'whatsapp_missed_trigger', 'message_failed_prod', 'whatsapp_disconnected_prod',
]);
const BUTTON_TYPES = new Set(['quick_reply', 'cta_url', 'cta_call', 'cta_copy']);

// Vendor's own ban-protection numbers (Drip Mode ms; warm-up phases msgs/day) — for reports.
export const GOGHL_DRIP_MS = Object.freeze({ bulk: 15000, normal: [3000, 5000], warming: [10000, 20000], minimum: 1000 });
export const GOGHL_WARMUP = Object.freeze([
  { phase: 1, days: '1-2', perDay: '10-15' }, { phase: 2, days: '3-5', perDay: '20-30' },
  { phase: 3, days: '6-10', perDay: '50-100' }, { phase: 4, days: '11-14', perDay: '200-300' },
  { phase: 5, days: '15+', perDay: '500-1000+' },
]);

/** Validate one `#btn|…` line. Returns findings (empty = valid). */
export function lintBtn(line) {
  const F = [];
  const parts = String(line).trim().split('|');
  if (parts[0] !== '#btn') return [`not a #btn line`];
  if (parts.length < 5) { F.push(`#btn needs at least 5 segments (#btn|title|subTitle|media|button…) — got ${parts.length}. Unused slots must be the literal 'undefined'.`); return F; }
  if (!parts[1] || parts[1] === 'undefined') F.push(`#btn title (segment 2) is required`);
  const media = parts[3];
  if (media !== 'undefined' && !/^\w+\*\S+/.test(media)) F.push(`#btn media slot must be 'undefined' or 'mediaType*mediaUrl' (e.g. image*https://…) — got '${media}'`);
  const buttons = parts.slice(4);
  if (!buttons.length) F.push(`#btn has no buttons`);
  for (const b of buttons) {
    const seg = b.split('*');
    if (seg.length < 3) { F.push(`button '${b}' needs buttonType*buttonText*value`); continue; }
    const [type, text] = seg; const value = seg.slice(2).join('*');
    if (!BUTTON_TYPES.has(type)) F.push(`button type '${type}' is not one of ${[...BUTTON_TYPES].join(', ')}`);
    if (!text) F.push(`button of type '${type}' has empty text`);
    if (type === 'cta_url' && !/^https?:\/\//i.test(value)) F.push(`cta_url value '${value}' is not an http(s) URL`);
    if (type === 'cta_call' && !/^\+?[0-9][0-9 ()-]{5,}$/.test(value)) F.push(`cta_call value '${value}' does not look like a phone number (use +countrycode…)`);
    if ((type === 'quick_reply' || type === 'cta_copy') && !value) F.push(`${type} needs a non-empty ${type === 'quick_reply' ? 'buttonId' : 'text to copy'}`);
  }
  return F;
}

/** Validate one `#list|…` line. */
export function lintList(line) {
  const F = [];
  const parts = String(line).trim().split('|');
  if (parts[0] !== '#list') return [`not a #list line`];
  if (parts.length !== 6) { F.push(`#list needs exactly 6 segments (#list|title|description|footer|buttonText|sections) — got ${parts.length}; unused slots must be 'undefined'`); return F; }
  if (!parts[2] || parts[2] === 'undefined') F.push(`#list description (segment 3) is REQUIRED`);
  const rows = parts[5].split('/').filter((r) => r.trim() !== '');
  if (!rows.length) F.push(`#list has no section rows`);
  for (const r of rows) {
    const seg = r.split('*');
    if (seg.length !== 4) F.push(`list row '${r.slice(0, 50)}' must be Section*OptionTitle*Description*ID (4 fields, got ${seg.length})`);
    else if (seg.some((x) => !x.trim())) F.push(`list row '${r.slice(0, 50)}' has an empty field`);
  }
  const ids = rows.map((r) => r.split('*')[3]).filter(Boolean);
  if (new Set(ids).size !== ids.length) F.push(`#list option IDs must be unique (duplicates present)`);
  return F;
}

/** Spintax `{a|b|c}` lint: balance + vendor rules (3-4 options, max 7; no nesting documented). */
export function lintSpintax(text) {
  const F = [];
  const s = String(text);
  // strip merge tags so {{contact.x}} braces don't read as spintax
  const t = s.replace(/\{\{[^}]*\}\}/g, '');
  let depth = 0;
  for (const ch of t) { if (ch === '{') { depth++; if (depth > 1) { F.push('nested spintax {…{…}…} is not documented by the vendor — flatten it'); break; } } else if (ch === '}') { if (depth === 0) { F.push('unbalanced spintax braces (stray })'); break; } depth--; } }
  if (depth > 0 && !F.length) F.push('unbalanced spintax braces (unclosed {)');
  for (const m of t.matchAll(/\{([^{}]*)\}/g)) {
    const opts = m[1].split('|');
    if (opts.length < 2) continue;                            // a lone {word} is not spintax
    if (opts.length > 7) F.push(`spintax bracket has ${opts.length} options — vendor rule: 3-4, never more than 7`);
    if (opts.some((o) => o.trim() === '')) F.push(`spintax bracket '{${m[1].slice(0, 30)}…}' has an empty option`);
  }
  return F;
}

/** Advisory pass over compiled templates: lint every #btn/#list line and spintax in string attrs. */
export function checkGoghlSyntax(templates, ctx = {}) {
  if (ctx.skipGoghlCheck === true) return [];
  const warn = (m) => { if (typeof ctx.warn === 'function') ctx.warn(m); };
  const findings = [];
  for (const t of templates ?? []) {
    const texts = [];
    const walk = (v) => { if (typeof v === 'string') texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(t?.attributes);
    for (const s of texts) {
      for (const line of s.split(/\r?\n/)) {
        const l = line.trim();
        let F = null;
        if (l.startsWith('#btn|') || l === '#btn') F = lintBtn(l);
        else if (l.startsWith('#list|') || l === '#list') F = lintList(l);
        if (F && F.length) { findings.push(...F); for (const f of F) warn(`GoGHL ${l.split('|')[0]} on '${t.name ?? t.id}': ${f} — a malformed line is sent to the contact as LITERAL TEXT.`); }
      }
      if (/\{[^{}]*\|[^{}]*\}/.test(s.replace(/\{\{[^}]*\}\}/g, ''))) {
        const F = lintSpintax(s);
        if (F.length) { findings.push(...F); for (const f of F) warn(`GoGHL spintax on '${t.name ?? t.id}': ${f}`); }
      }
    }
  }
  return findings;
}
