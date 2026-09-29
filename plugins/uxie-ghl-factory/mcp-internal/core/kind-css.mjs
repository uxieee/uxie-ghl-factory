// The page builder's PER-KIND style layer, reimplemented as data: the rules a nav menu, an order form, a PDP block… adds
// on top of the generic layer (style-layer.mjs) every time the builder saves the page. Each kind's behaviour was measured
// offline, black box — the builder's fresh node, then one input at a time, then every pair of inputs that switches rules
// on or off (knowledge sniffs/funnels-wave30-kind-css-2026-09-29 14/15/16-*.mjs, learn/spec.*.json) — and stored in
// kind-css-spec.mjs (GENERATED) as ordered rules with holes and presence conditions. This module only renders that data.
//
// A node whose inputs fall outside what was measured (an unknown key, a value no probe covered) is REFUSED, not guessed:
// the caller keeps the builderStyling warning for it.
import { KIND_CSS_SPEC } from './kind-css-spec.mjs';

/** "#abc" / "#aabbcc" → "r,g,b"; anything else → "undefined" (what the builder writes for a colour it cannot read). */
const hexTriplet = (hex) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(typeof hex === 'string' ? hex : '');
  if (!m) return 'undefined';
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
};

// How an input value is written into a rule. `palette` is the page's general.colors ([{ label, value }]).
// `or:X` — the value when it is set, else the literal X (a padding or border part with a fallback)
// `nn:X` — the value unless it is missing (absent or null), else the literal X; an empty string stays empty
// `m:[[key, X], …]` — the value, except that a value whose key is listed writes its X (a border style that falls back to
//   `solid`, a padding part to `0`): the fragment a literal class contributes to a rule shared with other inputs. An X of
//   `{ref: n}` writes what input n (an index into the spec's leaves) writes — a tablet size that falls back to the desktop one.
const LUT = new Map();
const lut = (name) => { let m = LUT.get(name); if (!m) { m = new Map(JSON.parse(name.slice(2))); LUT.set(name, m); } return m; };
export const lutKey = (v) => (v === undefined ? '\u2205' : JSON.stringify(v));
export const transform = (name, v, palette, get = () => 'undefined') => {
  if (name.startsWith('or:')) return v ? String(v) : name.slice(3);
  if (name.startsWith('scale:')) return String(Math.round(Number(v) * Number(name.slice(6)))); // a size written as a share of a fixed maximum
  if (name.startsWith('nn:')) return v === undefined || v === null ? name.slice(3) : String(v);
  if (name.startsWith('m:')) { const t = lut(name), k = lutKey(v); if (!t.has(k)) return String(v); const x = t.get(k); return typeof x === 'object' ? get(x.ref) : x; }
  return TRANSFORMS[name](v, palette);
};
export const TRANSFORMS = Object.freeze({
  id: (v) => String(v),
  // An order form's button gradient: the palette colour the value names — `var(--name)`, or a bare `name` — matched
  // against each entry's lower-cased label, else the palette's Primary; as "r,g,b".
  paletteRgb: (v, palette = []) => {
    const s = String(v); const name = (s.split('--')[1] ?? s).replace(')', '');
    const byLabel = (l) => palette.find((c) => typeof c?.label === 'string' && c.label.toLowerCase() === l);
    return hexTriplet((byLabel(name) ?? byLabel('primary'))?.value);
  },
});

// bookkeeping a stored node carries that no style function reads: its identity, tree links, the canonical `element` copy the
// wrapper writes, edit markers
const SKIP_TOP = new Set(['id', 'meta', 'type', 'children', 'child', 'tagName', 'title', 'element', 'updated', 'sequence', 'parentId']);
/** Every leaf path of a node the per-kind layer could read (arrays are leaves; the node's own id and kind are not). */
export function nodeLeafPaths(node) {
  const out = [];
  const walk = (v, p) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) { for (const [k, x] of Object.entries(v)) walk(x, [...p, k]); return; }
    out.push(p.join('.'));
  };
  for (const [k, v] of Object.entries(node ?? {})) if (!SKIP_TOP.has(k)) walk(v, [k]);
  return out.filter((p) => p !== 'extra.nodeId');
}
const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The class index of `value` for a spec leaf, or -1 when no measured class covers it. */
function classOf(leaf, value) {
  if (value === undefined) return leaf.classes.findIndex((c) => c.absent);
  for (let i = 0; i < leaf.classes.length; i++) {
    const c = leaf.classes[i];
    if (c.values && c.values.some((x) => same(x, value))) return i;
    if (c.also && c.also.some((x) => same(x, value))) return i; // values an open class writes through its fallback
  }
  const open = leaf.classes.findIndex((c) => c.open);
  if (open >= 0 && value !== undefined && typeof value === leaf.classes[open].open) return open;
  if (value === undefined && open >= 0 && leaf.classes[open].absent) return open;
  return -1;
}

const HOLE = /\u0000(\d+):([^\u0000]+)\u0000/g;

/**
 * The per-kind CSS the builder writes for `node`, or { refused } naming the first input the measurements do not cover.
 * Kinds with no spec return { refused: 'kind' }.
 */
export function kindCss(node, palette = [], spec = KIND_CSS_SPEC[node?.meta]) {
  if (!spec) return { refused: 'kind' };
  const known = new Set(spec.leaves.map((l) => l.path));
  // `class.*` keys the measurements did not include (an entrance or hover animation's timing knobs) are accepted when every
  // `class.*` key that WAS measured never reached this kind's CSS
  const classFree = spec.leaves.filter((l) => l.path.startsWith('class.')).every((l) => l.free);
  const unknown = nodeLeafPaths(node).find((p) => !known.has(p) && !(classFree && p.startsWith('class.')));
  if (unknown) return { refused: `input ${unknown} was not measured for ${node.meta}` };
  const cls = [];
  for (const [i, leaf] of spec.leaves.entries()) {
    if (leaf.free) continue;
    const v = getPath(node, leaf.path);
    const c = classOf(leaf, v);
    if (c < 0) return { refused: `${leaf.path} = ${JSON.stringify(v)} is outside the measured values for ${node.meta}` };
    cls[i] = c;
  }
  // what input n writes (through its own hole transform); a guard stops two inputs that name each other
  const render = (n, depth = 0) => transform(spec.leaves[n].xf ?? 'id', getPath(node, spec.leaves[n].path), palette, (r) => (depth > 4 ? 'undefined' : render(r, depth + 1)));
  const fill = (t) => t.replace(HOLE, (_, i, f) => transform(f, getPath(node, spec.leaves[+i].path), palette, (r) => render(r))).split('__ID__').join(node.id);
  let css = '', media = null, sel = null;
  const close = () => { if (sel !== null) css += '}'; sel = null; };
  for (const [m, s, p, v, when] of spec.rows) {
    if (when && !when.t.some((tuple) => tuple.every((c, k) => cls[when.g[k]] === c))) continue;
    const M = fill(m), S = fill(s);
    if (M !== media) { close(); if (media) css += '}'; media = M; if (M) css += `${M}{`; }
    if (S !== sel) { close(); sel = S; css += `${S}{`; }
    css += `${fill(p)}:${fill(v)};`;
  }
  close(); if (media) css += '}';
  return { css };
}

export const KIND_CSS_KINDS = Object.freeze(Object.keys(KIND_CSS_SPEC));
