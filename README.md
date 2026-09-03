# uxie-ghl-factory

A plugin that turns **Claude Code** — or **Codex** — into a competent **GoHighLevel operator**: it
reads a sub-account, designs and builds workflows, courses, funnels, events, pipelines and AI
agents, and reaches GHL's own internal APIs when the public one falls short.

**This is not an MCP wrapper around an API.** The API access is the smallest part. The plugin
pairs it with GHL-specific judgement — a persisted per-client brief, specialist architecture
skills, a compiler with 147 enforced rules, read-back verification after every write, and
draft-first discipline — so the agent operates the account instead of narrating where to click.

## What you can do with it

Point it at a sub-account, then ask in plain language:

- *"Read this account and tell me how it's set up — what's automated, what's missing."*
- *"Design and build a 7-day lead-nurture workflow for Facebook leads."*
- *"Contacts are getting stuck in this workflow — figure out where and why."*
- *"Build this course from my curriculum doc — chapters, drip, quizzes, the offer."*
- *"Create a pipeline for our setter process and wire the stage moves."*
- *"Export this workflow's raw JSON before we touch it."*
- *"Build a Voice AI agent for this clinic."*

You don't pick tools or skills by hand — the request routes itself. The skills exist so the agent
knows *how* GHL actually behaves (and when not to act), not as a menu you have to learn.

## Quick start

**Claude Code**

```
/plugin marketplace add uxieee/uxie-ghl-factory
/plugin install uxie-ghl-factory@uxieee
```

Then `/uxie-ghl-factory:setup` (public rail: token, connection test), and — only if you need the
internal rail — `/uxie-ghl-factory:internal-connect` (the agent drives the browser; you just log
in).

**Codex**

```
codex plugin marketplace add uxieee/uxie-ghl-factory
codex plugin add uxie-ghl-factory@uxieee
```

The Codex build ships the **skills only**; configure the MCP servers once yourself — see
**[Using in Codex](#using-in-codex)**.

## A normal session

```
You:    /uxie-ghl-factory:brief          ← once per client: business, offer, goals — persisted

You:    "We're a cosmetic clinic. Facebook leads need a workflow that
         gets them to book a consultation."

Agent:  reads the brief · inspects existing workflows, tags, calendars, pipelines
        · designs the architecture and shows you what it intends to create
        · builds the workflow as a DRAFT through the internal builder API
        · reads it back and verifies what was stored, not what was sent
        · reports what exists, what's still needed, and how to publish

You:    review in the GHL builder → publish is a separate, gated step
```

Nothing publishes, sends, or deletes as a side effect: every internal non-GET requires an explicit
confirm, and workflows always build as drafts.

## How it works — two ways of talking to GHL

The plugin talks to GHL over two APIs, and almost every decision here comes down to which one you
are on. Throughout this repo they're called the **public rail** and the **internal rail**.

| | Public rail | Internal rail |
|---|---|---|
| What | GHL's official, documented v2/v3 API | the same endpoints GHL's own web app calls |
| Auth | a Private Integration Token, long-lived | a browser session JWT, auto-renewed |
| Surface | **671 operations across 45 categories** | **892 catalogued endpoints** |
| Server | `@uxieee/ghl-mcp` (npm, runs locally) | `uxie-ghl-internal-mcp` (bundled, local stdio) |
| Status | supported, stable | undocumented, can change without notice |

**Default to public.** The internal rail exists because the public API cannot reach the workflow
builder, memberships and courses, events, funnel/page content, Voice AI behaviour, or knowledge
bases at all.

Inspecting your own account's traffic is permitted; what GHL does not owe is compatibility. Every
internal write passes two gates — an owned-account check each session, and a one-time
acknowledgement per workspace.

### Finding things — the same shape on both rails

Neither rail asks you to know an endpoint in advance.

```
public    search_actions   → describe_action   → execute_action
internal  search_endpoints → describe_endpoint → raw_request (or a typed tool)
```

The internal catalogue holds **892 endpoints** across every product this project knows, from four
kinds of evidence, and each row says which: mined from GHL's own recovered front-end source,
transcribed into the corpus from live traffic, or adopted from what the shipped tools call.

A search result tells you the four things that decide what to do next:

| | |
|---|---|
| `coveredBy` | a typed tool already wraps this — **call that**. It carries the compiler, the required query switches, the cursor walk and the read-back |
| `kind` | `read` / `write` / `destructive`, curated where the method alone misleads (one route is named `getSampleResponse` and sends real messages) |
| `reach` | `proven` — called live and it answered · `refused` — 401s from this rail, don't spend a turn · `source-only` — GHL's app calls it, nobody here has |
| `note` | the one trap worth knowing before you pick it |

`describe_endpoint` then hands you a copy-pasteable call — or says plainly that `raw_request`
cannot make it (multipart, blob, SSE, or a header it has no way to set).

## Commands

| Command | What it does |
|---|---|
| `/uxie-ghl-factory:setup` | first run on the public rail: token, connection test, prerequisites |
| `/uxie-ghl-factory:public-add-account` | add a sub-account and its Private Integration Token |
| `/uxie-ghl-factory:public-scope` | point this folder at one client |
| `/uxie-ghl-factory:internal-connect` | register + authorise the internal MCP for this project (the agent drives the browser; you just log in) |
| `/uxie-ghl-factory:brief` | create/update the persisted per-client account brief |
| `/uxie-ghl-factory:build-workflow` | design + build a workflow — **draft only** |
| `/uxie-ghl-factory:build-course` | build a whole course from a spec |
| `/uxie-ghl-factory:build-funnel` | build a funnel/page with custom HTML, tracking, SEO |
| `/uxie-ghl-factory:pipeline` | design / build / diagnose a pipeline and its stages |
| `/uxie-ghl-factory:export-workflow` | read-only export of a workflow's raw JSON |
| `/uxie-ghl-factory:workflow-logs` | read what a workflow actually DID at runtime |

**The account brief** is a persisted per-client doc — business, ideal client, offer, goals — that
every specialist reads *before* asking you anything, so nothing re-interviews you from scratch.

## Skills

Sixteen, in three roles — loaded by the agent as the task demands, not picked by you. The tools do
the execution and the catalogue does the lookup, so what a skill carries is what neither can hold:
**order, consequence, and when not to.**

**Judgement — how to decide**

| Skill | |
|---|---|
| `ghl-orientation` | the object model, the terminology, and which rail can do what. Every other skill assumes it |
| `ghl-system-conventions` | how a system should *look*: recon-first, layer-by-layer design gates, naming, where data lives (stage vs field vs tag), pipeline tests, hard rules, and the pre-build HTML approval document. Loaded before any blueprint. Also installable on its own: `npx skills add uxieee/ghl-system-conventions` |
| `ghl-workflow-specialist` | senior automation architect: patterns, anti-patterns, multi-workflow architecture. Decides *what* to build, delegates *how* |
| `ghl-pipeline-specialist` | stages as states, opportunity hygiene, pipeline↔automation interplay. Public API only |
| `ghl-reverse-engineering` | the method for mapping a new internal surface exhaustively — and for checking the catalogue before opening a browser |

**Build — engines and procedure**

| Skill | |
|---|---|
| `create-ghl-workflow` | compiles an IR into a real workflow through the builder's internal API. 33 engine modules, 147 enforced rules, **draft-first** |
| `ghl-memberships` | courses end to end: chapters, drip, lessons, quizzes, offers, certificates, enrolment |
| `ghl-funnels-pages` | funnels, steps, pages, full-bleed HTML, tracking code, and the three-call public-path fix |
| `ghl-events` | ticketed and RSVP events: tickets, sessions, speakers, attendees, public registration |
| `ghl-voice-ai` | phone agents — the behaviour layer the public API cannot see (27 fields vs 51) |
| `ghl-conversation-ai` | the chat AI Employee. **Mostly a public-rail product** — internal only for the per-contact switch, prompt history and the deployment routing table |
| `ghl-knowledge-base` | the content both AI products consume. 5 of its 9 source types have no public equivalent |
| `ghl-workflow-fast-forward` | move contacts parked at a wait to the next step. Turns a multi-day ladder into minutes. **Write skill, three gates** |

**Read**

| Skill | |
|---|---|
| `get-ghl-workflow-json` | export a workflow's raw config |
| `get-ghl-workflow-logs` | runtime: execution logs, enrolment history, per-step occupancy — and what the rows *mean* |
| `ghl-public-mcp-setup` | set up, scope or repair the public rail |

## The internal MCP server

Bundled and local. **51 tools** — the workflow build/edit/publish rail, runtime reads, memberships,
AI agent creation, folders, versions — plus `search_endpoints` / `describe_endpoint` over the
catalogue and `raw_request` as the escape hatch. Every non-GET requires an explicit `confirm`.

A **second, separate server** exposes 7 read-only audit tools whose GET-only lock is structural,
not configuration.

## Coverage & limitations

- **778 of the 892 catalogued endpoints are `source-only`** — GHL's app calls them, nobody here
  has. 89 are proven live, 25 are confirmed dead ends. A row is a path, not a proven behaviour.
- **Whole surfaces are unmapped.** Social planner and blogs have no coverage at all; calendars,
  reputation and media are thin. Most are reachable on the public rail instead.
- **385 step types and 204 trigger types** are buildable, but only 71 step types have been fired
  live. 282 are marketplace actions that build correctly and only *run* if the app is installed.
- **Publishing is never implied.** Workflows build as drafts; publishing is a separate, gated step.
- **The audit was retired** in 0.32.0 pending a redesign. Nothing was deleted — it is kept whole in
  `archive/audit-retired-2026-08-25/`, with a note on what a rebuild should change.

## Using in Codex

Codex plugins load **skills, MCP servers, hooks and apps** — but **not** slash commands or
subagents. So the Codex build is skills-only: invoke the skills directly (*"use
`create-ghl-workflow` to build…"*, *"use `ghl-workflow-specialist` to design…"*). All the build,
export, logs, pipeline and funnel functionality lives in skills, so you keep it.

**Public MCP server (configure once)** in `~/.codex/config.toml`:

```toml
[mcp_servers.ghl]
command = "npx"
args = ["-y", "@uxieee/ghl-mcp"]
env = { GHL_ACCOUNTS_FILE = "/Users/you/.ghl/accounts.json" }
```

Set the accounts file up first with `npx -y @uxieee/ghl-mcp accounts add` (once per sub-account).
Codex forwards only a fixed set of parent environment variables to a stdio server, so
`GHL_ACCOUNTS_FILE` must be named in `env` rather than exported in your shell. For a single
sub-account, `env = { GHL_API_TOKEN = "pit-…" }` works instead and needs no file.

`~/.codex/config.toml` is global, so there is no per-project scoping. Give each client its own
named server, narrowed to that client's sub-accounts:

```toml
[mcp_servers.ghl_acme]
command = "npx"
args = ["-y", "@uxieee/ghl-mcp"]
env = { GHL_ACCOUNTS_FILE = "/Users/you/.ghl/accounts.json", GHL_ALLOWED_LOCATIONS = "<id>" }
```

**Internal MCP server**, if you want the internal rail in Codex:

```toml
[mcp_servers.uxie-ghl-internal-mcp]
command = "node"
args = ["/Users/you/.uxie-ghl-internal-mcp/launch.mjs"]
env = { GHL_INTERNAL_TOK_FILE = "/path/to/project/.ghl/uxie-ghl-internal-mcp-tok.txt" }
```

Without either server the reasoning skills still load; anything that *calls* GHL needs one.

## Prerequisites

| Requirement | Needed for |
|---|---|
| **Node ≥ 18** | the compiler engines and both servers |
| **A GHL account (admin) + Private Integration Token** | everything on the public rail |
| **A Playwright MCP server** | capturing the internal rail's token — without it the public rail still works fully |

## Releasing

The plugin ships **generated copies** of things that live elsewhere — type cards and the endpoint
source from the sibling `knowledge/` corpus, the compiled catalogue, both capability manifests,
and the dist bundles that embed all of it. A commit in `knowledge/` regenerates them here via
its `post-commit` hook (`npm run sync`), so the working tree tracks the corpus; users receive
them at the next *release* (`claude plugin update` compares version strings).

```bash
npm run sync                 # regenerate every generated artefact in place (a knowledge/ commit runs this for you)
npm run publish-skill -- --version 0.54.0   # re-publish the standalone ghl-system-conventions mirror (release does this for you)
npm run freshness            # would regenerating change any shipped artefact? names what differs
npm run release -- 0.52.0    # preflight → drift → sync → gate → bump both manifests → full suite → tag/push/release/install
npm run release -- 0.52.0 --dry-run
```

`release` refuses unless you are on `main`, fetched, not behind, with a clean tree, a version
above the current one, and a `## [0.52.0] — YYYY-MM-DD` entry in `CHANGELOG.md` dated today —
the entry is the release notes. The freshness gate also runs in `pre-push` and in
`mcp-internal`'s `npm test`, so a stale tree cannot be pushed or pass the suite by accident.

## Repository layout

The plugin lives in [`plugins/uxie-ghl-factory/`](plugins/uxie-ghl-factory/). The repo root carries
**both** marketplace manifests so either host can install it: `.claude-plugin/marketplace.json`
(Claude Code) and `.agents/plugins/marketplace.json` (Codex). The plugin carries both plugin
manifests: `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` (skills-only).

## License

MIT.
