---
name: ghl-voice-ai
description: "Build and configure GoHighLevel Voice AI phone agents — the prompt, the voice, the actions (appointment booking, call/agent transfer, contact-field extraction, SMS, workflows, custom API), knowledge bases, MCP servers, working hours, and outbound consent. Use when the user says 'set up a voice agent', 'build a phone agent', 'my AI should answer calls', 'book appointments over the phone', 'outbound calling', 'the agent isn't transferring calls', 'change the voice', or names a Voice AI agent. Internal API — the public rail exposes only how the agent sounds, not what it does."
---

# GHL Voice AI

> **Hitting a wall?** `search_endpoints` on the internal MCP covers this surface too — 620
> endpoints across every GHL product, with the typed tool that covers each one and whether a
> location token is proven to reach it. Search before concluding something is not possible.

> **MCP routing:** if `uxie-ghl-internal-mcp` is registered, prefer `create_voiceai_agent` —
> it wraps this skill's compiler behind a confirmation gate and round-trip verification.

## Why this is an internal-rail skill

Both rails return the **same agent**, but not the same agent. Measured on a live account:

| | fields |
|---|---:|
| public `GET /voice-ai/agents/{id}` | 27 |
| internal `GET /voice-ai/agents/{id}` | 51 |

The 24-field gap is the **entire behaviour layer**: every action array
(`agentTransferActions`, `callTransferActions`, `contactFieldActions`, `customActions`,
`smsActions`, `workflowActions`, `capActions`), `appointmentBookingAction`,
`knowledgeBaseIds`, `llmModel`, `extractDataFields`, `mcpServers`, `aiDisclaimerConfiguration`.

Public exposes how the agent **sounds and paces** (`voiceId`, `responsiveness`,
`maxCallDuration`, `spamConfig`). It cannot see or set what the agent **does**.

Use the public rail for a quick read; use this for anything that configures behaviour.

## Contract

Follow `${CLAUDE_PLUGIN_ROOT}/docs/specialist-contract.md` (recon → brief → intake →
blueprint → approval → execute → verify). Recon = read the existing agents first.

## Knowledge

- `references/voice-ai.md` — endpoints, the full-replace update, action payloads, the
  compiler.

Corpus (deeper, account-agnostic): `ai-agents/10-anatomy/voice-ai-agent-shape.md`,
`ai-agents/30-types/voice-ai-actions.md`, `ai-agents/40-rules/constraints.md`.

## The traps that cost the most

**1. The update is FULL REPLACE.** `PUT /voice-ai/agents/{id}?publishAgent=true&mode=update`
replaces the whole document. Any field omitted takes the compiler's default and silently
clobbers a differing live value. Read the agent first and reconcile; never send a partial.

**2. Empty strings are rejected, absent keys are fine.** `businessName`, `welcomeMessage` and
`timezone` return **422** when sent as `''`. The compiler omits them instead — do not
"helpfully" fill them with placeholder text.

**3. Speech-to-speech removes outbound.** Selecting a Realtime model (`GPT Realtime 2.1`,
`GPT Realtime 2`, `Gemini 3.1 Flash Live Preview` — providers `openai_s2s` / `gemini_s2s`)
**removes the Inbound/Outbound selector entirely**. Proven by a reversible A/B: switching to a
Realtime model and back made the section vanish and reappear. If the agent must make outbound
calls, it cannot be speech-to-speech.

**4. Changing the model family invalidates the voice.** Text → s2s auto-changed the voice;
switching back left it **empty**. Any write that changes `voiceModel` must revisit `voice`.

**5. Multi-calendar booking needs a per-calendar trigger.** `calendarActionType: "multiple"`
switches the shape: `calendarId: null`, `calendarIds: [{id, triggerCondition}]` — an **array of
objects**, unlike Conversation AI's flat id array — plus `aiDescription` (≤500 chars) and an
optional `fallbackCalendar` / `fallbackCalendarId`. Omit `triggerCondition` and the agent has
calendars with no basis for choosing between them. GHL ships
`POST /voice-ai/actions/generate-with-ai/trigger-prompts` with `generateOnlyEmpty: true` to
fill them.

**6. The verifier reads nested.** The PUT sends ~55 fields flat; the GET returns most under
`agentSettings`, wraps `voice`/`language` as objects, and renames `ringDurationSeconds` →
`ringDurationMs` and `inboundPhoneNumber` → `inboundNumber`. The driver normalises this — do
not "fix" a reported mismatch by flattening the read.

## Deployment is a phone number, not a publish

An agent goes live by being attached to a number:
`PUT /voice-ai/agents/{agentId}/phone-number`. Outbound is separate again and gated on
consent (`/voice-ai/consent/*`, async apply + audit tasks with status polls) before it can be
configured at all.

## Limits worth knowing before you author

Agent name ≤40 chars · greeting ≤190 · execution message ≤500 · folder name ≤100 ·
custom API actions need `apiUrl` and, when auth is on, an API key.
Full set: `ai-agents/40-rules/constraints.md`.

## Proven status (state this honestly to the user)

| Surface | Status |
|---|---|
| create → full-replace update → verify | **live-proven end-to-end.** `POST /voice-ai/agents` takes only `{locationId}` and returns an id; the follow-up `PUT …?publishAgent=true&mode=update` applies the config and the re-read confirms it |
| `CALL_TRANSFER`, `DATA_EXTRACTION` | **live-fired** |
| the other 5 action types | **capture-verified, not live-fired** — validated against `voiceai-actions-all.json`, never individually round-tripped |
| `IN_CALL_DATA_EXTRACTION`, `MCP` | **untested.** Do not assume `IN_CALL_DATA_EXTRACTION` mirrors `DATA_EXTRACTION` |

The seven types are `CALL_TRANSFER`, `WORKFLOW_TRIGGER`, `SMS`, `DATA_EXTRACTION`,
`APPOINTMENT_BOOKING`, `CAP`, `AGENT_TRANSFER_CHILD`.

**Verification covers 52 of the ~55 fields the update sends.** Four stay unverified because the
read does not expose them in every state: `backchannelFrequency` (only when backchannel is on),
`prompts` (only once configured), `numberPoolId` and `knowledgeBasePrompt` (state unknown).

**Treat the first real use of any capture-verified type as a validation run.** A failed
configuration step leaves a real, unconfigured agent on the account — no rollback.

## Scope

Voice AI only. Conversation AI is a **public-rail** product — see `ghl-orientation`.
Knowledge bases are `ghl-knowledge-base`. Agent Studio is out of scope.
