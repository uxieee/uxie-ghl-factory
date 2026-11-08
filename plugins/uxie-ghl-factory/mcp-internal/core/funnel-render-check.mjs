// w7-3 — the three-way render check (builder canvas = preview = live) at 1440 and 390 px.
//
// PROBE_SOURCE is run in each frame by the browser (browser_evaluate). It returns the node boxes and the computed styles of
// every builder node on the page, keyed by the node id the builder and the public page share (`<kind>-<id>`). Positions are
// relative to the first section, so a page that is shifted as a whole still matches. The skill's procedure
// (skills/ghl-funnels-pages/references/render-check.md) carries this string verbatim (a test checks it).
//
// The comparer is pure: it takes the three probe sets and returns a verdict. A width that is not probed, or a node missing
// from one surface, makes the verdict INCOMPLETE — a missing probe is not evidence of a match.
// The builder's element kinds (the 72 catalogue kinds). A node id or class is '<kind>-<suffix>'; a bare kind is not a node.
export const BUILDER_KINDS = Object.freeze(["blog", "blog-content", "blog-pined-post", "blog-post", "blog-subscribe-form", "bulletList", "button", "calendar", "category-navigation", "col", "collection-list", "countdown", "custom-code", "day-timer", "divider", "faq", "featured-product", "featured-products", "form", "heading", "hl_main_popup", "image", "image-feature", "image-slider", "instagram-feed", "logo-showcase", "map", "marketing-countdown", "minute-timer", "nav-cart", "nav-menu", "nav-menu-v2", "number-counter", "one-step-order", "order-confirmation", "paragraph", "photo-video-gallery", "pricing-table", "progress-bar", "qr-code", "review-widget", "rich-text", "row", "searchbar", "section", "social-icons", "social-share-blog", "store-cart", "store-checkout", "store-custom-product-detail", "store-pdp-v2-add-to-cart", "store-pdp-v2-buy-now", "store-pdp-v2-description", "store-pdp-v2-images", "store-pdp-v2-price", "store-pdp-v2-quantity", "store-pdp-v2-related-products", "store-pdp-v2-review-stars", "store-pdp-v2-reviews", "store-pdp-v2-title", "store-pdp-v2-variants", "store-product-detail", "store-product-list", "store-thank-you", "sub-heading", "survey", "svg", "testimonial", "two-setp-order", "upsell", "video", "web-widget"]);

export const PROBE_SOURCE = `(() => {
  // A page node is an element whose id starts with a builder kind and a dash (the kinds are the builder's catalogue, 72).
  // No id-shape rule: builder ids are not a fixed length or shape. The UI ids below are builder or public-page chrome, not nodes;
  // each is named with the sniff it was seen in. Unknown means compared.
  const KINDS = ${JSON.stringify(BUILDER_KINDS)};
  const UI = new Set([
    'nav-menu-popup', // the mobile menu overlay of the public nav widget (knowledge sniffs/forms-2026-09-06/live-11-public-widget-render-form01.json)
  ]);
  const TEXT = new Set(['heading', 'sub-heading', 'paragraph', 'rich-text', 'bulletList']);
  const pick = (cs) => ({ fontSize: cs.fontSize, fontFamily: cs.fontFamily, color: cs.color, backgroundColor: cs.backgroundColor,
    padding: cs.padding, margin: cs.margin, borderRadius: cs.borderRadius, display: cs.display });
  const first = document.querySelector('[id^="section-"]');
  const o = first ? first.getBoundingClientRect() : { x: 0, y: 0 };
  const nodes = {};
  for (const el of document.querySelectorAll('[id]')) {
    if (UI.has(el.id) || !KINDS.some((k) => el.id.startsWith(k + '-'))) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const kind = el.id.replace(/-[^-]+$/, '');
    nodes[el.id] = { text: TEXT.has(kind), x: r.x - o.x, y: r.y - o.y, w: r.width, h: r.height,
      visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none', styles: pick(cs) };
  }
  return { width: window.innerWidth, origin: { x: o.x, y: o.y }, nodes };
})()`;

const NUM = ['x', 'y', 'w', 'h'];
const STYLE_KEYS = ['fontSize', 'fontFamily', 'color', 'backgroundColor', 'padding', 'margin', 'borderRadius', 'display'];

/**
 * compareRenders({canvas, preview, live}, {tolerancePx, widths}) → {verdict, diffs, missing}.
 * probes[surface][width] = {nodes: {<id>: {text, x, y, w, h, visible, styles}}}.
 * verdict: 'incomplete' (a width or a node is missing from a surface), else 'differs' (a diff beyond tolerance), else 'match'.
 */
// fn-4 (2026-11-08): notMeasurable names a surface that cannot be measured at a width, as 'canvas@390'. It is skipped at that width and is
// NOT a reason for 'incomplete'; the width is then compared on the surfaces that remain. Nothing else is skipped: a missing probe still
// makes the verdict 'incomplete'.
export function compareRenders({ canvas, preview, live }, { tolerancePx = 2, widths = [1440, 390], notMeasurable = [] } = {}) {
  const surfaces = { canvas, preview, live };
  const skipped = new Set(notMeasurable);
  const diffs = []; const missing = []; let incomplete = false;
  const close = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tolerancePx : a === b);
  for (const w of widths) {
    const nodesOf = {};
    let wanted = 0;
    for (const [name, set] of Object.entries(surfaces)) {
      if (skipped.has(`${name}@${w}`)) continue;
      wanted++;
      const p = set?.[w];
      if (!p || typeof p !== 'object' || !p.nodes || typeof p.nodes !== 'object') { incomplete = true; continue; }
      nodesOf[name] = p.nodes;
    }
    const names = Object.keys(nodesOf);
    if (names.length < wanted) continue;
    const ids = new Set(names.flatMap((n) => Object.keys(nodesOf[n])));
    for (const id of ids) {
      const lacking = names.filter((n) => !nodesOf[n][id]);
      for (const n of lacking) { missing.push({ width: w, nodeId: id, in: n }); incomplete = true; }
      if (lacking.length) continue;
      const side = (n) => nodesOf[n]?.[id];
      const base = side(names[0]);
      const record = (field, pick) => diffs.push({ width: w, nodeId: id, field, canvas: pick(side('canvas')), preview: pick(side('preview')), live: pick(side('live')) });
      for (const f of NUM) {
        if (f === 'x' && base.text) continue; // a text box moves with its container; only its size and styles are compared
        const vals = names.map((n) => side(n)[f]);
        if (!vals.every((v) => close(v, vals[0]))) record(f, (nd) => nd?.[f]);
      }
      if (names.some((n) => side(n).visible !== base.visible)) record('visible', (nd) => nd?.visible);
      for (const k of STYLE_KEYS) {
        const vals = names.map((n) => side(n).styles?.[k]);
        if (!vals.every((v) => v === vals[0])) record(`styles.${k}`, (nd) => nd?.styles?.[k]);
      }
    }
  }
  const verdict = incomplete ? 'incomplete' : diffs.length ? 'differs' : 'match';
  return { verdict, diffs, missing };
}

// fn-4 (2026-11-08): the canvas against the public page at ONE width (1440): STRUCTURE and LAYOUT only. Failing: a non-chrome node on one
// side only; a visibility difference; a vertical offset beyond tolerancePx; a different top-to-bottom order of the shared nodes. Listed,
// not failing: the builder chrome the canvas alone carries (BUILDER_CHROME_IDS), the horizontal position and width (the editor section is
// narrower than the public page), and the styles (the editor's fonts and colours). A surface with no nodes is 'incomplete'.
export const BUILDER_CHROME_IDS = Object.freeze(['image-dropdown-file-input']);

export function compareStructure(canvas, live, { tolerancePx = 2, chromeIds = BUILDER_CHROME_IDS } = {}) {
  const c = canvas?.nodes; const l = live?.nodes;
  const empty = !c || !l || typeof c !== 'object' || typeof l !== 'object' || !Object.keys(c).length || !Object.keys(l).length;
  if (empty) return { verdict: 'incomplete', failures: [], expected: { builderChrome: [], horizontal: 0, editorStyles: 0 }, shared: 0 };
  const shared = Object.keys(c).filter((id) => l[id]);
  const canvasOnly = Object.keys(c).filter((id) => !l[id]);
  const liveOnly = Object.keys(l).filter((id) => !c[id]);
  const failures = [];
  const builderChrome = canvasOnly.filter((id) => chromeIds.includes(id));
  for (const id of canvasOnly) if (!chromeIds.includes(id)) failures.push({ kind: 'canvas-only', nodeId: id });
  for (const id of liveOnly) failures.push({ kind: 'live-only', nodeId: id });
  let horizontal = 0; let editorStyles = 0;
  for (const id of shared) {
    const a = c[id]; const b = l[id];
    if (a.visible !== b.visible) failures.push({ kind: 'visibility', nodeId: id, canvas: a.visible, live: b.visible });
    if (Math.abs(a.y - b.y) > tolerancePx) failures.push({ kind: 'vertical', nodeId: id, canvas: a.y, live: b.y });
    if (Math.abs(a.x - b.x) > tolerancePx || Math.abs(a.w - b.w) > tolerancePx) horizontal++;
    if (STYLE_KEYS.some((k) => a.styles?.[k] !== b.styles?.[k])) editorStyles++;
  }
  const order = (n) => shared.slice().sort((p, q) => n[p].y - n[q].y || n[p].x - n[q].x).join('|');
  if (order(c) !== order(l)) failures.push({ kind: 'order', canvas: order(c), live: order(l) });
  return { verdict: failures.length ? 'differs' : 'match', failures, expected: { builderChrome, horizontal, editorStyles }, shared: shared.length };
}

// Returns null when p is a PROBE_SOURCE output for width w; otherwise the reason it is not. (Moved here from the render section, fn-4.)
export function probeShape(p, w) {
  if (!p || typeof p !== 'object') return 'not an object';
  if (p.width !== w) return `width is ${p.width}, expected ${w}`;
  if (!p.origin || typeof p.origin.x !== 'number' || typeof p.origin.y !== 'number') return 'no origin (the first section corner)';
  if (!p.nodes || typeof p.nodes !== 'object' || Object.keys(p.nodes).length === 0) return 'no nodes';
  for (const [id, n] of Object.entries(p.nodes)) {
    if (!n || typeof n.x !== 'number' || typeof n.y !== 'number' || typeof n.visible !== 'boolean') return `node ${id} lacks x/y/visible`;
    if (!n.styles || typeof n.styles !== 'object') return `node ${id} lacks styles`;
    const missing = STYLE_KEYS.filter((k) => !(k in n.styles));
    if (missing.length) return `node ${id} lacks styles: ${missing.join(', ')}`;
  }
  return null;
}

// The reasons a surface is NOT MEASURABLE, or unjudged, at a width (fn-4, 2026-11-08).
export const MOBILE_TOGGLE_REASON = 'builder mobile toggle: the window stays at 1440, so the canvas probe at 390 reports width 1440 and cannot be measured at 390 (the verdict at 390 is preview against live)';
export const NOT_SUPPLIED_REASON = 'not supplied: the canvas is not probed at 390 (the builder mobile toggle keeps the window at 1440); the verdict at 390 is preview against live';

// THE judgement of a page's three renders, shared by the compare_page_renders tool and the render section (one copy, fn-4).
// probes: {canvas, preview, live}, each keyed by width (1440 and/or 390) with a PROBE_SOURCE output.
//   - preview is judged against live at 1440 AND 390 (compareRenders, geometry and styles; canvas not used here);
//   - canvas is judged against live at 1440 on structure and layout only (compareStructure);
//   - canvas at 390 is NOT MEASURABLE when its probe reports the 1440 window (the mobile toggle), or NOT SUPPLIED when absent. It is never judged.
// verdict: 'incomplete' when a probe is missing or not PROBE_SOURCE output (problems); else 'differs' when preview and live differ or the
// canvas structure fails; else 'match'. A missing probe is never a pass.
export function judgeRenders(probes, { label = (s, w) => `${s}-${w}`, tolerancePx = 2 } = {}) {
  const problems = []; const notMeasurable = []; const unjudged = [];
  const held = { canvas: {}, preview: {}, live: {} };
  const at = (s, w) => probes?.[s]?.[w] ?? probes?.[s]?.[String(w)];
  for (const s of ['canvas', 'preview', 'live']) {
    for (const w of [1440, 390]) {
      const p = at(s, w);
      if (p === undefined || p === null) {
        if (s === 'canvas' && w === 390) notMeasurable.push({ surface: s, width: w, reason: NOT_SUPPLIED_REASON });
        else problems.push(`${label(s, w)} is missing`);
        continue;
      }
      if (s === 'canvas' && w === 390 && typeof p === 'object' && p.width === 1440) {
        const why = probeShape(p, 1440);
        if (why) problems.push(`${label(s, w)} is not PROBE_SOURCE output: ${why}`);
        else notMeasurable.push({ surface: s, width: w, reason: MOBILE_TOGGLE_REASON });
        continue;
      }
      const why = probeShape(p, w);
      if (why) { problems.push(`${label(s, w)} is not PROBE_SOURCE output: ${why}`); continue; }
      if (s === 'canvas' && w === 390) { unjudged.push({ surface: s, width: w, reason: 'supplied at its own width but not judged: the ruled scopes do not use the canvas at 390' }); continue; }
      held[s][w] = p;
    }
  }
  const pl = compareRenders({ canvas: {}, preview: held.preview, live: held.live }, { tolerancePx, widths: [1440, 390], notMeasurable: ['canvas@1440', 'canvas@390'] });
  const cs = held.canvas[1440] && held.live[1440]
    ? compareStructure(held.canvas[1440], held.live[1440], { tolerancePx })
    : { verdict: 'incomplete', failures: [], expected: { builderChrome: [], horizontal: 0, editorStyles: 0 }, shared: 0 };
  const verdict = problems.length ? 'incomplete'
    : pl.verdict !== 'match' ? pl.verdict
      : cs.verdict === 'match' ? 'match' : cs.verdict === 'incomplete' ? 'incomplete' : 'differs';
  return { verdict, scopes: { previewVsLive: { verdict: pl.verdict, diffs: pl.diffs, missing: pl.missing }, canvasStructure: cs },
    notMeasurable, unjudged, problems, diffs: pl.diffs, missing: pl.missing, structure: cs };
}
