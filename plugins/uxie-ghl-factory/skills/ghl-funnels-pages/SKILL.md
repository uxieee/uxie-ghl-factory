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
`versions` (one page, sorted by timestamp), `security`, `events`, `cookie-consent`.

**`edit_funnel`** — one `op` per call, preview first, `confirm:true` writes and reads back:
`settings` · `create-step` · `update-step` (rename / move path) · `reorder-steps` · `clone-step` ·
`delete-step` (target check: id **and** current name) · `publish-page` / `unpublish-page` ·
`add-header` · `split-test` (`add-variation` on a path you name and it pre-checks → `start`
`{controlTraffic}` → `declare-winner` `{winnerPageId}`, which archives the other page) ·
`delete-funnel` (target check: id **and** `expectName`; refused while any page still serves in public —
unpublish first; the edge keeps serving a deleted page ~70 s). `update-step` also renames the step's
page record, as the UI does, so the builder's page title never drifts from the step.

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

**Fonts** — page typography `{headlineFont, contentFont}` (compose: top-level `typography`; edit: op `page`
`typography`) writes the builder's setting, loads the faces and declares `--headlinefont` / `--contentfont`;
an element with `font: 'headline'|'content'` uses them (refused when the page has none set). Every other
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
| schema markup (JSON-LD) | page builder → SEO panel → Schema markup → Add schema (form view, or AI) | its own object (`/schema-markup/schemas/save`, `ownerType:"funnel_page"`), rendered in `<head>` |
| button themes gallery (Quick Add → Buttons, 18 presets) | page builder → Quick Add → Buttons | presets of ordinary styles; 🔴 a theme's own radius class loses to the compiled rule (the "radius15" theme renders 5px) — set `styles` directly |
| brand-board palette colours (`var(--red)`) | page builder colour picker → Brand / Global colours | an API-composed page has no builder `:root` palette, so a palette var resolves to nothing there; the tool writes literal colours |
| column layout knobs (content direction, spacing, alignment, "same layout on mobile") | page builder → column → General | the builder writes them per column; widths are set with `widthPct` |
| saved assets: section / element templates, universal sections and elements, global sections | page builder → Save Section / Save Element; Quick Add → Saved Assets | builder-owned synced assets; inserting one is a drag in the builder |
| visitor geo-location | nothing to set | a runtime lookup (`GET /funnels/funnel/geo-location/` → the visitor's country) the builder uses to format prices |

What the builder does that a 2xx will not tell you (all measured live):

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
after which every later write is invisible in public with a 201 on each one. `build_funnel_page`
reports this on every run; read `publishState` before believing any public fetch.

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

**IN:** funnel / step / page creation, native-element authoring (all 57 leaf kinds build from
scratch), art direction, custom HTML, tracking code, page `meta`, public-path and domain routing,
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
