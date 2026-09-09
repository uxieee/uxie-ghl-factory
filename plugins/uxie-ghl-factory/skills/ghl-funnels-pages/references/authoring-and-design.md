# Authoring a page from native elements, and making it hold up

Two halves. The first gets a page to render at all; the second gets it to look like somebody
designed it. Both were established by executing calls against a live account and reading the effect
back — the traps here are all things that answered `2xx` and then failed.

---

# Part 1 — the synthesis contract

## The tree

```jsonc
pageData = {
  funnelId, locationId, pageId, id: pageId, stepId,
  sections: [ { id, pageId, funnelId, locationId, isGlobal: false,
                metaData: <the section node>,
                elements: [ <row>, <col>, <leaf>, … ],   // FLAT — every node in the section
                sequence: <n>,
                general: { colors: [], fontsForPreview: [], rootVars: {}, customFonts: [],
                           sectionStyles: "<the compiled CSS string>" } } ],
  settings: { settings: { typography: { fonts: { headlineFont, contentFont } } } },
  general:  { general: { colors: [...], fontsToLoad: [...], fontsToLoadForPreview: [...],
                         pageStyles: "", customFonts: [] } },
  pageStyles, popups: [], popupsList: [], fontsForPreview: [],
  trackingCode: { headerCode: "", footerCode: "" },
}
```

🔴 **`child[]` holds node IDs, never nested objects.** Nesting them saves with a `201` and takes the
builder down with `Cannot read properties of undefined (reading 'typography')`.

Every node:

```jsonc
{ id, type: "section"|"row"|"col"|"element", meta: "<kind>", tagName: "c-<kind>", title: meta,
  child: [], class: {borders, borderRadius, radiusEdge}, styles: {}, wrapper: {margins},
  extra: { nodeId: "c<id>", visibility: {value:{hideDesktop,hideMobile}}, customClass: {value:[]}, … },
  customCss: [], tabletStyles: {}, tabletWrapper: {}, mobileStyles: {}, mobileWrapper: {},
  updated: true }
```

A section node additionally carries `_id` (= its own id), `child: [rowId]` and `isGlobal: false`.

## The presence rule

🔴 **Every `extra` property a kind declares must be PRESENT.** The public renderer reads
`extra.<prop>.value` unguarded, so one absent property **500s the whole page** — while `autosave`
returned `201`. Present-but-empty is fine.

The empty SHAPE is per kind and **the property name misleads**: `nav-menu`, `nav-menu-v2` and
`image` want ARRAY empties even for properties named `icon` and `imageProperties`. When a kind
fails, try the three shapes (`{value: ""}`, `{value: {}}`, `{value: []}`) before concluding
anything about the node.

## Everything `autosave` accepts and should not

`POST /funnels/builder/autosave/{pageId}` is a blind store. Each of these returned `201`:

| Sent | What actually happened |
|---|---|
| an invented `meta` (a kind that does not exist) | stored; the page 500s or renders nothing |
| a missing declared `extra` property | stored; the public page 500s |
| `action: "goToNextStep"` on a button | stored; the CTA is inert. The enum is below |
| `productType: "ONE_TIME"` on a product | 422 — the enum is DIGITAL / PHYSICAL / SERVICE |
| a `child[]` of objects | stored; the builder crashes |

**A round trip through `autosave` proves persistence and nothing else.** Verify by fetching the
page a visitor would get and asserting your own copy is in the HTML.

## The action enum (`STYLE_PROPS_VALUE`)

```
go-to-next-funnel-step · go-to-funnel-step · step-path · url
openPopup · go-to-product-collection · go-to-cac · logout
```

Anything else stores and does nothing.

## Three keys whose absence 500s the page

- `col.extra.bgImage` — an **object**, not a URL:
  `{mediaType:"image", url:"", opacity:"1", options:"bgCover", svgCode:"", videoUrl:"", videoThumbnail:"", videoLoop:true}`.
  A row does **not** need it.
- `general.general.fontsToLoad`
- `general.general.colors` — may be `[]`, but must exist.

## Coverage

60 element kinds exist (a closed set in the page-builder bundle). Of the 57 leaf kinds, **51 build
from scratch**. The six that do not:

| Kind | Failure | Reading |
|---|---|---|
| `store-cart`, `store-checkout`, `store-thank-you` | 500 under all three empty shapes | store page scaffolding; wants a store page type |
| `blog-content` | **404**, not 500 | a different code path again; wants a blog page context |
| `photo-video-gallery` | 500 (`toLowerCase`) | wants a string where an object was given |
| `social-share-blog` | 500 | wants an object carrying `bgColor` |

None is proven impossible — only proven not to be a matter of node shape.

## Bindings

- **Calendar** — `extra.calendarId` is `{value: "<calendarId>", text: "<label>", isTeamSelected: false}`.
- **Order form** — kind `two-setp-order` (the platform's spelling), tagName `c-order`. It 500s
  without `step1` and `step2`; those objects carry the form's own labels and checkout config and
  the renderer reads them unguarded. `saleAction: "step-path"` + `stepPath: "<stepId>"` sends the
  buyer onward.
- **Product** — binds to the **STEP**: `PUT /funnels/funnel/step/{funnelId}`. The funnel read nests
  under `data.steps`.

---

# Part 2 — art direction

`section.general.sectionStyles` is injected as a `<style>` block keyed by node id. It is not a set
of styling hooks; it is the section's entire stylesheet. Variable fonts, blend modes, CSS grid,
keyframes, pseudo-element ornament and scroll-driven animation all work.

🔴 **Two styling sources.** The builder canvas re-derives from each node's `styles`; the public
renderer uses `sectionStyles`. Write both, or the page is perfect in the builder and naked in
public with no error anywhere.

## Fonts

| Path | Emits | Use for |
|---|---|---|
| `general.general.fontsToLoad: ["Fraunces", …]` | one legacy `fonts.googleapis.com/css?family=…` link per name | families the builder UI should also offer |
| an `@import url(…)` as the **first** thing in `pageStyles` | that stylesheet, in its own `<style>` | axis-precise requests (`opsz`, `wght` ranges, `SOFT`, `WONK`) the legacy loader cannot express |

The `@import` survives verbatim, so variable-font axes work
(`font-variation-settings:'SOFT' 24,'WONK' 1,'opsz' 144`).

## A section background image is not the section's background

Setting `section.extra.bgImage` renders an absolutely positioned **first child**:

```html
<div class="bg bgCover bg-<sectionId> none"
     style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none"></div>
```

with three media-query rules emitted for it at one class of specificity, pointing at the image CDN
(`f_webp/q_80`, `r_768|r_900|r_1200`) — the storage URL you supplied is rewritten and served as
responsive webp for free.

So a `background-image` or gradient on the **section** is invisible underneath it. `.inner` is the
second child and its descendants are positioned, so **pseudo-elements on `.bg-<sectionId>` paint
under the copy** — that is where a treatment goes.

## Duotone: `background-blend-mode`, never `filter` + `mix-blend-mode`

```css
/* ✗ every layer computes exactly as written, and it renders flat grey */
.bg-SID          { filter: grayscale(1) contrast(1.2) }
.bg-SID::before  { background:#1b3d2d; mix-blend-mode:multiply }
```

The pseudo-elements are descendants, so **the parent's `filter` desaturates them too, once they
composite** — the filter meant to prepare the image for tinting erases the tint. Nothing in the
computed styles says why.

```css
/* ✓ */
.bg-SID{
  background-color:#173a29 !important;   /* outranks GHL's `background` shorthand, per property */
  background-blend-mode:luminosity;      /* image luminosity + colour = a real duotone          */
  background-size:cover !important; background-position:center !important;
  filter:contrast(1.12) brightness(.86) saturate(.82);
}
.bg-SID::after{ content:''; position:absolute; inset:0; background:#e8c489; mix-blend-mode:screen; opacity:.13 }
```

## Rows are flex — make them grid

The builder's model is a flex row of percentage-width columns, which is why synthesised pages come
out evenly divided and generic.

```css
#<rowId> > .inner{ display:grid; grid-template-columns:1.6fr .82fr; gap:76px; align-items:end }
@media screen and (max-width:900px){ #<rowId> > .inner{ grid-template-columns:1fr } }
```

Give every column `min-width:0` — grid children default to `min-width:auto`, so one long word can
widen a track past the viewport.

## Columns carry `noBorder`, and its rule is `!important`

```css
.hl_page-preview--content .<colId>{ border-top:1px solid rgba(18,16,14,.34) !important }
```

Without it the stylesheet shows `border-width:1px 0 0` and the computed value is `0px none`. Read
the *computed* value, not the rule you wrote.

## The bound widgets render INLINE — re-skin them

Neither the calendar nor the two-step order form is an iframe, so the compiled stylesheet reaches
them. Left alone they ship GHL's own chrome (a hard blue accent, square inputs, a different
typeface) and the page reads as a third-party embed dropped into someone else's design.

The calendar publishes its accent as **CSS custom properties** on `.hl-app`:

```css
.hl-app{ --appointment_widgets-primary-color:#155eef; --appointment_widgets-light-primary-color:#155eef12;
         --primary-700:#155eef; --primary-700-light:rgba(21,94,239,.1) }
```

Re-declaring those four rebrands arrows, day cells, slot buttons, dots, focus rings and hovers at
once — including states that only exist after interaction, which chasing selectors misses.

Class hooks, captured live:

| Widget | Hooks |
|---|---|
| calendar | `.appointment_widgets--revamp--inner`, `.widgets--service-name`, `.label-select-date`, `.vdpCell.selectable/.selected .vdpCellContent`, `.widgets-time-slot .btn`, `.arrowNext` / `.arrowPrevious`, `.multiselect__tags` |
| two-step order | `.container-order-form-two-step`, `.form-heading(.active)`, `.form-sub-heading`, `.divider-form`, `.caret-up`, `.form-input`, `.address-title`, `.shipping-bar`, `.form-btn` + `.main-text`, `.order-form-footer` |

The order form's **disabled** submit is a flat `#808080` with its own rule — style
`.form-btn[disabled]` explicitly or it fights any palette.

## Page-wide ornament and motion

`.hl_page-preview--content::after` with `position:fixed; pointer-events:none` is a free full-page
overlay — a paper grain from an `feTurbulence` data-URI at `opacity:.055; mix-blend-mode:multiply`
costs no request.

Keyframes in `pageStyles` run normally. Stagger a hero with `animation-delay`, then upgrade the
rest to scroll-driven with no JavaScript:

```css
@supports (animation-timeline: view()){
  .hl_page-preview--content #<id>{ animation-timeline:view(); animation-range:entry 0% cover 26%; animation-delay:0ms }
}
@media (prefers-reduced-motion:reduce){ .hl_page-preview--content *{ animation:none !important } }
```

## A trap in your own generator

Interpolating a comma-separated selector list prefixes only the FIRST member and suffixes only the
LAST:

```js
// ✗  `${P} ${list} em`  where list = '.X h1,.X h2,…,.X.text-output'
//    → '.hl_page-preview--content .X h1, .X h2, …, .X.text-output em'
//    → `.X h1` silently inherits the `em` rule (italic, accent colour) and the `b` rule
```

Compose each selector per part. This one presents exactly like a font-loading failure.

## The builder half of the contract

Everything above is what the PUBLIC renderer needs. The builder needs three more things, and when
they are missing the page is perfect in public and the editor hangs on a spinner forever — the
worst version of this surface's favourite failure, because the customer never sees it and the
person who has to edit the page cannot get past it.

| Key | Where | Without it |
|---|---|---|
| `settings.settings.background` | page | `bgStyle()` does `const {bgImage} = builderStore.backgroundSettings` unguarded → `Cannot destructure property 'bgImage' of 'e1'`, spinner forever |
| `node.element` | every node | the builder reads a nested canonical copy of the node; the outer object is the API layer's wrapper. Section adds `_id`, col adds `noOfColumns`, a leaf adds `customCss` and `tag` |
| `extra.icon` = `{name, unicode, fontFamily}` | text kinds | a media-shaped empty (which any `/icon/` name heuristic will produce) prints a literal **"undefined"** before every heading and paragraph |

```jsonc
"settings": { "settings": {
  "background": { "bgImage": { "value": { "url": "", "options": "bgCover" } },
                  "backgroundColor": { "value": "<page ground>" } },
  "offsetColor": [...], "percentWidth": [...], "progressBarSize": [...],
  "typography": { ... } } }
```

`buildPageData()` and `builderSettings()` in the plugin's engine carry all three, and
`auditPageData()` reports a missing `settings.settings.background`.

🔴 **Verification is not done until the page has been opened in the BUILDER as well as fetched from
its public URL.** The differential that finds a defect like this in one pass: open a GHL-authored
page in the same session as a control — if the control opens and yours does not, it is your data —
then `GET /funnels/builder/page/data` on both and diff the key sets per node type.

## Design defaults worth keeping

- Commit to a dominant ground with **one** sharp accent; evenly distributed palettes read as
  unfinished.
- Hairlines and flat grounds beat drop shadows for anything editorial; shadows belong on the one
  element you want to lift (usually the CTA).
- Set display type large and tight (`line-height` under 1.0, negative tracking) and let the body
  copy be the only thing at a comfortable measure.
- Give sections asymmetric grids and stagger repeated columns; three equal cards in a row is the
  single strongest "generated page" tell.
- Treat photography — duotone, grain, a consistent crop — so stock stops reading as stock. Look at
  the images before choosing them; picking URLs blind lands placeholders.
- Verify at 1360px **and** 414px, and read the computed styles rather than trusting the rules you
  emitted.
