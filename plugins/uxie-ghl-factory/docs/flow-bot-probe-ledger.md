# Flow-bot probe — EXECUTED vs OBSERVED ledger

Live-fire 2026-08-26 on the designated test sub-account (GROM Digital AU). Every write read back
on a separate request. Nothing deleted.

## G1 — the binding. The engine was shipping unbound flows.

**The differential.** Same account, same IR, same agent id. Only the compiler differs.

| build | authored | read-back `conditions` | bound? |
|---|---|---|---|
| installed engine (`97134393-…`) | `convTriggerBotId: "<agentA>"` | `[]` | **no** |
| GHL's own client (capture 2026-04-20) | — | `[{operator:"==", field:"botId", value:<agent>, title:"", type:"input"}]` | yes |
| fixed engine (`48578281-…`) | `convTriggerBotId: "<agentA>"` | `[{operator:"==", field:"botId", value:"<agentA>", title:"", type:"input"}]` | **yes** |

**What GHL does with `convTriggerBotId`:** discards it. It is absent from the read-back entirely —
not stored verbatim, not translated. It is real only as the builder URL's query parameter
(`?triggerType=conv_ai_trigger&convTriggerBotId=…`), never as a stored field.

**Blast radius.** Every flow workflow the engine has built since the key was added on 2026-07-15
has an unbound entry trigger. The account carries eight such workflows from 2026-07-26
(`ZZ TEST flow*`), all with `conditions: []`. Each build reported `verify.pass: 1` and zero
warnings — round-trip verification compared the engine's output to itself, and the field GHL
dropped was never in the comparison.

**Fixed** in `engine/compiler.mjs` (`buildTrigger`): emit the `botId` condition row; do not emit
`convTriggerBotId`; warn (`FLOW_BINDING:`) when a `conv_ai_trigger` has no `botId` condition, so an
unbound flow can no longer be built silently.

## G2 — mutability. The API enforces none of the UI's immutability.

Against the probe workflow only, one attempt each, read back separately.

| # | attempt | status | read-back | verdict |
|---|---|---|---|---|
| 1 | `PUT` trigger, different `botId` | 200 | botId changed | **allowed** — a flow can be rebound to another agent |
| 2 | `PUT` trigger, `type: contact_tag` | 200 | type changed, conditions wiped | **allowed** — an agent-type workflow whose entry is no longer a chat trigger |
| 3 | restore to `conv_ai_trigger` + botId | 200 | restored | probe left coherent |

Neither dangerous op was refused, warned about, or reverted.

**Not run, deliberately:**
- `DELETE` the trigger and `DELETE` the workflow. The project rule is that nothing is deleted, and
  these two rows can only be answered by actually destroying something. The workflow-delete answer
  is already recorded from a live 403 (`Workflows with type "agent" cannot be deleted`,
  2026-07-27) — though note that refusal covers DELETE only, and rows 1–2 show it does not
  generalise to modification.
- Add a second trigger to a flow; add a normal step to a flow. Lower information given rows 1–2
  established there is no enforcement at all. Worth doing before any authoring story for flows.

**Consequence.** G5 resolved in the "GHL allows it" branch: the engine cannot inherit a server-side
guarantee, so `planTriggerOps` now refuses `modifyTrigger` and `deleteTrigger` on a
`conv_ai_trigger`, naming the bound agent and the orphaning risk. Hatch: `ctx.allowFlowTriggerEdit`.

## G1 confirmed by GHL's own client

A real `FLOW_BUILDER_BOT` was created (`{agentId}`) and bound to the fixed probe
workflow, then the flow builder was opened. GHL's own UI:

- titles the surface **"Conversation AI"**, not Automation — it is the bot's canvas;
- renders the trigger node as `Bot Id is "{agentId}"` — **read straight out of the
  `conditions[].botId` row the fix emits**;
- offers the flow-bot-only **"Test bot"** control;
- **disables the Settings tab** (a flow workflow has no settings surface).

That is the binding validated end to end by the client that consumes it. What remains unproven is
only the runtime half — no contact was made to chat with the bot.

## Creation order: the workflow must exist FIRST

`POST /ai-employees/employees` with `botType: FLOW_BUILDER_BOT` **422s** without a non-empty
`objectiveBuilderWorkflowId`:

```
{"message":["objectiveBuilderWorkflowId must be a string",
            "objectiveBuilderWorkflowId should not be empty"],"statusCode":422}
```

So the API order is **flow workflow → agent pointing at it → set the trigger's botId to the new
agent**. The reference page implies the opposite (create the bot, then open its builder), which is
the UI's order, not the API's.

## G3 — `conversationai_services_booking`, closed, and a SECOND engine bug

The node's real definition comes from the marketplace asset (`sniffs/assets/actions.json`), the
schema the builder validates against. Both previously ⚑-flagged key names are **correct**:

| field | type | required | default |
|---|---|---|---|
| `conversationai_services` | multiselect | yes | — |
| `conversationai_booking_description` | textarea | yes | `Get customer to book a service` |

`conversationai_services` is independently confirmed live: `GET
/workflows-marketplace/actions/options/conversationai_services_booking` returns its list under
exactly that key (`{"conversationai_services":[]}` — empty on this account).

**The bug:** the asset gives this action **two branches** — `Appointment Booked` /
`Appointment Not Booked` — the same shape as `conversationai_book_appointment`. The engine had
`isMultipathContainer: false`, so authoring it would emit a plain node with no `cat:"multi-path"`,
no `transitions[]` and no branch children: it saves and cannot branch. A test even classified it as
a "fields-only" node.

Cause: a hand-curated entry in `gen-catalog.mjs` from a **2026-07-15 panel read** — carrying the
wrong key names (`services`/`description`) too — shadowed the rulebook, because the rulebook never
overwrites a behaviour field on an existing entry. Corrected at source and regenerated; the diff
touches exactly one type and exactly three fields (`isMultipathContainer`, `attrKeys`, `note`), with
zero types lost and zero demoted. `references/capabilities.md` regenerated with it.

Still **not commit-verified**: the test account has no configured commerce service, so the builder
refuses to save the node. That is a gated result, not a passing one.

## G4 — evidence, short of a capture

Every one of the nine `conversationai_*` actions lists **both** `conv_ai_trigger` **and**
`conv_ai_autonomous_trigger` in `requiredTriggers`. So the autonomous trigger is a first-class flow
entry sharing the same node palette. Its stored shape is still uncaptured.

## Flow workflows report `status: "published"`

Both probe workflows read back `published` although both were built draft-only, `build_workflow`
returned `published: false`, and `97134393` was never opened in a browser. The eight `ZZ TEST flow*`
workflows from 2026-07-26 are all `published` too, while the non-flow canaries on the same account
stayed `draft`. So a `workflowType:"agent"` workflow appears to be published by GHL on creation —
the engine's draft-first guarantee does not hold for this workflow type. Not yet explained; do not
assume a flow build is inert.

## Probe artifacts — left in place, for a human to remove

Identifiers are templated here because this repo is **public**. Find these by NAME in the UI; the
real ids are recorded in the private `knowledge/` probe record
(`corpus/workflows/70-research/2026-08-26-flow-bot-probe.md`) and in this session's report.

| what | id |
|---|---|
| workflow `CLAUDE PROBE flowbot-binding 2026-08-26 (G1 A/B, safe to delete)` | `{workflowId}` |
| workflow `CLAUDE PROBE flowbot-binding-FIXED 2026-08-26 (G1 proof, safe to delete)` | `{workflowId}` |
| AI agent `ZZ CLAUDE FLOW-BOT PROBE 2026-08-26` (FLOW_BUILDER_BOT, `mode: off`) | `{agentId}` |

The second workflow is the corrected artifact, bound to the probe agent above. The agent is
`mode: "off"` so it will not answer anything. Both workflows report `published` (see above) — that
was not requested and appears to be GHL's behaviour for agent-type workflows, so treat them as live
objects rather than inert drafts when removing them.
