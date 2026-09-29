---
name: ghl-funnels-pages
description: Build GoHighLevel funnels, pages and websites via the internal API — create the funnel and its steps, author page content from native elements (not just custom HTML), art-direct it with the compiled stylesheet, bind calendars and products, set tracking and SEO, attach a domain, fix the public path, and audit a site for the references a template install leaves broken. Use when the user asks to build/create a GHL funnel, landing page, website, sales or booking funnel, to restyle one, to add custom HTML, to set tracking, SEO or routing, or when a GHL page renders wrong, 404s, says "Unable to find form", or shows different content in the builder than in public.
---

# GHL funnels, pages and websites

Writes to a GHL account through the undocumented internal API. Everything here was executed against
a live account and read back; anything unproven says so in those words.

**A website IS a funnel document** (`type: "website"`) — same steps, same builder, same elements.
Nothing on this page is funnel-only.

## Before any write

1. Both gates in `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md`.
2. **The contract**: `${CLAUDE_PLUGIN_ROOT}/docs/specialist-contract.md`. Follow it as written —
   including step 5 (resolve every dependency to a real id before writing) and step 6's approval
   that **names the target `locationId`**. This skill's output is a live public URL on someone's
   own domain; that gate is the one that matters most here.
3. **Auth**: `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` §9. Through the MCP server, headers
   are added for you — never set them yourself.
   🔴 **Both rails answer on `/funnels/*`.** `token-id` and `Authorization: Bearer` each returned
   200 on identical calls (re-measured with negative controls 2026-09-10). An older note saying
   Bearer is *rejected* was true in July and the platform moved. **So a 401 here is not proof the
   credential is dead — try the other rail before re-capturing.** Re-capturing on the first 401
   loops while a working credential sits in the token file.

## The object model

```
funnel ──has many──▶ step ──has many──▶ page (control + split variations)
   │                   │                  │
   └──── one funnel_lookup row each ──────┘     (rows exist only once a domain is attached)
```

- **You mint `step.id`** (uuid v4, client-side). The server mints `pageId`.
- A page document is metadata only. **Content lives behind** `GET /funnels/builder/page/data?pageId=`.
- The content tree is **FLAT**: `section.elements[]` holds every node, `child[]` holds node **ids**.

## The build sequence — and which steps have no tool

| # | step | how |
|---|---|---|
| 1 | create the funnel | **`create_funnel`** — `kind` funnel / website / store / webinar / blog; refuses a name already on the location; store and webinar are GHL's blank-template installs (the UI's own blank path) |
| 2 | attach the domain **before creating steps** | **no tool** — recipe 11. Rows are stamped from the funnel path as it stands when minted, so steps created first get flat paths. 🔴 Run **`audit_site`** first: a path is held per DOMAIN across every document on the location, the attach renames a collision silently and arbitrarily, and routing never follows a later step rename |
| 3 | create each step (mints its page) | **`edit_funnel` op `create-step`** — refuses on a funnel with no domain (such a step gets no lookup row and 404s); preview returns the `step.id`, pass it back on confirm |
| 4 | author + publish the page | **`build_funnel_page`** — composes, validates, writes, reads back, and publishes when you pass `publish:true` |
| 5 | fix the public path | **`edit_funnel` op `update-step`** with `url` — one PUT moves the step's live row in place; recipe 10 for anything else |
| 6 | verify | fetch the URL a visitor would, and read the publish state |
| 7 | audit before handing over | **`audit_site`** — read-only |

Step 2 is still a recipe; the rest have typed tools. 🔴 A store from `create_funnel` embeds a form from GHL's template account on its Contact Us page — it does not exist on the location; rebind it (measured: that id 401s while the location's own forms read).

## Reading and editing a funnel after it exists

**`get_funnel`** (read-only) — one flat `view`: `summary` (steps, pages, split state), `lookups` (the
routing rows: a step with no row 404s; `publishStatus` null = never touched = live), `settings`,
`versions` (one page, sorted by timestamp), `security`, `events`, `cookie-consent`, `share` (the funnel's
share link if one exists — `shareWith`, the import URL), `archived-pages` (pages a page "delete" or a split
winner archived; restorable).

**`edit_funnel`** — one `op` per call, preview first, `confirm:true` writes and reads back:
`settings` · `create-step` · `update-step` (rename / move path) · `reorder-steps` · `clone-step` ·
`delete-step` (target check: id **and** current name) · `publish-page` / `unpublish-page` ·
`add-header` · `split-test` (`add-variation` on a path you name and it pre-checks → `start`
`{controlTraffic}` → `declare-winner` `{winnerPageId}`, which archives the other page) ·
`delete-funnel` (target check: id **and** `expectName`; refused while any page still serves in public —
unpublish first; the edge keeps serving a deleted page ~70 s). `update-step` also renames the step's
page record, as the UI does, so the builder's page title never drifts from the step.

Whole-object ops on the same tool (bodies captured from the UI, each proven live):
`clone-funnel` `{name}` — a copy in THIS location. The route returns no id, so the name must be unused
and the copy is found by it. 🔴 The copy has NO domain and NO public paths and keeps the source's step
urls; attaching the source's domain (`settings {domainId, funnelPath}`) silently renames every colliding
path with a numeric suffix (`/x` → `/x-5424`) — read `view lookups` after and move them with `update-step`.
`archive-page` `{pageId, expectName}` — what GHL's modal calls "permanently deleted" is an ARCHIVE; refused
on the only page of a step and on a running split. `restore-page` `{pageId}` — back on its step, on a NEW
path minted from the page name (the old path stays 404). `import-page` `{stepId, sourceFunnelId,
sourceStepId, sourcePageIndex}` — a copy of another step's page as the target's second page; products are
NOT imported. `add-store` — the 5 store steps on fixed domain-level paths (pre-checked; refused if any is
held); GHL creates the pages EMPTY (a blank 200 in public), so the op fills each with its store element.
🔴 Saving a checkout with the billing address on IN THE BUILDER creates a "Billing Info" contact-field
folder + 7 billing fields location-wide (a repeat added no duplicate fields; they are not removed with the store); `build_funnel_page` previews
say so when a page has such a checkout.

**`find_ghl_site`** `list:true` — every funnel, website, store, webinar and blog on the location, walked
to the list's `count` (the list honours `limit` exactly, so a single page silently drops the rest),
filtered by `type` (store = a website with `isStoreActive`) and a name `search`.

**`build_funnel_page` edit mode** — change an EXISTING page's content in place: pass `edits` and
`stepName` instead of `sections`. Ops: `set` (merge `extra`/`styles` into one node by id — styles are
compiled into the public stylesheet too), `append-section` (same shape as `sections[i]`), `remove-node`
(a node with its descendants, or a whole section). The page must be a page of `stepId` and `stepName`
must match that step exactly, or the call is refused — a wrong `pageId` would otherwise be overwritten
with a 201. Everything the ops do not name is written back as read, and each op is verified by VALUE
on a separate read. Node ids come from `GET /funnels/builder/page/data?pageId=`. Prefer this over
recomposing a page: `sections` REPLACES the whole page.

**Structure and motion** (`build_funnel_page`, both modes; shapes measured from the builder's own saves):
a section takes `sticky` (`none|top|bottom`), `width` (`full|wide|midWide|small`) and `fullWidthRows`
(rows span the section; not with `maxWidth`) — in edit mode as `set` on the section's id. A leaf takes
`entranceAnimation` `{name, duration?, delay?, scale?, easing?}` (heading, sub-heading, paragraph,
rich-text, bulletList, button, image) and a button `hoverAnimation` `{name, duration?, delay?, easing?,
+ its effect's knob: scale | angle | distance | borderThickness | blur, spread}`; the tool writes the
class knobs AND the builder's compiled rules, byte-equal to what the builder saves. `popups`
`[{name, width: full|medium|small, showOn: 'exit'|'none'|{delay}, closeOnOutsideClick, position,
background, columns}]` (edit mode: `append-popup`) and a button's `openPopup: "<popup name>"` open one.
An empty popup is refused — GHL never renders it — and so is an openPopup naming a popup the page lacks.

**Buttons that sell** (`extra` on a `button`, both modes; every shape is what the builder UI saves, proven by
reading it back and clicking it in public). `action` `add-to-cart` / `buy-now` take `storeProductId` (the product)
and `storeProductPriceId` (the PRICE). Add to cart shows a toast and keeps the cart in the browser; Buy now opens
`/store-checkout?buyNowProductId=<price id>`. `go-to-product-collection` takes `storeCollectionId` plus
`storeProductPriceId: "all"` and opens `/store-product-list/collections/<slug>`. `sell-product` (one-click
up/down-sell) takes `productId: {value: {id: <STEP product id>}}` — an object, and a step product, not a
catalogue id. Its sale needs a card already on file from an earlier purchase in the funnel.
After a sale, a `sell-product` button or an order form (`one-step-order`, `two-setp-order`) goes where
`saleAction` says: `go-to-next-funnel-step` (default), `url` + `visitWebsite`, or `step-path` + `stepPath: <step id>`.
**Step products** — what an order form lists and a sell button sells — are the step's Products tab. Add one with
`edit_funnel` op `add-step-product` `{stepId, expectName, productId, priceId, displayText?, quantity?, bump?}`: it
checks the step by id AND name and that the price is one of the product's, refuses a product+price the step already
lists, reads it back and returns `stepProductId` (the id a sell button stores). `get_funnel` view `step-products`
lists them with product and price names. Removing or editing one is not offered.

**Forms, surveys, calendars** (`form`, `survey`, `calendar` leaves) bind by reference: `extra.formId` /
`surveyId` = `{value: <id>, text: <name>}`, `calendarId` = `{value, text, isTeamSelected: false}`, each with its
own redirect `action` (`none` = use the asset's own action, `url` + `visitWebsite`, `go-to-next-funnel-step`). All
three render inline in the public page. 🔴 A survey with **no question** takes the WHOLE public page down with a
500 (the renderer reads the survey live; adding one question fixes it with no republish), so check a page's public
status after binding a survey.

**Video** (`video` leaf): the source is `extra.videoProperties.value` — pass `{url}` (a YouTube, Vimeo, Wistia or .mp4 URL;
the player `type` is read off it) or `{selfHostedVideo: {id, name, url}}` for a Media Storage file (`type: "selfHosted"`).
A video with no source is refused (it rendered an empty 16:9 box). In edit mode a `set` naming only a new `url` keeps the
rest of the stored value. `playBackControls` (`autoplay`, `loop`, `showProgressBar`, …) is a RAW object. 🔴 Only a
**hosted** video reports analytics (plays, completion). YouTube, Vimeo, Wistia and embeds send nothing.

**Timers** (`countdown`, `minute-timer`, `day-timer`; `marketing-countdown` binds a Marketing → Countdown Timers asset by
`countdownTimerId`). 🔴 A timer whose end has passed renders NOTHING in public, even though the builder canvas shows it
counting:
- a Countdown's `endDate` defaults to the day it is added, at `endTime 00:00` America/New_York — always set an explicit
  future `endDate` + `endTime`;
- a Day Timer counts to TODAY's `endTime` and does not roll over — blank for the rest of the day once reached;
- the Minute Timer is evergreen per visitor.
The expire action is `url` (+ `redirectUrl`) or `hide` (+ `hideElements` / `showElements`, node ids).

**Customer Access Center** (`nav-menu-v2` on a store): pass `extra.enableCustomerLogin {value: true}` and
`extra.cacItems {value: [...]}`. The builder's own two items are My Orders (`goTo: "go-to-cac"`, `goToCacPage:
"orders" | "wishlist"`) and Logout (`goTo: "logout"`). They are the only place those two actions exist: the
builder's item editor never offers them. In public the items show only to a LOGGED-IN store customer. Everyone
else gets a user icon linking to the store's `/store-product-list/store/account/login`, which is Turnstile-gated.
It needs a domain whose default page is a store page.

**Upsell** (`upsell` leaf): `extra.productDetails` is a RAW snapshot of a CATALOGUE product (`{_id, name, amount,
currency, hasVariants, label, value: <product id>, …}`), not a step product. It renders every price of that product, with
`saleAction` as for order forms. The purchase itself charges a card saved by an earlier order in the funnel.

**Analytics:** `get_funnel` view `stats` gives a funnel's per-step views, opt-in and sale rates and earnings per view,
with step names, plus the totals the Sites Analytics cards show. Location-wide dashboard reads (`/stats/count`,
`/stats/graph/data`, `/stats/count/split`, `/stats/device/split`, `/stats/video/stats`, `/stats/count/webinar`) go through
`raw_request` — see the catalogue rows.

**Fonts** — page typography `{headlineFont, contentFont}` (compose: top-level `typography`; edit: op `page`
`typography`) writes the builder's setting, loads the faces and declares `--headlinefont` / `--contentfont`;
an element with `font: 'headline'|'content'` uses them (refused when the page has none set). A slot can
name an UPLOADED font instead: `{customFontId: "<_id>"}` from `GET /funnels/custom-fonts?locationId=` — written as the
builder writes it (`isCustom` slot, a `general.customFonts` entry the renderer turns into `@font-face`, the
`:root` variables; it is never in `fontsToLoad`); an unknown id is refused. Every other
family (`css.font`, `styles.fontFamily`) is written as the builder writes a picked font — `var(--<name>)` with
its `:root` variable and a `fontsToLoad` entry. 🔴 The builder recomputes `fontsToLoad` on every save from
`var(--…)` references only, so a LITERAL family (what this tool wrote until this fix, and any raw page edit)
stops loading the first time anyone saves the page in the builder; the text falls back silently.

Page-level settings ride the same mode: op `page` sets tracking code (header/footer), custom CSS and the
page background; `seo` sets title, description, keywords, author, social image and language. SEO is
written twice, as the builder does: to the page record (`POST /funnels/funnel/funnel-page/{pageId}`
`{name, url, meta}` — it rewrites name and url too, so the tool sends the values it just read and
verifies them unchanged; the builder's own SEO panel writes the same record Firestore-direct) and as
`meta` on the autosave's version. 🔴 The public page renders the SERVED VERSION's
meta, so SEO — like content — changes in public only when the page is published again: pass
`publish:true`. A correct record is not a changed `<title>`.

**`edit_redirects`** — URL redirects (domain-scoped 301s, Settings → Domains & URL Redirects): create /
update (target only; the source is locked) / delete, preview first, id AND path target check. It refuses
the storefront/blog prefixes (`/b/ /c/ /product/ /collections/ /post/ /category/ /author/ /tag/`): GHL
stores those and serves 404 on the exact path. A redirect forwards the request's query string to the
target. Read them with **`find_ghl_site`** `includeRedirects:true` (domains, every redirect, 30-day clicks).

### Not offered by a tool — tell the user GHL does it, and where

| capability | where in GHL | why no tool |
|---|---|---|
| funnel folders (create, rename, move a funnel into one) | Sites → Funnels → Create folder / row Actions → Move to folder | organisational only; `find_ghl_site list:true` shows each document's `folderId` |
| a bare extra page on a step | — | `POST /funnels/page/create-page` makes an ORPHAN page on no step (measured); `create-step` makes a step with its page, `split-test add-variation` adds a second |
| the builder's autosave on/off switch | page builder toolbar | a browser-local preference (`localStorage`); every tool write is already one explicit autosave |
| Build with AI (funnels list) | Sites → Funnels → Build with AI | the AI builder; 🔴 it creates a funnel and a step the moment it is clicked. Use `create_funnel` + `build_funnel_page` |
| the page builder's Ask AI (generate a whole page from a brief; chat edits like "rewrite this paragraph") | page builder → Ask AI (sparkle icon); on a funnel or website that is NOT store-active | measured on the sandbox: the wizard filled 7 sections (79 elements, 7 AI images) and the chat changed only what it was asked. 🔴 Every wizard field change is an LLM call, and a run turns the builder's autosave switch ON and rewrites the funnel's global sections. No price is shown and no AI-meter product moved. The tabs are labelled the reverse of what they do: "Assist" is the page wizard, "Build" is the chat |
| Content AI in the text editor (improve / fix / shorten / generate text, AI images) | page builder → select text → AI menu | GHL's paid Content AI add-on; the menu only appears when it is enabled on the sub-account |
| schema markup (JSON-LD) | page builder → SEO panel → Schema markup → Add schema (form view, or AI) | its own object (`/schema-markup/schemas/save`, `ownerType:"funnel_page"`), rendered in `<head>` |
| button themes gallery (Quick Add → Buttons, 18 presets) | page builder → Quick Add → Buttons | presets of ordinary styles; 🔴 a theme's own radius class loses to the compiled rule (the "radius15" theme renders 5px) — set `styles` directly |
| brand-board colours (the board's own swatches) | page builder colour picker → Brand / Global colours | a board's colours are builder-owned; `build_funnel_page` declares the builder's standard palette on every page it writes (`general.colors` + the `:root` block GHL's own pages carry), so `var(--white)`, `var(--cobalt)`, `var(--red)`… resolve; a brand-board swatch is not in it — write a literal colour |
| column layout knobs (content direction, spacing, alignment, "same layout on mobile") | page builder → column → General | the builder writes them per column; widths are set with `widthPct` |
| saved assets: section / element templates, universal sections and elements, global sections | page builder → Save Section / Save Element; Quick Add → Saved Assets | builder-owned synced assets; inserting one is a drag in the builder |
| share a funnel (a link anyone can import) | Sites → Funnels → row ⋮ → Share | 🔴 merely OPENING the Share modal creates a link shared with ALL; narrowing it to the agency or removing it needs the $497 plan. Read one with `get_funnel view share` |
| clone a funnel into ANOTHER sub-account | Sites → Funnels → row ⋮ → Clone → pick locations | the same route as `clone-funnel`; cross-location delivery is not proven, so the tool clones into this location only |
| upload a custom font (.ttf .otf .woff .woff2, max 100 per sub-account) | page builder → Typography → a font picker → Upload Fonts → Manage Fonts | a multipart file upload from the user's device or media library; once uploaded, `build_funnel_page` typography uses it by `{customFontId}` |
| reset a funnel's stats | Funnel → Stats → Reset | irreversible; `DELETE /stats/?funnelId&locationId` applies asynchronously (the numbers read partial for ~30 s, then 0) and also clears that funnel's Sites Analytics numbers |
| visitor geo-location | nothing to set | a runtime lookup (`GET /funnels/funnel/geo-location/` → the visitor's country) the builder uses to format prices |
| install a Template Library template (1,000+ funnels, websites, stores, webinars) | Sites → Funnels → New funnel → From templates → Continue → Choose | an install can bring side assets (forms, products) the plugin does not track; `create_funnel` makes the blank document. The raw install is `POST /templates/template/load` (documented, synchronous). Browsing is reads on `services…/templates/*`; 🔴 a `keyword` list call saves the user's recent searches |
| upload a funnel / website / store / webinar to the agency template library; template admin (own categories and types, what sub-accounts see, selling, sharing) | a row's ⋮ → Upload To … templates (agency admins only) | the $497 agency plan, and it publishes AGENCY-wide: every sub-account, clients included, sees the template |
| a webinar's schedule, recurrence and email notifications | Sites → Webinars → row ⋮ → Edit | rare, and the Edit webinar screen does it: `PATCH /funnels/funnel/webinar/{id}` with the whole `webinarProperties`; sessions read on `POST /funnels/funnel/webinar/sessions`. 🔴 A one-off (non-recurring) webinar stores its start with the SAVING BROWSER's UTC offset, not the webinar timezone — by raw call send `endDate` in UTC converted from `timezone`. Enabling a notification needs an email template first |
| Widget Marketplace widgets (third-party "All The Apps" elements) | page builder → Add Elements → Widget Marketplace | each widget is a third-party app that must be installed on the location first (its own OAuth grant; most are paid); installing apps is outside this plugin |

What the builder does that a 2xx will not tell you (all measured live):

- 🔴 **A composed page must stay saveable in the builder.** The builder recomputes every element's styles and fonts
  on each save and reads many values unguarded; one node missing one makes the WHOLE page unsaveable there
  ("Error while creating page!", nothing is sent) while the public page renders fine. `build_funnel_page` writes the
  builder's own defaults for the kinds that need them (order forms, nav menus, FAQ, image feature, blog, blog
  subscribe form, category navigation, the store kinds) and never writes a font prop as a list; proven by composing
  all 54 non-step-typed kinds and all five store pages and saving each in the builder. After a hand-made edit, open
  the page in the builder and save once: if it refuses, a node is malformed.

- 🔴 **An order form that renders is not an order form that submits.** Which inputs show comes from
  `extra.step1.value`; the public validator demands a phone unless `showPhone` is `false`, so an order form with
  an empty `step1` renders without a phone field and no buyer can ever complete it (`build_funnel_page` writes the
  builder's `step1` defaults). The validator also refuses a phone libphonenumber calls impossible, a one-word
  full name, an empty mandatory company name and, with shipping on, an empty address field (a US address needs a
  state). The submission carries a Cloudflare Turnstile token: from an automated browser the order `POST`
  answered `429` and a "Verify you are human" box appeared. Nothing was created. An embedded form's
  `POST /forms/submit` is gated the same way. A test order or form submission needs a person in a real browser.
- 🔴 **An embedded form, survey or calendar with no on-submit action looks broken to the visitor.**
  Submissions are stored, but nothing on the page changes, and people submit again. A form given only a
  `formId` is written with `extra.action: ""`. The builder's own value for a fresh embed is `"none"` ("Please
  select an action"). `build_funnel_page` flags both under `submitAction` in the preview and the result and
  leaves the action as written. Set `extra.action` to `go-to-next-funnel-step`, onto a step that confirms the
  submit and not one showing the same form (that also reads as a failed submit), or to `url` with
  `extra.visitWebsite`.

- 🔴 **The builder's first save of an API-composed page adds an EMPTY popup**, and merely opening the
  General tab of a button whose action is empty rewrites it to `openPopup` pointing at that popup — a
  behaviour change nobody clicked (an empty popup never shows, so the button then does nothing). After a
  builder session, re-read the page and check every button's `extra.action`.
- 🔴 **The builder recompiles the whole section stylesheet on every save.** A composed `maxWidth` becomes
  the builder's `1170px` (or `100%` with `fullWidthRows`) the first time anyone saves the page there.
- 🔴 **A themed button renders its compiled rule, not its theme class**: the gallery's `radius15` theme
  shows 5px corners, and its rule is keyed to the gallery template's class, not the button's own id.
- 🔴 **The builder's Publish never calls `publish-version`.** It autosaves with `pageType:"live"` and
  then `PUT /funnels/lookup/multiple` (`publishStatus:"live"`). Every publish mints a NEW live version
  and demotes the previous one to draft. Restoring a version creates a new DRAFT; the public URL
  does not change until the next publish. `/preview/{pageId}` serves the draft,
  `/preview/{pageId}?version={id}` one exact version.
- 🔴 **Unpublish is the same lookup route**, on the step AND page rows: `not_found_page` → public 404,
  `redirect` + `action:"url"` → public 301 to the target. `unpublish-page` does that and nothing else;
  to publish CONTENT use `build_funnel_page` `publish:true`.
- 🔴 **Settings are a full write.** `edit_funnel` always sends the UI's whole body from a fresh read,
  so only the fields you name change. Changing `funnelPath` moves the funnel ROOT lookup row in place
  and the old path 404s.
- 🔴 **Custom headers and split routing apply to the EXACT-CASE path only.** A case-varied URL serves
  the same page without the headers (a CSP or X-Frame-Options can be bypassed that way) and skips the
  split test. Splitting is a 302 to the variation's own path.
- Cookie consent is FUNNEL-level (`POST /funnels/funnel/cookie-consent`), SEO title/description/author
  live on the page RECORD's `meta` (not the page data), schema markup is its own object
  (`/schema-markup/schemas/save`, `ownerType:"funnel_page"`).
- The domain's robots.txt / llms.txt save is a FULL `PUT /funnels/domain/{id}`, and the builder's own
  follow-up `POST /funnels/funnel/cache/clear` answers 422 (a GHL bug; the `invalidate-cache` after it
  works).

## The four that cannot be deferred

🔴 **Every declared property of an element must be PRESENT.** Empty is fine, missing is fatal — the
renderer reads `extra.<prop>.value` unguarded, so one absent prop 500s the whole page while autosave
returns 201. Three keys do the same: `col.extra.bgImage`, `general.general.fontsToLoad`,
`general.general.colors`.

🔴 **`builder/autosave` is a blind store.** An invented `meta` round-trips exactly like a real one.
A write-then-read proves persistence, never validity. `build_funnel_page` enforces what autosave
will not.

🔴 **There are TWO stylesheets and neither reaches both consumers.** The public renderer serves
`section.general.sectionStyles` (compiled CSS keyed by node id); the builder discards it and
recompiles from node `styles`/`wrapper`/`extra`/`customCss`. Write one and the page looks right in
the builder and naked in public, or the reverse.

🔴 **Publishing FREEZES the page.** The public URL serves the newest `live` version if one exists,
and falls back to the newest draft if the page has never been published. So while unpublished,
every autosave appears publicly and publishing looks optional — and the first publish pins the page,
after which every later write is invisible in public with a 201 on each one. 🔴 A NEW page can pin itself
without a publish: measured 2026-09-29, a fresh step's second autosave turned its FIRST version live, and the
public page stayed on that first version through every later save. `build_funnel_page` reports the state on
every run; read `publishState` before believing any public fetch.

## Which reference for which job

Load only what the job needs.

| what you are doing | go to |
|---|---|
| "which element do I use for a testimonial / booking / pricing block?" | [`references/choose-an-element.md`](references/choose-an-element.md) |
| build a funnel or website end to end | [`references/recipes.md`](references/recipes.md) §1, 11, 2, 4, 7, 10 |
| the page 500s, renders blank, or an element is missing | [`references/authoring-and-design.md`](references/authoring-and-design.md) — the presence rule and the per-kind contract |
| the builder hangs on a spinner forever | `authoring-and-design.md` — `settings.settings.background`, `node.element`, `extra.icon` |
| make it look designed rather than generated | `authoring-and-design.md` Part 2 — the compiled stylesheet is the whole stylesheet |
| change the URL a page serves at, or attach a domain | `recipes.md` §10 (three calls) and §11 |
| a page 404s, or a step lost its route | [`references/websites.md`](references/websites.md) — routing, and what a domain attach silently renames |
| "Unable to find form", a dead calendar, a blank heading | **run `audit_site`** — then `websites.md` for the reference shapes |
| a page 404s on a path the step record says it owns | **run `audit_site`** — routing is materialised at attach time and never recomputed; the repair is a `PUT /funnels/lookup/{lookupId}`, which the finding names with the ids filled in |
| the builder shows my change and the public URL does not | the publish-freeze rule above; read `publishState` |
| set up an A/B test | `websites.md` — it works, and it needs **six** things |
| websites, global sections, blogs, stores | [`references/websites.md`](references/websites.md) |
| every `build_funnel_page` key, op, animation, popup and font rule | [`references/build-funnel-page.md`](references/build-funnel-page.md) |
| every `edit_funnel` op with its arguments and traps | [`references/edit-funnel.md`](references/edit-funnel.md) |
| I need to know which READ verifies a WRITE | [`references/verify-reads.md`](references/verify-reads.md) |

## Never report a page as shipped off a `201`

Name the URL you fetched and say which of draft/live you verified. **28 documented ways this surface
returns success and does nothing** — that is the house it lives in.

🔴 Measuring a public page measures **Cloudflare** unless you defeat it: `max-age=60` plus
`stale-while-revalidate=30`, and the query string is **not** in the cache key, so `?cb=` busts nothing
and request-side `no-cache` is ignored. After a path move or unpublish the exact path was measured
serving the old state for 90 s to ~3 min. Read `cf-cache-status` on every sample. Varying the path's
CASING gets a fresh key onto the same row — but it is **not the same request**: a case-varied path
skips split-test routing and custom security headers. Use it to read page CONTENT only; measure
routing and headers on the exact path, after the cache window.

## Scope

**IN:** funnel / step / page creation, native-element authoring (all 68 of the builder's leaf kinds
compose from scratch; the 11 `store-pdp-v2-*` product-page blocks need a product-detail step and a `pdp` section), art direction, custom HTML, tracking code, page `meta`, public-path and domain routing,
calendar and product bindings, chat widget, split tests, publishing, site audit. Store pages need a
step of `type:"store"`; blog pages need a `blog-post` step in a `type:"blog"` funnel, which
`create_funnel` `kind:"blog"` makes (with a Blog Home step).

**OUT:** pipelines (public API — use the ghl MCP server), workflow wiring (use
`create-ghl-workflow`), form and calendar *authoring* (use `ghl-forms`; this skill only binds and
audits them).

**Never WRITE through an endpoint that is not in `recipes.md`** — every recipe exists because a
write here has a trap. Reads are different: `search_endpoints` indexes every `/funnels/*` route and
`describe_endpoint` hands you the call. A write you discover that way goes through
`ghl-reverse-engineering` and into `recipes.md` first, not straight at a client funnel.
