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

Public search carries `fullPrompt`, `instructions` and `personality`, which the internal SEARCH does not. The
internal single-agent `GET /ai-employees/employees/{id}` returns the three prompt fields, and `fullPrompt` once the
builder has saved the agent (2026-09-29). Internal carries `botType`, `oldPromptIds` (prompt version history) and three
flags, which public does not.

🔴 **Where the prompt lives decides what you may write.** The current builder saves the prompt as ONE `fullPrompt`
document (`## Personality … ## Goal … ## Instructions …`). Once an agent has one, the bot answers from it and GHL
ignores writes to `personality` / `goal` / `instructions`: they stay frozen at their old values (live 2026-09-29, a
trial reply followed `fullPrompt` while `instructions` said otherwise). So on any agent a human has saved in the
builder, change the prompt with `update_convai_agent` `spec.fullPrompt` (the whole text). The three fields on such an
agent refuse with `FULLPROMPT_OWNS_PROMPT` before any write and hand back `currentFullPrompt`; the result's
`promptOwner` says which field the bot now answers from.

**So: use the `ghl` MCP (public) for reading and configuring Conversation AI agents.** Reach for
the internal rail only for:

- **the per-contact AI switch** — `GET`/`PUT /conversations-ai/employeeConfigs[/{configId}]`.
  No public equivalent. This silences one bot for one contact; DND is worse on every count.
- **prompt version history** (`oldPromptIds`), if a rollback is actually needed.
- **the Agent Deployment routing table** — `GET /agent-deployment/routing-config/configs?locationId=&agentId=`,
  one row per channel deciding which widgets/numbers actually reach the agent. Internal-only, no public
  equivalent. **Write a row with `set_agent_deployment`**: it touches only the named agent's row and fails unless every
  other row reads back byte-identical. Read the table with `raw_request` (`host:"ai"`, omit `agentId` for every row).
  See the next section.

`references/conversation-ai.md` documents the internal endpoints — read it when you need the
per-contact switch, prompt history or the routing table, not as the default path. Those, and every other
`/ai-employees/*` and `/conversations-ai/*` route the corpus records, are indexed by
`search_endpoints` on the internal MCP; use it to confirm a path before hand-typing one — **not**
as a reason to leave the public rail for reads and config it already covers.

## "My bot isn't replying" — read the routing table before touching the prompt

Deployment is a routing table (one row per channel), not a toggle on the agent record. The mute
symptom: contacts get created, no reply, no enrolment, no error anywhere. Diagnose in this order:

1. Read the routing rows (`raw_request`, `host:"ai"`; no agent read shows them) and fix any row pointing at
   nothing — `set_agent_deployment` with `allIdentifiers: true` ("All widgets"). The table is account-wide: check the
   preview's `collisions` before confirming.
2. Only after every row checks out: the per-contact switch, `mode`, `channels[]`, then the prompt.

Clone rule: Live chat stays on *All widgets*, never a specific widget id — ids change on a clone
(inferred — the clone path itself was not re-executed). Endpoints, row shape and the exact PATCH
body: `references/conversation-ai.md` → "Deployment — the routing table"; corpus
`knowledge/corpus/ai-agents/20-api/agent-deployment-routing.md`.

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
- `references/conversation-ai.md` — agent config, the 7 action-record types, merge-PUT semantics,
  driving `convai-compiler.mjs`.
- `references/agent-studio.md` — **Managed Agents** (the UI's "Agent Studio" tab; the internal
  `/agent-studio/super-agent/*` surface that `create_studio_agent` drives).
  Read its **Traps** first: a builder-chat edit can re-add every CRM skill; the agent-view chat bills while the
  test panel is free; a use-case template creates an agent.

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
| Conversation AI | `/ai-employees/*` | `POST /ai-employees/employees` | `PUT` takes a partial body; omitted agent-level booleans RESET (merge unproven) | `convai-compiler.mjs` |
| Voice AI | `/voice-ai/*` | `POST /voice-ai/agents` `{locationId, folderId?}` (server generates a default; the first Save PUT configures it) | `PUT …/:id` (with or without `?publishAgent=true&mode=update`) **merges a partial body at the top level**; nested objects are validated whole | `voiceai-compiler.mjs` / `voiceai-update.mjs` |
| Agent Studio | `/agent-studio/super-agent/*` | `POST /agent-studio/super-agents/build` (NL-prompt, SSE; may pause for questions) | `PUT /agent-studio/super-agent/agents/:id` **full-replace** (whole `config`) | `studio-compiler.mjs` |
| Knowledge Base (rich-text) | `/knowledge-base/rich-text/` | `POST` (async — response is `status:"training"`; poll until `"trained"`) | — | `kb-compiler.mjs` |

**Auth is `token-id`** (a Google `securetoken` JWT) **alongside** the Bearer — the dual-credential
rail, which the MCP's `host:"ai"` attaches for you. Running the scripts directly is a different,
service-dependent auth surface.
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
| create → read → verify → delete | **live-proven** — engine drove a real agent through the internal API and it round-tripped |
| actions `humanHandOver`, `triggerWorkflow`, `updateContactField`, `stopBot`, `transferBot`, `advancedFollowup` | **live-proven** — created, updated (`PUT /ai-employees/actions/{id}`) and deleted (`DELETE`, which also removes the agent's pointer) on a test account, 2026-09-26 |
| `appointmentBooking` action | **saved and read back live** (single calendar, via `create_convai_agent`, 2026-09-29); **never run** — running it books. 🔴 The server accepted a DRAFT calendar that the builder refuses ("One or more calendars are inactive/deleted"): check the calendar is active before trusting the action |
| what a test chat fires | **only Stop Bot.** Handover, Trigger a Workflow and Contact Info produced no action in a trial, so a trial does not prove them (`references/conversation-ai.md` → "Test chat") |
| list, folders, duplicate, dashboard metrics | **live-proven** — routes and traps in `references/conversation-ai.md` → "Around the agent" |
| partial-PUT semantics | **refuted for booleans** — a partial PUT reset cancel/reschedule live (2026-08-28); read-merge-write is the safe shape |

The seven types are `humanHandOver`, `appointmentBooking`, `triggerWorkflow`,
`updateContactField`, `stopBot`, `transferBot`, `advancedFollowup`. The editor's menu shows an eighth
entry, **API Call**, which is an Actions-Platform skill, not an action record. Actions have their own
`PUT` / `DELETE /ai-employees/actions/{actionId}` (the agent PUT cannot change them).

## What GHL can do that this plugin does not author

If the user wants one of these, **GHL can do it** — say so and point to the UI.

| Capability | Where in GHL | Why not here |
|---|---|---|
| API Call action (custom HTTP call during the chat) | Conversation AI agent → Build → Actions → API Call | an Actions-Platform skill with a mandatory test run; not yet engine-authored |
| Active Hours (per-bot working hours, off-hours reply) | Agent → Deploy → Working Hours (needs Labs "Working Hours for Conversation AI") | Labs-gated per location |
| Prompt Optimizer (simulated test chats, auto-optimise) | Agent editor → Prompt Optimizer (Labs) | billed per run, Labs-gated |
| Flow agents (the node-graph canvas) | Voice AI → Create Agent → **Flow Builder** (any location with the flag); AI Agents → Agent Studio (flow agents, create limited to five agencies) | no typed tool; corpus `ai-agents/10-anatomy/flow-agent-shape.md` has the graph, tools, actions, AI Router and Deploy. 🔴 A Router edge with no condition lets the agent hang up at any turn; Build with AI (vera) built no End Call node when asked to end the call |
| Agent apps beyond Default: marketplace MCP apps, app connections, custom MCP servers, configured skill copies | Managed Agent editor → Apps → **Add app** / **Add custom MCP** | connecting an app is an OAuth grant, and an MCP server or API-call skill makes GHL call an outside URL — not exercised; corpus `ai-agents/20-api/actions-and-plugins.md` has the Default catalogue, custom skills and the actions catalogue |
| Chat widgets (create / style / install) | Sites → Chat Widget | raw request only, no typed tool; corpus `ai-agents/20-api/chat-widget.md` has every call. 🔴 The type picker CREATES on click. The builder's Save sends the WHOLE settings object, so an agent-written PUT must carry every key. Save stays disabled while Agency branding is on with its URL empty. The all-in-one Agent tab pre-selects the first active Voice AI agent. Delete is soft (`deleted: true`). Which bot answers is an Agent Deployment WebChat / Live_Chat row (`set_agent_deployment`), not a widget field |
| Legacy v1 Conversation AI (location settings, its v1 test chat, Migrate to v2) | only on a sub-account still on v1 | location-wide; the migration is one-way; the v1 trial is billed |
| Reporting / remarking on an AI reply | Conversations → an AI message → report | a write on a real conversation's message; raw route in corpus `ai-agents/00-overview/index.md` |
| Selling a bot on the Marketplace, or installing a marketplace bot | agent row menu → **Sell on Marketplace** / **Copy URL for Marketplace**; Create agent → **Marketplace Templates** | publishing to the public Marketplace needs a developer profile and is outward-facing |
| Brand voice records (what a form bot's `brandId` names) | Marketing → Brand Boards → Brand Voice; form bot editor → Brand Voice tab | a Brand Boards object, raw only (`POST /brand-boards/voices/`, corpus `10-anatomy/conversation-ai-agent-shape.md`); its effect on replies is style, not measurable |
| AI Suite billing, usage limits, rebilling | Agency → AI Suite | agency billing, account-wide |
| Making an agent the location's **primary** bot (`isPrimary`) | Conversation AI → agent menu → Set as Primary (hidden when channel management is on) | location-wide: it hands the location's inbound messages to that agent and can unseat the current primary; `create_convai_agent` refuses `isPrimary:true` |
| Appointment Booking in **Services** mode (book one of the location's calendar services) | agent → Actions → Appointment Booking → Services (flag `servicesCalendarsAppointmentBooking`) | never executed live (no calendar service to test against); `create_convai_agent` refuses it — raw `POST /ai-employees/actions` with `calendarIds [{id: serviceId, triggerCondition: ""}]` + `aiDescription` (corpus `30-types/conversation-ai-actions.md`) |
| Answering the Managed Agent builder's questions | AI Agents → Managed Agents → build chat (the question cards) | `create_studio_agent` stops at the questions (`STUDIO_BUILD_AWAITING_INPUT`) and names them; put the answers in `buildPrompt` |

**Treat the first real use of any capture-verified type as a validation run** — small,
throwaway, verified, cleaned up. A failed configuration step leaves a real, unconfigured agent
on the account: it does not no-op and it does not roll back.

## Scope
**IN:** designing/building/configuring Conversation AI (both `PROMPT_BASED_BOT` and the
`FLOW_BUILDER_BOT` / Flow-Based Builder), Voice AI, and Managed Agents ("Agent Studio" tab), their actions, and
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
