
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

**Status: LIVE-PROVEN.** Create → read → update → delete of the agent, and create → update → delete of six action
types (`humanHandOver`, `triggerWorkflow`, `updateContactField`, `stopBot`, `transferBot`, `advancedFollowup`), were
executed on a test account on 2026-09-26 and read back on separate requests. `appointmentBooking` is verified against
captures only. What a *trial* chat fires is narrower than what the actions store: see "Test chat" below. This is the
most mature of the three AI products in this skill.

## What Conversation AI is

The chat bot ("AI Employee") that engages contacts over SMS/IG/FB/WebChat/Live_Chat/WhatsApp/TikTok/Email.
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
| Update a routing row (the PATCH merges; `set_agent_deployment` sends the full row and verifies the whole table) | `PATCH` | `/agent-deployment/routing-config/configs/:rowId` |
| Remove a routing row: there is no row delete — **deleting the agent removes its rows** (live 2026-09-29: the other rows byte-identical after) | `DELETE` | `/ai-employees/employees/:agentId` |
| Live-chat widget picker (`offset`+`limit` required) | `GET` | `/chat-widget/list?locationId=…&chatType=liveChat&offset=0&limit=20` |
| Update / delete an action | `PUT` · `DELETE` | `/ai-employees/actions/:actionId` (DELETE body `{employeeId}`) |
| Follow-up schedule for the Auto Followup actions | `PATCH` | `/ai-employees/actions/followup/settings` |
| Duplicate an agent (no body) | `PUT` | `/ai-employees/employees/duplicate/:agentId` |
| Folders: list · create · rename · delete | `GET` · `POST` · `PATCH` · `DELETE` | `/ai-employees/employees/folders` (`/:folderId?locationId=` for rename and delete) |
| Move agents into a folder | `POST` | `/ai-employees/employees/move-to-folder` |
| Dashboard metrics (a read with a body; answers 201) | `POST` | `/ai-employees/employees/:locationId/fetch-dashboard-data` |
| Conversation table under the dashboard | `GET` | `/ai-employees/employees/:locationId/conversation-logs` |
| A contact's stored conversation summaries (the table's Summary action; a read, never generates) | `GET` | `/ai-employees/summary/:locationId/contact/:contactId?page=1&limit=100&channelName=…` |
| Test chat (billed per message) | `POST` | `/ai-employees/interactions/trial` |
| Reset the test chat (the panel's ↻; no body) | `DELETE` | `/ai-employees/employees/:agentId/reset-memory` |
| The location prompt for an intent (falls back to the default template) | `GET` | `/conversations-ai/prompt?locationId=…&intentType=…` |
| Prompt templates | `GET` | `/conversations-ai/prompt/templates?locationId=…&intentType=…` |
| Primary agent (location-wide) | `GET` | `/ai-employees/employees/primary/:locationId` |

The rows added under the widget picker were each executed on a test account (2026-09-26) except the conversation
table, which was seen rendering in the UI (2026-09-28). No typed tool covers them: use `raw_request` with `host:"ai"`.

Auth: Bearer **plus** `token-id` — the dual-credential AI rail (`raw_request` with `host:"ai"`
attaches both). See the parent SKILL.md's Execute section for the capture procedure pointer.

## Agent config

- `employeeName` / `name` — display name.
- `mode` — `off` | `suggestive` | `auto-pilot`. The write takes only the hyphenated `auto-pilot`: `autoPilot` answers
  422 "mode must be one of the following values: off, suggestive, auto-pilot" (measured 2026-09-11). The tools accept
  `autoPilot` from a caller and send `auto-pilot`. `off` disables the bot, `suggestive` drafts
  replies for a human to approve, `auto-pilot` sends unattended (capped by `autoPilotMaxMessages`, 1–100, default
  75, 100 for a flow bot). The flow-bot editor offers only Off and Auto Pilot, but the server stores `suggestive` on
  a flow bot too, so do not rely on the server to refuse it. In **Suggestive** mode the Stop Bot and Human Handover final-message
  and reactivate settings do not apply (the editor says "Not applicable in Suggestive mode").
- `channels[]` — the server's enum (its own 422, 2026-09-26): `GMB`, `IG`, `FB`, `SMS`, `WebChat`, `WhatsApp`,
  `Live_Chat`, `Email`, `TIKTOK`. The editor offers eight (`GMB` is accepted but hidden); `WebChat` is the editor's
  "Chat widget". The create default is `SMS, IG, FB, WebChat, Live_Chat, WhatsApp`. Both tools accept all nine. Non-empty required unless the location has `conversationsAI.channelManagement` on, in which
  case where the bot answers is decided by the deployment rows and `channels` is the legacy "Workflow & Transfer
  bot channels" list. Under that flag the editor's Save of an EXISTING agent always sends `channels` (captured
  unedited, 2026-09-29); only a NEW agent's create drops them when the picker was not touched. The editor's
  `supportedChannelsEdited` is client-only and never sent. `update_convai_agent` writes the list (live, read back).
- **The prompt: `fullPrompt` or the three fields** (live 2026-09-29, own test agent, 3 trial messages). The current
  builder edits ONE prompt box and saves it as `fullPrompt`, a markdown document (`## Personality\n\n… ## Goal\n\n…
  ## Instructions\n\n…`), sending `personality`, `goal` and `instructions` as `""`. The server stores `fullPrompt` and
  keeps the three fields at their old values. From then on:
  - the bot answers from `fullPrompt` (a trial reply carried the `fullPrompt` marker while `instructions` held another);
  - a PUT that changes `personality` / `goal` / `instructions` is accepted and ignored — the read-back is unchanged;
  - an agent made over the API with no `fullPrompt` still answers from the three fields.
  `create_convai_agent` takes `spec.fullPrompt` too — the builder's own create: the three fields go as `""` (they then
  read back absent), `llm.primary` defaults to `gpt-4.1`, and the agent updates normally afterwards (live 2026-09-29).
  `update_convai_agent` takes `spec.fullPrompt` (the whole text, verified on read-back; it switches the agent to
  `fullPrompt` for good) and refuses the three fields on a `fullPrompt` agent, or together with `fullPrompt`, with
  `FULLPROMPT_OWNS_PROMPT` before any write, returning `currentFullPrompt`. What `fullPrompt: ""` does is not measured,
  so the tool never writes an empty one. The header's token estimate and the `n/2000 words left` counter are computed
  in the browser from `fullPrompt` (no request fires while typing), and the counter shows words USED.
- `botType` — enum **`PROMPT_BASED_BOT` | `FLOW_BUILDER_BOT` | `FORM_BASED_BOT`** (three, per the bundle's own enum; `convai-ir.mjs` `BOT_TYPES`). The prompt bot is the
  three-part-prompt agent above; the flow bot's logic is a **workflow** (see "Flow-Based
  Builder" below). Both are buildable via the engine (`convai-ir.mjs` `BOT_TYPES`).
  - **The editor's Create Agent offers only Prompt Based and Flow Based** (2026-09-28). A **form bot**
    ("Guided Form Setup") is API-only for new agents. It needs a `brandId` (a brand-voice record,
    `POST /brand-boards/voices/`; the server says "Brand ID is required for Form Based Bot"), refuses `goal`,
    `personality` and `instructions`, and gets instructions written by the server. Its editor collects Name,
    Email, Phone, Street Address and City plus custom questions, with "Skip if Already Filled".
  - **Prompt templates** are chosen when the agent is created, not in the builder: Prompt Based → General Q&A ·
    Appointment booking · Marketplace Templates · Start from Scratch. The templates behind the first two come from
    `GET /conversations-ai/prompt/templates`, whose `intentType` must be `generalSupport`, `appointmentFlow` or
    `appointmentBooking` (its 422 names them).
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
- `knowledgeBaseTriggers[]` — conditional KB routing: `{id: "kbt_<epoch>_<rand>", mode: "custom" | "all",
  knowledgeBaseIds[], triggerCondition, priority}`. The editor labels the text **"Instructions (Optional)"**: with
  none, the agent decides by itself when to use the KB (`mode: "all"`, at most one such trigger, ≤ 7 KBs); with
  text, `mode: "custom"` (≤ 5 KBs). The editor caps the text at 1000 characters but the server stored 1001. The
  **server** caps the list at 4 triggers ("knowledgeBaseTriggers.4.priority must not be greater than 4"). Older
  notes calling the text required, 10–500 characters, were wrong. This routing is internal-only — the public KB API
  manages KB *content*, not this trigger logic.
- `summary{}` — conversation-summary settings (inactivity threshold, minimum messages before
  summarizing, notification routing). The PUT validates every inner field, so the summary is always sent WHOLE:
  `update_convai_agent` lays your keys over the stored summary. Server rules (2026-09-26): `minimumMessages` 3–100;
  enabling needs `workflowIds` with at least one published workflow UUID (the tool refuses an enable without one). Also carries **`summary.customFieldId`** and
  **`summary.workflowIds[]`**, which make the generated summary workflow-obtainable — see
  "[Conversation summary is workflow-obtainable](#conversation-summary-is-workflow-obtainable-summary)"
  below.
- `emailSettings{senderDetails{fromName, fromEmail, ccEnabled, bccEnabled, ccRecipients[], bccRecipients[]},
  replyBehavior{greetingPersonalization, waitTimeType, customWaitTime, customWaitTimeUnit}, emailFormat, signature,
  templateId}` — the editor's three-step wizard (Configure email · Choose format · Final review). A PUT replaces the
  whole object. `greetingPersonalization` is a greeting **string** (the editor's default is `Hi {{contact.first_name}}`).
  The server validates types only: `emailFormat: "design_editor"` is stored, but so is a made-up format, and a
  361-minute custom wait (the editor allows 1–360). The design editor is selectable, so the old line "Conversation
  AI cannot send rich HTML email" no longer holds; whether a design-editor email is **delivered** is unproven. An
  agent with no email configured reads `emailSettings: {}`, and echoing that back 422s, so drop it before a PUT.
  **At create** `[proven-live 2026-09-29]`: the current builder sends `emailWaitTime`, `emailWaitTimeUnit` and
  `emailSettings` IN the create body whenever `channels` includes `"Email"`. The server stores all three from the
  create. `create_convai_agent` takes them (Email in channels required; the editor's ranges 1–21600 s / 1–360 m /
  1–6 h). The design template is a separate call, `POST backend…/email-ai/chat/create-template {locationId,
  sourceType:"conversation-ai"}`, whose `templateId` then goes in by PUT (not written by the tools).
- `llm{primary, secondary}` — model selection. The server's enum is GHL's current model roster (15 GPT ids on
  2026-09-26, 14 on 2026-09-29; `GET /ai-employees/employees/models` serves it, read it with
  `get_ai_agent_options product:"conversation_ai"` — prices, default, deprecations) and its 422 lists the valid ids. Primary and
  secondary cannot be the same model (server-enforced). Settable on create and update.
- `businessName` — settable on create and update. `""` answers 200 and does NOT clear a stored name, so the tools
  refuse an empty value.
- `respondToImages`, `respondToAudio`, `isObjectiveBuilderEnabled` — secondary knobs, pass through as given.
- `responseLength` (`concise` | `balanced` | `detailed`, server enum) with `aiResponseLengthEnabled` (the editor's
  "Enable Response Style Settings" switch) — settable on create and update. Naming a style turns its switch on unless
  you pass `aiResponseLengthEnabled` yourself; a style with the switch off is inert.
- `knowledgeBaseTriggers` — settable on create and update (≤ 4; the create renumbers `priority` 1..n and mints the
  `kbt_…` ids, live 2026-09-29). `isPrimary` is location-wide and not settable through these tools:
  `create_convai_agent` refuses `true` by name (set the primary in the Conversation AI UI).
- `cancelEnabled` / `rescheduleEnabled` — agent-level on a FLOW bot only (create and update, live 2026-09-29); on a
  prompt bot they belong on the appointmentBooking action and both tools refuse them with that pointer.
- **Every other spec key is refused before anything is sent** (`create rejected (SPEC_KEY_UNAPPLIED)`), naming where
  it lives: email settings, working hours, folders, form bots and the `service` booking mode are raw_request.
- **Actions on create:** the agent exists before its first action is posted. If the server refuses an action,
  `create_convai_agent` still attempts the rest and fails with `AGENT_PARTIAL_BUILD`, naming the agent id, the
  actions that attached, and each refused action with the server's own message. Fix and attach the refused ones
  to THAT agent; re-running the create makes a second agent. Stop Bot needs at least 2 examples (server-enforced).

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
| Read the rows | `GET` | `/agent-deployment/routing-config/configs?locationId=…&agentId=…` (omit `agentId`: every row on the location) |
| Create a row | `POST` | `/agent-deployment/routing-config/configs` — use `set_agent_deployment` |
| Update a row | `PATCH` | `/agent-deployment/routing-config/configs/:rowId` — use `set_agent_deployment` |
| Widget picker | `GET` | `/chat-widget/list?locationId=…&chatType=liveChat&offset=0&limit=20` |

**Where a user sees it.** With `conversationsAI.channelManagement` ON, the agent builder shows a **Deploy** tab
listing SMS · WhatsApp · Instagram · Facebook · TikTok · Live chat · Chat widget · Email, each with Configure, plus
"Add channels from marketplace" (rendered 2026-09-28). Each Configure modal offers the identifiers (or a fixed "All
widgets" / "All emails"), **Has tags** and **Doesn't have tags** with AND/OR, Cancel · Update (UI walk 2026-09-29). There
is no AI simulation tab, no Phone or Voice-widget card and no per-row hours in this build.

The routing calls are AI-rail. `set_agent_deployment` writes one agent's row (create, or a full-row PATCH) and proves
the rest of the table unchanged. Reads are `raw_request` with `host:"ai"`: any "is this agent actually live?" audit
reads the rows directly. `/chat-widget/list` answers identically on backend and services, but needs a real `chatType`
(an empty one is 422). 🔴 A create **drops empty lists**: POST `excludeTags: []` stores no `excludeTags` key, while
PATCH `[]` stores `[]`. Read an absent list as `[]` (live-proven 2026-09-29).

Each row: `{channel, providerId, enabled, allIdentifiers, specificIdentifiers[], includeTags,
includeTagsOperator, excludeTags, excludeTagsOperator}`. `allIdentifiers:true` routes every
identifier on that channel ("All widgets") and `specificIdentifiers` is then empty;
`allIdentifiers:false` pins the row to the listed ids. The tag filters match the obvious way:
`AND` needs every listed tag, `OR` any one, and `excludeTags` blocks a carrier (live-proven
2026-09-11, corpus `ai-agents/50-runtime/routing-tag-matching.md`).

🔴 **Two bots can share one channel (one SMS number) by tag** (live-proven 2026-09-25). Enabling a
second row on the same channel + `providerId` answers `409` only when the two audiences
**overlap**. Bot A `includeTags:[X]` beside bot B `includeTags:[Y]` coexists. Bot B
`includeTags:[]` (everyone) or `[X]` 409s. Bot B `includeTags:[]` + `excludeTags:[X]` coexists
and also covers untagged contacts, which is the "everyone else" pattern. With two include rows, a
contact carrying neither tag gets **no bot**. Delivery was proven on Live_Chat; inbound SMS was
not exercised (the test account has no number).

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
- `details.sleepTime` / `details.sleepTimeUnit` (number; the editor's max is 43200 minutes / 720 hours / 30 days;
  enum `days`|`hours`|`minutes`)
  are ALSO required — unrelated to handover semantics on its face, but the API 422s without
  them.
- **`details.handoverType`** — REQUIRED (found 2026-07-15; first POST 422'd without it). Enum
  `contactRequest | lackOfInformation | failedToResolveIssue | custom`; the compiler defaults
  it to `custom` and validates the enum.
- `triggerCondition` has no sane default (it's the bot's own decision text for when to hand
  off) — the compiler requires it as a string 10-500 chars (the editor's range) and throws `IRError` otherwise.
- A bot holds at most **6** handover scenarios: the three built-ins (`contactRequest`, `lackOfInformation`,
  `failedToResolveIssue`) plus custom ones. Other keys: `assignToUserId`, `skipAssignToUser` (default true),
  `createTask` (default true), final message 10–200 characters, default tag `human handover`.

**The other action types** were first verified against
`research/ai-agents-internal/captures/convai-actions-all.json` (POST `/ai-employees/actions`
against a real test agent, 2026-07-11); all but `appointmentBooking` were then created, updated and deleted live
on 2026-09-26. `convai-compiler.mjs`'s `buildActionDetails`
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
  `details.triggerCondition`. At most **5** per bot. The editor offers published workflows only; the server
  stored a draft workflow's id.
- **`updateContactField`** ("Contact Info" in the UI; older pages called it `dataExtraction`, which is not a type) —
  required: `details.contactFieldId` (a real field id: standard fields have ids too, and a key such as
  `contact.company_name` 422s), `details.description` (10–500). It **updates empty fields only**. At most **20** per
  bot, one per field. `contactUpdateExamples` items must be `{id, text, type: "add" | "update" | "delete"}` (plain
  strings and a `name` key are refused), and the editor wants at least 2.
- **`stopBot`** — required: `name` only (top-level). Ships with a pre-built "Goodbye
  Detection" scenario; the defaults reproduce its literal captured values
  (`stopBotDetectionType: 'Goodbye'`, `sleepTime: 24`, `tags: ['stop bot']`, ...). Custom scenarios are
  `stopBotDetectionType: 'Custom'`, at most 5 per bot. The server wants at least 2 examples and a final message of
  3–150 characters (the editor asks 10–150; the 10–200 range belongs to Human Handover).
- **`transferBot`** — required: `name` (top-level), `details.transferToBot` (the target
  bot's employeeId) and **`details.transferBotType`** `Default` | `Custom` (the server 422s without it). At most
  **4** per bot. A "Default Transfer Bot" ("If bot doesn't know the answer") is always present. The editor warns
  that the target must be active on the same channel; "non-primary bots only" applies only while
  `conversationsAI.channelManagement` is OFF.
- **`advancedFollowup`** ("Auto Followup" in the UI) — required: `name` only (top-level). Three fixed scenarios:
  `contactStoppedReplying` (default 15 min), `contactIsBusy` (2 h) and `contactRequested`. Each is a
  `followupSequence` of at most **5** steps `{id (a number — the server 422s without it), followupTime,
  followupTimeUnit, aiEnabledMessage, customMessage, triggerWorkflow, workflowId}`; step delays are minutes 2–60,
  hours 1–24 or days 1–180 (editor ranges). The schedule is a separate write:
  `PATCH /ai-employees/actions/followup/settings {actionIds, employeeId, locationId, followupSettings}` with
  `followUpHours`, `workingHours[{dayOfTheWeek 1–7, intervals[]}]` (default Mon–Fri 08:00–17:00), `timezoneToUse`
  `contact` | `business` and `dynamicChannelSwitching`. The server does not validate `timezoneToUse`: a made-up
  value was stored.

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

### Actions are separate records, and the agent holds only pointers

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
- ⚠️ **The agent PUT cannot change actions.** `PUT` on the agent with `actions: []`, `null`, `""` or a full record
  all return accepted and leave the array untouched (measured). Actions have their **own** update and delete:
  the UI's action modals call `PUT /ai-employees/actions/{actionId}` `{employeeId, locationId, type, name, details}`
  and `DELETE /ai-employees/actions/{actionId}` with body `{employeeId}`. Both were executed live on 2026-09-26: the
  PUT updates the record in place, and the DELETE removes the record **and** its pointer on the agent. No typed tool
  calls them; use `raw_request` with `host:"ai"`. An earlier version of this note said actions were add-only — that
  was the agent PUT's behaviour, not the platform's.
- The editor's **API Call** action is not one of these records: it is an Actions-Platform skill (keyed by
  `skillId`, must pass a test run before the UI saves it). This engine does not author it.
- A pointer whose configuration is missing is reported (R-45, live A/B on one account) to stop the
  agent generating anything, silently. The engine never writes a bare pointer — it POSTs the action
  as its own resource and threads the server id back — so if you see one, it was hand-assembled.

## Around the agent: list, folders, duplicate, dashboard, test chat

All executed on a test account on 2026-09-26 and read back, unless a line says otherwise.

- **List.** `GET /ai-employees/employees/search?locationId=&limit=` → `{employees, totalCount, count}`. `limit` must
  be ≥ 10, and `skip` / `page` are refused (422). The list rows carry `goal` but **not** `personality` or
  `instructions`, and `channels` as `[{name, isPrimary}]`; the single-agent GET returns plain strings. Read the
  single agent before any update.
- **The builder's own list** `[proven-live 2026-09-29]`: `GET /ai-employees/employees/agent-list?locationId&limit` returns
  `{folders[], folderCount, employees[], totalCount, filteredTotalCount}`.
  - Folders come first, and `limit` counts folders and agents together (limit 5 → 1 folder + 4 agents).
  - There are two cursors: `startAfter` = the last agent id, and `startAfterFolder` = the last folder id. Each gives a
    disjoint next page. A cursor that is not on this list answers 422 ("must reference an employee / a folder in this
    location and query").
  - `query` filters by name, reflected in `filteredTotalCount`. `folderId` lists one folder's agents, and
    `unfiledOnly:true` lists the unfiled ones. `includeFolderPreview:true` adds `employeeCount` and
    `previewEmployeeNames` to each folder.
  - Rows are `{id, name, locationId, folderId, mode, botType, updatedAt, configuredChannels}`. This list DOES carry
    `folderId`.
- **Folders.** Create `{locationId, name, employeeIds?}` → `{id, name, employeeCount, previewEmployeeNames}`; list →
  `{folders, totalCount, count, nextStartAfter}`; move `{locationId, employeeIds, folderId}` →
  `{movedCount, unchangedCount}`; rename takes `{name}` only (a `locationId` in the body 422s); delete →
  `{unfiledCount}` and the agents stay, unfiled. The name is ≤ 40 characters (server). The single-agent record has no
  `folderId`; the agent-list rows above do. **Remove from folder** is the same move with `folderId: null` → `{folderId:
  null, movedCount: 1}` (live 2026-09-29). There is no folder at create: neither the builder nor the form wizard sends one.
- **Duplicate.** `PUT /ai-employees/employees/duplicate/{id}` with no body returns the copy, named
  `Copy - <name>`. It copies the prompt, timing, sleep, channels, model and business name, and **drops the response
  style** (`aiResponseLengthEnabled` false, no `responseLength`). Re-apply the style after a duplicate.
- **Dashboard.** `POST /ai-employees/employees/{locationId}/fetch-dashboard-data {from, to, channel, metrics[],
  presetPeriod, employeeIds[]}` answers **201** and changes nothing. The server's `metrics` enum has 13 values:
  `totalUniqueContacts, totalMessages, totalAppointmentLinkSharedActions, totalAppointmentsBookedActions,
  totalWorkflowsTriggeredActions, totalContactInfoUpdatedActions, totalStopBotTriggeredActions,
  totalAppointmentCancelActions, totalAppointmentRescheduledActions, totalTransferBotActions,
  totalHumanHandoverTriggeredActions, totalSkillExecutions, totalApiCallActions`. `totalActionsTriggered` is refused:
  the page computes it and "Time Saved" itself. The editor limits the range to 6 months; the server answered a
  21-month range. The page's cards are location-wide, not per agent.
- **Test chat.** `POST /ai-employees/interactions/trial {messageList[{body, direction:"inbound"}], employeeId,
  knowledgeBaseIds}` → 201 `{suggestions[], actionData?, aiResponseTime, id}`. It works on a bot whose mode is off,
  and it is **billed** (about US$0.02 a message). It reports `actionData` only for **Stop Bot**; phrases that should
  trigger Human Handover, Trigger a Workflow or Contact Info produced no action in the trial. So a trial proves
  the prompt and the knowledge base, not those three actions. The flow-bot editor also warns that its trial "is
  currently experiencing some issues". The panel's ↻ resets it: `DELETE /ai-employees/employees/{id}/reset-memory`,
  no body → `200 {success: true, message: "No test contact found for this location"}` when no trial contact exists
  (live 2026-09-29).
  **Thumbs on a trial reply:** `PUT /ai-employees/interactions/suggestions/{trialReplyId} {locationId, thumbVote:
  "up"|"down", source: "bot_trial"}` → 200 with an empty body. 🔴 **Nothing reads it back.**
  - `GET …/suggestions/{id}` is 404.
  - `responseDetails?source=bot_trial&messageId={trialReplyId}` returns the trial turn with no vote field (live
    2026-09-29).
  - Thumbs-down opens "train the bot", which writes a FAQ into a KB (`POST knowledge-base/faqs`). Do not submit it
    to test anything.
- **Conversation logs and summaries** (live 2026-09-29). Each `conversation-logs` row is `{id, conversationId,
  dateAdded, employeeId, contactId, channel, lastMessage, contactName, isContactDeleted, employeeName,
  isEmployeeDeleted}`, with `pagination{page, limit, totalItems, sortOrder}`. The row's Summary action is
  `GET /ai-employees/summary/{locationId}/contact/{contactId}?page=1&limit=100&channelName=` → `{items[], totalCount}`.
  It reads what the agent's `summary{}` setting stored. It generates nothing: the AI usage snapshot did not move.
  Scope is required (`presetPeriod` today · this-week · prev-week · this-month · prev-month · this-year · prev-year, or
  `from` + `to` ISO); `employeeId`, `channel`, `contactId` filter, and a made-up channel returns 0 rows, not an error.
  A summary item is `{summary, trigger, transcript[{direction, body…}], channelName, summaryWindow*}`. Typed read:
  `get_convai_conversation_logs`.
- **Intents and prompt templates.** `intentType` is `generalSupport` | `appointmentFlow` | `appointmentBooking`
  (anything else 422s); each selects a different stored template, and the Create Agent picker's General Q&A /
  Appointment booking cards apply them at create. `GET /conversations-ai/prompt` falls back to the default template. The pick
  travels as `?promptIntent=` into the builder, which prefills from the default prompt: its `information` goes to
  instructions and its `intent` to the goal [source-derived].
  `GET /conversations-ai/intents/{locationId}` returns the legacy v1 location prompt, not intents; the current app
  never calls it.
- **Working hours** are their own resource, `GET|POST|PUT /ai-employees/employees/{id}/working-hours`, never a key
  on the agent PUT (which 422s). Body: `{enabled, channels, timezoneMode, schedule{mon..sun{enabled,
  slots[{startHour, startMinute, endHour, endMinute}]}}, continueConversations, offHoursAutoReply{…,
  notificationConfig}, followUp}`. An agent with none reads 404. Written and read back on an own agent on 2026-09-29;
  raw only, and the UI panel is Labs-gated.
- **Form bots** are created in the UI only behind `conversationsAI.formBasedBot` (the Guided Form Setup), and by the
  API anywhere: `POST /ai-employees/employees` with `botType: "FORM_BASED_BOT"`, a `brandId` (a brand voice), steps and
  notification settings (corpus `10-anatomy/conversation-ai-agent-shape.md` has the full body). 🔴 Each UPDATE_FIELD
  step becomes a separate `updateContactField` action; the step keeps only its `actionId` (live 2026-09-29). Not
  typed: `create_convai_agent` refuses form-bot keys.
- **Gates that hide controls:**
  - the model and cost panel: `conversationsAI.multiLLM` or `tokenBasedPricing`;
  - Summary Settings: `summarySettings`;
  - Images / Voice Notes: a flag-or-beta check;
  - the whole builder shows a premium paywall unless the billing config has `optIn` and the product is available.

  A missing control is usually one of these.
- **Primary agent.** `GET /ai-employees/employees/primary/{locationId}` answers `200 {success:false, message:"No
  primary employee found"}` when there is none, which is not an error. Setting a primary is location-wide. With
  `conversationsAI.channelManagement` ON, the editor hides "Set as Primary" and saves drop `isPrimary`, because the
  deployment rows decide who answers.

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

**Tables (CSV) and Files (PDF/DOC/DOCX/MD)** were uploaded from the editor, trained, read back, retrieved and
deleted live on 2026-09-28. Both are **multipart** uploads, and a table is a multi-step pipeline (upload →
select-columns → status → data), not one form. So `kb-compiler.mjs`'s `compileKbTableUpload` /
`compileKbFileUpload` descriptors, built from a 2026-07 capture with best-effort form fields, are not a proven
contract, and `raw_request` (JSON only) cannot send either upload. The live routes, every other source and the
record's own lifecycle are in `ghl-knowledge-base/SKILL.md`.

## Flow-Based Builder (`FLOW_BUILDER_BOT`)

Reverse-engineered + engine-captured 2026-07-14/15 (was previously "not captured / out of
scope"). **A flow bot's logic IS a workflow.** Creating a `FLOW_BUILDER_BOT` and opening its
"Launch/Edit Flow Builder" loads the normal workflow builder at
`/automation/workflow/{WID}?triggerType=conv_ai_trigger&convTriggerBotId={AGENT_ID}`.
On a flow bot with NO workflow yet (live 2026-09-29), the button first sends `POST backend /workflow/{locationId}`
`{name: <the bot's name>, status: "draft", …}` and opens `/automation/setup-workflow?triggerType=conv_ai_trigger&botId=…`.
That create alone is a bare draft with no trigger, and the bot stays unlinked (`objectiveBuilderWorkflowId` absent)
until the workflow builder saves the trigger (inferred from the query it opens with; that save was not captured). So
leaving the builder right after the launch leaves an orphan draft workflow named after the bot.

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
