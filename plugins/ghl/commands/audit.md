---
description: Run a whole-account, read-only GHL audit — dispatch the surface-auditor agent across all 8 surfaces (bounded concurrency), then the finding-verifier agent per candidate, and synthesize a brief-ranked report with a Mermaid system-flow map. Triggers — "audit my GHL", "audit my sub-account", "audit the whole system", "audit my workflows", "review my GHL setup", "what's wrong with my GHL account".
---

# /ghl:audit

Orchestrates a whole-account, two-altitude (defect + opportunity) GHL audit by
dispatching the `surface-auditor` agent per surface and the `finding-verifier`
agent per candidate finding, using the `ghl-audit-primitives`,
`ghl-defect-catalog`, `ghl-opportunity-catalog`, and `ghl-mermaid-map` skills.
$ARGUMENTS may narrow scope (a specific surface, a specific concern); default
is the full 8-surface sweep below.

## READ-ONLY guarantee

This command never writes to the GHL account — no workflow, pipeline, funnel,
calendar, form, ai-agent, message, or tracking change, ever, at any phase.
Every account interaction is a read (MCP `list`/`search`/`get`/`count`, or a
read-only workflow-JSON capture). The only writes this command makes are
local artifacts under `.ghl/<locationId>/audits/<timestamp>/`. Both dispatched
agents (`surface-auditor`, `finding-verifier`) carry this same read-only
posture as a hard guardrail — see
`${CLAUDE_PLUGIN_ROOT}/skills/ghl-audit-primitives/references/audit-io.md` §4
for the owned-account check every phase below assumes.

## Resumability

Every phase reads and writes on-disk artifacts under the audit run's own
folder, not in-memory state — so a mid-audit interruption (a JWT expiring
during a depth-dive handoff, a session restart) resumes from the last
checkpoint: re-open the same `.ghl/<locationId>/audits/<timestamp>/` folder,
check which of `inventory.json`, `findings/<surface>.json`, and
`audit-report.md` already exist, and continue from the first phase whose
artifact is missing or incomplete rather than restarting the whole run.

## Phase 1 — Scope/recon

1. Confirm the target `locationId` (ask, or list locations via the `ghl` MCP
   if the user isn't sure).
2. State and honor the read-only + owned-account posture from
   `ghl-audit-primitives` (`references/audit-io.md` §4): confirm the
   authenticated session actually admins this `locationId` before reading
   anything else. Refuse to proceed on a mismatch unless the user gives an
   explicit `OVERRIDE: <reason>`, logged verbatim.
3. Load `.ghl/<locationId>/brief.md` (format:
   `${CLAUDE_PLUGIN_ROOT}/docs/brief-format.md`). If it doesn't exist, run
   `/ghl:brief` first — an audit with no brief has no ranked goals to score
   impact against, and every finding downstream would cap at `low`.
4. Create `.ghl/<locationId>/audits/<timestamp>/` (layout:
   `ghl-audit-primitives` `references/audit-io.md` §1) — `raw/`, `findings/`,
   and an append-only `log.md`.
5. Run an MCP-wide inventory (read-only counts across all 8 surfaces:
   workflows, pipelines, funnels, calendars, forms, ai-agents, messaging,
   tracking) and write it to `inventory.json` in the audit root. This is the
   shared entity-count baseline every surface-auditor and the aggregator
   reads later — it is not itself a finding.

## Phase 2 — Breadth sweep (surface-auditor, bounded concurrency)

Dispatch the `surface-auditor` agent once per surface — workflows,
pipelines, funnels, calendars, forms, ai-agents, messaging, tracking — each
run given explicitly: `SURFACE`, the target `locationId`, and the audit root
path. Each surface-auditor runs both lenses (`ghl-defect-catalog` +
`ghl-opportunity-catalog`) against MCP-only reads and writes its own
candidate findings to `findings/<surface>.json`, all `verdict: plausible`
pending verification.

**Cap concurrency at 3–4 surface-auditors in flight at once** (per
`audit-io.md` §3) — this is a hard bound, not a suggestion; unbounded fan-out
against the account/MCP risks tripping GHL's rate limiting. Each
surface-auditor still runs its own per-call throttle regardless of how many
siblings are running concurrently. On any `429`/`403` from any in-flight
surface-auditor: that auditor stops immediately, the rejection is logged, and
you wait out the cooldown before dispatching the remaining surfaces — do not
let other surfaces "make up for" a throttled one.

## Phase 3 — Depth dives (gated, only on flagged hot-spots)

Not every candidate finding needs this — only ones a surface-auditor flagged
as needing internals the public MCP can't reach (workflow step logic and
trigger JSON, in particular). For those: use the `get-ghl-workflow-json`
skill's read-only capture path exactly as documented — do not hand-roll the
fetch or restate its auth mechanics. This is a human-paced handoff (browser
tabs staged, explicit `ready` from the user before proceeding, per
`audit-io.md` §3's verbatim handoff prompt) and may need to be serialized
(one depth dive at a time) even if the breadth sweep above ran concurrently.
If a browser session isn't available, stop, save what's captured so far, and
note the partial coverage in `log.md` — the run resumes here later.

## Phase 4 — Verify (finding-verifier, per candidate)

Dispatch the `finding-verifier` agent once per candidate finding (or once per
surface's `findings/<surface>.json` shard, if batching) to adversarially
re-check each `plausible` candidate: re-fetch its cited evidence read-only,
try to construct an innocent explanation, and stamp `confirmed`, `plausible`
(the default under any ambiguity), or `refuted`. Drop every `refuted`
finding — it does not carry forward into the report. Persist the stamped
verdicts back onto each finding record (the orchestrator's job; the verifier
itself has no `Write` tool).

## Phase 5 — Synthesize

1. **Dedup across surfaces** — the same underlying issue surfaced by two
   surface-auditors (e.g. a pipeline stage a workflow-auditor also flagged)
   is one finding, not two; keep the stronger evidence, cross-reference the
   other.
2. **Impact-rank against the brief** using the deterministic rubric in
   `ghl-audit-primitives` `references/audit-io.md` §2 — revenue-path
   proximity × blast radius × frequency, each 1–3, mapped to high/medium/low,
   capped at `low` if there's no plausible `brief_tieback` to a ranked goal in
   `.ghl/<locationId>/brief.md`. This is a scored rubric, not model gut —
   apply it the same way to every confirmed and plausible finding, never
   inflate.
3. **Render the Mermaid system-flow map** via the `ghl-mermaid-map` skill
   from the recon already captured (workflow roster, pipeline/stage list,
   tags, forms) → `system-flow.mmd` in the audit root. The map is descriptive
   only — structure, never verdicts; findings cite map nodes/edges as
   evidence, they don't get drawn onto the diagram itself.
4. **Write `audit-report.md`**: findings interleaved by impact (high →
   medium → low, not grouped by surface), each one tagged `defect` or
   `opportunity` (both altitudes must appear when both lenses found
   something), each visibly demarcated `confirmed` vs. `plausible`, and each
   tied to the specific ranked brief goal it blocks or advances. Cite the
   Mermaid map where a finding's location in the account's flow helps explain
   it. Log the phase transition to `log.md`.

## Guardrails

- **Read-only, no exceptions.** Never call or dispatch anything that would
  create, update, delete, publish, send, or cancel — in this command's own
  actions or in any agent it dispatches. If a step seems to require a write
  to verify something, stop and say so instead of doing it.
- **Auth is single-sourced.** Any browser-based capture needed for a depth
  dive follows `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` exactly —
  never restate header formats or capture steps here; point at that doc.
- **Bounded concurrency is a hard cap, not a target.** 3–4 surface-auditors
  in flight, full stop, even if more surfaces remain queued.
- **No manufactured findings, at any phase.** Every finding traces to
  evidence actually read this run; a finding with no evidence, or one
  `finding-verifier` refutes, does not reach `audit-report.md`.
