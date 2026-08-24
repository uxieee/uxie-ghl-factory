---
name: ghl-conversation-ai
description: "GoHighLevel Conversation AI (the chat 'AI Employee') — bot config, the three-part prompt, actions (human handover, transfer, follow-up, contact-field updates, workflow triggers, appointment booking), knowledge-base triggers, channels, and the per-contact AI on/off switch. Use when the user says 'set up a chat bot', 'AI Employee', 'my bot isn't replying', 'it should hand over to a human', 'turn the AI off for this one contact', or names a Conversation AI agent. READS AND MOST WRITES GO THROUGH THE PUBLIC RAIL — see Rail routing below."
---
# GHL Conversation AI

> **MCP routing:** If the `uxie-ghl-internal-mcp` server is registered in this session, prefer its `create_convai_agent` / `create_voiceai_agent` / `create_studio_agent` tools over running this skill's scripts directly — the tools wrap these same compilers behind confirmation gates and round-trip verification. Fall back to this skill's own scripts when the server is not registered.

You design and build GoHighLevel's **Conversation AI** — the chat "AI Employee" that answers
SMS, WebChat, Live Chat, Facebook, Instagram and WhatsApp.

## Rail routing — read this first

**Conversation AI is a PUBLIC-rail product.** Measured across 17 sub-accounts: the public
`conversation-ai` endpoints returned 200 on every one, and every agent came back with its full
system prompt. Both rails address the *same objects* — the same agent id from
`/conversation-ai/agents/search` (public) and `/ai-employees/employees/search` (internal) — and
public is the richer of the two:

| | fields |
|---|---:|
| public `/conversation-ai/agents` | 36 |
| internal `/ai-employees/employees` | 39 |

Public carries `fullPrompt`, `instructions` and `personality`, which internal does not. Internal
carries `botType`, `oldPromptIds` (prompt version history) and three flags, which public does not.

**So: use the `ghl` MCP (public) for reading and configuring Conversation AI agents.** Reach for
the internal rail only for:

- **the per-contact AI switch** — `GET`/`PUT /conversations-ai/employeeConfigs[/{configId}]`.
  No public equivalent. This silences one bot for one contact; DND is worse on every count.
- **prompt version history** (`oldPromptIds`), if a rollback is actually needed.

This reverses earlier guidance. If you find a document telling you to prefer internal for
Conversation AI, it predates the 2026-08-25 measurement.

## Contract
Follow `${CLAUDE_PLUGIN_ROOT}/docs/specialist-contract.md` (recon → brief → intake →
blueprint → approval → execute → verify).

Recon here = read existing agents before asking anything:
- **Public API (fast, cheap, ToS-clean):** the `ghl` MCP's `conversation-ai`, `voice-ai`,
  and `agent-studio` categories — list/read existing agents at the façade level.
- **Internal API (deep config):** for the real config the public façade doesn't expose
  (three-part prompt, KB triggers, voice/behavior sections, Super Agent `config`), GET the
  agent from the relevant internal endpoint (see Execute below) once auth is captured.

Never ask the user something recon or the brief already answers.

## Knowledge (load what the task needs)
- `references/conversation-ai.md` — agent config, the 7 action types, merge-PUT semantics,
  driving `convai-compiler.mjs`.
- `references/agent-studio.md` — Agent Studio, kept for reference only; **out of scope**.

Sibling skills: **`ghl-voice-ai`** (phone agents, internal rail) and **`ghl-knowledge-base`**
(the content both products consume).

Rich-text Knowledge Base (feeds all three products) is covered inline below and in
`references/conversation-ai.md`'s KB-triggers section — it doesn't need its own file since
it's one compiler (`kb-compiler.mjs`) with a narrow, already-proven surface.

## Execute

All three products (plus KB) live behind `services.leadconnectorhq.com`, compiled by
`engine/*-compiler.mjs` (IR → request descriptor `{method, path, body}` — the compilers
never make live calls; the caller/executor attaches auth and issues the HTTP request):

| Product | Base path | Create | Update semantics | Compiler |
|---|---|---|---|---|
| Conversation AI | `/ai-employees/*` | `POST /ai-employees/employees` | `PUT` **merges** partial bodies | `convai-compiler.mjs` |
| Voice AI | `/voice-ai/*` | `POST /voice-ai/agents` (near-empty; server auto-generates a default) | `PUT ...?publishAgent=true&mode=update` **full-replace** | `voiceai-compiler.mjs` |
| Agent Studio | `/agent-studio/super-agent/*` | `POST /agent-studio/super-agents/build` (NL-prompt, SSE) | `PUT /agent-studio/super-agent/agents/:id` **full-replace** | `studio-compiler.mjs` |
| Knowledge Base (rich-text) | `/knowledge-base/rich-text/` | `POST` (async — response is `status:"training"`; poll until `"trained"`) | — | `kb-compiler.mjs` |

**Auth is `token-id`** (a Google `securetoken` JWT), **NOT** the workflow-builder's
`Authorization: Bearer` scheme — this is a different, service-dependent auth surface.
Capture it per `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` **§7 "AI-services auth
(`token-id`)"** — the dedicated procedure + `services.leadconnectorhq.com` host for this
domain. (The `token-id`-is-retired note in `get-ghl-workflow-json` applies ONLY to the
workflow API's Bearer scheme, not to these AI-services endpoints.)

**Write rails apply.** Before any create/update, run
`${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md`'s two gates: the owned-account check (every
write session) and the one-time ToS disclosure (once per workspace) — this internal API is
undocumented and off the public, supported surface, same as the workflow builder.

**Never publish or enable an agent without explicit approval.** Create as drafts. Voice AI's
update PUT carries a `publishAgent=true` query param that the capture always sent — mirror
what's proven, but confirm with the user before any action that would make an agent live
(enabling a channel, activating a Voice AI number, turning on an Agent Studio trigger).

**Verify** every write by reading the agent back (GET) and reporting exactly what changed —
never assume a write succeeded because the response was 200.

Delegate never-hand-roll: don't call these endpoints ad hoc — drive them through the
`engine/` compilers so behavior stays traced to the captures.

## Proven status (state this honestly to the user)

| Surface | Status |
|---|---|
| Conversation AI — create, read, delete, `humanHandOver` action | **Live-create-proven** (engine → internal API → real agent → verified → deleted) |
| Knowledge Base — rich-text create | **Live-proven** |
| Voice AI — agent create + full-replace update | **FULLY LIVE-PROVEN end-to-end (2026-07-21, GROM AU): create → full-replace update → verified re-read, `agentName` persisted, agent deleted.** `POST /voice-ai/agents` takes only `{locationId}` and returns an id; the follow-up `PUT …?publishAgent=true&mode=update` then applies the config. Three bugs had to be fixed to get here — see `mcp-internal/README.md` §"Live proof ledger — AI agent tools". |
| Agent Studio — Super Agent create (SSE build) + full-replace update | **FULLY LIVE-PROVEN end-to-end (2026-07-21, GROM AU): SSE build → terminal `agent_saved`/`done` → follow-up PUT → verified re-read → `ok:true, verified:true`, canary deleted.** SSE is real (200 `text/event-stream`, ~16.5s, 757 chunks). ⚠️ Tool needs BOTH `systemPrompt` (IR) and `buildPrompt` (build message). Verification asserts only identity (name/systemPrompt) — triggers/actions are AI-generated, not asserted. |

ConvAI + KB rich-text are live-proven.

⚠️ **Voice AI: the engine's CREATE is proven; its UPDATE is proven broken.** Superseded
2026-07-21 — this section previously said the engine was unproven outright. Two distinct
bodies of evidence, do not conflate them:
- **Shapes** (2026-07-17): `DATA_EXTRACTION` creation, `APPOINTMENT_BOOKING` calendar
  repointing, `patch-agent`, voices read — all via the **public `voice-ai-v3` MCP**, never
  through `voiceai-compiler.mjs`. These prove the shapes, not the compiler.
- **Engine** (2026-07-21): `voiceai-compiler.mjs` drove a real create through the internal
  API and produced a real agent. Its full-replace PUT then 422'd. So the compiler's create
  path works and its update path does not.

✅ **RESOLVED 2026-07-21 — the agent-create question is settled.** A throwaway live-fire
through the internal compilers (via the `uxie-ghl-internal-mcp` AI rail) on GROM AU created a
real agent in **all three** products, then deleted them. Evidence: `mcp-internal/README.md`
§"Live proof ledger — AI agent tools".

The old contradiction (memory said proven, this banner said not) resolves as **both partly
right**: **create works everywhere**; the **follow-up configuration step fails** in Voice AI
(422 on the full-replace PUT) and Agent Studio (400), and ConvAI's post-create *verification*
failed. So an agent-create call leaves a REAL, UNCONFIGURED agent on the account — it does not
no-op, and it does not roll back. Clean up after failures.
it is unconfirmed rather than promising either way. See `references/voice-ai.md` §Status. ConvAI now has
verified (not passthrough) support for all 7 captured action types (`humanHandOver` +
`appointmentBooking`, `triggerWorkflow`, `updateContactField`, `stopBot`, `transferBot`,
`advancedFollowup`), and Voice AI for all 7 captured types (`CALL_TRANSFER` +
`WORKFLOW_TRIGGER`, `SMS`, `DATA_EXTRACTION`, `APPOINTMENT_BOOKING`, `CAP`,
`AGENT_TRANSFER_CHILD`) — each validates its capture-required fields and merges
capture-grounded defaults, per `convai-actions-all.json` / `voiceai-actions-all.json`. KB
also gained verified descriptor-builders for Tables (`compileKbTableUpload`) and Files
(`compileKbFileUpload`), alongside the live-proven rich-text path — per
`knowledge-base-tables-files.json`. None of this is yet **live-fired** (each type is
unit-tested against its capture, not each individually round-tripped against a real
account). Treat the first real use of any given action/source type as a validation run
(small, throwaway, verified, cleaned up), not a routine operation.

## Scope
**IN:** designing/building/configuring Conversation AI (both `PROMPT_BASED_BOT` and the
`FLOW_BUILDER_BOT` / Flow-Based Builder), Voice AI, and Agent Studio agents, their actions, and
rich-text Knowledge Base content, via the internal API. A flow bot's logic is a workflow
(`conv_ai_trigger` + `conversationai_*` nodes) — build it with `compileFlowBuilderBot` (agent)
+ the `create-ghl-workflow` engine (flow), then link via `objectiveBuilderWorkflowId`. See
`references/conversation-ai.md` → "Flow-Based Builder".

**OUT:**
- Phone-number provisioning/KYC for Voice AI (`phone-system` internal surface) — compliance
  territory, out of scope for this skill.
- Publishing/enabling an agent without explicit user approval.
- The workflow-builder AI *steps* (e.g. `voice_ai_outbound_call`, which places an outbound
  call from a Voice AI agent as one step inside a workflow) — those belong to
  `ghl-workflow-specialist` / `create-ghl-workflow`, not here. This skill builds and
  configures the agents themselves; the other skill wires them into workflow automations.
