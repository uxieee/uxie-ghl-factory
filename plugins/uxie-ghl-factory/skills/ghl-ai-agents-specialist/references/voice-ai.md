# Voice AI (phone agent)

> Ground truth: `ghl-workflow-api-docs/research/ai-agents-internal/voice-ai-internal.md`
> (captured live 2026-07-11, GROM Digital AU) + this plugin's `engine/voiceai-ir.mjs` /
> `engine/voiceai-compiler.mjs`. Internal `services.leadconnectorhq.com/voice-ai/*` surface;
> the public `voice-ai-v3` API reaches only a fraction of it (basic CRUD + call logs).
> Underlying voice provider is **Retell** (`provider: "RETELL"`, not IR-settable).

**Status: built + unit-tested (119 tests across the engine), NOT yet live-proven.** The
capture confirms the API accepts these shapes, but this engine has not yet created a real
Voice AI agent end-to-end. Treat the first real use as a small, throwaway, verified,
cleaned-up validation run — same discipline as the original capture session — not a routine
operation. State this plainly to the user before building a Voice AI agent for them.

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
| Voices | `GET` | `/voice-ai/voices/all?provider=r` · `/voices/my-voices` |
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
- **Voice:** `voiceId` (default `g6xIsTj2HwM6VR4iXFCw`), `voiceModel` (`auto`), `voiceTemperature`,
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

## Actions

`POST /voice-ai/actions` — body `{agentId, actionType, locationId, name, actionParameters{…}}`.
A **separate resource**, not embedded in the agent PUT (a `followUpAgentSave` capture note
confirms the agent PUT "contains no action-related fields at all"). The agent's GET response
splits actions into typed buckets: `callTransferActions[]`, `contactFieldActions[]`,
`workflowActions[]`, `smsActions[]`, `customActions[]`, `agentTransferActions[]`,
`capActions[]`, `mcpServers[]` (plus raw `actions[]` with SCREAMING_SNAKE `actionType`, and
`actionIds[]`).

**`CALL_TRANSFER` — the only live-verified action type.** Response `type: "callTransfer"`,
bucket `callTransferActions[]`. `actionParameters`: `triggerPrompt`, `triggerMessage`,
`triggerMessageType` (`static_text`), `transferToType` (`number`), `transferToValue`,
`hearWhisperMessage`.

Not yet captured (inferred only, treat as unverified): `WORKFLOW_TRIGGER`, `SMS`,
contact-field update, `APPOINTMENT_BOOKING`, Custom Action 2.0, Agent Transfer, MCP.

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
