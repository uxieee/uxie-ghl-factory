# Defect Rules — per-surface catalog

> The DEFECT lens (`altitude: defect` in the finding schema — things that are
> **wrong**, as distinct from `opportunity` findings, which are things
> **absent or under-leveraged**; that's a separate catalog/lens). Every rule
> below is harvested, not invented — each carries a **Source** line pointing
> at the exact reference it came from. Nothing here is a hypothetical GHL
> behavior.

Rule id convention mirrors the finding schema's `id: <surface>-<n>` so a
surface-auditor can cite `workflows-3` etc. directly as (or alongside) a
finding id. Ids are stable within this catalog; they are not the same
sequence as a live audit run's finding ids (a run may skip rules that find
no evidence).

Every rule's **Detection** step is read-only: an MCP `search_actions`/
`execute_action` (GET-shaped) call, a read-only `get-ghl-workflow-json`
capture, or a read-only browser/Playwright inspection. None of these rules
call for a write action, ever — that's the auditor's global constraint, not
just this file's.

**Severity defaults are starting points, not verdicts.** The deterministic
impact-ranking rubric in `ghl-audit-primitives/references/audit-io.md` §2
(revenue-path proximity × blast radius × frequency, scored against the
brief's ranked goals) has final say over what ships in `severity`; a rule's
default here is what a surface-auditor should propose absent other signal.

---

## workflows

### workflows-1. Tag-trigger loops
- **What to look for:** Workflow A adds a tag that fires Workflow B, which
  (directly or after a few hops) adds a tag that re-enters Workflow A.
  Nothing in the builder UI visualizes this.
- **Detection:** Map every `contact_tag` trigger against every
  `add_contact_tag`/`remove_contact_tag` action across ALL workflows in the
  account (via `get-ghl-workflow-json` captures, read-only) — not just one
  workflow. If a tag added downstream matches a tag trigger upstream, flag
  as a cycle candidate. Also check `allowMultiple` on each workflow in the
  candidate loop — `true` on any hop means the loop can run unbounded.
- **Default severity:** medium (escalate to high if the loop cycles at
  volume or touches a revenue-path workflow).
- **Remediation:** `ghl-workflow-specialist` — break the cycle with an
  explicit exit condition (a "processed" tag/guard checked before the
  loop-causing action fires again).
- **Source:** `ghl-workflow-specialist/references/anti-patterns.md` §1,
  itself grounded in `ghl-specialist references/trigger-gotchas.md`
  (Custom Trigger — "creates cross-workflow coupling that the UI does not
  visualize") and `ghl-specialist references/action-gotchas.md` (Go To).

### workflows-2. Bidirectional cross-workflow handoff (loop-unsafe)
- **What to look for:** Flow A hands off to Flow B via `add_to_workflow`
  (Send to Workflow); Flow B hands back to Flow A the same way. If the
  return leg's workflow has `allowMultiple: false`, the second enrollment
  silently no-ops and the contact looks stuck with no visible cause.
- **Detection:** For any pair of workflows referencing each other via
  `add_to_workflow`/Send to Workflow, read both workflows' `allowMultiple`
  setting (via `get-ghl-workflow-json`). A `false` on either side is a
  candidate silent trap unless it's the workflow's intended terminal stop.
- **Default severity:** medium.
- **Remediation:** `ghl-workflow-specialist` — prefer one-directional
  handoffs; if a return leg is required, pair it with an explicit
  `remove_from_workflow(includeCurrent: true)` on the outbound leg.
- **Source:** `ghl-workflow-specialist/references/anti-patterns.md` §2,
  citing `ghl-workflow-api-docs/recipes/cross-workflow-handoff.md`
  ("Bidirectional handoff is possible but loop-unsafe").

### workflows-3. Racing workflows / duplicate messages
- **What to look for:** A contact enrolled in ≥2 workflows that overlap on
  trigger scope (same tag, same form, same pipeline stage) with no shared
  communication-limit governor — the contact gets the same or a similar
  message multiple times in a short window.
- **Detection:** Pull outbound conversations for the last 30 days
  (`conversations` category), bucket by contact/day/channel; flag any
  contact receiving more than 3 same-channel outbound messages in a day.
  Cross-reference the affected contacts' Enrollment History against the
  workflow map to find which workflows overlap.
- **Default severity:** medium (escalate to high if duplicates reach paying
  customers or run at volume — real churn/complaint risk).
- **Remediation:** `ghl-workflow-specialist` — add an explicit governor (a
  shared "contacted today" tag/custom value checked at entry) so only one
  workflow fires the outbound send.
- **Source:** `ghl-specialist references/common-audit-findings.md` #2
  (tier-1, most-cited finding), also captured in
  `ghl-workflow-specialist/references/anti-patterns.md` §3.

### workflows-4. Timezone / wait-step traps
- **What to look for:** A date-anchored trigger (Birthday Reminder, Custom
  Date Reminder) firing at inconsistent hours because it evaluates in the
  **contact's** timezone, not the location's, and blank-timezone contacts
  silently fall back to the location default. Separately, a
  business-hours-aware `wait` with no linked-calendar hours behaves as a
  no-op.
- **Detection:** For date-anchored campaigns reported as firing at odd
  hours, sample the enrolled contacts' timezone fields — a mix with no
  standard confirms the cause. For every business-hours-aware `wait` step
  (via `get-ghl-workflow-json`), verify the linked calendar actually has
  hours configured (`calendars` category).
- **Default severity:** medium.
- **Remediation:** `ghl-workflow-specialist` — don't assume a location-wide
  fire time for contact-scoped date triggers; attach an hours-configured
  calendar before shipping a business-hours wait.
- **Source:** `ghl-workflow-specialist/references/anti-patterns.md` §4,
  citing `ghl-specialist references/trigger-gotchas.md` (Birthday
  Reminder / Custom Date Reminder) and `references/action-gotchas.md`
  (Wait — business-hours misconfiguration).

### workflows-5. Re-entry misconfiguration
- **What to look for:** Two failure directions on the same root cause
  (`allowMultiple`): (a) Appointment Status / Invoice triggers **bypass**
  `allowMultiple` entirely and always re-run per event — if downstream
  actions aren't per-event-safe, the contact gets spammed; (b) Contact
  Created / Form Submitted triggers **respect** `allowMultiple` — if left
  `true` on a welcome/drip workflow, a re-submitting contact restarts the
  whole sequence.
- **Detection:** For each workflow, read `settings.allowMultiple` and
  cross-reference against trigger type. Appointment/Invoice re-running
  per-event is expected — don't flag it. Flag Contact Created/Form
  Submitted workflows with `allowMultiple: true` that send a welcome/drip
  sequence.
- **Default severity:** medium.
- **Remediation:** `ghl-workflow-specialist` — default `allowMultiple:
  false` for welcome/onboarding sequences; design appointment/invoice
  downstream actions to be per-event-scoped from the start.
- **Source:** `ghl-specialist references/common-audit-findings.md` #8
  ("Workflow re-entry misconfiguration"); `references/trigger-gotchas.md`
  (Appointment Status / Invoice re-entry bypass); also
  `ghl-workflow-specialist/references/anti-patterns.md` §5.

### workflows-6. Missing else-leg (marooned contacts)
- **What to look for:** An `if_else` branch with no explicit "else" path.
  A contact matching none of the defined branches simply **stops** at that
  node — no error, no fallthrough, nothing downstream ever fires for them.
- **Detection:** Scan `if_else` containers in captured workflow JSON
  (`get-ghl-workflow-json`) for a branch set with no catch-all leg — every
  `if_else` should resolve every contact to some leg, even if that leg is
  just `remove_from_workflow`.
- **Default severity:** medium (escalate to high on a revenue-path
  workflow, e.g. lead routing).
- **Remediation:** `ghl-workflow-specialist` — always build the else/
  catch-all branch explicitly.
- **Source:** `ghl-specialist references/action-gotchas.md` (If/Else —
  "most common `the workflow looks fine but nothing happens` cause");
  `ghl-workflow-specialist/references/anti-patterns.md` §6.

### workflows-7. Orphaned / unbounded waits
- **What to look for:** A `wait` on reply/email-event/etc. with no timeout
  configured — holds the contact indefinitely if the event never fires.
  Separately, a `goto`-based retry loop with no bounded counter has no
  confirmed runtime cycle limit.
- **Detection:** For every hybrid/multi-path `wait` step (captured JSON),
  confirm a timeout branch exists. For any `goto` targeting an earlier step
  in its own chain, confirm a counter-based exit condition exists (not an
  assumed one).
- **Default severity:** medium.
- **Remediation:** `ghl-workflow-specialist` — never ship a hybrid wait
  without a timeout leg; use a bounded counter (custom value +
  increment + cap check) for genuine retry loops.
- **Source:** `ghl-specialist references/action-gotchas.md` (Wait — "until
  event without a timeout will hold the contact indefinitely");
  `ghl-workflow-specialist/references/anti-patterns.md` §7 (also citing
  `ghl-workflow-api-docs docs/04-workflow-anatomy.md` §4.5, loop-safety
  untested).

### workflows-8. Silent no-ops on cross-workflow / cross-entity references (orphaned refs)
- **What to look for:** `add_to_workflow`, `remove_from_workflow`, and
  `goto`-to-another-workflow all publish cleanly even when their target no
  longer exists — the action just silently does nothing at runtime. Same
  shape for a deleted custom field referenced by `update_contact_field`, a
  deactivated user referenced by `assign_user`, a moved/renamed Google
  Sheet, or a tag reference that no longer exists in the tag library
  (orphaned tag).
- **Detection:** For every cross-reference field in captured workflow JSON
  (workflow id, custom field id, user id, sheet id, tag name), re-fetch the
  current entity from source (`contacts__listTags`, `users__listUsers`,
  `custom-fields__listCustomFields`, or a workflow-existence check) and
  confirm it resolves. A referenced entity that no longer resolves is the
  finding — no need to trigger the action to confirm the no-op.
- **Default severity:** medium (escalate to high if the broken reference
  sits on a revenue-path or primary-intake workflow).
- **Remediation:** `ghl-workflow-specialist` — treat a clean publish as
  meaningless for these fields; verification is a live GET against the
  referenced entity, not the publish response.
- **Source:** `ghl-workflow-specialist/references/anti-patterns.md` §8,
  citing `ghl-workflow-api-docs recipes/cross-workflow-handoff.md`
  ("Validator does not check target workflow exists") and
  `ghl-specialist references/action-gotchas.md` (Update Contact Field,
  Assign to User, Google Sheets); tag-name orphaning specifically also
  `ghl-specialist references/common-audit-findings.md` #4 ("Tags chaos" —
  "verify the trigger's tag name exists in listTags; flag mismatches").

### workflows-9. Custom Value vs. Contact Field confusion (accidental broadcast)
- **What to look for:** A workflow step writes a **custom value** (which is
  sub-account-wide) where the builder almost certainly meant a per-contact
  **custom field** write — the "fix" silently rewrites what every contact
  and every workflow referencing that value sees.
- **Detection:** For every Update Custom Value action in captured workflow
  JSON, check whether the referenced value's name reads as contact-specific
  (e.g. "John's appointment date"). That's a red flag for a miswired
  action.
- **Default severity:** medium.
- **Remediation:** `ghl-workflow-specialist` — confirm intent explicitly;
  default to `update_contact_field` for per-contact state.
- **Source:** `ghl-specialist references/action-gotchas.md` (Update Custom
  Value); `ghl-workflow-specialist/references/anti-patterns.md` §9.

### workflows-10. AI actions with no cost/volume cap
- **What to look for:** An AI Prompt / `ai_agent` / `chatgpt` step sitting
  behind a high-frequency or unauthenticated-surface trigger (public form,
  webhook) with no upstream rate limiting. AI tokens bill to the
  sub-account's wallet with no built-in cost cap.
- **Detection:** For every AI action in captured workflow JSON, identify
  its upstream trigger and estimate volume. Flag any AI action fed by a
  high-frequency trigger with no `if_else`/counter gate upstream.
- **Default severity:** medium (escalate to high if the trigger surface is
  public/unauthenticated, e.g. a public form or webhook — real runaway-
  spend risk).
- **Remediation:** `ghl-workflow-specialist` — gate with an `if_else` +
  counter custom value (rate-limit pattern) or upstream trigger filtering.
- **Source:** `ghl-specialist references/action-gotchas.md` (AI Prompt —
  "no built-in cost cap... can burn the wallet in hours");
  `ghl-workflow-specialist/references/anti-patterns.md` §10.

### workflows-11. No testing discipline / dead workflows
- **What to look for:** Workflows pushed live with no test contact, no
  dev/staging pass, and no monitoring of whether they're actually running.
- **Detection:** Search contacts for name/email containing `test`/`demo`/
  `qa`; flag if the only such contacts are stale (>90 days old, no recent
  test runs). Separately, use `get-ghl-workflow-logs` to read each live
  workflow's runtime: a `logs/v2` window sweep (last 60–90 days) plus
  `workflow-with-filter` enrollment history. Flag any workflow whose most
  recent `logs/v2` row is >60 days old while its trigger is technically
  live, and any workflow with zero enrollments since creation. (This is
  the runtime read the earlier version of this rule described but had no
  mechanism for — see `workflows-13..16` for the runtime-proven defects it
  now unlocks.)
- **Default severity:** low as general hygiene, medium when paired with a
  workflow the business describes as mission-critical.
- **Remediation:** narrative — no single specialist owns this; raise with
  the account owner as a process gap, or route rebuilds through
  `ghl-workflow-specialist`.
- **Source:** `ghl-specialist references/common-audit-findings.md` #9
  ("No testing discipline").

### workflows-12. Workflow vs. campaign misuse
- **What to look for:** A simple one-message broadcast built as a
  multi-step workflow (overkill, harder to maintain than a campaign); or a
  complex branching sequence stuck in legacy Campaigns (a underbuilt
  campaign missing the branching workflows would give it).
- **Detection:** Flag any workflow with only one action node. Flag any
  legacy campaign with >3 steps and branching logic (Playwright-inspect
  Marketing → Campaigns; sparse API surface here).
- **Default severity:** low.
- **Remediation:** `ghl-workflow-specialist` for anything that should
  become a proper workflow.
- **Source:** `ghl-specialist references/common-audit-findings.md` #16.

> **workflows-13 through workflows-16 are runtime-proven defects.** Unlike the
> rules above (which read the workflow's *definition*), these read what it
> actually *did* — via the `get-ghl-workflow-logs` skill's three read
> endpoints (`logs/v2`, `workflow-with-filter`, `count-per-step`). They exist
> because a whole class of defects is invisible to static review: a branch can
> look reachable but never be traversed, a send step can look healthy but be
> silently failing. Only fire these when you actually pulled the runtime data
> this run — the evidence item must cite a `raw/workflows/logs-*.json` /
> `enrollments-*.json` / `step-counts-*.json` capture, never an inference.

### workflows-13. Dead branch / never-traversed path (runtime-proven)
- **What to look for:** A step or whole branch of a live, enrolling workflow
  that **no contact ever actually reaches** — an unsatisfiable condition, a
  misordered filter, or an if/else leg whose predicate can never be true.
  Static review can only say a path "looks" unreachable; runtime proves it.
- **Detection:** Pull `count-per-step` (current occupancy) and a `logs/v2`
  sweep over a window in which the workflow had meaningful enrollment
  (confirm enrollment via `workflow-with-filter`). A `stepId` that appears in
  the static graph (`get-ghl-workflow-json`) as downstream of a live path but
  **never** appears in `count-per-step` and **never** as a `stepId` in
  `logs/v2` over that window is the finding. Cross-check the static graph so
  you don't flag an intentionally-off leg (a note in the brief, a disabled
  branch) as dead.
- **Default severity:** medium; **high** when the never-traversed branch sits
  on the revenue path (e.g. the "booked / qualified" leg of a booking or
  sales workflow — leads that should convert are silently skipping it).
- **Remediation:** `ghl-workflow-specialist` — fix the condition/filter that
  makes the branch unreachable; re-verify against runtime after the change.
- **Source:** runtime execution-log reverse-engineering,
  `ghl-workflow-api-docs research/execution-logs-internal/` (this run's
  capability); interpretation aligns with `workflows-6` (marooned contacts)
  and `workflows-11` (dead workflows).

### workflows-14. Stuck / stalled enrollments (runtime-proven)
- **What to look for:** Contacts parked at a step whose **resume time has
  already passed** — the workflow has effectively stalled for them. Points at
  a wait whose window can never open (timezone/business-hours trap), a
  rate-limit backlog, or a queue failure.
- **Detection:** `workflow-with-filter` — enrollment rows still `status:
  wait_time` where `executeOn` is in the past. A cluster of stuck contacts at
  one `currentStepId` localizes the fault to that step (often ties to
  `workflows-4` timezone/wait traps or `workflows-7` unbounded waits).
- **Default severity:** medium; escalate by count and revenue proximity
  (many contacts stalled on an intake/nurture path is **high**).
- **Remediation:** `ghl-workflow-specialist` fixes the wait/window design.
  Note: clearing the already-stuck contacts needs a runtime-control action
  (requeue) that is **out of scope for this read-only audit** — flag it for
  the operator, don't attempt it.
- **Source:** runtime execution-log reverse-engineering,
  `ghl-workflow-api-docs research/execution-logs-internal/`; related to
  `workflows-4` and `workflows-7`.

### workflows-15. Silent send failures (runtime-proven)
- **What to look for:** A send step (email/SMS) that reports as **executed**
  in the builder while the downstream provider actually **rejected** it — the
  workflow looks healthy while messages aren't landing.
- **Detection:** `logs/v2` over the window — rows on a send step with
  `status: success` but `meta.status ≥ 400`, or `status: failed` / recurring
  `status: retry`. A repeating failure at one `stepId` is the finding (a
  single transient blip is not).
- **Default severity:** **high** — this is revenue-path messaging broken in a
  way the UI hides. Cross-reference `messaging-1` (deliverability) — a cluster
  here often shares a root cause with a messaging-surface finding.
- **Remediation:** `ghl-workflow-specialist` for the step; pair with a
  messaging deliverability check (sender/domain/number health).
- **Source:** runtime execution-log reverse-engineering,
  `ghl-workflow-api-docs research/execution-logs-internal/`
  (`meta.status` on a `success` row is the silent-failure tell); cross-ref
  `messaging-1`.

### workflows-16. Anomalous early exits (runtime-proven)
- **What to look for:** Contacts leaving the workflow **earlier or more often
  than the design intends** — e.g. a spike of wait-window-in-past drops, or an
  abnormally high reply-stop rate signalling a messaging or targeting problem.
- **Detection:** `logs/v2` `status: finished` rows over the window, bucketed
  by `meta.removedFrom.type`. A concentration of `wait_step_window_in_past`
  confirms a timezone/window trap (`workflows-4`) is silently ejecting
  contacts; a high `contact_reply_stop_response` rate flags messaging fatigue
  or mistargeting. Compare the exit-reason distribution against what the
  workflow's design would predict.
- **Default severity:** medium; **high** when the early-exit volume is large
  or on a revenue-path sequence.
- **Remediation:** `ghl-workflow-specialist` (fix the wait/window or the
  branching); if reply-stop-driven, also raise messaging cadence/targeting.
- **Source:** runtime execution-log reverse-engineering,
  `ghl-workflow-api-docs research/execution-logs-internal/`
  (`meta.removedFrom.type` enum); ties to `workflows-4`.

---

## pipelines

### pipelines-1. Default-pipeline-never-customized
- **What to look for:** A pipeline's stage names are still GHL's generic
  scaffold (`New`, `Contacted`, `Qualified`, `Won`, `Lost`) even though the
  business has a specific, describable sales or fulfillment motion.
- **Detection:** `opportunities-v3__get-pipeline`/`list-pipelines` — read
  stage names. If they match the default set verbatim and the account
  brief describes a distinct sales motion, flag.
- **Default severity:** medium.
- **Remediation:** `ghl-pipeline-specialist` — redesign stages as states
  ("awaiting quote"), not tasks ("call them"); see the collapsing rule for
  what counts as a real distinct stage.
- **Source:** `ghl-pipeline-specialist/references/stage-design.md` §1,
  citing `ghl-specialist references/common-audit-findings.md` #3
  ("default-pipeline-never-customized").

### pipelines-2. Stage design that doesn't map to a real decision point
- **What to look for:** Two candidate stages that trigger the *same*
  downstream automation (same email, same task, same tag) — splitting them
  only fragments reporting without buying any automation distinction. This
  produces conversion-rate-by-stage numbers that are meaningless noise.
- **Detection:** For each pair of adjacent stages, compare the workflows/
  automations keyed to each (via `Pipeline Stage Changed` triggers in
  captured workflow JSON). If two stages key to identical downstream
  actions, flag as a collapsing candidate.
- **Default severity:** low (reporting-quality issue, not a functional
  break).
- **Remediation:** `ghl-pipeline-specialist` — merge stages that don't
  represent distinct automation-worthy states; use
  `opportunities-v3__update-pipeline` (full-replacement — read the
  specialist's working protocol before touching it).
- **Source:** `ghl-pipeline-specialist/references/stage-design.md` §1
  ("the collapsing rule").

### pipelines-3. Stale / zombie opportunities
- **What to look for:** Opportunities sitting `open` in the same stage for
  60+ days with no `Stale Opportunities` trigger configured on the
  pipeline — most accounts never wire this trigger up, so dead deals skew
  pipeline value and win-rate reporting.
- **Detection:** `opportunities-v3__search-opportunity` (`status=open`)
  bucketed by `pipelineStageId`, checked against `dateUpdated`/last-status-
  change; flag opportunities aged past a business-appropriate threshold
  (60 days baseline). Separately confirm (via captured workflow JSON) that
  no workflow on this pipeline has a `Stale Opportunities` trigger. Flag as
  a pipeline-hygiene failure if stale-open count exceeds ~10% of total
  open.
- **Default severity:** low to medium depending on how much it's
  distorting forecasting/reporting.
- **Remediation:** `ghl-pipeline-specialist` for the trigger + threshold
  design; `ghl-workflow-specialist` to build the actual reminder/escalation
  workflow.
- **Source:** `ghl-pipeline-specialist/references/stage-design.md` §2,
  citing `ghl-specialist references/trigger-gotchas.md` (Stale
  Opportunities) and `references/common-audit-findings.md` #14
  ("Abandoned opportunities cluttering pipelines").

### pipelines-4. Lost-reason enforcement disabled
- **What to look for:** Most `status: lost` opportunities carry an empty
  `lostReasonId` — the UI-level enforcement to require a reason is off, so
  the pipeline can't tell the business *why* deals die, only that they did.
- **Detection:** Sample `status: lost` opportunities via
  `opportunities-v3__search-opportunity`/`get-opportunity`; check
  `lostReasonId` against the configured list
  (`opportunities-v3__get-lost-reason`). Flag if most sampled records have
  no reason.
- **Default severity:** medium.
- **Remediation:** `ghl-pipeline-specialist` — turn on/require lost-reason
  capture at the UI level and backfill the reason taxonomy if thin.
- **Source:** `ghl-pipeline-specialist/references/stage-design.md` §2.

### pipelines-5. Stage bottleneck (disproportionate open-opportunity share)
- **What to look for:** A single stage holding a disproportionate share of
  all open opportunities (>40% baseline) or an absolute count of aged
  opportunities (>20 open >60 days) in one stage — a real process
  bottleneck the pipeline is correctly exposing, not itself a stage-design
  defect.
- **Detection:** `opportunities-v3__search-opportunity` bucketed by
  `pipelineStageId`; compute share of total open per stage and count of
  aged-open per stage against the thresholds above.
- **Default severity:** medium.
- **Remediation:** Don't paper over with more stages — diagnose the
  bottleneck (missing automation, missing owner, real process constraint)
  via `ghl-pipeline-specialist` before proposing a stage-count change.
- **Source:** `ghl-pipeline-specialist/references/stage-design.md` §2,
  citing `ghl-specialist references/common-audit-findings.md` #3 and #14.

### pipelines-6. Under-filtered Pipeline Stage Changed trigger
- **What to look for:** A `Pipeline Stage Changed` trigger missing its
  pipeline filter (fires across every pipeline in the account) or missing
  its stage filter (fires on any stage change within the target pipeline)
  — the most filter-rich trigger in the catalog and the most commonly
  misconfigured.
- **Detection:** Expand every `Pipeline Stage Changed` trigger in captured
  workflow JSON and verify both the pipeline and stage filter fields are
  set (not left as "any").
- **Default severity:** medium (escalate to high if the unfiltered
  workflow does something consequential, e.g. a notification or an
  automated stage move — see pipelines-7).
- **Remediation:** `ghl-pipeline-specialist` + `ghl-workflow-specialist` —
  set both filters explicitly before treating the workflow as scoped.
- **Source:** `ghl-pipeline-specialist/references/stage-design.md` §3,
  citing `ghl-specialist references/trigger-gotchas.md` (Pipeline Stage
  Changed) and `references/common-audit-findings.md` #3.

### pipelines-7. Stage-change automation loop
- **What to look for:** Workflow A moves an opportunity into Stage X on
  some condition; Stage X's `Pipeline Stage Changed` trigger enrolls the
  opportunity back into Workflow A (directly, or via a short chain) — the
  pipeline-side instance of the tag-trigger loop (workflows-1).
- **Detection:** Map every `Pipeline Stage Changed` trigger against every
  stage-writing action (`opportunities-v3__update-opportunity` with a new
  `pipelineStageId`) across ALL workflows touching the pipeline, not just
  one workflow.
- **Default severity:** medium (escalate to high if the loop can run
  unbounded, i.e. any workflow in the chain has `allowMultiple: true`).
- **Remediation:** `ghl-pipeline-specialist` + `ghl-workflow-specialist` —
  break the cycle with an explicit guard checked before the loop-causing
  move fires again.
- **Source:** `ghl-pipeline-specialist/references/stage-design.md` §3.

### pipelines-8. Automating a rep's judgment call
- **What to look for:** A stage-move automation that advances a stage
  representing a **human decision** (e.g. auto-advancing "Qualified" the
  instant a call is booked, before a human actually qualifies the lead) —
  this erases the signal the stage existed to capture and makes the next
  report read healthier than the real pipeline is.
- **Detection:** For each automated stage-move action, check whether the
  destination stage name implies human judgment (qualification, decision,
  approval) rather than an externally observable event (form submitted,
  invoice paid, call booked, no-show recorded). Flag automations that skip
  the judgment step.
- **Default severity:** medium.
- **Remediation:** `ghl-pipeline-specialist` — automate only externally-
  observable threshold crossings; leave judgment-stage moves manual.
- **Source:** `ghl-pipeline-specialist/references/stage-design.md` §3.

---

## funnels

> Lightly-covered relative to workflows/pipelines — the harvested source
> material speaks mainly to tracking-pixel absence and ID-reference
> breakage; broad link-integrity scanning (e.g. arbitrary dead hyperlinks
> inside page content) is not grounded in any harvested source and is
> intentionally left out rather than invented.

### funnels-1. Missing tracking pixels/codes on a funnel running paid traffic
- **What to look for:** A funnel receiving paid traffic with no Facebook
  pixel, GA4, or Google Ads tag installed — ad platforms show conversions
  arriving while GHL-side attribution stays empty.
- **Detection:** `funnels__listFunnels` (or the internal
  `GET /funnels/funnel/fetch/{funnelId}` read, per
  `ghl-funnels-pages/references/recipes.md` §3/§5 field shape) — inspect
  `trackingCodeHead`/`trackingCodeBody` (funnel-level) and each page's
  `pageData.trackingCode.{headerCode,footerCode}` (page-level, via
  `GET /funnels/builder/page/data?pageId=`). Flag any funnel running paid
  traffic where both are empty.
- **Default severity:** medium (escalate to high if active paid-ad spend is
  confirmed and going untracked — real money lost to attribution
  blindness).
- **Remediation:** `ghl-funnels-pages` — inject the missing tracking code
  per recipe 5 (funnel- or page-level, matching the intended scope).
- **Source:** `ghl-specialist references/common-audit-findings.md` #13
  ("Pixels / tracking not installed"); read-only field-level detection
  signal grounded in `ghl-funnels-pages/references/recipes.md` §3, §5a/5b
  (`trackingCodeHead`/`trackingCodeBody`/`trackingCode.headerCode`/
  `trackingCode.footerCode` field names, confirmed live).

### funnels-2. Snapshot-imported funnel never re-verified (tracking dropped)
- **What to look for:** A sub-account provisioned from an agency snapshot
  where the funnel is live but tracking pixels never carried — pixels
  added through integrations don't transport with a snapshot push, unlike
  most other snapshot content.
- **Detection:** Cross-reference funnel-doc timestamps (recently
  provisioned) against the funnels-1 tracking-code check. A recently
  snapshotted account with empty tracking fields on a live, traffic-
  receiving funnel is a strong signal this is the cause, not a one-off
  oversight.
- **Default severity:** medium.
- **Remediation:** `ghl-funnels-pages` to re-inject tracking; flag to the
  account owner that every snapshot-imported funnel needs a post-import
  tracking/custom-value verification pass.
- **Source:** `ghl-specialist references/common-audit-findings.md` #13
  (snapshot-carry cross-reference); `ghl-orientation
  references/domain-gotchas.md` (Snapshots — "tracking pixels added through
  integrations... don't carry").

### funnels-3. Funnel/page reference breakage after clone or duplicate
- **What to look for:** A funnel or page cloned/duplicated gets a new
  `funnelId`/`pageId` — anything that referenced the old id (an external
  link, an ad's landing-page URL, a workflow's `Order Submitted`/`Abandoned
  Checkout` trigger bound to the old checkout flow id) silently stops
  resolving to the intended target while the original still exists,
  unlinked.
- **Detection:** `funnels__listFunnels`/page-list reads to inventory
  current ids; cross-reference against any workflow trigger bound to an
  order-form/checkout-flow id (via captured workflow JSON) and confirm the
  id still resolves to a live funnel/page.
- **Default severity:** medium (escalate to high if the broken reference
  sits on the account's primary paid-traffic landing page).
- **Remediation:** `ghl-funnels-pages` to repoint at the current id;
  `ghl-workflow-specialist` if the broken reference is trigger-side.
- **Source:** `ghl-orientation references/object-model.md` (Funnels/Pages
  — "a funnel cloned or duplicated gets a new funnelId, breaking anything
  that referenced the old one by ID"); parallel form-side pattern in
  `ghl-specialist references/trigger-gotchas.md` (Order Form / Order
  Submitted / Abandoned Checkout — "bound to specific ... IDs — same
  clone-breaks-reference risk as forms").

---

## calendars

### calendars-1. Round-robin distribution mode mismatch
- **What to look for:** A Round Robin calendar set to "Optimize for
  Availability" when the team is deliberately balancing workload (wrong
  mode gives all the leads to whoever's fastest, defeating the balance
  goal) — or set to "Equal Distribution" when the sales motion is
  speed-to-lead-sensitive (a lead waits for the "next up" rep even when
  someone else is free right now).
- **Detection:** `calendars__listCalendars` — for each Round Robin
  calendar, read `distributionType` and the `teamMembers` array. Cross-
  reference against the account brief's stated sales motion (inbound-
  speed-sensitive vs. deliberate rotation).
- **Default severity:** low to medium.
- **Remediation:** `ghl-orientation` domain knowledge is sufficient to
  confirm the mismatch with the user; no specialist build required to flip
  the setting, but confirm intent first.
- **Source:** `ghl-specialist references/common-audit-findings.md` #15
  ("Round-robin misconfigured"); `ghl-orientation
  references/domain-gotchas.md` (Calendars — Round Robin distribution
  modes).

### calendars-2. No hours/availability configured (silent always-open or never-bookable)
- **What to look for:** A calendar with no hours configured, or a
  business-hours-aware config with no linked hours — GHL does not error;
  it silently behaves as always-open or never-bookable depending on the
  config path.
- **Detection:** `calendars__listCalendars` — inspect each calendar's
  availability/hours configuration; flag any calendar with an empty hours
  block. Cross-reference against any business-hours-aware `wait` step in
  captured workflow JSON that links to this calendar.
- **Default severity:** medium.
- **Remediation:** `ghl-orientation` domain knowledge to diagnose;
  `ghl-workflow-specialist` if a linked `wait` step needs re-pointing at a
  correctly configured calendar.
- **Source:** `ghl-orientation references/domain-gotchas.md` (Calendars —
  "doesn't error — it silently behaves as always-open or never-bookable");
  `ghl-specialist references/action-gotchas.md` (Wait — business-hours-
  aware misconfiguration).

### calendars-3. No external calendar sync (double-booking risk)
- **What to look for:** A Service or Round Robin calendar with no Google/
  Outlook calendar connected — GHL never sees bookings made outside it,
  producing double-bookings it can't detect.
- **Detection:** `calendars__listCalendars` — check `googleCalendarId`/
  `outlookCalendarId` fields per calendar; flag any Service or Round Robin
  calendar with both empty.
- **Default severity:** medium (escalate to high if the business reports
  actual double-bookings).
- **Remediation:** Connect the external calendar via Settings →
  Integrations; no specialist build required, but confirm which calendar
  system the business actually runs on before connecting.
- **Source:** `ghl-specialist references/common-audit-findings.md` #5
  ("Missing core connections" — "Flag any Service or Round Robin calendar
  with no external-calendar sync (conflicts risk)"); `ghl-orientation
  references/object-model.md` (Calendars — "external calendar sync ...
  left unconnected causes double-bookings").

### calendars-4. Reminder workflows that never re-fire
- **What to look for:** A Birthday Reminder / Custom Date Reminder / Task
  Reminder-triggered workflow with `allowMultiple: false` — reminders need
  to re-fire every cycle (every birthday, every recurring date), and
  `false` means the second and every subsequent occurrence silently never
  sends.
- **Detection:** For each reminder-triggered workflow in captured JSON,
  read `settings.allowMultiple`; flag `false` on this trigger family
  specifically (the opposite convention from welcome/drip workflows —
  see workflows-5).
- **Default severity:** medium.
- **Remediation:** `ghl-workflow-specialist` — set `allowMultiple: true`
  on reminder-triggered workflows.
- **Source:** `ghl-specialist references/common-audit-findings.md` #8
  ("Reminders never re-fire ... If trigger is Birthday Reminder / Custom
  Date Reminder / Task Reminder and `allowMultiple: false` → flag").

### calendars-5. Timezone trap on date-anchored reminders/appointments
- **What to look for:** A reminder or appointment-adjacent automation
  firing at inconsistent local hours because contact-scoped date triggers
  evaluate in the **contact's** timezone, and a blank timezone field
  silently falls back to the location default — producing a mix of fire
  times with no visible pattern in the builder.
- **Detection:** For any date-anchored reminder reported as firing at odd
  hours, sample the enrolled contacts' timezone field values; a mix with
  no standard confirms the cause.
- **Default severity:** low to medium.
- **Remediation:** `ghl-workflow-specialist` — if the business needs strict
  scheduling regardless of contact timezone, a scheduler-trigger-driven
  watcher is the correct redesign, not a date-reminder trigger.
- **Source:** `ghl-specialist references/trigger-gotchas.md` (Birthday
  Reminder / Custom Date Reminder — evaluates in contact timezone);
  `ghl-orientation references/domain-gotchas.md` (Calendars — timezone
  traps).

### calendars-6. Appointment-status re-entry bypass feeding a non-per-event-safe workflow
- **What to look for:** The Appointment Status trigger bypasses
  `allowMultiple` entirely and always re-runs per appointment — expected
  behavior — but if the downstream actions are a generic contact-scoped
  "welcome" message rather than an appointment-specific one, a contact
  with several appointments in a week gets spammed with the same message
  repeatedly.
- **Detection:** For workflows triggered by Appointment Status, confirm
  (via captured JSON) that downstream Send Email/SMS content is scoped to
  the specific appointment (status-specific messaging), not a generic
  contact-level message reused across every appointment.
- **Default severity:** medium.
- **Remediation:** `ghl-workflow-specialist` — scope messaging/state to
  the specific appointment, not the contact generally.
- **Source:** `ghl-specialist references/trigger-gotchas.md` (Appointment
  Status — "don't flag a contact who entered 5 times ... that's by design
  ... Do flag it if the downstream actions aren't per-appointment-safe");
  `ghl-orientation references/domain-gotchas.md` (Calendars — no-show
  mechanics).

---

## forms

### forms-1. Active form with no downstream trigger (leads vanish)
- **What to look for:** A form is built and actively collecting
  submissions, but no workflow reacts to it — the lead goes into the void
  with nobody following up.
- **Detection:** `forms__listForms` for all form ids; `forms__listFormSubmissions`
  per form to identify which forms have submissions in the last 30 days
  (active intake). For each active form, inspect captured workflow JSON for
  a Form Submitted trigger pointing at that specific form id. Flag any
  active form with no matching downstream trigger.
- **Default severity:** medium (escalate to high if the form is the
  account's primary lead-intake channel).
- **Remediation:** `ghl-workflow-specialist` — build or re-point the
  Form Submitted-triggered workflow.
- **Source:** `ghl-specialist references/common-audit-findings.md` #12
  ("Forms not feeding workflows").

### forms-2. Form clone breaks the trigger reference (ID vs. name)
- **What to look for:** A form gets cloned to "make a copy"; the clone
  gets a new form id. The old Form Submitted trigger still points at the
  old id and stops firing — nothing alerts the builder, and the new
  (cloned) form keeps collecting submissions the whole time with no
  follow-up.
- **Detection:** When a workflow lists a Form Submitted trigger, confirm
  the referenced form id still exists in `forms__listForms`. When form
  submission volume is reported as having "dropped suddenly," check for a
  recent form clone/replace as the likely cause.
- **Default severity:** medium (escalate to high if this is the primary
  intake form).
- **Remediation:** `ghl-workflow-specialist` — repoint the trigger at the
  current form id.
- **Source:** `ghl-specialist references/trigger-gotchas.md` (Form
  Submitted — "bound to a specific form ID ... Cloning a form produces a
  new ID"); `ghl-orientation references/domain-gotchas.md` (Forms/Surveys
  — "one of the most common 'leads vanish' causes").

### forms-3. Field-mapping drift not confirmable via public API (recon-limited)
- **What to look for:** A form field's mapping to a contact/custom field is
  addressed internally by field key, not by the visible label — a
  cosmetic label rename never breaks the mapping, but the mapping itself
  (and any conditional show/hide logic) lives entirely in the form builder
  UI and is not exposed by the public API's read-only forms/surveys
  categories (list + submissions only).
- **Detection:** Cross-check a sample of recent submissions
  (`forms__listFormSubmissions`) against the expected contact fields they
  should have populated. A submission field with no corresponding value
  landing on the contact record (via `contacts__searchContacts`/
  `getContact`) is the observable symptom of a mapping problem; the
  mapping configuration itself requires a UI read, which this rule flags
  as a recon limitation rather than asserting a specific miswiring.
- **Default severity:** low (recon-limited finding — report the symptom
  and the limitation, don't over-claim the cause without a UI read).
- **Remediation:** `ghl-orientation` domain knowledge to explain the ID-
  vs-label distinction to the user; the actual field-mapping fix requires
  a form-builder UI session, out of scope for any current specialist.
- **Source:** `ghl-orientation references/domain-gotchas.md` (Forms/
  Surveys — "Field mapping is by ID, not by label" and "Conditional logic
  ... is UI-only, not inspectable via the public API's read-only forms/
  surveys categories").

---

## messaging

### messaging-1. Email/SMS deliverability broken
- **What to look for:** Low open rates, bounce spikes, messages landing in
  spam, missing SMS delivery receipts — the classic "my emails aren't
  getting through" complaint.
- **Detection:** Email: pull the sending domain (`locations__getLocation`
  → `emailSettings.fromEmail`); check SPF/DKIM/DMARC for that domain via a
  read-only DNS lookup. SMS: pull phone numbers and check A2P 10DLC
  brand/campaign registration status; pull recent conversations
  (`conversations` category) and count outbound SMS with a failed delivery
  status, flagging if the fail rate exceeds roughly 2%.
- **Default severity:** medium baseline; escalate to high if A2P 10DLC is
  unregistered while actively sending US SMS (suspension risk), or if the
  sender domain has no DMARC at all while sending at volume (deliverability
  collapse / blacklisting risk).
- **Remediation:** narrative/settings fix (Settings → Email Services /
  Phone Numbers) — no specialist build required; this is a configuration
  gap, not a workflow or pipeline design issue.
- **Source:** `ghl-specialist references/common-audit-findings.md` #1
  (tier-1, most-cited finding).

### messaging-2. Send Email/SMS referencing a deactivated user
- **What to look for:** A Send Email/Send SMS action configured with
  `userType: user` (sends as a named in-account user) whose referenced
  `selectedUser` has since been deactivated — the send silently breaks.
- **Detection:** For every Send Email/Send SMS action with
  `userType: user` in captured workflow JSON, confirm the referenced user
  is still active via `users__listUsers`.
- **Default severity:** medium (escalate to high on a revenue-path
  message, e.g. a booking confirmation).
- **Remediation:** `ghl-workflow-specialist` — repoint at an active user or
  switch to `custom_email`/a shared sender.
- **Source:** `ghl-specialist references/action-gotchas.md` (Send Email,
  Send SMS — "confirm the selectedUser still resolves — deleted/
  deactivated users silently break the send").

### messaging-3. Nurture gating on unreliable open/click signals
- **What to look for:** A workflow branch gates progression on "email
  opened" (or "clicked") alone — both signals depend on a tracking pixel/
  link rewrite that Apple Mail Privacy Protection, corporate firewalls, and
  many privacy tools silently block, making the signal directionally
  useful at best, not reliable for scoring or gating.
- **Detection:** Scan captured workflow JSON for an Email Events trigger/
  if_else condition keyed only on `opened` or `clicked` with no OR
  condition against reply/link-visit/other signals.
- **Default severity:** low to medium (higher if the gated action is a
  revenue-path escalation, e.g. sales handoff).
- **Remediation:** `ghl-workflow-specialist` — recommend dual-signal gates
  (open OR click OR reply OR site visit).
- **Source:** `ghl-specialist references/trigger-gotchas.md` (Email Events
  — "opened and clicked ... directionally useful, not reliable").

### messaging-4. Messaging Error – SMS not monitored
- **What to look for:** An account with significant SMS volume and no
  workflow reacting to the Messaging Error – SMS trigger — outbound
  failures surface silently with nobody alerted.
- **Detection:** Confirm SMS volume is meaningful (via recent
  conversations); confirm (via captured workflow JSON) no workflow uses the
  Messaging Error – SMS trigger.
- **Default severity:** low to medium.
- **Remediation:** `ghl-workflow-specialist` — build a monitoring workflow
  on this trigger (internal notification to ops).
- **Source:** `ghl-specialist references/trigger-gotchas.md` (Messaging
  Error – SMS — "rarely configured even when it should be").

### messaging-5. Customer Replied channel-scope misassumption
- **What to look for:** A workflow assumes Customer Replied means "SMS
  reply only," but the trigger fires on a reply to ANY connected channel
  (SMS, email, Facebook, Instagram, WhatsApp, Google Business Messages,
  live chat) — an email-oriented workflow ends up running against a
  Facebook comment reply.
- **Detection:** Inspect the Customer Replied trigger's config in captured
  workflow JSON for a channel filter. If absent and the workflow does
  channel-specific work downstream (e.g. sends SMS back unconditionally),
  flag as likely misrouted.
- **Default severity:** medium.
- **Remediation:** `ghl-workflow-specialist` — add an explicit channel
  filter or branch on channel before channel-specific actions.
- **Source:** `ghl-specialist references/trigger-gotchas.md` (Customer
  Replied — "fires on reply to ANY connected channel").

### messaging-6. Duplicate-message overlap (cross-reference)
- **What to look for:** See workflows-3 — the same structural cause
  (overlapping workflow trigger scope with no communication-limit
  governor) is also the account's most-cited **messaging**-surface
  symptom (contacts reporting repeat sends).
- **Detection:** Same detection as workflows-3; file the finding on
  whichever surface the evidence more directly supports, or cross-
  reference between the two per the finding schema's `cross_refs` field
  rather than duplicate-filing.
- **Default severity:** medium (escalate to high per workflows-3's
  criteria).
- **Remediation:** `ghl-workflow-specialist`.
- **Source:** `ghl-specialist references/common-audit-findings.md` #2.

---

## tracking

> Lightly-covered surface. The harvested source material grounds pixel-
> absence and its snapshot-import cause solidly (shared with funnels-1/
> funnels-2 above, filed here when the finding is framed as an attribution/
> tracking gap rather than a funnel-build gap). Duplicate-pixel detection
> specifically is **not** grounded in any harvested source — it is
> intentionally omitted rather than invented; if that failure mode is
> observed in a live account, it belongs in the learning-log process
> (`ghl-specialist` spec §10.2 convention), not asserted here as a rule.

### tracking-1. Missing conversion tracking on a paid-traffic surface
- **What to look for:** Ad platforms show conversions arriving while
  GHL-side attribution (Facebook pixel, GA4, Google Ads tag) is empty —
  see funnels-1 for the funnel-level version of this same defect; file
  here when the audit's framing is attribution/measurement rather than the
  funnel build itself.
- **Detection:** Same as funnels-1 — read `trackingCodeHead`/
  `trackingCodeBody` (funnel-level) or `pageData.trackingCode` (page-
  level) via the read-only funnel/page GETs.
- **Default severity:** medium (escalate to high with confirmed active
  paid-ad spend).
- **Remediation:** `ghl-funnels-pages`.
- **Source:** `ghl-specialist references/common-audit-findings.md` #13;
  `ghl-funnels-pages/references/recipes.md` §3, §5a/5b (field-level
  read-only signal).

### tracking-2. Snapshot-import tracking gap (cross-reference)
- **What to look for:** See funnels-2 — pixels added through integrations
  are explicitly excluded from snapshot carry, so a recently-provisioned
  sub-account is a strong prior for this specific tracking gap.
- **Detection:** Same as funnels-2.
- **Default severity:** medium.
- **Remediation:** `ghl-funnels-pages` to re-inject; flag the systemic
  snapshot-verification gap to the account owner.
- **Source:** `ghl-orientation references/domain-gotchas.md` (Snapshots —
  "tracking pixels added through integrations ... don't carry").

---

## ai-agents

> Lightly-covered surface — the harvested source material speaks to
> Conversation AI specifically (the public `conversation-ai` category in
> v1, per the plan's scope note) and to the shared AI-wallet cost-cap
> gotcha; deeper Conversation AI internals (bot prompts, KB content, Flow
> Builder graphs) are UI-only and not exposed by the public API, so
> detection here is necessarily shallower than the workflow/pipeline
> surfaces.

### ai-agents-1. Thin knowledge base (hallucination risk)
- **What to look for:** A Conversation AI bot with a knowledge base too
  thin to answer real questions accurately — it hallucinates, or escalates
  every conversation to a human, or gives wrong answers about pricing/
  hours/policy.
- **Detection:** Inspect each Conversation AI agent's knowledge base
  (`conversation-ai` category, or a read-only UI inspection where the
  category doesn't expose KB content). Flag any agent with fewer than
  roughly 5 KB documents or KB content totaling under roughly 5,000
  characters.
- **Default severity:** low for cosmetic hallucinations, medium if the
  bot handles support or closing sales.
- **Remediation:** narrative — KB authoring is a content task for the
  account owner, not a specialist build in this plugin's current scope.
- **Source:** `ghl-specialist references/common-audit-findings.md` #17
  ("Conversation AI trained on thin KB").

### ai-agents-2. No human-handoff / fallback path
- **What to look for:** A Conversation AI agent's flow has no explicit
  fallback/escalate-to-human node — a conversation the bot can't handle
  has nowhere to go.
- **Detection:** Inspect each agent's Flow Builder graph (UI-level; not
  exposed by the public API) for an explicit fallback/escalation branch.
  Where the graph itself can't be read via API, treat this as a
  UI-inspection-required item rather than a pure-MCP finding.
- **Default severity:** medium (this is the highest-signal ai-agents
  defect in the harvested material — a bot with no exit path is a
  customer-experience risk regardless of KB quality).
- **Remediation:** narrative — flow redesign is a content/config task for
  the account owner; no specialist build in this plugin's current scope
  owns Conversation AI flow authoring (v1.1 deferred, per the plan's
  out-of-scope note on a future `ghl-ai-agents-specialist`).
- **Source:** `ghl-specialist references/common-audit-findings.md` #17
  ("any agent whose Flow Builder has no explicit fallback/escalate-to-
  human node").

### ai-agents-3. No cost/volume cap (cross-reference)
- **What to look for:** See workflows-10 — an AI action (which may itself
  be a Conversation AI bot handoff or an AI Prompt step) sitting behind a
  high-frequency or public trigger with no rate limit.
- **Detection:** Same as workflows-10; file on the ai-agents surface when
  the finding is framed around the agent/bot itself rather than a
  workflow's AI Prompt step.
- **Default severity:** medium (escalate to high on a public/
  unauthenticated trigger surface).
- **Remediation:** `ghl-workflow-specialist` for the rate-limit gate.
- **Source:** `ghl-specialist references/action-gotchas.md` (AI Prompt,
  Conversation AI Bot action).

### ai-agents-4. Conversation AI internals not inspectable via public API (recon limitation)
- **What to look for:** Not a defect in the account — a limitation of this
  auditor's recon depth. The Conversation AI agent's prompt, knowledge-base
  content, and Flow Builder graph are UI-only; the public
  `conversation-ai` category covers agent CRUD, not prompt/KB/flow-graph
  authoring.
- **Detection:** N/A (this entry exists so a surface-auditor reports the
  recon gap honestly rather than silently under-covering the surface, or
  overclaiming coverage it didn't actually have).
- **Default severity:** n/a — not a finding; a caveat to carry into the
  audit report's methodology notes for this surface.
- **Remediation:** n/a.
- **Source:** `ghl-specialist references/action-gotchas.md` (Conversation
  AI Bot action — "Bot config itself is not exposed via public API").

---

## Coverage summary

| Surface | Rule count | Coverage |
|---|---|---|
| workflows | 16 (4 runtime-proven, `13–16`) | full |
| pipelines | 8 | full |
| funnels | 3 | lightly-covered (see note) |
| calendars | 6 | full |
| forms | 3 | full within available material |
| messaging | 6 | full |
| tracking | 2 | lightly-covered (see note) |
| ai-agents | 4 (incl. 1 recon-limitation caveat) | lightly-covered (see note) |

8 of 8 surfaces present. Every rule above cites a source; none is
invented. Where a rule's grounding is thin, the surface's heading note says
so explicitly rather than papering over it with invented specifics.

## How to extend

When a surface-auditor run confirms a defect not covered by any rule above,
follow the `ghl-specialist` learning-log convention (propose the addition
with a concrete detection rule, get the rule reviewed, then add it here with
its source) rather than acting on an ungrounded ad hoc rule mid-audit.
