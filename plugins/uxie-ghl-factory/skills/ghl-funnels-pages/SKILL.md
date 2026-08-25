---
name: ghl-funnels-pages
description: Build GoHighLevel funnels and pages via the internal API — create funnels, add pages/steps, inject full-bleed custom HTML, set page- and funnel-level tracking code, configure SEO. Use when the user asks to build/create a GHL funnel, landing page, add custom HTML to a GHL page, set tracking or SEO on GHL funnels/pages.
---

# GHL Funnels & Pages Builder

Writes to a GHL account via the undocumented internal API.

## Before any write
1. Run BOTH gates in ${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md.
2. Auth: ${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md **§9** — the funnels rail.
   `/funnels/*` uses a **`token-id`** header, NOT `Authorization: Bearer`; §1 is the
   workflow-builder rail and its token is rejected here. §9.2 has the capture procedure
   (hook `fetch`/`XHR` BEFORE navigating — deep links to the funnels area 404, and a
   `location.reload()` wipes the hook). Short-lived, never stored, re-capture on 401.

## Contract (uniform specialist contract)
Recon (MCP read of existing funnels) → read the account brief
(.ghl/<locationId>/brief.md if present) → intake only what's missing →
blueprint with explicit page list + HTML/tracking plan → user approval →
funnel container (API or UI) →
execute via references/recipes.md → verify each artifact with its recipe's
verification GET **and the public URL**.

## The create sequence — all six steps, in order
Adding a step + page to an existing funnel **works end to end via the API**.
Live-proven 2026-08-10 on a client funnel with a real custom domain attached.

1. `POST /funnels/funnel/create-step` — creates the page (recipe 2)
2. `POST /funnels/builder/autosave/{pageId}` — writes the draft (recipe 4)
3. `GET  /funnels/builder/get-versions?pageId=` — get the version id (recipe 7)
4. `POST /funnels/builder/publish-version` — draft → live (recipe 7)
5. **Set the public path — THREE calls** (recipe 10):
   `GET /funnels/lookup/type/{pageId}` → `PUT /funnels/lookup/{lookupId}` `{path}`
   → `POST /funnels/funnel/funnel-page/{pageId}` `{url,name}`
6. Fetch the **public URL** and confirm your content

**Step 5 is not optional, and it is not one call.** The public URL resolves from the
`funnel_lookup` routing table, NOT from the page doc — so the POST alone updates the
page doc while the live URL keeps serving the old path, with nothing in the response to
tell you. See the routing model below.

🟢 **This CORRECTS the previous "page creation via the API is broken" guidance, which
was wrong.** The old `autosave` 422 was a plain **body-shape** error, and its message
said so (`pageData should not be empty, pageVersion should not be empty`). `autosave`
does not accept a `page/data` response directly — it wants the recipe-4 envelope
(`{funnelId, pageData:{sections,settings,general,pageStyles,trackingCode,
fontsForPreview,popups,popupsList}, pageVersion, pageType, manualSave, integrations}`).
Echoing `page/data` raw fails because **the wrapper is missing, not because the page is
malformed**. Wrapped, it returns `201` on a page created seconds earlier by `create-step`.

🔴 **A step has TWO paths, and the PAGE path is the one the public URL resolves.**
- the **step** has a `url`, set in the `create-step` payload;
- the **page** (the CONTROL variation) has its own separate **Path**, edited in the UI
  via the gear on the control thumbnail → "Edit page details".

`create-step` **auto-appends `-page`** to the page path. A step created with
`url: "followup"` yields a page path of `/followup-page`, and `/followup` **301s to the
funnel's first step**. Corroborated on the same funnel: the attendance step's `url` is
`/attend-pagee` while its page path is `/attend` — and `/attend` is the URL that serves.
Fix with recipe 10. A correct build that skips this looks exactly like a broken publish.

⚠️ **`funnel/create` itself is still unproven.** The 2026-07-25 observation stands and
was not re-tested: a funnel created by `POST /funnels/funnel/create` hung the UI detail
view on a spinner indefinitely. Everything proven on 2026-08-10 was done inside an
existing, healthy, UI-created funnel. **Create the FUNNEL in the UI; create its STEPS
and PAGES via the API.** Recipes §9 has the click-path.

Also: `funnel/update-settings` **silently ignores empty strings**, so it can set a field
but never clear one, and a `201` from it is not evidence the payload applied — verify
with the fetch GET.

## Scope
IN: **funnel/step/page creation**, page content writes, full-bleed HTML injection,
tracking code, public-path (routing) updates, SEO settings, publish.
OUT: pipelines (public API — use the ghl MCP server), workflow wiring
(use create-ghl-workflow), domain attachment (untested — refuse and say why),
chat-widget attachment (funnel Settings tab in the UI — `update-settings` cannot do it).

⚠️ **Draft vs live.** Every content write here saves a **DRAFT**: `autosave` → `201`
means the draft took, while the **public URL keeps serving the old page**. Publishing is
a SEPARATE call — `POST /funnels/builder/publish-version` with `{pageId, versionId,
userId}` (recipe 7: it flips the version `pageType` from `draft` to `live`). Publishing
targets a **version**, so read `get-versions` first.

Serving from the public URL is now **confirmed** on a domained funnel (2026-08-10) —
conditional on the page path being right (recipe 10). The 2026-07-19 "no domain
attached, serving not confirmed" caveat is closed.

🔴 **`/preview/{pageId}` is NOT a usable verification route on a domained funnel.** It
**301s to the funnel's first step** on one account and **404s** on another (both GROM AU
domains), for pages that were serving fine publicly — so a preview check reports a false
failure. **Verify on the public URL**, not the preview.

Never report a page as shipped off a `201` alone. State which of draft/live you actually
verified, and name the URL you fetched.

## Recipes
See references/recipes.md. **Never WRITE through an endpoint that is not in it** — every recipe
exists because a write here has a trap: draft vs live, the three-call public path, a
`201` from `update-settings` that applied nothing. Reads are different. `search_endpoints` on the
internal MCP indexes every `/funnels/*` route the builder source calls, and `describe_endpoint`
hands you the `raw_request`. A write you discover that way goes through `ghl-reverse-engineering`
and into recipes.md first; it does not go straight to a client funnel.
