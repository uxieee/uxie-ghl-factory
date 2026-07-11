# uxie-ghl-factory

A Claude Code plugin that turns Claude into a competent **GoHighLevel operator** — it can read a sub-account, design and build workflows, funnels, pipelines, and AI agents, run a whole-account audit, and reverse-engineer GHL's own internal APIs when the public API falls short.

```
/plugin marketplace add uxieee/uxie-ghl-factory
/plugin install uxie-ghl-factory@uxieee
```

Then run `/uxie-ghl-factory:setup`.

---

## What's inside

The plugin is built in layers: **knowledge** the agent reasons with → **capabilities** it acts through → **specialists** that compose those capabilities → an **auditor** that inspects the whole system. It all sits on a bundled MCP server exposing **1,207 actions / 83 categories** of GoHighLevel's official public API (you supply your own Private Integration token at setup).

### Commands (what you type)

| Command | What it does |
|---|---|
| `/uxie-ghl-factory:setup` | First-run: token, connection test, prerequisites |
| `/uxie-ghl-factory:brief` | Create/update the persisted per-client account brief |
| `/uxie-ghl-factory:audit` | Whole-account, **read-only**, two-altitude audit → Mermaid map + impact-ranked report |
| `/uxie-ghl-factory:build-workflow` | Design + build a workflow (draft-only) via the workflow specialist |
| `/uxie-ghl-factory:build-funnel` | Build a funnel/page with custom HTML, tracking, SEO |
| `/uxie-ghl-factory:pipeline` | Design/build/diagnose a pipeline and its stages |
| `/uxie-ghl-factory:export-workflow` | Read-only export of a workflow's raw JSON |

### Skills (how it reasons and builds)

| Skill | Layer | What it does |
|---|---|---|
| `ghl-orientation` | Knowledge | The object model, terminology, and which API surface can do what — the fluency every other skill assumes |
| `create-ghl-workflow` | Capability | Compiles a clean IR into a real workflow via the builder's internal API — each supported step reverse-engineered + test-locked (draft-only) |
| `get-ghl-workflow-json` | Capability | Read-only export/inspection of a workflow's raw JSON |
| `ghl-funnels-pages` | Capability | Build funnels & pages, inject full-bleed custom HTML, set tracking code + SEO |
| `ghl-workflow-specialist` | Specialist | Senior automation architect — full trigger/action catalog (28 triggers / 66 steps from real production workflows), patterns + anti-patterns; delegates the build to `create-ghl-workflow` |
| `ghl-pipeline-specialist` | Specialist | Stage design (stages are *states*), opportunity hygiene, pipeline↔automation interplay — public-API only, ToS-clean |
| `ghl-ai-agents-specialist` | Specialist | Builds **Conversation AI**, **Voice AI**, and **Agent Studio** agents + rich-text **Knowledge Base** via their internal APIs — tested engine (4 compilers), **live-create-proven** |
| `ghl-reverse-engineering` | Meta | The methodology for capturing GHL's internal APIs (auth map, capture discipline) — how the engines grow to cover new surfaces |
| `ghl-audit-primitives`, `ghl-defect-catalog`, `ghl-opportunity-catalog`, `ghl-mermaid-map` | Audit | The finding schema, defect rules, opportunity rules, and system-map grammar the auditor runs on |

### Agents (the audit fan-out)

| Agent | What it does |
|---|---|
| `surface-auditor` | Recons one GHL surface (read-only) through both a defect lens and an opportunity lens, returns structured findings |
| `finding-verifier` | Adversarially re-checks each finding, stamping confirmed / plausible / refuted before it reaches the report |

**How the audit works:** `/uxie-ghl-factory:audit` fans `surface-auditor` across eight surfaces (workflows, pipelines, funnels, calendars, forms, AI agents, messaging, tracking), verifies every finding, ranks them against the client's stated goals, and synthesizes a Mermaid system map + report. It never writes to the account.

**The account brief** (`/uxie-ghl-factory:brief`) is a persisted per-client doc — business, ideal client avatar, offer, goals — that every specialist and the auditor read *before* asking you anything, so they never re-interview from scratch.

---

## The two API worlds (and honest limits)

| | Public API | Internal API |
|---|---|---|
| What | Official, documented, stable, in-ToS | The same endpoints GHL's own app UI uses |
| Auth | Private Integration token | Your logged-in session token (captured via Playwright) |
| Used by | MCP server, orientation, pipelines, audit recon | Workflow creation, funnels, AI-agent builders |
| Caveat | — | Undocumented, can change without notice (GHL permits operating your own account this way) |

The internal-API builders (`create-ghl-workflow`, the AI builders) are **draft-first** and were proven by creating-then-deleting real objects against a live account — but they're grounded in what's been captured, not a full spec, so coverage expands one reverse-engineered surface at a time.

## Prerequisites

| Requirement | Needed for |
|---|---|
| **Node ≥ 18** | The compiler engines |
| **A Playwright MCP server** | Internal-API features only — without it, the public MCP, orientation, pipelines, and audit recon still work fully |
| **A GHL account (admin) + Private Integration token** | Everything |

## Repository layout

The plugin lives in [`plugins/uxie-ghl-factory/`](plugins/uxie-ghl-factory/); the repo root is a Claude Code **marketplace** (`.claude-plugin/marketplace.json`) so `/plugin marketplace add` works. That's all that's here.

## License

MIT.
