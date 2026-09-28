// Page popups: `pageData.popupsList[i]` = {id, elements, activeElementId}, where `elements` is a FLAT node
// list — the popup node (`meta: hl_main_popup`) first, then its rows, columns and leaves, linked by child[]
// ids exactly like a section's elements. Shapes are the builder's own save (knowledge
// sniffs/funnels-wave11-structure-styling-2026-09-28 pd.ui7.json).
//
// Measured 2026-09-28 (sniffs/funnels-wave12-structure-tool-2026-09-28 exp-popup.*.json), on a draft render:
// - the popup's NODES alone render it — on its delay, closed by an outside click, opened by an openPopup
//   button — but at the content's width (348 px for a heading), not the chosen one;
// - its size, padding, border and background come from PAGE-level CSS the builder writes into
//   `pageData.pageStyles` (customPopupStyles: `#<id>.popup-body{…}` + mobile width) with the popup's own
//   rows/columns/leaves under `.drop-zone-draggable`. With that CSS it renders 720 px, centred.
// - An EMPTY popup (child []) never renders at all (wave11), so one is refused here.
// Colours are written as literals: an API-composed page has no builder `:root` palette, so `var(--white)`
// resolves to nothing there (measured: the popup background came out transparent).
import { makeLeaf, makeColumn, BG_IMAGE, mkId, px, val } from './funnel-pages.mjs';

export const POPUP_WIDTHS = Object.freeze({ full: ['full-page', 960], medium: ['medium-page', 720], small: ['small-page', 550] });
const POSITION = {
  center: 'position:absolute!important;left:50%!important;bottom:auto!important;transform:translate(-50%,0)!important;right:auto!important',
  right: 'position:absolute!important;left:auto!important;bottom:auto!important;transform:translate(0,0)!important;right:20px!important',
  left: 'position:absolute!important;left:20px!important;bottom:auto!important;right:auto!important;transform:translate(0,0)!important',
};
const PREFIX = '.hl_page-preview--content';

/**
 * spec: {name, width?: full|medium|small (medium), showOn?: 'exit' | 'none' | {delay: seconds} (none),
 *        closeOnOutsideClick? (true), position?: center|left|right (center), background? ('#ffffff'),
 *        overlayColor? ('rgba(0, 0, 0, 0.5)'), padding? (20), columns: [{elements, widthPct?}]}
 * composeLeaf(elementSpec, salt) → {leaf, css} — the page composer's own leaf builder, so a popup's
 * elements take exactly the shapes a section's do.
 */
export function makePopup(spec, i, composeLeaf, saltBase = 'P', label = `popups[${i}]`) {
  if (!spec?.name) throw new Error(`${label}.name is required (it is how a button's openPopup names it)`);
  const cols = spec.columns ?? [];
  const leafCount = cols.reduce((n, c) => n + (c.elements?.length ?? 0), 0);
  if (!leafCount) throw new Error(`${label} "${spec.name}" is empty: GHL never renders a popup with no content (not on its trigger, not from a button)`);
  const width = spec.width ?? 'medium';
  if (!POPUP_WIDTHS[width]) throw new Error(`${label}.width must be one of ${Object.keys(POPUP_WIDTHS).join(', ')}`);
  const position = spec.position ?? 'center';
  if (!POSITION[position]) throw new Error(`${label}.position must be one of ${Object.keys(POSITION).join(', ')}`);
  const showOn = spec.showOn ?? 'none';
  const trigger = showOn === 'exit' ? { value: 'exit', delay: 1 }
    : showOn === 'none' ? { value: 'none', delay: 1 }
      : (showOn && Number.isFinite(Number(showOn.delay)) && Number(showOn.delay) >= 0) ? { value: 'delay', delay: Number(showOn.delay) }
        : null;
  if (!trigger) throw new Error(`${label}.showOn must be 'exit', 'none' or {delay: seconds}`);

  const salt = `${saltBase}${i}`;
  const css = [];
  const columns = cols.map((c, ci) => {
    const leaves = (c.elements ?? []).map((e) => { const { leaf, css: lc } = composeLeaf(e, `${salt}C${ci}`); if (lc) css.push(lc); return leaf; });
    const widthPct = c.widthPct ?? Math.round(10000 / cols.length) / 100;
    return { col: makeColumn({ children: leaves, widthPct, padX: c.padX ?? 0, salt: `${salt}C${ci}` }), leaves, widthPct };
  });
  const id = mkId('hl_main_popup', salt);
  const rowId = mkId('row', salt);
  const row = { id: rowId, type: 'row', meta: 'row', tagName: 'c-row', title: 'row', child: columns.map((c) => c.col.id),
    class: {}, styles: { paddingTop: px(0), paddingBottom: px(0), backgroundColor: val('transparent') },
    extra: { visibility: val({ hideDesktop: false, hideTablet: false, hideMobile: false }), bgImage: BG_IMAGE, rowWidth: { value: 100, unit: '%' }, customClass: val([]) },
    wrapper: {}, tabletStyles: {}, tabletWrapper: {}, mobileStyles: {}, mobileWrapper: {} };
  const [minWidth, widthPx] = POPUP_WIDTHS[width];
  const pad = spec.padding ?? 20;
  const background = spec.background ?? '#ffffff';
  const node = {
    id, meta: 'hl_main_popup', title: spec.name, tag: '', child: [rowId], class: {}, wrapper: {}, customCss: [],
    extra: {
      bgImage: BG_IMAGE, overlayColor: val(spec.overlayColor ?? 'rgba(0, 0, 0, 0.5)'), left: { value: 50, unit: '%' },
      popupDisabled: val(false), popupHide: val(spec.closeOnOutsideClick ?? true), minWidth: val(minWidth),
      showPopupOnMouseOut: trigger, customClass: val([]), position: val(position),
    },
    styles: {
      boxShadow: val('none'), paddingTop: px(pad), paddingBottom: px(pad), paddingLeft: px(pad), paddingRight: px(pad),
      marginTop: px(0), borderColor: val('transparent'), borderWidth: val('0px'), borderStyle: val('none'),
      borderRadius: val('0px'), backgroundColor: val(background), width: { value: String(widthPx), unit: 'px' },
    },
  };
  const body = `${POSITION[position]};box-shadow:none;padding:${pad ? `${pad}px` : 0};margin-top:0;border-width:0;border-style:none;border-radius:0;background-color:${background};width:${widthPx}px`;
  const popupCss = `#${id}.popup-body{${body}}.--mobile #${id}.popup-body{width:380px!important}@media screen and (min-width:0px) and (max-width:767px){#${id}.popup-body{width:380px!important}}`
    + `.drop-zone-draggable .${rowId}{margin:0 auto;padding:0;width:100%;background-color:transparent}`
    + columns.map(({ col, widthPct }) => `.drop-zone-draggable .${col.id}{padding:0 ${c0(col)};width:${widthPct}%;margin:0;background-color:transparent}#${col.id}>.inner{flex-direction:column;justify-content:center;align-items:inherit;flex-wrap:nowrap}`).join('')
    // The popup's leaves live under .drop-zone-draggable at runtime, not under the page content wrapper.
    + css.join('').split(PREFIX).join('.drop-zone-draggable');
  return {
    entry: { id, elements: [node, row, ...columns.flatMap(({ col, leaves }) => [col, ...leaves])], activeElementId: id },
    css: popupCss,
    name: spec.name,
  };
}
const c0 = (col) => `${col.styles?.paddingLeft?.value ?? 0}px`;

/**
 * openPopup buttons that name a popup the page does not have. `onlyIds` limits the check to the nodes a
 * call wrote, so a page's pre-existing state never blocks an unrelated edit.
 */
export function popupRefProblems(pageData, onlyIds = null) {
  const ids = new Set((pageData.popupsList ?? []).map((p) => p.id));
  const problems = [];
  const nodes = [...(pageData.sections ?? []).flatMap((s) => s.elements ?? []), ...(pageData.popupsList ?? []).flatMap((p) => p.elements ?? [])];
  for (const n of nodes) {
    if (n?.extra?.action?.value !== 'openPopup' || (onlyIds && !onlyIds.has(n.id))) continue;
    const pid = n.extra?.popupId?.value;
    if (!pid || !ids.has(pid)) problems.push(`${n.id}: action openPopup names popup "${pid ?? ''}", which is not on this page (${[...ids].join(', ') || 'it has no popups'})`);
  }
  return problems;
}
