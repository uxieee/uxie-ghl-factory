// What a builder save would undo (w7-2, bl-490, bl-517).
//
// On every builder save the page builder recompiles a button's and an image's border radius from the node's OWN settings,
// and drops whatever a page-CSS rule wrote over it: a radius set in CSS by the API is replaced by the native value on save
// (bl-490: API-set CSS buttons shrink; bl-517: a feature image's radius goes to 0 and a class-level rule loses).
// This module finds those radii in the page's sheets BEFORE the write and says what a builder save would write instead,
// plus the native setting that makes the two agree. Pure: no account call.
//
// Model (measured where the backlog rows say; `knowledge/corpus/funnels/40-rules` rule 34 for a themed button):
//   - native radius = the node's styles.borderRadius when it has one (the builder compiles it on the node), else its
//     class.borderRadius (`radius<N>` → N px; the default `radius0` → 0px). A class value this module cannot read → unknown (skipped).
//   - a radius is WRITTEN for a node when a sheet rule's selector names the node (id-level) — or, for an image kind, a
//     class-level `img` rule that names the kind (`.image-feature img`, `.img-container img`) — and declares border-radius.

import { cssValue } from './style-layer.mjs';
import { cssRuleProblems } from './css-rules.mjs';

export const DRIFT_KINDS = Object.freeze(['button', 'image', 'image-feature']);
const IMAGE_KINDS = new Set(['image', 'image-feature']);
const DECL = /(?:^|;)\s*border-radius\s*:\s*([^;!}]+?)\s*(?:!important\s*)?(?=;|$)/gi;

/** A CSS length in px (`20px`, `20`, `0`) as `Npx`, or null for anything this module does not model (`50%`, `auto`, `var(…)`). */
export function radiusPx(v) {
  if (v === undefined || v === null || v === '') return null;
  const m = String(v).trim().match(/^(-?\d+(?:\.\d+)?)(px)?$/i);
  return m ? `${Number(m[1])}px` : null;
}

/** What the builder writes for this node's radius on its own: styles.borderRadius if set, else the native class value, else unknown (null). */
export function nativeRadius(node) {
  if (node?.styles?.borderRadius !== undefined) return radiusPx(cssValue(node.styles.borderRadius));
  const c = node?.class?.borderRadius;
  const raw = c && typeof c === 'object' ? c.value : c;
  if (raw === undefined || raw === null || raw === '') return '0px';
  const m = String(raw).match(/^radius(\d+)$/);
  return m ? `${Number(m[1])}px` : null;
}

/** The nativeKey a fix would set: the node's styles when it carries one, else its class radius. */
export const nativeKeyOf = (node) => (node?.styles?.borderRadius !== undefined ? 'styles.borderRadius' : 'class.borderRadius');

const sheetsOf = (pageData) => [
  pageData?.pageStyles,
  pageData?.general?.general?.pageStyles,
  ...(pageData?.sections ?? []).map((s) => s.general?.sectionStyles),
].filter((x) => typeof x === 'string');

/** Every `selector{body}` rule in a sheet; an @media wrapper is skipped, its inner rules are read. */
export function rulesOf(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

/** The border-radius values written for one node: id-level rules that name it, and class-level image rules for an image kind. */
export function writtenRadii(node, pageData) {
  const id = node.id;
  const nodeId = node.extra?.nodeId?.value ?? id;
  const isImage = IMAGE_KINDS.has(node.meta);
  const found = [];
  for (const css of sheetsOf(pageData)) {
    for (const r of rulesOf(css)) {
      const decls = [...r.body.matchAll(DECL)];
      if (!decls.length) continue;
      const idLevel = r.selector.includes(`.${id}`) || (nodeId !== id && r.selector.includes(`.${nodeId}`));
      const classLevel = !idLevel && isImage && /\bimg\b/.test(r.selector)
        && (r.selector.includes(`.${node.meta}`) || r.selector.includes('img-container') || r.selector.includes('image-container'));
      if (!idLevel && !classLevel) continue;
      const last = decls[decls.length - 1][1];
      found.push({ value: radiusPx(last), level: idLevel ? 'id' : 'class', selector: r.selector });
    }
  }
  return found;
}

/**
 * [{nodeId, kind, field, written, builderWouldWrite, nativeKey, selector}] — one row per radius a builder save would change.
 * Empty when the native settings already produce the written radius, or when a value cannot be read.
 */
export function builderSaveDrift(pageData) {
  const out = [];
  for (const sec of pageData?.sections ?? []) {
    for (const node of sec.elements ?? []) {
      if (!DRIFT_KINDS.includes(node.meta)) continue;
      const would = nativeRadius(node);
      if (would === null) continue;
      for (const w of writtenRadii(node, pageData)) {
        if (w.value === null || w.value === would) continue;
        // One custom-CSS rule is stored in two sheets (pageStyles and general.general.pageStyles): one row per rule.
        if (out.some((d) => d.nodeId === node.id && d.written === w.value && d.selector === w.selector)) continue;
        out.push({ nodeId: node.id, kind: node.meta, field: 'borderRadius', written: w.value, builderWouldWrite: would, nativeKey: nativeKeyOf(node), selector: w.selector });
      }
    }
  }
  return out;
}

/**
 * The result of a page write, with what it leaves behind: `builderSaveWouldChange` lists each builder-save drift row and
 * `nativeFix` names the node settings that make the builder's save write the radius the API wrote; `cssWarnings` lists the
 * custom-CSS rules the sheet breaks (css-rules.mjs). `customCss` overrides the sheet read from the page (compose passes its
 * own `pageStyles` argument). A result with no drift and no CSS problem is returned unchanged.
 */
export function decoratePageResult(result, pageData, { customCss } = {}) {
  const css = customCss ?? pageData?.general?.general?.pageStyles;
  const cssWarnings = typeof css === 'string' && css.trim() ? cssRuleProblems(css) : [];
  const drift = builderSaveDrift(pageData);
  let out = result;
  if (drift.length) {
    const fixes = new Map();
    for (const d of drift) {
      const px = Number(d.written.replace(/px$/, ''));
      fixes.set(d.nodeId, { nodeId: d.nodeId, set: { styles: { borderRadius: { value: px, unit: 'px' } } } });
    }
    out = { ...out, builderSaveWouldChange: drift, nativeFix: [...fixes.values()] };
  }
  if (cssWarnings.length) out = { ...out, cssWarnings };
  return out;
}
