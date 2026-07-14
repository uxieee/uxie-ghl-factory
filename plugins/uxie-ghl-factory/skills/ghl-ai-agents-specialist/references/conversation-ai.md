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
| Update agent (merge) | `PUT` | `/ai-employees/employees/:agentId` |
| Get agent | `GET` | `/ai-employees/employees/:agentId` |
| List / search agents | `GET` | `/ai-employees/employees/search` · `/ai-employees/employees/dashboard/search` |
| Delete agent | `DELETE` | `/ai-employees/employees/:agentId` |
| Create action | `POST` | `/ai-employees/actions` |
| Search actions | `GET` | `/ai-employees/actions/search?employeeId=…` |
| List knowledge bases | `GET` | `/knowledge-base/all?locationId=…` |
| Default KB (idempotent get-or-create) | `POST` | `/knowledge-base/default` (`{locationId, migrateDocs:true}`) |
| Default prompt template | `GET` | `/conversations-ai/prompt/default?locationId=…&intentType=…` |

Auth: **`token-id`** header (not the workflow-builder's `Authorization: Bearer`). See the
parent SKILL.md's Execute section for the capture procedure pointer.

## Agent config

- `employeeName` / `name` — display name.
- `mode` — enum **`off` | `suggestive` | `autoPilot`** (lowercase strings). `off` disables the
  bot, `suggestive` drafts replies for a human to approve, `autoPilot` sends unattended (capped
  by `autoPilotMaxMessages`, default 75).
- `channels[]` — enum: `SMS`, `IG`, `FB`, `WebChat`, `Live_Chat`, `WhatsApp`. Non-empty required.
- `botType` — enum **`PROMPT_BASED_BOT` | `FLOW_BUILDER_BOT`**. The prompt bot is the
  three-part-prompt agent above; the flow bot's logic is a **workflow** (see "Flow-Based
  Builder" below). Both are buildable via the engine (`convai-ir.mjs` `BOT_TYPES`).
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
  summarizing, notification routing).
- `llm{primary, secondary}` — model selection (e.g. `gpt-4.1` / `gpt-4.1-mini`); observed on
  update captures.
- `isPrimary`, `respondToImages`, `respondToAudio`, `isObjectiveBuilderEnabled`,
  `responseLength` / `aiResponseLengthEnabled` — secondary knobs, pass through as given.

## Merge-PUT semantics

`PUT /ai-employees/employees/:agentId` **MERGES**, not replaces. A capture that sent only
`{locationId, knowledgeBaseTriggers}` left every other field on the live agent untouched. This
is the opposite of Voice AI and Agent Studio (both full-replace) — see the parent SKILL.md's
Execute table. Practically: an update only needs to carry the fields actually changing.

`convai-ir.mjs` reflects this with two parse functions:
- `parseConvaiIR(ir)` — full validation for create. Requires `name`, `mode` (enum), `channels`
  (non-empty enum array).
- `parseConvaiPartialIR(ir)` — partial validation for update. Every field optional, but any
  field present must still satisfy its enum/shape.

## Actions

`POST /ai-employees/actions` — body `{employeeId, locationId, type, name, details{…}}`. Actions
are a **separate resource**, not embedded in the agent's create/update body — the agent create
call itself always sends `actions: []`; actions are POSTed after, once the real `employeeId`
is known.

**`humanHandOver` — the first live-verified action type.** Two live-verified 422 gaps found
during capture, both baked into `convai-compiler.mjs`'s `HUMAN_HANDOVER_DETAIL_DEFAULTS`:
- `details.enabled`, `details.triggerCondition`, `details.reactivateEnabled` are all required
  by the API even though they look optional from the UI.
- `details.sleepTime` / `details.sleepTimeUnit` (number 1-30 / enum `days`|`hours`|`minutes`)
  are ALSO required — unrelated to handover semantics on its face, but the API 422s without
  them.
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
engine's catalog (`node engine/query-catalog.mjs conversationai`):

| UI name | action key | shape |
|---|---|---|
| AI capture information | `conversationai_objective` | ✅ full (premium; carries `stepIndex`) |
| AI message | `conversationai_ai_message` | ✅ full (`message`, `waitForReply`) |
| Custom message | `conversationai_custom_message` | ✅ full (verbatim send) |
| Book appointment | `conversationai_book_appointment` | ✅ multi-path (`onBooked`/`onNotBooked`; `calendarId`) |
| AI splitter | `conversationai_ai_splitter` | ✅ multi-path (`branches[]` + "No condition met" fallback via `default`) |
| End conversation | `conversationai_end` | ⚑ recon-fields (`customMessage`, `reactivate`, `duration`) |
| Continue conversation | `conversationai_continue` | ⚑ recon-fields (`prompt`) |
| Transfer bot | `conversationai_transfer_bot` | ✅ (`assignedEmployeeId`, `prompt`) |
| Services booking | `conversationai_services_booking` | ⚑ recon-fields (`services[]`, `description`; needs a configured commerce service) |

The two multi-path nodes emit `cat:"multi-path"`, `convertToMultipath:true`, `transitions[]`, and
a separate `type:"transition"` node per branch (mirrors `find_opportunity`). ⚑ = field structure
captured but not yet commit-verified — capture a committed template to promote to ✅ (throwaway
recon bot still live: see `flow-builder-recon.md`).

**Commit path.** Node "Save action" only stages a node locally; the top-right **"Save workflow"**
button flushes `workflowData.templates` to the backend. Enable auto-save with
`PUT backend.leadconnectorhq.com/workflow/{LOC}/auto-save/settings {"isActive":true}`. Node option
lists (calendar picker, contact-field picker, bot list) come from
`GET backend.leadconnectorhq.com/workflows-marketplace/actions/options/conversationai_{key}?optionType=default&workflowId={WID}`.

**Two auth rails.** Agent CRUD = `services.leadconnectorhq.com/ai-employees` + **`token-id`**. The
flow workflow = `backend.leadconnectorhq.com/workflow` + **`Authorization: Bearer`** (the
`create-ghl-workflow` recipe). The `compileFlowBuilderBot` driver keeps them as separate descriptors.

**Build it end to end** with `compileFlowBuilderBot` (see driver example below).

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

// Update: only pass what's changing — merge semantics, no need to resend the whole agent.
const upd = compileConvaiUpdate({ mode: 'autoPilot' }, { agentId, locationId });

// Flow-Based Builder (FLOW_BUILDER_BOT) — build the agent + its flow workflow end to end:
import { compileFlowBuilderBot } from './engine/convai-compiler.mjs';
import { compile as compileWorkflow } from '../create-ghl-workflow/engine/compiler.mjs';

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
// Runtime order: POST plan.createAgent → get agentId → compile+create plan.flowWorkflow(agentId)
//   → get workflowId → PUT plan.linkWorkflow(agentId, workflowId).  DRAFTS ONLY — never publish
//   the agent/workflow without explicit approval.
```

Both compilers only produce `{method, path, body, authHeader}` descriptors — issuing the HTTP
call (with a freshly captured `token-id`) and handling the response is the executor's job.
