// Email BODY merge-tag fallbacks, in the builder's own shape. An email send reads body defaults from the inline
// data-cv-defaults='{json}' attribute on the html's FIRST tag; attributes.htmlDefaults on its own is inert at send
// (both proven live 2026-09-28 — knowledge corpus/workflows/40-rules/merge-tag-rendering.md §3). The builder's
// Email.save() cleans orphaned keys and injects the map (Email.ts:1102-1105); this is a port of the helpers it uses
// (utils/customVariableHelper.ts, bundle 2026-09-25): same regexes, same occurrence counting, same escaping.
const CV_REGEX = /\{\{([^{}]+)\}\}/g;
const CV_ATTR_SINGLE = /\s+data-cv-defaults='[^']*'/gi;
const CV_ATTR_DOUBLE = /\s+data-cv-defaults="[^"]*"/gi;
const CV_ATTR_EXTRACT_SINGLE = /data-cv-defaults='([^']*)'/;
const CV_ATTR_EXTRACT_DOUBLE = /data-cv-defaults="([^"]*)"/;
const FIRST_TAG_REGEX = /(<[a-zA-Z][^>]*)(>)/;
const LOOP_OPEN = /^#(each|rss_items)\b/;
const LOOP_CLOSE = /^\/(each|rss_items)\b/;

// Block helpers ({{#…}}, {{/…}}, {{else}}, {{default var "v"}}) are not variables.
function variableOf(expression) {
  const t = String(expression ?? '').trim();
  if (!t || t.startsWith('#') || t.startsWith('/') || t.startsWith('else') || t.startsWith('default ')) return null;
  return t;
}
const loopRelative = (v) => v === 'this' || v.startsWith('this.') || v.startsWith('rentals.this.');

function loopRanges(text) {
  const ranges = []; const stack = [];
  for (const m of text.matchAll(CV_REGEX)) {
    const inner = m[1].trim();
    if (LOOP_OPEN.test(inner)) { stack.push(m.index); continue; }
    if (LOOP_CLOSE.test(inner) && stack.length) ranges.push({ start: stack.pop(), end: m.index + m[0].length });
  }
  while (stack.length) ranges.push({ start: stack.pop(), end: text.length });
  return ranges;
}

/** Merge-tag occurrences in document order, index counted PER VARIABLE; helpers, loop paths and #each bodies skipped. */
export function findVariableOccurrences(text) {
  if (!text) return [];
  const out = []; const count = {}; const loops = loopRanges(text);
  for (const m of text.matchAll(CV_REGEX)) {
    const v = variableOf(m[1]);
    if (!v || loopRelative(v) || loops.some((r) => m.index >= r.start && m.index < r.end)) continue;
    const i = count[v] ?? 0;
    out.push({ variable: v, occurrenceIndex: i, start: m.index, end: m.index + m[0].length });
    count[v] = i + 1;
  }
  return out;
}

/** The defaults map the html already carries in its data-cv-defaults attribute ({} when none or unparseable). */
export function extractDefaultsFromHtml(html) {
  const m = html?.match(CV_ATTR_EXTRACT_SINGLE) ?? html?.match(CV_ATTR_EXTRACT_DOUBLE);
  if (!m) return {};
  try { return JSON.parse(m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')); } catch { return {}; }
}

/**
 * The builder's save for an inline email body. With no authored map, an attribute already in the html seeds it
 * (the drawer does the same on open), so a hand-written or exported attribute is never stripped.
 * Returns { html, htmlDefaults, dropped } — dropped = authored keys that match no occurrence (the builder drops them silently).
 */
export function applyHtmlDefaults(html, authored) {
  const source = authored && Object.keys(authored).length ? authored : extractDefaultsFromHtml(html);
  if (!html || !Object.keys(source).length) return { html, htmlDefaults: {}, dropped: [] };
  const stripped = html.replace(CV_ATTR_SINGLE, '').replace(CV_ATTR_DOUBLE, '');
  const valid = new Set(findVariableOccurrences(stripped).map((o) => `${o.variable}:${o.occurrenceIndex}`));
  const htmlDefaults = {}; const dropped = [];
  for (const [k, v] of Object.entries(source)) (valid.has(k) ? (htmlDefaults[k] = v) : dropped.push(k));
  if (!Object.keys(htmlDefaults).length) return { html: stripped, htmlDefaults, dropped };
  const json = JSON.stringify(htmlDefaults).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
  return { html: stripped.replace(FIRST_TAG_REGEX, `$1 data-cv-defaults='${json}'$2`), htmlDefaults, dropped };
}
