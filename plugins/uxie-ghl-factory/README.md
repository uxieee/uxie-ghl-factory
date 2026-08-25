# ghl — GoHighLevel plugin for Claude Code & Codex

## What this is

`ghl` is a plugin for working with GoHighLevel (GHL / HighLevel) sub-accounts in **Claude Code** or **Codex**. It provides a local MCP server covering GHL's public API (671 distinct operations across 83 categories, run from npm so your token never leaves your machine) — set up **per project** so each client folder is scoped to that client — plus a set of skills and commands for the parts of GHL the public API doesn't reach — workflow export, workflow creation (draft-only), funnel/page building, memberships/course building, AI-agent building, and fast-forwarding test enrollments — built against GHL's undocumented internal API, with explicit safety gates around that surface. Those internal-API engines are also available as a **per-project local MCP server** (`uxie-ghl-internal-mcp`, set up per folder with `/uxie-ghl-factory:internal-connect`), so an agent can call them as confirmation-gated tools instead of running the skills' scripts — see [Internal-API MCP server](#internal-api-mcp-server).

> **Codex note:** Codex plugins load **skills only** — not slash commands or subagents — so in Codex the `/uxie-ghl-factory:*` commands and the multi-agent `/uxie-ghl-factory:audit` are unavailable; invoke the skills directly instead, and configure the MCP server yourself. See [Install](#install) and [Using in Codex](#using-in-codex).

| Component | Name | What it does |
|---|---|---|
| MCP server (per-project) | `ghl` | Public GHL API v2/v3 — search/describe/execute across 671 distinct operations (contacts, pipelines, calendars, conversations, etc.). Runs locally from npm; added per folder via `/uxie-ghl-factory:setup` and scoped to that client with `/uxie-ghl-factory:public-scope`; the plugin registers nothing globally |
| MCP server (per-project) | `uxie-ghl-internal-mcp` | GHL **internal** API — 41 stdio tools that execute the internal-API engines (build/edit/publish workflows, fast-forward, memberships, AI agents) behind confirmation gates and round-trip verification. Set up per folder with `/uxie-ghl-factory:internal-connect` (each folder = its own account token). See [`mcp-internal/README.md`](mcp-internal/README.md) |
| Skill | `get-ghl-workflow-json` | Read-only export of a workflow's raw JSON from the internal builder API |
| Skill | `get-ghl-workflow-logs` | Read-only capture of a workflow's runtime — execution logs, enrollment history, per-step contact counts — from the internal builder API |
| Skill | `ghl-workflow-fast-forward` | Fast-forwards contacts parked at a workflow WAIT step to the next step via the internal API — drives multi-day wait ladders to completion in minutes for end-to-end testing (write) |
| Skill | `create-ghl-workflow` | Creates/edits GHL workflows via the internal builder API (draft-only; publish path untested) |
| Skill | `ghl-conversation-ai` / `ghl-voice-ai` | Designs and builds GHL's AI products — Conversation AI (public rail) (chat), Voice AI (phone), Agent Studio (super agents) — plus rich-text Knowledge Base content, via the internal API (write) |
| Skill | `ghl-funnels-pages` | Builds funnels/pages, custom HTML, tracking, and SEO via the internal API |
| Skill | `ghl-memberships` | Builds courses/membership portals via the internal API — lessons (text/video/audio/PDF/embed), quizzes with questions, assignments, offers, themes, credentials, enrollment, progress, submissions, communities. Ships a spec→course compiler and a **live conformance suite** (21/0/4) |
| Skill | `ghl-orientation` | GHL object model, terminology, and public-vs-internal API guidance for agents new to GHL |
| Skill | `ghl-workflow-specialist` | Designs and builds GHL workflows/automations — recons, blueprints, gets approval, then builds via `create-ghl-workflow` (draft-only) |
| Skill | `ghl-pipeline-specialist` | Designs, builds, or diagnoses GHL pipelines and stages via the public-API v3 pipeline actions (ToS-clean) |
| Skill | `ghl-reverse-engineering` | Captures GHL's internal (browser/backend) APIs with Playwright — endpoints, payloads, object schemas — to understand and automate config the public API doesn't expose |
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
| Command | `/uxie-ghl-factory:build-course` | Runs `ghl-memberships` for a given ask |
| Command | `/uxie-ghl-factory:pipeline` | Runs `ghl-pipeline-specialist` for a given ask |
| Command | `/uxie-ghl-factory:audit` | Runs a whole-account, **read-only** audit — dispatches `surface-auditor` across **every GHL surface** (8 deep-catalog + baseline coverage of the rest) and `finding-verifier` per finding, producing a Mermaid system map and an impact-ranked report |

## Install

**Claude Code:**

```
/plugin marketplace add uxieee/uxie-ghl-factory
/plugin install uxie-ghl-factory@uxieee
```

Then run `/uxie-ghl-factory:setup` to configure your token, verify the MCP connection, and see which features are available in your environment.

**Codex:**

```
codex plugin marketplace add uxieee/uxie-ghl-factory
codex plugin add uxie-ghl-factory@uxieee
```

The Codex build ships the **skills only** and does not bundle the MCP server — set it up yourself (one-time) per [Using in Codex](#using-in-codex).

## Using in Codex

Codex plugins load **skills, MCP servers, hooks, and apps** — but not slash commands or subagents. Two consequences:

- **No slash commands.** In Codex there are no `/uxie-ghl-factory:*` commands — invoke the underlying skills directly (e.g. *"use `create-ghl-workflow` to build…"*, *"use `ghl-workflow-specialist` to design…"*, *"use `get-ghl-workflow-json` to export…"*). Build / export / logs / pipeline / funnel all live in skills, so you keep that functionality.
- **No multi-agent audit.** `/uxie-ghl-factory:audit` dispatches the `surface-auditor` and `finding-verifier` subagents, which Codex can't load. The audit *knowledge* skills (`ghl-audit-primitives`, `ghl-defect-catalog`, `ghl-opportunity-catalog`, `ghl-mermaid-map`) still load and can guide a manual audit.

**MCP server (configure once).** Add the GHL MCP to `~/.codex/config.toml`:

```toml
[mcp_servers.ghl]
command = "npx"
args = ["-y", "@uxieee/ghl-mcp"]
env = { GHL_ACCOUNTS_FILE = "/Users/you/.ghl/accounts.json" }
```

Set the accounts file up first with `npx -y @uxieee/ghl-mcp accounts add` (once per
sub-account). Codex infers the transport from `command`, and forwards only a fixed set of
parent environment variables to a stdio server, so `GHL_ACCOUNTS_FILE` must be named in `env`
as above rather than exported in your shell.

For a single sub-account, `env = { GHL_API_TOKEN = "pit-…" }` works instead and needs no file.

`~/.codex/config.toml` is global, so Codex has no per-project scoping. Give each client its
own named server, each narrowed to that client's sub-accounts:

```toml
[mcp_servers.ghl_acme]
command = "npx"
args = ["-y", "@uxieee/ghl-mcp"]
env = { GHL_ACCOUNTS_FILE = "/Users/you/.ghl/accounts.json", GHL_ALLOWED_LOCATIONS = "<id>" }
```

Without it, the skills that only *reason* about GHL still load, but anything that *calls* the API needs this server. The server runs locally, so your token goes only to GoHighLevel — see [Trust model](#trust-model).

## Internal-API MCP server

The internal-API engines that power the workflow, memberships, and AI-agent skills are also exposed as a **local stdio MCP server**, `uxie-ghl-internal-mcp` — 17 tools that let an agent *execute* those engines directly, with the same confirmation gates and round-trip verification the skills use. It ships as a self-contained bundle that boots with just `node` (no `npm install`).

It is **per-project, not global.** You set it up in each GHL folder you work in with one command:

```
/uxie-ghl-factory:internal-connect
```

That does everything for the current folder: registers a **project-scoped** server (via `claude mcp add --scope local`, pointing at a stable launcher so plugin updates don't break it), then the agent opens a browser, **you log into GHL**, and it captures that account's token to a project-local file (`.ghl/`, gitignored) — you never handle a token. So each client folder gets **its own server and its own account credential**; nothing is connected in folders where you didn't run it. (First time in a folder, Claude Code shows a one-time workspace-trust prompt.)

JWTs last ~1 hour; when a tool returns `TOKEN_EXPIRED` the agent re-runs `/connect` automatically (you just log in again) — no restart, no re-registration.

The wrapped skills prefer these tools when the server is present and fall back to their own scripts when it isn't (e.g. Codex, which uses its own config — see `mcp-internal/README.md`). The full tool list, credential model, and per-tool live-proof ledger are in [`mcp-internal/README.md`](mcp-internal/README.md).

## Prerequisites

- **Node.js ≥18** (required by the plugin tooling).
- **Playwright MCP server**, for internal-API features only (`get-ghl-workflow-json`, `get-ghl-workflow-logs`, `create-ghl-workflow`, `ghl-workflow-fast-forward`, `ghl-funnels-pages`, `ghl-memberships`, `ghl-conversation-ai` / `ghl-voice-ai`, and the `uxie-ghl-internal-mcp` MCP server) — the agent uses it to capture the internal-API JWT during `/uxie-ghl-factory:internal-connect`. Without it, those skills degrade — the public-API MCP and `ghl-orientation` still work fully.
- **A GHL account with admin access** to whichever sub-account(s) you point this at. Write-capable skills verify admin access to the target `locationId` before writing (see write-rails, below) — the plugin will refuse and explain rather than write to an account you don't administer.

## The two API worlds

GHL exposes two very different surfaces, and this plugin treats them differently on purpose:

- **Public API** — official, documented, stable, in-Terms-of-Service. This is what the bundled `ghl` MCP server talks to. It covers contacts, pipelines (fully writable), calendars, conversations, and most day-to-day GHL operations. `ghl-orientation` and `/uxie-ghl-factory:brief` work entirely through this surface.
- **Internal API** — undocumented, off-Terms-of-Service, and can change or break without notice. This is what `get-ghl-workflow-json` (read-only export), `get-ghl-workflow-logs` (read-only runtime capture), `create-ghl-workflow` (write, draft-only — never publishes), `ghl-workflow-fast-forward` (write), `ghl-funnels-pages` (write), `ghl-memberships` (write), and `ghl-conversation-ai` / `ghl-voice-ai` (write) use, because the public API has no workflow-builder, funnel-builder, membership, or AI-agent endpoints at all. The per-project `uxie-ghl-internal-mcp` MCP server executes these same engines as tools (see [Internal-API MCP server](#internal-api-mcp-server)).

This isn't hypothetical: GHL's internal-API auth already migrated once (2026-07, from a `token-id` header to `Authorization: Bearer`), and every skill that had captured the old scheme broke outright. The plugin is designed to fail safe when that happens again — write skills stop on a `401` instead of retry-looping, auth details live in one canonical doc (`docs/auth-jwt-capture.md`) so a future migration is a one-file fix, and every internal-API write passes an owned-account check plus a one-time Terms-of-Service disclosure (`docs/write-rails.md`) before it touches anything.

## Trust model

The public GHL rail runs **on your own machine** as an npm package (`@uxieee/ghl-mcp`), started over stdio. That leaves one thing to trust instead of two:

- **Credentials stay local.** Your Private Integration Token is read from a file on your machine and sent only to GoHighLevel. It does not pass through the plugin author's infrastructure. (Earlier versions routed calls through the author's Cloudflare Worker, which did see the token on every call. That Worker is being retired — if you are still on it, `/uxie-ghl-factory:setup` migrates you.)
- **Tool and response trust remains.** The MCP server's tool descriptions and the responses it returns are written by a third party to you, the installer. Running it means trusting that its tool metadata and results are not manipulative or tampered with, the same scrutiny you would give any third-party MCP server. The source is [`github.com/uxieee/uxie-ghl-mcp-server`](https://github.com/uxieee/uxie-ghl-mcp-server) and the npm package is published from it, so you can read what you are running.

The **internal** rail is a different trust question, covered in `docs/write-rails.md`: it uses your own browser session's token, held per project, and its writes go through this plugin's gates.

`/uxie-ghl-factory:setup` shows this same notice on first run.

## Client data

Per-client state — account briefs, write-override logs, ToS acknowledgment — lives under `.ghl/<locationId>/` at your workspace root. This directory contains client PII and is **gitignored by default**. Keep it that way; do not commit or share `.ghl/` contents.

## Deprecations

If you previously installed the standalone `ghl-specialist` or `get-ghl-workflow-json` skills — either manually into `~/.claude/skills`, or via `npx @uxieee/agent-skills` — remove them now that you have this plugin:

- Having both installed causes **dueling triggers**: the standalone skill and this plugin's skill can both match the same request, with unpredictable results about which one runs.
- The standalone copies are **frozen** — they will not receive the next GHL auth migration fix, and will start failing (`401`s) the moment GHL changes the internal-API auth again, the same way they broke in 2026-07.

Uninstall the old copies from `~/.claude/skills` (and `~/.codex/skills` if applicable), then rely on this plugin going forward.
