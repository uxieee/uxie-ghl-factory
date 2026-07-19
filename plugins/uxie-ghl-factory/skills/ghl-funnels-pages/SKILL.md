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
execute via references/recipes.md → verify each artifact with its recipe's
verification GET.

## Scope
IN: funnels, pages/steps, full-bleed HTML injection, tracking code, SEO settings.
OUT: pipelines (public API — use the ghl MCP server), workflow wiring
(use create-ghl-workflow), publishing/domain attachment (untested — refuse and say why).

⚠️ Because publishing is OUT: every write here saves a **DRAFT**. `autosave` → `201`
means the draft took and `/preview/{pageId}` serves it, while the **public URL keeps
serving the old page** until a human clicks Publish in the builder UI (confirmed live —
not CDN cache). Never report a page as shipped off a `201` or a green preview check.
Say which of draft/public you verified, and name the Publish click as a remaining step.
See recipes.md §0.

## Recipes
See references/recipes.md. Never call an endpoint not documented there.
