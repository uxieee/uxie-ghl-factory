# Authoring the IR

Everything the compiler accepts when you build a workflow: the IR shape, workflow settings,
sticky notes, object-based workflows, step outputs, the loud-failure contract, inbound-webhook
sample payloads, and custom code.

Read `SKILL.md` first — the gates and the one rule live there, not here.

## Authoring the IR

Write intent, using **human names** — the resolver turns them into IDs:
pipelines/stages, calendars, users, forms, surveys, custom fields, AI agents — and (2026-08-22)
**workflows** (`add_to_workflow: { workflow: "name" }`), **custom values**
(`update_custom_value: { customValue: "name or key" }`), **membership offers**
(`membership_grant_offer: { offer: "title" }`), **trigger links** + **course products/offers in
trigger filters** (`{ field: link.id | membership.product.id | offer.id, value: "name" }`).
Plus **template library** (`email: { template: "name" }` → email-builder id + `templatesource`;
`sms`/WhatsApp/DM family the same from the SMS/WA library), **phone numbers by TITLE**
(`settings.senderAddress.from_number: "GROM Digital AU"` → its E.164), and trigger-filter values
for `workflow.id`, `payment.global_product_ids` (store products) and `twoStepOrderForm.funnelId`.
An unresolvable name ABORTS with `Missing account dependencies` before any write.

```yaml
name: "VIP nurture"
triggers:
  - { ref: t1, type: contact_tag, name: "VIP added",
      filters: [ { field: tagsAdded, value: "VIP" } ] }   # lean filter → engine expands
graph:
  - { ref: a, kind: action, type: add_contact_tag, name: "Tag welcomed",
      attributes: { tags: ["welcomed"] } }                # new tags auto-created
  - { ref: o, kind: action, type: create_opportunity, name: "Open deal",
      attributes: { name: "Deal", pipeline: "Sales", stage: "New Lead", status: open } }  # names → IDs
  - ref: b
    kind: if_else
    name: "High value?"
    branches:
      - { ref: y, name: "Yes", conditions: [ { conditionType: contact_detail, tag: high-value } ], then: [ ... ] }   # simple TAG intent — compiler normalizes the shape
      - { ref: n, name: "No", else: true, then: [ ... ] }
```

> **Trigger tag value = STRING; if/else tag value = ARRAY.** These are different schemas
> that share the `index-of-true` operator — do not copy one into the other. A trigger
> condition written as `value: ["VIP"]` saves, reads back `active: true`, and survives a
> draft→publish cycle, but GHL's tag-event dispatcher never subscribes, so the workflow
> silently NEVER FIRES. The compiler now unwraps a single-element array for
> `index-of-true`/`index-of-false` on trigger filters; author `value: "VIP"` anyway.
> One tag per filter row — a multi-tag array is rejected (`FILTER_VALUE`).
> This applies to every trigger tag row: `tagsAdded`, `tagsRemoved`, and `contact.tags`
> on `appointment` / `note_add` / `customer_reply` / `opportunity_decay` / `affiliate_*`.

**if_else condition authoring — write SIMPLE intent; the compiler normalizes the exact
GHL shape per type (a hand-crafted shape compiles clean but MATCHES WRONGLY at runtime):**

| Intent | Author as | Compiler emits |
|---|---|---|
| Has tag | `{ conditionType: contact_detail, tag: "vip" }` | `conditionSubType: tags` (plural), `conditionOperator: index-of-true`, `conditionValue: ["vip"]` (**array** — contrast the TRIGGER note below) |
| Does NOT have tag | `{ conditionType: contact_detail, tag: "vip", not: true }` | …`conditionOperator: index-of-false` |
| Opportunity in stage | `{ conditionType: opportunities, stage: "<id or name>" }` | `conditionSubType: pipelineStageId`, `conditionOperator: ==`, `conditionValue: "<stageId>"` (string; a name → id in resolve) |
| Custom field (text) | `{ conditionType: contact_detail, conditionSubType: "<fieldId>", conditionValue: "X" }` | `conditionOperator: contain`, value **lowercased** |
| Custom field (number/date) | …add `conditionOperator: "=="` | `conditionOperator: ==` (no lowercasing) |
| Trigger identity | `{ conditionType: trigger, conditionValue: "<triggerId>" }` | `conditionOperator: ==` |
| Attribution (UTM source etc.) | `{ conditionType: contact_detail, conditionSubType: "first_attribution:utmSource", conditionOperator: "==", conditionValue: "google" }` — 28 leaves: `first_attribution:`/`last_attribution:` × campaign/campaignId/medium/mediumId/utmSource/utmMedium/utmContent/utmTerm/utmCampaign/utmKeyword/utmMatchtype/sessionSource/adGroupId/adId (string operators) | as authored + `__customFieldType__: "standard"` (live-captured 2026-08-22) |
| Appointment was rescheduled | `{ conditionType: appointment, conditionSubType: appointmentRescheduled, conditionOperator: is, conditionValue: "true" }` | as authored (`conditionValue` is the STRING `"true"`, not a boolean) |
| Appointment start date, RELATIVE | `{ conditionType: appointment, conditionSubType: startTime, conditionOperator: "!=", conditionValue: "2", conditionValueOperator: inTheNext, conditionValueUnit: days }` | as authored + `__customFieldType__: "standard"` (see below) |

**`if_else` DOES support relative dates — the comparator is NOT in `conditionOperator`.**
This is the single easiest thing to misread in the whole condition model. `conditionOperator`
carries only the Is/Is-not half (`==` / `!=`), so a reader sees a plain `!=` and concludes
there is no relative support. The comparator lives in **two extra fields**:

```
conditionValueOperator : inTheNext     <- the actual comparator
conditionValueUnit     : days
conditionValue         : "2"           <- a STRING, not a number
```

In the UI the control only appears **after** an operator (Is / Is not) is selected, which is
the other half of why it reads as unsupported.

**Comparator vocabulary — all 11 LIVE-PROVEN on `appointment`/`startTime` (2026-07-19).**
Method: one probe workflow with a branch per comparator, then read what the BUILDER
RENDERS. A value the builder cannot resolve renders no label, so a correct human label is
proof the value is the canonical one.

| stored `conditionValueOperator` | builder renders | value it takes |
|---|---|---|
| `today` / `tomorrow` / `yesterday` | "is today" / "is tomorrow" / "is yesterday" | **none** — omit `conditionValue` |
| `on` | `is On "2026-08-01"` | a date |
| `between` | `is between "2026-08-01"` | a date (range form NOT characterized) |
| `after` / `before` | `is After` / `is Before "2026-08-01"` | a date |
| `inTheNext` / `inTheLast` | `is In the Next` / `is In the Last "2"` | count (STRING) + `conditionValueUnit` |
| `afterDate` / `beforeDate` | `is After date` / `is Before date "2026-08-01"` | a date |

Only `inTheNext` + `days` also has corpus support (a sweep of 78 workflows across two
accounts found exactly one relative-date condition in the wild — so the wild is no guide
here; the probe is).

Two caveats that survive the proof:
- **`between` and `after` are NOT in the UI's dropdown** for this subtype, yet the backend
  accepts them and the builder renders them. Treat them as real-but-unofficial; `between`
  with a single date renders, but its range form was not worked out.
- Proven for `conditionSubType: startTime` only. `afterDate`/`beforeDate` also appear in the
  builder's legacy-condition migration path, which is **`contact_detail`-only** — do not
  assume the whole table transfers to other condition types unprobed.

⚠️ A neighbouring smart-list enum in the same bundle uses **single-letter** units (`d`, `w`,
`M`, `y`). That is a DIFFERENT vocabulary — the live workflow condition stores the full word
`"days"`. Do not cross them.

**Granularity contrast:** `if_else` relative dates only go down to **days**. The *wait* step
goes down to hours ("Until a scheduled date/time → Appointment → Before N hours"). If you
need sub-day appointment timing, it has to be a wait step, not a condition.

Ground truth for the shape: `engine/relative-date-condition.test.mjs` asserts the compiler
reproduces a live UI-built condition field-for-field (captured 2026-07-19, read-only).

**Reschedule detection — GHL has NO native "rescheduled" trigger or status.** The only way
to catch a reschedule is the two-part pattern: trigger on the `appointment` event with **no
status filter**, then gate with the `appointmentRescheduled` condition above. Verified live
2026-07-16. Don't hunt for a reschedule trigger — there isn't one.

Do NOT author `conditionSubType: tag` + `conditionOperator: contains` — that legacy shape
matches nothing and mis-routes tagged contacts to the None branch (the normalizer rewrites
it, but don't rely on that; use the `tag:` form).

⚠️ **Opportunity-stage: the type is PLURAL and the subType is camelCase** (live-confirmed
2026-07-16, workflow `08 Deposit Paid Handler`). `conditionType: opportunity` (singular) or
`conditionSubType: pipeline_stage_id` (snake_case) is a **silent** failure — it builds,
publishes and round-trips clean, but GHL can't map it back to a known field, so the branch
never evaluates and the builder shows a blank "Select" instead of the stage picker. The
compiler now canonicalizes the known aliases (`opportunity`, `opportunity_stage`,
`pipeline_stage_id`, lean-IR `field: pipeline_stage`) to `opportunities`/`pipelineStageId`,
and any remaining dead spelling hard-fails at compile with `COND_SHAPE` rather than being
saved. Don't lean on the aliases — author the `{ conditionType: opportunities, stage: … }`
form in the table above.

⚠️ **Opportunity-stage conditions need an ASSOCIATED opportunity** (runtime-proven 2026-07-15).
An `opportunities`/`pipelineStageId` if_else evaluates against the opportunity associated with
the *workflow run*, not "any opp the contact has". If the contact didn't enter via an
opportunity trigger (`opportunity_created`, `pipeline_stage_updated`, …) and the path never ran
`create_opportunity`/`find_opportunity`, the run has no associated opportunity and the condition
falls to None even when the stage id is correct — the same OPP_UNASSOCIATED rule the compiler
enforces for `update_opportunity`. Enter via an opp trigger (or create/find on the path) before
an opp-stage branch.

- **Node kinds:** `action` (any linear type), `wait`, `if_else` (N≥2 branches, one
  optional `else: true`), `split` (`workflow_split`, weighted/random), `ai_decision`
  (`workflow_ai_decision_maker`, Default + N branches), `goto` (must be last in its
  branch). Pre-set 2-branch finders (`find_contact`/`find_opportunity`/`lc_merge_contact`)
  use `onFound`/`onNotFound`.
- **Conversation-AI flow-builder containers** (for `FLOW_BUILDER_BOT` flows — see
  the `ghl-conversation-ai` / `ghl-voice-ai` skill): `conversationai_book_appointment` uses scope
  keys `onBooked`/`onNotBooked`; `conversationai_ai_splitter` uses `branches: [{name, then}]`
  + an optional `default: [...]` "No condition met" tail. The other 7 `conversationai_*`
  nodes are linear `action`s. Bind the flow to its agent by putting `convTriggerBotId: <agentId>`
  on the `conv_ai_trigger`, and set top-level `workflowType: "agent"` on the IR.
- **Names the resolver understands** (CLOSED list — everything else must already be a
  real ID): `attributes.pipeline`/`stage` (opportunity steps), `attributes.user`
  (assign_user), `attributes.calendar` (appointment_booking ONLY), `attributes.assignedTo`
  (task), `attributes.agent`/`employee` (voice/ConvAI agent), and trigger filter values
  referencing pipeline/form/calendar/survey names.
- **⚠️ NOT resolved and NOT flagged — you must pre-resolve these to real IDs yourself
  (via the `ghl` MCP) before authoring, or the workflow builds clean and silently no-ops
  at runtime:** custom values (`{{custom_values.x}}` in bodies), payment products/prices,
  `add_to_workflow`/`remove_from_workflow` `workflow_id` (a SIBLING workflow — pass its id,
  NOT its name; the validator does not check it exists), `conversationai_book_appointment.calendarId`,
  `conversationai_transfer_bot.assignedEmployeeId`, `conversationai_objective.contactField`,
  and custom-field ids used in trigger filter conditions. The abort gate only covers the
  closed list above — these pass through untouched.
- **Inline emails:** put `attributes._template: { title, html, previewText }` on an
  `email` node — the orchestrator creates the template first and links it.
- **Trigger-less workflows:** `triggers: []` is legal — for workflows enrolled via
  `add_to_workflow` from another workflow. The build simply makes no trigger POSTs.
- **Attribute keys are validated** on verified-live types: an invented key (e.g.
  `message` instead of `body` on `sms`) fails compile with `ATTR_KEY` instead of
  saving a step that renders blank. Check the type's real keys with
  `node scripts/query-catalog-cli.mjs <type>`.

### Workflow settings (the Settings tab) — `settings:` at the top level of the IR

Every control the builder's Settings tab has, by its stored key. Omit a key and the engine
writes the UI's own default; an unknown key is REFUSED (`SETTINGS_KEY`) — it used to be
silently dropped.

```yaml
settings:
  allowMultiple: true                 # "Allow re-entry" — UI default ON (corpus 313/326)
  allowMultipleOpportunity: true      # "Allow multiple opportunities" — UI default ON
  stopOnResponse: false               # "Stop on response"
  autoMarkAsRead: false               # "Mark as read" (Conversations)
  timezone: account                   # account | contact — the ONLY two values; never an IANA zone
  window: { start: "08:00", end: "17:00", days: [1,2,3,4,5] }   # "Specific time" ON; null/omit = OFF
  senderAddress: { from_name: "Sarah", from_email: "sender@example.com", from_number: "+15551234567" }
  workflowNote: "Why this workflow exists"   # the Notes panel's workflow note (string → stored shape)
```

- `window.days` are weekday numbers, 0 = Sunday … 6 = Saturday; times are 24h `HH:mm`. The UI's
  defaults when the toggle is switched on are exactly `08:00`–`17:00`, Mon–Fri; the stored object
  also carries `condition: "when"` (the engine adds it).
- `senderAddress`: From name **requires** From email (GHL's `checkSenderAddress`); merge tags are
  allowed in both. Empty strings are dropped, as the UI does.
- Live-proven 2026-08-22 (GROM AU): the Settings tab's Save is the no-suffix `PUT /workflow/{loc}/{wid}`
  carrying these keys; `window` and `meta.statsView` round-trip exactly.
- Hatch: `skipSettingsCheck: true` in the build ctx turns the refusals into warnings.

### Sticky notes (the canvas note layer) — `stickyNotes:` at the top level of the IR

Sticky notes are a **separate resource** from the workflow document (the builder creates one the
moment it is placed); the engine creates them right after the workflow exists and reports
`sticky notes: N/N placed`.

```yaml
stickyNotes:
  - { content: "Why this workflow exists and who owns it", color: yellow, x: 320, y: 180 }
  - { content: "<p><b>Review</b> the SMS copy monthly</p>", color: blue, width: 400, height: 400 }
```

- `content` is HTML in the builder (bold/italic/lists/links/images); plain text is wrapped in `<p>`.
  Cap 5,000 chars. `color` is one of the 10 swatches `yellow, blue, green, orange, cyan, gray, teal,
  purple, fuchsia, rose`. Defaults 400×400 at the UI's first placement; minimum 150×80.
- Edit ops: `{ "op":"addStickyNote", "note":{…} }` and `{ "op":"updateStickyNote", "noteId":"<_id>",
  "note":{ color: green } }` (partial). Read them back with `export_workflow` (`stickyNotes[]`).
- Live-proven 2026-08-22: `POST /workflows/sticky-note?locationId=` (201) and
  `PATCH /workflows/sticky-note?_id=&locationId=` (200). Hatch: `skipStickyCheck`.
- **Action notes** (the node ⋯ → Notes popover) are a node key: `notes: ["Owner: Sarah", "Copy reviewed 2026-08"]` →
  `comments[]` on the step (`{id, userId, timestamp, comment}` newest-first), saved with the workflow.

### Object-based workflows (custom objects) — `object:` at the top level of the IR

```yaml
object: "CLAUDE Pet"        # schema label, plural, or key ('custom_objects.claude_pets' / 'claude_pets')
triggers:
  - { ref: t1, type: custom_object_created, name: "Record created" }
```

- Resolves against the location's object schemas (`/objects/`) → the create/save carry
  `customObjectType: "custom_objects.<key>"` top-level (live-proven 2026-08-22, canary 040a9a9e).
- **The picker offers only these actions in an object workflow** (the engine refuses others,
  `OBJECT_STEP`; hatch `skipObjectRules`): if/else, email, wait, update_custom_value, goto, the
  four formatters, math_operation, custom_code, add/remove(-all)_from_workflow, array_functions,
  drip, add_notes. Contact-centric steps (tags, opportunities, SMS…) are un-producible there.
- Object trigger filters are minted per schema field — author them as stored rows or leave `[]`.

### Step outputs — referencing what an earlier step PRODUCED

`{{custom_webhook.N.response.…}}`, `{{chatgpt.N.response}}`, `{{custom_code.N.output.<key>}}`,
`{{datetime_formatter.N.date}}`, `{{number_formatter.N.result}}`, `{{text_formatter.N.result}}`,
`{{math_operation.N.result}}`, `{{array_functions.N.result}}`, `{{ai_agent.N.response}}`,
`{{[task-notification].N.title}}` — and the same `N.field` as if/else conditionSubType under the
matching condition group. **`N` is the step's per-type `stepIndex`** (1-based, minted at
creation), NOT its position; the engine numbers producers automatically and warns when a
reference has no matching producer. Rules that bite:

- **`custom_webhook` outputs only exist when `saveResponse: true`** and a successful test
  request was saved (the drawer blocks Save on that) — the engine warns otherwise. Same idea
  for `custom_code` (fields = keys of its run-test `output`).
- Outputs are offered from ANCESTOR steps only (never sibling branches).
- ⚠ Deleting the highest-numbered step of a type REBASES GHL's counter — a later step of the
  same type reuses that `N`, and stale references silently rebind to it.
- `inboundWebhookRequest.<path>` (the inbound-webhook trigger's payload) and marketplace
  TRIGGER outputs carry **no `N`**; marketplace ACTION outputs are `{{<actionType>.N.<reference>}}`
  from the app's declared customVars.

### The engine fails LOUD rather than silently dropping intent

A build that reports success while doing nothing at runtime is the worst failure this tool
has — an operator only finds out when a real customer gets spammed or a lead sits in the
wrong stage. Every guard below exists because that happened on a live account (2026-07-16):

| Code | Fires when | The silent failure it replaces |
|---|---|---|
| `NODE_KEY` | An unknown node-level key, or a scope (`onFound`/`onEvent`/…) on a type with no container handler for it | The whole subtree was discarded; the build reported a clean round-trip for a fraction of the IR |
| `NODE_DROPPED` | An authored node never reached the built payload (engine backstop) | As above — the authored-vs-compiled proof that round-trip verification never gave |
| `EMPTY_STEP` | A `wait` with no/partial duration, or an `update_opportunity` with nothing to update | `startAfter: {}` (the wait **did not pause** — 4 messages in 6 seconds) and `__customInputFields__: []` (a stage move that never moved) |
| `COND_SHAPE` | A dead opportunity-stage condition spelling | A branch that publishes clean and never evaluates |
| `ATTR_KEY` | An invented attribute key on a verified-live type | A step that saves and renders blank |
| `OPP_UNASSOCIATED` | `update_opportunity` with no proven opportunity on its path | A stage move that no-ops at runtime |
| `OPP_LOST_REASON_NO_LOST_STATUS` | `lostReasonId` on a step whose `status` isn't literally `lost` | The builder **deletes** the lost-reason entry on open — the step saves, round-trips clean, and records no reason |

**`kind:` is an accepted alias for `type:` on the finder containers** (`find_opportunity`,
`find_contact`, `lc_merge_contact`) — both spellings keep their `onFound`/`onNotFound`
subtree. Previously `kind: 'find_opportunity'` (no `type:`) silently dropped the entire
subtree: a 51-step IR built 8 steps and reported "round-trip: 8 clean".

**Read `authored → compiled`, not `steps`.** The build report carries `authored` (nodes you
wrote), `compiled` (templates sent) and `steps` (templates GHL returned). `compiled >=
authored` is normal — containers add transition/None steps. A round-trip is only meaningful
next to `authored`; on its own it merely proves the server echoed what was sent.
- **Coverage:** 383 step types / 204 trigger types are catalogued (the live-proven
  subset is flagged ✅). Full index: `references/capabilities.md`; per-type lookup:
  `node scripts/query-catalog-cli.mjs <term>`; live counts: `node scripts/query-catalog-cli.mjs`.

### Inbound-webhook workflows — give the engine the sample payload

An `inbound_webhook` trigger's merge tags are NOT a schema: they are the leaf paths of the one
request GHL has pinned as the trigger's **reference**. So author webhook workflows with the
sample in the IR and let the engine check every reference before anything is saved:

```json
{ "name": "Lead intake from CRM",
  "sampleWebhookPayload": { "lead": { "email": "sample@example.com", "firstName": "Sam" }, "dealRefId": "X-1", "items": [{ "sku": "A" }] },
  "triggers": [ { "ref": "hook", "type": "inbound_webhook", "name": "Inbound Webhook", "filters": [] } ],
  "graph": [ { "ref": "c", "kind": "action", "type": "create_update_contact", "name": "Upsert",
               "attributes": { "fields": { "email": "{{inboundWebhookRequest.lead.email}}", "firstName": "{{inboundWebhookRequest.lead.firstName}}" } } } ] }
```

- Every `{{inboundWebhookRequest.<path>}}` is linted against the sample's leaf paths (object /
  array prefixes like `{{inboundWebhookRequest.items}}` are fine — they feed loops). An unknown
  path warns with a near-miss hint ("did you mean lead.email?") because at runtime it renders
  EMPTY. Hatch: `skipWebhookCheck`.
- The trigger id is SERVER-assigned on POST, so the build report names the receiving URL
  afterwards: `report.webhookUrls[] = { name, triggerId, url }` —
  `https://services.leadconnectorhq.com/hooks/{loc}/webhook-trigger/{triggerId}`. Give that URL
  to the external system.
- To make the tags real in the UI picker, set **`pinWebhookSample: true`** (IR top-level or build
  option) and the build itself POSTs the sample to the receiving URL, waits for GHL to record it,
  pins it as the reference and reports `report.webhookPins[] = {triggerId, requestId, referenceId,
  tagCount, mergeTags, error}` (live-proven GROM AU 2026-08-22, 4 tags). After the fact, the MCP
  tool does the same: `pin_webhook_sample { locationId, triggerId, samplePayload, confirm:true }` (POSTs the sample
  to the receiving URL — unauthenticated by design — waits for GHL to record it, PUTs
  set-as-reference, returns the merge tags). Live-proven on a GROM AU canary 2026-08-22. Pinning
  REPLACES the active reference: on a live workflow only do it with a payload shaped like the
  real traffic (or `pinLatestExisting:true` to pin what the real system already sent).

### Custom Code — test it in GHL's sandbox before you trust it

MCP `test_custom_code { locationId, code, language, inputData }` runs the code in the same
sandbox the builder's "Test code" button uses and reports `passed`, `output`, `outputKeys`,
console streams, and the in-band `errorMessage`. Only a **non-empty object** assigned to
`output` is a valid step output — primitives are dropped by the sandbox, and `outputKeys` are
exactly the `{{custom_code.N.<key>}}` references downstream steps may use. Run it before
authoring those references; the engine's step-output check warns when a custom_code step has
no pickable output.

**The engine now does this for you on every build** (live-proven GROM AU 2026-08-22): each
`custom_code` step is run in the sandbox with its own `inputData` BEFORE the workflow is created;
a passing run **replaces the authored `output` sample with the real return object** (so the
picker offers the true keys) and warns when the keys differ; a thrown/invalid run is a warning
and the authored sample is kept. Build flags: `strictCustomCode: true` → a failing run aborts;
`skipCustomCodeTest: true` → skip. Read `report.customCodeTests[]` — `{id, name, passed,
outputKeys, authoredKeys, errorMessage, replacedOutput}`. Author `inputData` with values that
let the code run (merge tags stay literal strings in the sandbox).


