// Build a funnel page's `pageData` — nodes AND the compiled stylesheet — from a small spec.
//
// Everything here is PURE: no network, so the payload can be asserted in tests. The tool wraps it
// with the autosave call and a content-based read-back.
//
// Three facts from the corpus decide this module's shape, each proven live 2026-09-09:
//
// 1. THE PUBLIC RENDERER USES A COMPILED STYLESHEET, keyed by node id, held in
//    `section.general.sectionStyles`. The BUILDER re-derives styling from each node's `styles`
//    object instead. Emit only one and the page looks right in one place and naked in the other,
//    so both are written from one token set.
// 2. THREE KEYS ARE MANDATORY or the public page 500s while autosave still answers 201:
//    `col.extra.bgImage` (an object, not a URL), `general.general.fontsToLoad`,
//    `general.general.colors` (may be empty, must exist).
// 3. EVERY `extra` PROPERTY A KIND DECLARES MUST BE PRESENT. The renderer reads
//    `extra.<prop>.value` unguarded; empty is fine, absent is a crash. `form` declares five
//    properties and none has a default — supplying only the defaulted ones renders nothing but a
//    500.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Embedded by esbuild into dist so the bundle stays self-contained (the bundle test asserts it
// ships with NO sibling files); read from disk when running from source.
const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = typeof __HAS_FUNNEL_ELEMENTS__ !== 'undefined'
  ? __FUNNEL_ELEMENTS__
  : JSON.parse(readFileSync(resolve(HERE, '../catalog/funnel-elements.json'), 'utf8'));

export const ELEMENTS = Object.freeze(CATALOG.elements);
export const ELEMENT_KINDS = Object.freeze(Object.keys(CATALOG.elements));

export const px = (value) => ({ value, unit: 'px' });
export const val = (value) => ({ value });

// Read unguarded by the renderer for sections, rows and columns alike.
export const BG_IMAGE = Object.freeze({ value: Object.freeze({
  mediaType: 'image', url: '', opacity: '1', options: 'bgCover',
  svgCode: '', videoUrl: '', videoThumbnail: '', videoLoop: true }) });
const MARGINS = () => ({ marginLeft: px(0), marginRight: px(0), marginTop: px(0), marginBottom: px(0) });
const BOX = () => ({ borders: val('noBorder'), borderRadius: val('radius0'), radiusEdge: val('none') });
const PREFIX = '.hl_page-preview--content';

// An empty value shaped by what the renderer will do with it. Guessing from the property NAME is a
// heuristic, not a rule: two kinds are known to want the opposite shape (photo-video-gallery reads
// .toLowerCase() on one, social-share-blog reads .bgColor), so callers can override via `extra`.
export const emptyFor = (prop) => {
  if (/image|media|video|file|thumbnail|icon|website|link/i.test(prop)) return { value: { ...BG_IMAGE.value, newTab: false } };
  if (/items|list|options|products|categories|elements|fields|slides|links/i.test(prop)) return { value: [] };
  return { value: '' };
};

let counter = 0;
export const resetIds = () => { counter = 0; };
export const mkId = (kind, salt = 'B') => `${kind}-${salt}${(counter++).toString(36).toUpperCase()}`;

const envelope = (id, type, meta, tagName, extra, styles, cls, wrapper) => ({
  id, type, meta, tagName: tagName ?? null, title: meta, child: [],
  class: { ...BOX(), ...(cls ?? {}) }, styles: styles ?? {}, wrapper: { ...MARGINS(), ...(wrapper ?? {}) },
  extra: { nodeId: `c${id}`, visibility: val({ hideDesktop: false, hideMobile: false }), customClass: val([]), ...(extra ?? {}) },
  customCss: [], tabletStyles: {}, tabletWrapper: {}, mobileStyles: {}, mobileWrapper: {}, updated: true,
});

/** Every declared prop, present. Caller values win; anything unspecified gets a shaped empty. */
export const completeExtra = (meta, given = {}) => {
  const declared = ELEMENTS[meta]?.extraProps ?? [];
  const out = {};
  for (const prop of declared) out[prop] = Object.prototype.hasOwnProperty.call(given, prop) ? given[prop] : emptyFor(prop);
  return { ...out, ...given };
};

export const makeLeaf = ({ meta, extra = {}, styles = {}, cls = {}, tag = '', salt }) => {
  if (!ELEMENTS[meta]) throw new Error(`unknown element meta '${meta}' — the vocabulary is a closed set of ${ELEMENT_KINDS.length}`);
  const id = mkId(meta, salt);
  const node = envelope(id, 'element', meta, ELEMENTS[meta].tagName, completeExtra(meta, extra), styles, cls);
  node.tag = tag;
  return node;
};

export const makeColumn = ({ children, widthPct, padX = 20, salt }) => {
  const id = mkId('col', salt);
  const col = envelope(id, 'col', 'col', 'c-column',
    { bgImage: BG_IMAGE, columnLayout: val('column'), justifyContentColumnLayout: val('center'),
      alignContentColumnLayout: val('inherit'), forceColumnLayoutForMobile: val(true), elementVersion: val(2) },
    { paddingTop: px(0), paddingBottom: px(0), paddingLeft: px(padX), paddingRight: px(padX),
      backgroundColor: val('transparent'), width: { value: String(widthPct), unit: '%' } });
  col.child = children.map((c) => c.id);
  return col;
};

export const makeSection = ({ columns, background = 'transparent', padY = 60, maxWidth = 1100, elementCss = '', pageId, funnelId, locationId, salt }) => {
  const sid = mkId('section', salt);
  const rid = mkId('row', salt);
  const row = envelope(rid, 'row', 'row', 'c-row', { bgImage: BG_IMAGE },
    { paddingTop: px(0), paddingBottom: px(0), backgroundColor: val('transparent') });
  row.child = columns.map((c) => c.col.id);
  const meta = envelope(sid, 'section', 'section', 'c-section',
    { sticky: val('noneSticky'), bgImage: BG_IMAGE, allowRowMaxWidth: val(false) },
    { backgroundColor: val(background), paddingTop: px(padY), paddingBottom: px(padY), paddingLeft: px(20), paddingRight: px(20) });
  meta._id = sid; meta.child = [rid]; meta.isGlobal = false;

  const scaffold = [
    `${PREFIX} .${sid}{box-shadow:none;padding:${padY}px 20px;margin:0;background-color:${background};border:0}`,
    `#${sid}>.inner{max-width:${maxWidth}px}`,
    `${PREFIX} .${rid}{margin:0 auto;padding:0;width:100%;background-color:transparent;box-shadow:none;border:0}`,
    ...columns.map(({ col, widthPct }) => `${PREFIX} .${col.id}{padding:0 20px;width:${widthPct}%;margin:0;background-color:transparent;box-shadow:none;border:0}`
      + `#${col.id}>.inner{flex-direction:column;justify-content:center;align-items:inherit;flex-wrap:nowrap}`),
  ].join('');

  return {
    id: sid, pageId, funnelId, locationId, isGlobal: false, metaData: meta,
    elements: [row, ...columns.flatMap(({ col, leaves }) => [col, ...leaves])],
    general: { colors: [], fontsForPreview: [], rootVars: {}, sectionStyles: scaffold + elementCss, customFonts: [] },
  };
};

/** CSS for a text-ish leaf. Font sizes live only inside breakpoint media queries in GHL's output. */
export const textCss = (id, o) => {
  const sel = `.${id} h1,.${id} h2,.${id} h3,.${id} h4,.${id} h5,.${id} h6,.${id} ul li,.${id}.text-output`;
  const weight = o.weight ?? 400;
  return [
    `${PREFIX} #${id}{margin:0}`,
    `${PREFIX} .c${id}{font-family:${o.font};color:${o.color};font-weight:${weight};padding:0;opacity:1;`
      + `line-height:${o.lineHeight ?? '1.35em'};letter-spacing:${o.letterSpacing ?? 0}px;text-align:${o.align ?? 'center'};background-color:transparent}`,
    `@media screen and (min-width:481px) and (max-width:10000px){${sel}{font-size:${o.size}px!important;font-weight:${weight}}}`,
    `@media screen and (min-width:0px) and (max-width:480px){${sel}{font-size:${o.mobileSize ?? Math.round(o.size * 0.8)}px!important;font-weight:${weight}}}`,
  ].join('');
};

export const buttonCss = (id, o) => [
  `${PREFIX} .${id}{margin:0;text-align:${o.align ?? 'center'}}`,
  `${PREFIX} .c${id}{font-family:${o.font};background-color:${o.background};color:${o.color};text-decoration:none;`
    + `padding:16px 32px;border:1px solid ${o.borderColor ?? o.background};border-radius:${o.radius ?? 2}px;`
    + `letter-spacing:.3px;width:auto;display:inline-block}`,
  `.${id} .main-heading-button{font-size:${o.size ?? 16}px;font-weight:600}`,
].join('');

export const buildPageData = ({ pageId, stepId, funnelId, locationId, sections, pageStyles = '', fonts = ['Arial', 'Georgia', 'Roboto'], colors = [] }) => ({
  funnelId, locationId, pageId, id: pageId, stepId,
  sections: sections.map((s, i) => ({ ...s, sequence: i })),
  settings: { settings: { typography: { fonts: {
    headlineFont: { id: 'headlinefont', text: 'Headline Font', value: { text: 'Default', value: 'inherit' }, isCustom: false },
    contentFont: { id: 'contentfont', text: 'Content Font', value: { text: 'Default', value: 'inherit' }, isCustom: false } } } } },
  // fontsToLoad and colors are MANDATORY — absent, the public render 500s.
  general: { general: { colors, fontsToLoad: fonts, fontsToLoadForPreview: fonts, pageStyles: '', customFonts: [] } },
  pageStyles, popups: [], popupsList: [], fontsForPreview: [], trackingCode: { headerCode: '', footerCode: '' },
});

export const autosaveEnvelope = ({ funnelId, pageData, pageVersion = 1 }) => ({
  funnelId, pageData, pageVersion, pageType: 'draft', manualSave: true,
  integrations: { videoBackground: false, blogMeta: { selectedBlogCategories: [], categoryNavigationList: [] },
    customCode: pageData.sections.reduce((n, s) => n + s.elements.filter((e) => e.meta === 'custom-code').length, 0),
    popup: false },
});

/** Structural checks the write path will NOT do for you. Returns [] when the page is sane. */
export const auditPageData = (pageData) => {
  const problems = [];
  for (const s of pageData.sections ?? []) {
    const byId = new Map(s.elements.map((n) => [n.id, n]));
    const roots = s.metaData?.child ?? [];
    for (const id of roots) if (!byId.has(id)) problems.push(`section ${s.id}: metaData.child references '${id}', which is not in elements[]`);
    for (const n of s.elements) {
      for (const c of n.child ?? []) {
        if (typeof c !== 'string') { problems.push(`node ${n.id}: child[] must hold node IDS, not objects`); break; }
        if (!byId.has(c)) problems.push(`node ${n.id}: child '${c}' does not resolve`);
      }
      if (n.type === 'col' && !n.extra?.bgImage) problems.push(`column ${n.id}: extra.bgImage is required — the public render 500s without it`);
      if (n.type === 'element') {
        if (!ELEMENTS[n.meta]) { problems.push(`node ${n.id}: meta '${n.meta}' is not one of the ${ELEMENT_KINDS.length} known kinds — autosave accepts it anyway`); continue; }
        const missing = (ELEMENTS[n.meta].extraProps ?? []).filter((p) => !(p in (n.extra ?? {})));
        if (missing.length) problems.push(`node ${n.id} (${n.meta}): missing declared extra props ${missing.join(', ')} — the renderer reads extra.<prop>.value unguarded`);
      }
      if (n.extra && n.extra.nodeId !== `c${n.id}`) problems.push(`node ${n.id}: extra.nodeId must be 'c'+id, the renderer keys markup on it`);
    }
    const css = s.general?.sectionStyles ?? '';
    if (css && !css.includes(s.id)) problems.push(`section ${s.id}: sectionStyles does not mention this section id — the stylesheet is keyed by node id, so it is orphaned`);
  }
  const g = pageData.general?.general ?? {};
  if (!Array.isArray(g.fontsToLoad)) problems.push('general.general.fontsToLoad is required — absent, the public render 500s');
  if (!Array.isArray(g.colors)) problems.push('general.general.colors is required (may be empty) — absent, the public render 500s');
  return problems;
};
