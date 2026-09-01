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

**Avoid:** Prefer one-directional handoffs (§4 ("Cross-workflow hand-off") in
`patterns.md`). If a return leg is genuinely required, pair it with an explicit
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

## 5a. `allowMultiple: false` has TWO bypasses — proven live 2026-08-25

Turning re-entry off is not a guarantee of single enrolment. GHL says so in the Settings tab's own
help text, and both routes are easy to miss:

| bypass | condition |
|---|---|
| **trigger class** | the workflow has an **appointment OR invoice** based trigger — those re-enter regardless of the toggle |
| **opportunity fan-out** | `allowMultipleOpportunity` is on and the contact has several opportunities; each becomes a **distinct execution** |

So a sequence written for single entry — a welcome message, a one-time discount, an onboarding
email — repeats per appointment, per invoice event, or per opportunity, while the setting that was
supposed to prevent it reads "off".

The appointment case was already known. **The invoice trigger class and the opportunity route were
not.** Check all three conditions before promising a client that something sends once.

Related, and also from GHL's copy: re-entry attempted *while the contact is still enrolled* is
**skipped, not queued** — the trigger is discarded, not deferred to when they exit. A design
relying on "it will pick that up afterwards" is wrong.

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

**Source:** `ghl-specialist references/action-gotchas.md` (AI Prompt) — the source
names the AI-Prompt step; applied to both `ai_agent` and `chatgpt` steps here by
analogy, since both bill tokens to the same uncapped wallet.

---

## 11. Flow-bot design rules (live-proven 2026-08-31)

A flow bot (`workflowType: "agent"`) fails **silently**: nothing errors, the graph
round-trips clean, and the only evidence is runtime behaviour. Seven rules from live
conversation against the server's records (outcomes proven; the priority mechanism in
rule 7 is an inferred model) — apply them to every flow-bot blueprint:

1. **Capability belongs to the NODE, not the prompt.** Only
   `conversationai_book_appointment` can touch the diary; no wording at any level lets a
   `continue`/`objective`/`ai_message` node book, move or cancel — route the intent to
   the node that owns the action.
2. **Gate the booking node.** Its empty-result wording is unsteerable (it obeys prompt
   *form*, owns its *content*), so never let it answer about a booking that may not
   exist: identify the contact first (email/phone merges the anonymous visitor into the
   real record), then `if_else` on a booking-live tag.
3. **Selection problems ARE prompt problems.** Ask: has the node ever done the right
   thing? Yes → wording fixes it (`promptInstructions`: never offer a past time, ask
   which of several); never → capability, fix the routing.
4. **A node's local scope beats a global prohibition.** Repeat every behavioural rule
   byte-identically in EVERY speaking node, carrying the positive half (what to do),
   not just the ban.
5. **Never lead a splitter branch with a container.** A branch whose first step is
   `book_appointment` (proven on `book_appointment`; `services_booking` inferred — same
   multipath shape, not exercised) is silently never offered to the model — put one
   simple step at the branch head.
6. **Captures in a booking lane proceed on unmet.** Every `conversationai_objective` in
   the lane carries `proceedIfNotMet: false` (the attr is name-inverted — `true` is the
   UI's "Don't proceed"), or an undecided lead gets the closing message and never
   reaches the times.
7. **The booking custom trigger holds TOP priority, strictly above every sibling.**
   Break-out authority follows priority; siblings sit at LOW sensitivity with
   latest-message-scoped descriptions. 0/11 replies without the fix, 5/5 with it — 0/11 →
   5/5 is the proof; "authority follows priority" is the model that fits it.

**Source:** `create-ghl-workflow/references/flow-bots.md` → "Runtime doctrine" (and its
custom-trigger section); corpus
`knowledge/corpus/workflows/40-rules/flow-bot-runtime-doctrine.md`.

---

## 12. Appointment-rail design rules (live-proven 1–2 Sep 2026, corpus `calendars/40-rules/`)

Four rules, each behind a real defect on a live account:

- **A workflow that reads `{{appointment.*}}` or waits relative to an appointment may only be entered
  by an APPOINTMENT TRIGGER.** `add_to_workflow` starts the target with NO appointment context: every
  `{{appointment.*}}` renders empty and every appointment-anchored wait SKIPS (`skippedFor:
  missing-data`) — so the whole reminder ladder collapses into one burst and "see you tomorrow" goes
  out the moment they rebook. The tell in the enrolment: a trigger-born row carries
  `sourceId: appointment_<id>`; a workflow-born row has no `sourceId` at all. Generalises to anything
  the run is BOUND to rather than looked up on the contact.
- **Read the calendar's `autoConfirm` before building on `status == new`.** With it on, an
  appointment is BORN `confirmed` and the trigger never fires for anything the AI or the widget books.
  An API fixture that sends `appointmentStatus:"new"` overrides it and proves nothing — book through
  the door the customer uses. `autoConfirm` governs birth only; a MOVE keeps whatever status the
  appointment had, so a moved booking still cannot re-enter a `new` filter — that needs a second
  trigger filtered `status == confirmed`.
- **Never branch on `appointmentRescheduled` to decide what KIND of event arrived.** It is STICKY: a
  property of the appointment's history, `true` on every later event including the CANCEL. A guard
  testing it ate a genuine cancellation's winback, and an unfiltered trigger took its reschedule
  branch on a cancel and texted "You're all booked" three minutes after the agent said "cancelled".
  The event kind lives in the trigger's status filter and nowhere else.
- **A workflow whose own step flips `new → confirmed` RE-ENTERS its own `confirmed` trigger.** Two
  confirmations ~90 s apart, the reminder ladder armed twice. Count enrolments, and count them late —
  the echo lands on the ~3-minute evaluation lag, so one reading five minutes in reports clean. A
  `modifiedBy` filter excluding `workflow` on the confirmed trigger is the candidate fix, untested.

Also from the same run: deleting a CALENDAR hard-deletes its future appointments and raises no
cancellation event (nobody is told); a calendar id in a trigger filter is a silent dependency, so
swapping calendars kills every rail keyed to it with no error anywhere.

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
