# Building a FLOW BOT (`FLOW_BUILDER_BOT`)

A flow bot's logic **is a workflow** — `workflowType: "agent"`, entered by a `conv_ai_trigger`.
Everything here is live-proven on 2026-08-26 unless it says otherwise.

## The binding — the one thing that silently broke builds

The flow binds to its agent through a **condition row**, not a top-level key:

```jsonc
"conditions": [{ "operator": "==", "field": "botId", "value": "<AGENT_ID>", "title": "", "type": "input" }]
```

Author it as `convTriggerBotId` on the trigger; the compiler emits the condition row.

🔴 **`convTriggerBotId` is NOT a stored field.** It is only the builder URL's query parameter. The
engine emitted it on the document from 2026-07-15 to 2026-08-26 and **GHL discarded it**: every
flow built in that window had an unbound trigger while the build reported `verify.pass: 1`. If you
see a flow whose trigger has `conditions: []`, that is the bug — re-author it.

Omit `convTriggerBotId` and the compiler warns `FLOW_BINDING:`. Do not ignore it.

## Creation order is workflow-FIRST

`POST /ai-employees/employees` with `botType: FLOW_BUILDER_BOT` **422s** without a non-empty
`objectiveBuilderWorkflowId`. So:

1. build the flow workflow (draft),
2. create the agent pointing at it,
3. set the trigger's `botId` to the new agent.

The UI's order (make the bot, then open its builder) is the reverse and does not apply here.

## Minimal flow

```jsonc
{
  "name": "Booking flow",
  "workflowType": "agent",
  "triggers": [
    { "ref": "t", "type": "conv_ai_trigger", "name": "Chat Initiated", "filters": [],
      "convTriggerBotId": "<AGENT_ID>" }
  ],
  "graph": [
    { "ref": "ask", "kind": "action", "type": "conversationai_objective", "name": "Ask treatment",
      "attributes": { "objective": "Find out which treatment they want", "contactField": "<FIELD_ID>" } },
    { "ref": "book", "kind": "action", "type": "conversationai_book_appointment", "name": "Book",
      "attributes": { "calendarId": "<CAL_ID>" },
      "onBooked":    [ /* … */ ],
      "onNotBooked": [ /* … */ ] }
  ]
}
```

## Custom triggers — jumping into a stage of the flow

`conv_ai_autonomous_trigger` (the UI calls it **"Custom trigger"**) is a **goto** trigger: it does
not start the flow, it **jumps the contact to a named step**. This is how you let a conversation
skip straight to booking when the customer asks for it.

```jsonc
{ "ref": "jump", "type": "conv_ai_autonomous_trigger", "name": "Wants to book",
  "target": "book",                                   // ← a step REF, resolved like goto's target
  "filters": [
    { "field": "customTriggerType",        "value": "book_appointment" },
    { "field": "customTriggerDescription", "value": "The customer wants to book an appointment" },
    { "field": "customTriggerPriority",    "value": "8" },
    { "field": "customTriggerSensitivity", "value": "medium" }
  ] }
```

- `target` takes a **step ref** and the compiler resolves it to the real step id. A dangling ref
  throws `REF_DANGLING` — a goto trigger with no `targetActionId` saves and has nowhere to send
  the contact.
- All four filters are **required by the drawer**. The compiler expands them to the envelope GHL's
  own builder writes: `operator: "eq"` — note **`eq`, not `==`**, which is what
  `conv_ai_trigger`'s `botId` row uses. Two conventions on one document type.
- `customTriggerPriority` is stored as a **string**; `customTriggerSensitivity` is **lower-case**
  (`low` / `medium` / `high`).
- **Rules:** a `conv_ai_trigger` must already exist on the workflow · **max 3** custom triggers ·
  Conversation AI must be enabled · gated on the flow-builder beta
  (`GET /ai-employees/beta/{loc}?feature=flow_builder` → `isAllowed`).
- **Runtime semantics, per the drawer:** the jump fires *after the main flow completes*, moving the
  contact to the alternate branch. Not executed here — treat as the vendor's claim.

⚠️ Adding a custom trigger through the **UI** has been seen to put the workflow into a state where
the builder's own full save 400s with `INVALID_TRIGGER_CONDITION`. The engine's plain workflow PUT
and `PUT /workflow/{loc}/only-triggers/{wid}` both still work. Cause not isolated.

## The nine Conversation-AI nodes

Field tables: `describe_step_type <key>`. What the tool will not tell you:

| | |
|---|---|
| **Terminal** | `conversationai_continue` and `conversationai_end` end their branch — nothing follows. An `end` inserted mid-flow is **silently dropped when the workflow saves**. Author them last. |
| **Containers** | `conversationai_book_appointment`, `conversationai_services_booking` (both `onBooked`/`onNotBooked`) and `conversationai_ai_splitter` (`branches[]` + `default`). |
| **Premium** | `conversationai_objective` carries a `stepIndex`. |
| **Labels ≠ keys** | `end`'s drawer says REACTIVATE AFTER BOT / (VALUE) / (UNIT); the keys are `sleepEnabled` / `sleepDuration` / `sleepUnit`. `continue`'s field is `instructions`, not `prompt`. Four wrong names have come from reading this surface's labels. |
| **Gated** | `conversationai_services_booking` needs a configured commerce service — its options endpoint returns `{"conversationai_services":[]}` on an account without one, and the builder then refuses to save the node. |

## What a flow may otherwise contain

A flow is an ordinary workflow **minus a denylist of 59 native action keys** — not a walled garden.
`wait`, `custom_webhook`, `custom_code`, `add_contact_tag`, `if_else`, `goto` and the opportunity
actions all work, and **third-party marketplace actions are permitted** (proven: a GoGHL
`send_outbound_whatsapp_message` persisted in a flow).

**All 7 native WhatsApp actions ARE blocked**, so a marketplace WhatsApp app is the only route to
WhatsApp from inside a flow. Full list and reasoning:
`knowledge/corpus/workflows/40-rules/flow-bot-action-compatibility.md`.

## Known unknowns

- **Runtime is unproven throughout.** No contact has chatted with a flow bot. Everything above is
  about what stores and what the builder renders.
- **Wait-on-wait.** A marketplace app's wait-for-reply step (GoGHL's `wait_step`) alongside a
  flow's own `waitForReply` — untested, and the first thing to check before shipping one.
- Flow workflows come back `status: "published"` on creation, engine-built or UI-built. The
  draft-first guarantee does not hold for `workflowType: "agent"`. Unexplained.
