# uxie-ghl-factory

A Claude Code plugin that turns Claude into a competent **GoHighLevel operator** — it can read a sub-account, design and build workflows, funnels, pipelines, and AI agents, run a whole-account audit, and reverse-engineer GHL's own internal APIs when the public API falls short.

```
/plugin marketplace add uxieee/uxie-ghl-factory
/plugin install uxie-ghl-factory@uxieee
```

Then run `/uxie-ghl-factory:setup`.

---

## What's inside

The plugin is built in layers — knowledge the agent reasons with, capabilities it acts through, specialists that compose those capabilities, and an auditor that inspects the whole system.

### The MCP server — the public-API backbone
A bundled MCP server exposing **1,207 actions across 83 categories** of GoHighLevel's official public API (contacts, pipelines, calendars, conversations, invoices, products, and much more). You supply your own GHL Private Integration token at setup; everything ToS-clean flows through here. Skills lean on it for recon and for anything the public API covers.

### Knowledge — `ghl-orientation`
The object model (agency → sub-account → contacts/pipelines/workflows/funnels/calendars), the terminology, and — crucially — the map of **which API surface can do what**. Every other skill assumes this fluency.

### Capabilities — the hands
- **`create-ghl-workflow`** — compiles a clean intermediate representation into a real GHL workflow via the builder's internal API. Its engine knows the exact payload shape of each supported step/trigger because each was reverse-engineered from real workflows and locked behind a test (draft-only; see honesty note below).
- **`get-ghl-workflow-json`** — read-only export/inspection of a workflow's raw JSON.
- **`ghl-funnels-pages`** — build funnels and pages, inject full-bleed custom HTML, set page/funnel tracking code and SEO.

### Specialists — the brains (recon, propose, then build)
Every specialist follows the same contract: **recon the account → read the client brief → ask only what's missing → propose a blueprint → get approval → build → verify.** No building from a one-line prompt.
- **`ghl-workflow-specialist`** — a senior automation architect. Knows the full trigger/action catalog (28 triggers, 66 step types distilled from a corpus of real production workflows), the patterns, and the anti-patterns (tag-trigger loops, cross-workflow races, timezone traps). Delegates the actual build to `create-ghl-workflow`.
- **`ghl-pipeline-specialist`** — stage design (stages are *states*, not tasks), opportunity hygiene, and the pipeline↔automation interplay. Public-API only, fully ToS-clean.
- **`ghl-ai-agents-specialist`** — builds GHL's three AI products through their internal APIs: **Conversation AI** (chat "AI Employee"), **Voice AI** (phone agent), and **Agent Studio** (Super Agents), plus rich-text **Knowledge Base** content the public API can't create. Backed by a tested engine (four compilers) that was **live-create-proven** end-to-end.

### The auditor — `/uxie-ghl-factory:audit`
A whole-account, **read-only**, two-altitude audit. An orchestrator fans out a `surface-auditor` across eight surfaces (workflows, pipelines, funnels, calendars, forms, AI agents, messaging, tracking), runs both a **defect** lens (bugs, races, orphaned tags, misconfigurations) and an **opportunity** lens (slow speed-to-lead, missing automations, funnel leaks) against the client's goals, adversarially verifies each finding, and synthesizes a **Mermaid system map + an impact-ranked report**. It never writes to the account.

### The account brief — `/uxie-ghl-factory:brief`
A persisted per-client context doc (business, ideal client avatar, offer, goals) that every specialist and the auditor read *before* asking you anything — so they never re-interview from scratch, and the auditor judges findings against what actually matters to the business.

### `ghl-reverse-engineering`
The methodology skill for capturing GHL's internal APIs when the public one can't do something — authenticated-browser network capture, the service-dependent auth map (`token-id` for AI services vs `Bearer` for the workflow builder), capture discipline (create → capture → delete), and documenting findings. This is how the workflow and AI engines grow to cover new surfaces.

### Commands
`/uxie-ghl-factory:setup` · `:brief` · `:audit` · `:export-workflow` · `:build-workflow` · `:build-funnel` · `:pipeline`

---

## The two API worlds (and honest limits)

- **Public API** — official, documented, stable, in-Terms-of-Service. The bundled MCP server, `ghl-orientation`, pipelines, and the auditor's recon all run here.
- **Internal API** — the same endpoints GHL's own app UI uses, reached by capturing your logged-in session's token. It's undocumented and can change without notice (GHL permits operating your own account this way). Workflow creation, funnels, and the AI-agent builders use it. **`create-ghl-workflow` and the AI builders are draft-first** and were proven by actually creating-then-deleting real objects against a live account — but they're grounded in what's been captured, not a full spec, so new/rare surfaces expand one reverse-engineered step at a time.

## Prerequisites
- **Node ≥ 18**
- **A Playwright MCP server** — only for the internal-API features; without it the public-API MCP, orientation, pipelines, and audit-recon still work fully.
- A GoHighLevel account with admin access, and a Private Integration token.

## Repository layout
The plugin itself lives in [`plugins/uxie-ghl-factory/`](plugins/uxie-ghl-factory/); the repo root is a Claude Code **marketplace** (`.claude-plugin/marketplace.json`) so `/plugin marketplace add` works. That's all that's here.

## License
MIT.
