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
  "find": { "filters": [{ "field": "pipelineId", "value": "PIPELINE_ID" }], "sorting": "latest" },
  "onFound": [
    { "ref": "upd1", "kind": "action", "type": "update_opportunity", "name": "Move stage",
      "attributes": { "updates": [{ "field": "pipelineStageId", "value": "STAGE_ID" }] } }
  ],
  "onNotFound": [
    { "ref": "crt1", "kind": "action", "type": "create_opportunity", "name": "Create Opp",
      "attributes": { "pipelineId": "PIPELINE_ID", "stageId": "STAGE_ID", "name": "{{contact.name}}" } },
    { "ref": "g1", "kind": "goto", "target": "next_shared_step" }
  ] }
```

Notes:
- The state is **lexical per scope** (v1): a `goto` out of Not Found onto a shared
  downstream `update_opportunity` is NOT proven across the jump — either keep the
  update inside `onFound` (and let Not Found create at the right stage directly, as
  above), or mark the shared step `"assocGuaranteed": true`.
- Mixed triggers (e.g. `opportunity_created` + `contact_tag`): branch on trigger
  identity with `if_else`; the tag path still needs find-or-create; mark the
  opp-trigger path's branch `"assocGuaranteed": true`.
- `assocGuaranteed` is IR-only; the compiler never emits it to GHL.

### The monotonic stage-move pattern (`allowBackward: false`)

`update_opportunity` takes `allowBackward` (the compiler defaults it to `false`).
With `false`, a pipeline-stage update only ever moves the opportunity FORWARD —
if the opportunity is already at or past the target stage, the update is a no-op
instead of a regression. This is the "don't regress the pipeline" guard for
stage-sync workflows (e.g. marking *Engaged* or *Details Sent* from message/activity
triggers, where events can arrive out of order or re-fire): every sync workflow can
safely set its stage without checking the current one. Set `allowBackward: true`
only when a workflow is explicitly supposed to move a deal backwards (e.g. a
re-qualification flow).

### Verifying a built step — GET, not the editor panel

Via **browser automation** the builder's editor panel is unreliable to open for ANY
node type — correct steps included — so a panel that won't open under automation
proves nothing (observed live 2026-07-13). Verify programmatically: the orchestrator's
round-trip verify (sent-vs-GET diff) is the correctness signal, plus the node's
type/icon on the canvas. Only a human manually clicking the node is a valid panel test.
