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
import { KIND_DEFAULT_EXTRA } from './kind-defaults.mjs';

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

// STYLE_PROPS_VALUE from the builder bundle — the values a click action may take. `goToNextStep`
// is NOT one of them: that camelCase guess was stored by autosave with a 201 and the button then
// did nothing at all. Presence checks do not catch a wrong ENUM, so this list exists.
export const ACTION_VALUES = Object.freeze([
  'go-to-next-funnel-step', 'go-to-funnel-step', 'step-path', 'url',
  'openPopup', 'go-to-product-collection', 'go-to-cac', 'logout',
]);
export const GO_TO_NEXT_STEP = 'go-to-next-funnel-step';

// Some kinds want a specific empty SHAPE and the property name does not predict it — `nav-menu`
// reads its properties as lists even for ones called `icon`/`imageProperties`, so an object-shaped
// empty 500s the page exactly as a string does. Established by trying whole-node variants
// (strings / rich objects / arrays) per kind and seeing which renders.
const SHAPE_BY_KIND = Object.freeze({
  'nav-menu': 'arrays', 'nav-menu-v2': 'arrays', image: 'arrays',
});

// An empty value shaped by what the renderer will do with it. Name-based guessing is a heuristic,
// not a rule — the per-kind table above overrides it where live probing proved it wrong.
export const emptyFor = (prop, meta) => {
  const forced = meta && SHAPE_BY_KIND[meta];
  if (forced === 'arrays') return { value: [] };
  if (forced === 'strings') return { value: '' };
  // `icon` is NOT media. It is a glyph descriptor, and the name-based heuristic used to hand it a
  // bgImage-shaped object — which the PUBLIC renderer ignored while the BUILDER printed a literal
  // "undefined" in front of every heading and paragraph. Proven live 2026-09-09. Keep this branch
  // above the media test, whose regex would otherwise swallow it.
  if (/^icon$/i.test(prop)) return { value: { name: '', unicode: '', fontFamily: '' } };
  if (/image|media|video|file|thumbnail|website|link/i.test(prop)) return { value: { ...BG_IMAGE.value, newTab: false } };
  if (/items|list|options|products|categories|elements|fields|slides|links/i.test(prop)) return { value: [] };
  return { value: '' };
};

// Kinds that need a particular STEP TYPE, not a better node shape. Proven 2026-09-09 by installing
// GHL's own store and blog templates and reading the real nodes: five of the six that no shape
// sweep could build are buildable once the step type is right.
//
// `create-step` accepts `type: "store"` (proven) as well as `optin_funnel_page`. A blog is a FUNNEL
// with `type: "blog"` whose steps are `blog-home` and `blog-post` — but `funnel/create` ignores
// `type: "blog"` and `create-step` 404s on `type: "blog-post"`, so a blog CONTAINER can only be
// obtained by installing a blogs template (`POST /templates/template/load`, product `blogs`).
export { KIND_DEFAULT_EXTRA };

export const NEEDS_STEP_TYPE = Object.freeze({
  'store-cart': 'store', 'store-checkout': 'store', 'store-thank-you': 'store',
  'blog-content': 'blog-post',
});

// 🔴 These kinds carry `tag` EQUAL TO THEIR tagName, not the empty string every other leaf uses.
// Read off real template nodes; a leaf built with tag:'' does not render.
export const TAG_IS_TAGNAME = Object.freeze(new Set([
  'store-cart', 'store-checkout', 'store-thank-you', 'blog-content', 'blog-post',
]));

// Every one of the 57 leaf kinds now builds from scratch (2026-09-09). Kept as the hook for the
// next kind that turns out to need context the caller cannot supply.
export const NEEDS_CONTEXT = Object.freeze({});

// 🔴 Props that are RAW objects, not `{value: …}`. Wrapping one of these is silent in the builder
// and 500s the public page (`reading 'bgColor'` for socialShareStyle).
export const RAW_EXTRA_PROPS = Object.freeze(new Set(['socialShareStyle', 'blog_style', 'blogPinedPostStyle']));

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
  // Kinds with a required object a heuristic cannot invent (store `customText`, blog show-options)
  // get the real default first; the shaped empty is only the last resort.
  const known = KIND_DEFAULT_EXTRA[meta] ?? {};
  const out = {};
  for (const prop of declared) {
    out[prop] = Object.prototype.hasOwnProperty.call(given, prop) ? given[prop]
      : Object.prototype.hasOwnProperty.call(known, prop) ? known[prop]
        : emptyFor(prop, meta);
  }
  // A kind may need a property its own registry entry does not declare — `customText` is declared,
  // but `step1` on store-checkout is not, and the renderer reads it anyway.
  for (const [prop, v] of Object.entries(known)) if (!(prop in out)) out[prop] = v;
  return { ...out, ...given };
};

export const makeLeaf = ({ meta, extra = {}, styles = {}, cls = {}, tag = '', salt }) => {
  if (!ELEMENTS[meta]) throw new Error(`unknown element meta '${meta}' — the vocabulary is a closed set of ${ELEMENT_KINDS.length}`);
  const id = mkId(meta, salt);
  const node = envelope(id, 'element', meta, ELEMENTS[meta].tagName, completeExtra(meta, extra), styles, cls);
  // Most leaves carry tag:''. The store and blog kinds carry their tagName, and do not render without it.
  node.tag = tag || (TAG_IS_TAGNAME.has(meta) ? ELEMENTS[meta].tagName : '');
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


// 🔴 THE BUILDER READS `settings.settings.background`, THE PUBLIC RENDERER NEVER DOES.
// The page builder's `bgStyle()` computed is `const {bgImage} = builderStore.backgroundSettings`
// with NO guard, so a page saved without this object throws `Cannot destructure property 'bgImage'
// of 'e1' as it is undefined` and the builder hangs on its loading spinner forever — while the
// public URL renders the page perfectly. Proven live 2026-09-09 against a GHL-authored control
// page that opened fine in the same session. The three progress-bar lists sit beside it in every
// GHL-authored page.
export const builderSettings = (pageBackground = 'var(--white)') => ({
  background: { bgImage: { value: { url: '', options: 'bgCover' } }, backgroundColor: { value: pageBackground } },
  offsetColor: [
    { text: 'White', value: 'progressbarOffsetWhite' }, { text: 'Transparent White', value: 'progressbarOffsetTransparentWhite' },
    { text: 'Black', value: 'progressbarOffsetBlack' }, { text: 'Transparent Black', value: 'progressbarOffsetTransparentBlack' }],
  percentWidth: Array.from({ length: 11 }, (_, i) => ({ text: `${i * 10} Percent`, value: `progress${i * 10}` })),
  progressBarSize: [
    { text: 'Small', value: 'progressbarSmall' }, { text: 'Medium', value: 'progressbarMedium' }, { text: 'Large', value: 'progressbarLarge' }],
});

// The builder also reads a nested canonical copy of each node from `node.element`; the outer object
// is a wrapper the API layer adds. Section adds `_id`, col adds `noOfColumns`, a leaf adds
// `customCss` and `tag`; none carry `element`, `tabletStyles`, `tabletWrapper`.
export const withElement = (n) => {
  const pick = (keys) => Object.fromEntries(keys.filter((k) => n[k] !== undefined).map((k) => [k, n[k]]));
  const base = ['id', 'type', 'meta', 'tagName', 'title', 'child', 'class', 'styles', 'wrapper', 'extra', 'mobileStyles', 'mobileWrapper', 'updated'];
  const element = n.type === 'section' ? { ...pick([...base, '_id']), _id: n._id ?? n.id }
    : n.type === 'col' ? { ...pick(base), noOfColumns: n.noOfColumns ?? 1 }
      : n.type === 'row' ? pick(base)
        : pick([...base, 'customCss', 'tag']);
  return { ...n, ...(n.type === 'col' ? { noOfColumns: n.noOfColumns ?? 1 } : {}), element };
};

export const buildPageData = ({ pageId, stepId, funnelId, locationId, sections, pageStyles = '', fonts = ['Arial', 'Georgia', 'Roboto'], colors = [], pageBackground = 'var(--white)' }) => ({
  funnelId, locationId, pageId, id: pageId, stepId,
  sections: sections.map((s, i) => ({
    ...s, sequence: i,
    ...(s.metaData ? { metaData: withElement(s.metaData) } : {}),
    ...(s.elements ? { elements: s.elements.map(withElement) } : {}),
  })),
  settings: { settings: { ...builderSettings(pageBackground), typography: { fonts: {
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
  // A page missing this renders in public and hangs the BUILDER — the failure mode with no error.
  if (!pageData.settings?.settings?.background) {
    problems.push("settings.settings.background is missing: the public page will render but the BUILDER will hang forever (bgStyle() destructures bgImage from it unguarded). Use buildPageData(), or add builderSettings().");
  }
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
      // A wrong action value is stored with a 201 and the control then does nothing, silently.
      const action = n.extra?.action?.value;
      if (action !== undefined && action !== '' && !ACTION_VALUES.includes(action)) {
        problems.push(`node ${n.id} (${n.meta}): extra.action.value '${action}' is not a known action — use one of ${ACTION_VALUES.join(', ')}. `
          + 'autosave stores an unknown value with a 201 and the control silently does nothing.');
      }
      for (const prop of RAW_EXTRA_PROPS) {
        const v = n.extra?.[prop];
        if (v && typeof v === 'object' && 'value' in v) {
          problems.push(`node ${n.id} (${n.meta}): extra.${prop} must be a RAW object, not {value: …} — wrapping it 500s the public page with "reading 'bgColor'" while the builder shows nothing wrong`);
        }
      }
      if (n.type === 'element' && NEEDS_STEP_TYPE[n.meta]) {
        problems.push(`node ${n.id} (${n.meta}): this kind renders only on a step of type '${NEEDS_STEP_TYPE[n.meta]}' — on a plain funnel page it 500s (or 404s for blog kinds). Create the step with that type.`);
      }
      if (n.type === 'element' && NEEDS_CONTEXT[n.meta]) {
        problems.push(`node ${n.id} (${n.meta}): ${NEEDS_CONTEXT[n.meta]}`);
      }
    }
    const css = s.general?.sectionStyles ?? '';
    if (css && !css.includes(s.id)) problems.push(`section ${s.id}: sectionStyles does not mention this section id — the stylesheet is keyed by node id, so it is orphaned`);
  }
  const g = pageData.general?.general ?? {};
  if (!Array.isArray(g.fontsToLoad)) problems.push('general.general.fontsToLoad is required — absent, the public render 500s');
  if (!Array.isArray(g.colors)) problems.push('general.general.colors is required (may be empty) — absent, the public render 500s');
  return problems;
};
