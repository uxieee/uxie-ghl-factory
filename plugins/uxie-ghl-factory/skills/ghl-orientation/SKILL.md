---
name: ghl-orientation
description: GoHighLevel platform fluency — the GHL object model, terminology, which API surface (public MCP vs internal) fits a job, and cross-domain gotchas (calendars, forms, custom fields, tags, snapshots). Use at the start of any GHL task, when asked what a GHL term or object is (a snapshot, a template, a pipeline), when unsure where a thing lives in GHL, how an account's pieces connect (a map or diagram of them), or which API/tool can touch it.
---

# GHL Orientation

Read the reference that matches your gap; don't load all three by default:
- references/object-model.md — what exists in a sub-account and how it relates
- references/api-worlds.md — public vs internal API: capabilities, risk, choosing
- references/domain-gotchas.md — calendars, forms, custom fields, tags, snapshots

Ground rules for agents working GHL:
1. Recon before asking: read the account via the ghl MCP first.
2. Respect the two-API boundary: pick the rail per job from the rail ledger
   (the table below; the whole ledger is references/rail-ledger.md), and reach
   the internal rail only through this plugin's capability skills with their gates. Setting up, scoping or
   repairing the public rail is `ghl-public-mcp-setup`; the internal rail
   is /uxie-ghl-factory:internal-connect.
3. Per-client state lives in .ghl/<locationId>/ (brief.md = client context).
4. **When no typed tool obviously fits, SEARCH before you conclude it is impossible.**
   `search_endpoints` on the internal MCP covers every internal endpoint this
   project knows — hundreds, across every GHL surface — workflow builder, memberships and courses,
   conversation AI, voice AI, agent studio, funnels, calendars, media, billing —
   not workflows only. Each hit says what the endpoint does, whether a typed tool
   already covers it, and whether a location token has been PROVEN to reach it.
   `describe_endpoint` then hands you the exact call. This is also the first stop
   before any reverse-engineering: the answer is often already catalogued.

**Smart lists.** A smart list silently drops a filter the contacts screen will not apply. `check_smart_lists` (read)
audits the account's lists for those; `create_smart_list` (a write: confirm first) builds one whose filter the screen applies.

## Specialists

For design-level work, hand off to a specialist rather than building directly:
`ghl-workflow-specialist` (workflows), `ghl-pipeline-specialist` (pipelines), and
`ghl-funnels-pages` (funnels/pages) all recon, blueprint, and get explicit approval
before building — follow the specialist contract instead of duplicating it here.
**The AI products do not share a rail, and neither do the other dual-rail products.** The rail ledger records,
per job, what each rail does and which one the plugin routes to:

<!-- rail-ledger:summary -->
_generated from knowledge/catalog/rail-ledger.json — do not edit; the whole ledger is `ghl-orientation/references/rail-ledger.md`._

| Product | Jobs both rails serve | Decided | Routed today |
|---|---|---|---|
| workflows | read, create, edit, publish, delete, logs | none yet | internal |
| courses | read, create, edit, delete, enrol, bulk, logs | read: pool-internal | internal, public |
| conversation-ai | read, create, edit, delete | none yet | split, internal |
| voice-ai | read, create, edit, delete, logs | none yet | internal |
| knowledge-base | read, create, edit, delete | read: both | internal |
| agent-studio | read, create | none yet | internal |
| pipelines | read, create, edit, delete | read: both | split, public, internal |
| opportunities | read, create, edit, delete | none yet | public |
| forms | read | read: pool-internal | internal |
| funnel-redirects | read, create, edit, delete | none yet | internal |
| calendars | read, create, edit, delete | none yet | public |
| custom-fields | read, create, edit | read: both | public, split |
| custom-values | read, create, edit | read: both | public |
| tags | read, create | read: both | public, split |
| snapshots | read | none yet | internal |
| contact-enrolment | enrol | none yet | none |
| blogs | create, edit | none yet | none |
| email-templates | read, create | none yet | public |
| countdown-timers | read, use | none yet | internal |
<!-- /rail-ledger:summary -->

Conversation AI lists its bots on the internal rail (the public search leaves out flow-builder bots) and configures them
there too. Internal-only on Conversation AI: the per-contact AI switch (`/conversations-ai/employeeConfigs`), prompt
history, the routing table, and the whole 2026-09/10 wave — outbound agents (activation, CRM-event triggers, the
opener), AI Campaigns, rich replies, Claude/Gemini models, MCP servers, Build with AI, the new test panel and V2 flow
agents, live-proven on 2026-10-29/30 (`ghl-conversation-ai`). 🔴 Outbound activation, enabling a trigger, switching an
outbound-enabled agent to auto-pilot and starting an AI Campaign all text real contacts: the skill's confirm-before-live
list applies. Voice AI and Knowledge Base configure on the internal rail (`ghl-voice-ai`, `ghl-knowledge-base`).
Agent Studio's two rails held different agents on the sandbox (2026-10-29), so neither stands in for the other.

Endpoint maps and audit references still describe the internal AI routes; that is what those
endpoints do, and is separate from which rail to choose for a task.

**Before treating any surface as internal, search the public catalog first**
(`search_actions` on the `ghl` MCP): calendar availability schedules, custom-field
create/update/delete and lost-reason listing are all public and were rebuilt by hand against the
internal rail in one session because nobody looked. The internal rail is for what the public rail
cannot reach, and for the workflow builder.

**Surfaces the public rail does not reach at all**, so there is no choice to make:

| Surface | Skill |
|---|---|
| workflow builder | `create-ghl-workflow` (build/edit), `get-ghl-workflow-json` (export), `get-ghl-workflow-logs` (runtime), `ghl-workflow-fast-forward` |
| memberships & courses | `ghl-memberships` |
| **events** | `ghl-events` — ticketed/RSVP events, tickets, sessions, speakers, attendees, public registration |
| funnels & pages | `ghl-funnels-pages` |
| **blog comments** (per-blog-site comment settings, the admin comment reads, the `c-blog-comments` page element — 2026-10) | `ghl-funnels-pages` |
| knowledge bases | `ghl-knowledge-base` |
| Voice AI | `ghl-voice-ai` |
| **AI Studio** (the AI website builder, internally `vibe`) | `ghl-ai-studio` |
| **Managed Agents** ("Agent Studio" tab: subagents, Computer, memory, n8n import, triggers) — internal; create with `create_studio_agent`, edit by raw_request PUT | `ghl-conversation-ai` → `references/agent-studio.md` |
| **calendars: the Services and Rentals modules, appointment statuses, the module switch** (classic calendars and appointments ARE public — the same skill routes them) | `ghl-calendars` |

**AI Studio sites are NOT funnels or websites.** They are a separate collection with no overlap —
measured 2026-09-04: a location with 25 AI Studio projects and 9 live custom domains returned 12
funnels from `/funnels/funnel/list` and **zero** of the AI Studio slugs or domains. Querying the
wrong surface returns an empty list, which reads as "the site does not exist".

So when a request names a site — a domain, a slug, a name — and you do not already know which
surface owns it, call **`find_ghl_site` first**. AI Studio is also absent from the public rail
entirely: 0 hits for `vibe` or `ai studio` across all 1,207 documented v2/v3 operations.

## Whole-account health checks

There is currently **no audit command** — it was retired 2026-08-25 pending a redesign, and its
material is kept whole in `archive/audit-retired-2026-08-25/`. Diagnose surface-by-surface with
the specialist skills until it returns.
