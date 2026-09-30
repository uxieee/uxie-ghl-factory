# `build_funnel_page` — the full contract

The tool description holds what you need to choose and call the tool. This page holds the rest. Claude Code
cuts every tool description at 2,048 characters.

## Two modes

- **Compose** (`sections`, plus optional `popups` and `typography`): writes a whole page.
- **Edit** (`edits` + `stepName`, and/or `seo`): changes an existing page in place.

In both modes nothing is written without `confirm: true`. `publish: true` also publishes.

## Why it writes the stylesheet too

The builder canvas styles a page from each node's `styles`. The PUBLIC renderer uses the compiled
`sectionStyles` string, keyed by node id. Write only one and the page looks right in the builder and naked in
public. The tool emits the nodes AND the compiled stylesheet together.

## What it enforces that autosave does not

Autosave answers `201` to all of these:

- `meta` must be one of the 72 kinds in the tool's element catalogue (the page builder's own registry).
  **Product-page blocks** (the 11 `store-pdp-v2-*`) compose only on a step whose `key` is `store-product-detail` (the
  store's "Product details" step) or `store-custom-product-detail` (a custom product page), inside a section spec with
  `pdp: true` — or `pdp: {products: [<product id>]}` on a custom product page, where the first id is the product shown.
  Each block finds its product through that section (`extra.pdpV2Section`); on the store's step the product comes from
  the URL (`/<step path>/product/<product id>`). Both rules are refused by name before anything is sent. They render
  with the product's data but UNSTYLED (native buttons and select) until the page is saved once in the builder, which
  compiles their CSS. Edit mode's `append-section` is held to the same two rules.
- **Per-kind CSS, compiled here (f4b-2).** The builder writes a second layer of rules for every kind — an order form's button
  gradient, a product-page block's sizes and weights, a store list's grid. This tool now compiles that layer for the two order
  forms, the eleven product-page blocks, `collection-list`, `featured-products` and `store-product-list`, so a page it writes and
  the page the builder saves carry the same rules (core/kind-css.mjs; measured black box from the builder's own output — every
  kind reproduced it on 500 random combinations of its inputs with 0 mismatches, then live: the builder-saved sheet equals the
  tool's per node). The order forms read the page palette (`colors`); pass it on the same call.
  A node whose `extra` / `styles` carry an input outside what was measured (a key nobody probed, a value class no probe covered,
  `tabletStyles` / `mobileStyles` on these kinds) is **refused for CSS, not guessed**: no per-kind rule is written and the node
  comes back under `builderStyling` with a `reason`. In edit mode a `set` that puts such a value on a ported node is refused
  whole (nothing is written); a `set` that changes a ported node's inputs takes the rules of its old state out of the section's
  sheet and writes those of the new one.
- **`builderStyling`: kinds that still look different until a builder save.** 27 kinds compile their look only in the page
  builder: the nav menus, `store-product-detail` / `store-custom-product-detail` / `featured-product`, blog kinds, faq, map,
  pricing table, testimonial, image slider, `image-feature` (the builder's own output for its list bullets is malformed CSS,
  so a declaration comparison is not possible) and others (measured: every kind rendered before and after a builder save).
  Every preview and result that writes one lists its nodes under `builderStyling` with that sentence: open the page in
  the builder and save it once before sharing it. (`pdpStyling`, the product-page subset, is kept for 1.24.0 callers and is
  now always absent: every product-page block is compiled here.)
- Every declared `extra` property must be present. The renderer reads `extra.<prop>.value` unguarded, so a
  missing one 500s the whole page.
- `col.extra.bgImage`, `general.general.fontsToLoad` and `colors` must be present.
- `child[]` must hold node IDs that resolve.
- **Element-spec keys.** Each kind takes only these keys:

  | key | taken by | becomes |
  |---|---|---|
  | `meta` | every kind | the kind |
  | `html` | kinds that store `text` | `extra.text` |
  | `extra` | every kind | extra props as `{<prop>: {value}}` |
  | `styles` | every kind | node styles (also compiled) |
  | `css` | every kind | the element's box rule plus the node styles it implies. `size` / `mobileSize` / `weight` on a text kind or button go ON THE NODE (`extra.desktopFontSize` / `mobileFontSize` `{value, unit:"px"}`, `styles.fontWeight {desktop, mobile}`; a button's `font` → `extra.typography`) and compile at the builder's 0–767 / 768+ breakpoints |
  | `font` | kinds with `typography` | `'headline'` or `'content'` |
  | `tag` | every kind | the node tag |
  | `entranceAnimation` | the entrance kinds | see below |
  | `hoverAnimation` | buttons only | see below |
  | `wrapper` | every kind | the node's box outside its content: margins, padding, `width` (numbers are px; `{value, unit}` for others) |
  | `tabletStyles` / `mobileStyles` | every kind | style overrides for 768–1024 / 0–767 px |
  | `tabletWrapper` / `mobileWrapper` | every kind | wrapper overrides for 768–1024 / 0–767 px |
  | `openPopup` | kinds with `popupId` | a popup name. On `image` / `image-feature` it is written to `extra.imageActions`, on `svg` to `svgImageActions` + `imageActions` — the props their renderer reads; an `extra.action` given for those kinds is moved there too (their own menus: image 11 actions, svg 4) |

  Any other key is refused by name, with a "did you mean". A button given `text` instead of `html` was once
  stored empty.
- An EMPTY popup is refused, because GHL never renders it. So is an `openPopup` naming a popup the page lacks,
  and a video with no source.
- **A composed page survives a builder save.** On every save the builder discards the stored stylesheet and recompiles
  it from the nodes, so everything a visitor sees is on the node: sizes, weights, a button's font, click actions, and
  every unset prop filled with the BUILDER's own fresh-node default (not a name-guessed empty, which compiled to
  `font-size:undefined`). Palette variables (`var(--white)`, `var(--cobalt)`…) are declared on the page the way GHL's
  pages declare them: `general.general.colors` plus a `:root` block in `pageStyles` — the builder rebuilds that block from
  `colors` on save. Proven 2026-09-29 by a real builder save and publish: 0 `undefined`, every size/weight/action/font/
  colour unchanged, and the public render identical at 1280 and 390 px (knowledge sniffs/funnels-wave26-builder-save).

## Verification

- The page is read back on a separate request.
- Pass `verifyUrl` to also poll the public render for your own copy. One request there is not a measurement: the
  first can serve the previous compile.

## Edit mode

- **Target check.** `pageId` must be a page of `stepId`, and `stepName` must match that step exactly; otherwise
  the call is refused. Get node ids from the page data (`GET /funnels/builder/page/data?pageId=`).
- **Everything the ops do not name** is written back as read. Each op is verified by VALUE on a separate read.
- **Ops:**
  - `set`: merges `extra` / `styles` / `wrapper` / the tablet and mobile maps into one node by id, and compiles them
    into the public stylesheet. On a section id, `set` takes the section keys below (not `extra`).
  - `append-section`: a section spec, in the same shape as `sections[i]`. At the end by default, or at a position
    among the sections: `index` | `after` | `before` (a section id).
  - `insert`: a new element into an existing column: `element` (the shape of a column's element) plus `parentId`
    (the column) with an optional `index` | `after` | `before`, or just `after` / `before` a sibling. The node joins the
    section's element bag, its id goes into the column's `child[]`, its rules into the section's sheet.
  - `move`: a section (`sections[]` order, `sequence` renumbered), a row, a column or an element among its siblings:
    `direction` up | down | top | bottom, or a position (`index` | `after` | `before`). An element may go to another
    column of ITS section with `parentId` + a position. Only `child[]` changes; the flat element bag keeps its order,
    as the builder's own save does.
  - `clone`: a section, row, column or element, put right after the original. Every id is new
    (`<kind>-<10 random chars>`, `extra.nodeId` = `c` + id), the copy has no `element` copy and no `updated`, the rules
    that name the original ids are copied under the new ids (a cloned section gets its own compiled sheet). The report
    names `cloneId` and the `ids` map.
  - `remove-node`: a node and its descendants, or a whole section.
  - `page`: `trackingCode {headerCode, footerCode}`; `customCss`, which is kept in `general.general.pageStyles`
    AND appended to the compiled `pageStyles` the public page serves; `background {imageUrl, color}`;
    `typography`.
  - `append-popup`.
  - `set-popup` (`popupId` = the popup's id or its name): `disabled` (the builder's Disable Popup switch:
    `extra.popupDisabled` on the popup's root node), `closeOnOutsideClick`, `showOn`. `remove-popup` takes a popup and
    its page-level rules out (refused while a button opens it). `order-popups` (`order` = ids or names) sets the order
    of `popupsList`, which the builder documents as the popups' priority (the z-index hierarchy); unlisted popups follow.
    Content INSIDE an existing popup is not editable here (`set` on it says so): remove and append the popup.
- **`seo`** takes `{title, description, keywords, author, imageUrl, language, customMeta, canonicalMeta}`. Only the
  keys you pass change. SEO is written twice, as the builder does:
  1. to the page RECORD (`GET /funnels/page/{pageId}`) through `POST /funnels/funnel/funnel-page/{pageId}`. That
     route also writes the record's name and url, so the values just read are sent back and verified unchanged;
  2. as `meta` on the autosave's version.
- 🔴 **The public page renders the SERVED VERSION.** Pass `publish: true` (or publish from the builder) for any
  edit, content or SEO, to reach visitors.

## Style values

An authored `styles` / `wrapper` / device-map value is stored in the builder's shape, never bare (a bare value compiled for the
public page but the builder canvas ignored it, bl-332): `"16px"` / `"50%"` / `"1.3em"` → `{value:16, unit:"px"}` etc.;
`"#d00000"`, keywords (`bold`, `center`), `var(--x)`, `rgb(…)`, shorthands (`"0 1px 2px rgba(0,0,0,.1)"`) → `{value:"…"}`; a number →
px on a key that carries a unit (padding, margin, size, radius, gap, width, height…), else plain (`opacity`, `zIndex`); an
already-shaped `{value, unit}` passes untouched. `null`, booleans, arrays, an object with no `value`/`unit`, an empty string
and NaN are refused by key name (`styles.color: null …`) before anything is written.

## Structure and motion

- **Styles compile as the builder compiles them.** A node's `styles`, `wrapper` and tablet / mobile maps go through
  the builder's own generic style rules (reimplemented from its behaviour and checked against it), so a builder save
  leaves sections, margins and per-device overrides exactly as composed (proven live: no change at desktop, tablet or
  mobile after a builder save). The rows' container is the builder's 1170 px unless `maxWidth` / `fullWidthRows` says
  otherwise — a `maxWidth` other than 1170 lasts only until the next builder save.
- **A section spec** takes (any other key is refused by name):
  - `styles`, `wrapper`, `tabletStyles`, `mobileStyles`, `tabletWrapper`, `mobileWrapper` — as on an element; the
    section's padding and background colour are `styles` too (`padY` / `background` are shorthands)
  - `visibility`: `{hideDesktop, hideTablet, hideMobile}`
  - `customClass`: a class name or a list of them
  - `bgImage`: `{url, options?: bgCover | bgContain | bgNoRepeat | bgRepeat | bgFixed, opacity?: 0–1}` — the renderer
    reads it from the node; it is never in the stylesheet
  - `entranceAnimation`: as on an element
  - `sticky`: `none` | `top` | `bottom`
  - `width`: `full` | `wide` | `midWide` | `small`
  - `fullWidthRows`, which cannot be combined with `maxWidth`
  - `pdp`: `true` | `{products: [<product id>]}` — the product-page section the `store-pdp-v2-*` blocks need (above)
- **`entranceAnimation`** `{name, duration, delay, scale, easing}` goes on heading, sub-heading, paragraph,
  rich-text, bulletList, button, image and a section.
  A button also takes the looping entrances `buttonPulseGlow`, `buttonRocking`, `buttonBounce` (bare class, no timing
  knobs), and every entrance takes `disableOnMobile: true` (class `disableAnimationsOnMobile` + a `@media (max-width:1024px)`
  and `.--mobile` rule that switch the animation off).
- **`hoverAnimation`** goes on a button: `{name, duration, delay, easing}` plus the effect's own knob, which is
  one of `scale`, `angle`, `distance`, `borderThickness`, or `blur` with `spread`.

Both the class knobs AND the builder's compiled rules are written, byte-equal to a builder save.

## Popups

- A popup spec is `{name, width full|medium|small, showOn 'exit'|'none'|{delay}, closeOnOutsideClick, position,
  background, disabled, columns}`. In edit mode, use `append-popup`.
- An element's `openPopup: "<popup name>"` wires a button, image, image-feature or svg to a popup. 🔴 An svg's click
  listener is on the inner `<svg>`: the click lands only on the graphic itself, not its padding.
- 🔴 **Trap:** the builder's first save of an API-composed page adds an empty popup. Opening an empty-action
  button's General tab then rewrites that button to `openPopup` on that popup. Re-read buttons after a builder
  session.

## Fonts

- **Page text and link colour.** `typography {textColor, linkColor}` (same places) takes a palette name (`red`, `cobalt`,
  `var(--blue)`) or a hex colour and writes what the Typography panel writes: `colors.<slot>` and `:root --text-color /
  --link-color`; an unknown name is refused with the palette. Naming one leaves the other as it was.
- **Page fonts.** `typography {headlineFont, contentFont}` (compose: top-level; edit: op `page`) sets the page
  fonts the builder's way: the setting, the faces loaded, and `:root --headlinefont / --contentfont`. An
  element's `font: 'headline' | 'content'` uses them, and is refused while the page has none set.
- **Uploaded fonts.** A slot may name an UPLOADED font by id: `{customFontId}` from `GET /funnels/custom-fonts`.
  It is written as the builder writes it: an `isCustom` slot, a `general.customFonts` entry that the renderer
  emits `@font-face` from, and the `:root` vars. It never goes in `fontsToLoad`. Uploading a font is left to the
  builder (Typography → Upload Fonts).
- **Families as variables.** Every `css.font` / `styles.fontFamily` is written as `var(--<name>)`, with its
  `:root` variable and its `fontsToLoad` entry. The builder recomputes `fontsToLoad` from var references on every
  save, so a literal family would stop loading after anyone saves the page there.

## Not here — done in the builder

- schema markup (SEO panel → Schema markup; its own object)
- the autosave on/off switch (browser-local; every write here is one autosave)
- button theme presets (set styles directly; a theme's radius class loses to the compiled rule)
- brand-palette colours (write literals)
- column layout knobs
- saved section/element templates and global/universal sections (drag-inserted)
- font upload

Visitor geo-location is a runtime lookup with nothing to set.
