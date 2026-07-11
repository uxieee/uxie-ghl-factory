# Stage Design — principles, lifecycle, and where pipelines break

> Grounded in `~/.claude/skills/ghl-specialist`'s audit references (real findings from
> real sub-account audits) plus the confirmed public v3 pipeline surface
> (`opportunities-v3__*`). Executed via the ghl MCP — no internal API, no JWT.

## 1. A stage is a state, not a task

A pipeline stage represents **where an opportunity currently stands** in the buyer's
(or job's) reality — not a checklist item for the rep. The test: can you describe the
stage as an adjective/noun phrase about the opportunity ("awaiting quote", "quote
sent, no response yet") rather than a verb phrase about the rep ("call them", "send
the quote")? If a stage name is a task, it's really an action inside the *previous*
stage, not a stage of its own.

**The collapsing rule:** if two candidate stages would trigger the *same* downstream
action (same email, same task assignment, same tag, same notification), they are one
stage, not two. Splitting them only fragments reporting (opportunities scattered
across near-duplicate buckets) without buying any automation distinction. Conversely,
if two states genuinely need different automation triggered on entry, they must be
separate stages — automation only fires on a stage boundary, so hiding a real state
change inside a single stage means nothing fires for it.

**Default-name smell:** GHL's out-of-the-box stage names (`New`, `Contacted`,
`Qualified`, `Won`, `Lost`) surviving unedited on a pipeline serving a business with a
specific, describable sales motion is a signal the pipeline was never actually
designed — it was left at scaffold. (`ghl-specialist
references/common-audit-findings.md` #3, tier-1 finding: "default-pipeline-never-
customized.")

## 2. Opportunity lifecycle and hygiene

Every opportunity has a `status` (`open` / `won` / `lost` / `abandoned`) independent
of which stage it sits in — `status` and `pipelineStageId` are separate fields on the
opportunity record (`opportunities-v3__update-opportunity`,
`opportunities-v3__update-opportunity-status`). An opportunity can technically sit in
an early stage while marked `won`, or persist in a middle stage indefinitely with
`status: open`. Hygiene means keeping the two in sync with reality:

- **Require a lost reason.** `opportunities-v3__update-opportunity-status` accepts
  `lostReasonId` (see `opportunities-v3__get-lost-reason` for the configured list). An
  account where most `lost` opportunities carry no reason has turned off the UI-level
  enforcement — the pipeline can't tell you *why* deals die, only that they did.
- **Zombie opportunities distort reporting.** An opportunity sitting `open` in the
  same stage for 60+ days with no `Stale Opportunities` trigger configured is a
  common oversight — most accounts never wire that trigger up
  (`ghl-specialist references/trigger-gotchas.md`, Stale Opportunities: "Most accounts
  never configure this and accumulate dead opps that skew pipeline reporting"). Audit
  by bucketing `opportunities-v3__search-opportunity` (`status=open`, filtered by
  `pipelineStageId`) against `dateUpdated` / last-status-change; flag anything past a
  business-appropriate staleness threshold.
- **A stage holding a disproportionate share of open opportunities is a bottleneck
  signal, not a stage-design signal by itself.** (`ghl-specialist
  references/common-audit-findings.md` #3 and #14: any stage holding >40% of all open
  opportunities, or >20 opportunities aged >60 days, gets flagged.) The fix is rarely
  "add more stages" — it's usually a missing automation, a missing owner, or a real
  process bottleneck the pipeline is correctly exposing. Don't paper over a real
  bottleneck by subdividing the stage; diagnose the bottleneck first.

## 3. Pipeline ↔ workflow interplay — where loops are born

Stage changes are the seam between pipeline design and workflow automation: the
`Pipeline Stage Changed` trigger is what lets a workflow react to an opportunity
crossing a stage boundary, and a workflow action can itself move an opportunity's
stage (`opportunities-v3__update-opportunity` with a new `pipelineStageId`). That seam
is exactly where two failure modes live:

- **Under-filtered triggers fire wider than intended.** `Pipeline Stage Changed` is
  the most filter-rich trigger in the catalog (pipeline, stage, assigned user, tags,
  lead value, lost reason) and the most commonly misconfigured — a missing pipeline
  filter fires across *every* pipeline in the account; a missing stage filter fires on
  *any* stage change within the target pipeline. (`ghl-specialist
  references/trigger-gotchas.md`, Pipeline Stage Changed.) Always verify both filters
  are set before treating a stage-triggered workflow as scoped.
- **Automated stage moves can re-trigger the workflow that moved them — the same
  structural shape as a tag-trigger loop.** If Workflow A moves an opportunity into
  Stage X on some condition, and Stage X's `Pipeline Stage Changed` trigger enrolls
  the opportunity back into Workflow A (directly, or via a chain of a few workflows),
  you have a cycle. This is the pipeline-side instance of the same anti-pattern
  `ghl-workflow-specialist` documents for tag triggers: nothing in the builder UI
  visualizes cross-workflow stage-move chains, so map every `Pipeline Stage Changed`
  trigger against every stage-writing action across *all* workflows touching the
  pipeline before shipping a design, not just the one workflow you're building.
  Break the cycle the same way: an explicit exit condition (a guard checked before the
  loop-causing move fires again) rather than trusting the runtime to stop it.
- **Which stage-changes to automate.** Automate the moves that represent an
  *external* event crossing a threshold you can detect (form submitted, invoice paid,
  call booked, no-show recorded) — these are legitimate triggers for downstream
  comms/tasks. Do **not** automate a rep's *judgment* calls (e.g. auto-advancing
  "Qualified" the instant a call is booked, before a human actually qualifies the
  lead) — collapsing a human decision into an automatic stage move erases the signal
  the stage existed to capture, and the next report reads as healthier than the real
  pipeline is.

## 4. Reporting consequences of bad stage design

Stage design is, functionally, the schema for every pipeline report the business will
ever run. Two design mistakes compound into misleading reporting more than any other:

1. **Stages that don't map to a real decision point** make conversion-rate-by-stage
   numbers meaningless — a stage nobody's automation or reps treat as distinct just
   adds noise between two real transitions.
2. **No hygiene enforcement (see §2)** means "opportunities currently open" includes
   an unknown fraction of zombies, so pipeline value and win-rate reporting silently
   overstate the live pipeline.

When redesigning a pipeline, treat the reporting question — "what will this stage
list let the business measure that it can't measure today?" — as a design constraint,
not an afterthought.

## 5. The `update-pipeline` full-replacement hazard

`opportunities-v3__update-pipeline` (`PUT /opportunities/pipelines/{pipelineId}`) is
public, live, and the correct way to edit a pipeline's stage list — but its `stages`
array is a **full replacement**, not a diff:

- Every stage you want to **keep** must be included in the request with its existing
  `id`.
- Any existing stage **omitted** from the array is **deleted**, and every opportunity
  that was sitting in it is reassigned to a remaining stage (confirm the exact destination
  by re-running get-pipeline after the update).
- A stage included **without** an `id` is created as new.

This is the single most consequential gotcha in the pipeline surface: a well-meaning
"just add one stage" call that forgets to re-include the other four existing stages
will delete those four stages and dump every opportunity that was in them into
whichever stage sits first. There is no partial-update mode and no undo.

**Working protocol, every time:**
1. `opportunities-v3__get-pipeline` first — read the full current stage list with ids.
2. Build the new `stages` array in memory: every stage to keep gets its existing
   `id` + name (+ `stageWinProbability` if the pipeline uses manual probability);
   stages to add have no `id`; stages genuinely meant to be removed are the only ones
   left out — and say so explicitly in the blueprint, naming which stage's
   opportunities will move and to where.
3. Confirm the full before/after stage list with the user before calling
   `update-pipeline` — this is an approval-gate item per the specialist contract, not
   a silent recon action.
4. Re-`get-pipeline` after the call to verify the resulting stage ids and confirm no
   opportunity got orphaned into the wrong stage.

The same full-replacement shape means "renaming" a stage is safe (same `id`, new
`name`) but "reordering" stages means resubmitting the entire array in the new order
— both are safe as long as every kept stage's `id` is present.
