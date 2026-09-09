---
name: ghl-funnels-pages
description: Build GoHighLevel funnels, pages and websites via the internal API — create the funnel and its steps, author page content from native elements (not just custom HTML), art-direct it with the compiled stylesheet, bind calendars and products, set tracking and SEO, attach a domain and fix the public path. Use when the user asks to build/create a GHL funnel, landing page, website, sales or booking funnel, to restyle one, to add custom HTML, or to set tracking, SEO or routing on GHL funnels/pages.
---

# GHL funnels, pages and websites

Writes to a GHL account through the undocumented internal API. Everything below was executed
against a live account and verified by reading the effect back; where something is unproven it says
so in those words.

## Before any write
1. Run BOTH gates in ${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md.
2. Auth: ${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md **§9** — the funnels rail.
   `/funnels/*` uses a **`token-id`** header, NOT `Authorization: Bearer`; §1 is the
   workflow-builder rail and its token is rejected here. §9.2 has the capture procedure
   (hook `fetch`/`XHR` BEFORE navigating — deep links to the funnels area 404, and a
   `location.reload()` wipes the hook). Short-lived, never stored. On a 401, re-capture via
   `uxie-ghl-factory:internal-connect` and carry on — do not stop to ask.

## Contract
Recon (read the existing funnels) → read the account brief (`.ghl/<locationId>/brief.md` if
present) → intake only what is missing → blueprint naming every page, its sections and its
bindings → **user approval** → build → verify each artifact by fetching the URL a visitor would
and asserting your own copy is in the response.

## The object model

```
funnel ──has many──▶ step ──has many──▶ page (CONTROL + split variations)
   │                   │                  │
   └──── one funnel_lookup row each ──────┘        (rows exist only once a domain is attached)
```

- You mint `step.id` (a uuid v4 client-side). The server mints `pageId`.
- A page document carries metadata only. **Content is not inline** — it lives behind
  `GET /funnels/builder/page/data?pageId=`.
- The content tree is **FLAT**: `section.elements[]` holds every node and `child[]` holds node
  **ids**, never nested objects. Section roots live in `metaData.child`.

## The build sequence

1. `POST /funnels/funnel/create` — `{locationId, name, type:"funnel"}`. **`url` is derived from
   `name`.** (The old "API-created funnels hang the UI on a spinner" warning did not reproduce and
   is retired; funnels created this way open fine and are fully editable.)
2. **Attach the domain now, before the steps** — `POST /funnels/funnel/update-settings`. Routing
   rows are stamped from the funnel path as it stands when they are minted, so steps created first
   get flat paths instead of nesting under the funnel.
3. `POST /funnels/funnel/create-step` — creates the step *and* its control page.
4. `POST /funnels/builder/autosave/{pageId}` — the content (recipe 4, and *Authoring* below).
5. `GET /funnels/builder/get-versions?pageId=` then `POST /funnels/builder/publish-version`.
6. Fetch the public URL and confirm your own content is in the response.

## Authoring page content

Two ways, and the second is usually the right one.

**Custom HTML** (recipe 4) — one `custom-code`/HTML element, full-bleed. Fast, and correct when the
user wants a bespoke page nobody will edit in the builder.

**Native elements** — 60 element kinds exist (a closed set); **51 of the 57 leaf kinds build from
scratch**, so a page can be authored as real, builder-editable nodes. `build_funnel_page` on the
internal MCP server does this and carries the guards below. See
[`references/authoring-and-design.md`](references/authoring-and-design.md) for the full contract:

- 🔴 **Every `extra` property a kind declares must be PRESENT.** The renderer reads
  `extra.<prop>.value` unguarded, so one absent property **500s the whole public page** while
  `autosave` answered `201`. Present-but-empty is fine; the empty SHAPE is per kind.
- 🔴 **`autosave` is a blind store.** It accepts an invented `meta`, a wrong enum and a missing
  property with the same `201`. A round trip through it proves persistence and nothing else.
- 🔴 **Enums are checked nowhere.** A button with `action: "goToNextStep"` stores fine and does
  nothing; the value is `go-to-next-funnel-step`.
- 🔴 Three keys whose absence 500s the page: `col.extra.bgImage` (an object), and
  `general.general.fontsToLoad` / `general.general.colors`.

## Art direction — the compiled stylesheet is the whole stylesheet

A page that renders is not a page that holds up. `section.general.sectionStyles` is not a set of
hooks; it is the section's entire stylesheet, keyed by node id, and anything CSS can express a
synthesised page can express. **Read
[`references/authoring-and-design.md`](references/authoring-and-design.md) before styling anything**
— it carries the duotone/blend trap, the CSS-grid override that buys asymmetric layout, the
`noBorder` `!important` collision, how to re-skin the bound calendar and order-form widgets through
their own CSS custom properties, and how to load real fonts.

🔴 **Verification is not done until the page has been opened in the BUILDER too.** A page can
render perfectly on its public URL and hang the editor on a loading spinner forever —
`settings.settings.background`, `node.element` and a correctly shaped `extra.icon` are read by the
builder and by nothing else. The reference has the shapes and the one-pass differential that finds
this class of defect.

🔴 **A page has TWO styling sources.** The builder canvas re-derives from each node's `styles`; the
PUBLIC renderer uses `sectionStyles`. Emit one and not the other and the page looks perfect in the
builder and renders naked in public, with no error anywhere.

## Routing, domains and the public URLs

**The public URL resolves from the `funnel_lookup` table, not from the page document's `url`.**
Funnel, step and page each get a row, and **all three serve** — they are aliases for the same page,
not competitors. Moving a path is three calls (recipe 10); the `PUT` is what moves the live route
and the `POST` only makes the page document agree.

Attach a domain with `POST /funnels/funnel/update-settings` carrying `domainId`. 🔴 It also
requires **`allowPaymentModeOption`** (boolean), which is not in the settings form's own payload —
omit it and the whole write is refused, so the domain silently does not attach. And it is a
**whole-settings write, not a patch**: empty strings ARE applied and DO clear, so read the funnel
first and fill every field you do not intend to change.

🔴 **Verifying a public page measures Cloudflare unless you defeat it.** `max-age=60`, `vary` on
`Accept-Encoding` only, and **the query string is not in the cache key** — `?cb=<random>` does not
bust it and a request-side `no-cache` is ignored. Read `cf-cache-status` on every sample; get a
fresh key from path SHAPE (matching is case-insensitive, so `/Alpha` is a distinct key serving the
same row) or by moving the row.

🔴 **`/preview/{pageId}` is not a verification route on a domained funnel** — it 301s to the first
step on one account and 404s on another, for pages serving fine publicly. Verify on the public URL.
On a funnel with *no* domain the preview route is all there is, and the first request after an
autosave can serve the PREVIOUS compile — poll until a freshly minted node id appears.

## Split tests

`POST /funnels/funnel/clone-control-page/` then `PUT /funnels/funnel/step/{funnelId}` with
`{pages:[control, variation], split:true, control_traffic:N}`. Both calls succeed and the state
reads back correctly.

🔴 **It routes nothing.** On a domained funnel with `control_traffic: 0` and both pages published
`live`, 43 genuine origin decisions all served the control, and the variation has **no routing
row** (`lookup/type/{variationPageId}` → 404), so there is no variation URL. Not proven impossible —
something the builder UI does was not reproduced and no split-arming endpoint exists to imitate —
but **do not tell a user their A/B test is running** off these two calls. Say it is configured and
unverified, or set it up in the UI.

## Bindings

- **Calendar** — a `calendar` element whose `extra.calendarId` is `{value, text, isTeamSelected}`.
- **Product** — binds to the **STEP**, not the page: `PUT /funnels/funnel/step/{funnelId}`. The
  funnel read nests under `data.steps`.
- **Order form** — `two-setp-order` (the platform's spelling) 500s without `step1`/`step2`; those
  objects carry the form's labels and checkout config and the renderer reads them unguarded.

## Scope
**IN:** funnel / step / page creation, native-element authoring, art direction, custom HTML,
tracking code, SEO, public-path and domain routing, calendar and product bindings, chat-widget
attach/detach, publishing.
**OUT:** pipelines (public API — use the ghl MCP server), workflow wiring (use
`create-ghl-workflow`). Store and blog pages ARE in scope now — the store kinds need a step of
`type: "store"` and the blog kinds a `blog-post` step of a `type: "blog"` funnel (installed from a
`blogs` template, since a blog container cannot yet be created directly).

## Never report a page as shipped off a `201`
State which of draft/live you verified and name the URL you fetched. Six of this surface's fifteen
documented silent failures are a `2xx` that changed nothing or broke the page.

## Recipes
[`references/recipes.md`](references/recipes.md). **Never WRITE through an endpoint that is not in
it** — every recipe exists because a write here has a trap. Reads are different: `search_endpoints`
on the internal MCP indexes every `/funnels/*` route the builder source calls, and
`describe_endpoint` hands you the `raw_request`. A write you discover that way goes through
`ghl-reverse-engineering` and into `recipes.md` first; it does not go straight to a client funnel.
