# Managed Agents (the internal `/agent-studio/super-agent/*` surface)

> **Naming.** The GHL UI calls these **Managed Agents** — the "Agent Studio" tab's page title. What this plugin's
> tools and older docs call "Agent Studio / Super Agents" is this product. The UI's other **Agent Studio** is the
> node-graph **flow builder** (`/agent-studio/agents*`): its Agent Studio entry is limited to five hard-coded
> agencies, but the same canvas opens for everyone from **Voice AI → Flow Builder** (a `voice_flow_builder` agent,
> proven live 2026-09-28). This plugin does not author it (corpus `ai-agents/10-anatomy/flow-agent-shape.md`;
> `flow-builder-nodes.md` is the unrelated Conversation AI flow bot). Ground truth: the corpus pages
> `ai-agents/20-api/12-ai-agents-api.md` §5 and `ai-agents/20-api/managed-agent-workflow-invocation.md`, and this
> plugin's `engines/ai/studio-ir.mjs` / `engines/ai/studio-compiler.mjs`. Underlying model:
> `anthropic/claude-sonnet-4-6`. Not the public `agent-studio` API category (that one is the flow agents).

**Status.** `create_studio_agent` (NL build → full-config PUT → read-back) was re-proven live on the designated test
sub-account on 2026-09-25 (proof record `proofs/create_studio_agent.json`). On 2026-09-28 every capability id, all
13 trigger types, several triggers on one agent, `plugins: []`, publish/unpublish, a tag-trigger run, a schedule run
and the test panel were executed live and read back (corpus `ai-agents/10-anatomy/managed-agent-shape.md`). Rows
marked *bundle* are from the `superagentsApp` build and not executed.

## What Managed Agents are

An autonomous, tool-using agent — closer to a GPT/assistant-builder than a scripted chat bot. Distinct from
Conversation AI (a channel-bound chat bot with a three-part prompt) and Voice AI (a phone agent). Configured with
**instructions**, **capabilities**, **apps / skills**, **custom skills** and **one or more triggers**; run in chat or
on triggers. Real runs (triggers, the agent-view chat) bill USD on `MANAGED_AGENTS`; test-panel runs only use a
count on `MANAGED_AGENTS_TEST` (30 a month).

The editor (UI walk 2026-09-25): "Edit this agent with chat" (AI builder) · Test Agent · Publish · **Triggers** ·
**Apps** (Default + marketplace apps) · **Capabilities** — Web search, Image generation, Audio generation (MP3),
Video generation (8 s, 16:9 or 9:16), Custom API, Knowledge Base · **Custom skills** (Markdown) · Instructions. The
detail page shows Activity and a **Memory** tab marked "SOON".

## Endpoint map

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/agent-studio/super-agents/build` | Create — NL prompt, streams SSE, auto-persists a draft |
| `PUT` | `/agent-studio/super-agent/agents/:id` | Update — **whole-object replace** |
| `GET` | `/agent-studio/super-agent/agents/:id?locationId=` | Fetch one |
| `GET` | `/agent-studio/super-agent/agents/:id/activity?locationId=` | Trigger/chat run log |
| `POST` | `/agent-studio/super-agent/agents/:id/publish` | `{locationId}` → `status: "published"`; arms the triggers, mints a `triggerId` on each (proven live) |
| `POST` | `/agent-studio/super-agent/agents/:id/unpublish` | `{locationId}` → back to `draft`, `hasPublishedVersion: false`; triggers stop (proven live) |
| `POST` | `/agent-studio/super-agent/agents/:id/test` | test panel: `{message, locationId, sessionId?, contactId?}` → SSE `reasoning_delta` / `tool_started` / `tool_completed` / `text_delta` / `completed {finalText, sessionId}`; **works on a DRAFT**; uses one of 30 test runs a month, no USD (proven live) |
| `POST` | `/agent-studio/super-agent/agents/:id/execute` | the agent view's chat: `{message, locationId}` → SSE `session` … `completed`; runs a draft too, is listed in activity (`kind: chat`) and sessions, and **bills USD** (US$0.039 for one short reply) (proven live) |
| `POST` | `/agent-studio/super-agents/build` + `existingAgentId` | "Edit this agent with chat": the AI builder edits AND SAVES the agent itself (proven live) — see Traps |
| `POST` | `/agent-studio/super-agent/agents/from-template` | `{templateId, locationId, folderId?, folderName?}` — a "Start from a use case" card: creates a draft at once, no AI build, and answers `{id, config, status, …}` (proven live, folder keys too). `create_studio_agent` with `templateId` drives it — see Traps |
| `POST` / `GET` | `/agent-studio/plugins/custom-skills` | custom skills are location-level records `{name, description, skillContent (Markdown + front-matter), agentIds}`; the agent's config does not change; a run loads one with a `use_plugin` call (proven live) |
| `POST` | `/agent-studio/agents/anton/session` | builder-chat session — note `anton` is the **flow** builder's runtime; the Managed-Agent editor fires this on open (a write-on-open) and only reads history from it |
| `POST` | `/agent-studio/super-agent/agents` | the product's own Save: `{locationId, agencyId, builderSessionId, config, folderId?}` (*bundle*; not yet used by this plugin) |
| `DELETE` | `/agent-studio/super-agent/agents/:id?locationId=` | Delete, no body → `{success:true}`; the editor's own call ("This action cannot be undone"); a later read 404s (proven live 2026-09-29) |
| `DELETE` | `/agent-studio/agents/folders/:folderId?locationId=` | delete a folder → `{message: "Folder deleted successfully", unfolderedAgentsCount}` (the list's own call, proven live) |
| `DELETE` | `/agent-studio/plugins/custom-skills/:uuid?locationId=` | delete a custom skill (its id key is `uuid`) → 200, then 404; a skill keeps deleted agents in `agentIds` (proven live) |
| `DELETE` | `/agent-studio/agents/:agentId?locationId=` | delete a **flow** agent, no body → "Agent and all associated versions deleted successfully." (proven live). 🔴 Deleting its Voice AI agent does NOT delete it |
| `GET` | `/agent-studio/super-agent/agents?locationId=&page=&pageSize=` | List |
| `POST` | `/agent-logs/feedback` | rate a reply (the thumbs on a chat turn, or on an Activity row) → `201 {feedbackId}`; body below (proven live 2026-09-29) |
| `GET` | `/agent-logs/feedback?locationId&productType=super_agents&responseKey=` | one rating in full (sentiment, reasons, comment, input, output) or `feedback: null`; `responseKey` is required (proven live) |
| `GET` | `/agent-logs/feedback/states?locationId&productType=super_agents` | EVERY rating's `{responseKey, sentiment}` at the location — no session filter, no paging (proven live); `get_agent_session` joins it for you |
| `GET` | `/agent-studio/plugins/default?locationId=&product=Superagents` | the built-in Default plugin (`authKind: crm_internal`): 540 skills in 31 groups (contacts, opportunities, workflows, calendars…), offered to Superagents, Voice AI, Conversation AI and both flow builders; an agent carries it as `plugins: [{slug: "default", allSkills: true}]`, and `plugins: []` removes it (proven live 2026-09-28) |
| `GET` | `/agent-execution/actions` | the Actions Platform catalogue — 22 action names in 9 entities; send it **without** a `locationId` query (one answers 422). Saved actions are what a **flow** agent's action nodes carry; a Managed Agent stores none (proven live) |
| `GET` | `/agent-execution/actions/{actionId}?locationId=` | read one saved action (an OpenAPI-style operation + your values); 400 without the query (proven live) |
| `GET` | `/agent-execution/actions/spec?actionName=&actionEntity=` | the form spec one action type is built from (Send Email: `POST /conversations/messages`, required `type`, `contactId`, `subject`) (proven live) |
| `GET` | `/agent-execution/actions/{actionId}/safe-template?locationId=` | a reusable copy of a saved action: no `id`, stamped with the caller's location, **your values and the spec's example values stripped**; the editor falls back to it when it cannot read an action, and Save then creates a NEW action (proven live) |

Auth: **`token-id`** header — same as Conversation AI and Voice AI, NOT the workflow-builder's
`Authorization: Bearer`. See the parent SKILL.md's Execute section.

## Config object

```json
{
  "id": "...", "locationId": "...", "agencyId": "...", "status": "draft",
  "config": {
    "name": "...", "description": "...",
    "model": "anthropic/claude-sonnet-4-6",
    "systemPrompt": "...",
    "tools": ["web_search", "image_generation", "kb_search"],
    "triggers": [{"type": "contact_created", "name": "...", "enabled": true, "config": {},
                  "triggerMessage": "A new contact ({{contactName}}) was just created..."}],
    "contextManagement": {"strategy": "summarize", "keepRecentTurns": 10, "compactionThreshold": 0.9},
    "reasoning": {"effort": "medium"},
    "plugins": [{"slug": "default", "name": "Default", "skills": [], "allSkills": true}],
    "starterPrompts": [{"label": "...", "prompt": "..."}],
    "knowledgeBaseIds": ["..."]
  },
  "isOotb": false, "antonSessionId": "...", "deleted": false,
  "versionId": "...", "hasPublishedVersion": false, "hasUnpublishedChanges": true
}
```

- `model` — fixed to `anthropic/claude-sonnet-4-6` in every capture; not proven to be the only
  accepted value, but the only one this engine vouches for (`DEFAULT_MODEL` in
  `studio-ir.mjs`).
- `tools[]` maps to the UI "Capabilities" toggles: `web_search`, `kb_search`, `web_fetch`, `image_generation`,
  `tts_generation` (audio), `video_generation`, `mcp` — all seven stored and read back live (`TOOLS` in
  `studio-ir.mjs`). 🔴 **The server does not validate this list** (a made-up id was stored), so the engine refuses
  anything else. Attaching a knowledge base **auto-adds `kb_search`** — the compiler replicates this.
- `triggers[]` — **several triggers can be active** (stored and read back live). All 13 types the editor offers are
  accepted: `chat`, `form`, `tag`, `schedule`, `appointment_booked`, `appointment_status`, `contact_created`,
  `opportunity_created`, `opportunity_status_changed`, `survey_submission`, `facebook_lead_gen`, `facebook_comment`,
  `workflows` (`VERIFIED_TRIGGER_TYPES`). **The one rule the server enforces**: chat alone, OR a combination of
  non-chat triggers — and `workflows` combines with either; the engine refuses a mix with `TRIGGER_MIX` before any
  write. Everything else the editor requires (a form picked, a calendar, a page) is client-only: the server stores a
  `form` trigger with no forms. Per-type `config` shapes are in the corpus page above.
- 🔴 **A `schedule` runs in the LOCATION's timezone; the trigger's `timezone` field is ignored** (proven live
  2026-09-28: a once-schedule labelled 17:30 "UTC" fired at 17:30 Europe/London). `create_studio_agent` reads the
  location's timezone on `confirm` and refuses a schedule labelled with any other zone
  (`SCHEDULE_TIMEZONE_MISMATCH`). Write the start time in the location's own zone. The editor wants runs ≥ 5 min
  apart and a future `once` time (*bundle*).
- 🔴 **`plugins` (apps) — a new agent gets the Default plugin with ALL 540 built-in CRM skills** (it can message
  contacts and write CRM records). Omitting `plugins` keeps that default (`DEFAULT_PLUGINS` in
  `studio-compiler.mjs`); `plugins: []` removes every app (proven live). Every preview names which one you get.
  Set it to what the agent needs before publishing anything whose triggers fire on real events.
- `imageGeneration: {quality: low|medium|high}` and `mediaSettings: {tts: {voice, instructions}, video:
  {durationSeconds}}` pass through when given.
  🔴 **`mediaSettings.video.durationSeconds` is stored and read back but NOT honoured**: with `4` the generated clip was
  8.0 s (1280×720, h264 + aac), and the editor's row reads "Video generation · 8s · 16:9 or 9:16" (one run, other values
  untried). Generated files land in the location's media library; deleting the library entry leaves the public URL
  answering 200. A run moved no USD usage meter (live 2026-09-30).
- `contextManagement`, `reasoning.effort` — server defaults `{strategy:"summarize", keepRecentTurns:10,
  compactionThreshold:0.9}` and `{effort:"medium"}`. 🔴 **`actions` is NOT stored**: a PUT carrying `actions:
  [{actionName, actionId, triggerCondition, basePrompt}]` (the bundle's shape) answered 200 and read back without
  it, and the agent could not run the action — the editor has no Actions section either. `customApiEnabled` is a
  toggle (`customApiCalls` add outside HTTP calls; not exercised). Per-skill scoping within the Default plugin (unchecking a built-in tool category) never
  persisted a PUT in the captured beta UI session — an unresolved gap, not something this compiler drives.
- `knowledgeBaseIds` — capture shows `null` when unset (never an empty array); the compiler
  preserves that null-vs-array distinction rather than defaulting to `[]`.

## Custom MCP apps (live 2026-09-30)

Apps → **Add custom MCP** registers YOUR MCP server as a location-level app (`POST /oauth/locations/{loc}/mcp-apps {name, mcpUrl, product:"Superagents"}`
→ `appId`, slug `mcp-app-<appId>`, `authType:"basic"`, one credential field `access_token` sent as `Authorization: Bearer <token>`); **Connect** stores
the token (`POST /oauth/clients/{appId}/authentication/locations/{loc}/accounts {access_token, name, email}`, name and email required; `GET /agent-studio/plugins/{slug}/connection-status`
reads it back); GHL then discovers the tools, and an agent that lists the app in `plugins[]` runs them through `use_plugin` discover → guide → execute (a test run executed the tool and the endpoint saw the calls).
Delete = `DELETE /oauth/locations/{loc}/mcp-apps/{appId}` (it disconnects its accounts). The full routes and traps are in corpus `ai-agents/20-api/custom-api-and-mcp.md`.
- 🔴 The app is **location-wide**: register under a clear test name and delete it in the same session.
- 🔴 **The editor's Save writes the agent config with the Default plugin (`allSkills:true`, 540 skills) beside your app.** An agent given that can run any CRM skill; send `plugins:[<your app only>]` (the server keeps exactly what is sent).
- 🔴 Anything under `/oauth/…` is easy to block by mistake with a write guard; the registry list is `GET /oauth/locations/{loc}/mcp-apps` (`custom:true` marks yours), not `/agent-studio/plugins/mcp/list`.
- The `mcp` id in `config.tools` changed nothing observable: the MCP path is the plugin.

## Ask AI as a builder

"Create with AI" (Knowledge Base page) and the copilot's voice-flow mode act server-side with the user's own credentials. 🔴 The button STARTS a session when clicked;
the voice-graph mode creates a NEW same-named flow agent and hand-off voice agent when the plan appears (before approval) and never edits the agent you name; the KB skill makes a KB and FAQs only.
Scope a run with an exact prompt, read each approval card, and diff a before/after snapshot of every agent and KB; details in corpus `ai-agents/20-api/ask-ai-agent-building.md`.

## Traps (proven live 2026-09-28)

- 🔴 **Give an agent only the CRM skills it needs — never `allSkills: true` by habit.** The Default plugin's 540 skills
  include sending SMS/email and writing contacts and opportunities. Restrict it to named sub-skills (ids
  `<group>--<name>`, each with its own method; read them from `GET /agent-studio/plugins/default`):
  `plugins: [{"slug": "default", "name": "Default", "skills": ["opportunities--get-pipelines"], "allSkills": false, "skillCount": 1}]`.
  This is exactly what the editor's skill picker saves. `create_studio_agent` passes it through and it reads back
  unchanged (proven live 2026-09-29). In a run, the listed skill executed and an unlisted one could not even be
  discovered. Not tested: whether the server refuses an `execute` that names an unlisted skill id directly.
- 🔴 **"Edit this agent with chat" can widen the agent.** One turn asked only to "make the tone friendlier. Change
  nothing else." changed the prompt and **re-added the Default plugin with ALL CRM skills** to a `plugins: []` agent
  (and reset `starterPrompts` to `null`). It saves the agent itself. Re-read `plugins` after every builder-chat edit.
- 🔴 **The agent-view chat bills; the test panel does not.** Test with `…/test` (works on a draft, uses a free test
  count). `…/execute` bills USD even on a draft.
- **Templates create agents.** Picking a "Start from a use case" card calls `…/from-template` and creates a draft at
  once.
  - The "Customer Support Agent" template carries the Default plugin (all CRM skills), `kb_search` + `web_search`,
    an ENABLED chat trigger, and a prompt with a "Settings (edit these for your business)" block.
  - The 12 template ids are client-side: knowledge-base-assistant, social-media-posting, lead-qualifier, welcome-email,
    review-request, deal-brief, opportunity-pipeline, email-campaign, weekly-creative-studio, prospect-finder,
    competitor-watch, marketing-performance-report. Their triggers: Chat ×2, Form submission, Tag added ×2, New
    opportunity, Weekdays, Every 2 weeks, Weekly ×4. A publish arms whichever one the template carries.
  - `create_studio_agent` with `templateId` makes the create, then PUTs the template's OWN config with your keys on
    top, so its prompt stays unless you pass `systemPrompt`. Pass a TEST name, `plugins: []` and `triggers: []`.
- 🔴 **A PUT cannot remove a trigger.** `triggers: []` in the full-config PUT is IGNORED: the stored triggers stay,
  enabled. This was live on 2026-09-29, twice, on an own draft. A trigger sent back with `enabled: false` sticks. So
  in `create_studio_agent`'s template door, `triggers: []` means "disable every trigger". On the build door an
  authored `triggers: []` still fails the verify loudly, because the build's own chat trigger remains.
- **Folders at create.** Both doors take `folderId` (+ `folderName`), as the builder does from its route query, and
  the tool confirms membership in `GET /agent-studio/super-agent/agents?folderId=`. Remove-from-folder is a
  move-agents call with the **locationId** as the folderId.
- **Custom API** is a top-level `config.customApiEnabled`, sent only by the PUT (the build never carries it).
  `create_studio_agent` sets it with `customApiEnabled`. It flips the switch only: configure no outward URL or
  credential with it.
- **Generated media stays behind.** `image_generation` and `tts_generation` save their PNG / MP3 into the location's
  media library.
- **A trigger with no `triggerMessage` gets a per-type default** from GHL (chat: "A new chat conversation has started
  with a contact. Begin the intake flow."). `create_studio_agent` leaves it to GHL and does not verify it.
- **The test panel does not need a publish** — keep test agents as drafts.

## Ratings (feedback) on chat turns and Activity rows (proven live 2026-09-29)

The thumbs under an agent-view chat reply and on an Activity row open a server-configured modal
(`GET /agent-logs/feedback/config?productType=super_agents`) and POST `/agent-logs/feedback`. The two hosts differ:

| | chat turn | Activity row |
|---|---|---|
| `responseKey` | `<sessionId>#<n>`: n counts the chat's agent replies from 1, one per send | the bare `<sessionId>` |
| `correlationType` / `correlationId` | `execution_id` / the session id | `conversation_id` / the session id |
| `source` | `super_agents` | `super_agents_activity` |
| `input` / `output` | the turn's message and reply | absent |

Both also carry `locationId, productType:"super_agents", sentiment ("up"|"down"), conversationId (= the session id),
reasons[] (ids such as did_not_follow_instructions, refused, accurate), comment, configVersion, imageIssues[],
reasonDetails{}, chunkVerdicts[], actionVerdicts[], metadata.answers`. A chat-turn body also carries `messageId`
(a client-made `b-<ms>`).

- **Reading ratings:** `get_agent_session` on a `superagents` session puts `feedback {responseKey, sentiment}` on each
  interaction, and adds `feedback.activity` for the Activity-row rating. It is sentiment only. The reasons and comment
  of one rating come from the `?responseKey=` read.
- **`/feedback/states`:** it ignores `conversationId`, `correlationId`, `limit`, `page` and `offset`, and it has no
  cursor or total. A cap on a very long list has not been measured.
- **Reloaded chats:** a reload rebuilds the turns from history, one agent reply per non-user entry. A turn that called
  tools may therefore number differently after a reload. `get_agent_session` lists any key it cannot place under
  `feedback.unplaced`.
- **The Run page:** `…/super-agents/agent/:agentId/run/:runId`, with runId = the session id, embeds the Agent Logs
  detail. "View in Agent Logs" opens `/ai-agents/agent-logs/log/:sessionId`.

## PUT is whole-object replace (like Voice AI; unlike Conversation AI's merge)

"Every request body observed contains the complete `config`... even when only ONE field
changed in the UI." There is no partial-update path — `studio-compiler.mjs` has no
`parseSuperAgentPartialIR` counterpart, same reasoning as Voice AI. The compiler emits
`{locationId, config}` where `config` is the full rebuilt object — note the agent id appears
**only in the URL path**, never repeated inside the body.

## Create — the NL-build SSE flow this engine uses

`POST /agent-studio/super-agents/build` takes `{message, locationId, context: {companyId}, mode: "fast"}` (the
bundle also sends optional `existingAgentId`, `sessionId`, `answeredQuestions`, `skippedQuestionIds`, `folderId`).
The server streams `config_partial`/`config_update` events while generating the config (18 event types in the
bundle), auto-persists a draft, then emits `agent_saved`/`done` with the new agent id.

🔴 **The build can stop and ask** (live 2026-09-29). With `conversation_started.inlineQuestionsEnabled: true` (it was on
the test account) the builder may stream `build_question {id, prompt, options[{value,label}], allowMultiple, …}` and
`awaiting_input {count, sessionId}`, and the stream ENDS there — no `agent_saved`, no `done`, no agent saved. The UI
answers by re-POSTing the build with `sessionId`, `answeredQuestions`, `skippedQuestionIds`. The same kind of prompt
paused once and completed once. `create_studio_agent` treats `awaiting_input` as the end of the stream and fails with
`STUDIO_BUILD_AWAITING_INPUT`, naming each question and its options, sending nothing further: put the answers in
`buildPrompt` and create again. (A client that waits only for `agent_saved`/`done` sees an "incomplete stream" and
loses the questions.) Any spec key the tool cannot apply (e.g. `publish`) is refused before anything is sent;
`folderId`/`folderName`, `templateId` and `customApiEnabled` apply (live 2026-09-29). The product's own Save also
creates with a full `config` (`POST /agent-studio/super-agent/agents`, table above); this engine does not use that
path yet, and whether it works without a builder session is unproven.

To land a fully-specified Super Agent, the real flow is:

1. `POST /agent-studio/super-agents/build` with a descriptive `buildPrompt`.
2. Parse the SSE stream for the `done`/`agent_saved` event → get the new `agentId` (or `awaiting_input` → stop and ask the user).
3. `compileSuperAgentUpdate(fullIr, {agentId, locationId})` → `PUT` the precise desired
   `systemPrompt`/`tools`/`triggers`/`knowledgeBaseIds`/`starterPrompts` as a full-replace.

`compileSuperAgentCreate({buildPrompt, name}, {locationId, companyId, mode})` in
`studio-compiler.mjs` builds only the request for step 1 (SSE response handling is the
executor's job, not this compiler's).

## Driving `studio-compiler.mjs`

```js
import { compileSuperAgentCreate, compileSuperAgentUpdate } from '../../../engines/ai/studio-compiler.mjs';

// Step 1: NL-build create (executor must then parse the SSE 'done' event for the agentId).
const createReq = compileSuperAgentCreate(
  { buildPrompt: 'A support agent that answers product questions using the KB and can search the web.' },
  { locationId, companyId },
);

// Step 2: full-replace PUT with the precise desired config.
const upd = compileSuperAgentUpdate({
  name: 'Support Agent',
  systemPrompt: '...',
  tools: ['web_search'],
  plugins: [],                                   // no apps; omit for the Default plugin (all CRM skills)
  triggers: [{ type: 'tag', config: { tagIds: ['vip'], tagNames: ['vip'], tagAction: 'added' } }],
  knowledgeBaseIds: [kbId], // auto-adds kb_search
}, { agentId, locationId });
```
