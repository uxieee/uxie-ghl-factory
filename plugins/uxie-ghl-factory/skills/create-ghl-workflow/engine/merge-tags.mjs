// MERGE-TAG check — advisory. A `{{right_now.dat}}` typo renders literally at runtime and nothing
// in GHL catches it. The catalog carries the picker's static vocabulary (420 tags) AND the corpus
// verdict per namespace (merge-tags-replay): only SIX namespaces are CLOSED — every published tag
// in them is a static picker tag (calendar, document, message, phoneCall, right_now, user).
// `contact`, `opportunity`, `location`, `appointment` take dynamic keys in real bodies (custom
// fields, ids), and step-output prefixes (chatgpt.N, custom_webhook.N, …) are never in the picker.
// So: warn on an unknown key ONLY in a closed namespace, plus unbalanced `{{`/`}}` anywhere.
// Never blocks (ctx.warn, MERGE_TAG_SOFT). Hatch: ctx.skipMergeTagCheck.
const TOKEN = /\{\{\s*([A-Za-z_][\w]*)(\.[^{}]*)?\s*\}\}/g;

export function evaluateMergeTags(templates, mergeTags) {
  if (!mergeTags?.tags) return [];
  const known = new Set(mergeTags.tags.map((t) => String(t.tag).replace(/\s+/g, '')));
  const closed = new Set(mergeTags.closedNamespaces ?? []);
  const out = [];
  const walk = (v, cb) => { if (typeof v === 'string') cb(v); else if (Array.isArray(v)) v.forEach((x) => walk(x, cb)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, cb)); };
  for (const t of templates ?? []) {
    if (!t?.attributes || t.type === 'transition') continue;
    const where = `'${t.name ?? t.id}' (${t.type})`;
    walk(t.attributes, (s) => {
      const opens = (s.match(/\{\{/g) ?? []).length, closes = (s.match(/\}\}/g) ?? []).length;
      if (opens !== closes) out.push({ where, kind: 'unbalanced', msg: `unbalanced merge-tag braces (${opens} '{{' vs ${closes} '}}') in "${s.slice(0, 60)}${s.length > 60 ? '…' : ''}"` });
      for (const m of s.matchAll(TOKEN)) {
        const ns = m[1], full = `{{${ns}${(m[2] ?? '').replace(/\s+/g, '')}}}`;
        if (!closed.has(ns) || known.has(full)) continue;
        const near = mergeTags.tags.filter((x) => String(x.tag).startsWith(`{{${ns}.`)).map((x) => x.tag).slice(0, 4).join(', ');
        out.push({ where, kind: 'unknown', msg: `${full} is not a picker variable in the closed namespace '${ns}' (known: ${near}${near ? ', …' : ''}) — it will render literally at runtime` });
      }
    });
  }
  return out;
}

export function checkMergeTags(templates, catalog, ctx) {
  if (ctx?.skipMergeTagCheck === true) return [];
  const F = evaluateMergeTags(templates, catalog?.mergeTags);
  for (const f of F) ctx?.warn?.(`MERGE_TAG_SOFT: ${f.where}: ${f.msg}`);
  return F;
}
