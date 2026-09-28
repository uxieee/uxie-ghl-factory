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
**instructions**, **capabilities**, **apps / skills**, **actions** and **one or more triggers**; run in chat or on
triggers; billed per run on two meters (`managed-agents` and `managed-agents-test` for test runs).

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
| `POST` | `/agent-studio/super-agent/agents/:id/test` | test panel on a PUBLISHED agent: `{message, locationId, sessionId?}` → SSE `reasoning_delta` / `text_delta` / `completed {finalText, sessionId}`; uses one of 30 test runs a month (proven live) |
| `POST` | `/agent-studio/agents/anton/session` | builder-chat session — note `anton` is the **flow** builder's runtime; the Managed-Agent editor fires this on open (a write-on-open) and only reads history from it |
| `POST` | `/agent-studio/super-agent/agents` | the product's own Save: `{locationId, agencyId, builderSessionId, config, folderId?}` (*bundle*; not yet used by this plugin) |
| `DELETE` | `/agent-studio/super-agent/agents/:id?locationId=` | Delete → `{success:true}` |
| `GET` | `/agent-studio/super-agent/agents?locationId=&page=&pageSize=` | List |
| `GET` | `/agent-studio/plugins/default?locationId=&product=Superagents` | 423-tool catalog for the built-in Default plugin |

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
    "knowledgeBaseIds": ["..."],
    "actions": []
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
- `contextManagement`, `reasoning.effort` — server defaults `{strategy:"summarize", keepRecentTurns:10,
  compactionThreshold:0.9}` and `{effort:"medium"}`. The config also carries `actions[]` (Actions-Platform
  instances `{actionName, actionId, triggerCondition, basePrompt}`, *bundle*), `customApiEnabled`,
  `customApiCalls`. Per-skill scoping within the Default plugin (unchecking a built-in tool category) never
  persisted a PUT in the captured beta UI session — an unresolved gap, not something this compiler drives.
- `knowledgeBaseIds` — capture shows `null` when unset (never an empty array); the compiler
  preserves that null-vs-array distinction rather than defaulting to `[]`.

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
bundle), auto-persists a draft, then emits `agent_saved`/`done` with the new agent id. The product's own Save also
creates with a full `config` (`POST /agent-studio/super-agent/agents`, table above); this engine does not use that
path yet, and whether it works without a builder session is unproven.

To land a fully-specified Super Agent, the real flow is:

1. `POST /agent-studio/super-agents/build` with a descriptive `buildPrompt`.
2. Parse the SSE stream for the `done`/`agent_saved` event → get the new `agentId`.
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
