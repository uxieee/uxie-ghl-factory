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
import { KIND_DEFAULT_EXTRA, KIND_PDP_STYLES, fillTextFieldInitials } from './kind-defaults.mjs';
import { KIND_FACTORY_EXTRA, KIND_FACTORY_STYLES, KIND_FACTORY_WRAPPER } from './kind-factory-defaults.mjs';
import { nodeLayerCss, storedMap } from './style-layer.mjs';
import { kindCss, KIND_CSS_KINDS } from './kind-css.mjs';
import { entranceClass } from './page-animation.mjs';
import { KIND_BUILDER_EXTRA, KIND_BUILDER_STYLES } from './kind-builder-defaults.mjs';

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
//
// The list is the WHOLE enum (18 values) plus `go-to-membership`, which the button's action menu
// offers but the enum omits. Until 2026-09-28 it held only 8 and refused real actions — `none`,
// `download-file`, `click-to-call`/`sms`/`mail`, `show-hide-element`, `scroll-to-element`, the store
// actions — so the tool could not author half of what the builder can (found building the action
// specimen, knowledge sniffs/funnels-wave8-actions-2026-09-28).
export const ACTION_VALUES = Object.freeze([
  'go-to-next-funnel-step', 'go-to-product-collection', 'go-to-funnel-step', 'step-path', 'url',
  'download-file', 'openPopup', 'show-hide-element', 'scroll-to-element', 'sell-product',
  'add-to-cart', 'buy-now', 'click-to-call', 'click-to-sms', 'click-to-mail', 'none',
  'go-to-cac', 'logout', 'go-to-membership',
]);
export const GO_TO_NEXT_STEP = 'go-to-next-funnel-step';

// 🔴 AN IMAGE'S CLICK ACTION IS NOT `extra.action`. image and image-feature take it in `extra.imageActions`, svg in
// `extra.svgImageActions`; neither kind declares `action`. The public renderer switches on `imageActions` for all three
// (svg included, although the builder declares svgImageActions for it — so svg carries both). A composed image told
// to open a popup stored `action: openPopup` with `imageActions: []` and did nothing on click, while every check passed
// (knowledge sniffs/funnels-completeness-2026-09-29 notes-A D15). The values are the builder's own menus
// (index.e1b163ff.js `imageActions`, 11; `svgImageActions`, 4).
const IMAGE_ACTION_VALUES = Object.freeze(['none', 'openPopup', 'url', 'download-file', 'show-hide-element', 'scroll-to-element',
  'go-to-funnel-step', 'go-to-next-funnel-step', 'click-to-call', 'click-to-sms', 'click-to-mail']);
export const CLICK_ACTION_PROPS = Object.freeze({
  image: { props: ['imageActions'], values: IMAGE_ACTION_VALUES },
  'image-feature': { props: ['imageActions'], values: IMAGE_ACTION_VALUES },
  svg: { props: ['svgImageActions', 'imageActions'], values: Object.freeze(['none', 'openPopup', 'url', 'download-file']) },
});
/** Move a caller's `extra.action` to the prop this kind's renderer reads. Other kinds pass through untouched. */
export function routeClickAction(meta, extra = {}) {
  const spec = CLICK_ACTION_PROPS[meta];
  if (!spec || !extra || !Object.prototype.hasOwnProperty.call(extra, 'action')) return extra;
  const { action, ...rest } = extra;
  const v = action?.value ?? action;
  if (v !== '' && !spec.values.includes(v)) {
    throw Object.assign(new Error(`${meta}: click action '${v}' is not one the builder offers on this kind (${spec.values.join(', ')})`),
      { remediation: `Use one of ${spec.values.join(', ')}.` });
  }
  const out = { ...rest };
  for (const p of spec.props) out[p] = { value: v === '' ? 'none' : v };
  return out;
}
// ── An embedded form, survey or calendar ──
// The builder's Add-existing pickers store the asset as `{value: id, text: name}` (calendarId adds `isTeamSelected: false`; the survey picker
// stores the name lowercased) — knowledge sniffs/funnels-wave16-embeds-2026-09-29 live-embed.{form,survey,calendar}.json. The on-submit menu is
// `none` (the builder's default, shown "Please select an action") | `url` | `go-to-next-funnel-step` (survey ui: "none = Use action from survey
// builder"); the tool used to accept the 19-value button list on these kinds and to write `""` instead of `none`.
export const EMBED_KINDS = Object.freeze({ form: 'formId', survey: 'surveyId', calendar: 'calendarId' });
export const EMBED_ACTION_VALUES = Object.freeze(['none', 'url', 'go-to-next-funnel-step']);
/** Shape an embed's reference and action as the builder stores them; refuses what the builder cannot produce. Other kinds pass through. */
export function routeEmbedExtra(meta, extra = {}) {
  const prop = EMBED_KINDS[meta];
  if (!prop) return extra;
  const out = { ...extra };
  const ref = out[prop];
  if (ref !== undefined) {
    if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) {
      throw Object.assign(new Error(`${meta}: extra.${prop} must be {value: "<id>", text: "<the asset's name>"}, not ${JSON.stringify(ref)} — the renderer reads .value and the builder shows .text`),
        { remediation: `Name the ${meta === 'calendar' ? 'calendar' : meta} as {value, text} (read its id and name from list_forms / the calendars list).` });
    }
    if (typeof ref.value !== 'string') throw Object.assign(new Error(`${meta}: extra.${prop}.value must be the asset id (a string)`), { remediation: 'Pass the id the picker would store.' });
    out[prop] = meta === 'calendar' ? { isTeamSelected: false, ...ref } : ref;
  }
  const a = out.action?.value ?? out.action;
  if (a === undefined || a === '') out.action = { value: 'none' };
  else if (!EMBED_ACTION_VALUES.includes(a)) {
    throw Object.assign(new Error(`${meta}: on-submit action '${a}' is not one the builder offers on an embedded ${meta} (${EMBED_ACTION_VALUES.join(', ')})`),
      { remediation: `Use one of ${EMBED_ACTION_VALUES.join(', ')}; url also needs extra.visitWebsite.url.` });
  } else out.action = { value: a };
  return out;
}

/** The click action a node will perform, wherever its kind keeps it. */
export const clickActionOf = (n) => {
  const spec = CLICK_ACTION_PROPS[n?.meta];
  return spec ? n?.extra?.[spec.props[0]]?.value : n?.extra?.action?.value;
};

// ── Text size and weight, as the BUILDER compiles them ──
// On every save the builder throws the stored stylesheet away and recompiles each text and button node's sizes from
// the NODE: `extra.desktopFontSize/mobileFontSize/tabletFontSize` as `${value}${unit}` and `styles.fontWeight.desktop/
// .mobile/.tablet`, at its 0–767 / 768–10000 / 768–1024 breakpoints (textElementMediaQueryStyle and buttonElementStyle,
// page-builder index.e1b163ff.js). Sizes that lived only in the tool's compiled CSS were lost on the first builder save
// (64 × `font-size:undefined`, knowledge sniffs/funnels-wave19-tool-drift-2026-09-29 ui-cap.builder-save.json). So the
// node carries them, and the compiled rules below are the builder's own output for that node — the public page reads
// the same sizes before and after anyone saves in the builder.
export const TEXT_SIZE_KINDS = Object.freeze(new Set(['heading', 'sub-heading', 'paragraph', 'rich-text', 'bulletList']));
const TABLET_MQ = 'screen and (min-width:768px) and (max-width:1024px)';
const MOBILE_MQ = 'screen and (min-width:0px) and (max-width:767px)';
const DESKTOP_MQ = 'screen and (min-width:768px) and (max-width:10000px)';
const sizeOf = (a) => (a ? `${a.value}${a.unit}` : null);
const spacing = (x) => (x?.itemSpacing ? `${x.itemSpacing.value}${x.itemSpacing.unit || ''}` : null);

/** textElementMediaQueryStyle, minified. */
export function builderTextSizeCss(node) {
  const { id, extra = {}, styles = {} } = node;
  const fw = styles.fontWeight;
  const d = sizeOf(extra.desktopFontSize) ?? '16px';
  const m = sizeOf(extra.mobileFontSize) ?? d;
  const t = sizeOf(extra.tabletFontSize);
  const tSp = spacing(node.tabletExtra);
  const tW = fw?.tablet ?? null;
  const mW = fw?.mobile ?? fw?.desktop;
  const heads = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  if (node.meta === 'rich-text') {
    const all = `.${id}.text-output,.${id} ul li,.${id}`;
    const hs = heads.map((h) => `.${id}.text-output ${h}`).join(',');
    const mSp = spacing(node.mobileExtra);
    let tablet = '';
    if (t || tSp || tW) {
      tablet = `@media ${TABLET_MQ}{${t ? `${all}{font-size:${t}!important}` : ''}${tW ? `${all}{font-weight:${tW}}${hs}{font-weight:${tW}!important}` : ''}`
        + `${tSp ? `.${id}.text-output li:not(:last-child){margin-bottom:${tSp}!important}` : ''}}`;
    }
    return `@media ${MOBILE_MQ}{${all}{font-size:${m}!important;font-weight:${mW}}${hs}{font-weight:${mW}!important}`
      + `.${id}.text-output li:not(:last-child){margin-bottom:${mSp ? `${mSp}!important` : '0px'}}}`
      + `@media ${DESKTOP_MQ}{${all}{font-size:${d}!important;font-weight:${fw?.desktop}}${hs}{font-weight:${fw?.desktop}!important}}${tablet}`;
  }
  const all = [`.${id}.text-output`, `.${id} ul li`, ...heads.map((h) => `.${id} ${h}`)].join(',');
  const mSp = spacing(node.mobileExtra);
  const bullet = node.meta === 'bulletList';
  let tablet = '';
  if (t || tW || (bullet && tSp)) {
    tablet = `@media ${TABLET_MQ}{${t ? `${all}{font-size:${t}!important}` : ''}${tW ? `${all}{font-weight:${tW}}` : ''}`
      + `${bullet && tSp ? `.${id}.text-output li:not(:last-child){margin-bottom:${tSp}!important}` : ''}}`;
  }
  return `@media ${MOBILE_MQ}{${all}{font-size:${m}!important;font-weight:${mW}}`
    + `${bullet ? `.${id}.text-output li:not(:last-child){margin-bottom:${mSp ? `${mSp}!important` : '0px'}}` : ''}}`
    + `@media ${DESKTOP_MQ}{${all}{font-size:${d}!important;font-weight:${fw?.desktop}}}${tablet}`;
}

/** The size and weight half of buttonElementStyle (icons and animations are compiled elsewhere), minified. */
export function builderButtonSizeCss(node) {
  const { id, extra = {}, styles = {} } = node;
  const fw = styles.fontWeight; const fs = styles.fontWeightSub;
  const d = sizeOf(extra.desktopFontSize) ?? '20px';
  const m = sizeOf(extra.mobileFontSize) ?? d;
  const t = sizeOf(extra.tabletFontSize) ?? d;
  const sd = sizeOf(extra.subTextDesktopFontSize) ?? '15px';
  // the builder falls back to the raw desktop sub-size OBJECT here (prints "[object Object]"); the tool always
  // writes subTextMobileFontSize, so this branch is the builder's behaviour, kept for a node written by someone else
  const sm = sizeOf(extra.subTextMobileFontSize) ?? String(extra.subTextDesktopFontSize);
  const st = sizeOf(extra.subTextTabletFontSize) ?? sd;
  const color = styles.secondaryColor ? styles.secondaryColor.value : styles.color?.value;
  const main = (size, w) => `.${id} .main-heading-button,.${id} .button-icon-start,.${id} .button-icon-end{font-size:${size};font-weight:${w}}`
    + `.${id} .button-icon-start{margin-right:5px}.${id} .button-icon-end{margin-left:5px}`;
  const sub = (size, w) => `.${id} .sub-heading-button{font-size:${size};color:${color};font-weight:${w}}`;
  return `@media ${DESKTOP_MQ}{${main(d, fw?.desktop)}${sub(sd, fs?.desktop)}}`
    + `@media ${TABLET_MQ}{${main(t, fw?.tablet ?? fw?.desktop)}${sub(st, fs?.tablet ?? fs?.desktop)}}`
    + `@media ${MOBILE_MQ}{${main(m, fw?.mobile ? fw.mobile : fw?.desktop)}${sub(sm, fs?.mobile)}}`;
}

/** The builder's size/weight rules for a node, or '' for a kind it does not compile them for here. */
export const elementSizeCss = (node) => (TEXT_SIZE_KINDS.has(node?.meta) ? builderTextSizeCss(node)
  : node?.meta === 'button' ? builderButtonSizeCss(node) : '');

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
  // 🔴 A FONT prop is a string, whatever the kind. The builder feeds every element's `typography` (and each
  // *FontFamily) to isCustomFont(value) → value.replace(…) on EVERY save; an array there (nav-menu was forced to
  // arrays) throws, and the page can never be saved in the builder again while its public render stays fine
  // (knowledge sniffs/funnels-wave15-actions-2026-09-29 live-differential.builder-save-kinds.json). Empty = no font.
  if (/^typography$|fontfamily$/i.test(prop)) return { value: '' };
  const forced = meta && SHAPE_BY_KIND[meta];
  if (forced === 'arrays') return { value: [] };
  if (forced === 'strings') return { value: '' };
  // `icon` is NOT media. It is a glyph descriptor, and the name-based heuristic used to hand it a
  // bgImage-shaped object — which the PUBLIC renderer ignored while the BUILDER printed a literal
  // "undefined" in front of every heading and paragraph. Proven live 2026-09-09. Keep this branch
  // above the media test, whose regex would otherwise swallow it.
  if (/^icon$/i.test(prop)) return { value: { name: '', unicode: '', fontFamily: '' } };
  // a reference to another asset carries the id AND its display name
  if (REFERENCE_EXTRA_PROPS.has(prop)) return { value: '', text: '' };
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
import { KIND_DEFAULT_STYLES, KIND_CONFIG_EXTRA } from './kind-style-defaults.mjs';
import { KIND_TAGNAME, KIND_ORACLE_EXTRA, KIND_ORACLE_STYLES, KIND_OMIT_EXTRA, KIND_TITLE, KIND_OMIT_CLASS, KIND_ORACLE_NEW_KEYS } from './kind-oracle-defaults.mjs';

export const NEEDS_STEP_TYPE = Object.freeze({
  'store-cart': 'store', 'store-checkout': 'store', 'store-thank-you': 'store',
  'blog-content': 'blog-post',
});

// 🔴 The product-page blocks (store-pdp-v2-*) need a step KEY, not a type, and a flagged section. The builder offers them
// only on a step whose key is one of these (the store's "Product details" step, type store; or a custom product page,
// type optin_funnel_page), and each block finds its product by walking up to the section with extra.pdpV2Section:true
// (a RAW boolean) and reading extra.selectedProducts.value — empty on the store's own page, where the product comes from
// the URL route. Read off GHL's own store page (knowledge sniffs/funnels-wave29-kinds-2026-09-29/live-read.pdp-page.json)
// and the builder's buildV2SectionExtra.
export const PDP_FUNNEL_STEP_KEYS = Object.freeze(['store-product-detail', 'store-custom-product-detail']);
export const isPdpKind = (meta) => typeof meta === 'string' && meta.startsWith('store-pdp-v2-');
export function pdpSectionExtra(pdp) {
  const products = pdp === true ? [] : pdp?.products;
  if (!Array.isArray(products) || products.some((p) => typeof p !== 'string' || !p)) {
    throw Object.assign(new Error('section pdp must be true or {products: [<product id>, …]}'), { remediation: 'true on the store\'s "Product details" step (the product comes from the URL); {products: [id]} on a custom product page, where the first id is the product shown.' });
  }
  return { selectedProducts: val(products), manageProducts: val(''), typography: val('var(--contentfont)'), pdpV2Section: true };
}

/** The problems of one product-page block in its section; `stepKey` is checked only when the caller passed it. */
export function pdpNodeProblems(n, section, opts = {}) {
  const out = [];
  if (n?.type !== 'element' || !isPdpKind(n.meta)) return out;
  if ('stepKey' in opts && !PDP_FUNNEL_STEP_KEYS.includes(opts.stepKey)) {
    out.push(`node ${n.id} (${n.meta}): product-page blocks belong on a step whose key is ${PDP_FUNNEL_STEP_KEYS.join(' or ')} (the store's "Product details" step, or a custom product page) — this step's key is ${opts.stepKey ? `'${opts.stepKey}'` : 'absent'}; the builder does not offer them anywhere else.`);
  }
  if (section?.metaData?.extra?.pdpV2Section !== true) {
    out.push(`node ${n.id} (${n.meta}): a product-page block reads its product from the section flagged extra.pdpV2Section:true — section ${section?.id} is not; give the section \`pdp: true\` (or {products: [id]}).`);
  }
  return out;
}

// 🔴 Kinds whose look depends on CSS only the page BUILDER compiles (bl-298). Measured 2026-09-29 by rendering one page
// of every plain kind before and after a builder save (knowledge sniffs/funnels-wave30-kind-css-2026-09-29,
// live-diff.pre-vs-post.json: these 31 change, the section width recompile aside), pricing-table (wave31) and the
// product-page page (wave29).
// The tool compiles none of their CSS yet, so until someone saves the page once in the builder a visitor sees them
// differently — unstyled buttons and selects, other heights, hidden or collapsed parts. A kind leaves this set when its
// builder style function is ported and the same harness shows no difference after a save.
const BUILDER_STYLED_ALL = [
  'video', 'divider', 'two-setp-order', 'one-step-order', 'nav-menu', 'nav-menu-v2', 'map', 'progress-bar',
  'image-feature', 'order-confirmation', 'faq', 'blog', 'blog-post', 'category-navigation', 'store-product-list',
  'store-product-detail', 'nav-cart', 'upsell', 'collection-list', 'featured-products', 'social-icons', 'image-slider',
  'searchbar', 'photo-video-gallery', 'social-share-blog', 'blog-subscribe-form', 'featured-product',
  'store-custom-product-detail', 'logo-showcase', 'qr-code', 'testimonial',
  // pricing-table rendered nothing bare on 1.24.0; with the builder's factory defaults it renders its table, and a builder
  // save relays it on mobile (530 → 1362 px; knowledge sniffs/funnels-wave31-styles-live-2026-09-29 live-render-diff.json)
  'pricing-table',
  'store-pdp-v2-title', 'store-pdp-v2-price', 'store-pdp-v2-images', 'store-pdp-v2-variants', 'store-pdp-v2-quantity',
  'store-pdp-v2-add-to-cart', 'store-pdp-v2-buy-now', 'store-pdp-v2-review-stars', 'store-pdp-v2-description',
  'store-pdp-v2-related-products', 'store-pdp-v2-reviews',
];
// A kind leaves the set when its per-kind rules are compiled here (core/kind-css.mjs): then the page a tool writes and the page
// the builder saves carry the same CSS for it (measured: knowledge sniffs/funnels-wave30-kind-css-2026-09-29, learn/check.*).
export const BUILDER_STYLED_KINDS = Object.freeze(new Set(BUILDER_STYLED_ALL.filter((k) => !KIND_CSS_KINDS.includes(k))));
/** The builder's per-kind CSS for a node of a ported kind ('' when the kind is not ported or the node is outside what was
 *  measured — `kindCssRefusal` says which). `palette` is the page's palette (general.general.colors). */
export const kindLayerCss = (node, palette) => { const r = kindCss(node, mergePalette(palette)); return r.css ?? ''; };
export const kindCssRefusal = (node, palette) => { if (!KIND_CSS_KINDS.includes(node?.meta)) return null; const r = kindCss(node, mergePalette(palette)); return r.refused ?? null; };
export const BUILDER_STYLING_WARNING = 'these render differently until the page is saved once in the page builder, which compiles their CSS (bl-298); open and save it there before sharing the page';
// Kept for 1.24.0's consumers: the product-page subset of builderStyling, with its original sentence. Deprecated.
export const PDP_STYLING_WARNING = 'these blocks render unstyled until the page is opened and saved once in the page builder (bl-298); do that before sharing the page';
const styledNodes = (pageData, pred, { sectionIds = null, popupIds = null } = {}, describe = (n) => ({ id: n.id, kind: n.meta })) => [
  ...(pageData?.sections ?? []).filter((sec) => !sectionIds || sectionIds.has(sec.id)).flatMap((sec) => sec.elements ?? []),
  ...(pageData?.popupsList ?? []).filter((p) => (sectionIds ? popupIds?.has(p.id) : true)).flatMap((p) => p.elements ?? []),
].filter((n) => n?.type === 'element' && pred(n)).map(describe).filter(Boolean);
/** The preview/result entry for builder-styled kinds this call writes (the whole page's, or the appended `sectionIds` /
 *  `popupIds` of an edit), or null. */
export function builderStylingWarning(pageData, scope) {
  const palette = pageData?.general?.general?.colors;
  const nodes = [
    ...styledNodes(pageData, (n) => BUILDER_STYLED_KINDS.has(n.meta), scope),
    // a ported kind whose node carries an input the measurements do not cover is compiled by the builder alone
    ...styledNodes(pageData, (n) => KIND_CSS_KINDS.includes(n.meta), scope, (n) => { const why = kindCssRefusal(n, palette); return why ? { id: n.id, kind: n.meta, reason: why } : null; }),
  ];
  return nodes.length ? { nodes, warning: BUILDER_STYLING_WARNING } : null;
}
/** Deprecated alias (1.24.0): the product-page subset. */
export function pdpStylingWarning(pageData, scope) {
  const nodes = styledNodes(pageData, (n) => isPdpKind(n.meta) && !KIND_CSS_KINDS.includes(n.meta), scope);
  return nodes.length ? { nodes, warning: PDP_STYLING_WARNING } : null;
}

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

// Props that REFERENCE another asset by id. They are `{value, text}` — the id plus the asset's name
// as of the moment it was written. Proven live 2026-09-10 on a `form` node from GHL's "Web Platform"
// template: `{"value":"jKwjvV2VCm6nWM1PnVTk","text":"Claim My Link"}`. A scan for `"formId":"<id>"`
// matches nothing, which is how two independent sessions declared a page clean that carried a live
// reference — match on `extra.<prop>.value`, or on the element's `meta`.
export const REFERENCE_EXTRA_PROPS = Object.freeze(new Set(['formId', 'surveyId', 'calendarId']));

let counter = 0;
export const resetIds = () => { counter = 0; };
export const mkId = (kind, salt = 'B') => `${kind}-${salt}${(counter++).toString(36).toUpperCase()}`;

// 🔴 `extra.nodeId` GOES ON LEAF ELEMENTS ONLY, AND IT PICKS THE SELECTOR THE BUILDER WRITES.
// On every load the builder throws away the stored `general.sectionStyles` and recomputes it from the
// nodes (getSectionGeneralAttributes -> computePageElementsStyles, parentClassName
// "hl_page-preview--content"). computeElementStyleStr then keys each rule on `extra.nodeId` when the
// prop is present and on `id` when it is not. Give a section, row or column a nodeId and its
// background, padding and width are written against `.csection-<id>` — a class no DOM element
// carries — so the CANVAS silently loses every container style while the stored CSS still renders the
// PUBLIC page correctly. The two surfaces then disagree about the same page and nothing errors.
// Counted on a GHL-authored page: 0/6 sections, 0/19 rows, 0/39 cols carry nodeId; all 79 leaves do.
const envelope = (id, type, meta, tagName, extra, styles, cls, wrapper) => ({
  id, type, meta, tagName: tagName ?? null, title: meta, child: [],
  class: { ...BOX(), ...(cls ?? {}) }, styles: styles ?? {}, wrapper: { ...MARGINS(), ...(wrapper ?? {}) },
  extra: {
    ...(type === 'element' ? { nodeId: `c${id}` } : {}),
    visibility: val({ hideDesktop: false, hideMobile: false }), customClass: val([]), ...(extra ?? {}),
  },
  customCss: [], tabletStyles: {}, tabletWrapper: {}, mobileStyles: {}, mobileWrapper: {}, updated: true,
});

/** Every declared prop, present. Caller values win; anything unspecified gets a shaped empty. */
// A deep copy in which no object is shared: structuredClone keeps two keys that pointed at ONE object (the builder's registry
// defaults share a desktop and a tablet font-size object) pointing at one clone, so a write through either key changed both.
export const unshare = (v) => (Array.isArray(v) ? v.map(unshare) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unshare(x)])) : v);
export const completeExtra = (meta, given = {}) => {
  const declared = ELEMENTS[meta]?.extraProps ?? [];
  // Kinds with a required object a heuristic cannot invent (store `customText`, blog show-options)
  // get the real default first; the shaped empty is only the last resort.
  // Hand-curated required objects first, then the builder-save config fill (kind-style-defaults.mjs).
  const known = { ...(KIND_CONFIG_EXTRA[meta] ?? {}), ...(KIND_DEFAULT_EXTRA[meta] ?? {}) };
  // 🔴 Below those, the BUILDER's own fresh-node default (kind-builder-defaults.mjs, generated from its element
  // registry). A name-guessed empty is what a builder save compiled into `font-size:undefined` 64 times on one tool
  // page (a `{value:""}` size is truthy, so `${value}${unit}` prints "undefined"), and what gave the store kinds an
  // itemsPerPage of [] and the timers an expireAction of "" (knowledge sniffs/funnels-completeness-2026-09-29
  // a-defaults-diff.json). emptyFor is now only for a prop the builder declares no default for.
  // The builder's own element FACTORY (kind-factory-defaults.mjs, createNewElement run offline) wins over the older
  // registry table: the table missed shared factories (the product-page buttons) and inverted featured-product.
  const factory = KIND_FACTORY_EXTRA[meta] ?? {};
  const builder = { ...(KIND_BUILDER_EXTRA[meta] ?? {}), ...factory };
  const out = {};
  for (const prop of declared) {
    // 🔴 `visibility` and `customClass` are declared on most kinds, and the envelope already gives
    // them their real shapes ({hideDesktop,hideMobile} and []). A shaped empty here is `{value:""}`,
    // which is spread OVER the envelope and 500s image-feature, blog, upsell and photo-video-gallery
    // on the public page while autosave answers 201 (console bl-245, proven by differential in
    // knowledge sniffs/funnels-wave3-elements-2026-09-26/fix-diff.json). Leave them to the envelope.
    if ((prop === 'visibility' || prop === 'customClass') && !Object.prototype.hasOwnProperty.call(given, prop)) continue;
    out[prop] = Object.prototype.hasOwnProperty.call(given, prop) ? given[prop]
      : Object.prototype.hasOwnProperty.call(known, prop) ? known[prop]
        : Object.prototype.hasOwnProperty.call(builder, prop) ? builder[prop]
          : emptyFor(prop, meta);
  }
  // `customText` is a nested label table. The template-derived one (`known`) predates labels the builder's factory has since
  // added, and a builder Save fills them in (product detail: the description show more / less and view-details button labels,
  // knowledge sniffs/funnels-wave42-f7-defaults-2026-09-30 node-diff.pdp-after-save.json). Fill the gaps from the factory's table;
  // what the template or the caller wrote stays.
  if (!('customText' in given) && known.customText?.value && factory.customText?.value) {
    const fill = (base, over) => (over && typeof over === 'object' && !Array.isArray(over) && base && typeof base === 'object' && !Array.isArray(base)
      ? Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(over)])].map((k) => [k, k in over ? fill(base[k], over[k]) : base[k]])) : over);
    out.customText = { ...out.customText, value: fill(factory.customText.value, known.customText.value) };
  }
  // A kind may need a property its own registry entry does not declare — `customText` is declared,
  // but `step1` on store-checkout is not, and the renderer reads it anyway.
  for (const [prop, v] of Object.entries(known)) if (!(prop in out)) out[prop] = v;
  // …and every config prop the builder's factory writes on a fresh node, declared or not: a bare tool node is the
  // builder's fresh node minus content (knowledge sniffs/funnels-wave30-kind-css-2026-09-29 offline-tool-vs-fresh.json).
  for (const [prop, v] of Object.entries(factory)) if (!(prop in out) && !(prop in given)) out[prop] = v;
  // A SIZE prop the builder declares with no default (most tablet sizes, the pricing table's mobile sizes) takes its
  // desktop sibling — the builder's own fallback when a breakpoint has no size — or, failing that, the same prop's
  // default on another kind. Never a shaped empty: `${value}${unit}` of {value:""} compiles to "undefined".
  for (const [prop, v] of Object.entries(out)) {
    if (!/FontSize$/.test(prop) || Object.prototype.hasOwnProperty.call(given, prop) || isSize(v)) continue;
    const sib = prop.replace(/(Tablet|Mobile)FontSize$/, 'DesktopFontSize').replace(/^(tablet|mobile)FontSize$/, 'desktopFontSize');
    out[prop] = isSize(out[sib]) ? out[sib] : (SIZE_ELSEWHERE[prop] ?? SIZE_ELSEWHERE[sib] ?? px(16));
  }
  return { ...out, ...given };
};
const isSize = (v) => !!v && typeof v === 'object' && typeof v.value === 'number' && !!v.unit;
// The first builder default for each size prop across all kinds.
const SIZE_ELSEWHERE = Object.freeze(Object.values(KIND_BUILDER_EXTRA).reduce((acc, o) => {
  for (const [k, v] of Object.entries(o)) if (/FontSize$/.test(k) && isSize(v) && !(k in acc)) acc[k] = v;
  return acc;
}, {}));

// 🔴 A BUTTON WITH NO COLOUR KILLS THE PAGE BUILDER (console bl-119). Its styleStr reads
// `styles.secondaryColor ? styles.secondaryColor.value : styles.color.value` UNGUARDED, so a button
// saved with styles:{} throws on every render pass and the builder can no longer save (422 "pageData
// should not be empty"), while the public page renders. GHL's own buttons always carry color,
// secondaryColor and backgroundColor (knowledge sniffs/funnel-native-elements-2026-09-09); an absent
// one is filled here, an authored one is never overwritten.
//
// 🔴 The background was `var(--blue)` until 2026-09-29, and `--blue` is NOT a builder palette variable (its palette is
// primary, secondary, white, gray, black, red, orange, yellow, green, teal, malibu, indigo, purple, pink, cobalt,
// smoke, overlay, transparent — index.e1b163ff.js `colors`), so no page ever declared it and a default button had no
// background even after a builder save. `var(--cobalt)` is the builder's own fresh-button background.
const BUTTON_STYLE_DEFAULTS = {
  color: { value: 'var(--white)' },
  secondaryColor: { value: 'var(--white)' },
  backgroundColor: { value: 'var(--cobalt)' },
};
// 🔴 THE SAME TRAP ON THE ORDER FORMS: the builder's orderFormStyles reads styles.buttonColor / buttonTextColor /
// formBgColor / buttonSize / formRadius / textAlign `.value` UNGUARDED on every save, so an order form composed with
// styles:{} made the whole page unsaveable in the builder ("Error while creating page!", nothing sent) while it
// rendered in public. These are the builder's own ONE_STEP_ORDER defaults, read from its element registry
// (page builder index.e1b163ff.js); an authored style is never overwritten.
const ORDER_FORM_STYLE_DEFAULTS = {
  textAlign: { value: 'left' },
  buttonColor: { value: 'var(--secondary)' },
  buttonTextColor: { value: 'var(--white)' },
  buttonSize: { value: '1rem' },
  buttonStyle: { value: 'none' },
  formBgColor: { value: '#ffffff' },
  formRadius: { value: 5, unit: 'px' },
};
// The nav menus: navMenuStyles / generateNavBarTextStyles read styles.lineHeight and ~30 more style values unguarded.
// These are the builder's own NAV_MENU_V2 default styles, verbatim from its element registry (index.e1b163ff.js);
// both nav kinds go through the same style function.
const NAV_MENU_STYLE_DEFAULTS = {"paddingTop": {"value": 8, "unit": "px"}, "paddingBottom": {"value": 8, "unit": "px"}, "paddingLeft": {"value": 10, "unit": "px"}, "paddingRight": {"value": 10, "unit": "px"}, "marginTop": {"value": 0, "unit": "px"}, "marginBottom": {"value": 0, "unit": "px"}, "marginLeft": {"value": 0, "unit": "px"}, "marginRight": {"value": 0, "unit": "px"}, "lineHeight": {"value": 1.3, "unit": "em"}, "textTransform": {"value": "none"}, "letterSpacing": {"value": 0, "unit": "px"}, "textAlign": {"value": "left"}, "fontWeight": {"value": "normal", "desktop": "400"}, "backgroundColor": {"value": "var(--white)"}, "mobileBackgroundColor": {"value": "var(--white)"}, "popupBackgroundColor": {"value": "var(--white)"}, "mobilePopupBackgroundColor": {"value": "var(--white)"}, "color": {"value": "var(--text-color)"}, "inlineColors": {"value": []}, "hoverBackgroundColor": {"value": "var(--black)"}, "hoverTextColor": {"value": "var(--white)"}, "boldTextColor": {"value": "var(--black)"}, "italicTextColor": {"value": "var(--black)"}, "underlineTextColor": {"value": "var(--black)"}, "iconColor": {"value": "var(--black)"}, "cartIconColor": {"value": "var(--black)"}, "userIconColor": {"value": "var(--black)"}, "cartIconActiveColor": {"value": "var(--black)"}, "submenuBackgroundColor": {"value": "var(--white)"}, "submenuMobileBackgroundColor": {"value": "var(--white)"}, "submenuColor": {"value": "var(--text-color)"}, "submenuHoverBackgroundColor": {"value": "var(--black)"}, "submenuHoverTextColor": {"value": "var(--white)"}, "borderColor": {"value": "#000000"}, "borderStyle": {"value": "none"}, "borderWidth": {"value": "0px"}, "borderRadius": {"value": "0px"}, "boxShadow": {"value": "none"}};
const STYLE_DEFAULTS = { button: BUTTON_STYLE_DEFAULTS, 'one-step-order': ORDER_FORM_STYLE_DEFAULTS, 'two-setp-order': ORDER_FORM_STYLE_DEFAULTS,
  'nav-menu': NAV_MENU_STYLE_DEFAULTS, 'nav-menu-v2': NAV_MENU_STYLE_DEFAULTS };
// A video's source: the builder picks the player from videoProperties.value.type (youtube | vimeo | wistia | custom_embed |
// html | selfHosted) and reads url (or selfHostedVideo {id, name, url} for a Media Storage file). A caller naming only a
// url gets the builder's full value around it and a type read off the url; an authored type always wins.
export const VIDEO_TYPES = Object.freeze(['youtube', 'vimeo', 'wistia', 'custom_embed', 'html', 'selfHosted']);
// The builder's own classifier (page builder getVideoType, bundle e1b163ff): an empty url or youtube.com / youtu.be → youtube, vimeo.com → vimeo,
// wistia.com → wistia, a url CONTAINING .mp4 .webm .mov .avi .m4v or .ogv → html, anything else (Loom, .m3u8, .ogg, an embed page) → custom_embed.
const DIRECT_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.m4v', '.ogv'];
export function videoTypeOf(url) {
  const u = String(url ?? '');
  if (!u || u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('vimeo.com')) return 'vimeo';
  if (u.includes('wistia.com')) return 'wistia';
  const lower = u.toLowerCase();
  if (DIRECT_VIDEO_EXTENSIONS.some((e) => lower.includes(e))) return 'html';
  return 'custom_embed';
}
export function normalizeVideoExtra(extra = {}) {
  const given = extra.videoProperties;
  if (!given || typeof given !== 'object') return extra;
  const v = { ...KIND_DEFAULT_EXTRA.video.videoProperties.value, ...(given.value ?? {}) };
  v.selfHostedVideo = { ...KIND_DEFAULT_EXTRA.video.videoProperties.value.selfHostedVideo, ...(given.value?.selfHostedVideo ?? {}) };
  if (!given.value?.type) v.type = v.selfHostedVideo.id ? 'selfHosted' : videoTypeOf(v.url);
  return { ...extra, videoProperties: { value: v } };
}
// A composed video with no source renders an empty box in public while every write answers 201.
export function videoSourceProblems(pageData, onlyIds = null) {
  const out = [];
  const walk = (els) => { for (const n of els ?? []) {
    if (n.meta === 'video' && (!onlyIds || onlyIds.has(n.id))) {
      const v = n.extra?.videoProperties?.value ?? {};
      const src = v.type === 'selfHosted' ? v.selfHostedVideo?.id : (v.type === 'custom_embed' ? (v.customEmbedCode ?? v.url) : v.url);
      if (!src) out.push(`video ${n.id}: no source — set extra.videoProperties.value.url (a YouTube, Vimeo, Wistia or .mp4 URL) or selfHostedVideo {id, name, url} of a Media Storage file; without one the public page shows an empty box`);
      else if (!VIDEO_TYPES.includes(v.type)) out.push(`video ${n.id}: videoProperties.value.type '${v.type}' is not one of ${VIDEO_TYPES.join(', ')}`);
      else if (v.type !== 'selfHosted' && v.type !== 'custom_embed' && v.url && videoTypeOf(v.url) !== v.type) out.push(`video ${n.id}: type '${v.type}' does not match its url — the builder reads it as '${videoTypeOf(v.url)}' (youtube.com/youtu.be, vimeo.com, wistia.com, a .mp4/.webm/.mov/.avi/.m4v/.ogv file, else custom_embed) and would switch the player when the page is next opened; drop the type or set the one the builder derives`);
    }
  } };
  for (const s of pageData.sections ?? []) walk(s.elements);
  for (const p of pageData.popupsList ?? []) walk(p.elements);
  return out;
}

// The kinds whose CSS this tool compiles itself, as the builder does (f1: textElementMediaQueryStyle, buttonElementStyle).
export const TOOL_COMPILED_KINDS = Object.freeze(new Set(['heading', 'sub-heading', 'paragraph', 'rich-text', 'bulletList', 'button']));

export const makeLeaf = ({ meta, extra = {}, styles = {}, cls = {}, tag = '', salt, wrapper, tabletStyles, mobileStyles, tabletWrapper, mobileWrapper }) => {
  if (!ELEMENTS[meta]) throw new Error(`unknown element meta '${meta}' — the vocabulary is a closed set of ${ELEMENT_KINDS.length}`);
  const id = mkId(meta, salt);
  // The builder's fontWeight objects first: its text, button and timer compilers read `.desktop` / `.mobile` from them
  // and print `font-weight:undefined` when the object is absent (wave19 ui-cap.builder-save.json).
  // Each gets `.mobile` too: the button compiler prints the sub-text's mobile weight with NO fallback to desktop, so the
  // builder's own fresh button compiles `font-weight:undefined` there.
  const builderStyles = KIND_BUILDER_STYLES[meta] ?? {};
  // boxShadow likewise: the builder compiles an image's `box-shadow` from it with no fallback (`box-shadow:undefined`).
  const weights = Object.fromEntries(Object.entries(builderStyles).filter(([k]) => /^fontWeight|^boxShadow$/.test(k)));
  // Lowest: every style key the builder's factory writes on a fresh node (its compilers read them unguarded) — except on
  // the kinds this tool compiles itself (TOOL_COMPILED_KINDS), where the builder's fresh values (textAlign center, colours)
  // would make a builder save restyle what the tool rendered: their node styles stay as proven (wave26 saved-bytes).
  const factoryStyles = TOOL_COMPILED_KINDS.has(meta) ? {} : (KIND_FACTORY_STYLES[meta] ?? {});
  const base = { ...factoryStyles, ...weights, ...(KIND_DEFAULT_STYLES[meta] ?? {}), ...(KIND_PDP_STYLES[meta] ?? {}), ...(STYLE_DEFAULTS[meta] ?? {}) };
  // Every default weight object gets `.mobile` = `.desktop`, whichever table it came from: the template-derived nav-menu
  // and image-feature weights lacked it too and a builder save compiled `font-weight:undefined` into their mobile rules
  // (f1 kinds check, knowledge sniffs/funnels-wave26-builder-save-2026-09-29 live-saved-bytes.kinds.json).
  for (const [k, w] of Object.entries(base)) if (/^fontWeight/.test(k) && w && typeof w === 'object' && w.desktop !== undefined && w.mobile === undefined) base[k] = { ...w, mobile: w.desktop };
  // A template node's CUSTOM palette colour (`var(--color-mckljcbj)`) is declared only on that template's page; here it
  // resolves to nothing. The builder's own default for the same key replaces it.
  for (const [k, v] of Object.entries(base)) if (/var\(--color-/.test(JSON.stringify(v)) && builderStyles[k]) base[k] = builderStyles[k];
  // Likewise a template's FONT variable (`var(--open-sans)` on faq): nothing declares or loads it on this page, so it
  // becomes the page's content font, which is what the builder gives a fresh element (bl-267: fonts go through vars).
  for (const [k, v] of Object.entries(base)) {
    if (/FontFamily$/.test(k) && typeof v?.value === 'string' && /^var\(--(?!headlinefont\)|contentfont\))/.test(v.value)) base[k] = { ...v, value: 'var(--contentfont)' };
  }
  // What the builder writes at runtime (kind-oracle-defaults.mjs) sits over the tables, under what the caller named.
  const oracleStyles = KIND_ORACLE_STYLES[meta];
  if (oracleStyles) Object.assign(base, oracleStyles);
  const withDefaults = Object.keys(base).length ? { ...base, ...styles } : styles;
  const routed = routeEmbedExtra(meta, routeClickAction(meta, meta === 'video' ? normalizeVideoExtra(extra) : extra));
  const oracleExtra = KIND_ORACLE_EXTRA[meta]?.(new Date().toISOString()) ?? {};
  const filled = fillTextFieldInitials(meta, unshare(completeExtra(meta, routed)));
  for (const [k, v] of Object.entries(oracleExtra)) if (!Object.prototype.hasOwnProperty.call(routed, k) && (k in filled || KIND_ORACLE_NEW_KEYS[meta]?.includes(k))) filled[k] = structuredClone(v);
  if (KIND_OMIT_EXTRA[meta]) for (const k of Object.keys(filled)) if (KIND_OMIT_EXTRA[meta].test(k) && !Object.prototype.hasOwnProperty.call(routed, k)) delete filled[k];
  const node = envelope(id, 'element', meta, KIND_TAGNAME[meta] ?? ELEMENTS[meta].tagName, filled, withDefaults, cls, TOOL_COMPILED_KINDS.has(meta) ? undefined : KIND_FACTORY_WRAPPER[meta]);
  if (KIND_TITLE[meta]) node.title = KIND_TITLE[meta];
  for (const k of KIND_OMIT_CLASS[meta] ?? []) if (!Object.prototype.hasOwnProperty.call(cls, k)) delete node.class[k];
  // The wrapper and per-device maps a caller gave (numbers are px), over the envelope's.
  if (wrapper) node.wrapper = { ...node.wrapper, ...storedMap(wrapper) };
  for (const [k, v] of Object.entries({ tabletStyles, mobileStyles, tabletWrapper, mobileWrapper })) if (v) node[k] = storedMap(v);
  // Most leaves carry tag:''. The store and blog kinds carry their tagName, and do not render without it.
  node.tag = tag || (TAG_IS_TAGNAME.has(meta) ? ELEMENTS[meta].tagName : '');
  return node;
};

export const makeColumn = ({ children, widthPct, padX = 20, salt, background, bgImage }) => {
  const id = mkId('col', salt);
  const col = envelope(id, 'col', 'col', 'c-column',
    { bgImage: bgImage ? sectionBgImage(bgImage) : BG_IMAGE, columnLayout: val('column'), justifyContentColumnLayout: val('center'),
      alignContentColumnLayout: val('inherit'), forceColumnLayoutForMobile: val(true), elementVersion: val(2) },
    { paddingTop: px(0), paddingBottom: px(0), paddingLeft: px(padX), paddingRight: px(padX),
      backgroundColor: val(background ?? 'transparent'), width: { value: String(widthPct), unit: '%' } });
  col.child = children.map((c) => c.id);
  return col;
};

// Section knobs from the builder's General tab (UI-measured, knowledge sniffs/funnels-wave11-structure-styling-2026-09-28;
// option values from the builder's section config): Sticky → extra.sticky, Width → class.width,
// "Allow Rows to take entire width" → extra.allowRowMaxWidth plus the compiled `#<id>>.inner{max-width:100%}`.
export const SECTION_STICKY = Object.freeze({ none: 'noneSticky', top: 'stickyTop', bottom: 'stickyBottom' });
export const SECTION_WIDTH = Object.freeze({ full: 'fullSection', wide: 'wideSection', midWide: 'midWideSection', small: 'midSection' });
// The builder's sectionStyle(): with rows allowed full width the inner is 100 %, otherwise 1170px. The builder
// RECOMPILES this rule on every save, so a composed `maxWidth` other than 1170 lasts only until someone saves
// the page in the builder.
export const BUILDER_INNER_MAX_WIDTH = 1170;
export const sectionInnerRule = (sid, { fullWidthRows, maxWidth }) => `#${sid}>.inner{max-width:${fullWidthRows ? '100%' : `${maxWidth}px`}}`;
export function sectionKnobs({ sticky, width, fullWidthRows, pdp } = {}) {
  const extra = {}; const cls = {};
  if (pdp !== undefined && pdp !== false) Object.assign(extra, pdpSectionExtra(pdp));
  if (sticky !== undefined) {
    if (!SECTION_STICKY[sticky]) throw Object.assign(new Error(`section sticky must be one of ${Object.keys(SECTION_STICKY).join(', ')}`), { remediation: 'none = scrolls away; top/bottom = stays fixed to that edge while the page scrolls.' });
    extra.sticky = val(SECTION_STICKY[sticky]);
  }
  if (width !== undefined) {
    if (!SECTION_WIDTH[width]) throw Object.assign(new Error(`section width must be one of ${Object.keys(SECTION_WIDTH).join(', ')}`), { remediation: 'The builder\'s Width dropdown: Full, Wide, Mid Wide, Small.' });
    cls.width = val(SECTION_WIDTH[width]);
  }
  if (fullWidthRows !== undefined) extra.allowRowMaxWidth = val(fullWidthRows === true);
  return { extra, cls };
}

/** The keys a section spec in build_funnel_page may carry; any other is refused by name (it used to be dropped silently). */
/** What a column takes (a row holds 1–6 of them). Any other key is refused, not dropped. */
export const COLUMN_SPEC_KEYS = Object.freeze(['elements', 'widthPct', 'padX', 'background', 'bgImage']);
export const MAX_COLUMNS_PER_ROW = 6;
export const SECTION_SPEC_KEYS = Object.freeze(['columns', 'rows', 'background', 'padY', 'maxWidth', 'sticky', 'width', 'fullWidthRows', 'pdp',
  'styles', 'wrapper', 'tabletStyles', 'mobileStyles', 'tabletWrapper', 'mobileWrapper', 'visibility', 'customClass', 'bgImage', 'entranceAnimation']);

// A section's background image, in the builder's stored shape (the renderer reads it from extra.bgImage; it is never in
// the stylesheet — knowledge sniffs/funnels-wave30-kind-css-2026-09-29 probe-edges.json sectionBg).
const BG_OPTIONS = Object.freeze(['bgCover', 'bgContain', 'bgNoRepeat', 'bgRepeat', 'bgFixed']);
function sectionBgImage(spec) {
  if (spec === undefined) return BG_IMAGE;
  if (!spec || typeof spec !== 'object' || typeof spec.url !== 'string' || !/^https?:\/\//.test(spec.url)) throw Object.assign(new Error('section bgImage must be {url: "https://…", options?, opacity?}'), { remediation: `options: ${BG_OPTIONS.join(' | ')} (default bgCover); opacity 0–1 (default 1).` });
  if (spec.options !== undefined && !BG_OPTIONS.includes(spec.options)) throw new Error(`section bgImage.options must be one of ${BG_OPTIONS.join(', ')}`);
  return { value: { ...BG_IMAGE.value, url: spec.url, options: spec.options ?? 'bgCover', opacity: String(spec.opacity ?? 1) } };
}
const sectionClasses = (c) => { const list = Array.isArray(c) ? c : [c]; if (list.some((x) => typeof x !== 'string' || !/^[A-Za-z_][\w-]*$/.test(x))) throw new Error('section customClass must be class names (letters, digits, - and _)'); return list; };

/** A section's styling from a spec / set op, in node shape: layers to MERGE and per-device maps to REPLACE. */
export function sectionStylingPatch(o = {}) {
  const merge = {}; const replace = {};
  if (o.styles) merge.styles = storedMap(o.styles);
  if (o.wrapper) merge.wrapper = storedMap(o.wrapper);
  const extra = {};
  if (o.visibility) extra.visibility = val({ hideDesktop: !!o.visibility.hideDesktop, hideTablet: !!o.visibility.hideTablet, hideMobile: !!o.visibility.hideMobile });
  if (o.customClass) extra.customClass = val(sectionClasses(o.customClass));
  if (o.bgImage) extra.bgImage = sectionBgImage(o.bgImage);
  if (Object.keys(extra).length) merge.extra = extra;
  if (o.entranceAnimation) merge.class = entranceClass(o.entranceAnimation, 'section');
  for (const k of ['tabletStyles', 'mobileStyles', 'tabletWrapper', 'mobileWrapper']) if (o[k]) replace[k] = storedMap(o[k]);
  return { merge, replace, touchesCss: !!(o.styles || o.wrapper || o.entranceAnimation || Object.keys(replace).length) };
}

export const makeSection = ({ columns, rows, background = 'transparent', padY = 60, maxWidth = BUILDER_INNER_MAX_WIDTH, elementCss = '', pageId, funnelId, locationId, salt, sticky, width, fullWidthRows, pdp,
  styles, wrapper, tabletStyles, mobileStyles, tabletWrapper, mobileWrapper, visibility, customClass, bgImage, cls: extraCls, sectionCss = '' }) => {
  // 🔴 COLUMN WIDTHS MUST FILL THE ROW. A column is `flex: 1 1 auto`, so the `width` compiled here
  // acts as a flex BASIS, not a fixed size: a row whose widths sum to less than 100 does not leave a
  // gap, it GROWS every column to fill. Two columns at 33.33% render at 50% each — the page looks
  // deliberate and is not what was asked for, and nothing in the write path says so.
  //
  // Measured across 24 pages: compiled `sectionStyles` contains ZERO `flex:` declarations of any
  // kind, GHL-authored and API-built alike. Bare `width` is the platform's convention, so the fix is
  // never `flex: 0 0` — the defect is an incomplete SPEC, caught here rather than papered over. The
  // default path divides 100 evenly and always passes; only an explicit widthPct can trip it.
  //
  // 🔴 This guard is sound HERE and does not generalise to repairing an existing page. A composed
  // page gets exactly one width rule per column, emitted below — but GHL-authored columns routinely
  // carry SEVERAL (63 of 118 measured, up to 10: a base rule, `@media` variants and `!important`
  // overrides), so out there a column's width is the outcome of a cascade. On such a page correct
  // arithmetic can render WORSE than wrong arithmetic: removing `!important` overrides that said
  // 33.33% exposed a stale 41.5% base, and 41.5 x 3 = 124.5% wrapped the row. Repair means stripping
  // every existing width declaration first. See the anatomy page before touching a live stylesheet.
  // One row (`columns`) or several (`rows`: a list of column lists) — the builder's section holds any number of rows.
  const rowGroups = rows ?? [columns];
  for (const cols of rowGroups) {
    const widths = cols.map((c) => Number(c.widthPct)).filter((n) => Number.isFinite(n));
    const total = widths.reduce((a, b) => a + b, 0);
    if (widths.length === cols.length && cols.length > 0 && Math.abs(total - 100) > 1) {
      const err = new Error(
        `column widths in this row sum to ${Number(total.toFixed(2))}%, not 100% (${widths.join('% + ')}%). `
        + 'Columns are flex:1 1 auto, so width is a BASIS: they will be grown or shrunk to fill the row and '
        + `will NOT render at the widths given — ${cols.length} columns summing short render at `
        + `${Number((100 / cols.length).toFixed(2))}% each.`);
      // Carry the remediation with the error: the composer's catch cannot tell which of its many
      // failure modes threw, and its default advice (the element-kind list) is misleading here.
      err.remediation = 'Give widths that total 100, or omit widthPct entirely to divide the row evenly.';
      throw err;
    }
  }

  const sid = mkId('section', salt);
  const rowNodes = rowGroups.map((cols) => {
    const rid = mkId('row', salt);
    const r = envelope(rid, 'row', 'row', 'c-row', { bgImage: BG_IMAGE },
      { paddingTop: px(0), paddingBottom: px(0), backgroundColor: val('transparent') });
    r.child = cols.map((c) => c.col.id);
    return { row: r, cols };
  });
  const knobs = sectionKnobs({ sticky, width, fullWidthRows, pdp });
  const meta = envelope(sid, 'section', 'section', 'c-section',
    { sticky: val('noneSticky'), bgImage: sectionBgImage(bgImage), allowRowMaxWidth: val(false), ...knobs.extra,
      ...(visibility ? { visibility: val({ hideDesktop: !!visibility.hideDesktop, hideTablet: !!visibility.hideTablet, hideMobile: !!visibility.hideMobile }) } : {}),
      ...(customClass ? { customClass: val(sectionClasses(customClass)) } : {}) },
    { backgroundColor: val(background), paddingTop: px(padY), paddingBottom: px(padY), paddingLeft: px(20), paddingRight: px(20), ...(storedMap(styles) ?? {}) },
    { ...knobs.cls, ...(extraCls ?? {}) }, storedMap(wrapper));
  for (const [k, v] of Object.entries({ tabletStyles, mobileStyles, tabletWrapper, mobileWrapper })) if (v) meta[k] = storedMap(v);
  meta._id = sid; meta.child = rowNodes.map(({ row }) => row.id); meta.isGlobal = false;

  // The section, row and columns compile through the builder's generic layer (core/style-layer.mjs), so a builder save
  // writes the same rules; the inner width and the column's inner flex rule are the builder's per-kind additions.
  const scaffold = [
    nodeLayerCss({ ...meta, id: sid }),
    sectionInnerRule(sid, { fullWidthRows: fullWidthRows === true, maxWidth }),
    sectionCss,
    ...rowNodes.flatMap(({ row, cols }) => [nodeLayerCss(row), ...cols.map(({ col }) => nodeLayerCss(col) + `#${col.id}>.inner{flex-direction:column;justify-content:center;align-items:inherit;flex-wrap:nowrap}`)]),
  ].join('');

  return {
    id: sid, pageId, funnelId, locationId, isGlobal: false, metaData: meta,
    elements: rowNodes.flatMap(({ row, cols }) => [row, ...cols.flatMap(({ col, leaves }) => [col, ...leaves])]),
    general: { colors: [], fontsForPreview: [], rootVars: {}, sectionStyles: scaffold + elementCss, customFonts: [] },
  };
};

// The NODE styles a `css` block implies (console bl-120). A caller who styles a leaf through `css` got
// the public stylesheet and NO node styles, so the builder canvas showed default type while the public
// page was right. These are the keys GHL's own text and button leaves carry, in its {value} shape; an
// authored `styles` key always wins.
// fontWeight is the builder's per-breakpoint object ({value, desktop, mobile}); a `{value: 700}` was ignored by
// its compiler, which reads `.desktop`, and printed `font-weight:undefined` on the first builder save.
const weightObj = (w) => ({ value: '', desktop: String(w), mobile: String(w) });
export const nodeStylesFromCss = (meta, o = {}) => {
  const out = {};
  const put = (k, v) => { if (v !== undefined && v !== null && v !== '') out[k] = { value: v }; };
  if (meta === 'button') {
    put('backgroundColor', o.background); put('color', o.color); put('secondaryColor', o.color);
    // 600 is what this tool's compiled button rule always set; the builder's fresh button is 500
    out.fontWeight = weightObj(o.weight ?? 600);
  } else {
    put('color', o.color); put('fontFamily', o.font); put('textAlign', o.align);
    put('lineHeight', o.lineHeight);
    if (o.weight !== undefined && o.weight !== null && o.weight !== '') out.fontWeight = weightObj(o.weight);
  }
  return out;
};
// The NODE sizes a `css` block implies, where the builder reads them ({value, unit:'px'} on extra). A text size given
// without a mobile size keeps this tool's long-standing 80% mobile scale.
export const nodeExtraFromCss = (meta, o = {}) => {
  const out = {};
  if (meta === 'button') {
    const d = o.size ?? 16;
    out.desktopFontSize = px(d); out.mobileFontSize = px(o.mobileSize ?? d);
    // A button's font is `extra.typography`: the builder compiles `.c<id>{font-family}` from it (computeElementStyleStr)
    // and has no fontFamily style for a button, so a font only in the compiled rule was lost on the first builder save
    // (f1 render check: Georgia → the browser default, knowledge sniffs/funnels-wave26-builder-save-2026-09-29
    // render.pre-vs-post.json, cycle 2).
    if (o.font) out.typography = { value: o.font };
  } else if (TEXT_SIZE_KINDS.has(meta) && o.size !== undefined && o.size !== null && o.size !== '') {
    out.desktopFontSize = px(o.size); out.mobileFontSize = px(o.mobileSize ?? Math.round(o.size * 0.8));
  }
  return out;
};

// The box rule for a text leaf styled through `css`. Its sizes are NOT here: they are compiled from the node by
// elementSizeCss, exactly as the builder compiles them, so they survive a builder save.
export const textCss = (id, o) => {
  const weight = o.weight ?? 400;
  return [
    `${PREFIX} #${id}{margin:0}`,
    `${PREFIX} .c${id}{font-family:${o.font};color:${o.color};font-weight:${weight};padding:0;opacity:1;`
      + `line-height:${o.lineHeight ?? '1.35em'};letter-spacing:${o.letterSpacing ?? 0}px;text-align:${o.align ?? 'center'};background-color:transparent}`,
  ].join('');
};

// A leaf's `styles` object compiled to a real rule.
//
// 🔴 THE PAGE HAS TWO STYLING SOURCES AND ONLY ONE REACHES THE VISITOR. A node's `styles` drives
// the BUILDER canvas; `general.sectionStyles` is what the PUBLIC renderer lays out from. Until
// 2026-09-10 this engine emitted compiled rules for the section, the row and the columns, and for a
// leaf ONLY when the caller passed an explicit `css` block — so a caller who set `styles` and no
// `css` got a page that looked right in the builder and rendered unstyled in public, with a 201 on
// the way through and a read-back that agreed with them.
//
// Measured against a template-installed page on the same account: every styled leaf there carries a
// compiled rule (button 12/12, heading 4/4, paragraph 2/2, image 1/1) while this engine's leaves
// carried none. So the format was never the problem.
//
// This closes it by construction rather than by asking callers to remember: whatever `styles` a
// leaf is given is also compiled to a self-selector rule. An explicit `css` block still wins, since
// it can express things a flat style map cannot (breakpoints, descendant selectors, pseudo-states).
const KEBAB = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const declValue = (v) => {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  // the {value, unit} envelope the structural helpers use
  if (typeof v === 'object' && 'value' in v) {
    const inner = v.value;
    if (inner == null || typeof inner === 'object') return null;
    return `${inner}${v.unit ?? ''}`;
  }
  return null;
};
export const leafStyleCss = (id, styles) => {
  const decls = Object.entries(styles ?? {})
    // fontWeight* are per-breakpoint objects the builder compiles itself (elementSizeCss); an empty value is no rule
    .map(([k, v]) => { if (/^fontWeight/.test(k)) return null; const out = declValue(v); return out === null || out === '' ? null : `${KEBAB(k)}:${out}`; })
    .filter(Boolean);
  return decls.length ? `${PREFIX} .${id}{${decls.join(';')}}` : '';
};

// A button composed with no `css` still has colours on its node (BUTTON_STYLE_DEFAULTS, or authored `styles`); the
// builder compiles them onto the button element, `.c<id>`, on save. Without this rule the visitor saw the browser's grey
// default button until someone saved the page in the builder (f1 render check, knowledge sniffs/funnels-wave26-builder-
// save-2026-09-29).
export const buttonColourCss = (node) => {
  const st = node.styles ?? {};
  const d = [['color', st.color], ['background-color', st.backgroundColor]].filter(([, v]) => typeof v?.value === 'string' && v.value)
    .map(([k, v]) => `${k}:${v.value}`);
  return d.length ? `${PREFIX} .c${node.id}{${d.join(';')}}` : '';
};

export const buttonCss = (id, o) => [
  `${PREFIX} .${id}{margin:0;text-align:${o.align ?? 'center'}}`,
  `${PREFIX} .c${id}{font-family:${o.font};background-color:${o.background};color:${o.color};text-decoration:none;`
    + `padding:16px 32px;border:1px solid ${o.borderColor ?? o.background};border-radius:${o.radius ?? 2}px;`
    + `letter-spacing:.3px;width:auto;display:inline-block}`,
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

// ── The builder's colour palette ──
// 🔴 Palette variables (`var(--white)`, `var(--cobalt)`…) resolve only where the page DECLARES them. A GHL-authored page
// lists the palette in `general.general.colors` and declares it in a `:root{ --primary: #37ca37; … }` block at the head
// of `pageStyles` (knowledge sniffs/funnel-native-elements-2026-09-09), and the builder rebuilds that block from
// `general.colors` on every save (its rootVars getter: `--` + label lower-cased → value). A tool page wrote `colors: []`
// and no block, so its palette-variable defaults resolved to nothing in public until someone saved the page in the
// builder (funnels-wave12 render.popup-differential.json: a `var(--white)` background rendered transparent).
// Variables, not literals: a variable is what the builder's own defaults write and what its colour pickers show as a
// palette swatch, and bl-267 showed the builder keeps a `:root` declaration across a save while it drops what it does
// not recognise. The values are the builder's defaults (index.e1b163ff.js `colors`); --text-color / --link-color come
// from the page's typography colours, as the builder derives them.
export const BUILDER_PALETTE = Object.freeze([
  { label: 'Transparent', value: 'transparent' }, { label: 'Primary', value: '#37ca37' }, { label: 'Secondary', value: '#188bf6' },
  { label: 'White', value: '#ffffff' }, { label: 'Gray', value: '#cbd5e0' }, { label: 'Black', value: '#000000' },
  { label: 'Red', value: '#e93d3d' }, { label: 'Orange', value: '#f6ad55' }, { label: 'Yellow', value: '#faf089' },
  { label: 'Green', value: '#9ae6b4' }, { label: 'Teal', value: '#81e6d9' }, { label: 'Malibu', value: '#63b3ed' },
  { label: 'Indigo', value: '#757BBD' }, { label: 'Purple', value: '#d6bcfa' }, { label: 'Pink', value: '#fbb6ce' },
  { label: 'Cobalt', value: '#155eef' }, { label: 'Smoke', value: '#f5f5f5' }, { label: 'Overlay', value: 'rgba(0, 0, 0, 0.5)' },
  // Not in the builder's 18: `var(--blue)` is what its own default link colour is labelled (convertToColorObject({label:
  // "Blue", value:"#188bf6"})) and what GHL's template nodes write (image-feature linkTextColor, a store kind's
  // secondaryColor — kind-style-defaults.mjs). Listed here, --blue is declared on the page and the builder's rootVars
  // (every general.colors label) keep declaring it after a save.
  { label: 'Blue', value: '#188bf6' },
].map(Object.freeze));
const varName = (label) => `--${String(label).toLowerCase()}`;
/** The palette with the caller's (or the page's) colours over the builder's defaults, matched by label. */
export const mergePalette = (colors = []) => {
  const out = BUILDER_PALETTE.map((c) => ({ ...c }));
  for (const c of colors ?? []) {
    if (!c?.label) continue;
    const at = out.findIndex((x) => x.label.toLowerCase() === String(c.label).toLowerCase());
    if (at >= 0) out[at] = { ...out[at], ...c }; else out.push({ ...c });
  }
  return out;
};
/** Add each missing `--name: value` to the page's head `:root` block; a declaration already present is left alone. */
export const addMissingRootVars = (css, vars) => {
  const cur = css ?? '';
  const missing = Object.entries(vars).filter(([n]) => !new RegExp(`${n.replace(/[-]/g, '\\-')}\\s*:`).test(cur));
  return missing.length ? `:root{${missing.map(([n, v]) => `${n}:${v}`).join(';')}}${cur}` : cur;
};
/**
 * Declare the palette on a page, as the builder would: general.general.colors carries every palette colour (the page's
 * own values win), and `pageStyles` declares each one not already declared. Idempotent; mutates and returns pageData.
 */
export function applyPalette(pageData) {
  const g = pageData.general?.general;
  if (!g) return pageData;
  g.colors = mergePalette(g.colors);
  const typo = pageData.settings?.settings?.typography?.colors ?? {};
  const vars = Object.fromEntries(g.colors.map((c) => [varName(c.label), c.value]));
  vars['--text-color'] = typo.textColor?.value?.value || '#000000';
  vars['--link-color'] = typo.linkColor?.value?.value || '#188bf6';
  pageData.pageStyles = addMissingRootVars(pageData.pageStyles, vars);
  return pageData;
}

export const buildPageData = ({ pageId, stepId, funnelId, locationId, sections, pageStyles = '', fonts = ['Arial', 'Georgia', 'Roboto'], colors = [], pageBackground = 'var(--white)' }) => ({
  funnelId, locationId, pageId, id: pageId, stepId,
  sections: sections.map((s, i) => ({
    ...s, sequence: i,
    ...(s.metaData ? { metaData: withElement(s.metaData) } : {}),
    ...(s.elements ? { elements: s.elements.map(withElement) } : {}),
  })),
  settings: { settings: { ...builderSettings(pageBackground), typography: { fonts: {
    headlineFont: { id: 'headlinefont', text: 'Headline Font', value: { text: 'Default', value: 'inherit' }, isCustom: false },
    contentFont: { id: 'contentfont', text: 'Content Font', value: { text: 'Default', value: 'inherit' }, isCustom: false } },
    // 🔴 `colors` is MANDATORY beside `fonts`. GHL's saveSettings replaces defaultSettings wholesale and
    // addSettingsProperties then runs Object.keys(colors) UNGUARDED, so a page saved without it hangs the
    // builder on LOADING while the public page renders (console bl-121, reported by a peer on a live page
    // and fixed there by a local patch). The values are GHL's own, from GHL-authored pages
    // (knowledge sniffs/forms-2026-09-06: textColor var(--black) #000000, linkColor var(--blue) #188bf6).
    colors: {
      textColor: { value: { label: 'var(--black)', value: '#000000' } },
      linkColor: { value: { label: 'var(--blue)', value: '#188bf6' } },
    } } } },
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
// `stepType`: the type of the step the page sits on, when the caller has read it. Without it the step-typed kinds
// (store cart/checkout/thank-you, blog content) are flagged, because a static audit cannot tell where the page lives.
// `stepKey` is checked only when the caller passed it (compose reads the step); the edit preview lists problems of a
// page as it already is, and a real product page's step key is not re-read there.
export const auditPageData = (pageData, opts = {}) => {
  const { stepType } = opts;
  const problems = [];
  // A page missing this renders in public and hangs the BUILDER — the failure mode with no error.
  if (!pageData.settings?.settings?.background) {
    problems.push("settings.settings.background is missing: the public page will render but the BUILDER will hang forever (bgStyle() destructures bgImage from it unguarded). Use buildPageData(), or add builderSettings().");
  }
  // Same failure, second key (bl-121): addSettingsProperties runs Object.keys(colors) unguarded.
  const typo = pageData.settings?.settings?.typography;
  if (typo && (!typo.colors || typeof typo.colors !== 'object')) {
    problems.push('settings.settings.typography has no colors: the public page will render but the BUILDER will hang on LOADING (addSettingsProperties runs Object.keys(colors) unguarded). Use buildPageData().');
  }
  for (const s of pageData.sections ?? []) {
    // 🔴 A global section resolves PER SECTION ID: the funnel-level file at `globalSectionsUrl` wins
    // where it carries that id, and the page's inline copy is only a FALLBACK for ids the file lacks.
    // So editing one here is a silent no-op whenever the file still has it — autosave returns 201,
    // the change reads back, and no page renders it. Deleting one needs BOTH writes.
    if (s.isGlobal === true) {
      problems.push(`section ${s.id} is isGlobal:true — editing it in page data is a NO-OP while the funnel-level `
        + `global-sections file still carries this id (that file wins per section id; the inline copy is only a fallback). `
        + `Write POST /funnels/builder/global-sections/{funnelId} {sectionData, version: <numeric suffix of globalSectionsPath> + 1}. `
        + `To DELETE it, do both: drop it from that file AND from every page's sections[].`);
    }
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
        // bl-119: a button with neither colour key throws in the builder's styleStr on every render.
        if (n.meta === 'button' && !n.styles?.secondaryColor?.value && !n.styles?.color?.value) {
          problems.push(`node ${n.id} (button): styles has neither color nor secondaryColor — the BUILDER throws on every render and can no longer save (a 422), while the public page renders. Set styles.color.`);
        }
        // Props a kind's fresh builder node does not carry (KIND_OMIT_EXTRA) are not a defect: the builder's own countdown lacks them and renders.
        const missing = (ELEMENTS[n.meta].extraProps ?? []).filter((p) => !(p in (n.extra ?? {})) && !KIND_OMIT_EXTRA[n.meta]?.test(p));
        if (missing.length) problems.push(`node ${n.id} (${n.meta}): missing declared extra props ${missing.join(', ')} — the renderer reads extra.<prop>.value unguarded`);
      }
      // nodeId selects the CSS selector the builder recomputes for this node, so it must be present on
      // leaves and absent on containers — either mistake breaks one surface while the other looks fine.
      if (n.type === 'element' && n.extra?.nodeId !== `c${n.id}`) {
        problems.push(`node ${n.id}: extra.nodeId must be 'c'+id — the renderer keys the markup and the compiled CSS on it`);
      }
      if (n.type !== 'element' && n.extra && 'nodeId' in n.extra) {
        problems.push(`${n.type} ${n.id}: extra.nodeId must be ABSENT on a section, row or column — with it the builder writes this node's `
          + `background/padding/width against '.c${n.id}', a class nothing carries, and the CANVAS loses every container style while the public page stays correct`);
      }
      // A wrong action value is stored with a 201 and the control then does nothing, silently.
      const action = n.extra?.action?.value;
      if (action !== undefined && action !== '' && !ACTION_VALUES.includes(action)) {
        problems.push(`node ${n.id} (${n.meta}): extra.action.value '${action}' is not a known action — use one of ${ACTION_VALUES.join(', ')}. `
          + 'autosave stores an unknown value with a 201 and the control silently does nothing.');
      }
      // …and an image's or svg's, which lives in its own prop with its own menu.
      const spec = CLICK_ACTION_PROPS[n.meta];
      if (spec) {
        if (action !== undefined) problems.push(`node ${n.id} (${n.meta}): extra.action is not read on this kind — its click action is extra.${spec.props[0]} (the public renderer reads imageActions); set that instead`);
        for (const p of spec.props) {
          const v = n.extra?.[p]?.value;
          if (v !== undefined && !spec.values.includes(v)) problems.push(`node ${n.id} (${n.meta}): extra.${p}.value ${JSON.stringify(v)} is not one of ${spec.values.join(', ')} — the click does nothing`);
        }
      }
      // An embedded form/survey/calendar's on-submit menu is none | url | go-to-next-funnel-step, not the 19-value button list.
      if (EMBED_KINDS[n.meta]) {
        const ea = n.extra?.action?.value;
        if (ea !== undefined && ea !== '' && !EMBED_ACTION_VALUES.includes(ea)) problems.push(`node ${n.id} (${n.meta}): extra.action.value '${ea}' is not on the builder's menu for an embedded ${n.meta} (${EMBED_ACTION_VALUES.join(', ')}) — the submit does nothing useful`);
        const r = n.extra?.[EMBED_KINDS[n.meta]];
        if (r && typeof r === 'object' && r.value && typeof r.text !== 'string') problems.push(`node ${n.id} (${n.meta}): extra.${EMBED_KINDS[n.meta]} has no .text — the builder stores {value, text} (the asset's name) and shows the name from it`);
      }
      // A reference to another asset is `{value, text}` — `formId` proven live 2026-09-10 by reading a
      // `form` node out of GHL's own template. A bare string is the shape a `"formId":"<id>"` scan
      // expects and it is wrong; `.text` carries the referenced asset's NAME at write time.
      for (const prop of REFERENCE_EXTRA_PROPS) {
        const v = n.extra?.[prop];
        if (v !== undefined && typeof v !== 'object') {
          problems.push(`node ${n.id} (${n.meta}): extra.${prop} must be {value, text}, not a bare string — `
            + `the renderer reads .value and the builder shows .text`);
        }
      }
      for (const prop of RAW_EXTRA_PROPS) {
        const v = n.extra?.[prop];
        if (v && typeof v === 'object' && 'value' in v) {
          problems.push(`node ${n.id} (${n.meta}): extra.${prop} must be a RAW object, not {value: …} — wrapping it 500s the public page with "reading 'bgColor'" while the builder shows nothing wrong`);
        }
      }
      if (n.type === 'element' && NEEDS_STEP_TYPE[n.meta] && stepType !== NEEDS_STEP_TYPE[n.meta]) {
        problems.push(`node ${n.id} (${n.meta}): this kind renders only on a step of type '${NEEDS_STEP_TYPE[n.meta]}' — on a plain funnel page it 500s (or 404s for blog kinds). Create the step with that type.`);
      }
      problems.push(...pdpNodeProblems(n, s, opts));
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
