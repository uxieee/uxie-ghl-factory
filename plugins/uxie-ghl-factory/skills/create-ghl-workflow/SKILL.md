---
name: create-ghl-workflow
description: Use when programmatically creating, building, or publishing a GoHighLevel / HighLevel workflow, or adding triggers/actions/steps to one, via the internal builder API — e.g. "create a GHL workflow", "add a webhook/email step via API", "build a HighLevel automation programmatically", or when a workflow step created via API saves but won't open in the builder. Write counterpart to get-ghl-workflow-json (read-only). Draft-first; publish is opt-in and gated on user confirmation.
---

# Create GHL Workflow (internal builder API + compiler engine)

Build HighLevel workflows by compiling a natural-language intent into an **IR**
(a nested tree of named nodes) and letting the engine emit + POST the exact
builder-API payloads. The public v2 API cannot create workflows; the builder
iframe uses these undocumented `backend.leadconnectorhq.com` routes.

**You describe intent as IR. The engine does everything else** — UUIDs, graph
wiring, casing, situational fields, dependency pre-creation, name→ID resolution,
build, and round-trip verify. You do NOT hand-write UUIDs, `parentKey`, field
soup, or raw API calls.

## The one rule that matters most

**ALWAYS build through `scripts/build.mjs` (→ the orchestrator).** Never
hand-assemble `create`/`auto-save`/`trigger` calls yourself. The orchestrator is
the only path that pre-creates dependencies and resolves names — skip it and you
get the classic failure: *a workflow that references tags/pipelines/calendars
that were never created, so it silently does nothing at runtime.*

```
node scripts/build.mjs <ir.json> <LOC> [--publish] [--ignore-unresolved]
```

It: resolves every human name → the account's real ID → **aborts loudly if an
account dependency is missing** → **auto-creates tags + inline email templates**
→ compiles → creates a DRAFT → auto-saves steps → creates triggers → round-trip
verifies → prints a report. Publish only with `--publish`, only after the user OKs.

(This rule is for CREATING a new workflow. To EDIT an existing one — add/delete/modify
steps — use `scripts/edit.mjs`, see "Editing an existing workflow" below.)

## Know what you can build — check before you say "can't"

The catalog is **complete**: 316 step types / 59 trigger types (the live-proven subset
is flagged ✅ in the index; `query-catalog.mjs` prints the current counts). If you're about to tell the user a step or trigger
"isn't supported", or about to fake a native action with a webhook/custom-code
workaround, **check the catalog first** — your recall of GHL's action list is
incomplete; the catalog is the truth:

```
node engine/query-catalog.mjs <term>    # e.g. "notification", "opportunity", "reply"
node engine/query-catalog.mjs           # coverage summary
```

Full scannable index (every type, with attribute keys and trigger filter fields):
`references/capabilities.md`. Marketplace-app steps (219 of the 316) build fine but
only RUN if the app is installed on the location. A catalog miss doesn't prove GHL
lacks the type — harvest a live example (`scripts/harvest-step.js`) and extend the
catalog rather than improvising a shape.

## Before any write

1. Run BOTH gates in `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md`
   (OWNED-ACCOUNT CHECK every session; TOS DISCLOSURE once per workspace).
2. Auth: `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`. `Authorization: Bearer`,
   **NOT** `token-id`. Save the captured `Authorization: Bearer …` line to the file
   `scripts/build.mjs` reads — set `GHL_TOK_FILE=<path>` (recommended) or drop it at
   the default `plugins/.playwright-mcp/tok.txt`. JWT ~1 hr; on 401 mid-run stop,
   re-capture, resume — never retry-loop.
3. **Draft-first.** Everything builds as `draft`. Publish is a separate, opt-in
   `--publish` run gated on explicit user confirmation.

## Authoring the IR

Write intent, using **human names** — the resolver turns them into IDs:

```yaml
name: "VIP nurture"
triggers:
  - { ref: t1, type: contact_tag, name: "VIP added",
      filters: [ { field: tagsAdded, value: "VIP" } ] }   # lean filter → engine expands
graph:
  - { ref: a, kind: action, type: add_contact_tag, name: "Tag welcomed",
      attributes: { tags: ["welcomed"] } }                # new tags auto-created
  - { ref: o, kind: action, type: create_opportunity, name: "Open deal",
      attributes: { name: "Deal", pipeline: "Sales", stage: "New Lead", status: open } }  # names → IDs
  - ref: b
    kind: if_else
    name: "High value?"
    branches:
      - { ref: y, name: "Yes", conditions: [ { conditionType: contact_detail, tag: high-value } ], then: [ ... ] }   # simple TAG intent — compiler normalizes the shape
      - { ref: n, name: "No", else: true, then: [ ... ] }
```

> **Trigger tag value = STRING; if/else tag value = ARRAY.** These are different schemas
> that share the `index-of-true` operator — do not copy one into the other. A trigger
> condition written as `value: ["VIP"]` saves, reads back `active: true`, and survives a
> draft→publish cycle, but GHL's tag-event dispatcher never subscribes, so the workflow
> silently NEVER FIRES. The compiler now unwraps a single-element array for
> `index-of-true`/`index-of-false` on trigger filters; author `value: "VIP"` anyway.
> One tag per filter row — a multi-tag array is rejected (`FILTER_VALUE`).
> This applies to every trigger tag row: `tagsAdded`, `tagsRemoved`, and `contact.tags`
> on `appointment` / `note_add` / `customer_reply` / `opportunity_decay` / `affiliate_*`.

**if_else condition authoring — write SIMPLE intent; the compiler normalizes the exact
GHL shape per type (a hand-crafted shape compiles clean but MATCHES WRONGLY at runtime):**

| Intent | Author as | Compiler emits |
|---|---|---|
| Has tag | `{ conditionType: contact_detail, tag: "vip" }` | `conditionSubType: tags` (plural), `conditionOperator: index-of-true`, `conditionValue: ["vip"]` (**array** — contrast the TRIGGER note below) |
| Does NOT have tag | `{ conditionType: contact_detail, tag: "vip", not: true }` | …`conditionOperator: index-of-false` |
| Opportunity in stage | `{ conditionType: opportunities, stage: "<id or name>" }` | `conditionSubType: pipelineStageId`, `conditionOperator: ==`, `conditionValue: "<stageId>"` (string; a name → id in resolve) |
| Custom field (text) | `{ conditionType: contact_detail, conditionSubType: "<fieldId>", conditionValue: "X" }` | `conditionOperator: contain`, value **lowercased** |
| Custom field (number/date) | …add `conditionOperator: "=="` | `conditionOperator: ==` (no lowercasing) |
| Trigger identity | `{ conditionType: trigger, conditionValue: "<triggerId>" }` | `conditionOperator: ==` |
| Appointment was rescheduled | `{ conditionType: appointment, conditionSubType: appointmentRescheduled, conditionOperator: is, conditionValue: "true" }` | as authored (`conditionValue` is the STRING `"true"`, not a boolean) |

**Reschedule detection — GHL has NO native "rescheduled" trigger or status.** The only way
to catch a reschedule is the two-part pattern: trigger on the `appointment` event with **no
status filter**, then gate with the `appointmentRescheduled` condition above. Verified live
2026-07-16. Don't hunt for a reschedule trigger — there isn't one.

Do NOT author `conditionSubType: tag` + `conditionOperator: contains` — that legacy shape
matches nothing and mis-routes tagged contacts to the None branch (the normalizer rewrites
it, but don't rely on that; use the `tag:` form).

⚠️ **Opportunity-stage: the type is PLURAL and the subType is camelCase** (live-confirmed
2026-07-16, workflow `08 Deposit Paid Handler`). `conditionType: opportunity` (singular) or
`conditionSubType: pipeline_stage_id` (snake_case) is a **silent** failure — it builds,
publishes and round-trips clean, but GHL can't map it back to a known field, so the branch
never evaluates and the builder shows a blank "Select" instead of the stage picker. The
compiler now canonicalizes the known aliases (`opportunity`, `opportunity_stage`,
`pipeline_stage_id`, lean-IR `field: pipeline_stage`) to `opportunities`/`pipelineStageId`,
and any remaining dead spelling hard-fails at compile with `COND_SHAPE` rather than being
saved. Don't lean on the aliases — author the `{ conditionType: opportunities, stage: … }`
form in the table above.

⚠️ **Opportunity-stage conditions need an ASSOCIATED opportunity** (runtime-proven 2026-07-15).
An `opportunities`/`pipelineStageId` if_else evaluates against the opportunity associated with
the *workflow run*, not "any opp the contact has". If the contact didn't enter via an
opportunity trigger (`opportunity_created`, `pipeline_stage_updated`, …) and the path never ran
`create_opportunity`/`find_opportunity`, the run has no associated opportunity and the condition
falls to None even when the stage id is correct — the same OPP_UNASSOCIATED rule the compiler
enforces for `update_opportunity`. Enter via an opp trigger (or create/find on the path) before
an opp-stage branch.

- **Node kinds:** `action` (any linear type), `wait`, `if_else` (N≥2 branches, one
  optional `else: true`), `split` (`workflow_split`, weighted/random), `ai_decision`
  (`workflow_ai_decision_maker`, Default + N branches), `goto` (must be last in its
  branch). Pre-set 2-branch finders (`find_contact`/`find_opportunity`/`lc_merge_contact`)
  use `onFound`/`onNotFound`.
- **Conversation-AI flow-builder containers** (for `FLOW_BUILDER_BOT` flows — see
  the `ghl-ai-agents-specialist` skill): `conversationai_book_appointment` uses scope
  keys `onBooked`/`onNotBooked`; `conversationai_ai_splitter` uses `branches: [{name, then}]`
  + an optional `default: [...]` "No condition met" tail. The other 7 `conversationai_*`
  nodes are linear `action`s. Bind the flow to its agent by putting `convTriggerBotId: <agentId>`
  on the `conv_ai_trigger`, and set top-level `workflowType: "agent"` on the IR.
- **Names the resolver understands** (CLOSED list — everything else must already be a
  real ID): `attributes.pipeline`/`stage` (opportunity steps), `attributes.user`
  (assign_user), `attributes.calendar` (appointment_booking ONLY), `attributes.assignedTo`
  (task), `attributes.agent`/`employee` (voice/ConvAI agent), and trigger filter values
  referencing pipeline/form/calendar/survey names.
- **⚠️ NOT resolved and NOT flagged — you must pre-resolve these to real IDs yourself
  (via the `ghl` MCP) before authoring, or the workflow builds clean and silently no-ops
  at runtime:** custom values (`{{custom_values.x}}` in bodies), payment products/prices,
  `add_to_workflow`/`remove_from_workflow` `workflow_id` (a SIBLING workflow — pass its id,
  NOT its name; the validator does not check it exists), `conversationai_book_appointment.calendarId`,
  `conversationai_transfer_bot.assignedEmployeeId`, `conversationai_objective.contactField`,
  and custom-field ids used in trigger filter conditions. The abort gate only covers the
  closed list above — these pass through untouched.
- **Inline emails:** put `attributes._template: { title, html, previewText }` on an
  `email` node — the orchestrator creates the template first and links it.
- **Trigger-less workflows:** `triggers: []` is legal — for workflows enrolled via
  `add_to_workflow` from another workflow. The build simply makes no trigger POSTs.
- **Attribute keys are validated** on verified-live types: an invented key (e.g.
  `message` instead of `body` on `sms`) fails compile with `ATTR_KEY` instead of
  saving a step that renders blank. Check the type's real keys with
  `node engine/query-catalog.mjs <type>`.

### The engine fails LOUD rather than silently dropping intent

A build that reports success while doing nothing at runtime is the worst failure this tool
has — an operator only finds out when a real customer gets spammed or a lead sits in the
wrong stage. Every guard below exists because that happened on a live account (2026-07-16):

| Code | Fires when | The silent failure it replaces |
|---|---|---|
| `NODE_KEY` | An unknown node-level key, or a scope (`onFound`/`onEvent`/…) on a type with no container handler for it | The whole subtree was discarded; the build reported a clean round-trip for a fraction of the IR |
| `NODE_DROPPED` | An authored node never reached the built payload (engine backstop) | As above — the authored-vs-compiled proof that round-trip verification never gave |
| `EMPTY_STEP` | A `wait` with no/partial duration, or an `update_opportunity` with nothing to update | `startAfter: {}` (the wait **did not pause** — 4 messages in 6 seconds) and `__customInputFields__: []` (a stage move that never moved) |
| `COND_SHAPE` | A dead opportunity-stage condition spelling | A branch that publishes clean and never evaluates |
| `ATTR_KEY` | An invented attribute key on a verified-live type | A step that saves and renders blank |
| `OPP_UNASSOCIATED` | `update_opportunity` with no proven opportunity on its path | A stage move that no-ops at runtime |

**`kind:` is an accepted alias for `type:` on the finder containers** (`find_opportunity`,
`find_contact`, `lc_merge_contact`) — both spellings keep their `onFound`/`onNotFound`
subtree. Previously `kind: 'find_opportunity'` (no `type:`) silently dropped the entire
subtree: a 51-step IR built 8 steps and reported "round-trip: 8 clean".

**Read `authored → compiled`, not `steps`.** The build report carries `authored` (nodes you
wrote), `compiled` (templates sent) and `steps` (templates GHL returned). `compiled >=
authored` is normal — containers add transition/None steps. A round-trip is only meaningful
next to `authored`; on its own it merely proves the server echoed what was sent.
- **Coverage:** 316 step types / 59 trigger types are catalogued (the live-proven
  subset is flagged ✅). Full index: `references/capabilities.md`; per-type lookup:
  `node engine/query-catalog.mjs <term>`; live counts: `node engine/query-catalog.mjs`.

## Editing an existing workflow (not a fresh create)

`scripts/build.mjs` is CREATE-only. To ADD/insert/delete/modify/move steps or branches
on a workflow that already exists, use the edit CLI:

```
node scripts/edit.mjs <LOC> <WID> <edit-spec.json> [--assume-associated] [--dry-run]
```

It GETs the live workflow, applies the ops to `workflowData.templates`, and commits via
the **plain `PUT /workflow/{loc}/{wid}`** (NOT `/auto-save` — that 422s on an existing
workflow). `--dry-run` computes + prints the diff without sending the PUT. The edit-spec is
`{ "ops": [ … ] }` applied in order; ops: `appendStep`, `insertAfter`, `appendToBranch`
(each takes a `step: {type,name,attributes}` compiled from IR — a linear step **or a
container**, see "Adding containers" below), `deleteStep`,
`modifyStep` (`attrPatch`), `moveStep`, `addBranch` (`{containerId,name,conditions}`),
`deleteContainer`, `setStepDisabled` (`{stepId,disabled}`), and `disableStepsByType`
(`{type,disabled}`) — plus the trigger ops `addTrigger` / `modifyTrigger` / `deleteTrigger`
(see "Editing TRIGGERS" below). The disable operations use GHL's native top-level
`advanceCanvasMeta.isDisabled` flag, preserve the full step config, and commit only changed
step IDs in `modifiedSteps`. Example — add an SMS, delete a step, and natively pause all
internal notifications:

```json
{ "ops": [
  { "op": "insertAfter", "afterId": "abc", "step": { "type": "sms", "name": "Nudge", "attributes": { "body": "Still there?" } } },
  { "op": "deleteStep", "stepId": "xyz" },
  { "op": "disableStepsByType", "type": "internal_notification", "disabled": true }
] }
```

For a newly compiled workflow, put `disabled: true` directly on any IR step node. This
emits the same native flag; false/absent means enabled. See
`references/step-shapes.md#disabling-steps-native-pause` for the live-proven shape and
the ruled-out notification-recipient workarounds.

Adding an `internal_update_opportunity` this way triggers the `OPP_UNASSOCIATED` guard
(pass `--assume-associated` only if ALL the workflow's triggers are opportunity-based).
Pure core: `engine/edit-driver.mjs` + `engine/edit.mjs` (see their tests).

### Adding containers (multipath) to an existing workflow

`appendStep` / `insertAfter` / `appendToBranch` each accept a **container** — a
`find_opportunity` with `onFound`/`onNotFound`, an `if_else`, a `workflow_split`, a
multipath wait. The step compiles to a whole subgraph (entry + branch entries + their
children) via the same `compile()` that `build.mjs` runs, so an edit-inserted container is
structurally identical to a freshly built one (`engine/edit-multipath.test.mjs` asserts
that round-trip).

This is what lets **opportunity logic be added to an existing workflow**. Any opportunity
write needs a `find_opportunity` above it — otherwise it skips at runtime with *"Please use
Opportunity trigger/find opportunity action to get the opportunity"*. Before this, the only
way to get one was to build a new satellite workflow; that constraint shaped several live
accounts into 07b/07c/07d micro-workflow chains. It no longer applies.

```json
{ "ops": [
  { "op": "insertAfter", "afterId": "abc",
    "step": { "type": "find_opportunity", "name": "Find Opportunity",
              "find": { "filters": [{ "field": "pipeline_id", "value": "PIPE" }], "sorting": "latest" },
              "onFound": [], "onNotFound": [] },
    "attachTailTo": "predefined_Opportunity Found" }
] }
```

**`attachTailTo` is required** on `insertAfter` when a container lands mid-chain and has
more than one branch. A container is terminal in its scope, so the steps that followed the
anchor are **re-scoped onto one branch** — pointers only, nothing is copied. Name the
branch by display name (`"Opportunity Found"`), stable branch key
(`"predefined_Opportunity Found"` — survives a rename), or branch id. It is never guessed:
on `find_opportunity` the tail belongs on Found ~always, and "~always" is exactly the
default that silently reroutes live contacts in the exception case. It's unnecessary when
nothing follows the anchor, or when the container has a single branch.

A container is terminal in its scope, so `insertAfter <containerId>` and `appendStep` onto
a container tail are both refused — append to one of its **branches** instead.

**Live-proven 2026-07-17** on GROM AU (throwaway canaries, since deleted, account verified
clean). A linear `Head → Tail` workflow, then one `insertAfter` op splicing in a
`find_opportunity` with `attachTailTo: "predefined_Opportunity Found"`:

- commit `PUT 200`; GET back shows `Head → find_opportunity → [Found, Not Found]`, with the
  pre-existing Tail step **re-scoped onto Found** (same id, `parent` = the Found
  transition) and Not Found left null. No duplicate ids.
- **`PUT status:'published'` → 200, status `published`** — GHL's publish validator accepts
  the spliced graph, and the container survives it with both branches. (This is the gate
  that once rejected a duplicated-subtree graph with a misleading "Wait for reply doesn't
  reference the step".)
- **The builder renders it and the step editor OPENS** — all five nodes draw, both branch
  labels draw, and the `find_opportunity` editor shows its Pipeline resolved to the real
  account pipeline. (Not the `internal_notification` "saves but won't open" class.)
- **Round-trip proven against a live fresh build**: the same shape built by `build.mjs` in
  one pass, fetched back, is **content-identical** to the edit-produced one (ids
  normalised; only object key ORDER differs, a serialisation artifact GHL round-trips
  either way).

NOT yet proven: runtime execution down the Found branch (needs a real opportunity on the
pipeline to enroll). The structure, the validator, and the builder are proven; the runtime
path of the container's branches is not.

**Nested containers carry `parent` (live-settled 2026-07-17).** A container nested inside
another container's branch sets `parent` = its scope owner (the branch-entry / transition
id). This engine used to omit it on `if_else` only — the one container type of eight that
did — so engine-built nested `if_else` nodes lacked it while every UI-built one had it.
Harvested from UI-built workflows: 6/6 nested condition-nodes had `parent === scope owner`.
Fixed in v0.3.9 and live-proven (build → GHL persists `parent` → publish 200 → the builder
renders the nested `if_else` inside the Found branch with its own branches and a separate
"When none of the conditions are met" node). Pre-v0.3.9 engine-built workflows with a
nested `if_else` are missing the field; they appear to run, so this is a fidelity fix, not
a known runtime break — leave existing ones alone unless a runtime symptom points here.

### Editing TRIGGERS on an existing workflow

Triggers live in a **separate document** from `workflowData.templates`, with their own CRUD
endpoints — so trigger ops are partitioned out and applied *after* the step commit, never
through the templates diff. Never hand-roll a trigger POST; these ops reuse the same
corpus-traced `buildTrigger` the create path uses:

```json
{ "ops": [
  { "op": "addTrigger", "trigger": { "type": "contact_tag", "name": "Course purchased",
      "filters": [ { "field": "tagsAdded", "value": "course-purchased" } ] } },
  { "op": "modifyTrigger", "name": "VIP added", "trigger": { "filters": [ { "field": "tagsAdded", "value": "gold" } ] } },
  { "op": "deleteTrigger", "triggerId": "abc" }
] }
```

`deleteTrigger`/`modifyTrigger` take a `triggerId`, or a `name`/`type` matched against the
live trigger list — an ambiguous match is a hard error, never a silent pick. `modifyTrigger`
PUTs the full merged object (unspecified fields carry over from the live trigger).

> ⚠️ **For `contact_tag` / `pipeline_stage_updated`, prefer `deleteTrigger` + `addTrigger`
> over `modifyTrigger`.** The live trigger-bucket subscription is keyed to the trigger's
> server-side `_id`. `modifyTrigger` does an **in-place `PUT /workflow/{loc}/trigger/{tid}`
> that re-seats the same `id`/`_id`** (`engine/edit-driver.mjs` → `planTriggerOps`), and an
> in-place PUT is **never re-subscribed** — the trigger saves + reads back correct + shows
> active but produces **0 organic enrolments**. Delete + add-fresh mints a **new `_id`** that
> registers and fires. Verified live 2026-07-18 (both classes, API + UI). Full write-up +
> the cosmetic `eq`-vs-`==` operator caveat: `references/build-recipe.md` §3 ("The trigger
> `_id` registration trap"). This is a distinct mechanism from the 2026-07-16 inert-trigger
> value-shape bug — same symptom, different cause — so drive-test either way.

Two things the engine handles that a hand-rolled POST gets wrong:

- **The full envelope is load-bearing.** A lean body (just type/name/conditions) saves and
  returns a believable `200 {id}` but never attaches. `buildTrigger` always sends
  `status/workflowId/schedule_config/conditions/type/masterType/name/actions/active/`
  `triggersChanged/location_id/company_age`. Root `workflowId` is **camelCase**;
  `location_id`/`company_age`/`actions[].workflow_id` are **snake_case** — sending the root
  as `workflow_id` also 200s and also silently doesn't persist.
- **API-added triggers land `active: false`** regardless of what the POST body says. They
  only start firing after a `status: draft` → `published` PUT cycle. `scripts/edit.mjs`
  runs that cycle automatically **when the workflow is already published**, then reports
  `triggers active: N/M`. On a **draft** workflow it SKIPS activation and says so — a
  trigger edit must never publish a workflow as a side effect (publish stays opt-in). The
  trigger activates when the user publishes normally.
  > ⚠️ The activation decision is made ONCE, from the status BEFORE the cycle
  > (`shouldActivateTriggers`). Never re-derive it between the two legs: the draft leg
  > sets status to `draft`, so re-asking "is it published?" always answers no, the
  > published leg never fires, and the workflow is left **downgraded to draft with every
  > trigger switched off**. That bug shipped in v0.3.4 and was caught only by a live run
  > (unit tests passed — they planned from an already-published object). Fixed in v0.3.5;
  > `edit-triggers.test.mjs` carries the regression test.

**Tags are pre-created for you**, same as on the build path. `scripts/edit.mjs` collects
every tag name the ops reference (trigger filter values, `add`/`remove_contact_tag` steps,
`modifyStep` patches, `addBranch` tag conditions), diffs them against the account, and
creates the missing ones BEFORE the commit and before any trigger POST — aborting if a tag
create fails rather than referencing a tag that doesn't exist. It reports `created tags:`;
`--dry-run` prints `WOULD CREATE`. (GHL references tags by NAME and rejects unknown ones;
a tag trigger on a missing tag never fires.)

**Live-proven 2026-07-17** on GROM AU (throwaway canaries, since deleted, account verified
clean): `addTrigger` POST 200 → cycle → `2/2 active` on a published workflow;
`modifyTrigger` PUT 200 with the rename + new condition confirmed by GET (value a plain
string); `deleteTrigger` via a name matcher 200; `addTrigger` on a draft correctly SKIPPED
activation and left it a draft. **RUNTIME-proven**: tag write → `added_to_workflow` in
`/workflows/logs/v2` within 4s, i.e. an edit-added trigger genuinely subscribes. That last
check is the only one that counts — `active: true` plus a clean round-trip is NOT proof a
trigger fires (see the 2026-07-16 inert-trigger bug).

Trigger filter values obey the string/array split above — `value: "vip"`, never `["vip"]`.
`expandFilter` unwraps a single-element array on this path too, but author the string.

## Read the build report — every time

The orchestrator prints exactly what it did. Check it:
- `ABORTED: Missing account dependencies …` → a pipeline/calendar/user/form/agent
  you named doesn't exist. Tell the user; look it up or create it — see
  `references/discovery.md` for the MCP lookups/creates per dependency type — then
  rebuild (or `--ignore-unresolved` to force a build that points at nothing — rarely
  what you want).
- `created tags: …` / `created email templates: …` → dependencies it made for you.
- `round-trip: N clean` with `ISSUES: …` → a step's fields were dropped by the
  server (a shape problem) — investigate before calling it done.
- `triggers: { posted, failed }` → trigger POSTs are retried through the
  post-auto-save settle race ("Workflow not found" 400s); anything in `failed`
  after retries means the workflow has NO working trigger — fix before done.
- `UNRESOLVED (built anyway): …` → only appears with `--ignore-unresolved`.

## Critical gotchas (the engine handles these — don't re-introduce them)

- `Authorization: Bearer`, **NOT** `token-id`.
- Order is fixed: **deps → create → auto-save (steps) → trigger → publish.** Steps go
  through `/auto-save`, never the plain PUT.
- **Mirror, don't invent** step fields — the catalog carries verified-live shapes; the
  compiler injects `workflowsActionType:INTERNAL` / `stepIndex` only where the corpus
  shows them. Never add `cat`/`parent`/`sibling`/`nodeType` yourself.
- `if_else` container needs `attributes.conditionName` or the node renders "undefined"
  (compiler sets it). `goto` must be the last node in its branch.
- Trigger casing: root `workflowId` **camelCase**; `location_id`/`company_id` snake.
  The compiler's casing-lint enforces this.
- Filters: trigger conditions are `{field, operator, value, title, type}` (engine
  expands lean intent filters); `if_else` conditions author as SIMPLE intent
  (`{conditionType, tag}` / `{conditionType, stage}` / `{conditionType, conditionSubType,
  conditionValue}`) and the compiler's `normalizeCondition` emits the correct stored
  `{conditionType, conditionSubType, conditionOperator, conditionValue}` shape per type —
  see the condition-authoring table above. NEVER hand-craft the tag/stage shape.
- `DELETE /workflow/{loc}/{wid}` works (confirmed) — used for clean teardown of
  throwaway/failed builds.
- **Opportunity actions need an associated opportunity.** `update_opportunity` is a runtime no-op unless the contact entered via an opportunity trigger (`opportunity_created`, `opportunity_status_changed`, `opportunity_changed`, `pipeline_stage_updated`, `opportunity_decay` — and ALL triggers must be opp-based, a mixed set doesn't count), or the path already ran `create_opportunity`, or the step sits in a `find_opportunity` **Opportunity Found** branch. The engine hard-fails with `OPP_UNASSOCIATED` otherwise — build the find-or-create pattern (see `references/build-recipe.md` §6). `assocGuaranteed: true` on the node/branch is the escape hatch for shapes the checker can't prove (trigger-identity if/else, goto convergence).

## Red flags — STOP

- About to POST create/auto-save/trigger by hand → use `scripts/build.mjs`.
- Build report says `created tags: (none needed)` but your workflow uses new tags →
  something's wrong; the orchestrator should have created them.
- About to ignore an `ABORTED` / `UNRESOLVED` line → don't; that's a missing dependency.
- About to `--publish` without the user's explicit OK → stop.
- Got a 401 → JWT expired; re-capture and resume.
- About to add `update_opportunity` with no opp trigger, no prior `create_opportunity`, and outside a `find_opportunity` Found branch → the update will silently do nothing at runtime; build find-or-create first.
- Adding an opportunity step via EDIT-MODE → `editCommitBody` now throws `OPP_UNASSOCIATED` when the edit CREATES an unassociated `internal_update_opportunity`; pass `assumeAssociated: true` only after verifying ALL the workflow's triggers are opportunity-based. Still unchecked: moving an existing update out of a Found scope, deleting the `create_opportunity` it depends on, or raw template mutation that skips `editCommitBody` — verify those yourself.

## Resources

- `scripts/build.mjs` — **the entry point.** IR → verified draft, deps handled.
- `engine/` — IR parser, compiler, catalog, resolver, orchestrator (+ tests).
- `references/capabilities.md` — generated index of ALL 316 step / 59 trigger types
  with attribute keys and filter fields; `engine/query-catalog.mjs` searches it.
- `references/build-recipe.md` / `references/step-shapes.md` — endpoint/payload truth
  and the mirror-don't-invent doctrine (background; the engine already applies them).
- `references/discovery.md` — how to look up / create a missing account dependency
  (forms, custom fields, calendars, …) via the MCP after an `ABORTED` report.
- `scripts/edit.mjs` — edit-mode entry point (GET → apply ops → plain-PUT commit).
- `engine/edit.mjs` / `engine/edit-driver.mjs` (+ tests) — the edit ops + pure driver.
- `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`, `docs/write-rails.md` — auth + gates.
- Inspect/export an existing workflow → the `get-ghl-workflow-json` skill.
