// The page builder's GENERIC style layer, reimplemented: how a node's `styles`, `wrapper` and per-device overrides
// (tabletStyles / tabletWrapper / mobileStyles / mobileWrapper), its customCss and a row's width become CSS on every
// builder save. Written from the builder's observed behaviour — each style key in, the rules out — measured offline for
// every element kind, section, row and column (knowledge sniffs/funnels-wave30-kind-css-2026-09-29 07/08/09/10-probe-*.mjs,
// probe-*.json). The per-kind style functions (a button's, a nav menu's…) are a separate layer; this is the part every
// node shares, so a page compiled here and then saved in the builder carries the same rules.
//
// Pinned to the builder build it was measured on (STYLE_LAYER_SOURCE); test/style-layer.test.mjs fails when the captured
// bundle moves past it.
import { normalizeStyleValue } from './style-values.mjs';

export const STYLE_LAYER_SOURCE = Object.freeze({ chunk: 'pageBuilder index.e1b163ff.js', measured: '2026-09-29' });

export const PAGE_SCOPE = 'hl_page-preview--content';
export const TABLET_QUERY = '@media screen and (min-width:768px) and (max-width:1024px)';
export const MOBILE_QUERY = '@media screen and (min-width:0px) and (max-width:767px)';

const TEXT_KINDS = new Set(['heading', 'sub-heading', 'paragraph', 'rich-text', 'bulletList']);
const STRUCTURE = new Set(['section', 'row', 'col']);
// Style keys a text kind carries that its DESKTOP rule never writes (its own text rules use them); per-device overrides do.
const TEXT_DESKTOP_DROPPED = new Set(['boldTextColor', 'italicTextColor', 'underlineTextColor', 'linkTextColor', 'marginTop', 'marginBottom']);
const BORDER = ['borderColor', 'borderWidth', 'borderStyle', 'borderRadius'];
const PADDING = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
// Kinds whose style keys do not all land on the node's own box: `route` keys go to `target` (under the node's wrapper id),
// `drop` keys are never written, `only` (when set) is the complete list of keys written at all.
const ROUTING = {
  image: { route: new Set(['boxShadow', 'width', 'height', ...BORDER]), target: ' .image-container img', alwaysTarget: true },
  'image-feature': { route: new Set(BORDER), target: ' .img-container img' },
  'qr-code': { drop: new Set(['width', 'height', 'boxShadow', ...BORDER]) },
  'store-pdp-v2-images': { drop: new Set(['boxShadow', 'marginLeft', 'marginRight', ...BORDER]) },
  'store-pdp-v2-quantity': { drop: new Set(['quantityLabelColor', 'color', 'quantityBackgroundColor', 'quantityBorderColor']) },
  'store-pdp-v2-add-to-cart': { only: new Set(['boxShadow', ...PADDING]), route: new Set(['boxShadow', ...PADDING]), target: ' .pdp-v2-add-to-cart__btn' },
  'store-pdp-v2-buy-now': { only: new Set(['boxShadow', ...PADDING]), route: new Set(['boxShadow', ...PADDING]), target: ' .pdp-v2-buy-now__btn' },
};
// Sections, rows and columns: a per-device override of horizontal padding / margin is written !important.
const STRUCTURE_DEVICE_IMPORTANT = new Set(['paddingLeft', 'paddingRight', 'marginLeft', 'marginRight']);

const kebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
/** `{value, unit}` → the CSS value, or undefined when there is nothing to write (absent, null or empty — an empty list too). */
export const cssValue = (v) => { if (!v || v.value === undefined || v.value === null || v.value === '') return undefined; const x = `${v.value}${v.unit || ''}`; return x === '' ? undefined : x; };
/** Style map → `prop:value` declarations in the map's own order; `background: none` is not written. */
export function declarations(map = {}, important = null) {
  const out = [];
  for (const [k, v] of Object.entries(map ?? {})) {
    const x = cssValue(v);
    if (x === undefined || (k === 'background' && x === 'none')) continue;
    out.push(`${kebab(k)}:${x}${important?.has(k) ? '!important' : ''}`);
  }
  return out;
}
const rule = (sel, decls) => (decls.length ? `${sel}{${decls.join(';')}}` : '');
const media = (q, body) => (body ? `${q}{${body}}` : '');

/** The generic-layer CSS the builder compiles for one node (element, section, row or column). */
export function nodeLayerCss(node, scope = PAGE_SCOPE) {
  if (!node) return '';
  const P = `.${scope}`;
  const meta = node.meta ?? node.type;
  const structure = STRUCTURE.has(meta) || STRUCTURE.has(node.type);
  // A column older than elementVersion 2 is styled through its inner box.
  const colInner = meta === 'col' && !((Number(node.extra?.elementVersion?.value) || 0) >= 2);
  const boxSel = `${P} .${structure ? node.id : (node.extra?.nodeId ?? node.id)}${colInner ? ' >.inner' : ''}`;
  const wrapSel = TEXT_KINDS.has(meta) ? `${P} #${node.id}` : `${P} .${node.id}${colInner ? ' >.inner' : ''}`;
  // A wrapper width other than auto also stops the flex item growing or shrinking — except on a column.
  const wrapperDecls = (w, device) => {
    const d = declarations(w, structure && device ? STRUCTURE_DEVICE_IMPORTANT : null);
    const width = cssValue(w?.width);
    if (width !== undefined && width !== 'auto' && meta !== 'col') d.push('flex:0 0 auto!important');
    return d;
  };
  const styleRules = (styles, device) => {
    const r = ROUTING[meta] ?? {};
    let map = { ...(styles ?? {}) };
    if (!device && TEXT_KINDS.has(meta)) for (const k of TEXT_DESKTOP_DROPPED) delete map[k];
    if (r.only) map = Object.fromEntries(Object.entries(map).filter(([k]) => r.only.has(k)));
    if (r.drop) for (const k of r.drop) delete map[k];
    const routed = r.route ? Object.fromEntries(Object.entries(map).filter(([k]) => r.route.has(k))) : {};
    const own = r.route ? Object.fromEntries(Object.entries(map).filter(([k]) => !r.route.has(k))) : map;
    const typography = !structure && !device && node.extra?.typography?.value ? [`font-family:${node.extra.typography.value}`] : [];
    let css = '';
    // DELIBERATE DIVERGENCE: an image's inner-img rule is written whenever the map is; where the map has no boxShadow
    // the builder writes `box-shadow:undefined` into it — an invalid declaration the browser drops — and this does not.
    if (r.target && (Object.keys(routed).length || (r.alwaysTarget && styles))) css += rule(`${P} .${node.id}${r.target}`, declarations(routed));
    css += rule(boxSel, [...typography, ...declarations(own, structure && device ? STRUCTURE_DEVICE_IMPORTANT : null)]);
    return css;
  };
  // structure nodes: the wrapper lands on their own box selector; a column writes its styles first, so a wrapper width
  // wins over the style width
  // A column also leads with its width alone on the column itself (for a pre-v2 column that is the only width outside
  // its inner box).
  let css = meta === 'col' ? rule(`${P} .${node.id}`, declarations({ width: node.styles?.width })) + styleRules(node.styles, false) + rule(wrapSel, wrapperDecls(node.wrapper, false))
    : rule(wrapSel, wrapperDecls(node.wrapper, false)) + styleRules(node.styles, false);
  if (meta === 'row') {
    const rw = cssValue(node.extra?.rowWidth);
    if (rw !== undefined) css += rule(`${P} .${node.id}`, [`width:${rw}`]);
    const tw = cssValue(node.tabletExtra?.rowWidth);
    if (tw !== undefined) css += media(TABLET_QUERY, rule(`${P} .${node.id}`, [`width:${tw}`]));
  }
  for (const [q, st, w] of [[TABLET_QUERY, node.tabletStyles, node.tabletWrapper], [MOBILE_QUERY, node.mobileStyles, node.mobileWrapper]]) {
    const hasStyles = st && Object.keys(st).length;
    css += media(q, rule(wrapSel, wrapperDecls(w, true)) + (hasStyles ? styleRules(st, true) : ''));
  }
  // A column's customCss is not written by this layer.
  if (meta !== 'col') for (const c of node.customCss ?? []) css += rule(`${P} .${node.id} ${c.selector}`, Object.entries(c.styles ?? {}).map(([k, v]) => `${kebab(k)}:${v}`));
  return css;
}

/** A caller's style / wrapper map in the builder's stored shape: a bare number is px, a bare string is {value}, a
 *  {value, unit} object is kept. */
export function storedMap(map) {
  if (map === undefined) return undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('a style / wrapper map must be an object of {prop: number | string | {value, unit}}');
  // a number is px (margins, paddings); a string with a unit is split ("16px" → {value:16, unit:"px"}), any other string is stored whole
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, typeof v === 'number' ? { value: v, unit: 'px' } : typeof v === 'string' ? normalizeStyleValue(k, v, 'wrapper / device map') : v]));
}
/** The per-device and wrapper maps a spec may carry (element or section), in the builder's node keys. */
export const LAYER_SPEC_KEYS = Object.freeze(['wrapper', 'tabletStyles', 'mobileStyles', 'tabletWrapper', 'mobileWrapper']);
