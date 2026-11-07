---
name: ghl-conversation-ai
description: "GoHighLevel Conversation AI (the chat 'AI Employee') — bot config, the prompt, models (GPT, Claude, Gemini), actions (human handover, transfer, follow-up, contact-field updates, workflow triggers, appointment booking), knowledge-base triggers, channels, rich replies, outbound agents that text first (activation, CRM-event triggers, opening message), AI Campaigns, and the per-contact AI on/off switch. Use when the user says 'set up a chat bot', 'AI Employee', 'my bot isn't replying', 'it should hand over to a human', 'make the bot text new leads', 'start an AI campaign', 'switch the bot to Claude', 'turn the AI off for this one contact', or names a Conversation AI agent. Also Managed Agents (Agent Studio): subagents, Computer, memory, n8n import. Bots, Managed Agents and every 2026-09/10 feature are configured on the INTERNAL rail. OUTBOUND, TRIGGERS AND CAMPAIGNS TEXT REAL PEOPLE: ASK THE HUMAN BEFORE EACH ONE."
---
# GHL Conversation AI

> **MCP routing:** If the `uxie-ghl-internal-mcp` server is registered in this session, prefer its `create_convai_agent` / `create_voiceai_agent` / `create_studio_agent` tools over running this skill's scripts directly — the tools wrap these same compilers behind confirmation gates and round-trip verification. Fall back to this skill's own scripts when the server is not registered.

You design and build GoHighLevel's **Conversation AI** — the chat "AI Employee" that answers
SMS, WebChat, Live Chat, Facebook, Instagram and WhatsApp, and since the 2026-09/10 wave can also **start**
conversations by SMS (outbound triggers and AI Campaigns, `references/outbound-and-campaigns.md`).

## Rail routing — read this first

**Both rails reach Conversation AI; configure on the internal one.** Measured across 17 sub-accounts: the public
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

**Which rail (corrected 2026-10-29):**

- **Listing** — the internal rail. On the sandbox (2026-10-29) the public search returned 11 of 19 bots: it leaves out
  flow-builder bots, so a public-only listing reports bots that exist as missing.
- **Reading one bot** — either rail. Both address the same agent ids; public search carries `fullPrompt`,
  `instructions` and `personality`.
- **Configuring** — prefer the internal `update_convai_agent`: it reads the whole record, merges, writes, and
  proves every field you did not set came back unchanged. Working hours are an internal resource too
  (`GET|POST|PUT /ai-employees/employees/{agentId}/working-hours`, raw only); the public docs also list a
  working-hours write and `customApi` actions, which this plugin has not exercised. The Working Hours feature sits
  behind the `conversationsAI.workingHours` Lab, whose card is one-way (corpus `ai-agents/40-rules/labs-feature-flags.md`):
  ask before enabling.
- 🔴 **The 2026-09/10 wave is internal-only, and most of it is live-proven** (MCP servers are `[source-derived]`; the new
  test panel's success path is unmeasured). Outbound agents, AI Campaigns, rich replies,
  Claude/Gemini models, MCP servers, Build with AI, the new test panel and V2 flow agents have no public endpoint; do not
  look for them on the public rail. What was measured on a test sub-account on 2026-10-29/30 is in the corpus
  (`ai-agents/20-api/conversation-ai-outbound.md`, `…-builder.md`, `30-types/conversation-ai-actions.md`,
  `10-anatomy/conversation-ai-agent-shape.md`, `10-anatomy/flow-agent-shape.md`) with its sniffs in
  `knowledge/sniffs/convai-wave-2026-10-29/`. What the tools author today: `llm` (any roster id, Claude and Gemini
  included), the outbound opener and disclaimer, `richElementSettings` (`update_convai_agent`), outbound configs and
  triggers (`set_convai_outbound`), cancel/reschedule on a V2 flow agent. AI Campaigns are a `raw_request` recipe. The
  section "The 2026-09/10 wave" below says what each is and how sure we are.
- 🔴 **The public rail can arm an agent too.** `conversation-ai__update-agent` with a `mode` other than `off` changes
  whether an outbound agent texts people exactly as the internal write does; recent public MCP builds treat it as a send
  and ask for confirmation. Treat it as part of the confirm-before-live list.

The internal rail is also the only rail for:

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
as a reason to hand-type a path the typed tools already cover.

## Which rail, per job

On the sandbox (2026-10-29) the internal list returned 19 bots and the public search 11: flow-builder bots are missing
from the public search. Every public bot was among the internal 19.

<!-- rail-ledger:conversation-ai -->
_generated from knowledge/catalog/rail-ledger.json — do not edit; the whole ledger is `ghl-orientation/references/rail-ledger.md`._

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | split | `raw_request:GET /ai-employees/employees/list` | `conversation-ai-v3__search-agent`, `conversation-ai__search-agent` |
| create | undecided | internal | `create_convai_agent` | `conversation-ai-v3__create-agent`, `conversation-ai-v3__create-action` |
| edit | undecided | internal | `update_convai_agent`, `set_convai_outbound` | `conversation-ai-v3__update-agent`, `conversation-ai-v3__update-action`, `conversation-ai-v3__update-followup-settings` |
| delete | undecided | internal | `raw_request:DELETE /ai-employees/employees/{employeeId}` | `conversation-ai-v3__delete-agent`, `conversation-ai-v3__delete-action` |

- **read:** List bots on the internal rail: the public search leaves out flow-builder bots. Read one bot's prompt on either rail; the public search carries fullPrompt. The internal JWT is refused on the shared search path, so the internal rail lists through /ai-employees/employees/list.
- **create:** Configure on the internal rail: the 2026-10-27 features exist only there, and the public rail's writes would not carry them.
- **edit:** Configure on the internal rail: the 2026-10-27 features exist only there, and the public rail's writes would not carry them. Outbound configs and triggers are their own resource: set_convai_outbound.
- **delete:** Configure on the internal rail: the 2026-10-27 features exist only there, and the public rail's writes would not carry them.

Internal only: per-contact AI switch; routing table; prompt history; outbound configs and triggers (start conversations on CRM events); the outbound opener and disclaimer; AI Campaigns (bulk-conversation-ai through /bulk-actions/request); rich elements (richElementSettings); model providers: Claude and Gemini as well as OpenAI (llm; the public agent schema has no llm); MCP servers (source-derived); Build with AI (builder/build); the new test panel (builder/test); V2 flow agents (FLOW_BUILDER_BOT_V2).
Public only: nothing recorded.
<!-- /rail-ledger:conversation-ai -->

## "My bot isn't replying" — read the routing table before touching the prompt

Inbound deployment is a routing table (one row per channel), not a toggle on the agent record (outbound is a separate
config, `references/outbound-and-campaigns.md`). The mute
symptom: contacts get created, no reply, no enrolment, no error anywhere. Diagnose in this order:

1. Read the routing rows (`raw_request`, `host:"ai"`; no agent read shows them) and fix any row pointing at
   nothing — `set_agent_deployment` with `allIdentifiers: true` ("All widgets"). The table is account-wide: check the
   preview's `collisions` before confirming.
2. Only after every row checks out: the per-contact switch, `mode`, `channels[]`, then the prompt.
3. If working hours are on: an editor Save with **no channel ticked** in Deploy → Schedule → Working hours sends only the
   agent PUT and silently skips the working-hours write — no error, no toast `[proven-live 2026-10-29]` (corpus
   `40-rules/builder-vs-server.md`). Read `GET /ai-employees/employees/{agentId}/working-hours` (404 = no record) before
   trusting what the editor showed.

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
- `references/outbound-and-campaigns.md` — **load before anything that could make an agent text first**: activation
  (it signs compliance), the nine trigger types, armed vs campaign-eligible, `set_convai_outbound`, the opener and its
  cost, AI Campaigns (DND skip, no de-dup), where each send is logged.
- `references/agent-studio.md` — **Managed Agents** (the UI's "Agent Studio" tab; the internal
  `/agent-studio/super-agent/*` surface that `create_studio_agent` drives; edits are a raw_request PUT of the config).
  **Load it for ANY Managed Agent task.** Two run-time traps to know even before you do: 🔴 a subagent on
  `openrouter/google/gemini-3.8-flash` is accepted on save but FAILS every delegation at run time (the parent quietly
  does the work) — omit the subagent's model or pick another from the roster; 🔴 **Computer** (`sandbox_browser`,
  `sandbox_file`, `sandbox_exec` — the agent opens and clicks websites) has **no stop route**: switching it off does
  not release a running sandbox, so ask before turning it on.
  Read its **Traps** first: a builder-chat edit can re-add every CRM skill; the agent-view chat bills while the
  test panel is free; a use-case template creates an agent; 🔴 a config PUT cannot remove a trigger (`triggers: []`
  is ignored and the stored ones stay enabled; send each back with `enabled: false`).

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
| Conversation AI | `/ai-employees/*` | `POST /ai-employees/employees` | `PUT` takes a partial body and a partial body MERGES (live 2026-10-30, V1 flow, prompt and V2 bots); a reset was recorded on 2026-08-28 and did not reproduce, so the tool keeps read-merge-write and diffs every field it did not set | `convai-compiler.mjs` |
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
what's proven, but confirm with the user before any action on the list below.

**Verify** every write by reading the agent back (GET) and reporting exactly what changed —
never assume a write succeeded because the response was 200.

**Reading what an agent did** (all read-only, live 2026-09-29):
- Every AI product, with the span trace of each turn → Agent Logs: `list_agent_sessions` (rows carry `messageCount`;
  products include `ai_studio`), `get_agent_session` (each turn's `userQueries[]` / `aiResponses[]`),
  `get_agent_message_trace`, `list_agent_contacts`, `get_agent_metrics`. For the exact agentName / channel / contact /
  voice spellings to filter on, `get_agent_log_filter_values`. 🔴 Agent Logs does not validate `products`, and a
  wrong channel or product returns 0 rows, not an error.
- Conversation AI's own dashboard table and its per-contact summaries → `get_convai_conversation_logs` (view `logs`
  needs presetPeriod or from+to; view `summaries` is the table's View Transcript / Summary for one contact).
- Voice AI calls → `get_voice_call_logs` (view `calls` with callType LIVE|TRIAL, dates, actions, sort; view `call` for
  one call's transcript with tool calls; view `pending` for the outbound queue). There is no text search on calls.
- Outbound sends → Agent Logs interactions whose `userQuery` is `"[outbound] trigger"` or `"[outbound] bulk_action"`
  (one session per contact and agent), and Conversation AI log rows under `direction=outbound`
  (`references/outbound-and-campaigns.md` → "Where each send is recorded").
- Test chats: the legacy trial (`interactions/trial`) is not in Agent Logs and does not show which model ran
  `[proven-live 2026-10-29]`; whether the new test panel (`builder/test`) is logged is unmeasured (it has never run
  successfully here). A Voice AI Test Audio call is logged (TRIAL).
- Managed Agents: a chat or Run session id IS an Agent Logs session id (the Run page embeds that detail), so
  `get_agent_session` reads it. For `superagents` sessions only, each interaction also carries `feedback`
  {responseKey, sentiment} | null (chat turn n = key `<session>#<n>`), and `feedback.activity` is the Activity-row
  rating (key = the session id). **Sentiment only**: a rating's reasons and comment are one raw
  `GET /agent-logs/feedback?productType=super_agents&responseKey=<key>`. Submitting a rating
  (`POST /agent-logs/feedback`) has no tool; its body is in `references/agent-studio.md`.

Delegate never-hand-roll: don't call these endpoints ad hoc — drive them through the
`engine/` compilers so behavior stays traced to the captures.

## Confirm before anything goes live

Each of these makes an agent talk to real contacts, or signs something in the caller's name. Name the action, the agent
and who it reaches, and get the human's explicit yes for **that** action before the write:

- **Enabling a channel** for inbound replies — a deployment row (`set_agent_deployment`) or `channels[]`.
- **Activating a Voice AI number**, or turning on an **Agent Studio trigger**.
- **Activating SMS outbound** on a Conversation AI agent (`set_convai_outbound activate`, or a POST/re-enabling PATCH on
  `outbound-configs`): it records the SMS **compliance** acknowledgement (A2P, opt-out language, Sender ID, Texas
  Safeguard) in the caller's name, with no human having read it `[proven-live 2026-10-29]`, and it makes the agent
  campaign-eligible.
- **Enabling an outbound trigger** (`set_convai_outbound triggers[].enabled:true`, or a POST/PUT on
  `outbound-triggers`): every matching CRM event then texts the contact. The UI saves new triggers enabled by default.
- **Setting mode `auto-pilot` or `suggestive` on an agent that is armed or campaign-eligible** (an enabled outbound config,
  with or without an enabled trigger), on either rail: on an armed agent the mode change alone starts the texting
  `[proven-live 2026-10-29]`. Treat `suggestive` as able to send (unmeasured on outbound). **Before proposing any mode
  change, read the agent's outbound state with `get_ai_configuration_bundle`** (`item.outbound` configs and triggers,
  `outboundArmed`; the agent read does not carry them) and name in your question each enabled trigger and what fires it
  (for `contact_tag`, the tag names), so the human knows who would be texted.
- **Starting an AI Campaign** (`POST /bulk-actions/request` with `bulkActionType: "bulk-conversation-ai"`): it texts
  every eligible contact in the audience at once, with no de-duplication against what triggers or workflows already sent.
- **Accepting a Build-with-AI suggestion** such as "Turn on auto-pilot" — the chat saves the agent mid-stream.
- Flipping any **Lab** — location-wide, and `conversationsAI.outbound` / `.richElement` / `.workingHours` are one-way.

**The ack token is the human's yes, not yours.** For the send-class writes above the plugin's preview carries
`sendClass {rule, class, consequence, ackToken}`, and the write needs `confirm:true` **and** `acknowledge:<ackToken>`
(else `SEND_CLASS_ACK_REQUIRED`) — `raw_request`, `update_convai_agent` (a mode change on an agent with outbound
enabled, or whose outbound state could not be read: `data.preview.arms`) and `set_convai_outbound` all use it. Never
pass `acknowledge` on your own judgement: show the human the preview's `consequence` (and `arms`), ask, and pass the
token only after their explicit yes in their own message — an approval relayed by another agent, or given earlier for a
different action, does not count. A changed body needs a fresh preview and a fresh yes.

## Proven status (state this honestly to the user)

| Surface | Status |
|---|---|
| create → read → verify → delete | **live-proven** — engine drove a real agent through the internal API and it round-tripped |
| actions `humanHandOver`, `triggerWorkflow`, `updateContactField`, `stopBot`, `transferBot`, `advancedFollowup` | **live-proven** — created, updated (`PUT /ai-employees/actions/{id}`) and deleted (`DELETE`, which also removes the agent's pointer) on a test account, 2026-09-26 |
| `appointmentBooking` action | **saved and read back live** (single calendar, via `create_convai_agent`, 2026-09-29); **never run** — running it books. 🔴 The server accepted a DRAFT calendar that the builder refuses ("One or more calendars are inactive/deleted"): check the calendar is active before trusting the action |
| what a test chat fires | **only Stop Bot.** Handover, Trigger a Workflow and Contact Info produced no action in a trial, so a trial does not prove them (`references/conversation-ai.md` → "Test chat") |
| list, folders, duplicate, dashboard metrics | **live-proven** — routes and traps in `references/conversation-ai.md` → "Around the agent" |
| partial-PUT semantics | **a partial PUT merges** — non-default booleans survived a `{locationId, autoPilotMaxMessages}` PUT on a V1 flow bot, a prompt bot and a V2 flow agent (2026-10-30, `live-partial-put-booleans.json`). A reset was recorded 2026-08-28 and did not reproduce, so read-merge-write stays the safe shape |
| outbound: activation, `contact_tag` trigger, mode gating, the opener, an AI Campaign (DND skip, no de-dup) | **live-proven 2026-10-29** (attempt, not delivery: the sandbox number is not A2P-registered). The other five executable trigger types were created (disabled) and read back live 2026-10-29 but have never fired (firing unmeasured); an armed agent may hold trigger fires outside its working hours `[inferred]`, so check working hours before assuming a trigger is broken; `references/outbound-and-campaigns.md` |
| Claude / Gemini as `llm` | **live-proven 2026-10-29** — written, read back, and a Claude primary ran an outbound opener (`live-llm-provider-differential.json`, `live-claude-runtime-L2b.json`) |
| rich elements, opener, disclaimer on the agent PUT | **live-proven 2026-10-29** (UI saves captured, read back; the opener seen at send time) |
| MCP servers on Conversation AI | **source-derived** — the editor's reads were seen; nothing was added |
| Build with AI | **live-proven 2026-10-29** (two turns; it created an agent mid-chat) |
| new test panel `builder/test` | **422 path only** — the success path needs a business email on the location |

The seven types are `humanHandOver`, `appointmentBooking`, `triggerWorkflow`,
`updateContactField`, `stopBot`, `transferBot`, `advancedFollowup`. The editor's menu shows an eighth
entry, **API Call**, which is an Actions-Platform skill, not an action record. Actions have their own
`PUT` / `DELETE /ai-employees/actions/{actionId}` (the agent PUT cannot change them).

## The 2026-09/10 wave — what is new and how to drive it

Measured on a test sub-account on 2026-10-29/30 unless marked otherwise; sniffs in `knowledge/sniffs/convai-wave-2026-10-29/`.
Most of it sits behind Labs whose `liveAt` falls between 2026-10-31 and 2026-11-27, so expect it on every account soon.

**Outbound and AI Campaigns** — `references/outbound-and-campaigns.md`. Every write there is on the confirm-before-live
list.

**Models.** The roster is server-driven: read it with `get_ai_agent_options product:"conversation_ai"` (prices, default,
`deprecation`), never from this page. On 2026-10-29 it held 22 models: 15 OpenAI (`gpt-4.1` default and recommended), 4
Anthropic (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-haiku-4-5-20251001`) and 3 Google
(`gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash-lite`) (`live-llm-provider-differential.json`).
- Set `spec.llm {primary, secondary}` with `update_convai_agent` or `create_convai_agent`. A Claude primary with a Gemini
  secondary was written, read back, and the Claude model ran the agent's next generated message `[proven-live]`
  (`live-claude-runtime-L2b.json`). Primary and secondary may not match (server). Whether the secondary must come from
  another provider, and whether an off-roster id is refused, were not measured.
- 🔴 **`gpt-5` and `gpt-5-mini` retire at 2026-10-30T23:59:59Z**; the roster names `gpt-4.1` and `gpt-4.1-mini` as their
  replacements. Whether agents still on them are migrated automatically is open. Find them in
  `get_ai_configuration_bundle` (each item's `detail.llm`) and propose the move to the human.
- The Lab `conversationsAI.provider` gates neither the roster nor the write `[proven-live]`; what it gates was not seen.
- A V2 flow agent's AI Agent node uses its own GPT-only list (19 entries), not this roster.

**Rich elements** (`richElementSettings`, prompt bots only, one-way Lab `conversationsAI.richElement`):
`{enabled, customRulesOnly, elements{richText, quickReplies, linkButtons, list, carousel, image, file}, customInstructions[]}`
on the agent PUT; `update_convai_agent` sends it whole. Formatted text renders on WhatsApp only; quick replies, link
buttons, lists and images on WhatsApp, Facebook, Instagram and Live chat; files on WhatsApp, Facebook and Live chat; SMS
gets none. The server mints a rule `id` for any rule sent without one, and a later save re-minted it — never key on a
rule id across saves. The UI offers no carousel.

**MCP servers on Conversation AI** `[source-derived]` (Lab `aiEmployeeMCPSupport`): an `mcp_app` skill instance
(`kind: "mcp_app"`, `product: "ConvAi"`) in the Agent Studio plugin store, pointing at a marketplace or custom MCP app and
a connected account; the client blocks a sixth server per agent. Connecting a marketplace app is an OAuth grant to a
third-party account and nothing was added, so there is no tool: point the user to Build → MCP → Connect MCP Server.

**Build with AI** (Lab `conversationsAI.chatBuilder`): `POST /ai-employees/employees/builder/build` streams server-sent
events, and 🔴 **an `agent_saved` event arrives mid-stream: the agent exists, with its booking action, before anyone
reviewed it** (mode `off`, no channels) `[proven-live 2026-10-29]`. Its suggestions offer "Turn on auto-pilot". The
plugin does not drive it; `raw_request` treats any non-GET on it as send-class. The first UI save of any agent stamps
defaults the user never set: `llm {gpt-4.1, gpt-4.1-mini}` (on a built agent) and the outbound opener
(`ai_generated`) and disclaimer (`concise`).

**The new test panel.** The editor's Test now calls `POST /ai-employees/employees/{agentId}/builder/test`
`{locationId, channel, history, message}` (a strict whitelist: `contactId` and `sourceContact` answer 422). On a location
with no business email it answers **422 `test_contact_unavailable`** — the test runs on the location's business-email
contact, a real contact chosen server-side. The success path was never seen: its response, billing, logging, which
actions fire and whether an outbound test sends are unmeasured. The legacy trial (`POST /ai-employees/interactions/trial`)
still works, also with mode `off`, is billed (about US$0.02 a message), shows no model and is not in Agent Logs.

**V2 flow agents** (`FLOW_BUILDER_BOT_V2`, Lab `conversationsAI.flowBuilderV2`): an employee record plus an **Agent
Studio flow agent** whose graph (prompts, model, tools) lives in a staging version. The editor saves the whole graph with
`PATCH /agent-studio/agents/versions/{versionId}` and sends the employee only `{locationId, cancelEnabled,
rescheduleEnabled}`. `create_convai_agent` refuses V2 (`V2_CREATE_UNSUPPORTED`); `update_convai_agent` only toggles
`cancelEnabled` / `rescheduleEnabled`, with exactly that two-key body, and refuses everything else — edit the rest in
the editor. The name lives on three records (employee, agent, version), so rename in the editor. V2 offers mode Off and
Auto-pilot only, no rich elements and no Outbound section.

## What GHL can do that this plugin does not author

If the user wants one of these, **GHL can do it** — say so and point to the UI.

| Capability | Where in GHL | Why not here |
|---|---|---|
| API Call action (custom HTTP call during the chat) | Conversation AI agent → Build → Actions → API Call | an Agent Studio skill instance (`kind:"custom_api"`, `product:"ConvAi"`) behind a mandatory test run; create, test and save live-proven 2026-09-30 through the editor (the body carries the API key, which the internal tool refuses). 🔴 It lives in the plugin store, not in the employee's `actions[]`; a trial chat does NOT run it; `GET /agent-studio/plugins/skill-instances?agentId&locationId&product=ConvAi` lists it with the key redacted. Not engine-authored |
| Active Hours (per-bot working hours, off-hours reply) | Agent → Deploy → Working Hours (needs Labs "Working Hours for Conversation AI") | Labs-gated per location; the record itself is raw (`GET\|POST\|PUT /ai-employees/employees/{id}/working-hours`, `references/conversation-ai.md`). 🔴 This Lab is ONE-WAY: turning it off answers `400 LABS_FEATURE_FLAG_CANNOT_DISABLE` and the Labs screen offers no off switch. Read a Lab's catalogue card (`GET /labs/features/location/{loc}`, `isIrreversibleFeature`) BEFORE flipping it; corpus `ai-agents/40-rules/labs-feature-flags.md` |
| Prompt Optimizer (simulated test chats, auto-optimise) | Agent editor → Prompt Optimizer (Labs: `performanceAI.agentOptimizer.conversation` / `.voice`) | Labs-gated and metered, with a free tier (100 chat messages and 20 voice minutes a day per location; a live run charged nothing). 🔴 Opening the chat panel REGISTERS a new perf agent every time; a run creates an "Evals - <agent>" copy employee; Auto starts at once (only Stop limits it); nothing can be deleted afterwards (no delete route); corpus `ai-agents/20-api/prompt-optimizer.md` |
| Flow agents (the node-graph canvas) | Voice AI → Create Agent → **Flow Builder** (any location with the flag); AI Agents → Agent Studio (flow agents, create limited to five agencies); Conversation AI → Create Agent → Flow Based (a **V2** flow agent, Labs `conversationsAI.flowBuilderV2`) | no typed tool for the graph (`update_convai_agent` only toggles a V2 agent's cancel/reschedule); corpus `ai-agents/10-anatomy/flow-agent-shape.md` has the graph, tools, actions, AI Router and Deploy. 🔴 A Router edge with no condition lets the agent hang up at any turn; Build with AI (vera) built no End Call node when asked to end the call |
| Agent apps beyond Default: marketplace MCP apps, app connections, configured skill copies | Managed Agent editor → Apps → **Add app** | connecting a marketplace app is an OAuth grant to a third-party account — not done; corpus `ai-agents/20-api/actions-and-plugins.md` has the Default catalogue, custom skills and the actions catalogue |
| A custom MCP app (your own MCP server as a Managed Agent app) | Managed Agent editor → Apps → **Add custom MCP** | live-proven 2026-09-30 (register, connect with a bearer token, tools discovered, used by a test run, then deleted). 🔴 It is a LOCATION-wide object; the editor's Save ALSO attaches the Default plugin with every CRM skill (`allSkills:true`), so strip it from the body if the agent must reach only your app; `references/agent-studio.md`, corpus `ai-agents/20-api/custom-api-and-mcp.md` |
| Ask AI as a builder (make a KB or a voice flow graph for you) | Knowledge Base → **Create with AI**; the Ask AI sidebar / page | acts server-side with the user's credentials, outside any browser guard. 🔴 "Create with AI" STARTS a session when clicked; the voice-graph mode builds a NEW same-named agent (created when the plan appears, before approval) instead of editing the one named, and its hand-off voice agent emails all admins by default; corpus `ai-agents/20-api/ask-ai-agent-building.md` |
| Chat widgets (create / style / install) | Sites → Chat Widget | raw request only, no typed tool; corpus `ai-agents/20-api/chat-widget.md` has every call. 🔴 The type picker CREATES on click. The builder's Save sends the WHOLE settings object, so an agent-written PUT must carry every key. Save stays disabled while Agency branding is on with its URL empty. The all-in-one Agent tab pre-selects the first active Voice AI agent. Delete is soft (`deleted: true`). Which bot answers is an Agent Deployment WebChat / Live_Chat row (`set_agent_deployment`), not a widget field |
| Legacy v1 Conversation AI (location settings, its v1 test chat, Migrate to v2) | only on a sub-account still on v1 | location-wide; the migration is one-way; the v1 trial is billed |
| Reporting / remarking on an AI reply | Conversations → an AI message → report | a write on a real conversation's message; raw route in corpus `ai-agents/00-overview/index.md` |
| Selling a bot on the Marketplace, or installing a marketplace bot | agent row menu → **Sell on Marketplace** / **Copy URL for Marketplace**; Create agent → **Marketplace Templates** | publishing to the public Marketplace needs a developer profile and is outward-facing |
| Brand voice records (what a form bot's `brandId` names) | Marketing → Brand Boards → Brand Voice; form bot editor → Brand Voice tab | a Brand Boards object, raw only (`POST /brand-boards/voices/`, corpus `10-anatomy/conversation-ai-agent-shape.md`); its effect on replies is style, not measurable |
| AI Suite billing, usage limits, rebilling | Agency → AI Suite | agency billing, account-wide |
| Making an agent the location's **primary** bot (`isPrimary`) | Conversation AI → agent menu → Set as Primary (hidden when channel management is on) | location-wide: it hands the location's inbound messages to that agent and can unseat the current primary; `create_convai_agent` refuses `isPrimary:true` |
| Appointment Booking in **Services** mode (book one of the location's calendar services) | agent → Actions → Appointment Booking → Services (flag `servicesCalendarsAppointmentBooking`) | never executed live (no calendar service to test against); `create_convai_agent` refuses it — raw `POST /ai-employees/actions` with `calendarIds [{id: serviceId, triggerCondition: ""}]` + `aiDescription` (corpus `30-types/conversation-ai-actions.md`) |
| **Industry Agents** (the vertical business-setup wizard: prefill, template seeding, deploy) | AI Agents → Industry Agents (only where `conversationsAI.industryAgentsSubAccount` is on) | no typed tool; its deploy CREATES a Conversation AI employee, which `update_convai_agent` then edits. Corpus `ai-agents/20-api/industry-agents.md` |
| **Agent Templates** (install a ready-made voice or chat agent) | AI Agents → Agent Templates → a card → Install | an OAuth app authorization, mostly from third-party developers. 🔴 A template's booking and workflow actions are bound to the DEVELOPER's calendar and workflow ids: after an install, re-point them at the account's own objects before the agent goes live [inferred, not installed]. The list is readable raw: corpus `ai-agents/20-api/agent-templates.md` |
| **Flow-agent Template Library** (create a flow agent from a template, upload one as a template) | Agent Studio → Create from Template | the install call needs an `api-key` credential this plugin does not hold; corpus `ai-agents/10-anatomy/flow-agent-shape.md` |
| Rating a test-chat reply / "train the bot" | the agent's test pane → thumbs under a reply | the vote is accepted but nothing reads it back; thumbs-down's train modal writes a KB FAQ (`references/conversation-ai.md` → Test chat) |
| Answering the Managed Agent builder's questions | AI Agents → Managed Agents → build chat (the question cards) | `create_studio_agent` stops at the questions (`STUDIO_BUILD_AWAITING_INPUT`) and names them; put the answers in `buildPrompt` |

**Treat the first real use of any capture-verified type as a validation run** — small,
throwaway, verified, cleaned up. A failed configuration step leaves a real, unconfigured agent
on the account: it does not no-op and it does not roll back.

## Scope
**IN:** designing/building/configuring Conversation AI (both `PROMPT_BASED_BOT` and the
`FLOW_BUILDER_BOT` / Flow-Based Builder), Voice AI, and Managed Agents ("Agent Studio" tab), their actions, and
rich-text Knowledge Base content, via the internal API, plus Conversation AI outbound (configs, triggers, opener) and
AI Campaigns. A **V1** flow bot's logic is a workflow
(`conv_ai_trigger` + `conversationai_*` nodes) — build it with `compileFlowBuilderBot` (agent)
+ the `create-ghl-workflow` engine (flow), then link via `objectiveBuilderWorkflowId`. See
`references/conversation-ai.md` → "Flow-Based Builder". A **V2** flow agent (`FLOW_BUILDER_BOT_V2`) is an Agent Studio
graph instead: build and edit it in the editor (above).

**OUT:**
- Phone-number provisioning/KYC for Voice AI (`phone-system` internal surface) — compliance
  territory, out of scope for this skill.
- Publishing/enabling an agent without explicit user approval.
- The workflow-builder AI *steps* (e.g. `voice_ai_outbound_call`, which places an outbound
  call from a Voice AI agent as one step inside a workflow) — those belong to
  `ghl-workflow-specialist` / `create-ghl-workflow`, not here. This skill builds and
  configures the agents themselves; the other skill wires them into workflow automations.
