# Workflow Logs — Capture Runbook

Read-only capture of a HighLevel workflow's runtime (execution logs, enrollment history, per-step
counts) from the builder's internal endpoints. Endpoints and schemas below were ground-truthed from a
live capture (2026-07-15); see the research doc `research/execution-logs-internal/` in the
ghl-workflow-api-docs project for the full sanitized reference.

## Auth — moved

JWT capture procedure, header format, token expiry, iframe-origin scoping:
see `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` (canonical). This skill performs READ-ONLY GET
requests. The ToS note in `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md` applies on first use.

> **Observed header note:** the live `logs/v2` call sent `version: 2021-04-15` (the workflow-config
> reads use `2021-07-28`). GET reads have been observed to tolerate either; use the canonical header
> set from the auth doc, and if a logs call unexpectedly 4xxs on the version pin, retry once with
> `version: 2021-04-15`.

## Preconditions

- User logged into GHL in a browser profile you can automate, with access to the target location/workflow.
- A project directory where `workflow-logs/` output can be saved.

## 1. Parse Target IDs

```
https://app.gohighlevel.com/location/{LOCATION_ID}/workflow/{WORKFLOW_ID}
```
Keep only the location ID and workflow ID.

## 2. Throttle Before Every Fetch

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/get-ghl-workflow-logs/scripts/throttle.py wait --state .ghl-workflow-logs-throttle.json
```
On `429`/`403`:
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/get-ghl-workflow-logs/scripts/throttle.py reject 429 --state .ghl-workflow-logs-throttle.json
```
Then stop; do not retry in the same turn.

## 3. Reaching the workflow in the browser

Deep links **hard-404** — GHL serves only `/` server-side; every workflow view is client-side routed.
Two reliable ways in (see the auth doc §2 for the JWT-capture navigation, which also gets you there):

- **SPA router (fastest):** after the app shell has loaded at `https://app.gohighlevel.com/`, run
  `browser_evaluate` with `window.SHELL_ROUTER.push('/v2/location/{LOC}/automation/workflow/{WID}')`.
  The URL changes client-side and the builder iframe loads without a 404.
- **Click-through:** open `/`, use the sub-account switcher, then the Automation nav → the workflow.

Opening the **Execution logs** tab fires `logs/v2` + `count-per-step`; the **Enrollment history** tab
fires `workflow-with-filter`. If the tab already fired the call, read it from the network log instead
of re-fetching.

## 4. Fetch From Browser Context

Same GET shape as the sibling skill — `browser_evaluate` a `fetch(URL, { method:"GET", headers: HEADERS })`
where `HEADERS` is the canonical set from `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` §1. Save the
parsed `body` on success; save the `{status, body}` wrapper on failure.

## 5. Endpoint Menu

Base: `https://backend.leadconnectorhq.com`

### 5.1 Execution logs — `logs.json`
```
GET /workflows/logs/v2
  ?locationId={LOC}
  &workflowId={WID}
  &limit=20                     # ask for pageSize+1 if you want a has-next-page signal (UI uses 11)
  &action=first                 # first | next | previous  (keyset pagination — see §6)
  &dateType=custom              # date-filter mode
  &fromDate={epochMs}           # inclusive; window start
  &toDate={epochMs}             # inclusive; window end
```
Optional narrowing filters (same endpoint):
`&contactId={id}` (this workflow, one contact) · `&executionId={execId}` (one execution/trace) ·
`&allWorkflowsForContactId={id}` (every workflow a contact touched) · `&actionType=` · `&eventType=`.

Returns a bare JSON **array**, newest first. Row shape (abridged; full sanitized example in the research doc):
```jsonc
{
  "_id","locationId","workflowId","contactId","contactName","contactEmail",
  "workflowStatusId",        // ULID — the enrollment instance; joins to 5.2
  "stepId","stepName",
  "type",                    // email | sms | wait_time | wait_finished | condition | internal_* | …
  "status",                  // enroll|step|waiting|success|failed|retry|skipped|wait_finished|finished
  "sequence",                // execution-order cursor
  "createdAt","timestamp",
  "nextExecutionAt",         // set on 'waiting' rows = when the wait resumes
  "recordId","recordType","recordPrimaryProperty",   // custom-object workflows only
  "meta": {
    "status",                // downstream API status — non-2xx here = SILENT FAILURE on a 'success' row
    "data": { /* full provider payload: messageId, conversationId, emailMessage.events{...}, body, … */ },
    "skippedFor": { "type" }, // dnd | time-window | appointment-wait | missing-data | active-already
    "removedFrom": { "type" },// contact_reply_stop_response | end_of_workflow | wait_step_window_in_past
    "waitMeta": { "isTimedOut" },
    "version","workflowTraceId","subTraceId","podName"
  },
  "metrics": { "actionExecutionTime", "segments": [ { "name","value" } ] }
}
```

### 5.2 Enrollment history — `enrollments.json`
```
GET /workflows/status/search/workflow-with-filter
  ?workflowId={WID}&locationId={LOC}&action=first&limit=20     # keyset pagination as §6
```
Returns `{ "statuses": [...], "count": N, "isLocationRateLimited": bool, "traceId" }`. Status row:
```jsonc
{
  "_id","id",                 // ULID = workflowStatusId (joins to 5.1)
  "contactId","workflowId","locationId",
  "enrollType",               // "workflow"
  "currentStepId","currentStepName","currentStepType",   // wait | internal_update_opportunity | …
  "status",                   // wait_time | finished | …
  "executeOn",                // next resume time — PAST value while still wait_time = STUCK
  "sequence","createdAt","updatedAt",
  "waitingFor",               // "contact_{contactId}"
  "taskRequest",              // the actual GCP Cloud Task path (queue + task id)
  "meta": {
    "addedSource": { "source","channel","triggerType","sourceName","id" },   // HOW the contact entered
    "extraMeta": { "attributionSource": {/* UTM/ad */}, "opportunityId","preHeader" },
    "workflowTraceId","podName"
  }
}
```

### 5.3 Per-step occupancy — `step-counts.json`
```
GET /workflows/status/search/count-per-step?workflowId={WID}&locationId={LOC}
```
Returns `[ { "total", "currentStepId" }, … ]`. Only steps with ≥1 waiting contact appear — a step
absent here has nobody parked at it (dead-branch candidate; confirm against logs before concluding).

## 6. Keyset pagination (logs/v2 and workflow-with-filter)

Pagination is **cursor-based, not offset**. The first page is `action=first`. To go forward, resend with
`action=next` plus the last row of the page you have:
```
&action=next
&referenceId={lastRow.id}
&referenceCreatedAt={lastRow.createdAt}
&referenceSequence={lastRow.sequence}
```
`action=previous` walks back the same way. Stop when a page returns fewer than `limit` rows, or once you
have enough to answer the user's question — busy workflows can have very long histories, so let the ask
bound the paging rather than pulling everything.

## 7. Date windows (logs/v2)

`dateType=custom` with `fromDate`/`toDate` as **epoch milliseconds**. Default to a sensible window for the
question (e.g. last 30–90 days) rather than all-time. `Date.now()` is fine to compute `toDate`; subtract
`N*86400000` for an N-day lookback.

## 8. Save Manifest

`manifest.json` next to the captures:
```json
{
  "sourceUrl": "https://app.gohighlevel.com/location/LOC/workflow/WID",
  "locationId": "LOC", "workflowId": "WID",
  "capturedAt": "YYYY-MM-DDTHH:mm:ssZ",
  "dateWindow": { "fromDate": 0, "toDate": 0 },
  "files": [
    {"purpose": "logs",        "path": "logs.json",        "status": 200, "pages": 1, "rows": 0},
    {"purpose": "enrollments", "path": "enrollments.json", "status": 200, "rows": 0},
    {"purpose": "stepCounts",  "path": "step-counts.json", "status": 200}
  ],
  "skipped": []
}
```
