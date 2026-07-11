# Trigger + action catalog

> Every row here traces to a source: the `ghl-workflow-api-docs` reverse-engineering
> repo (path given) or a live call against the `uxie-ghl-mcp` server (category given,
> called during authoring of this file). Nothing below is invented. Where the corpus
> is thin or unverified, it says so instead of guessing.

## How to read this

- **Triggers** and **actions/steps** live in two separate documents on the internal
  builder API (`docs/04-workflow-anatomy.md §1` in the research repo) — a workflow's
  step graph and its trigger list are written and read separately.
- The research repo's corpus is real production data (326 workflows, 6 sub-accounts)
  but it is **not the full GHL offering** — it's what got captured. Treat the "coverage
  gaps" callouts below as real gaps, not oversights to paper over.
- Full per-field shapes belong to `create-ghl-workflow/references/step-shapes.md` and
  `references/build-recipe.md` (that skill owns execution). This file is for **deciding
  what to build**, not how to POST it.

---

## 1. Triggers (corpus-observed, ranked by frequency)

Source: `ghl-workflow-api-docs/TRIGGER_TYPES.md` — 28 unique trigger types across 343
trigger instances in 326 production workflows.

| Trigger `type` | What it does | Filterable on | Notes |
|---|---|---|---|
| `contact_tag` | Fires when a tag is added (most common trigger in the corpus) | `tagsAdded` | Tag matched by **name**, not ID — rename breaks the trigger silently (see anti-patterns.md). |
| `pipeline_stage_updated` | Fires on opportunity stage change | `opportunity.pipelineId`, `opportunity.pipelineStageId` | Missing pipeline/stage filter = fires on every stage change in every pipeline. |
| `inbound_webhook` | Fires on POST to a workflow-specific URL | none observed | The classic external-enrollment path — see §4 below for why it's no longer the *only* one. |
| `form_submission` | Fires on form submit | `form.id`, plus a dynamic `contact.<fieldId>` row | Bound to a specific form ID. Cloning a form gives a new ID; the old trigger doesn't follow. |
| `customer_reply` | Fires on inbound message reply | `contact.tags`, `inbound_number`, `message.body`, `message.chatWidgetId` | Fires on **any** connected channel (SMS/email/FB/IG/WhatsApp/GMB/live chat), not just SMS — a common false assumption. |
| `appointment` / `customer_appointment` | Fires on appointment lifecycle events | `appointment.eventType`, `appointment.status`, `calendar.id`, `contactMode` | **Bypasses `allowMultiple`** — always re-runs per appointment even with re-entry off at the workflow level. |
| `facebook_lead_gen` | Fires on FB lead-ad submission | `facebook.formId`, `facebook.pageId` | |
| `opportunity_created` / `opportunity_changed` / `opportunity_status_changed` | Fire on opportunity lifecycle events | `opportunity.pipelineId`, `.pipelineStageId`, `.status`, `.assignedTo`, `contact.tags` | |
| `contact_created` | Fires on new contact | `tagsAdded` | |
| `contact_changed` | Fires when a *specific* field transitions to a *defined* value | `contact.<customFieldId>` (the field ID is embedded in the field name) | Does **not** fire on every field edit — narrow by design; confirm the exact field+value combo before assuming it should have fired. |
| `proposal_estimate_update` | Fires on proposal/estimate status change | `documentCreatedByTemplateId`, `status` | `masterType: "internal"`. |
| `survey_submission` | Fires on survey submit | `survey.id` | Same clone-breaks-reference risk as forms. |
| `lesson_started` / `lesson_completed` / `category_completed` | Course/membership progression events | `membership.category.id`, `.lesson.id`, `.product.id` | |
| `call_status` | Fires on call outcome | `call_status`, `message.direction` | |
| `opportunity_decay` | Fires when an opportunity goes stale | `opportunity.lastActionDate`, operator `time-diff-now-gte` | Rarely configured in the wild per `ghl-specialist` audit findings (see anti-patterns.md). |
| `trigger_link` | Fires on tracked-link click | `link.id` | |
| `mailgun_email_event` | Email opens/clicks/bounces | `mailgun.event` | Naming reveals GHL's email provider. Open/click tracking is blocked by Apple MPP and many corporate filters — directionally useful, not reliable as a gate (ghl-specialist `trigger-gotchas.md`). |
| `affiliate_new_lead` | Affiliate-referred lead | `campaign` | `masterType: "internal"`. |
| `order_submission` | Order placed | `order.line_item_global_product_ids` | |
| `scheduler_trigger` | Cron-style time trigger | `scheduler.interval`, `.weekly.days`, `.weekly.times` | **Contact-less** — runs with no contact context. Contact-scoped downstream actions (send SMS, update field) will fail or no-op (ghl-specialist `trigger-gotchas.md`). |
| `task_added` / `task_due_date_reminder` | Task lifecycle events | `task.assignedTo`, `task.dueDate` | |
| `category_completed` | Membership category finished | `membership.category.id`, `.product.id` | |
| `conv_ai_trigger` | Conversation-AI bot event | `botId` | Pairs with `conversationai_*` step types (§2). |

### Coverage gap — the corpus undercounts the real trigger surface

Per `TRIGGER_TYPES.md` (2026-05-17 note): the corpus captured 28 trigger types, but
**the GHL builder UI offers 79+ OG triggers across 14 categories** (Birthday Reminder,
Custom Date Reminder, Note Added/Changed, Pipeline Stage Changed variants, IVR Start,
Subscription, Refund, and more — unused in the captured accounts) **plus 102
marketplace/integration triggers** via `/workflows-marketplace/location/{loc}/assets`.
The repo flags this as an open research item, not a closed catalog. `ghl-specialist`'s
`references/trigger-gotchas.md` independently documents several of the UI-only ones
(Birthday Reminder timezone behavior, Invoice re-entry bypass, Stale Opportunities) —
cross-referenced in the trigger table above and in `anti-patterns.md` where relevant.
Treat any trigger not in the table above as "exists in the UI, unverified shape here."

---

## 2. Actions / steps (corpus-observed, ranked by frequency)

Source: `ghl-workflow-api-docs/STEP_TYPES.md` — 66 unique step types, 3,958 step
instances across the same 326-workflow corpus. One example JSON per type lives at
`catalog/step-examples/{type}.json` in that repo.

### Branching / flow control
| `type` | What it does | Key attributes | Trap |
|---|---|---|---|
| `if_else` | Conditional branch, N-way | `branches[]`, `currentRecipeType` | Most-used step in the corpus (984 occurrences). A branch with no "else" leg **strands** contacts who match nothing — they stop, they don't fall through (ghl-specialist `action-gotchas.md`). |
| `workflow_split` | Percentage/random split across named paths | `paths[]`, `transitions[]`, `condition: "random-split"` | Routes each contact to **one** random path — not true parallel fan-out. See patterns.md. |
| `goto` | Jump to any other step, including ancestors | `targetNodeId` | Corpus contains `goto`s that target ancestors (cycles); the builder permits this with **no warning**, and runtime loop-safety (re-entry caps, cycle detection) is untested (`docs/04-workflow-anatomy.md §4.5`). |
| `workflow_ai_decision_maker` | AI-based multi-path branching | `instructions`, `information` | INTERNAL type; multi-path hybrid shape. |
| `workflow_goal` | Short-circuit to a goal step | `action`, `op`, `segments` | **Only one is effective per workflow** — a second Goal Event is silently ignored (ghl-specialist `action-gotchas.md`). |

### Wait / timing
| `type` | What it does | Key attributes | Trap |
|---|---|---|---|
| `wait` | Delay, or (with `convertToMultipath: true`) a multi-path container branching on reply/event/timeout | `startAfter`, `appointmentCondition`, `emailEventTypes`, `reply` | 2nd most-used step (550 occurrences). "Until event" with no timeout holds the contact **indefinitely** if the event never fires (ghl-specialist `action-gotchas.md`). Business-hours-aware wait with no linked calendar hours behaves as a no-op. |
| `drip` | Batch-throttles enrollment queue | `batchSize`, `interval` | Workflow-level, not per-action — if a workflow is "sending slowly," check drip mode before blaming the send action. |
| `event_start_date` | Anchor to a recurring/one-off date | `event_start_type`, `recurring_type` | |

### Communication
| `type` | What it does | Key attributes | Trap |
|---|---|---|---|
| `email` | Send email | `template_id`, `subject`, `html`, `from_email/name` | `template_id: "none"` (**literal string**) means "use inline `subject`/`html`"; a Mongo ID means "load that template." Omitting it or sending `null`/`""` can misbehave (`docs/09-gotchas.md #10`). |
| `sms` | Send SMS | `body`, `attachments` | |
| `internal_notification` | Fan a single event across 4 channels (email/SMS/in-app/whatsapp) in **one** action | `notification`, `email`, `sms`, `whatsapp` | Chaining several separate `internal_notification` steps (one per channel) instead of configuring all four inside one action is a common anti-pattern flagged by `ghl-specialist` (`action-gotchas.md`) — bloats the canvas and fragments the audit trail. |
| `manual-sms` / `manual-call` / `call` / `voicemail` | Manual/outbound-dial actions | `call_connect`, `timeout` (1–120s) | |

### CRM / contact state
| `type` | What it does | Key attributes | Trap |
|---|---|---|---|
| `update_contact_field` | Per-contact field write | `fields`, `actionType` | Deleted custom field → silent no-op. |
| `add_contact_tag` / `remove_contact_tag` | Tag write | `tags`, `removeAll` | Tag matched by **name**; see trigger table for the rename risk shared with `contact_tag`. |
| `create_opportunity` / `internal_create_opportunity` | Create an opportunity | `pipeline_id`, `pipeline_stage_id`, `monetary_value` | Two distinct shapes exist (public-style vs INTERNAL) — mirror a harvested example, don't blend them. |
| `find_contact` / `find_opportunity` / `lc_merge_contact` | Multi-path lookup/merge hybrid actions | `transitions[]`, `convertToMultipath` | INTERNAL, hybrid-container shape like `if_else`. |
| `assign_user` | Assign/round-robin a rep | `user_list`, `traffic_split` | Deactivated users break assignment silently. |
| `dnd_contact` | Set Do Not Disturb | `dnd_direction`, `specific_channels` | |

### Cross-workflow control
| `type` | What it does | Key attributes | Trap |
|---|---|---|---|
| `add_to_workflow` | Enroll the contact in another workflow | `workflow_id`, `input_trigger_params` | **Validator does not check the target workflow exists** — a bad `workflow_id` publishes cleanly and silently no-ops at runtime (`recipes/cross-workflow-handoff.md`). Not visualized anywhere in the builder UI. |
| `remove_from_workflow` | Pull the contact out of a workflow | `workflow_id`, `allWorkflows`, `includeCurrent` | `includeCurrent` validator behavior is key-presence-based, not value-based — brittle (`recipes/cross-workflow-handoff.md`). |

### Integration / dev
| `type` | What it does | Key attributes | Trap |
|---|---|---|---|
| `custom_webhook` | Arbitrary HTTP call, any method/auth | `url`, `method`, `body.rawData` (string template), `authorization` | **No built-in retry on 5xx/timeout.** `isPremiumAction: true` — requires the location's premium gate. Needs `stepIndex` + `advanceCanvasMeta` per `create-ghl-workflow/references/step-shapes.md`. |
| `webhook` | Legacy/simple outbound webhook | `url`, `method`, `customData` | |
| `custom_code` | Sandboxed JS | `code`, `inputData`, `language` | V8 isolate, no `npm`/external `require`, ~30s ceiling (not officially published). No visibility into failures except Execution Logs. |
| `google_sheets` | Read/write/lookup a sheet | `spreadsheet`, `sheet`, `action` | Sheet ID stored in the action; renaming/moving the sheet breaks it silently. |
| `math_operation` / `text_formatter` / `datetime_formatter` | Utility transforms on custom values/fields | varies | |

### AI
| `type` | What it does | Key attributes | Trap |
|---|---|---|---|
| `ai_agent` | GHL-native AI agent (tools, memory, structured output) | `model`, `tools`, `outputFormat` | |
| `chatgpt` | Separate OpenAI ChatGPT action | `actionType`, `apiKey`, `instructions` | Distinct provider from `ai_agent` — don't conflate the two when reading a workflow. |
| `conversationai_*` (5 types: `objective`, `ai_message`, `custom_message`, `ai_splitter`, `transfer_bot`) | Conversation AI Studio bot-canvas nodes | varies | The bot canvas itself (prompts, KB, flow graph) is **UI-only** — not exposed via public API (confirmed live, see §4). These step types only cover the workflow-side wiring. |

### Coverage gap — the corpus undercounts the real action surface
Per `STEP_TYPES.md` (2026-05-17 note): 66 step types were corpus-observed, but the
repo's fuller bundle-registry analysis puts the total GHL action surface at several
hundred once marketplace/integration actions are combined — see
`sniffs/UNIFIED_ACTION_INDEX.tsv` and `sniffs/SCHEMA_COVERAGE.md` in the research repo
for the reconciled count if precision matters for a specific build. This file stays
anchored to the 66 corpus-verified types plus what's cited from `ghl-specialist` and
the live MCP below; it does not restate the repo's own evolving totals.

---

## 3. What the internal builder exposes that the public API doesn't

Verified live during authoring of this file — `mcp__uxie-ghl-mcp__list_categories`
shows a `workflows` category (and its `workflows-v3` twin) with **exactly one action
each**: `workflows__get-workflow` (`GET /workflows/`), described in its own search
result as "Read-only workflow list. The GHL public API does not expose workflow
triggers, steps, conditions, or AI-agent usage details. Workflow builder configuration
is still UI-only." That live result matches the research repo's own framing
(`docs/10-caveats.md §1`, §8): the public v2/v3 surface at
`services.leadconnectorhq.com/workflows` is list-only; there is no public
create/update/delete/trigger/publish endpoint for a workflow's body or triggers. This
is why `create-ghl-workflow` (a sibling skill, delegated to for execution) has to use
the undocumented internal builder API at `backend.leadconnectorhq.com` — off-ToS,
reverse-engineered, no stability contract (`docs/10-caveats.md §1–2`).

Conversation AI Studio's bot canvas (prompts, knowledge base, Flow Builder graph) is
the same story: `conversation-ai-v3` (12 actions, live-verified) covers agent CRUD and
attaching/listing/updating actions, but not the prompt/KB/flow-graph authoring surface
— matches `ghl-specialist`'s `references/action-gotchas.md` note that Conversation AI
bot config "is not exposed via public API."

## 4. What the public API DOES give you — corrections to older assumptions

Two things worth flagging because older research (this repo, and `ghl-specialist`'s
`api-gap-matrix.md`) either hadn't found them yet or is now stale:

- **Programmatic workflow enrollment is not inbound-webhook-only anymore.**
  `TRIGGER_TYPES.md` calls the inbound-webhook trigger "the only officially supported
  way to programmatically enroll contacts" — but a live `search_actions` call turned up
  `contacts__add-contact-to-workflow` / `contacts-v3__add-contact-to-workflow`
  (`POST /contacts/{contactId}/workflow/{workflowId}`, optional `eventStartTime` body)
  and the matching `delete-contact-from-workflow` for removal. Both are real, callable,
  documented public endpoints — a cleaner enrollment path than routing everything
  through a workflow-specific webhook URL when you already have the contact ID and the
  workflow ID. Use the webhook-trigger pattern when the caller doesn't have (or shouldn't
  have) direct API creds; use `add-contact-to-workflow` when it does.
- **Pipeline structure is no longer an API gap.** `ghl-specialist`'s
  `api-gap-matrix.md` (dated) says pipeline/stage CRUD is "read-only." A live
  `search_actions` call against `opportunities-v3` shows `create-pipeline`,
  `get-pipeline(s)`, and `delete-pipeline` all present (added 2026-06-26 per the MCP's
  own category notes) — pipeline structure is now fully writable via the public v3
  API. Don't route pipeline-structure work through the internal builder or treat it as
  a UI-only task; that's `ghl-pipeline-specialist`'s territory via the public API, out
  of scope here (see this skill's `SKILL.md` → Scope).

---

## Sources consulted

- `ghl-workflow-api-docs/TRIGGER_TYPES.md`
- `ghl-workflow-api-docs/STEP_TYPES.md`
- `ghl-workflow-api-docs/docs/04-workflow-anatomy.md`
- `ghl-workflow-api-docs/docs/09-gotchas.md`
- `ghl-workflow-api-docs/docs/10-caveats.md`
- `ghl-workflow-api-docs/recipes/cross-workflow-handoff.md`
- `plugins/uxie-ghl-factory/skills/create-ghl-workflow/references/step-shapes.md`
- `~/.claude/skills/ghl-specialist/references/trigger-gotchas.md`
- `~/.claude/skills/ghl-specialist/references/action-gotchas.md`
- `~/.claude/skills/ghl-specialist/references/api-gap-matrix.md` (cited only for what's
  now stale — pipeline CRUD claim corrected in §4)
- Live MCP: `mcp__uxie-ghl-mcp__list_categories`,
  `mcp__uxie-ghl-mcp__search_actions` on `workflows`, `contacts`/`contacts-v3`,
  `opportunities-v3`, `conversation-ai-v3` (called during authoring, 2026-07-11)
