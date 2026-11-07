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
export function compareRenders({ canvas, preview, live }, { tolerancePx = 2, widths = [1440, 390] } = {}) {
  const surfaces = { canvas, preview, live };
  const diffs = []; const missing = []; let incomplete = false;
  const close = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= tolerancePx : a === b);
  for (const w of widths) {
    const nodesOf = {};
    for (const [name, set] of Object.entries(surfaces)) {
      const p = set?.[w];
      if (!p || typeof p !== 'object' || !p.nodes || typeof p.nodes !== 'object') { incomplete = true; continue; }
      nodesOf[name] = p.nodes;
    }
    const names = Object.keys(nodesOf);
    if (names.length < 3) continue;
    const ids = new Set(names.flatMap((n) => Object.keys(nodesOf[n])));
    for (const id of ids) {
      const lacking = names.filter((n) => !nodesOf[n][id]);
      for (const n of lacking) { missing.push({ width: w, nodeId: id, in: n }); incomplete = true; }
      if (lacking.length) continue;
      const base = nodesOf.canvas[id];
      const at = (n) => nodesOf[n][id];
      const record = (field, get) => diffs.push({ width: w, nodeId: id, field, canvas: get('canvas'), preview: get('preview'), live: get('live') });
      for (const f of NUM) {
        if (f === 'x' && base.text) continue; // a text box moves with its container; only its size and styles are compared
        const vals = names.map((n) => at(n)[f]);
        if (!vals.every((v) => close(v, vals[0]))) record(f, (n) => at(n)[f]);
      }
      if (names.some((n) => at(n).visible !== base.visible)) record('visible', (n) => at(n).visible);
      for (const k of STYLE_KEYS) {
        const vals = names.map((n) => at(n).styles?.[k]);
        if (!vals.every((v) => v === vals[0])) record(`styles.${k}`, (n) => at(n).styles?.[k]);
      }
    }
  }
  const verdict = incomplete ? 'incomplete' : diffs.length ? 'differs' : 'match';
  return { verdict, diffs, missing };
}
