---
name: ghl-funnels-pages
description: Build GoHighLevel funnels and pages via the internal API — create funnels, add pages/steps, inject full-bleed custom HTML, set page- and funnel-level tracking code, configure SEO. Use when the user asks to build/create a GHL funnel, landing page, add custom HTML to a GHL page, set tracking or SEO on GHL funnels/pages.
---

# GHL Funnels & Pages Builder

Writes to a GHL account via the undocumented internal API.

## Before any write
1. Run BOTH gates in ${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md.
2. Auth: ${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md (capture, 1-hr expiry, re-auth contract).

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

## Recipes
See references/recipes.md. Never call an endpoint not documented there.
