# Voice AI (phone agent)

> Ground truth: `ghl-workflow-api-docs/research/ai-agents-internal/voice-ai-internal.md`
> (captured live 2026-07-11, GROM Digital AU) + this plugin's `engine/voiceai-ir.mjs` /
> `engine/voiceai-compiler.mjs`. Internal `services.leadconnectorhq.com/voice-ai/*` surface;
> the public `voice-ai-v3` API reaches only a fraction of it (basic CRUD + call logs).
> Underlying voice provider is **Retell** (`provider: "RETELL"`, not IR-settable).

**Status: built + unit-tested (119 tests across the engine); substantially live-proven.**

Live-proven against a real account (Francesca, `SJRURxzgbPTVBNLhqEZi`, 2026-07-17 voice
go-live prep): `DATA_EXTRACTION` action creation (201 ×6 on real contact fields),
`APPOINTMENT_BOOKING` `calendarId` repointing via `update-action`, `patch-agent` (`voiceId`,
`sendPostCallNotificationTo`), and the voices catalog read.

⚠️ **Unreconciled status conflict — agent create + full-replace update.** This doc originally
carried a "NOT yet live-proven" banner, but the project record reports that the engine's
Voice AI **agent create + full-replace update WAS live-create-proven on GROM AU
(`wdzEoUZnXO9tB3PPzcot`) on 2026-07-11** — engine → internal API → real object → verified →
deleted, alongside the other three compilers. That banner appears to be stale boilerplate
(the identical sentence still sits in `agent-studio.md`) that was never updated after the
proving run; the proving objects were deleted, so no capture survives to confirm it here.
**Until someone reconciles this, take the conservative read**: treat a first agent
create/full-replace build as a small, throwaway, verified, cleaned-up validation run, and say
so plainly to the user rather than promising a proven path.

Genuinely NOT live-fired: the `WORKFLOW_TRIGGER` / `SMS` / `CAP` / `AGENT_TRANSFER_CHILD`
action types (unit-tested against their captures only), and `IN_CALL_DATA_EXTRACTION`.

## What Voice AI is

The phone agent — inbound/outbound calls via Retell. Distinct from Conversation AI (chat) and
Agent Studio (autonomous tool-using agent) — see the parent SKILL.md's three-way distinction.
Configured as a large, section-based document (voice, behavior, transcription, call settings,
post-call, outbound/consent), not a short free-text prompt like Conversation AI.

## Endpoint map

| Operation | Method | Path |
|---|---|---|
| Create agent | `POST` | `/voice-ai/agents` |
| Get agent | `GET` | `/voice-ai/agents/:id?locationId=` |
| Update / publish agent | `PUT` | `/voice-ai/agents/:id?publishAgent=true&mode=update` |
| Delete agent | `DELETE` | `/voice-ai/agents/:id?locationId=` → `204` |
| Create action | `POST` | `/voice-ai/actions` |
| List agents | `GET` | `/voice-ai/agents/agents-with-folders` · `/agents/simple` · `/agents/all` |
| Prompt defaults | `GET` | `/voice-ai/agents/:id/prompts/defaults` |
| Transfer-connections check (pre-delete guard) | `GET` | `/voice-ai/agents/:id/transfer-connections` |
| Voices (full ~142 catalog) | `GET` | `/voice-ai/voices/all?locationId=` — see ⚠️ below · `/voices/my-voices` |
| Prompt char limit | `GET` | `/voice-ai/configurations/AGENT_PROMPT_LIMIT` |
| Outbound consent | `GET` | `/voice-ai/consent/outbound/:locationId` · `/consent/location/:locationId/compliant` |
| Feature flag | `GET` | `/voice-ai/feature-flags/{FLAG}/is-enabled` |
| Number pools | `GET` | `/phone-system/number-pools?locationId=` |
| Dashboard / logs / trial | `GET` | `/voice-ai/dashboard/agents` · `/dashboard/call-logs` · `/call/trial` · `/call/trial-usage` |

Auth: **`token-id`** header — same as Conversation AI and Agent Studio, NOT the
workflow-builder's `Authorization: Bearer`. See the parent SKILL.md's Execute section.

## ⚠️ Full-replace update (differs from Conversation AI)

Every save in the Voice AI builder issues the **same PUT**
`/voice-ai/agents/:id?publishAgent=true&mode=update` with the **complete agent object** —
untouched fields are re-sent unchanged. There is **no partial-patch path**. This is the
opposite of Conversation AI's merge-PUT.

Practical consequence for the engine: `POST /voice-ai/agents` accepts almost nothing — per
the capture, just `{locationId}` — the backend auto-generates a default agent (name, prompt,
welcome message, agent settings) server-side and returns its id. The IR's rich fields
**cannot** be sent at create time. The real-world flow is therefore:

1. `POST /voice-ai/agents` → get back a server-generated default agent + its id.
2. `GET /voice-ai/agents/:id` → the current full document.
3. Reconcile the desired IR into that full document in memory.
4. `PUT /voice-ai/agents/:id?publishAgent=true&mode=update` with the **whole** reconciled
   document.

`voiceai-compiler.mjs`'s `compileVoiceAiUpdate(fullIr, opts)` takes a FULL IR (never a
partial one) and fills any omitted field with the stable literal default observed across both
update captures (`DEFAULTS` in the compiler) — it has no network access, so it cannot do the
GET-then-merge itself. **Passing a partial IR here silently clobbers live fields with these
defaults** — reconciling with a prior GET is the executor's responsibility, not the
compiler's.

## Config sections

- **Identity:** `agentName`, `businessName`, `locationId`, `timezone`, `agentPrompt`,
  `llmModel` (default `gpt-4.1`), `provider` (`RETELL`, fixed), `agentStatus`
  (`PENDING`→`ACTIVE` after first save), `advancedSettingsEnabled`.
- **Welcome:** `welcomeMessage`, `welcomeMessageMode` (only observed value: `ai_custom`),
  `beginMessageDelayMs`, `prompts{}` (System-Prompt section overrides — Personality, Date &
  Time Awareness, Numbers & Symbols Speech Rules, Email Confirmation Process; not fully
  captured, passed through as-is).
- **Voice:** `voiceId` (default `g6xIsTj2HwM6VR4iXFCw`) — ⚠️ see "Picking a voice" below,
  `voiceModel` (`auto`), `voiceTemperature`,
  `voiceSpeed`, `voiceVolume`, `denoisingMode` (only observed value: `noise-cancellation`),
  `backgroundSound`, `normalizeForSpeech`, `ambientSoundVolume`, `enableDynamicVoiceSpeed`.
- **Behavior:** `responsiveness`, `interruptionSensitivity`, `modelTemperature`,
  `enableBackchannel`, `backchannelFrequency` (UI has no slider — the frontend fixes this to
  `0.8` the instant `enableBackchannel` flips true; the compiler replicates that), `backchannelWords`,
  `enableDynamicResponsiveness`.
- **Transcription:** `sttMode` (enum `accurate` | `fast` | `custom`), `customSttConfig`,
  `vocabSpecialization` (`general`), `boostedKeywords[]`, `pronunciationDictionary[]`.
- **Call settings:** `maxCallDuration` (seconds, default 900), `sendUserIdleReminders`,
  `reminderAfterIdleTimeSeconds`, `reminderFrequency`, `endCallAfterSilenceMs`,
  `ringDurationSeconds`, `language`.
- **Post-call:** `sendPostCallNotificationTo{admins, allUsers, contactAssignedUser,
  specificUsers[], customEmails[]}`, `callEndWorkflowIds[]`.
- **Outbound / consent:** `aiDisclaimerConfiguration{disclaimerEnabled, outboundDisclaimerType
  (concise), outboundDisclaimerMessage, outboundIntentMessage, playDisclaimerOnEveryCall,
  isGreetingMessageDynamic}`, `voicemailOption`, `ivrOption`, `numberPoolId`,
  `inboundNumbers[]`, `inboundPhoneNumber`. Number-pool/KYC provisioning itself is OUT of
  scope — see parent SKILL.md.
- **Knowledge base:** `knowledgeBaseIds`, `knowledgeBasePrompt` (has a sensible default string
  telling the agent when to consult the KB).
- **Translation:** `translation{enabled, language}`.
- **Misc:** `userFirstFallback{enabled}`, `noResponseConfig{enabled, keywords[]}`,
  `agentWorkingHours[]`, `extractDataFields[]`, `isAgentAsBackupDisabled`,
  `meta{createdByChannel, isTestDriveAgent, copilotCreationInProgress}`.
- **Server-assigned (read-only, appear after first save):** `retellLlmId`, `providerAgentId`,
  `providerAgents[]`.

## Picking a voice (voices ARE programmatically listable)

> Verified live 2026-07-17 (Francesca). Supersedes the older assumption that `voiceId` was a
> UI-only pick — you do **not** need to open the builder to choose a voice.

```
GET https://services.leadconnectorhq.com/voice-ai/voices/all?locationId=<loc>
    Authorization: Bearer <PIT>
    Version: 2021-07-28
```

Returns the **full ~142-voice catalog** with `accent`, `gender` and `previewUrl` — filter it
in-process to pick a voice against the client's brief (accent/gender), then set it.

- ⚠️ **Use `/voices/all?locationId=`.** The plain `/voice-ai/voices` (no `locationId`) returns
  only **10** voices — enough to look like the whole catalog and quietly deny you the other 132.
- ⚠️ **`voiceId` is the ElevenLabs `providerVoiceId` (20-char), NOT the Mongo `_id`
  (24-char hex).** Each catalog entry carries both; picking the wrong one is easy because both
  are opaque ID strings. Rule of thumb: **24 hex chars = wrong field.**
- Set it with `voice-ai-v3__patch-agent { voiceId: <providerVoiceId> }`.

## Actions

`POST /voice-ai/actions` — body `{agentId, actionType, locationId, name, actionParameters{…}}`.
A **separate resource**, not embedded in the agent PUT (a `followUpAgentSave` capture note
confirms the agent PUT "contains no action-related fields at all"). The agent's GET response
splits actions into typed buckets: `callTransferActions[]`, `contactFieldActions[]`,
`workflowActions[]`, `smsActions[]`, `customActions[]`, `agentTransferActions[]`,
`capActions[]`, `mcpServers[]` (plus raw `actions[]` with SCREAMING_SNAKE `actionType`, and
`actionIds[]`).

**`CALL_TRANSFER` — the first live-verified action type.** Response `type: "callTransfer"`,
bucket `callTransferActions[]`. `actionParameters`: `triggerPrompt`, `triggerMessage`,
`triggerMessageType` (`static_text`), `transferToType` (`number`), `transferToValue`,
`hearWhisperMessage`.

**All 6 remaining action types are now ALSO verified**, per
`research/ai-agents-internal/captures/voiceai-actions-all.json` (POST `/voice-ai/actions`
against a real test agent, 2026-07-11). `voiceai-compiler.mjs`'s `buildActionParameters`
dispatches on `actionType` and, for each of these, validates the capture's required
field(s) and merges the caller's `actionParameters` over any capture-grounded defaults:
- **`WORKFLOW_TRIGGER`** ("Trigger a workflow") — required: `workflowId`, `triggerPrompt`,
  `triggerMessage`, `triggerMessageType`. No defaults — all user-authored.
- **`SMS`** ("Send SMS") — required: `messageBody`.
- **`DATA_EXTRACTION`** ("Update contact field") — required: `contactFieldId`,
  `contactFieldKey`, `contactFieldDataType`. **Full shape + live-proof: see "DATA_EXTRACTION
  in depth" below.**
- **`APPOINTMENT_BOOKING`** — required: `calendarId`. Booking/appointment-management
  toggles (`daysOfOfferingDates`, `collectEmail`, `cancelEnabled`, `timezoneSelection`, ...)
  default to their captured values. Only one Appointment Booking action allowed per agent.
  Repointing `calendarId` via `voice-ai-v3__update-action` **preserves** the booking
  sub-fields (`calendarActionType`, `collectEmail`, reschedule/cancel flags) — it does not
  strip them, so you can safely move an agent between calendars without re-sending the whole
  booking config (live-verified 2026-07-17).
  ⚠️ **If `calendarId` points at a `class_booking` (group / cohort / multi-day) calendar, read
  `ghl-pipeline-specialist/references/reference-pipelines.md` §"Adjacent surface:
  `class_booking` calendars" FIRST** — whether an AI booking action can target one **is
  untested**. Verify on a throwaway booking before promising a client an AI-books-cohorts flow.
- **`CAP`** ("Custom Action 2.0" / Custom Action Plugin) — required: `capActionId`,
  `triggerPrompt`, `triggerMessage`, and (validated on the one field the compiler can see)
  `schemaValues.requestBodyValues.webhookUrl.value` must be an `https://` URL.
  `capActionName` defaults to the fixed literal `'customApi'`.
- **`AGENT_TRANSFER_CHILD`** ("Agent Transfer", distinct from `CALL_TRANSFER`) — required:
  `destinationAgentMongoId`, `triggerPrompt`. `speakDuringExecution` / `triggerWorkflowsPostCall`
  default to the capture's observed values (`false` / `true`). Max 3 connected agents per UI.

### ⚠️ `actionParameters` MUST be an OBJECT, never a JSON string

> Live-verified 2026-07-17 (Francesca). Applies to **both** `voice-ai-v3__create-action` and
> `voice-ai-v3__update-action`.

Passing `actionParameters` as a JSON **string** fails with a misleading HTTP 400:

```
Cannot read properties of undefined (reading 'constructor')
```

That error names no field and reads like a server bug — it is not. It means the backend tried
to introspect your string's `.constructor` as if it were a parsed object. **Send an object.**
This is the same class of gotcha as Conversation AI's `details`-must-be-object rule; if you
hit an unexplained `constructor` 400 anywhere in the AI surface, suspect a stringified object
first.

### DATA_EXTRACTION in depth (live-proven 2026-07-17)

Captured from the Voice builder UI: **Actions → New Action → "Update contact field" →
_After The Call_ → Save**, which fires `POST /voice-ai/actions` (**not** the agent PUT).

- **`actionType: "DATA_EXTRACTION"` is the _After The Call_ variant** — extraction runs after
  the call ends. `IN_CALL_DATA_EXTRACTION` is the _During The Call_ variant; **its shape is
  still untested** — do not assume it mirrors this one.
- Earlier `422`s on both types were a **wrong-sub-schema** problem, not an API limitation.
- The **public** `voice-ai-v3__create-action` works with this exact object (201 ×6 on real
  fields) — no internal `token-id` call needed for this type.

`actionParameters` (object):

```jsonc
{
  "contactFieldId":         "Qq7ZMgxqom0UpbVXEZYn",
  "contactFieldKey":        "contact.service_interest",
  "contactFieldName":       "Service Interest",
  "contactFieldDataType":   "STANDARD_FIELD",   // or the custom-field data type
  "description":            "What treatment the caller asked about.",
  "actionType":             "DATA_EXTRACTION",  // repeated INSIDE the params object
  "examples":               ["Botox", "Dermal filler"],
  "overwriteExistingValue": false,
  "saveAsAdditional":       true
}
```

Note `actionType` is repeated **inside** `actionParameters` as well as at the body's top
level — both are required.

**`overwriteExistingValue` is a judgement call, not a default.** Set it `false` for fields a
form or human already populated (overwriting clobbers better data with a transcript guess);
`true` for volatile state the latest call is authoritative on (e.g. a preferred time, a call
outcome). For free-text notes, prefer `false` + `saveAsAdditional: true` so calls append
rather than overwrite each other.

### Public vs internal agent representation (do NOT misread this as a wiring bug)

The two GETs return the **same actions in different shapes** — a trap that can look like data
loss:

| Read | Auth | Shape |
|---|---|---|
| `voice-ai-v3__get-agent` (public) | PIT Bearer | **Trims** actions into one generic `actions[]` with slim params |
| Internal `GET /voice-ai/agents/:id` | `token-id` | **Typed groupings** the builder reads: `workflowActions`, `contactFieldActions`, `appointmentBookingAction`, `callTransferActions`, `extractDataFields`, `actionIds` |

**VERIFIED 2026-07-17:** actions created via `POST /voice-ai/actions` (public MCP) **do** land
correctly in the typed groupings **and** in `actionIds`, byte-identical to UI-built actions.
API-built `DATA_EXTRACTION` actions render fine in the builder.

- If the builder appears not to show an API-built action, it is almost certainly a **stale
  builder tab — refresh it** before reporting a bug. The slim public `actions[]` is likewise a
  *view*, not evidence the action failed to wire.
- ⚠️ **Do not generalise this reassurance.** It is the opposite of the `create-ghl-workflow`
  `internal_notification` bug, which is **real**: engine-built notification nodes fire at
  runtime but the builder will not open their editor. "Trust the API, refresh the tab" applies
  to voice actions; it does not apply there.

`VERIFIED_ACTION_TYPES` in `voiceai-ir.mjs` now lists all 7. Only `MCP` ("Add MCP (Beta)")
remains unverified — it needs a third-party OAuth-connect flow, explicitly out of scope per
the capture's `_skipped` note — and passes through as accepted-but-unverified, same as any
other unlisted `actionType`.

## Driving `voiceai-compiler.mjs`

```js
import { compileVoiceAiAgent, compileVoiceAiUpdate, compileVoiceAiAction } from './engine/voiceai-compiler.mjs';

// Step 1: create — body is effectively just {locationId}; server returns a default agent.
const { create, actions } = compileVoiceAiAgent({
  agentName: 'Front Desk', agentPrompt: '...', // full IR still validated up front
}, { locationId });

// Step 2 (executor, outside this compiler): POST create.request, then GET the new agent.

// Step 3: reconcile the desired IR into the GETted document, then compile the full-replace PUT.
const upd = compileVoiceAiUpdate(fullReconciledIr, { agentId, locationId });
```

`compileVoiceAiAgent` and `compileVoiceAiUpdate` both call `parseVoiceAiIR` for full
validation — there is no partial-IR counterpart (unlike Conversation AI), because the update
is always a full replace.
