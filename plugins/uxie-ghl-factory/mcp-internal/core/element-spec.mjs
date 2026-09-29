// The keys an element spec in build_funnel_page may carry, per kind. composeLeaf (tools.mjs) reads exactly these;
// anything else used to be dropped silently — a button given `text:` instead of `html:` was stored with empty text
// and rendered as an empty bar while every write answered 201 (bl-282; knowledge
// sniffs/funnels-wave19-tool-drift-2026-09-29/live-tool.build_funnel_page.unknown-key-dropped.json).
// Each key's availability comes from the same registry makeLeaf builds the node from (ELEMENTS[meta].extraProps)
// or the animation tables composeLeaf checks, so the allow-list cannot drift from what is read.
import { ELEMENTS } from './funnel-pages.mjs';
import { ENTRANCE_METAS, HOVER_METAS } from './page-animation.mjs';

const props = (meta) => ELEMENTS[meta]?.extraProps ?? [];

/** key → does this kind take it. The order is the order the refusal lists them in. */
export const ELEMENT_SPEC_KEYS = Object.freeze({
  meta: () => true,
  html: (meta) => props(meta).includes('text'), // becomes extra.text
  extra: () => true,
  styles: () => true,
  css: () => true,
  font: (meta) => props(meta).includes('typography'), // becomes extra.typography: var(--headline|content font)
  tag: () => true,
  entranceAnimation: (meta) => ENTRANCE_METAS.includes(meta),
  hoverAnimation: (meta) => HOVER_METAS.includes(meta),
  openPopup: (meta) => props(meta).includes('popupId'), // becomes extra.action openPopup + popupId
  // The node's wrapper (margins, padding, width) and its tablet / mobile overrides, compiled by core/style-layer.mjs as the
  // builder compiles them on save.
  wrapper: () => true,
  tabletStyles: () => true,
  mobileStyles: () => true,
  tabletWrapper: () => true,
  mobileWrapper: () => true,
});

// Keys people reach for, and the key that does the job.
const DID_YOU_MEAN = Object.freeze({
  text: 'html', content: 'html', label: 'html', innerHTML: 'html', value: 'html', title: 'html',
  style: 'styles', class: 'extra.customClass', className: 'extra.customClass', classes: 'extra.customClass',
  animation: 'entranceAnimation', hover: 'hoverAnimation', popup: 'openPopup', popupId: 'openPopup',
  fontFamily: 'css.font (or font: "headline" | "content")', typography: 'font', type: 'meta', kind: 'meta',
  margin: 'wrapper: {marginTop, …}', margins: 'wrapper: {marginTop, …}', mobile: 'mobileStyles / mobileWrapper', tablet: 'tabletStyles / tabletWrapper', responsive: 'mobileStyles / tabletStyles',
});

/** The keys this kind accepts. */
export const elementSpecKeys = (meta) => Object.keys(ELEMENT_SPEC_KEYS).filter((k) => ELEMENT_SPEC_KEYS[k](meta));

/**
 * null when every key of the spec is one the tool reads for its kind; otherwise the refusal text naming each
 * offending key, what to use instead, and the kind's allowed keys. An unknown `meta` is left to makeLeaf.
 */
export function elementSpecProblem(e) {
  if (!e || typeof e !== 'object' || !ELEMENTS[e.meta]) return null;
  const allowed = elementSpecKeys(e.meta);
  const bad = Object.keys(e).filter((k) => !allowed.includes(k));
  if (!bad.length) return null;
  const why = bad.map((k) => {
    if (ELEMENT_SPEC_KEYS[k]) return `\`${k}\` is not offered on ${e.meta}.`;
    return DID_YOU_MEAN[k] ? `unknown key \`${k}\` — did you mean ${DID_YOU_MEAN[k]}?` : `unknown key \`${k}\`.`;
  });
  return `element ${e.meta}: ${why.join('; ')} Keys ${e.meta} takes: ${allowed.join(', ')}.`;
}
