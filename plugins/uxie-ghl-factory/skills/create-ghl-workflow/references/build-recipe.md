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
