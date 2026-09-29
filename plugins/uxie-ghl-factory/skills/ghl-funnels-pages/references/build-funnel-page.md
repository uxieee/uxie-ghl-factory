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
  compiles their CSS — the tool compiles none for these kinds yet (console bl-298).
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
  - `set`: merges `extra` / `styles` into one node by id. The styles are compiled into the public stylesheet
    too. On a section id, `set` also takes `sticky`, `width` and `fullWidthRows`.
  - `append-section`: a section spec, in the same shape as `sections[i]`.
  - `remove-node`: a node and its descendants, or a whole section.
  - `page`: `trackingCode {headerCode, footerCode}`; `customCss`, which is kept in `general.general.pageStyles`
    AND appended to the compiled `pageStyles` the public page serves; `background {imageUrl, color}`;
    `typography`.
  - `append-popup`.
- **`seo`** takes `{title, description, keywords, author, imageUrl, language, customMeta, canonicalMeta}`. Only the
  keys you pass change. SEO is written twice, as the builder does:
  1. to the page RECORD (`GET /funnels/page/{pageId}`) through `POST /funnels/funnel/funnel-page/{pageId}`. That
     route also writes the record's name and url, so the values just read are sent back and verified unchanged;
  2. as `meta` on the autosave's version.
- 🔴 **The public page renders the SERVED VERSION.** Pass `publish: true` (or publish from the builder) for any
  edit, content or SEO, to reach visitors.

## Structure and motion

- **A section spec** takes:
  - `sticky`: `none` | `top` | `bottom`
  - `width`: `full` | `wide` | `midWide` | `small`
  - `fullWidthRows`, which cannot be combined with `maxWidth`
  - `pdp`: `true` | `{products: [<product id>]}` — the product-page section the `store-pdp-v2-*` blocks need (above)
- **`entranceAnimation`** `{name, duration, delay, scale, easing}` goes on heading, sub-heading, paragraph,
  rich-text, bulletList, button and image.
- **`hoverAnimation`** goes on a button: `{name, duration, delay, easing}` plus the effect's own knob, which is
  one of `scale`, `angle`, `distance`, `borderThickness`, or `blur` with `spread`.

Both the class knobs AND the builder's compiled rules are written, byte-equal to a builder save.

## Popups

- A popup spec is `{name, width full|medium|small, showOn 'exit'|'none'|{delay}, closeOnOutsideClick, position,
  background, columns}`. In edit mode, use `append-popup`.
- An element's `openPopup: "<popup name>"` wires a button, image, image-feature or svg to a popup. 🔴 An svg's click
  listener is on the inner `<svg>`: the click lands only on the graphic itself, not its padding.
- 🔴 **Trap:** the builder's first save of an API-composed page adds an empty popup. Opening an empty-action
  button's General tab then rewrites that button to `openPopup` on that popup. Re-read buttons after a builder
  session.

## Fonts

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
