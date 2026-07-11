# Conversation AI (chat "AI Employee")

> Ground truth: `ghl-workflow-api-docs/research/ai-agents-internal/conversation-ai-internal.md`
> (captured live 2026-07-11, GROM Digital AU, "Prompt Based Bot" flow) + this plugin's
> `engine/convai-ir.mjs` / `engine/convai-compiler.mjs`. This is the internal
> `services.leadconnectorhq.com/ai-employees/*` surface the builder UI actually uses — the
> public `conversation-ai-v3` API is a separate, thinner façade the UI doesn't call.

**Status: LIVE-CREATE-PROVEN.** Create → read → delete, plus the `humanHandOver` action, have
all been round-tripped against a real account and verified. This is the most mature of the
three AI products in this skill.

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
- `botType` — `PROMPT_BASED_BOT` (confirmed; the alternative "Flow Based Builder" / objective
  canvas is NOT captured — out of scope, see parent SKILL.md's Scope section).
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

**`humanHandOver` — the only live-verified action type.** Two live-verified 422 gaps found
during capture, both baked into `convai-compiler.mjs`'s `HUMAN_HANDOVER_DETAIL_DEFAULTS`:
- `details.enabled`, `details.triggerCondition`, `details.reactivateEnabled` are all required
  by the API even though they look optional from the UI.
- `details.sleepTime` / `details.sleepTimeUnit` (number 1-30 / enum `days`|`hours`|`minutes`)
  are ALSO required — unrelated to handover semantics on its face, but the API 422s without
  them.
- `triggerCondition` has no sane default (it's the bot's own decision text for when to hand
  off) — the compiler requires it as a string 10-500 chars and throws `IRError` otherwise.

Everything else — Appointment Booking, Trigger a Workflow, Contact Info extraction, Stop Bot,
Transfer Bot, Auto Followup — was only ever seen as a UI button label, never captured live.
The IR does **not** reject these `type` values (they pass through as accepted-but-unverified,
per the research doc's "capture next" note) — but treat any result from them as unverified
until a live capture backs it up.

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
              details: { triggerCondition: 'Contact explicitly asks for a person, 3+ times, or expresses frustration.' } }],
}, { locationId });

// Update: only pass what's changing — merge semantics, no need to resend the whole agent.
const upd = compileConvaiUpdate({ mode: 'autoPilot' }, { agentId, locationId });
```

Both compilers only produce `{method, path, body, authHeader}` descriptors — issuing the HTTP
call (with a freshly captured `token-id`) and handling the response is the executor's job.
