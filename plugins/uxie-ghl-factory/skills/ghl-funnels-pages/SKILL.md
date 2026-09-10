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
| 1 | create the funnel | **no tool** — `POST /funnels/funnel/create` via `raw_request` (recipe 1) |
| 2 | attach the domain **before creating steps** | **no tool** — recipe 11. Rows are stamped from the funnel path as it stands when minted, so steps created first get flat paths. 🔴 Run **`audit_site`** first: a path is held per DOMAIN across every document on the location, the attach renames a collision silently and arbitrarily, and routing never follows a later step rename |
| 3 | create each step (mints its page) | **no tool** — recipe 2. 🔴 Pass your own `step.id` |
| 4 | author + publish the page | **`build_funnel_page`** — composes, validates, writes, reads back, and publishes when you pass `publish:true` |
| 5 | fix the public path | **no tool** — recipe 10, and it is **three calls** |
| 6 | verify | fetch the URL a visitor would, and read the publish state |
| 7 | audit before handing over | **`audit_site`** — read-only |

Only steps 4 and 7 have typed tools. Everything else is `raw_request` against a recipe.

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

🔴 Measuring a public page measures **Cloudflare** unless you defeat it: `max-age=60`, and the query
string is **not** in the cache key, so `?cb=` busts nothing and request-side `no-cache` is ignored.
Read `cf-cache-status` on every sample; get a fresh key by varying the path's CASING (matching is
case-insensitive, so `/Alpha` is a distinct key onto the same row).

## Scope

**IN:** funnel / step / page creation, native-element authoring (all 57 leaf kinds build from
scratch), art direction, custom HTML, tracking code, page `meta`, public-path and domain routing,
calendar and product bindings, chat widget, split tests, publishing, site audit. Store pages need a
step of `type:"store"`; blog pages need a `blog-post` step in a `type:"blog"` funnel, which comes
from a `blogs` template load.

**OUT:** pipelines (public API — use the ghl MCP server), workflow wiring (use
`create-ghl-workflow`), form and calendar *authoring* (use `ghl-forms`; this skill only binds and
audits them).

**Never WRITE through an endpoint that is not in `recipes.md`** — every recipe exists because a
write here has a trap. Reads are different: `search_endpoints` indexes every `/funnels/*` route and
`describe_endpoint` hands you the call. A write you discover that way goes through
`ghl-reverse-engineering` and into `recipes.md` first, not straight at a client funnel.
