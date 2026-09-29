// build_funnel_page edit mode: the STRUCTURE ops — insert at a position, move, clone, and the popup list.
//
// Measured from the page builder's own saves (knowledge sniffs/funnels-wave34-f4c-recon-2026-09-30):
//  - the tree is `child[]` ids (a section's metaData.child → rows → columns → leaves); section.elements[] is a FLAT bag whose
//    order means nothing, so a move only permutes a child[] (or the sections array + `sequence`);
//  - a clone is the original with every id renamed (`<kind>-<10 random chars>`, `extra.nodeId` = 'c' + id), no `element` copy and
//    no `updated`, put right after the original in its parent's child[]; a cloned section gets its own compiled sheet with no
//    original ids and `sequence` renumbered;
//  - popupDisabled is one flag on the popup's root node (`extra.popupDisabled.value`); `popupsList` order is the popups' priority.
// Pure functions over page data; applyPageEdits (page-edit.mjs) calls them.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** `<kind>-<10 random chars>`, the builder's id shape (its alphabet without `_` and `-`, which are legal but noisy in CSS). */
export function randomId(kind, taken, rnd = Math.random) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let s = '';
    for (let i = 0; i < 10; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    const id = `${kind}-${s}`;
    if (!taken.has(id)) { taken.add(id); return id; }
  }
  throw new Error('could not make an unused node id');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = '[A-Za-z0-9_-]';

/** A function renaming every occurrence of an id in a string. An occurrence is the whole token (a longer id sharing the prefix is
 *  left alone) with an optional leading `c` — the builder's class for a node is `c` + its id (`.cparagraph-…`, extra.nodeId). */
export function idRenamer(map) {
  const olds = [...map.keys()].sort((a, b) => b.length - a.length);
  if (!olds.length) return (s) => s;
  const re = new RegExp(`(?<!${B})(c?)(${olds.map(esc).join('|')})(?!${B})`, 'g');
  return (s) => s.replace(re, (_m, c, id) => `${c}${map.get(id)}`);
}

/** structuredClone of `value` with every string passed through `rename` (keys are ids' owners' business: none are ids). */
export function renameDeep(value, rename) {
  if (typeof value === 'string') return rename(value);
  if (Array.isArray(value)) return value.map((v) => renameDeep(v, rename));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameDeep(v, rename)]));
  return value;
}

// ---- stylesheet: the rules that name given ids, copied under new ids --------------------------------------------------------

/** Split a stylesheet into top-level blocks [{prelude, body}] by brace depth. Quotes are NOT tracked: the builder's own sheets carry the malformed
 *  rule `content:'\\'; font-family: ''` (text kinds), an unbalanced string that would swallow every rule after it; a `{` or `}` inside a
 *  string is far rarer than that. A stray tail becomes {prelude:'', body:null, raw}. */
function blocks(css) {
  const out = []; let i = 0; const n = css.length;
  while (i < n) {
    let j = i;
    while (j < n && css[j] !== '{' && css[j] !== ';') j++;
    if (j >= n) { if (css.slice(i).trim()) out.push({ prelude: '', body: null, raw: css.slice(i) }); break; }
    if (css[j] === ';') { out.push({ prelude: css.slice(i, j), body: null, raw: css.slice(i, j + 1) }); i = j + 1; continue; }
    let depth = 1; let k = j + 1;
    while (k < n && depth) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
    out.push({ prelude: css.slice(i, j).trim(), body: css.slice(j + 1, depth ? k : k - 1) });
    i = k;
  }
  return out;
}

function splitSelectors(prelude) {
  const parts = []; let depth = 0; let q = null; let cur = '';
  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i];
    if (q) { cur += ch; if (ch === '\\') cur += prelude[++i] ?? ''; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && !depth) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/**
 * The rules of `css` that name any id in `map` (old → new), rewritten under the new ids: from a selector list only the selectors
 * that name an old id are kept (a builder-saved sheet merges the rules of many nodes into one list), @media blocks are entered.
 * Text with no such rule → ''. The result is appended after the sheet, so it wins like a later rule.
 */
export function copyRulesUnderNewIds(css, map) {
  if (!css || !map.size) return '';
  const rename = idRenamer(map);
  const names = new RegExp(`(?<!${B})c?(${[...map.keys()].sort((a, b) => b.length - a.length).map(esc).join('|')})(?!${B})`);
  const walk = (text) => blocks(text).map((b) => {
    if (b.body === null) return '';
    if (/^@(media|supports|container|layer)\b/i.test(b.prelude)) { const inner = walk(b.body); return inner ? `${b.prelude}{${inner}}` : ''; }
    if (b.prelude.startsWith('@')) return '';
    const sel = splitSelectors(b.prelude).filter((s) => names.test(s));
    return sel.length ? `${sel.map(rename).join(',')}{${b.body}}` : '';
  }).join('');
  return walk(css);
}

/** The stylesheet without the selectors that name any of `ids`: a rule whose selectors all name one goes; in a merged list only those
 *  selectors go; every other rule is kept byte for byte (@media blocks are entered, an emptied one goes). */
export function stripRulesNaming(css, ids) {
  if (!css || !ids.length) return css;
  const names = new RegExp(`(?<!${B})c?(${[...ids].sort((a, b) => b.length - a.length).map(esc).join('|')})(?!${B})`);
  const walk = (text) => blocks(text).map((b) => {
    if (b.body === null) return b.raw ?? `${b.prelude};`;
    if (/^@(media|supports|container|layer)\b/i.test(b.prelude)) { const inner = walk(b.body); return inner ? `${b.prelude}{${inner}}` : ''; }
    if (b.prelude.startsWith('@')) return `${b.prelude}{${b.body}}`;
    const sels = splitSelectors(b.prelude);
    const keep = sels.filter((x) => !names.test(x));
    if (keep.length === sels.length) return `${b.prelude}{${b.body}}`;
    return keep.length ? `${keep.join(',')}{${b.body}}` : '';
  }).join('');
  return walk(css);
}

// ---- the tree ---------------------------------------------------------------------------------------------------------------

/** The ids of `rootId` and every descendant, following child[] through the section's flat element bag. */
export function subtreeIds(section, rootId) {
  const byId = new Map([[section.id, section.metaData ?? section], ...(section.elements ?? []).map((e) => [e.id, e])]);
  const out = []; const seen = new Set();
  const walk = (id) => { if (seen.has(id) || !byId.has(id)) return; seen.add(id); out.push(id); for (const c of byId.get(id).child ?? []) walk(c); };
  walk(rootId);
  return out;
}

/** {parent, index} — the node whose child[] holds `id` in this section (a section's own child[] is on its metaData). */
export function parentOf(section, id) {
  const holders = [section.metaData ?? section, ...(section.elements ?? [])];
  for (const h of holders) { const at = (h.child ?? []).indexOf(id); if (at >= 0) return { parent: h, index: at }; }
  return null;
}

/** Where in a child list: {index} | {after: id} | {before: id} (absent = the end). Returns the splice index or throws. */
export function positionIn(child, where, label = 'position') {
  const given = ['index', 'after', 'before'].filter((k) => where[k] !== undefined);
  if (given.length > 1) throw new Error(`${label}: name ONE of index, after, before (got ${given.join(', ')})`);
  if (where.index !== undefined) {
    if (!Number.isInteger(where.index) || where.index < 0 || where.index > child.length) throw new Error(`${label}: index ${where.index} is outside 0..${child.length}`);
    return where.index;
  }
  for (const k of ['after', 'before']) if (where[k] !== undefined) {
    const at = child.indexOf(where[k]);
    if (at < 0) throw new Error(`${label}: ${k} "${where[k]}" is not one of its siblings (${child.join(', ') || 'none'})`);
    return k === 'after' ? at + 1 : at;
  }
  return child.length;
}

/** The new index for a move within a list of `length` siblings currently at `from`: direction up|down|top|bottom, or a position. */
export function movedIndex(child, from, o) {
  const dirs = { up: Math.max(0, from - 1), down: Math.min(child.length - 1, from + 1), top: 0, bottom: child.length - 1 };
  if (o.direction !== undefined) {
    if (!(o.direction in dirs)) throw new Error(`direction must be up, down, top or bottom, not "${o.direction}"`);
    if (['index', 'after', 'before'].some((k) => o[k] !== undefined)) throw new Error('name a direction OR a position (index, after, before), not both');
    return dirs[o.direction];
  }
  const rest = child.filter((_, i) => i !== from);
  return positionIn(rest, o, 'move');
}

/**
 * Clone a node subtree. Returns {section, ids: Map old→new, nodes: [renamed nodes in the original's order]} — for a whole section
 * `section` is the new section. Every id is new; the copy has no `element` (the canonical copy) and no `updated`, as the builder's own
 * clone; a section's metaData drops `_id` and `isGlobal`. Sheet rules are the caller's (copyRulesUnderNewIds).
 */
export function cloneSubtree(section, rootId, taken, rnd) {
  const ids = subtreeIds(section, rootId);
  const byId = new Map([[section.id, section.metaData ?? section], ...(section.elements ?? []).map((e) => [e.id, e])]);
  const map = new Map(ids.map((id) => [id, randomId(id.replace(/-[^-]*$/, ''), taken, rnd)]));
  const rename = idRenamer(map);
  const nodes = ids.map((id) => {
    const copy = renameDeep(structuredClone(byId.get(id)), rename);
    delete copy.element; delete copy.updated; delete copy._id; delete copy.isGlobal;
    return copy;
  });
  return { ids: map, nodes, rename };
}

/** Every id on the page, for collision-free new ids. */
export function allIds(pageData) {
  const s = new Set();
  for (const sec of pageData.sections ?? []) { s.add(sec.id); for (const e of sec.elements ?? []) s.add(e.id); }
  for (const p of pageData.popupsList ?? []) { s.add(p.id); for (const e of p.elements ?? []) s.add(e.id); }
  return s;
}

// ---- popups -----------------------------------------------------------------------------------------------------------------

export const popupRoot = (p) => (p.elements ?? []).find((n) => n.id === p.id);

/** A popup by id, or by its name (the root's title). null when there is none, {ambiguous} when a name matches several. */
export function findPopup(pageData, ref) {
  const list = pageData.popupsList ?? [];
  const byId = list.findIndex((p) => p.id === ref);
  if (byId >= 0) return { index: byId, popup: list[byId] };
  const named = list.map((p, index) => ({ p, index })).filter(({ p }) => popupRoot(p)?.title === ref);
  if (named.length === 1) return { index: named[0].index, popup: named[0].p };
  return named.length > 1 ? { ambiguous: named.map(({ p }) => p.id) } : null;
}
