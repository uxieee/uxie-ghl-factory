# Build recipe — GHL internal workflow API

Host: `https://backend.leadconnectorhq.com`
Iframe origin (write CORS/referer): `https://client-app-automation-workflows.leadconnectorhq.com`

## Headers (every request)

Auth header format, required headers, and write-CORS (`origin`/`referer`) details: see `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` (§1). One-line reminder: `Authorization: Bearer`, **NOT** `token-id`.

IDs: `LOC` location, `CID` company (read off an existing workflow), `UID` = JWT `authClassId` claim (see canonical auth doc §3), `WID` workflow id (from create), `UUID` = a fresh uuid you generate.

## 0. Validate token + read company id

`GET /workflow/{LOC}/list?type=workflow&limit=1` → 200. Each row has `companyId` → `CID`.

## 1. Create empty draft → returns `{ "id": WID }`

`POST /workflow/{LOC}`

```json
{ "name":"My Workflow","status":"draft","parentId":null,"updatedBy":"{UID}",
  "modifiedSteps":[],"deletedSteps":[],"createdSteps":[],"senderAddress":{},
  "stopOnResponse":false,"allowMultiple":false,"allowMultipleOpportunity":true,
  "autoMarkAsRead":false,"eventStartDate":"","timezone":"",
  "workflowData":{"templates":[]},"triggersChanged":false,"company_id":"{CID}" }
```

## 2. Auto-save with steps (NOT the plain PUT)

`PUT /workflow/{LOC}/{WID}/auto-save`

```json
{ "_id":"{WID}","id":"{WID}","locationId":"{LOC}","companyId":"{CID}",
  "name":"My Workflow","status":"draft","version":1,"dataVersion":7,"type":"workflow",
  "parentId":null,"permission":380,"permissionMeta":{"canRead":true,"canWrite":true},
  "creationSource":"builder","originType":"user","isTriggerBucketMigrated":true,
  "deleted":false,"timezone":"account","allowMultiple":false,"allowMultipleOpportunity":true,
  "removeContactFromLastStep":true,"stopOnResponse":false,"autoMarkAsRead":false,
  "scheduledPauseDates":[],"senderAddress":{},"eventStartDate":"","updatedBy":"{UID}",
  "triggersChanged":false,"isAutoSave":true,
  "autoSaveSession":{"workflowId":"{WID}","id":"{UUID}","userId":"{UID}","version":1},
  "createdSteps":["{STEP_ID}"],"modifiedSteps":[],"deletedSteps":[],
  "workflowData":{"templates":[ /* STEP(s) — mirror a harvested step, see step-shapes.md */ ]} }
```

To MODIFY an existing step later: GET the workflow, edit `workflowData.templates`, set `modifiedSteps:[stepId]` (leave `createdSteps:[]`), keep `isAutoSave`+`autoSaveSession`, PUT `/auto-save`.

## 3. Create trigger → returns `{ "id": TRIGGER_ID }`

`POST /workflow/{LOC}/trigger`

Form submission:
```json
{ "status":"draft","workflowId":"{WID}","schedule_config":{},
  "conditions":[{"operator":"is-any-of","field":"form.id","value":["{FORM_ID}"],"title":"Form is","type":"string"}],
  "type":"form_submission","masterType":"highlevel","name":"Form submitted",
  "actions":[{"workflow_id":"{WID}","type":"add_to_workflow"}],
  "active":true,"triggersChanged":true,"location_id":"{LOC}","company_id":"{CID}" }
```

Contact field-changed (fires when a custom field changes — e.g. a field-triggered follow-up workflow):
```json
{ "status":"draft","workflowId":"{WID}","schedule_config":{},
  "conditions":[{"field":"contact.{CUSTOM_FIELD_ID}","operator":"has-changed","value":null,"title":"Field changed","type":"text"}],
  "type":"contact_changed","masterType":"highlevel","name":"Field changed",
  "actions":[{"workflow_id":"{WID}","type":"add_to_workflow"}],
  "active":true,"triggersChanged":true,"location_id":"{LOC}","company_id":"{CID}" }
```

Casing trap: root `workflowId` is camelCase; `location_id`/`company_id`/`workflow_id` are snake_case. For other trigger/action `type` strings, harvest a real trigger (`GET /workflow/{LOC}/trigger?workflowId={someWid}`) or the catalog `GET /workflows-marketplace/location/{LOC}/assets?workflowTypes=default,contacts`.

### The trigger `_id` registration trap — build fresh, never PUT-in-place

> **A `contact_tag` / `pipeline_stage_updated` trigger that SAVES with correct config,
> is published + active, but produces 0 organic enrolments is a SUBSCRIPTION problem, not
> a config problem — and repairing it with an in-place PUT does NOT fix it.**
> Verified live 2026-07-18 across both trigger classes, via API and via the builder UI.

GHL's live trigger-bucket subscription is keyed to the trigger's server-side **`_id`**, not
to its config. When you build the trigger and then mutate it **in place** — an in-place
`PUT /workflow/{LOC}/trigger/{tid}`, or an unpublish→republish cycle — the trigger **reuses
the same `_id`** and is never (re)subscribed into the live bucket. The config reads back
correct and the workflow is active, but nothing is listening: real tag-adds / stage-moves
enrol nobody, indefinitely. On the *same* account, appointment / payment triggers built the
same way fire in ~1.5s (control), so it is not the account, the JWT, or the publish path.

Ruled out during the field trace: **not** the condition operator (that's the cosmetic caveat
below); **not** `isTriggerBucketMigrated` (that flag read `true` on both a dead trigger and a
live one — it does not discriminate).

**Fix — mint a NEW `_id`.** Delete the stale trigger (releasing its `_id`) and add a fresh
one so a new `_id` registers, then activate. Both paths mint a new `_id`:
- API: `DELETE /workflow/{LOC}/trigger/{tid}` then a fresh `POST /workflow/{LOC}/trigger`
  (per §3) — **not** an in-place PUT to the existing trigger id.
- UI: remove the trigger in the builder and re-add it.

> ⚠️ This makes the engine's `modifyTrigger` op suspect for `contact_tag` /
> `pipeline_stage_updated`: `engine/edit-driver.mjs` → `planTriggerOps` emits
> `modifyTrigger` as a `PUT /workflow/{loc}/trigger/{tid}` that **re-seats the same `id`/`_id`**
> (`body: { ...t, ...merged, id: tid, _id: t._id ?? tid }`). By this finding that PUT leaves
> the trigger inert on these two classes. Prefer **`deleteTrigger` + `addTrigger`** (a
> delete+add-fresh pair) to change a tag/stage trigger's filters, rather than `modifyTrigger`.
> Documented here rather than patched in the engine — confirm with a drive-test before
> changing the `modifyTrigger` code path.

**Cosmetic caveat (separate from the firing bug):** stage / `pipeline_stage_updated`
conditions use operator **`==`** in the builder. An engine that emits **`eq`** instead
renders the condition **blank** in the builder UI. This is a display defect only — an `eq`
condition is *not* why a trigger fails to fire; the `_id` subscription is. (The compiler's
`defaultOp` already returns `==` for number/date/select rows — see `engine/compiler.mjs`.)

**Config-correct is NOT proof of firing.** Only a real tag-add / stage-move that produces an
enrolment whose `addedSource.source == "trigger"` proves a trigger is live. Always drive-test
(see §4) before calling a trigger done.

## 4. Verify

`GET /workflow/{LOC}/{WID}?includeScheduledPauseInfo=true` and `GET /workflow/{LOC}/trigger?workflowId={WID}`. Confirm the step's key set matches the harvested template and the trigger condition persisted.

## 5. Publish (after explicit user confirmation)

GET the workflow, then on the returned object:
- set `status:"published"`
- delete `autoSaveSession`, `autoSaveSessionId`, `isAutoSave`
- delete server fields: `__v`, `filePath`, `fileUrl`, `triggersFilePath`, `createdAt`, `updatedAt`

`PUT /workflow/{LOC}/{WID}` (plain — no `/auto-save`) with the modified object. Re-GET to confirm `status:"published"`. To unpublish, same flow with `status:"draft"`.

Optimistic locking: the `version` field increments on each write; a stale version can 409. Always start from a fresh GET before the publish PUT.

## 6. Opportunity actions — the find-or-create dependency

`internal_update_opportunity` only acts on the opportunity **associated in the workflow
context**. Association comes from exactly three sources: an opportunity-based trigger
(all 5: `opportunity_created`, `opportunity_status_changed`, `opportunity_changed`,
`pipeline_stage_updated`, `opportunity_decay` — and every trigger on the workflow must
be one of them), a prior `create_opportunity` on the same path, or the **Opportunity
Found** branch of `find_opportunity`. The engine rejects anything else with
`IRError OPP_UNASSOCIATED`.

Canonical IR pattern (non-opp trigger → find, update in Found, create in Not Found,
converge with a goto):

```json
{ "ref": "find1", "kind": "action", "type": "find_opportunity", "name": "Find Opp",
  "find": { "filters": [{ "field": "pipeline_id", "value": "PIPELINE_ID" }], "sorting": "latest" },
  "onFound": [
    { "ref": "upd1", "kind": "action", "type": "update_opportunity", "name": "Move stage",
      "attributes": { "allowBackward": true,
                      "updates": [{ "field": "pipelineStageId", "value": "STAGE_ID" }] } }
  ],
  "onNotFound": [
    { "ref": "crt1", "kind": "action", "type": "create_opportunity", "name": "Create Opp",
      "attributes": { "pipelineId": "PIPELINE_ID", "stageId": "STAGE_ID", "name": "{{contact.name}}" } },
    { "ref": "g1", "kind": "goto", "target": "next_shared_step" }
  ] }
```

> **The find filter field is `pipeline_id` — snake_case.** `pipelineId` (camelCase) looks
> right, matches every other id field in this API, and **422s at runtime** with
> `Invalid field - pipelineId`. This one is snake. Ground truth: live workflow blobs.
> (The *update* side is the opposite — `updates[].field` is `pipelineStageId`, camelCase.
> The two casings genuinely differ; do not "fix" either to match the other.)

Notes:
- `update_opportunity` accepts EITHER an explicit `updates: [{field,value}]` (full control)
  or the name path `attributes: { "pipeline": "...", "stage": "...", "status": "open" }`,
  which the resolver turns into ids. Both compile to the same `__customInputFields__`.
  A step with neither is rejected (`IRError EMPTY_STEP`) rather than emitted empty.
- The state is **lexical per scope** (v1): a `goto` out of Not Found onto a shared
  downstream `update_opportunity` is NOT proven across the jump — either keep the
  update inside `onFound` (and let Not Found create at the right stage directly, as
  above), or mark the shared step `"assocGuaranteed": true`.
- Mixed triggers (e.g. `opportunity_created` + `contact_tag`): branch on trigger
  identity with `if_else`; the tag path still needs find-or-create; mark the
  opp-trigger path's branch `"assocGuaranteed": true`.
- `assocGuaranteed` is IR-only; the compiler never emits it to GHL.

### `allowBackward` — the silent [skipped] trap

> **Any stage move that can run BACKWARD needs `allowBackward: true`, or it silently does
> nothing.** The compiler defaults it to `false`. With `false`, GHL logs a backward move as
> **`[skipped]`** — not an error, not a warning — and the opportunity never moves. The build
> succeeds, the publish succeeds, the round-trip is clean, and the step is dead.
> Verified live 2026-07-16: `Stage -> Deposit Paid [skipped]` with the default; the identical
> step reported `[success]` and moved the opp once `allowBackward: true` was set.

"Backward" means *earlier in the pipeline's stage order than the opportunity's current
stage* — a fact about the CONTACT at runtime, not about the IR, which is why the engine
cannot detect it for you and why this is documentation rather than a compile error.

Set `allowBackward: true` whenever the target stage could be behind where the opp already
is. In practice that is most **event-driven** moves, e.g.:
- a cancellation / refund / no-show returning a deal to an earlier stage
  (*Booked → Deposit Paid*, *Booked → Deposit Pending*),
- a re-qualification or win-back flow,
- any move whose trigger can fire after the opp has already advanced.

Leave it `false` only for the deliberate **monotonic stage-sync** pattern: a workflow that
should only ever move a deal FORWARD (marking *Engaged* or *Details Sent* from
message/activity triggers, where events arrive out of order or re-fire). There `false` is
the "don't regress the pipeline" guard and the no-op is the intent.

If a stage move is not firing at runtime, check `allowBackward` FIRST — before the
condition, the trigger, or the association. This is the most common cause, and previously
generated workflows may carry the `false` default on regression moves that need `true`.

## 7. GHL workflows are TREES, not DAGs — branches never re-converge

**This is the single biggest architectural constraint of the platform, and it is not
documented by GHL anywhere.** A workflow is a strict tree: every step has exactly ONE
parent. Two branches can never merge back into a shared downstream step.

Evidence: across every working published workflow in a mature real account there are
**ZERO multi-parent nodes**. GHL's own builder obeys this — it *triplicates* a shared
reminder tail across three reply-branches rather than merging them.

Consequences for IR authors:

- **Every branch owns its continuation.** If three branches all end in "wait 1 day → SMS
  → tag", that tail is written three times, once per branch. There is no merge node.
- **This is why the engine duplicates subtrees.** That behaviour is CORRECT — it is the
  tree constraint surfacing, not a bug. Do not try to defeat it.
- **`goto` is the only convergence primitive**, and it is a jump, not a merge: it re-enters
  a target node rather than joining paths. It is also why the opportunity-association
  checker is lexical per scope — it cannot prove state across a jump.
- **Duplication has a real ceiling.** Unbounded tail duplication has bloated a workflow to
  the point where GHL's own publish validator REJECTED it (a 131-template workflow that
  only published after a UI re-save normalized it to 71). If a build is heading past ~100
  templates, restructure — split into multiple workflows chained with `add_to_workflow`,
  or move the shared tail into its own workflow — rather than duplicating further.

Design the shape as a tree from the start. An IR authored as a DAG (a diamond that
re-joins) cannot be built as drawn; it will either duplicate or need a `goto`.

### Verifying a built step — GET, not the editor panel

Via **browser automation** the builder's editor panel is unreliable to open for ANY
node type — correct steps included — so a panel that won't open under automation
proves nothing (observed live 2026-07-13). Verify programmatically: the orchestrator's
round-trip verify (sent-vs-GET diff) is the correctness signal, plus the node's
type/icon on the canvas. Only a human manually clicking the node is a valid panel test.
