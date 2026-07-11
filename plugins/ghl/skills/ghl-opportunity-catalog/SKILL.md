---
name: ghl-opportunity-catalog
description: The OPPORTUNITY lens for whole-account GHL audits — macro-level rules for what an account SHOULD be doing per its client brief that it currently isn't, judged against the brief's ranked goals rather than harvested from a defect list. Covers speed-to-lead, manual-work-that-could-be-automated, funnel leaks, missing AI agent coverage, review/reputation loops, database reactivation, and pipeline-vs-sales-motion mismatch. AI-agent and tracking rules are marked best-effort — v1 cannot inspect Conversation AI bot internals or verify attribution depth via the public API. Use during any surface-auditor pass to know what absent/under-leveraged capabilities to scan for; findings are filed in the ghl-audit-primitives finding schema with `altitude: opportunity` and a required `brief_tieback`.
---

# GHL Opportunity Catalog

This skill has no procedure of its own — it's the rule catalog a surface-auditor
consults while judging one surface of a GHL sub-account against the account's
**brief**, looking for **opportunities**. An opportunity is `altitude:
opportunity` in the finding schema — something absent or under-leveraged
relative to a ranked goal in `.ghl/<locationId>/brief.md`'s "Goals — ranked"
section, as distinct from `defect` findings (things present and wrong), which
live in `ghl-defect-catalog`.

- `references/rules.md` — the opportunity rules, grouped by surface. Every
  rule gives: the **signal** (what read-only recon shows, or fails to show),
  **why it matters** (which kind of ranked brief goal it advances — a concept
  to instantiate against the real brief at audit time), the **remediation**
  (which specialist/skill in this plugin would build it), and an **honesty
  marker** on surfaces where v1's detection depth is thin.
- Finding shape: read
  `${CLAUDE_PLUGIN_ROOT}/skills/ghl-audit-primitives/references/finding-schema.md`
  before emitting a finding — every rule in this catalog is written to be
  filed as one finding with `altitude: opportunity` and a `brief_tieback`
  naming the specific ranked goal it advances (not just the goal *category*
  named in `rules.md` — the actual line from the actual brief).

## How this differs from `ghl-defect-catalog`

| | `ghl-defect-catalog` | `ghl-opportunity-catalog` (this skill) |
|---|---|---|
| Judges | Is this thing, which exists, working correctly? | Should this capability exist at all, given the brief? |
| Grounded in | Harvested defects from real audits (each rule cites a source) | Brief goals + recon/defect signals — **derived**, not harvested verbatim |
| `brief_tieback` | Optional strengthener (caps severity if absent) | **Required** — an opportunity with no plausible tieback to a ranked goal isn't a finding worth reporting, it's scope creep |
| Absence of evidence | Not a finding (no evidence → no finding) | **Is** the finding — the evidence is recon showing the capability is absent or thin |

## Ground rules

1. **Read-only detection only.** Every signal in `rules.md` comes from a read
   — an MCP list/search/get call, a read-only `get-ghl-workflow-json`
   capture, or a read-only browser inspection. Confirming "this doesn't
   exist" never requires a write.
2. **No finding without a brief tieback.** Per the finding schema, a
   surface-auditor names which ranked goal from `.ghl/<locationId>/brief.md`
   an opportunity advances before filing it. If nothing in "Goals — ranked"
   plausibly connects, don't file the opportunity — note it as a lower-
   confidence observation in `log.md` instead, per `audit-io.md`'s brief-goal
   gate.
3. **Judged-vs-brief, not judged-vs-a-checklist.** These rules are starting
   hypotheses ("a business with X kind of goal usually needs Y"), not a
   mandatory feature list every account must have regardless of what it
   actually sells or who it sells to. A brief with no revenue-path goal
   touching reviews, for instance, means the review-loop rule below simply
   doesn't fire — that's correct behavior, not under-coverage.
4. **Honest about depth.** The **AI-agents** and **tracking** surfaces are
   thin in v1 (spec §10): detection there is best-effort, and the rules
   below say so explicitly rather than claiming a detection capability that
   doesn't exist. No non-public AI backend routes are referenced anywhere in
   this catalog — Conversation AI opportunities are scoped strictly to the
   confirmed public `conversation-ai` MCP category (agent CRUD only; bot
   prompt/knowledge-base/flow-graph content is UI-only and out of reach for
   read-only recon).
5. **Auth is single-sourced.** Any detection step needing browser-based
   capture follows `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` — this
   catalog never restates header or token format.

## Scope

IN: per-surface opportunity rules (what's absent/under-leveraged vs. the
brief), each with signal, goal-category tieback, remediation pointer, and an
honesty marker where detection is thin. OUT: defect rules (what's present and
wrong — `ghl-defect-catalog`), the finding schema and brief format themselves
(owned by `ghl-audit-primitives` and the plugin's `docs/`), the Mermaid map
grammar (`ghl-mermaid-map`), and any specialist's full build procedure (owned
by that specialist's own skill — this catalog only points to it).
