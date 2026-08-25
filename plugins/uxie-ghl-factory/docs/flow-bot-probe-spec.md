# Spec — probing the Flow-Based Builder (`FLOW_BUILDER_BOT`)

Status: **executed 2026-08-26** — results in `flow-bot-probe-ledger.md`.
G1 ✅ answered and fixed · G2 ✅ answered (API enforces nothing) · G5 ✅ resolved (guard shipped) ·
G6 ✅ fixed (28 pointers) · G3 ⬜ open · G4 ⬜ open.

> **Correction to this spec's own framing.** It claimed "two gaps are our own artifacts
> disagreeing with each other" — `conv_ai_trigger` reading `verified-live` in
> `catalog.data.json` and `source-derived` in `type-cards.json`. That is NOT a contradiction:
> the two files use disjoint vocabularies and measure different things (how the TYPE's schema was
> learned vs how the CORPUS PAGE was authored). The planned agreement-checker would have failed on
> 283 rows and taught nothing; `plugin/scripts/check-example-pointers.mjs` enforces the invariant
> that is real instead.

A flow bot's logic **is a workflow** — one whose entry trigger is owned by the agent rather than by
the workflow. That ownership is why this surface behaves differently from every other workflow, and
it is the least-proven part of what we hold.

> **Revised after reading the artifacts.** The first draft of this spec said `conv_ai_trigger`'s
> stored shape had never been captured. That was wrong — it was captured live on 2026-04-20 and is
> sitting in `knowledge/catalog/trigger-examples/conv_ai_trigger.json`. Reading it turned the whole
> exercise around: the capture **contradicts what our compiler emits**. That contradiction is now
> G1 and it is the point of the probe.

---

## 0. What is already established — do not re-prove this

From `ghl-conversation-ai/references/conversation-ai.md` (captured 2026-07-14/15, corrected
2026-07-27) and the catalogue:

- **Eight of the nine `conversationai_*` nodes** are ✅verified-live with field sets, required
  fields and multi-path shapes: `_objective`, `_ai_message`, `_custom_message`, `_book_appointment`,
  `_ai_splitter`, `_end`, `_continue`, `_transfer_bot`.
- **The agent half of the binding**: the agent carries `botType: FLOW_BUILDER_BOT`,
  `isObjectiveBuilderEnabled: true`, `objectiveBuilderWorkflowId: {WID}`.
- **The builder URL**: `/automation/workflow/{WID}?triggerType=conv_ai_trigger&convTriggerBotId={AGENT_ID}`.
- **The required-field trap.** Omit `waitForReply`, `objective`, `message`, `description`,
  `calendarId`, `assignedEmployeeId` or `sleepEnabled` and the node renders with a red error badge
  and the flow cannot publish — **while a build pipeline still reports success**.
- **Three key names were wrong until 2026-07-27.** `conversationai_end` was documented as
  `customMessage`/`reactivate`/`duration` — all three wrong; authoring `reactivate` persisted as an
  unknown key while the actually-required `sleepEnabled` stayed unset. `transfer_bot.prompt` and
  `continue.prompt` were panel reads that never persisted.

**And the stored trigger shape is captured** — `knowledge/catalog/trigger-examples/conv_ai_trigger.json`,
2026-04-20, produced by GHL's own client:

```json
{
  "type": "conv_ai_trigger",  "masterType": "highlevel",  "name": "Chat Initiated",
  "belongs_to": "workflow",   "active": true,
  "conditions": [{ "operator": "==", "field": "botId", "value": "<AGENT_ID>", "title": "", "type": "input" }],
  "actions":    [{ "workflow_id": "<WID>", "type": "add_to_workflow" }]
}
```

Note what is **absent**: there is no `convTriggerBotId` key anywhere on the document.

---

## 1. What is NOT established

### G1 — the engine's flow-bot binding contradicts GHL's own capture 🔴

This is the finding that justifies the probe.

| | binds the bot by | carries `convTriggerBotId`? |
|---|---|---|
| **GHL's client** (live capture, 2026-04-20) | `conditions[]` → `{field:"botId", operator:"==", value:AGENT_ID, type:"input"}` | **no** |
| **our compiler** (`engine/compiler.mjs:1467`) | nothing — it emits no `botId` condition | **yes**, as a top-level key |

`convTriggerBotId` is real, but the only place it is *observed* is the **builder's URL query
string**. Putting it on the stored document looks like a URL read that was never verified to
persist — the same class of mistake as `reactivate`, `transfer_bot.prompt` and `continue.prompt`,
all three of which were corrected on this exact surface.

It is **pinned green** by `engine/convai-nodes.test.mjs:139`, which asserts the compiler emits
`convTriggerBotId`. That test proves the compiler does what it was told. It cannot prove GHL binds
the bot — no test can, because GHL stores unrecognised keys verbatim and returns 200.

Three outcomes are possible and only a live read-back separates them:

1. **GHL translates** `convTriggerBotId` into a `botId` condition server-side → engine is fine, and
   we document the translation.
2. **GHL stores it verbatim and ignores it** → every flow workflow the engine has ever built has an
   **unbound** trigger, and the test is pinning a wrong contract.
3. **Both forms work** → prefer GHL's own, and say why.

Outcome 2 is the one that matters: a build reports success, and the bot never fires.

### G2 — the trigger's mutability is unproven

Xander's account of the UI: *the trigger is specific to the bot, cannot be modified in any shape or
form, and the workflow cannot be deleted because it is tied to the bot.* None of that has been
tested **through the API**, where the UI's affordances do not apply.

A pipeline that can silently rebind or drop an agent's entry trigger can orphan a live bot — the
agent keeps its `objectiveBuilderWorkflowId` while the workflow no longer answers to it.

### G3 — `conversationai_services_booking` has no type card

The ninth node. `describe_step_type` returns nothing for it, so the tool that exists specifically to
stop an author guessing has nothing to give — for the one node whose key names are flagged ⚑.

### G4 — `conv_ai_autonomous_trigger` is bundle-derived and unexplained

Summarised as *"fires from an autonomous conversation AI bot action — treated as a 'goto' jump
trigger"* — a different execution model from `conv_ai_trigger`. Never captured, never built.

### G5 — edit mode does not know an agent workflow is special

`engine/edit.mjs` and `engine/edit-driver.mjs` contain **zero** references to `workflowType`.
`edit_workflow` treats a flow-bot workflow like any other. Whether that is a defect depends
entirely on G2.

### G6 — 28 shipped catalogue entries point at example files that are not there

`engine/catalog.data.json` cites `example:` paths for 94 types. **28 do not resolve** — every one of
them a `catalog/trigger-examples/*.json`. The files exist, but in `knowledge/`, and the paths are
relative to the generator's root rather than to the skill directory they ship in.

**They cannot simply be copied in.** The capture above contains a real `location_id`, a real
`botId` and real workflow ids. `knowledge/` has no remote; the plugin is public, and this project
has leaked client identifiers four times, once a bare `locationId`. So G6's fix is a scrub-and-ship
or a drop-the-pointer decision, never a `cp`.

---

## 2. The delete-and-recreate concern

**The engine does not delete and recreate.** No delete-then-create path exists in `engine/`; the
edit rail is GET → apply ops → plain-PUT commit.

**GHL refuses it server-side**, captured live 2026-07-27, already in `core/errors.mjs`:

```
403 {"error":true,"msg":"Workflows with type \"agent\" cannot be deleted"}
```

**But that capture was incidental** — it came out of a 401-vs-403 investigation, and it proves only
that DELETE is refused. It says nothing about rebinding or dropping the trigger, which is the
operation that would actually orphan a bot. G2 stays open.

---

## 3. The probe

Read-only work first; every write lands on a throwaway this probe creates.

### Phase 0 — a throwaway flow bot, built in the UI

Create a `FLOW_BUILDER_BOT` through the GHL UI on the test sub-account, named
`ZZ CLAUDE FLOW-BOT PROBE <date>`, with one node of each kind the palette offers.

Built in the UI deliberately: the point is to capture what **GHL's own client** produces. Building
it with our engine first would prove our own output back to us — which is how G1 happened.

### Phase 1 — read everything, change nothing

| read | answers |
|---|---|
| `export_workflow` on the flow's WID | the whole stored document, `workflowType` included |
| `GET /workflow/{loc}/trigger?workflowId=` | re-confirms the 2026-04-20 shape on a second account |
| the agent record on `/ai-employees` | the agent half of the binding |
| `describe_step_type` × 9 | which cards are missing or wrong against the live document |

**G3 closes here**, and G1's *expected* side is confirmed, with zero writes.

### Phase 2 — the binding differential (decides G1)

Build a flow workflow **with our own engine** on the test account, then read the trigger back on a
separate request and look for exactly one thing: **is `conditions[]` carrying a `botId` entry?**

| read-back shows | verdict |
|---|---|
| a `botId` condition present | GHL translates — engine fine, document it |
| `convTriggerBotId` stored, no `botId` condition | **engine emits an unbound trigger** — compiler fix + the pinned test is wrong |
| neither | the trigger is not bound by either form; escalate |

Then the confirming half: does the bot actually answer? Trigger a chat against the throwaway agent
and read `get_trigger_logs` for a qualified enrolment. **A stored shape that never fires is not a
binding** — this project has been caught by 200-means-nothing before.

### Phase 3 — the mutability differential (decides G2 and G5)

Against the throwaway only, one attempt each, read back separately. **A refusal is the finding** —
record its exact status and body, do not retry.

| # | attempt | what it settles |
|---|---|---|
| 1 | `PUT` the trigger `active: false` | can a flow's entry be deactivated |
| 2 | `PUT` a different bot id (whichever form G1 proves) | can a flow be rebound to another agent |
| 3 | `PUT` the trigger's `type` away from `conv_ai_trigger` | can the entry be retyped |
| 4 | `DELETE` the trigger | can the entry be removed, orphaning the agent |
| 5 | add a SECOND trigger to the flow workflow | can a flow be entered by anything but its bot |
| 6 | `DELETE` the workflow | does the recorded 403 hold **for this case** |
| 7 | `edit_workflow` adding a normal step (`send_sms`) | does the flow accept non-flow steps |

### Phase 4 — the autonomous variant (G4)

If the account offers an autonomous bot, repeat Phase 0–1 and capture
`conv_ai_autonomous_trigger`. If it does not, record it as gated and stop — do not infer its shape
from the non-autonomous one.

---

## 4. Safety

- **Test sub-account only.** Never a client, never an existing bot. Every write in Phases 2–3 lands
  on the throwaway from Phase 0.
- **Both write gates** (`docs/write-rails.md`) before the first write.
- **One attempt per row.** A refusal is data; retrying it is noise.
- **Nothing is deleted.** The probe bot and its workflow are left in place, named, and reported for
  a human to remove — including if row 6 succeeds, which must be said loudly because it contradicts
  a recorded 403.
- **Read back on a separate request.** Accepted is not applied.
- **No real identifier leaves `knowledge/`.** Every id is templated before anything lands in
  `plugin/` or the corpus.

## 5. What it produces

1. A corpus page — `ai-agents/20-api/flow-builder-bot.md`: the binding as proven, and every Phase-3
   attempt with status and read-back result.
2. A type card for `conversationai_services_booking`, plus corrections to any of the nine whose live
   shape differs.
3. **A compiler decision on G1**, and if the binding is wrong, the corrected emit plus a rewritten
   `convai-nodes.test.mjs` assertion that pins GHL's form rather than ours.
4. An engine decision on G5, driven by Phase 3.
5. A resolution for G6's 28 dangling pointers that does not ship a real account id.

## 6. What would make this probe wrong

- **A single capture pins one value of every discriminator.** One flow bot proves one
  configuration; a node captured with `waitForReply: true` says nothing about `false`.
- **The 2026-04-20 capture is one account on one date.** Phase 1 re-confirms it rather than
  assuming it still holds.
- **A node absent from this account's palette is gated, not non-existent.**
- **A refusal here is strong evidence, an acceptance is weak.** The probe runs as agency admin — the
  most permissive role — so a refusal generalises down and an acceptance does not generalise across.
