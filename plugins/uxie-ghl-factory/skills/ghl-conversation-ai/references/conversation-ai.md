
> **Scope: the internal rail.** Conversation AI reads and most writes go through the public
> rail (see `SKILL.md`). The internal endpoints below are what you need for the per-contact AI
> switch (`/conversations-ai/employeeConfigs`), prompt version history (`oldPromptIds`) and the
> Agent Deployment routing table (`/agent-deployment/routing-config/configs`).

# Conversation AI (chat "AI Employee")

> Ground truth: `ghl-workflow-api-docs/research/ai-agents-internal/conversation-ai-internal.md`
> (captured live 2026-07-11, GROM Digital AU, "Prompt Based Bot" flow) + this plugin's
> `engine/convai-ir.mjs` / `engine/convai-compiler.mjs`. This is the internal
> `services.leadconnectorhq.com/ai-employees/*` surface the builder UI actually uses — the
> public `conversation-ai-v3` API is a separate, thinner façade the UI doesn't call.

**Status: LIVE-CREATE-PROVEN.** Create → read → delete, plus the `humanHandOver` action, have
all been round-tripped against a real account and verified. The other 6 action types
(`appointmentBooking`, `triggerWorkflow`, `updateContactField`, `stopBot`, `transferBot`,
`advancedFollowup`) are verified against their captures (see the Actions section below) but
not yet individually live-fired. This is the most mature of the three AI products in this
skill.

## What Conversation AI is

The chat bot ("AI Employee") that engages contacts over SMS/IG/FB/WebChat/Live_Chat/WhatsApp.
Distinct from Voice AI (phone calls) and Agent Studio (autonomous tool-using agents) — see
the parent SKILL.md's three-way distinction. It responds via a single free-text prompt split
into three parts, not a tool-calling system prompt.

## Endpoint map

| Operation | Method | Path |
|---|---|---|
| Create agent | `POST` | `/ai-employees/employees` |
| Update agent (PUT — replace-what-you-omit for booleans, see "Update-PUT semantics") | `PUT` | `/ai-employees/employees/:agentId` |
| Get agent | `GET` | `/ai-employees/employees/:agentId` |
| List / search agents | `GET` | `/ai-employees/employees/search` · `/ai-employees/employees/dashboard/search` |
| Delete agent | `DELETE` | `/ai-employees/employees/:agentId` |
| Create action | `POST` | `/ai-employees/actions` |
| Search actions | `GET` | `/ai-employees/actions/search?employeeId=…` |
| List knowledge bases | `GET` | `/knowledge-base/all?locationId=…` |
| Default KB (idempotent get-or-create) | `POST` | `/knowledge-base/default` (`{locationId, migrateDocs:true}`) |
| Default prompt template | `GET` | `/conversations-ai/prompt/default?locationId=…&intentType=…` |
| Deployment routing rows (one per channel) | `GET` | `/agent-deployment/routing-config/configs?locationId=…&agentId=…` |
| Update a routing row (full row only) | `PATCH` | `/agent-deployment/routing-config/configs/:rowId` |
| Live-chat widget picker (`offset`+`limit` required) | `GET` | `/chat-widget/list?locationId=…&chatType=liveChat&offset=0&limit=20` |

Auth: Bearer **plus** `token-id` — the dual-credential AI rail (`raw_request` with `host:"ai"`
attaches both). See the parent SKILL.md's Execute section for the capture procedure pointer.

## Agent config

- `employeeName` / `name` — display name.
- `mode` — enum **`off` | `suggestive` | `autoPilot`** (lowercase strings). `off` disables the
  bot, `suggestive` drafts replies for a human to approve, `autoPilot` sends unattended (capped
  by `autoPilotMaxMessages`, default 75).
- `channels[]` — enum: `SMS`, `IG`, `FB`, `WebChat`, `Live_Chat`, `WhatsApp`. Non-empty required.
- `botType` — enum **`PROMPT_BASED_BOT` | `FLOW_BUILDER_BOT` | `FORM_BASED_BOT`** (three, per the bundle's own enum; `convai-ir.mjs` `BOT_TYPES`). The prompt bot is the
  three-part-prompt agent above; the flow bot's logic is a **workflow** (see "Flow-Based
  Builder" below). Both are buildable via the engine (`convai-ir.mjs` `BOT_TYPES`).
  - **Choosing between them is a real trade-off** (flow-bot half live-measured 2026-08-31; the
    prompt-bot comparison is inferred from operator observation on other accounts, not measured
    side-by-side): a
    `FLOW_BUILDER_BOT` buys explicit routing and pays with less control over what a node
    says in cases the node did not anticipate — e.g. `conversationai_book_appointment`'s
    no-appointment-found wording is the node's own and takes no steering from
    `promptInstructions` (it obeys prompt FORM, then emits its own CONTENT for the empty
    result). A prompt bot composes every reply with the whole system prompt in play. Weigh this
    per client, and re-test whenever GHL updates the nodes.
  - ⚠️ **In a flow bot, a global prohibition does NOT reach a node whose local instruction
    implies a narrower job.** A node scoped to one task will declare incapacity for anything
    outside that scope — in the exact words the global prompt bans — unless the node's own text
    carries the rule with its positive half (what to do instead). Repeat behavioural rules
    byte-identically in every speaking node. See
    `create-ghl-workflow/references/flow-bots.md` → "Runtime doctrine".
- **Three-part prompt** — the entire personality of the bot lives in three free-text fields,
  each with a UI word-limit:
  - `personality` — who the bot is / tone.
  - `goal` — what it's trying to accomplish in the conversation.
  - `instructions` — specific behavioral rules (what to ask, what to avoid, how to escalate).
- `waitTime` / `waitTimeUnit` — reply delay before the bot responds (default 2 seconds).
- Sleep (bot pauses itself under conditions): `sleepEnabled`, `sleepOnManualMessage`,
  `sleepOnWorkflowMessage`, `sleepTime`, `sleepTimeUnit` (default: disabled, 2 hours).
- `knowledgeBaseIds[]` — KBs the bot can draw on.
- `knowledgeBaseTriggers[]` — conditional KB routing: `{id: "kbt_<epoch>_<rand>", mode: "custom",
  knowledgeBaseIds[], triggerCondition, priority}`. This routing concept is internal-only — the
  public KB API manages KB *content*, not this trigger logic.
- `summary{}` — conversation-summary settings (inactivity threshold, minimum messages before
  summarizing, notification routing). Also carries **`summary.customFieldId`** and
  **`summary.workflowIds[]`**, which make the generated summary workflow-obtainable — see
  "[Conversation summary is workflow-obtainable](#conversation-summary-is-workflow-obtainable-summary)"
  below.
- `llm{primary, secondary}` — model selection (e.g. `gpt-4.1` / `gpt-4.1-mini`); observed on
  update captures.
- `respondToImages`, `respondToAudio`, `isObjectiveBuilderEnabled` — secondary knobs, pass through as given.
- 🔴 `responseLength` / `aiResponseLengthEnabled`, `isPrimary`, `llm`, `knowledgeBaseTriggers` — **NOT passed
  through on create** (R-64, 2026-09-02): `buildCreateBody` hardcodes `responseLength:'balanced'`,
  `aiResponseLengthEnabled:false`, `knowledgeBaseTriggers:[]` and drops the author's value with no
  warning. `knowledgeBaseTriggers` is settable on the update path; `responseLength`, `llm` and
  `isPrimary` are reachable on neither. Every engine-created agent is `balanced` until this is
  fixed — set them in the UI or by a direct PUT and read back.
- `mode` — the write takes `autoPilot`; the READ returns **`auto-pilot`** (hyphenated). The IR accepts
  both spellings and emits the write one, so a live record can be copied into a spec (fixed 2026-09-02).

## Conversation summary is workflow-obtainable (`summary{}`)

Field existence **corroborated from captures** (this plugin's own May-2026 agent GETs and the
25-Aug-2026 ai-employees bundle, no client/IDs/PII in either) — the ConvAI conversation summary
is not confined to the `humanHandOver` action's Task. It is a first-class agent setting with two
workflow-facing outputs, both persisted on the agent's `summary{}` object.

| UI control | `summary{}` field | Effect |
|---|---|---|
| **Save to custom field** | `summary.customFieldId` | Writes the generated summary into a **contact** custom field. |
| **Trigger a workflow when summary/transcript generated** | `summary.workflowIds[]` | A hook that enrols the listed workflow(s) at the moment a summary commits. |

**Contributor-attested (2026-07-18), not independently re-verified** — the details below come
from contributor zedricedwardc (PR #3); this plugin has corroborated that the fields exist and
are named as shown (via JSON captures of the agent object), but has not itself re-driven the
behaviour or confirmed the UI:
- Both controls live in the UI under **ConvAI → Preferences → Conversation Summary**. A JSON
  capture of the agent object proves the two `summary{}` fields exist — it doesn't show where
  their controls sit on screen, so the UI location is attested, not corroborated the way the
  field existence above is.
- `summary.customFieldId` must point at an **existing `LARGE_TEXT`** field — it does **not**
  auto-create one. Each regeneration **overwrites** the field.
- Once it points at a `LARGE_TEXT` field, the summary merges like any other contact field:
  `{{contact.<fieldKey>}}`.
- 🚨 **Timing gotcha.** A human-handover does generate a summary, but the write is asynchronous
  and lands **seconds after** the `ai:escalated` tag is applied. A workflow triggered by that tag
  that merges `{{contact.<fieldKey>}}` immediately renders **BLANK** — it reads the field before
  the summary lands. Two fixes: add a short wait (~3 min) before the merge step, or trigger off
  the summary-generated hook (`summary.workflowIds`) instead of the tag, since that hook fires
  *after* the commit.

An engine emitting an `ai:escalated`-triggered summary email should default to the wait or the
hook rather than merging the field on the bare escalation tag — but treat that recommendation,
and the LARGE_TEXT/overwrite/timing specifics above, as attested rather than independently proven
until this plugin drives the behaviour itself.

## Update-PUT semantics

`PUT /ai-employees/employees/:agentId` accepts a partial body, and the old claim that it
**merges** was drawn from a capture where the fields at risk were already `false` — so a
reset-to-false could not have been seen. A live partial PUT carrying only `knowledgeBaseIds` +
`knowledgeBaseTriggers` reset the agent-level `cancelEnabled` and `rescheduleEnabled` to `false`
(2026-08-28). Treat the PUT as **replace-what-you-omit for booleans** until a differential at
non-default values says otherwise: send every agent-level field you care about (`cancelEnabled`,
`rescheduleEnabled`, `tones`, `sleepOnManualMessage`, `summary`, `actions`) on EVERY PUT, and read
the record back. The UI itself never sends a partial PUT — it PUTs the whole state.

`convai-ir.mjs` reflects this with two parse functions:
- `parseConvaiIR(ir)` — full validation for create. Requires `name`, `mode` (enum), `channels`
  (non-empty enum array).
- `parseConvaiPartialIR(ir)` — partial validation for update. Every field optional, but any
  field present must still satisfy its enum/shape.

## Deployment — the routing table

`channels[]` on the agent says which channels the bot *may* speak on. Whether a message on a
channel actually reaches the agent is decided by a separate routing table, one row per channel,
that no read of the agent record shows. **Status: LIVE-PROVEN 2026-08-31** — rows read, the
UI's PATCH captured and the row read back on a separate request, then a live reply through the
previously mute widget ~38 s later. Corpus:
`knowledge/corpus/ai-agents/20-api/agent-deployment-routing.md`.

| Operation | Method | Path |
|---|---|---|
| Read the rows | `GET` | `/agent-deployment/routing-config/configs?locationId=…&agentId=…` |
| Update a row | `PATCH` | `/agent-deployment/routing-config/configs/:rowId` |
| Widget picker | `GET` | `/chat-widget/list?locationId=…&chatType=liveChat&offset=0&limit=20` |

The two routing calls are AI-rail (`raw_request`, `host:"ai"`); `/chat-widget/list` answers
identically on backend and services. No typed tool covers them, so any "is this agent actually
live?" audit must read the rows directly.

Each row: `{channel, providerId, enabled, allIdentifiers, specificIdentifiers[], includeTags,
includeTagsOperator, excludeTags, excludeTagsOperator}`. `allIdentifiers:true` routes every
identifier on that channel ("All widgets") and `specificIdentifiers` is then empty;
`allIdentifiers:false` pins the row to the listed ids. The `…Tags` / `…Operator` fields
(`"AND"` observed) were seen in the row shape only — their matching semantics are unexercised.

🔴 **A row pinned to a dead identifier is a silent mute.** A `Live_Chat` row with
`allIdentifiers:false` and `specificIdentifiers` naming a widget that no longer exists was found
live: the current widget still created contacts, but the agent never replied and nothing
enrolled — no error in the agent record, the logs, or the UI. The routing row is the only place
the cause is visible. The widget picker lists live widgets only; the saved row keeps whatever id
it was given, which is how a dead id stays pinned unseen.

**Fix — the "All widgets" row.** `PATCH /agent-deployment/routing-config/configs/{rowId}` with
the **full row**, exactly as the product UI sent it (Agent Deployment → Live chat → edit →
Select all → Update):

```json
{"enabled":true,"allIdentifiers":true,"specificIdentifiers":[],"includeTags":[],"includeTagsOperator":"AND","excludeTags":[],"excludeTagsOperator":"AND"}
```

A partial body is **UNPROVEN** — no subset-of-keys body has ever been sent, so whether the
endpoint merges or replaces is unknown. Send the full row, then GET the rows back before
claiming the fix.

**Clone rule:** leave Live chat on *All widgets*, never a specific widget id — widget ids change
when an account or widget is cloned, and a pinned id fails silently (inferred from the dead id
observed; the clone path itself was not re-executed).

**Widget picker:** `offset` and `limit` are REQUIRED number strings — omit either and the call
422s naming exactly those two keys. Returns
`{chatWidgets:[{_id, chatType, name, default, settings, creationSource, createdAt, updatedAt}], totalCount}`.

## Actions

`POST /ai-employees/actions` — body `{employeeId, locationId, type, name, details{…}}`. Actions
are a **separate resource**, not embedded in the agent's create/update body — the agent create
call itself always sends `actions: []`; actions are POSTed after, once the real `employeeId`
is known.

**`humanHandOver` — the first live-verified action type.** Three live-verified 422 gaps found
during capture, all baked into `convai-compiler.mjs`'s `HUMAN_HANDOVER_DETAIL_DEFAULTS`:
- `details.enabled`, `details.triggerCondition`, `details.reactivateEnabled` are all required
  by the API even though they look optional from the UI.
- `details.sleepTime` / `details.sleepTimeUnit` (number 1-30 / enum `days`|`hours`|`minutes`)
  are ALSO required — unrelated to handover semantics on its face, but the API 422s without
  them.
- **`details.handoverType`** — REQUIRED (found 2026-07-15; first POST 422'd without it). Enum
  `contactRequest | lackOfInformation | failedToResolveIssue | custom`; the compiler defaults
  it to `custom` and validates the enum.
- `triggerCondition` has no sane default (it's the bot's own decision text for when to hand
  off) — the compiler requires it as a string 10-500 chars and throws `IRError` otherwise.

**All 6 remaining action types are now ALSO verified**, per
`research/ai-agents-internal/captures/convai-actions-all.json` (POST `/ai-employees/actions`
against a real test agent, 2026-07-11). `convai-compiler.mjs`'s `buildActionDetails`
dispatches on `action.type` and, for each of these, validates the required field(s) and
merges the caller's `details` over the capture's literal defaults:
- **`appointmentBooking`** — required: `details.calendarId`. Advanced-options toggles
  (`triggerWorkflow`, `sleepAfterBooking`, `transferBot`, `cancelEnabled`,
  `rescheduleEnabled`, ...) default to their captured off/null values.
  **`class_booking` (group / cohort / multi-day) calendars — live-verified 2026-07-17:** ConvAI
  **accepts** a `class_booking` `details.calendarId` (200, on both create-action and repointing
  a live action) and **does book it at runtime** (held appointment, `createdBy.source:
  conversations_ai`). 🚨 **But the booking is DAY 1 ONLY** — it does not recur across the
  cohort's days, exactly like a raw `create-appointment`. Never promise a client that the AI
  books a multi-day series; model the cohort as the Day-1 seat and carry "both days" in copy.
  See `ghl-pipeline-specialist/references/reference-pipelines.md` §"Adjacent surface:
  `class_booking` calendars" before building one.
- **`triggerWorkflow`** — required: `details.workflowIds` (non-empty array),
  `details.triggerCondition`. No optional fields observed.
- **`updateContactField`** ("Contact Info" in the UI) — required: `details.contactFieldId`,
  `details.description`. `contactUpdateExamples` defaults to `[]`.
- **`stopBot`** — required: `name` only (top-level). Ships with a pre-built "Goodbye
  Detection" scenario; the defaults reproduce its literal captured values
  (`stopBotDetectionType: 'Goodbye'`, `sleepTime: 24`, `tags: ['stop bot']`, ...).
- **`transferBot`** — required: `name` (top-level) + `details.transferToBot` (the target
  bot's employeeId — not asterisk-marked in the UI, but the field that makes the action
  functional). Ships pre-built as "Default Transfer Bot" targeting the location's primary
  bot.
- **`advancedFollowup`** ("Auto Followup" in the UI) — required: `name` only (top-level).
  Ships with a pre-built "Contact Stopped Replying" scenario (one `followupSequence` step).

`VERIFIED_ACTION_TYPES` in `convai-ir.mjs` now lists all 7. Any `type` outside this list (no
capture exists for it) still passes through as accepted-but-unverified — treat any result
from an unlisted type as unverified until a live capture backs it up.

**⚠️ Resolve dependency IDs FIRST (via the `ghl` MCP).** Every action detail that is an ID must
be a REAL account ID before you POST — the compiler validates presence/shape, not existence.
Resolve up front: `appointmentBooking.calendarId` + `conversationai_book_appointment.calendarId`
(calendars), `updateContactField.contactFieldId` + `conversationai_objective.contactField`
(contact custom fields), `triggerWorkflow.workflowIds` (workflows), `transferBot.transferToBot`
+ `conversationai_transfer_bot.assignedEmployeeId` (the target agent's employeeId), and
`knowledgeBaseIds` (KBs). `conversationai_services_booking` additionally needs a pre-configured
commerce service. A wrong/missing id posts clean and no-ops at runtime.

### Actions are ADD-ONLY, and the record holds only pointers

The agent record's `actions[]` is a list of **`{id, type}` pointers**. The configuration lives in a
separate registry:

```
GET /ai-employees/actions/search?employeeId={agentId}      employeeId ONLY
```

- `locationId` is **REFUSED**, not ignored — `422 property locationId should not exist`. Parse that
  as a result set and you report "0 configured actions" for an agent that has them.
- The envelope is **grouped by type**: `data[]` is one row per action type, the objects live in
  `data[].actions[]`. A flat `data.map(a => a.id)` yields `undefined` for every row.
- An `advancedFollowup` object carries `scenarioId`, `enabled`, a `followupSequence[]` of up to five
  steps, AND `followupSettings` (working hours per day, `dynamicChannelSwitching`, `timezoneToUse`).
- ⚠️ **There is no update-by-id and no DELETE for an action.** `PUT` on the agent with
  `actions: []`, `null`, `""` or a full record all return accepted and leave the array untouched.
  Removing an action requires the UI. Treat writing one as close to irreversible.
- A pointer whose configuration is missing is reported (R-45, live A/B on one account) to stop the
  agent generating anything, silently. The engine never writes a bare pointer — it POSTs the action
  as its own resource and threads the server id back — so if you see one, it was hand-assembled.

## Knowledge base (rich-text, feeds this + Voice AI + Agent Studio)

`kb-compiler.mjs` compiles `POST /knowledge-base/rich-text/` — body
`{locationId, knowledgeBaseId, title, content}` where `content` is raw TipTap/ProseMirror HTML
(not markdown, not plain text — the server derives markdown itself). **Status: LIVE-PROVEN.**

Create is **async**: the response comes back `status: "training"`; poll
`GET /knowledge-base/rich-text/:id/status` until it flips to `"trained"` before treating the
doc as usable. `compileRichTextDelete(id)` handles cleanup (`DELETE
/knowledge-base/rich-text/:id`).

`POST /knowledge-base/default` is idempotent — call it to get-or-create the account's default
KB before attaching content, rather than assuming one exists.

**Tables (CSV-only) and Files (PDF/DOC/DOCX/MD)** are the other two captured KB content-source
types, per `captures/knowledge-base-tables-files.json`. `kb-compiler.mjs`'s
`compileKbTableUpload` and `compileKbFileUpload` produce their request descriptors (method,
path, and the known non-binary form/JSON fields) — but since both are multipart uploads of
real file bytes, this compiler describes the request shape rather than building the binary
body itself:
- **Tables** is a 3-step async pipeline: upload (multipart) → schema auto-detect (GET) →
  select-columns (POST, which actually finalizes the schema and queues Parquet conversion) →
  poll parquet-status → summary → delete. `fileId` is server-assigned on the upload response,
  so steps after upload use a `:fileId` path placeholder for the caller to fill in.
- **Files** is a single multipart POST that both uploads AND registers the KB record (no
  separate finalize step), then an async CONVERSION → EXTRACTION → CHUNKING → EMBEDDING
  pipeline polled via the status endpoint. The capture's network inspector could not render
  the multipart body as text, so the exact form-field names for `locationId` /
  `knowledgeBaseId` / the file itself are unverified — `compileKbFileUpload`'s
  `bodyFieldsBestEffort` marks this explicitly as a best-effort guess, not a proven contract.

Both are verified-against-capture (endpoint/method/flow accurate) but not yet live-fired —
same epistemic stance as the Conversation AI / Voice AI action types above.

## Flow-Based Builder (`FLOW_BUILDER_BOT`)

Reverse-engineered + engine-captured 2026-07-14/15 (was previously "not captured / out of
scope"). **A flow bot's logic IS a workflow.** Creating a `FLOW_BUILDER_BOT` and opening its
"Launch/Edit Flow Builder" loads the normal workflow builder at
`/automation/workflow/{WID}?triggerType=conv_ai_trigger&convTriggerBotId={AGENT_ID}`:

- The flow lives in a workflow (`workflowType: "agent"`) whose entry trigger is
  **`conv_ai_trigger`** ("Chat Initiated"), bound to the agent by **`convTriggerBotId`**.
- The agent (`/ai-employees`) carries `botType: FLOW_BUILDER_BOT`,
  `isObjectiveBuilderEnabled: true`, `objectiveBuilderWorkflowId: {WID}`.
- The flow builder's palette is the **full workflow action catalog** + a "Conversation AI"
  category of **9 `conversationai_*` nodes**. So the whole booking flow is buildable by the
  `create-ghl-workflow` engine: `conv_ai_trigger` + AI nodes + `custom_webhook` to the worker.

**The 9 Conversation-AI node keys** (all `type: conversationai_*`, `workflowsActionType: "INTERNAL"`,
`attributes: { ...fields, type, __customInputs__: {} }`) — captured in the `create-ghl-workflow`
engine's catalog (`node ../create-ghl-workflow/scripts/query-catalog-cli.mjs conversationai`,
run from the skill root `ghl-conversation-ai/`, not from this `references/` file's own directory):

| UI name | action key | shape |
|---|---|---|
| AI capture information | `conversationai_objective` | ✅ full (premium; carries `stepIndex`) |
| AI message | `conversationai_ai_message` | ✅ full (`message`, `waitForReply`) |
| Custom message | `conversationai_custom_message` | ✅ full (verbatim send) |
| Book appointment | `conversationai_book_appointment` | ✅ multi-path (`onBooked`/`onNotBooked`; `calendarId`) |
| AI splitter | `conversationai_ai_splitter` | ✅ multi-path (`branches[]` + "No condition met" fallback via `default`) |
| End conversation | `conversationai_end` | ✅ full (`message`, `sleepEnabled`**\***, `sleepDuration`, `sleepUnit`) |
| Continue conversation | `conversationai_continue` | ✅ full (`instructions`, optional — nothing required) |
| Transfer bot | `conversationai_transfer_bot` | ✅ (`assignedEmployeeId`**\*** only — there is NO `prompt`) |
| Services booking | `conversationai_services_booking` | ⚑ (`conversationai_services`**\***, `conversationai_booking_description`; needs a configured commerce service) |

**\*** = **required by the builder.** Omit one and the node renders with a red error badge
and the flow cannot be published, while a build pipeline can still report success. The full
required set is `waitForReply` (ai_message, custom_message — presence, `false` is accepted),
`objective`, `message`, `description` (ai_splitter), `calendarId`, `assignedEmployeeId`,
`sleepEnabled`, and services_booking's two. The `create-ghl-workflow` engine defaults the
defaultable ones and hard-errors the rest, so authoring through it cannot produce this state.

🔴 **Three key names above were WRONG until 2026-07-27** and are corrected here from committed
captures: `conversationai_end` was documented as `customMessage`/`reactivate`/`duration` — all
three names are wrong, and authoring `reactivate` persisted as an unknown key while the
actually-required `sleepEnabled` stayed unset. `transfer_bot.prompt` and `continue.prompt` were
recon reads of the panel and never persisted. `services_booking`'s keys came from UI labels;
the real ones are confirmed by the options endpoint, which returns the list under exactly
`conversationai_services`. Treat any ⚑ row as having possibly-wrong key NAMES until a committed
capture proves otherwise.

🔴 **[`flow-builder-nodes.md`](flow-builder-nodes.md) is the authoritative reference** for the
flow builder's trigger binding and node semantics — it holds the complete capture (2026-08-26)
against a real `FLOW_BUILDER_BOT`. Four points where it differs from the summary above: the
flow binds via a `conditions[].botId` row, **not** `convTriggerBotId` (GHL discards that
field); there are **three** multi-path nodes, not two (`services_booking` has Appointment
Booked / Not Booked); `continue`'s key is `instructions`, storing `""` rather than `{}`; and
`continue`/`end` are TERMINAL — an `end` inserted mid-flow is silently dropped at save.

The multi-path nodes emit `cat:"multi-path"`, `convertToMultipath:true`, `transitions[]`, and
a separate `type:"transition"` node per branch (mirrors `find_opportunity`). ⚑ = field structure
captured but not yet commit-verified — capture a committed template to promote to ✅. (Full
provenance lives in the external research repo `uxieee/ghl-workflow-api-docs`:
`research/ai-agents-internal/conversation-ai-internal.md` + `flow-builder-captures/`, not shipped
in this plugin.)

**Commit path.** Node "Save action" only stages a node locally; the top-right **"Save workflow"**
button flushes `workflowData.templates` to the backend. Enable auto-save with
`PUT backend.leadconnectorhq.com/workflow/{LOC}/auto-save/settings {"isActive":true}`. Node option
lists (calendar picker, contact-field picker, bot list) come from
`GET backend.leadconnectorhq.com/workflows-marketplace/actions/options/conversationai_{key}?optionType=default&workflowId={WID}`.

**Two auth rails.** Agent CRUD = `services.leadconnectorhq.com/ai-employees` + **`token-id`**. The
flow workflow = `backend.leadconnectorhq.com/workflow` + **`Authorization: Bearer`** (the
`create-ghl-workflow` recipe). The `compileFlowBuilderBot` driver keeps them as separate descriptors.

**Build it end to end** with `compileFlowBuilderBot` (see driver example below).

### Flow-bot rules that only the record can tell you (live-proven 1–2 Sep 2026)

- **Move/cancel capability lives on the AGENT RECORD for a `FLOW_BUILDER_BOT`.** A flow bot carries no
  `appointmentBooking` action for the "booking action is canonical" rule to point at (it carries only
  `advancedFollowup`), so `cancelEnabled` / `rescheduleEnabled` on the record ARE the setting. With
  them `false` the agent *books a second appointment* on a reschedule instead of moving the first —
  the double-booking defect. Rule: read the booking action when one exists; read the record when one
  does not. `conversationai_book_appointment` itself exposes only `promptInstructions` and
  `calendarId` — it can only BOOK; naming a node "move or cancel" gives it nothing.
- **Merge tags render inside a flow node's `promptInstructions`** before the model sees them. Prepend
  `Today is {{right_now.day_of_week}} {{right_now.little_endian_date}}.` to every booking node or the
  agent resolves "next week Wednesday" to the week it is already in. The whole `{{right_now.*}}`
  namespace, contact tags and custom-value tags all work there.
- **Prompt wording changes what the agent SAYS and which tool it picks, never what a tool WRITES.** A
  status the step type's card does not expose cannot be reached by prose. Check the card first.
- **Delete the AGENT, never the flow.** A `workflowType:"agent"` workflow can neither be deleted
  ("Workflows with type agent cannot be deleted") nor unpublished ("must always be published"). The
  only way one disappears is deleting the agent that owns it; lose the agent first and the flow is
  permanent, and its inactive `conv_ai_trigger` keeps the old `botId`.
- **The UI Duplicate** keeps every STEP id, mints new trigger ids, rewrites the trigger-identity
  `if_else` refs itself — and arrives with `cancelEnabled`/`rescheduleEnabled` **false**, `mode: off`,
  `aiResponseLengthEnabled` reset, no routing rows, and its autonomous-trigger conditions written with
  operator `eq`, which the builder then rejects (`==` is valid). Read the whole record after any
  duplicate, then fix those five things.
- **Read-only keys to strip before any PUT** (the tool does this since 2026-09-02): `employeeType`,
  `errors`, `isDeleted`, `rootParentAgentId`, plus the usual `id`/dates/`traceId`.

## Driving `convai-compiler.mjs`

```js
import { compileConvaiAgent, compileConvaiUpdate, compileConvaiAction } from './engine/convai-compiler.mjs';

// Create: returns { create: {method,path,body}, actions: [...], authHeader: 'token-id' }.
// actions[] have employeeId: null — patch in the real id from the create response before POSTing.
const { create, actions, authHeader } = compileConvaiAgent({
  name: 'Booking Bot',
  mode: 'suggestive',
  channels: ['SMS', 'WebChat'],
  personality: '...', goal: '...', instructions: '...',
  actions: [{ type: 'humanHandOver', name: 'Escalate to human',
              // handoverType is API-REQUIRED (live-verified 422 without it, 2026-07-15):
              // contactRequest | lackOfInformation | failedToResolveIssue | custom. Defaults to 'custom'.
              details: { handoverType: 'contactRequest',
                         triggerCondition: 'Contact explicitly asks for a person, 3+ times, or expresses frustration.' } }],
}, { locationId });

// Update: a partial body RESETS omitted agent-level booleans (measured) — resend every field you care about.
const upd = compileConvaiUpdate({ mode: 'autoPilot' }, { agentId, locationId });

// Flow-Based Builder (FLOW_BUILDER_BOT) — build the agent + its flow workflow end to end:
import { compileFlowBuilderBot, compileLinkFlowWorkflow } from './engine/convai-compiler.mjs';
import { compile as compileWorkflow } from '../create-ghl-workflow/engine/compiler.mjs';
import { loadCatalog } from '../create-ghl-workflow/engine/catalog.mjs';
import { makeSeededIdGen } from '../create-ghl-workflow/engine/idgen.mjs';

// workflowCtx is the create-ghl-workflow compile() ctx — you must supply all keys:
//   loc/cid/uid from the /ai-employees list or JWT claims; companyAge from the location;
//   idGen (uuid factory) + catalog (loadCatalog()). Prefer the create-ghl-workflow
//   orchestrator (scripts/build.mjs) to actually CREATE the compiled flow workflow.
const workflowCtx = { loc: locationId, cid, uid, companyAge, idGen: makeSeededIdGen('x'), catalog: loadCatalog() };

const plan = compileFlowBuilderBot({
  name: 'Booking Flow Bot', mode: 'autoPilot', channels: ['SMS', 'WebChat'],
  flow: {                          // a create-ghl-workflow IR (conv_ai_trigger auto-injected + bound)
    name: 'Booking flow',
    graph: [
      { kind: 'action', type: 'conversationai_objective', name: 'AI capture information',
        attributes: { objective: 'capture whether the lead prefers weekday or weekend', contactField: 'day_type_preference' } },
      { kind: 'action', type: 'custom_webhook', name: 'Get slots',
        attributes: { method: 'GET', url: 'https://worker/slots', event: 'workflow' } },
      { kind: 'action', type: 'conversationai_ai_message', name: 'Offer slots',
        attributes: { message: 'Offer the live slots to the lead', waitForReply: true } },
    ],
  },
}, { locationId, compileWorkflow, workflowCtx });
// Runtime order:
//   1. POST plan.createAgent.create  (body is plan.createAgent.create.body) → get agentId
//   2. plan.flowWorkflow(agentId) → create-ghl-workflow descriptors (conv_ai_trigger already
//      carries convTriggerBotId=agentId; workflow persists workflowType:"agent") → create → get workflowId
//   3. PUT plan.linkWorkflow(agentId, workflowId)  (=== compileLinkFlowWorkflow(agentId, workflowId, {locationId}))
// DRAFTS ONLY — never publish the agent/workflow without explicit approval.
```

Both compilers only produce `{method, path, body, authHeader}` descriptors — issuing the HTTP
call (with a freshly captured `token-id`) and handling the response is the executor's job.
