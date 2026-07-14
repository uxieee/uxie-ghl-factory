# Opportunity Rules — per-surface catalog

> The OPPORTUNITY lens (`altitude: opportunity` in the finding schema —
> things **absent or under-leveraged**, as distinct from `defect` findings,
> which are things **present and wrong**; that's `ghl-defect-catalog`, a
> separate catalog). Every rule below is **derived** from a brief-goal
> category plus a recon/defect signal — not harvested verbatim from a defect
> list, per the plan's instruction that opportunity rules are judged against
> the brief, not lifted from `common-audit-findings.md` wholesale. Where a
> rule leans on harvested material for its detection method or its "what good
> looks like" baseline, that material is cited under **Grounding**.

Rule id convention: `<surface>-o<n>` — the `o` distinguishes this catalog's
ids from `ghl-defect-catalog`'s `<surface>-<n>` ids so a finding or a
cross-reference is unambiguous about which lens raised it, even though both
catalogs share the same eight-surface enum from the finding schema. Ids are
stable within this catalog; a live audit run's finding ids are not the same
sequence (a run may skip rules whose brief-goal category the account's brief
doesn't touch at all — see Ground rule 3 in `SKILL.md`).

Every rule's **Signal** is read-only: an MCP `search_actions`/`execute_action`
call (GET-shaped), a read-only `get-ghl-workflow-json` capture, or a
read-only browser/Playwright inspection — confirming absence never requires
a write. Every rule's **Ties to** line names the *category* of ranked brief
goal the opportunity advances (revenue-path speed, lead-volume capture, list
monetization, reputation/referral, sales-process visibility) — at audit time,
the surface-auditor's `brief_tieback` field names the actual line from the
actual `.ghl/<locationId>/brief.md`, not this category label.

**Severity defaults are starting points, not verdicts** — same rubric as
`ghl-defect-catalog` (`ghl-audit-primitives/references/audit-io.md` §2). An
opportunity with no plausible tieback to a goal the brief actually ranks is
capped at `low` regardless of how compelling the gap looks in isolation — see
`audit-io.md`'s brief-goal gate.

---

## workflows

### workflows-o1. Slow or absent speed-to-lead
- **Signal:** A live intake path exists (a `form_submission`, `contact_created`,
  or `facebook_lead_gen` trigger with recent submissions/enrollments) but no
  workflow attached to it fires an immediate contact-facing action — no
  `sms`/`email`/`assign_user` within the first few minutes, only a delayed
  drip, or nothing at all. Confirm via `get-ghl-workflow-json` captures: for
  each active intake trigger, check whether the *first* action in the graph
  is an immediate send/assign, versus a `wait` of hours/days or a dead end.
- **Ties to:** revenue-path speed goals — any ranked goal about converting
  inbound leads faster, reducing lead response time, or not losing leads to a
  faster-responding competitor. If the brief's "Lead sources & volume"
  section describes a time-sensitive channel (inbound calls, paid-ad forms)
  with no matching "Goals — ranked" line, the tieback is still plausible
  (speed-to-lead is close to universally revenue-relevant for inbound
  channels) but should be scored conservatively per the brief-goal gate.
- **Default severity:** medium (escalate to high when the brief names
  response speed explicitly, or the intake channel is high-volume/paid).
- **Remediation:** `ghl-workflow-specialist` — build the lead-score/
  speed-to-lead nurture shape (assign + immediate SMS/notification on the
  hot branch, drip on the cold branch).
- **Grounding:** what "good" looks like —
  `ghl-workflow-specialist/references/patterns.md` §1 ("Lead-score /
  speed-to-lead nurture"); the local-service reference pipeline's explicit
  "New Lead entry → speed-to-lead workflow" automation call-out
  (`ghl-pipeline-specialist/references/reference-pipelines.md` §1). Absence
  detection method mirrors `ghl-specialist references/common-audit-findings.md`
  #12's active-intake-with-no-downstream-trigger pattern, retargeted from "no
  workflow at all" to "no *immediate* action."

### workflows-o2. A manual step that could be automated
- **Signal:** A workflow's response to a repeatable, high-frequency trigger
  ends in a human hand-off (a `task-notification`/`internal_notification`
  action assigning a person to do something) with no automated action doing
  the mechanical part first (e.g., no `update_contact_field`/`add_contact_tag`/
  `create_opportunity` alongside the task) — every occurrence of the trigger
  costs a human the same repetitive action a workflow step already covers
  elsewhere in the corpus. Also flag ≥2 adjacent single-channel notification
  steps standing in for one consolidated action, per the corpus-observed
  anti-pattern.
- **Ties to:** operational-efficiency goals — any ranked goal about scaling
  without adding headcount, reducing admin/rep busywork, or freeing staff
  time for higher-value work.
- **Default severity:** low to medium (escalate when the manual step sits on
  a high-frequency trigger — the labor cost compounds with volume).
- **Remediation:** `ghl-workflow-specialist` — replace or pair the manual
  hand-off with the equivalent automated action; consolidate redundant
  notification steps into one action's multi-channel config.
- **Grounding:** the consolidation instance is a harvested finding, not a
  hypothesis — `ghl-specialist references/action-gotchas.md` ("chaining four
  consecutive `internal_notification` steps... instead of configuring the
  four channels within a single action... flag as consolidation
  opportunity"). The general "manual where an automated equivalent exists"
  framing is derived from the action catalog's own good/bad contrast
  (`ghl-workflow-specialist/references/trigger-action-catalog.md` §2, action
  types available vs. what a given workflow actually uses).

### workflows-o3. No review/reputation loop
- **Signal:** A completed-transaction event exists (an `Order`/`Invoice`
  trigger firing, a pipeline stage representing a finished job/purchase per
  `pipelines-o1`'s stage-state read) but no workflow downstream sends a
  review-request action, and no review-link custom value is referenced
  anywhere in captured workflow JSON.
- **Ties to:** reputation/referral goals — any ranked goal mentioning online
  reviews, local search ranking, word-of-mouth, or repeat/referral business.
- **Default severity:** low to medium (escalate to high if the brief ranks
  local-search visibility or reputation as a primary goal, or the business
  model depends on review volume for conversion, e.g. local service).
- **Remediation:** `ghl-workflow-specialist` — build a per-transaction
  review-request sequence (invoice-scoped, so treat re-entry the same as any
  invoice-triggered action per that specialist's per-event-safety guidance);
  `ghl-pipeline-specialist` if the trigger should be a stage entry instead of
  the invoice event directly.
- **Grounding:** the "what good looks like" shape is named explicitly, twice,
  in `ghl-pipeline-specialist/references/reference-pipelines.md` — the
  local-service shape (§1, "Completed — Invoiced entry → invoice-sent +
  review-request sequence") and the e-commerce shape (§3, "New Customer entry
  → post-purchase thank-you + review-request sequence"). Its absence is not
  independently harvested as a named defect in the source material — this
  rule is derived (a positive-pattern absence), not lifted from a defect
  list, per this catalog's mandate.

### workflows-o4. No database-reactivation / win-back campaign
- **Signal:** The account has a meaningful contact base with a real
  distribution of last-activity dates (via `contacts__searchContacts` /
  equivalent bucketed by last-activity or last-purchase) but no workflow
  triggers on an "inactive"-style tag and no scheduled/Stale-Opportunity-style
  watcher computes staleness at all — the database is never mined for
  revenue a second time.
- **Ties to:** list-monetization goals — any ranked goal about revenue from
  the existing customer/lead base, reducing dependency on new-lead
  acquisition cost, or re-engaging past customers/no-shows/cold leads.
- **Default severity:** low to medium (escalate to high if the brief ranks
  CAC reduction or "revenue from existing list" explicitly, or the contact
  base is large relative to active/live workflow volume).
- **Remediation:** `ghl-workflow-specialist` — build the DB-reactivation
  shape (an upstream watcher tags contacts inactive past a threshold; the
  reactivation workflow branches by staleness bucket).
- **Grounding:** `ghl-workflow-specialist/references/patterns.md` §2 ("DB
  reactivation / re-engagement") is the exact worked pattern this rule
  checks for the absence of, including its own caveat that GHL has no native
  "time since last activity" trigger — so absence-of-a-computed-watcher is
  the correct signal, not absence of a single native trigger type. Cross-
  references `ghl-pipeline-specialist/references/reference-pipelines.md` §3's
  "Churn Risk (Stale)" stage as the pipeline-side version of the same idea
  for e-commerce/repeat-purchase motions.

---

## pipelines

### pipelines-o1. Pipeline stages don't match the stated sales motion
- **Signal:** Read the account's live pipeline(s) (`opportunities-v3__get-
  pipeline`/`get-pipelines`) and compare the stage list against (a) the
  default-name smell (`New`, `Contacted`, `Qualified`, `Won`, `Lost` left
  unedited) and (b) whichever of the four reference sales-motion shapes
  (local-service, coaching/high-ticket, e-commerce/repeat-purchase, agency/
  B2B retainer) the brief's "Business"/"Offer & pricing" sections most
  resemble. A mismatch is stages that don't represent real states in the
  account's actual sales motion (task-phrased names, missing a state the
  motion clearly has — e.g. no "quote sent" state for a quote-driven local
  service — or a motion-appropriate automation absent per the matched
  shape's "Automate" list).
- **Ties to:** sales-process visibility goals — any ranked goal about
  forecast accuracy, knowing where deals actually stand, or reducing deals
  falling through the cracks.
- **Default severity:** medium (escalate to high if a stage the sales motion
  requires is entirely missing on the account's primary revenue-path
  pipeline, or if the account is currently using the pipeline for reporting
  the brief relies on).
- **Remediation:** `ghl-pipeline-specialist` — redesign against
  `references/stage-design.md` §1 (stages-as-states, the collapsing rule)
  and the matching shape in `references/reference-pipelines.md`; follow that
  skill's full-replacement (`update-pipeline`) working protocol rather than
  improvising a stage edit.
- **Grounding:** `ghl-pipeline-specialist/references/stage-design.md` §1
  (default-name smell, itself citing `ghl-specialist
  references/common-audit-findings.md` #3 "default-pipeline-never-
  customized") and `references/reference-pipelines.md` (all four shapes,
  each stated as "starting hypotheses to confirm against the account's real
  sales motion during intake, not answers to skip intake with" — this rule
  respects that framing; it flags a *mismatch*, not a deviation from a
  template).

---

## funnels

### funnels-o1. Funnel leak — traffic with no capture/nurture
- **Signal:** A funnel/page exists and the brief's "Lead sources & volume"
  section (or recon of ad-platform/tracking signals) confirms traffic is
  arriving, but read-only recon of the funnel shows either (a) no lead-
  capture form/opt-in step at all (`funnels/funnel/fetch` steps array has no
  `optin_funnel_page` type step ahead of a sales/checkout step), or (b) a
  capture step exists but no `form_submission` trigger on that form's id
  fires any downstream workflow — the classic "form was cloned, trigger
  still points at the old id" failure applies here too.
- **Ties to:** lead-volume-capture goals — any ranked goal about converting
  existing traffic/spend into leads, or not wasting paid-ad budget on a leaky
  top of funnel.
- **Default severity:** medium (escalate to high if the brief confirms
  active paid-ad spend feeding the funnel — traffic is being paid for and
  lost).
- **Remediation:** `ghl-funnels-pages` — build/repair the capture step;
  `ghl-workflow-specialist` — attach the nurture sequence once capture is
  wired.
- **Grounding:** the underlying "form exists, no downstream trigger" failure
  mode is harvested (`ghl-specialist references/common-audit-findings.md`
  #12, "Forms not feeding workflows" — including the specific clone-breaks-
  trigger-id cause); this rule reframes it at the funnel/traffic level per
  the plan's funnel-leak framing rather than the forms-surface framing.
  Funnel/page structural fields (`steps[]`, step `type`) per
  `ghl-funnels-pages/references/recipes.md` §§1-3.

---

## ai-agents — best-effort (spec §10 honesty marker)

> **Depth caveat, stated up front:** v1's opportunity detection on this
> surface is **best-effort**, not full coverage. The public `conversation-ai`
> MCP category (confirmed live, `conversation-ai-v3`, 12 actions) covers
> agent **CRUD** — whether an agent object exists, its channel/assignment
> config — and nothing about its prompt, knowledge-base content, or Flow
> Builder graph, which are UI-only
> (`ghl-orientation/references/api-worlds.md`; also the defect-catalog's
> `ai-agents-4` recon-limitation entry, same underlying gap). This rule
> **does not and cannot** claim to detect whether an *existing* agent is any
> good — that's `ghl-defect-catalog`'s `ai-agents-1`/`ai-agents-2` territory,
> and even those are marked lightly-covered. This rule only ever asserts the
> shallower claim: an agent object is entirely absent where recon suggests
> conversation volume that would benefit from one. **No non-public AI backend
> route is referenced anywhere in this rule or this file** — only the
> confirmed public `conversation-ai` category.

### ai-agents-o1. Missing AI agent where conversation volume warrants one (best-effort)
- **Signal (best-effort):** The brief's "Lead sources & volume" section (or
  a read-only pull of recent inbound conversation volume via the
  `conversations` category) shows meaningful inbound chat/SMS/DM volume, but
  `conversation-ai-v3` list/get calls show zero agents configured for the
  location. This is a *presence* check only — it cannot and does not assess
  whether an existing agent (if one is found) is well-built; that assessment
  is out of scope for this rule and largely out of reach read-only in v1.
- **Ties to:** response-coverage / after-hours-capture goals — any ranked
  goal about not losing leads outside business hours, handling FAQ/support
  volume without adding headcount, or improving first-response coverage on
  high-volume channels.
- **Default severity:** low, capped there regardless of signal strength —
  this surface's detection depth doesn't support higher confidence (see the
  honesty marker above), and the rule can't confirm whether a lighter-weight
  fix, e.g. a workflow-based speed-to-lead per `workflows-o1`, would serve
  the brief's goal just as well without an AI agent at all.
- **Remediation:** narrative — recommend evaluating a Conversation AI agent
  for the channel; actual prompt/KB authoring and Flow Builder design are a
  content/config task for the account owner (or a future
  `ghl-ai-agents-specialist`, out of this plugin's current scope per the
  plan's v1.1-deferred note) rather than a build this catalog's remediation
  pointer can hand to an existing specialist.
- **Source:** public-category confirmation —
  `ghl-workflow-specialist/references/trigger-action-catalog.md` (line 157
  area, "`conversation-ai-v3` (12 actions, live-verified) covers agent CRUD");
  `ghl-orientation/references/api-worlds.md` (Conversation AI agents CRUD
  listed under "what it covers well"; bot configuration listed under "known
  gaps"). This rule is derived, not harvested — no source names "missing AI
  agent" as a defect; the adjacent thin-KB/no-fallback defects
  (`ghl-defect-catalog` `ai-agents-1`/`ai-agents-2`) assume an agent already
  exists, which is exactly the gap this rule fills for the opportunity lens.

---

## tracking — best-effort (spec §10 honesty marker)

> **Depth caveat, stated up front:** this surface is lightly-covered in the
> harvested source material generally (see `ghl-defect-catalog`'s own
> tracking-surface note) and v1's opportunity-level detection here is
> correspondingly **best-effort**: read-only recon can confirm a pixel/tag
> field is present or empty, but cannot verify the tag actually fires
> correctly, cannot verify attribution accuracy end-to-end, and cannot
> inspect anything beyond the funnel/page-level tracking-code fields exposed
> by the read-only GETs.

### tracking-o1. No measurement in place to prove the brief's ranked goals (best-effort)
- **Signal (best-effort):** The brief names a ranked, measurable goal (e.g.
  "increase booked calls from paid ads," "grow email-attributed revenue")
  but read-only recon of the relevant funnel(s)/page(s)
  (`trackingCodeHead`/`trackingCodeBody` at the funnel level,
  `pageData.trackingCode` at the page level — same fields `funnels-o1` and
  `ghl-defect-catalog`'s `tracking-1` read) shows no pixel/tag installed on
  the surface that goal depends on. This only confirms **absence of the
  tracking field**, not whether tracking, if present, is configured
  correctly or firing — that deeper verification is out of reach read-only.
- **Ties to:** whichever specific ranked goal named a measurable outcome —
  the tieback here is unusually direct (the goal literally can't be reported
  on without this), but the severity stays capped low given the shallow
  detection depth (see below).
- **Default severity:** low (capped regardless of how directly the goal ties
  in, because this rule cannot confirm the deeper problem — a tag being
  present but broken — that would justify a higher tier; that deeper check
  is `ghl-defect-catalog`'s `tracking-1`/`tracking-2`, not this rule).
- **Remediation:** `ghl-funnels-pages` — install the missing tracking code
  at the appropriate scope (funnel-level for account-wide tags, page-level
  for one-off pixels), per that skill's recipes §5a/§5b.
- **Grounding:** field-level signal and endpoints are the same ones
  `ghl-defect-catalog`'s `tracking-1` cites —
  `ghl-funnels-pages/references/recipes.md` §3, §5a/§5b; harvested defect
  basis for "traffic arriving with attribution empty" is `ghl-specialist
  references/common-audit-findings.md` #13. This rule is the opportunity-
  lens reframing (measurement absent relative to a *stated goal*, not just
  "pixel field is empty") of the same underlying signal, kept intentionally
  narrow per the honesty marker above.

---

## Coverage summary

| Surface | Rule count | Coverage |
|---|---|---|
| workflows | 4 | derived, brief-judged |
| pipelines | 1 | derived, brief-judged |
| funnels | 1 | derived, brief-judged |
| ai-agents | 1 | **best-effort** — public `conversation-ai` category only |
| tracking | 1 | **best-effort** — field-presence only, no firing/accuracy check |

8 rules across 5 of the 8 finding-schema surfaces. `calendars`, `forms`, and
`messaging` have no dedicated opportunity rule in v1 — not an oversight:
their absence-relative-to-brief signals are already carried by the rules
above (e.g. a calendar/booking gap shows up as `workflows-o1`'s speed-to-lead
signal; a forms gap shows up as `funnels-o1`). A future revision may split
these out if a live audit finds the merged framing loses signal; follow the
"How to extend" convention below rather than adding an ungrounded rule ad
hoc.

Every rule above states its brief-goal tieback **category** explicitly (the
`Ties to` line) and its remediation pointer; the `ai-agents` and `tracking`
sections carry an explicit best-effort marker per spec §10, and neither
references any non-public AI backend route — only the confirmed public
`conversation-ai` MCP category.

These are **Tier-1** deep-catalog surfaces. Under-leveraged-vs-brief signals on the
**Tier-2** surfaces (contacts, commerce, deliverability, memberships, social, …) are
caught every run by the baseline protocol's "populated-vs-expected" check
(`ghl-audit-primitives` `references/audit-io.md` §5), marked `coverage: baseline` —
not by opportunity rules here. See §5 for the full surface coverage map.

> **Provenance note:** citations to `ghl-specialist/...` mark where a rule was harvested
> from — that is a separate USER-LEVEL skill (`~/.claude/skills/ghl-specialist`), **not
> bundled here**. Provenance only, not loadable references.

## How to extend

When a surface-auditor run confirms an opportunity pattern not covered by any
rule above, follow the `ghl-specialist` learning-log convention (propose the
addition with a concrete signal and a plausible brief-goal category, get the
rule reviewed, then add it here with its grounding) rather than acting on an
ungrounded ad hoc rule mid-audit. A rule with no plausible brief-goal category
does not belong here at all, regardless of how real the gap looks — see
`SKILL.md`'s ground rule 2.
