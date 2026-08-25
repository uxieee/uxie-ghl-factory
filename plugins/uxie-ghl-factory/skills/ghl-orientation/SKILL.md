---
name: ghl-orientation
description: GoHighLevel platform fluency — the GHL object model, terminology, which API surface (public MCP vs internal) fits a job, and cross-domain gotchas (calendars, forms, custom fields, tags, snapshots). Use at the start of any GHL task, when unsure what a GHL term means, where a thing lives in GHL, or which API/tool can touch it.
---

# GHL Orientation

Read the reference that matches your gap; don't load all three by default:
- references/object-model.md — what exists in a sub-account and how it relates
- references/api-worlds.md — public vs internal API: capabilities, risk, choosing
- references/domain-gotchas.md — calendars, forms, custom fields, tags, snapshots

Ground rules for agents working GHL:
1. Recon before asking: read the account via the ghl MCP first.
2. Respect the two-API boundary: prefer public; internal only via this
   plugin's capability skills with their gates. Setting up, scoping or
   repairing the public rail is `ghl-public-mcp-setup`; the internal rail
   is /uxie-ghl-factory:internal-connect.
3. Per-client state lives in .ghl/<locationId>/ (brief.md = client context).
4. **When no typed tool obviously fits, SEARCH before you conclude it is impossible.**
   `search_endpoints` on the internal MCP covers 620 endpoints across every GHL
   surface this project knows — workflow builder, memberships and courses,
   conversation AI, voice AI, agent studio, funnels, calendars, media, billing —
   not workflows only. Each hit says what the endpoint does, whether a typed tool
   already covers it, and whether a location token has been PROVEN to reach it.
   `describe_endpoint` then hands you the exact call. This is also the first stop
   before any reverse-engineering: the answer is often already catalogued.

## Specialists

For design-level work, hand off to a specialist rather than building directly:
`ghl-workflow-specialist` (workflows), `ghl-pipeline-specialist` (pipelines), and
`ghl-funnels-pages` (funnels/pages) all recon, blueprint, and get explicit approval
before building — follow the specialist contract instead of duplicating it here.
**The AI products do not share a rail.** Measured 2026-08-25 across 17 sub-accounts:

| Product | Rail | Skill | Why |
|---|---|---|---|
| **Conversation AI** (chat "AI Employee") | **public** | `ghl-conversation-ai` | same objects on both rails; public returns 36 fields to internal's 39 and carries `fullPrompt` / `instructions` / `personality` that internal lacks. 17/17 accounts returned 200, every agent with its prompt. |
| **Voice AI** (phone agent) | **internal** | `ghl-voice-ai` | public exposes 27 fields, internal 51 — the 24-field gap is the whole behaviour layer (actions, booking, KB, LLM, MCP servers). |
| **Knowledge Base** | **internal** | `ghl-knowledge-base` | 5 of 9 source types have no public equivalent, `rich_text` among them. |
| **Agent Studio** | — | — | out of scope. |

The one internal exception on Conversation AI is the **per-contact AI switch**
(`/conversations-ai/employeeConfigs`), which has no public equivalent.

Endpoint maps and audit references still describe the internal AI routes; that is what those
endpoints do, and is separate from which rail to choose for a task.

**Surfaces the public rail does not reach at all**, so there is no choice to make:

| Surface | Skill |
|---|---|
| workflow builder | `create-ghl-workflow` (build/edit), `get-ghl-workflow-json` (export), `get-ghl-workflow-logs` (runtime), `ghl-workflow-fast-forward` |
| memberships & courses | `ghl-memberships` |
| **events** | `ghl-events` — ticketed/RSVP events, tickets, sessions, speakers, attendees, public registration |
| funnels & pages | `ghl-funnels-pages` |
| knowledge bases | `ghl-knowledge-base` |
| Voice AI | `ghl-voice-ai` |

## Whole-account health checks

There is currently **no audit command** — it was retired 2026-08-25 pending a redesign, and its
material is kept whole in `archive/audit-retired-2026-08-25/`. Diagnose surface-by-surface with
the specialist skills until it returns.
