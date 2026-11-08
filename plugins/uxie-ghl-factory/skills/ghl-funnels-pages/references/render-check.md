# Render check — builder canvas = preview = live

Use this after any change that alters how a funnel page looks (w7-3, bl-538, bl-541). A page is done only when **preview matches live at 1440 px and 390 px**, and **the builder canvas matches the public page's structure at 1440 px** (fn-4, 2026-11-08). `differs` and `incomplete` both mean the page is **not** done.

The three renders are judged on two different scopes, and the tool applies both (`compare_page_renders`, the same function the offline render section uses):
- **Preview against live** at 1440 and 390: geometry and styles must match.
- **Canvas against live** at 1440 only: structure and layout (which nodes exist, their visibility, their vertical place and order). The builder's chrome and the editor's fonts and widths are expected to differ, so the tool lists them and does not fail on them.

## Procedure

1. **Canvas.** Open the builder (the `funnel-builder` frame). Probe the desktop canvas at its own width, **1440 px**, and save it as the canvas 1440 probe. Do **not** probe the canvas at 390 px. The builder's mobile toggle keeps the window at 1440 px (bl-541), so a probe taken there reports `width: 1440`, cannot be measured at 390, and is not a 390 measurement. The tool names the canvas at 390 as NOT MEASURABLE when it is supplied, and does not judge it.
2. **Preview.** Open the preview URL. Call `browser_resize` to 1440, run the probe, then 390, run the probe again.
3. **Live.** Open the live URL the same way. The live version is the one the public URL serves; a page that has never been published serves its draft, and a pinned page serves its pinned version. Never publish to obtain a live version (that is gate G5).
4. Run the probe in each frame with `browser_evaluate` set to PROBE_SOURCE below. Save each probe as JSON beside the screenshots, and record the `location.href` of each frame with its probe, so that identical preview and live files cannot be mistaken for a failed navigation. Save the screenshots too.
5. Call `compare_page_renders` with `{probes: {canvas: {1440}, preview: {1440, 390}, live: {1440, 390}}}`. The canvas is sent at 1440 only: a canvas at 390 cannot be measured (step 1), so sending it would be sending a number that does not mean what its key says. The tool answers with `scopes.previewVsLive` (1440 and 390) and `scopes.canvasStructure` (1440), plus `notMeasurable`.
6. `verdict: match` is the only pass. It requires `scopes.previewVsLive.verdict` and `scopes.canvasStructure.verdict` to both be `match`. `differs` lists each field and its values in the scope that failed (`canvasStructure.failures` names each node and kind); `incomplete` lists the missing probes or nodes, or a probe that is not PROBE_SOURCE output.

Probes are measured through the slot `browser` (one holder at a time). Never raw Playwright clicks on a builder save.

## PROBE_SOURCE

Run this string as the function for `browser_evaluate` in each frame. It is the same string the module exports (a test checks this file carries it exactly).

```js
(() => {
  // A page node is an element whose id starts with a builder kind and a dash (the kinds are the builder's catalogue, 72).
  // No id-shape rule: builder ids are not a fixed length or shape. The UI ids below are builder or public-page chrome, not nodes;
  // each is named with the sniff it was seen in. Unknown means compared.
  const KINDS = ["blog","blog-content","blog-pined-post","blog-post","blog-subscribe-form","bulletList","button","calendar","category-navigation","col","collection-list","countdown","custom-code","day-timer","divider","faq","featured-product","featured-products","form","heading","hl_main_popup","image","image-feature","image-slider","instagram-feed","logo-showcase","map","marketing-countdown","minute-timer","nav-cart","nav-menu","nav-menu-v2","number-counter","one-step-order","order-confirmation","paragraph","photo-video-gallery","pricing-table","progress-bar","qr-code","review-widget","rich-text","row","searchbar","section","social-icons","social-share-blog","store-cart","store-checkout","store-custom-product-detail","store-pdp-v2-add-to-cart","store-pdp-v2-buy-now","store-pdp-v2-description","store-pdp-v2-images","store-pdp-v2-price","store-pdp-v2-quantity","store-pdp-v2-related-products","store-pdp-v2-review-stars","store-pdp-v2-reviews","store-pdp-v2-title","store-pdp-v2-variants","store-product-detail","store-product-list","store-thank-you","sub-heading","survey","svg","testimonial","two-setp-order","upsell","video","web-widget"];
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
})()
```
