# ghl — GoHighLevel plugin for Claude Code

## What this is

`ghl` is a Claude Code plugin for working with GoHighLevel (GHL / HighLevel) sub-accounts. It bundles a hosted MCP server covering GHL's public API (1,207 actions across 83 categories), plus a set of skills and commands for the parts of GHL the public API doesn't reach — workflow export, workflow creation (draft-only), and funnel/page building — built against GHL's undocumented internal API, with explicit safety gates around that surface.

| Component | Name | What it does |
|---|---|---|
| MCP server | `ghl` | Public GHL API v2/v3 — search/execute across 1,207 actions (contacts, pipelines, calendars, conversations, etc.) |
| Skill | `get-ghl-workflow-json` | Read-only export of a workflow's raw JSON from the internal builder API |
| Skill | `create-ghl-workflow` | Creates/edits GHL workflows via the internal builder API (draft-only; publish path untested) |
| Skill | `ghl-funnels-pages` | Builds funnels/pages, custom HTML, tracking, and SEO via the internal API |
| Skill | `ghl-orientation` | GHL object model, terminology, and public-vs-internal API guidance for agents new to GHL |
| Skill | `ghl-workflow-specialist` | Designs and builds GHL workflows/automations — recons, blueprints, gets approval, then builds via `create-ghl-workflow` (draft-only) |
| Skill | `ghl-pipeline-specialist` | Designs, builds, or diagnoses GHL pipelines and stages via the public-API v3 pipeline actions (ToS-clean) |
| Skill | `ghl-audit-primitives` | Shared substrate for whole-account audits — the finding record schema, audit folder layout, impact-ranking rubric, and concurrency/throttle limits |
| Skill | `ghl-defect-catalog` | The defect lens for audits — per-surface rules for things that are wrong across workflows, pipelines, funnels, calendars, forms, ai-agents, messaging, and tracking |
| Skill | `ghl-opportunity-catalog` | The opportunity lens for audits — per-surface rules for what an account should be doing per its brief's ranked goals but isn't |
| Skill | `ghl-mermaid-map` | Renders the account's contact journey as a Mermaid flowchart from recon data — descriptive only, never findings or verdicts |
| Agent | `surface-auditor` | Audits exactly one GHL surface, read-only, running both the defect and opportunity lenses, and writes structured candidate findings (dispatched per-surface by `/uxie-ghl-factory:audit`) |
| Agent | `finding-verifier` | Adversarial critic that re-fetches cited evidence read-only and tries to refute each candidate finding, stamping confirmed/plausible/refuted (dispatched by `/uxie-ghl-factory:audit`) |
| Command | `/uxie-ghl-factory:setup` | First-run setup — prerequisites, token, MCP connection test, version check |
| Command | `/uxie-ghl-factory:brief` | Creates/updates a per-client account brief (`.ghl/<locationId>/brief.md`) via an MCP-informed interview |
| Command | `/uxie-ghl-factory:export-workflow` | Runs `get-ghl-workflow-json` for a given workflow |
| Command | `/uxie-ghl-factory:build-workflow` | Runs `ghl-workflow-specialist` for a given ask (draft-only) |
| Command | `/uxie-ghl-factory:build-funnel` | Runs `ghl-funnels-pages` for a given ask |
| Command | `/uxie-ghl-factory:pipeline` | Runs `ghl-pipeline-specialist` for a given ask |
| Command | `/uxie-ghl-factory:audit` | Runs a whole-account, **read-only** audit — dispatches `surface-auditor` across all 8 surfaces and `finding-verifier` per finding, producing a Mermaid system map and an impact-ranked report |

## Install

```
/plugin marketplace add uxieee/ghl-plugin
/plugin install ghl@uxieee
```

Then run `/uxie-ghl-factory:setup` to configure your token, verify the MCP connection, and see which features are available in your environment.

## Prerequisites

- **Node.js ≥18** (required by the plugin tooling).
- **Playwright MCP server**, for internal-API features only (`get-ghl-workflow-json`, `create-ghl-workflow`, `ghl-funnels-pages`). Without it, those three skills degrade — the public-API MCP and `ghl-orientation` still work fully.
- **A GHL account with admin access** to whichever sub-account(s) you point this at. Write-capable skills verify admin access to the target `locationId` before writing (see write-rails, below) — the plugin will refuse and explain rather than write to an account you don't administer.

## The two API worlds

GHL exposes two very different surfaces, and this plugin treats them differently on purpose:

- **Public API** — official, documented, stable, in-Terms-of-Service. This is what the bundled `ghl` MCP server talks to. It covers contacts, pipelines (fully writable), calendars, conversations, and most day-to-day GHL operations. `ghl-orientation` and `/uxie-ghl-factory:brief` work entirely through this surface.
- **Internal API** — undocumented, off-Terms-of-Service, and can change or break without notice. This is what `get-ghl-workflow-json` (read-only export), `create-ghl-workflow` (write, draft-only — never publishes), and `ghl-funnels-pages` (write) use, because the public API has no workflow-builder or funnel-builder endpoints at all.

This isn't hypothetical: GHL's internal-API auth already migrated once (2026-07, from a `token-id` header to `Authorization: Bearer`), and every skill that had captured the old scheme broke outright. The plugin is designed to fail safe when that happens again — write skills stop on a `401` instead of retry-looping, auth details live in one canonical doc (`docs/auth-jwt-capture.md`) so a future migration is a one-file fix, and every internal-API write passes an owned-account check plus a one-time Terms-of-Service disclosure (`docs/write-rails.md`) before it touches anything.

## Trust model

By default, this plugin routes your GHL requests through the plugin author's Cloudflare Worker, and that means trusting the author on two separate things, not just one:

- **Credential forwarding** — your GHL Private Integration Token is sent *through* the plugin author's Cloudflare Worker on every call. The author's infrastructure is in a position to see or misuse that token.
- **Tool/response trust** — the MCP server's tool descriptions and the responses it returns are also authored by the plugin author — a third party to you, the installer. Using this server means trusting that its tool metadata and results aren't manipulative or tampered with, the same way you'd scrutinize any third-party MCP server.

To remove **both** dependencies, self-host: deploy [`github.com/uxieee/ghl-mcp-server`](https://github.com/uxieee/ghl-mcp-server) yourself and set `GHL_MCP_URL` to your own Worker URL — then the author's infrastructure is out of the loop for both credential handling and tool/response trust.

`/uxie-ghl-factory:setup` shows this same notice on first run.

## Client data

Per-client state — account briefs, write-override logs, ToS acknowledgment — lives under `.ghl/<locationId>/` at your workspace root. This directory contains client PII and is **gitignored by default**. Keep it that way; do not commit or share `.ghl/` contents.

## Deprecations

If you previously installed the standalone `ghl-specialist` or `get-ghl-workflow-json` skills — either manually into `~/.claude/skills`, or via `npx @uxieee/agent-skills` — remove them now that you have this plugin:

- Having both installed causes **dueling triggers**: the standalone skill and this plugin's skill can both match the same request, with unpredictable results about which one runs.
- The standalone copies are **frozen** — they will not receive the next GHL auth migration fix, and will start failing (`401`s) the moment GHL changes the internal-API auth again, the same way they broke in 2026-07.

Uninstall the old copies from `~/.claude/skills` (and `~/.codex/skills` if applicable), then rely on this plugin going forward.
