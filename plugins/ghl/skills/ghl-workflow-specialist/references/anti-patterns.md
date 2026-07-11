# Anti-patterns — failure modes, how to detect and avoid each

> Grounded in the `ghl-workflow-api-docs` reverse-engineering repo and
> `~/.claude/skills/ghl-specialist`'s audit references + learning log (real findings
> from real sub-account audits, not hypotheticals). Each entry: what it looks like,
> how to detect it before or after building, and how to avoid it.

---

## 1. Infinite / uncontrolled tag-trigger loops

**What it looks like:** Workflow A adds a tag that fires Workflow B, which (directly or
after a few hops) adds a tag that re-enters Workflow A. Nothing in the builder UI
visualizes this — `add_contact_tag` → `contact_tag` trigger chains are invisible
cross-workflow dependencies.

**Detect:** When reviewing an account, map every `contact_tag` trigger against every
`add_contact_tag`/`remove_contact_tag` action across all workflows (not just the one
you're building). If a tag added downstream matches a tag trigger upstream, you have a
cycle candidate. Also check `allowMultiple` on each workflow in the loop — if any is
`true`, the loop can run unbounded.

**Avoid:** Break the cycle with an explicit exit condition (a "processed" tag checked
via `if_else` before the loop-causing action fires again), or restructure so the tag
write happens *after* the point where re-entry would occur, not before.

**Source:** `ghl-specialist references/trigger-gotchas.md` (Custom Trigger — "creates
cross-workflow coupling that the UI does not visualize"); `ghl-specialist
references/action-gotchas.md` (Go To — "creates cross-workflow dependencies that are
not visualized anywhere").

---

## 2. Bidirectional cross-workflow handoffs (the loop-unsafe pattern)

**What it looks like:** Flow A hands off to Flow B via `add_to_workflow`; Flow B hands
back to Flow A the same way. If `allowMultiple` is `false` on the return leg, the
second enrollment silently no-ops — the contact appears "stuck" and nobody can tell why
from the builder UI.

**Detect:** When a design calls for two workflows to reference each other via
`add_to_workflow`, check each workflow's `allowMultiple` flag before proposing the
shape. A `false` value on either side is either the intended stop (if that's the goal)
or a silent trap (if it isn't).

**Avoid:** Prefer one-directional handoffs (§4.7 in `patterns.md`: "Cross-workflow
hand-off"). If a return leg is genuinely required, pair it with an explicit
`remove_from_workflow(includeCurrent: true)` on the outbound leg so the contact isn't
live in both workflows simultaneously, and document the loop's intended exit condition.

**Source:** `ghl-workflow-api-docs/recipes/cross-workflow-handoff.md` ("Bidirectional
handoff is possible but loop-unsafe... if false, the second enrollment no-ops").

---

## 3. Two workflows racing on the same event (duplicate messages)

**What it looks like:** A contact ends up enrolled in two or more workflows that
overlap on trigger scope (e.g. both fire on the same tag, or both fire on form
submission for overlapping forms) with no shared communication-limit governor. The
contact receives the same or similar message multiple times in a short window;
unsubscribe/complaint rates spike.

**Detect:** Pull recent outbound conversations bucketed by contact/day/channel; flag
any contact receiving more than ~3 same-channel messages in a day. Cross-reference the
affected contacts' enrollment history against the workflow map to find which workflows
overlap. Multi-workflow overlap without a comms-limit governor is the structural cause,
not a one-off bug in a single workflow.

**Avoid:** When designing a new workflow, check whether an existing workflow already
owns the same trigger surface (same tag, same form, same pipeline stage) before adding
a parallel one. If two workflows genuinely both need to react to the same event, add an
explicit governor — a shared "contacted today" custom value/tag checked at entry — so
only one fires the outbound send.

**Source:** `ghl-specialist references/common-audit-findings.md` #2 ("Workflows
sending duplicate messages" — tier-1, most-cited finding).

---

## 4. Timezone / wait-step traps

**What it looks like:** A date-anchored trigger (Birthday Reminder, Custom Date
Reminder) fires at unexpected hours because it evaluates in the **contact's**
timezone, not the location's — and contacts with a blank timezone field silently fall
back to the location default, producing an inconsistent mix of fire times across the
same campaign. Separately, a business-hours-aware `wait` with no linked calendar hours
configured behaves as a no-op (completes immediately or never).

**Detect:** For date-anchored campaigns firing at odd hours, pull a sample of contact
timezone fields — expect a mix and no standard if this is the cause. For any
business-hours-aware `wait` step, verify the linked calendar actually has hours set.

**Avoid:** Don't assume "the campaign fires at 9am" without checking whose 9am. If the
business needs strict scheduling regardless of contact timezone, that's a case for a
`scheduler_trigger`-driven watcher instead of a date-reminder trigger. Always attach an
hours-configured calendar before shipping a business-hours wait.

**Source:** `ghl-specialist references/trigger-gotchas.md` (Birthday Reminder / Custom
Date Reminder); `ghl-specialist references/action-gotchas.md` (Wait — business-hours
misconfiguration).

---

## 5. Unintended re-entry (or its opposite: expected re-entry that got blocked)

**What it looks like:** Two failure directions, same root cause — misunderstanding
which triggers respect `allowMultiple`:
- Appointment Status and Invoice triggers **bypass `allowMultiple` entirely** — they
  always re-run per appointment/invoice even with re-entry off at the workflow level.
  If the downstream actions aren't per-event-safe (a generic "welcome" sequence
  re-triggered per appointment), the contact gets spammed.
- Conversely, Contact Created / Form Submitted triggers **do** respect `allowMultiple`
  — if it's left `true` on a welcome/drip workflow, a re-submitting contact restarts
  the whole sequence from scratch.

**Detect:** For each workflow, read the `allowMultiple` setting and cross-reference
against its trigger type. Appointment/Invoice-triggered workflows re-running per-event
is expected — don't flag it. Contact Created/Form Submitted workflows with
`allowMultiple: true` sending a welcome/drip sequence should be flagged.

**Avoid:** Default `allowMultiple: false` for welcome/onboarding sequences unless
re-entry is explicitly wanted. For appointment/invoice-triggered workflows, design the
downstream actions to be per-event-safe from the start (scope messaging/state to the
specific appointment/invoice, not the contact generally).

**Source:** `ghl-specialist references/trigger-gotchas.md` (Appointment Status /
Invoice re-entry bypass); `ghl-specialist references/common-audit-findings.md` #8
("Workflow re-entry misconfiguration").

---

## 6. Missing else-leg (marooned contacts)

**What it looks like:** An `if_else` branch is configured with no explicit "else"
path. A contact who matches none of the defined branches simply **stops** at that node
— they don't fall through, they don't error, they just never get anything downstream.
This is one of the most common "the workflow looks fine but nothing happens" causes.

**Detect:** Scan the workflow's `if_else` containers for a branch with empty
`segments` acting as a true catch-all vs. one that's simply absent. Every `if_else`
should resolve every contact to *some* leg, even if that leg is just an explicit
`remove_from_workflow`.

**Avoid:** Always build the else/catch-all branch, even when "nothing should happen"
— make that explicit (e.g. `remove_from_workflow`) rather than implicit (no branch at
all). See the tag-based-routing and lead-score-nurture recipes in `patterns.md` — both
model an explicit else leg.

**Source:** `ghl-specialist references/action-gotchas.md` (If/Else).

---

## 7. Orphaned / unbounded waits

**What it looks like:** A `wait` with `type: "reply"` / `"email_event"` / etc. and no
timeout configured holds the contact **indefinitely** if the event it's waiting on
never fires. Separately, a `goto`-based retry loop with no bounded counter can spin
without the runtime enforcing any cycle limit — this path is unverified, not
confirmed-safe.

**Detect:** For every hybrid/multi-path `wait`, confirm a timeout branch exists
(`transitions[]` covering the non-reply case, or a `next` timeout leg per
`docs/04-workflow-anatomy.md §4.4`). For any `goto` targeting an earlier step in its
own chain, confirm there's a counter-based exit condition, not just an implicit trust
that the loop will eventually break.

**Avoid:** Never ship a hybrid wait without a timeout leg. When a retry loop is
genuinely needed (e.g. payment retry), use a bounded counter (custom value +
`math_operation` increment + `if_else` cap check) rather than an open-ended `goto`
cycle — and say explicitly in the blueprint that loop-safety for `goto` cycles is
untested per the research repo, so the cap is a safety net, not a formality.

**Source:** `ghl-specialist references/action-gotchas.md` (Wait — "until event without
a timeout will hold the contact indefinitely"); `ghl-workflow-api-docs
docs/04-workflow-anatomy.md §4.5` ("what runtime loop-safety GHL applies... hasn't been
tested"); `ghl-workflow-api-docs recipes/failed-payment-retry.md` ("Loop-safety... is
untested").

---

## 8. Silent no-ops on cross-workflow / cross-entity references

**What it looks like:** `add_to_workflow`, `remove_from_workflow`, and `goto`-to-another-workflow all publish cleanly even when their target no longer exists (deleted, renamed, or never existed) — the action just silently does nothing at runtime. Same pattern for a deleted custom field referenced by `update_contact_field`, a deactivated user referenced by `assign_user`, or a moved/renamed Google Sheet referenced by the `google_sheets` action.

**Detect:** Before wiring any cross-reference (`workflow_id`, custom field id, user id, sheet id), re-fetch the current id from source rather than trusting a value from memory or an old note. After building, re-GET the target to confirm it resolves.

**Avoid:** Treat "the validator accepted it" as meaningless for these fields — the publish-time validator does not check referential integrity across entities, only shape. Verification has to be a live GET against the referenced entity, not just a clean publish response.

**Source:** `ghl-workflow-api-docs recipes/cross-workflow-handoff.md` ("Validator does
not check target workflow exists"); `ghl-specialist references/action-gotchas.md`
(Update Contact Field, Assign to User, Google Sheets — each independently confirms the
same silent-no-op shape for its own entity type).

---

## 9. Custom Value vs. Contact Field confusion (accidental broadcast)

**What it looks like:** A builder wants to update one contact's state but reaches for
an action that updates a **custom value** instead of a **custom field** — custom
values are sub-account-wide, so the "fix" silently rewrites what every contact and
every workflow referencing that value sees.

**Detect:** Any workflow step that writes a custom value where the referenced value's
name looks contact-specific (e.g. "John's appointment date") is a red flag — that's
very likely supposed to be a per-contact `update_contact_field` write instead.

**Avoid:** Confirm intent explicitly before proposing a custom-value write in a
blueprint: "this changes the value for every contact and workflow that reference it —
is that what you want?" Default to `update_contact_field` for anything that reads as
per-contact state.

**Source:** `ghl-specialist references/action-gotchas.md` (Update Custom Value).

---

## 10. AI actions with no cost/volume cap

**What it looks like:** An `ai_agent` or `chatgpt` step sits behind a high-frequency
trigger with no rate limit. Tokens bill to the sub-account's wallet with **no built-in
cost cap** — a loop, a popular form, or an unexpectedly viral trigger can burn the
wallet in hours.

**Detect:** For every AI action, estimate expected volume against the upstream
trigger's typical frequency. Flag any AI action fed by a high-frequency or
unauthenticated-surface trigger (public form, webhook) with no upstream filtering.

**Avoid:** Gate high-frequency triggers before they reach an AI step — an `if_else` +
counter custom value (rate-limit pattern) or upstream filtering on the trigger itself.
Say this explicitly in the blueprint when an AI action is part of the design.

**Source:** `ghl-specialist references/action-gotchas.md` (AI Prompt).

---

## Cross-reference: field-level traps that produce anti-pattern symptoms

Some of the above are downstream symptoms of internal-API field traps documented in
`trigger-action-catalog.md` and the research repo directly — worth knowing when
*diagnosing* a broken workflow, not just when building one:

- The trigger casing trap (`workflowId` camelCase vs `workflow_id` snake_case) can make
  a trigger *look* created (200 + a believable id) while never actually persisting —
  always verify with a GET, never trust the POST response.
  Source: `ghl-workflow-api-docs docs/09-gotchas.md #1`.
- Publishing with a stale `autoSaveSession`/`version` fails loudly (422), which is
  loud and recoverable — not in scope as an anti-pattern here, but worth knowing it's
  a build-time issue, not a design issue, if it comes up while delegating to
  `create-ghl-workflow`.
