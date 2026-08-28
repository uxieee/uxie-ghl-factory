# Flow-Based Builder — complete node & trigger capture

Captured 2026-08-26 on the designated test sub-account, against a **real `FLOW_BUILDER_BOT`**
created for the purpose. Field tables are generated from GHL's **marketplace action asset**
(`sniffs/assets/actions.json`) — the schema the builder itself validates against — not from panel
labels. That distinction is the whole point of this page: see "Why labels are not keys" below.

Supersedes the node table in `conversation-ai.md` where they disagree.

---

## The binding

A flow bot's logic **is a workflow**: `workflowType: "agent"`, entered by a `conv_ai_trigger`.

**The flow binds to its agent through a CONDITION ROW, not a top-level key:**

```json
"conditions": [
  { "operator": "==", "field": "botId", "value": "<AGENT_ID>", "title": "", "type": "input" }
]
```

`convTriggerBotId` is **only** the builder URL's query parameter
(`?triggerType=conv_ai_trigger&convTriggerBotId=<id>`). Sent on the trigger document GHL
**discards it silently** — it does not even round-trip as an unknown key. The engine emitted it for
a month, so every flow it built was unbound while reporting `verify.pass: 1`. Corrected
2026-08-26; `engine/compiler.mjs` now emits the condition row and warns (`FLOW_BINDING:`) when a
`conv_ai_trigger` has no `botId`.

The agent half: `botType: FLOW_BUILDER_BOT`, `isObjectiveBuilderEnabled: true`,
`objectiveBuilderWorkflowId: <WID>`.

**Creation order is workflow-first.** `POST /ai-employees/employees` 422s without a non-empty
`objectiveBuilderWorkflowId`:

```
{"message":["objectiveBuilderWorkflowId must be a string",
            "objectiveBuilderWorkflowId should not be empty"],"statusCode":422}
```

So: create the flow workflow → create the agent pointing at it → set the trigger's `botId`.

---

## Triggers

### `conv_ai_trigger` — "Conversation AI trigger" / Chat Initiated

`✅ verified-live` · example: `catalog/trigger-examples/conv_ai_trigger.json`

**Exactly one filter**, and it is the binding itself:

| field | panel label | required | notes |
|---|---|---|---|
| `botId` | Select Conversation AI bot | **yes** | `operator: "=="`, `type: "input"`, `title: ""` |

Selection rules stated by the panel:

- *"Some Conversation AI bots may not appear in this list because they are already using the
  Flow-based Bots mode."* — **one bot ↔ one flow.**
- *"Only bots that are currently in Off or Auto-Pilot mode and still using Basic Mode will be
  shown here."*

Once bound, the field renders **disabled** in the builder.

### `conv_ai_autonomous_trigger` — "Custom trigger"

`✅ verified-live` · example: `catalog/trigger-examples/conv_ai_autonomous_trigger.json`

**Not an entry trigger.** Its registry entry carries `isGotoTrigger: true`: it holds a
`targetActionId` naming a step in the same flow and **jumps** the contact there. The builder draws
it with a dashed edge to its target. The operator-facing label is **"Custom trigger"**.

| Field | Type | Required | Allowed | Default |
|---|---|---|---|---|
| `customTriggerType` | select | yes | `book_appointment` · Custom scenario | `book_appointment` |
| `customTriggerDescription` | textarea | yes | free text | `The customer wants to book an appointment` |
| `customTriggerPriority` | number | yes | 1–10 | `"8"` — stored as a **string** |
| `customTriggerSensitivity` | select | yes | `low` · `medium` · `high` | `medium` — stored lower-case |

Rows use `operator: "eq"`, **not** the `==` that `conv_ai_trigger`'s `botId` row uses.

**Rules** (from `uiControls`, i18n resolved): a `conv_ai_trigger` must already exist
(*"Conversation AI trigger is mandatory for adding custom trigger."*); **max 3** per workflow;
Conversation AI must be enabled; and it is hidden unless the flow-builder beta is allowed —
`GET /ai-employees/beta/{loc}?feature=flow_builder` → `{"isAllowed":true}` on the test account.

Once a `conv_ai_trigger` exists, `hideOtherTriggers` filters the picker to **this type only** — so
a flow can never gain an ordinary trigger, only more custom ones.

**Runtime semantics, as the drawer states them:** *"Custom scenario will only get triggered after
the primary / main workflow is completed. This will move the contact to the alternate branch."*
Not executed — the jump has not been observed running.

> The picker only offers this trigger once the app has finished resolving its Conversation-AI
> plan state — checking too early makes it look unreachable from the flow builder.

---

## Nodes

All nine accept **both** `conv_ai_trigger` and `conv_ai_autonomous_trigger`.

### `conversationai_ai_message` — AI Message

> Bot will send a message based on the prompt

**status** verified-live · **example** yes · **multipath** no

| field | type | required | default |
|---|---|---|---|
| `message` | textarea | **yes** | — |
| `waitForReply` | checkbox | **yes** | `true` |

### `conversationai_ai_splitter` — AI Splitter

> Let AI determine the best response path by analyzing user input and directing to the correct conversation branch as per description. 

**status** verified-live · **example** yes · **multipath** yes — `No condition met`

| field | type | required | default |
|---|---|---|---|
| `description` | textarea | **yes** | — |

### `conversationai_book_appointment` — Book Appointment

> Define the logic for booking an appointment

**status** verified-live · **example** yes · **multipath** yes — `Appointment Booked` / `Appointment Not booked`

| field | type | required | default |
|---|---|---|---|
| `promptInstructions` | textarea | no | `Get the customer to book an appointment` |
| `calendarId` | select | **yes** | — |

### `conversationai_continue` — Continue Conversation

> The bot will continue to engage with the contact using the Knowledge base and Global prompt 

**status** verified-live · **example** yes · **multipath** no

| field | type | required | default |
|---|---|---|---|
| `instructions` | textarea | no | — |

### `conversationai_custom_message` — Custom Message

> Bot will send a custom message as it is

**status** verified-live · **example** yes · **multipath** no

| field | type | required | default |
|---|---|---|---|
| `message` | textarea | **yes** | — |
| `waitForReply` | checkbox | **yes** | `true` |

### `conversationai_end` — End Conversation

> End or Stop the conversation with the contact

**status** verified-live · **example** yes · **multipath** no

| field | type | required | default |
|---|---|---|---|
| `message` | textarea | no | — |
| `sleepEnabled` | checkbox | **yes** | `true` |

### `conversationai_objective` — AI Capture Information

> Define an individual goal your bot should achieve, like collecting a name, email, or phone before end business goal is achieved example - booking an appointment.

**status** verified-live · **example** yes · **multipath** no

| field | type | required | default |
|---|---|---|---|
| `objective` | textarea | **yes** | — |
| `contactField` | select | no | — |
| `instructions` | textarea | no | — |
| `responseExample` | textarea | no | — |
| `skipIfFilled` | checkbox | no | `false` |
| `maxAttempts` | numerical | no | `5` |
| `proceedIfNotMet` | checkbox | no | `false` |
| `closingMessage` | string | **yes, when `proceedIfNotMet` is true** | — |
| `tags` | multiselect | no | — |

🔴 **`proceedIfNotMet` is an inverted name.** It is bound directly to the checkbox "Don't Proceed
to Next Objective If Criteria not Met." — `true` = STOP (the objective blocks and keeps asking,
holding the run inside this section); `false` = proceed to the next objective. Checking it
(`true`) makes `closingMessage` REQUIRED — what the bot says when it gives up on this objective —
and reveals an optional `tags`. Confirmed 2026-08-27 against the live action schema
(`fixtures/action-schema.sample.json`, input 6) plus a real UI-built client workflow whose
non-blocking objectives (`false`) carry no `closingMessage` and whose one blocking objective
(`true`) carries both a closing message and `tags: ''`.

### `conversationai_services_booking` — Services Booking

> Use it to add Services you want to book using Conversation AI Flow Builder Bot

**status** recon-fields · **example** — · **multipath** yes — `Appointment Booked` / `Appointment Not Booked`

| field | type | required | default |
|---|---|---|---|
| `conversationai_services` | multiselect | **yes** | — |
| `conversationai_booking_description` | textarea | **yes** | `Get customer to book a service` |

### `conversationai_transfer_bot` — Transfer Bot

> Hand over the conversation to another bot when needed.

**status** verified-live · **example** yes · **multipath** no

| field | type | required | default |
|---|---|---|---|
| `assignedEmployeeId` | select | **yes** | — |
---

## Node envelope

Every node ships the same INTERNAL envelope:

```json
{
  "type": "<key>",
  "name": "<action name>",
  "workflowsActionType": "INTERNAL",
  "attributes": { "...fields", "type": "<key>", "__customInputs__": {} }
}
```

`conversationai_objective` additionally carries a numeric `stepIndex` (it is a premium node).
The three multipath nodes also emit `cat: "multi-path"`, `convertToMultipath: true`,
`transitions[]`, and a separate `type: "transition"` child per branch.

## Terminal nodes

`conversationai_continue` and `conversationai_end` **end their branch**. The builder renders no
"Add action" after a `continue`, and an `end` inserted mid-flow is **silently dropped when the
workflow saves** — it appears on the canvas, then is absent from the persisted document, with no
error. Reproduced twice. Author them last.

## Why labels are not keys

This surface has produced wrong key names four separate times, always the same way: someone read
the panel and wrote the label down. The `end` node is the clearest case —

| panel label | actual wire key |
|---|---|
| END CUSTOM MESSAGE | `message` |
| REACTIVATE AFTER BOT | `sleepEnabled` |
| REACTIVATE AFTER (VALUE) | `sleepDuration` |
| REACTIVATE AFTER (UNIT) | `sleepUnit` |

`customMessage` / `reactivate` / `duration` shipped in the catalogue for a month **after** the
corpus corrected them in prose on 2026-07-27, because the correction was never made in
`gen-catalog.mjs`. Likewise `continue.prompt` (real key: `instructions`) and
`transfer_bot.prompt` (there is no prompt — only `assignedEmployeeId`). Fixed 2026-08-26; both
now carry committed captures.

Note also: a stored `continue` carries `instructions` **even when blank** (`""`). It is not `{}`,
as previously documented.

## Flow-workflow facts

- **They come back `status: "published"`.** Every flow workflow observed — engine-built, never
  opened, or UI-built — reads `published`, while non-flow workflows on the same account stay
  `draft`. The draft-first guarantee does not hold for `workflowType: "agent"`. Unexplained.
- **The Settings tab is disabled** in the flow builder.
- **The API enforces none of the UI's immutability.** Live-proven: `PUT` a different `botId` →
  200, applied; `PUT` `type: "contact_tag"` → 200, applied, conditions wiped. Only DELETE is
  refused (`403 Workflows with type "agent" cannot be deleted`). The engine therefore refuses
  `modifyTrigger`/`deleteTrigger` on a `conv_ai_trigger` itself — hatch `ctx.allowFlowTriggerEdit`.

## What is still open

- **The `Custom scenario` value** of `customTriggerType` — the dropdown offers it, but only
  `book_appointment`'s wire value is captured.
- `conversationai_services_booking` — field names and 2-branch shape confirmed from the asset and
  the live options endpoint, but **not commit-verified**: the test account has no configured
  commerce service, so its services list returns empty and the builder refuses to save the node.
- **Runtime.** No contact has been made to chat with a flow bot, so nothing here proves the bot
  actually enters the flow at runtime — only that the binding is stored in the shape GHL's own
  client reads and renders.
