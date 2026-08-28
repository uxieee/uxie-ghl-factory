// MERGE-TAG check. A {{tag}} GHL cannot resolve renders as LITERAL TEXT and nothing in GHL
// catches it — {{appointment.date}}/{{appointment.time}} reached real customers for three
// weeks (F5-27). Policy is derived from the renderer's SOURCE (recovered-source/src/utils/
// merge_tags.ts), never from corpus counts: a replay once flipped `appointment` to "open" on a
// single published typo, and the engine restated that artefact as fact. The catalog still ships
// that verdict as mergeTags.closedNamespaces (6 namespaces, appointment listed OPEN) — do not
// read it here; it is the bug.
//
//   closed       literal picker menus (appointmentTagOption :585, userTagOption, calendar,
//                right_now, message, phoneCall, getDocumentOptions :994, location(_owner),
//                membership_contact)                                → unknown key = ERROR
//   perLocation  static menu ∪ THIS location's list: contact custom fields (:2931-2945),
//                opportunity custom fields (same customFields/search, model=opportunity),
//                custom values (:2987)                              → ERROR when the list was
//                                                                     fetched, WARNING otherwise
//   gated        literal menus shown only under a matching trigger/action
//                (isTriggerTypePresent) — vocabulary complete, resolvability is a later check
//                                                                   → unknown key = WARNING
//   ownedElsewhere  step outputs / webhook paths (step-outputs.mjs, webhook-rail.mjs) → skipped
//   anything else   {{appt.time}}, {{contactt.name}}               → WARNING
// Hatches: ctx.skipMergeTagCheck (skip all), ctx.strictMergeTags === false (errors → warnings).
import { IRError } from './ir.mjs';

export const NAMESPACE_POLICY = Object.freeze({
  closed: new Set(['appointment', 'user', 'calendar', 'right_now', 'message', 'phoneCall', 'document',
    'location', 'location_owner', 'membership_contact']),
  perLocation: Object.freeze({ contact: 'customFields', opportunity: 'customFields', custom_values: 'customValues' }),
  gated: new Set(['task', 'note', 'form_data', 'survey_data', 'invoice', 'order', 'payment', 'event',
    'membership', 'subscription', 'refund', 'inboundEmail', 'mailgun_email_event', 'voice_ai', 'conversations_ai']),
  ownedElsewhere: new Set(['custom_webhook', 'custom_code', 'chatgpt', 'ai_agent', 'inboundWebhookRequest',
    'trigger_link', 'datetime_formatter', 'text_formatter', 'number_formatter', 'math_operation',
    'array_functions', 'loop', 'ai_field', 'conversationai_objective', 'affiliate_new_lead', 'contactMethod',
    'cancellation_link', 'reschedule_link', 'task-notification']),
  ignore: new Set(['else', 'this', 'if', 'unless', 'each', 'with']),
  // Corpus-attested tags the picker does not list. Add nothing here without live proof.
  allow: new Set(['{{location.id}}']),
});

// The picker's "Assigned User" sub-menu (childUserMenu(ns), merge_tags.ts:55, used at :699 and
// :896) is a template-literal site the harvest skipped, so the catalog lacks these 18 static tags.
// Kept here until the extractor expands them; the staleness test names this list for deletion.
const CHILD_USER_KEYS = ['id', 'name', 'first_name', 'last_name', 'email', 'phone', 'phone_raw', 'email_signature', 'twilio_phone_number'];
export const ENGINE_STATIC_TAGS = ['appointment', 'task'].flatMap((ns) => CHILD_USER_KEYS.map((k) => `{{${ns}.user.${k}}}`));

const TOKEN = /\{\{\s*([A-Za-z_][\w-]*)((?:\.[^{}]*)?)\s*\}\}/g;
const compact = (s) => String(s ?? '').replace(/\s+/g, '');
const split = (full) => { const m = /^\{\{([^.}]+)\.?(.*)\}\}$/.exec(full); return m ? { ns: m[1], key: m[2] } : null; };

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Nearest real tags in the SAME namespace: edit distance <= 2 on the key, or a shared / prefixed
// word ({{appointment.day}} -> day_of_week). Cheap: 9 lookups over 420 tags in ~4 ms.
//
// A SHARED WHOLE WORD outranks raw edit distance, and by a margin no distance can close. Distance
// alone scores by key LENGTH, which is backwards for this vocabulary: for {{appointment.time}} it
// ranked `title` (distance 2, shares nothing, means something else entirely) above
// `only_start_time` (distance 11, the tag the author actually wanted), and pushed it out of the
// top 4 altogether. GHL's keys are long compounds of short words, so containment is the signal.
export function suggestTags(full, candidates, limit = 4) {
  const q = split(full); if (!q) return [];
  const words = q.key.split(/[._]/).filter(Boolean);
  const scored = [];
  for (const c of candidates) {
    const s = split(c); if (!s || s.ns !== q.ns || c === full) continue;
    const d = editDistance(q.key, s.key);
    const cw = s.key.split(/[._]/).filter(Boolean);
    const shared = cw.filter((w) => words.includes(w)).length;
    const prefix = words.some((w) => cw.some((x) => x.startsWith(w) || w.startsWith(x)));
    if (d <= 2 || shared > 0 || prefix) scored.push({ c, score: shared * -100 + (d <= 2 ? 0 : 10) + d - (prefix ? 1 : 0) });
  }
  return scored.sort((a, b) => a.score - b.score || a.c.localeCompare(b.c)).slice(0, limit).map((x) => x.c);
}

function perLocationVocabulary(ns, opts) {
  const source = NAMESPACE_POLICY.perLocation[ns];
  const list = opts?.[source];
  if (!Array.isArray(list)) return null;                                   // not fetched -> unverifiable
  if (source === 'customFields') {
    return new Set(list
      .filter((f) => (ns === 'contact' ? (f.model ?? 'contact') === 'contact' : f.model === 'opportunity'))
      .map((f) => `{{${compact(f.fieldKey)}}}`));
  }
  return new Set(list.map((v) => { const k = compact(v.fieldKey); return k.startsWith('{{') ? k : `{{custom_values.${k.replace(/^custom_values\./, '')}}}`; }));
}

export function evaluateMergeTags(templates, mergeTags, opts = {}) {
  if (!mergeTags?.tags) return [];
  const staticTags = new Set([...mergeTags.tags.map((t) => compact(t.tag)), ...ENGINE_STATIC_TAGS, ...NAMESPACE_POLICY.allow]);
  const P = NAMESPACE_POLICY;
  const out = [];
  const walk = (v, cb) => { if (typeof v === 'string') cb(v); else if (Array.isArray(v)) v.forEach((x) => walk(x, cb)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, cb)); };
  for (const t of templates ?? []) {
    if (!t?.attributes || t.type === 'transition') continue;
    const where = `'${t.name ?? t.id}' (${t.type})`;
    walk(t.attributes, (s) => {
      const opens = (s.match(/\{\{/g) ?? []).length, closes = (s.match(/\}\}/g) ?? []).length;
      if (opens !== closes) out.push({ where, kind: 'unbalanced', severity: 'warning', ns: null, tag: null, suggestions: [],
        msg: `unbalanced merge-tag braces (${opens} '{{' vs ${closes} '}}') in "${s.slice(0, 60)}${s.length > 60 ? '…' : ''}"` });
      for (const m of s.matchAll(TOKEN)) {
        const ns = m[1], full = `{{${ns}${compact(m[2])}}}`;
        if (P.ignore.has(ns) || P.ownedElsewhere.has(ns) || staticTags.has(full)) continue;
        const candidates = [...staticTags];
        const push = (severity, kind, msg) => out.push({ where, kind, severity, ns, tag: full, suggestions: suggestTags(full, candidates), msg });
        if (P.perLocation[ns]) {
          const vocab = perLocationVocabulary(ns, opts);
          if (vocab === null) { push('warning', 'unknown', `${full} is not a picker tag and this location's ${P.perLocation[ns]} were not fetched — unverifiable; it renders literally if the field does not exist`); continue; }
          if (vocab.has(full)) continue;
          candidates.push(...vocab);
          push('error', 'unknown', `${full} is not a picker tag and not one of this location's ${vocab.size} ${P.perLocation[ns]} — it will render literally`);
          continue;
        }
        if (P.closed.has(ns)) { push('error', 'unknown', `${full} is not a picker variable in the closed namespace '${ns}' — it will render literally at runtime`); continue; }
        if (P.gated.has(ns)) { push('warning', 'unknown', `${full} is not a picker variable in '${ns}' (a trigger/action-gated menu) — it will render literally unless a matching trigger/action provides it`); continue; }
        push('warning', 'unknown-namespace', `${full} uses a namespace the picker does not list ('${ns}') — it will render literally`);
      }
    });
  }
  for (const f of out) if (f.suggestions.length) f.msg += ` (did you mean ${f.suggestions.join(', ')}?)`;
  return out;
}

export function checkMergeTags(templates, catalog, ctx) {
  if (ctx?.skipMergeTagCheck === true) return [];
  const F = evaluateMergeTags(templates, catalog?.mergeTags, { customFields: ctx?.customFields, customValues: ctx?.customValues });
  const errors = F.filter((f) => f.severity === 'error');
  for (const f of F) if (f.severity === 'warning') ctx?.warn?.(`MERGE_TAG_SOFT: ${f.where}: ${f.msg}`);
  if (errors.length && ctx?.strictMergeTags === false) { for (const f of errors) ctx?.warn?.(`MERGE_TAG: ${f.where}: ${f.msg}`); return F; }
  if (errors.length)
    throw new IRError('MERGE_TAG_UNKNOWN',
      `MERGE_TAG_UNKNOWN: ${errors.length} merge tag(s) GHL cannot resolve — they would go out as literal text:\n`
      + errors.map((f) => `  ${f.where}: ${f.msg}`).join('\n')
      + `\nAuthor tags from the picker inventory (search_merge_tags / catalog mergeTags), or pass strictMergeTags:false to demote to warnings.`);
  return F;
}
