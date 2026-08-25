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
- **Coverage (live, verified 2026-08-24 via the `ghl` MCP server's
  `list_categories`):** **671 distinct operations across 45 categories.**
  Most endpoints are published twice — a legacy-shaped category (e.g.
  `contacts`) and a `-v3` one (e.g. `contacts-v3`) covering the newer API v3
  surface (`Version` header `v3`, camelCase params). Search returns **one row
  per operation** and names the other id, so you no longer have to pick; a
  `(+v3)` marker means the v3 twin exists. Prefer v3 when you call one
  directly; it's the actively-developed one. Full category list and
  per-category action counts: run `list_categories` on the `ghl` MCP
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

## INTERNAL API — `backend.leadconnectorhq.com` and `services.leadconnectorhq.com`

- **Auth:** a short-lived JWT captured live out of a logged-in browser
  session (Playwright), scoped to the specific builder iframe origin it was
  issued for. Exact header format, capture procedure, claim structure, and
  expiry contract live **only** in
  `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` — do not look for or add
  auth format details anywhere else, including this file.
- **Status:** undocumented, unversioned (from a consumer's standpoint), and
  unsupported — it's the same traffic the GHL web app itself makes from
  your browser, replayed deliberately. Inspecting your own account's traffic
  is permitted; what GHL does NOT owe is compatibility. It owes no guarantee
  here; it has already changed its auth scheme once mid-project,
  without notice — see `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` for
  the current format and migration history.
- **Fragility:** because it's reverse-engineered, not published, it can
  change or break without notice, and every write against it carries real
  risk (wrong account, ToS exposure, silent breakage on GHL's next
  release). This plugin's `docs/write-rails.md` imposes two mandatory gates
  (owned-account check, one-time ToS disclosure) on every internal-API
  write for exactly this reason.
- **What it's used for (because the public API has no equivalent):** the
  workflow builder (export, build, edit, publish, runtime logs, fast-forward);
  memberships and courses; events; funnels and pages; Voice AI behaviour;
  knowledge bases; the two internal-only corners of Conversation AI (the
  per-contact switch and prompt history); agency-level premium-feature and
  rebilling reads.
- **Which plugin skills use it:**
  - **read-only:** `get-ghl-workflow-json`, `get-ghl-workflow-logs`. No
    write gates (a lightweight ToS mention on first use in a workspace).
  - **write, both write-rails gates apply:** `create-ghl-workflow`,
    `ghl-workflow-fast-forward`, `ghl-memberships`, `ghl-events`,
    `ghl-funnels-pages`, `ghl-voice-ai`, `ghl-knowledge-base`, and the
    internal corners of `ghl-conversation-ai`.

### Finding an internal endpoint — the catalogue

The skills above are not the whole internal surface; they are the parts
somebody has built a gated path for. The whole surface is the **endpoint
catalogue** on `uxie-ghl-internal-mcp`, and it is the mirror of
`search_actions` on the public rail:

```
search_endpoints   { intent: "which workflows use a webhook action" }  → ranked stubs
describe_endpoint  { id: "<from the stub>" }                          → the exact call
```

Hundreds of rows across every product this project knows — workflow builder,
memberships and courses, events, funnels, conversation AI, voice AI, agent
studio, knowledge bases, calendars, media, billing — from four kinds of
evidence: mined from GHL's own recovered front-end source, transcribed into
the corpus from live traffic, and adopted from what the shipped tools call.

A stub tells you the four things that decide what to do next:

| field | what it decides |
|---|---|
| `coveredBy` | a typed tool already wraps this — **call that**, not `raw_request`. It carries the required query switches, the cursor walk and the read-back |
| `kind` | `read` / `write` / `destructive` — what the row DOES, curated where the method alone would mislead (`run-single-action` is named like a read and sends real messages) |
| `reach` | `proven` = a location token has reached it live · `refused` = it 401s from this rail, do not spend a turn · `source-only` = the front-end calls it, nobody here has |
| `note` | the one trap worth knowing before you choose it |

`describe_endpoint` then hands you `callWith` — a copy-pasteable `raw_request`
path with the prefix folded in — **or says plainly that `raw_request` cannot
make the call** (multipart, blob, SSE, a header it has no way to set).

Two rules hold whatever you find:

- **A catalogued row is a path, not a proven behaviour.** It proves a GHL
  front-end calls it. Required parameters, allowed values and what a write
  actually does are what `ghl-reverse-engineering` establishes — and a write
  discovered here still goes through `raw_request`'s confirm gate and the
  write rails. The typed tools exist because writes have traps.
- **Search before you conclude "impossible", and before you open a
  browser.** A capture session that rediscovers a catalogued row costs an
  hour to learn nothing.

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
| Read or configure a Conversation AI agent | Public (MCP) | `ghl-conversation-ai` — same objects on both rails, public is richer |
| Silence the AI for one contact; roll a prompt back | Internal | `ghl-conversation-ai` — the two corners with no public equivalent |
| Build or edit a knowledge base's content | Internal, write | `ghl-knowledge-base` — 5 of 9 source types have no public path |
| Configure what a Voice AI agent DOES (actions, booking, transfer) | Internal, write | `ghl-voice-ai` — public sees how it sounds, not what it does |
| Build a course, enrol a member, issue a certificate | Internal, write | `ghl-memberships` — no public equivalent beyond import |
| Create an event, tickets, sessions, read attendees | Internal, write | `ghl-events` — no public events surface at all |
| Read what a workflow actually DID (logs, enrolments, stuck contacts) | Internal, read-only | `get-ghl-workflow-logs` |
| Anything you're not sure has a public endpoint | Public (MCP) — check first | `search_actions` on the `ghl` MCP server before assuming a gap; the catalog changes (pipelines are a recent example of a "gap" closing) |
| Anything you're not sure has an INTERNAL endpoint | Internal — check first | `search_endpoints` on `uxie-ghl-internal-mcp` before assuming it needs reverse-engineering. The stub says whether a typed tool covers it and whether a location token reaches it |

If in doubt and the public MCP genuinely doesn't cover it, that's the signal
to consider the internal rail — and the first move there is
`search_endpoints`, not a browser. Never Playwright-scrape or JWT-replay a
write path that the public API already supports.
