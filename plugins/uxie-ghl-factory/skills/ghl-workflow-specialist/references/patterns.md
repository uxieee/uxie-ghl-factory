# Patterns — multi-workflow architectures

> These are **worked examples**, not the skill's identity. The skill's job is
> deciding what the account actually needs (per the client brief and recon), then
> reaching for the right shape — not running through this list top to bottom. Every
> pattern names the trigger/action types it uses; look them up in
> `trigger-action-catalog.md` for the field-level detail. Each is grounded in a
> corresponding recipe in `ghl-workflow-api-docs/recipes/` (the JSON skeleton lives
> there if you need to check exact attribute shapes before delegating to
> `create-ghl-workflow`).

---

## 1. Branching by data (one entry event, several outcomes)

### Tag-based routing
A single `contact_tag` trigger enters one workflow; an `if_else` container with N
branches checks which other tag is present and routes each branch into its own action
chain (tag write, then channel-specific send). Use when different audiences need
different downstream treatment from the same entry event, and the split is small
enough (a handful of segments) to stay legible as one workflow.
Uses: `contact_tag` trigger, `if_else`, `add_contact_tag`, `email`/`sms`.
Source: `recipes/tag-based-routing.md`.

### Lead-score / speed-to-lead nurture
`pipeline_stage_updated` (or a score-crossing `contact_changed`) fires an `if_else` on
`opportunity.monetaryValue` or a custom score field. High-score branch: `assign_user`
(round-robin via `user_list` + `traffic_split: "equally"`) + immediate `sms` +
`internal_notification` to the rep — this is the speed-to-lead shape: assign and alert
fast, don't drip. Low-score branch: `add_to_workflow` into a separate nurture-drip
workflow rather than inlining a slow sequence in the same graph.
Uses: `pipeline_stage_updated` trigger, `if_else`, `assign_user`, `sms`,
`internal_notification`, `add_to_workflow`.
Source: `recipes/lead-score-nurture.md`.

### Form-fill categorize-and-route
Same shape as tag-based routing, keyed off form field values instead of tags — routes
into per-category opportunity pipelines. Use when the form itself carries the
segmentation signal (a "which service?" dropdown) rather than a tag applied later.
Uses: `form_submission` trigger, `if_else`, `create_opportunity`.
Source: `recipes/form-fill-categorize-route.md`.

---

## 2. Lifecycle and timing

### No-show recovery
Two-part shape, not one workflow: (a) an appointment-confirmation flow — `wait` until
N hours before the appointment (`type: "appointment"`, `appointmentStartAfter`), send a
confirmation `sms`, then a **hybrid `wait`** (`type: "reply"`, `convertToMultipath:
true`) that branches on reply-received vs. timeout; (b) a separate no-show flow keyed
on `appointment` trigger filtered to `appointment.status === "noshow"`, branching into
an SMS + re-book email. Keep these as two workflows — the confirmation flow's job ends
at "did they reply," the no-show flow's job starts at "they didn't show." Chaining them
into one giant workflow makes the branch logic much harder to audit.
Uses: `appointment`/`customer_appointment` trigger, hybrid `wait` (`reply` subtype),
`sms`, `add_contact_tag`, `task-notification`.
Sources: `recipes/appointment-reminder-with-confirmation.md`,
`recipes/email-after-no-show.md`.

### DB reactivation / re-engagement
An upstream watcher (separate scheduled workflow or job) tags contacts `inactive` once
they cross a last-activity threshold — GHL has no native "time since last activity"
trigger, so this has to be computed, not fired directly. The reactivation workflow
itself triggers on `contact_tag` ("inactive") and branches by how stale: a
"long-inactive" bucket gets a final pause email + `remove_from_workflow` (with
`allWorkflows: true` if you want to fully suppress marketing sends); a
"recently-inactive" bucket gets an SMS → `wait` 3 days → email drip.
Uses: `contact_tag` trigger, `if_else`, `email`, `sms`, `wait`, `remove_from_workflow`,
optionally `dnd_contact` on the long-inactive leg.
Source: `recipes/re-engagement-after-inactivity.md`.

### Birthday / date-anchored offer
A date-reminder trigger drops a templated email carrying a custom-value offer code.
Simple linear shape, no branching needed for the base case. Flag to the user: this
trigger evaluates in the **contact's own timezone**, not the location's — contacts
with a blank timezone silently fall back to the location default (`ghl-specialist`
`references/trigger-gotchas.md`). If the account cares about exact delivery hour, this
matters.
Source: `recipes/birthday-greeting-with-offer.md`.

### Time-based drip with a mid-sequence branch
A fixed-cadence SMS drip (day 0, day N, day N+2 …) with an `if_else` inserted partway
through that checks whether the contact replied by a given day, and diverts
accordingly. Use for straightforward nurture sequences where the only decision point is
"did they engage yet," not a full segmentation tree.
Source: `recipes/time-based-drip-with-branch.md`.

---

## 3. Re-engagement and recovery

### Failed-payment retry
`payment_received` filtered to `payment.payment_status == "failed"` → `wait` 1 day →
`custom_webhook` POST to the payment processor's retry endpoint (`saveResponse: true`)
→ `if_else` branching on the webhook response (success → tag "recovered"; final-fail →
tag + `internal_notification` to ops). For a bounded multi-retry loop instead of a
single retry, replace the binary branch with a counter custom value, a
`math_operation` increment, and a `goto` back to the `wait` while retries < N — but
runtime loop-safety for `goto`-created cycles is untested (`docs/04-workflow-anatomy.md
§4.5`), so cap the counter and have a hard exit branch regardless.
Uses: `payment_received` trigger (0 corpus occurrences — filter shape from the trigger
envelope, not a captured payload; verify against the builder UI before relying on it),
`wait`, `custom_webhook`, `if_else`, `add_contact_tag`, `internal_notification`.
Source: `recipes/failed-payment-retry.md`.

### Cold-lead handoff
A custom-field threshold crossing (e.g. an engagement score) triggers enrollment into a
"qualified" flow plus removal from the cold-nurture flow plus a rep assignment — the
inverse of DB reactivation: moving a contact *up* the funnel rather than pausing them.
Source: `recipes/cold-lead-handoff.md`.

---

## 4. Fan-out and hand-off

### Multi-channel notification fan-out
When one internal event (a hot-lead form submission) needs to alert staff on several
channels, the corpus-prevalent shape is a **linear chain** — `email` → `sms` →
`internal_notification` → `task-notification` — not a `workflow_split`.
`workflow_split` only supports `condition: "random-split"`; even with four equal-weight
paths, each contact takes **one** random path, not all four. If you want true parallel
fan-out to multiple channels, use the linear chain (optionally with `wait` steps
between actions for staggered timing); reach for `workflow_split` only when you
actually want random channel selection, not fan-out.
Uses: `form_submission` trigger, `email`, `sms`, `internal_notification`,
`task-notification` (or `workflow_split` if genuinely doing A/B/random selection).
Source: `recipes/multi-channel-notification.md`.

### Cross-workflow hand-off — when to split one workflow into several
Split into separate workflows when: different teams/owners are responsible for
different funnel stages, a single workflow's branch count is getting hard to audit
visually, or a stage genuinely has its own re-entry/timing semantics that would
complicate the parent workflow's `allowMultiple` setting. The connecting tissue is
`add_to_workflow` (enroll into the next flow) paired optionally with
`remove_from_workflow` (`includeCurrent: true`) to stop the source flow immediately
rather than letting both run in parallel. Two hard requirements when doing this:
1. **The target workflow must be published** for the runtime to enroll into it — the
   handoff is unverified against a draft target (`recipes/cross-workflow-handoff.md`).
   Since `create-ghl-workflow` only proves DRAFT builds, a cross-workflow handoff you
   build here **cannot be verified end-to-end** until the user publishes both sides
   themselves.
2. **The validator does not check that the target workflow exists.** A bad
   `workflow_id` publishes cleanly and silently no-ops at runtime — always re-GET the
   target workflow's id right before wiring the `add_to_workflow` step, don't rely on
   an id copied from memory or an old note.
See `anti-patterns.md` for the loop risk when handoffs go both directions.
Uses: `add_to_workflow`, `remove_from_workflow`.
Source: `recipes/cross-workflow-handoff.md`.

---

## 5. Wait / goal logic — cross-cutting rules

- **Goal Event is singular.** Only one `workflow_goal` step is effective per workflow;
  a second one is silently ignored by the builder. If a design calls for multiple
  short-circuit conditions, that's a sign the workflow should split (§4) or the goal
  logic should move into an `if_else` instead.
  Source: `ghl-specialist references/action-gotchas.md`.
- **Hybrid `wait` is the reply/event/timeout primitive**, not a second `if_else`. Set
  `convertToMultipath: true` (or the paired `isHybridAction`/`hybridActionType: "wait"`
  flags) to get a branching wait; a plain time-delay `wait` has none of these flags and
  a single `next`. The same shape covers `reply`, `email_event`, and `link_clicked`
  sub-types — see `appointment-reminder-with-confirmation.md` for the worked example.
  Source: `docs/04-workflow-anatomy.md §4.4`.
- **Business-hours-aware waits need a linked calendar with hours actually configured**
  — otherwise the wait no-ops (completes immediately or never, observed inconsistently).
  Source: `ghl-specialist references/action-gotchas.md`.

## 6. Custom values + webhook glue

- Custom values are **sub-account-wide broadcasts**, not per-contact state — don't
  reach for `update_custom_value`-style actions when the goal is a per-contact field
  write (`update_contact_field` is the per-contact action). Confusing the two is a
  builder foot-gun `ghl-specialist` calls out directly (`references/action-gotchas.md`).
- `custom_webhook`'s `body.rawData` is a **JSON-stringified template string**, not
  nested JSON — merge fields expand inside the string, so wrap potentially-empty
  values in quotes or the resulting payload breaks. `template_id: "none"` on `email`
  is the equivalent trap on the comms side (see catalog §2).
  Sources: `create-ghl-workflow/references/step-shapes.md`,
  `recipes/failed-payment-retry.md`, `docs/09-gotchas.md #10`.
- For branching on a webhook's response, piping the response into a contact field via
  `update_contact_field` first and branching on *that* field is more robust than
  branching directly on `webhook_response` conditionType — the corpus doesn't have a
  fully traced `conditionSubType` for arbitrary JSON-path access on a webhook response.
  Source: `recipes/failed-payment-retry.md`.

## 7. Enrolling contacts from outside GHL — two real routes, pick deliberately

- **`inbound_webhook` trigger** — every workflow with this trigger gets a unique POST
  URL; anyone who can reach that URL enrolls a matched contact. No built-in signature
  verification — the payload is trusted. Right choice when the calling system
  shouldn't hold direct GHL API credentials.
  Source: `TRIGGER_TYPES.md`.
- **`contacts__add-contact-to-workflow` (public API)** — `POST
  /contacts/{contactId}/workflow/{workflowId}`, optional `eventStartTime` body. A
  cleaner, credentialed path when the caller already resolves contact IDs via the
  public API. Confirmed live via `mcp__uxie-ghl-mcp__search_actions` — see
  `trigger-action-catalog.md §4` for why this corrects older "webhook is the only way"
  framing. Prefer this when the integration already authenticates as the account.
