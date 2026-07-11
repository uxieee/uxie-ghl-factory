# The Two API Worlds

GHL exposes two structurally different ways to touch an account. Almost
every design decision in this plugin — which skill to reach for, what's
safe to automate, what's fragile — comes down to knowing which world you're
in.

## PUBLIC API — `services.leadconnectorhq.com`

- **Auth:** a Private Integration Token (PIT) or OAuth Bearer token, issued
  through GHL's own developer/marketplace flow. Long-lived, official,
  user-authorized.
- **Status:** documented, versioned, in-Terms-of-Service. This is GHL's
  supported integration surface — the same one third-party apps in the
  Marketplace use.
- **Coverage (live, verified 2026-07-11 via this plugin's bundled MCP
  server's `list_categories`):** **1,207 actions across 83 categories.**
  Categories come in pairs — a legacy-shaped one (e.g. `contacts`) and a
  `-v3` one (e.g. `contacts-v3`) covering the newer API v3 surface
  (`Version` header `v3`, camelCase params). Prefer the `-v3` category when
  both exist; it's the actively-developed one. Full category list and
  per-category action counts: run `list_categories` on the bundled MCP
  server (`uxie-ghl-mcp`) — treat that live call as the source of truth over
  any number written in a doc, including this one.
- **What it covers well:** contacts, **opportunities/pipelines (full CRUD,
  including pipeline and stage create/update/delete —
  `opportunities-v3__create-pipeline` / `update-pipeline` /
  `delete-pipeline`, added 2026-06-26)**, calendars/appointments (mature,
  `calendars-v3` alone has 59 actions), invoices/estimates/products/store
  (the richest commerce surface), custom fields, custom values, tags (via
  contacts), conversations (message read/send, not bot config), locations
  (agency/sub-account CRUD), SaaS-mode operations, snapshots (list/inspect),
  Voice AI (full lifecycle — the most API-mature of the AI products),
  Conversation AI agents (CRUD on the agent object, under the
  `conversation-ai` category).
- **Known gaps (confirmed as of this catalog):** workflow **builder
  internals** — triggers, actions, branches, wait nodes (`workflows` /
  `workflows-v3` is a 1-action list-only category); funnel/page **builder**
  internals — page content, sections, publish control (`funnels`/
  `funnels-v3` are 7-action read/redirect-only categories); Conversation AI
  **bot configuration** — prompts, knowledge-base content, Flow Builder
  graphs (the agent object is public; its internals are not); Courses/
  Memberships CRUD beyond import; Communities (no public surface at all);
  free-form Payment Link generation; Document/Contract send. The MCP
  server's `search_actions` surfaces these gaps inline in its notes so an
  agent doesn't keep hunting for endpoints that don't exist.

**Correction to carry forward:** older material (including this plugin's
harvest source, `ghl-specialist`) describes pipeline/stage creation as a
public-API gap. **That is stale.** Pipeline and stage CRUD shipped to the
public v3 API on 2026-06-26 and is fully covered by the MCP server. Anything
still calling this a gap is wrong.

## INTERNAL API — `backend.leadconnectorhq.com`

- **Auth:** a short-lived JWT captured live out of a logged-in browser
  session (Playwright), scoped to the specific builder iframe origin it was
  issued for. Exact header format, capture procedure, claim structure, and
  expiry contract live **only** in
  `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` — do not look for or add
  auth format details anywhere else, including this file.
- **Status:** undocumented, unversioned (from a consumer's standpoint), and
  off-Terms-of-Service — it's the same traffic the GHL web app itself makes
  from your browser, replayed deliberately. GHL owes no compatibility
  guarantee here; it has already changed auth scheme once mid-project
  (`token-id` → `Authorization: Bearer`, 2026-07).
- **Fragility:** because it's reverse-engineered, not published, it can
  change or break without notice, and every write against it carries real
  risk (wrong account, ToS exposure, silent breakage on GHL's next
  release). This plugin's `docs/write-rails.md` imposes two mandatory gates
  (owned-account check, one-time ToS disclosure) on every internal-API
  write for exactly this reason.
- **What it's used for (because the public API has no equivalent):**
  workflow builder read (exporting a workflow's full JSON — triggers,
  actions, branches) and write (creating workflows via a compiled
  intermediate representation); funnel/page creation and full-bleed custom
  HTML injection, tracking code, and SEO settings at the page level.
- **Which plugin skills use it:**
  - `get-ghl-workflow-json` — **read-only** GET calls. No write gates
    required (still surfaces a lightweight ToS mention on first use in a
    workspace).
  - `create-ghl-workflow` — **write**. Both write-rails gates apply.
  - `ghl-funnels-pages` — **write**. Both write-rails gates apply.

## Choosing a surface for a job

Default to public. Reach for internal only when the job genuinely has no
public-API path:

| Job | Surface | Why |
|---|---|---|
| Read/write contacts, tags, custom fields/values | Public (MCP) | Fully covered |
| Create/update/delete a pipeline or its stages | Public (MCP) | Public v3, as of 2026-06-26 — do not use internal API or Playwright for this |
| Read/write opportunities | Public (MCP) | Fully covered |
| Book/list/update appointments, calendar config | Public (MCP) | Mature surface |
| Send/read messages in a conversation | Public (MCP) | Covered; bot config is not |
| Inspect a workflow's full trigger/action JSON | Internal, read-only | `get-ghl-workflow-json` — no public equivalent |
| Create/edit a workflow's structure | Internal, write | `create-ghl-workflow` — no public equivalent; write rails apply |
| Create a funnel, add a page, inject custom HTML | Internal, write | `ghl-funnels-pages` — no public equivalent; write rails apply |
| Configure a Conversation AI bot's prompt/KB | Neither — UI only | Not exposed on either surface today |
| Anything you're not sure has a public endpoint | Public (MCP) — check first | `search_actions` on the bundled MCP server before assuming a gap; the catalog changes (pipelines are a recent example of a "gap" closing) |

If in doubt and the public MCP genuinely doesn't cover it, that's the signal
to consider the internal-API capability skills — never Playwright-scrape or
JWT-replay a write path that the public API already supports.
