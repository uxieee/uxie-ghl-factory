# Agent Studio "Super Agents"

> Ground truth: `ghl-workflow-api-docs/research/ai-agents-internal/agent-studio-internal.md`
> (captured live 2026-07-11, GROM Digital AU) + this plugin's `engine/studio-ir.mjs` /
> `engine/studio-compiler.mjs`. Internal
> `services.leadconnectorhq.com/agent-studio/super-agent/*` surface — a GPT-builder-style
> agent, **NOT** the public 11-action `agent-studio` category. Underlying model:
> `anthropic/claude-sonnet-4-6`. Builder-chat runtime codename: `anton`.

> ⚠️ **The status line below is UNRECONCILED (flagged 2026-07-17).** The project record
> reports that all four AI compilers — including Agent Studio's SSE-build + full-replace
> update — were live-create-proven on GROM AU (`wdzEoUZnXO9tB3PPzcot`) on 2026-07-11, with the
> objects verified then deleted (so no capture survives). This banner may simply never have
> been updated after that run. Until someone reconciles it, keep the conservative discipline
> below, but do not state "never live-proven" to the user as established fact.

**Status: built + unit-tested (119 tests across the engine), NOT yet live-proven.** The
capture confirms the API accepts these shapes, but this engine has not yet created a real
Super Agent end-to-end. State this plainly before building one for a user — treat the first
real use as a small, throwaway, verified, cleaned-up validation run.

## What Agent Studio "Super Agents" are

An autonomous, tool-using agent — closer to a GPT/assistant-builder than a scripted chat bot.
Distinct from Conversation AI (a channel-bound chat bot with a fixed 3-part prompt) and Voice
AI (a phone agent) — see the parent SKILL.md's three-way distinction. Configured with a
system prompt, a tool set (`web_search`, `image_generation`, `kb_search`), and exactly one
trigger, run by Claude Sonnet 4.6.

## Endpoint map

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/agent-studio/super-agents/build` | Create — NL prompt, streams SSE, auto-persists a draft |
| `PUT` | `/agent-studio/super-agent/agents/:id` | Update — **whole-object replace** |
| `GET` | `/agent-studio/super-agent/agents/:id?locationId=` | Fetch one |
| `GET` | `/agent-studio/super-agent/agents/:id/activity?locationId=` | Trigger/chat run log |
| `POST` | `/agent-studio/agents/anton/session` | Resume/init builder-chat runtime (`{sessionId, locationId}`) |
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
- `tools[]` maps 1:1 to a UI "Capabilities" toggle: `web_search`, `image_generation`.
  Attaching a knowledge base **auto-adds `kb_search`** — the compiler replicates this (you
  don't need to list `kb_search` explicitly just because you set `knowledgeBaseIds`).
- `triggers[]` — **only ONE active trigger at a time.** Selecting a new type in the UI
  REPLACES the array wholesale; it never appends. Observed trigger types: Form submitted,
  Lead tag, Schedule, Appointment booked, Appointment status, Contact created, Opportunity
  created, Opportunity status changed — each auto-fills a templated `triggerMessage`. Only
  `chat` (the default "Chat Started" trigger from NL-build) and `contact_created` have their
  wire `type` slug actually captured (`VERIFIED_TRIGGER_TYPES` in `studio-ir.mjs`); the other
  six are UI labels without a confirmed slug — don't guess them.
- `contextManagement`, `plugins`, `reasoning.effort` — stable literal defaults across every
  capture, no IR-level knob yet. Per-skill scoping within the Default plugin (unchecking a
  built-in tool category) never persisted a PUT in the captured beta UI session — treat that
  as an unresolved gap, not something this compiler can drive.
- `knowledgeBaseIds` — capture shows `null` when unset (never an empty array); the compiler
  preserves that null-vs-array distinction rather than defaulting to `[]`.

## PUT is whole-object replace (like Voice AI; unlike Conversation AI's merge)

"Every request body observed contains the complete `config`... even when only ONE field
changed in the UI." There is no partial-update path — `studio-compiler.mjs` has no
`parseSuperAgentPartialIR` counterpart, same reasoning as Voice AI. The compiler emits
`{locationId, config}` where `config` is the full rebuilt object — note the agent id appears
**only in the URL path**, never repeated inside the body.

## Create is an NL-build SSE flow — no fully-specified create

`POST /agent-studio/super-agents/build` takes just `{message, locationId, context:
{companyId}, mode: "fast"}` — a free-text prompt, nothing else. There is **no way to POST a
fully-specified config at create time.** The server's `anton` runtime streams
`config_partial`/`config_update` SSE events while generating the config, auto-persists it as
a draft, then emits `agent_saved`/`done` with the new agent id. The streaming protocol itself
is undocumented (only the final persisted draft was captured, not the SSE frames).

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
import { compileSuperAgentCreate, compileSuperAgentUpdate } from './engine/studio-compiler.mjs';

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
  trigger: { type: 'contact_created' },
  knowledgeBaseIds: [kbId], // auto-adds kb_search
}, { agentId, locationId });
```
