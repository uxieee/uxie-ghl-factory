# Capture Runbook

Use this runbook to capture workflow JSON from HighLevel's workflow builder internals.

## Auth — moved

Auth capture procedure (browser navigation to the iframe origin, scoped JWT
extraction, header format, UID/CID derivation, token expiry and re-auth):
see `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` (the canonical auth
doc) — that doc's §2 covers capture end-to-end and §1 covers the exact
header set. This skill performs READ-ONLY GET requests; the ToS note in
`${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md` applies on first use.

## Preconditions

- The user is logged into GHL in a browser profile you can automate.
- The user has access to the target location and workflow.
- Work in a project directory where `workflow-json/` output can be saved.

## 1. Parse Target IDs

From a workflow URL:

```text
https://app.gohighlevel.com/location/{LOCATION_ID}/workflow/{WORKFLOW_ID}
```

If the URL includes query params or extra path segments, keep only the location ID and workflow ID.

## 2. Throttle Before Every Fetch

Run this before each backend fetch:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/get-ghl-workflow-json/scripts/throttle.py wait --state .ghl-workflow-json-throttle.json
```

If a response returns `429` or `403`, immediately run:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/get-ghl-workflow-json/scripts/throttle.py reject 429 --state .ghl-workflow-json-throttle.json
```

Replace `429` with the actual status. Stop after this; do not retry in the same turn.

## 3. Fetch From Browser Context

Use this browser-evaluate shape, substituting `URL` and the request headers
documented in `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` §1:

```javascript
async () => {
  const res = await fetch(URL, {
    method: "GET",
    headers: HEADERS // see ${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md §1
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    status: res.status,
    ok: res.ok,
    url: res.url,
    body
  };
}
```

Save `body` as the raw endpoint JSON when `ok` is true. Save the wrapper only for failed responses so the status and error body are preserved.

## 4. Endpoint Menu

Base URL:

```text
https://backend.leadconnectorhq.com
```

Fetch these by default:

| File | Endpoint |
|---|---|
| `workflow.json` | `/workflow/{LOCATION_ID}/{WORKFLOW_ID}?includeScheduledPauseInfo=true` |
| `trigger.json` | `/workflow/{LOCATION_ID}/trigger?workflowId={WORKFLOW_ID}` |

Fetch these when requested or useful:

| File | Endpoint |
|---|---|
| `sticky-notes.json` | `/workflows/sticky-notes-all?workflowId={WORKFLOW_ID}&locationId={LOCATION_ID}` |
| `step-counts.json` | `/workflows/status/search/count-per-step?workflowId={WORKFLOW_ID}&locationId={LOCATION_ID}` |
| `trigger-catalog.json` | `/marketplace/core/search/module?locationId={LOCATION_ID}&type=triggers&isInstalled=true&skip=0&limit=200` |
| `action-catalog.json` | `/marketplace/core/search/module?locationId={LOCATION_ID}&type=actions&isInstalled=true&skip=0&limit=200` |
| `pipelines.json` | `/opportunities/pipelines?locationId={LOCATION_ID}` |
| `custom-values.json` | `/custom-data/conversations?locationId={LOCATION_ID}&types=custom-values` |
| `workflow-settings.json` | `/workflow/{LOCATION_ID}/workflow-location-setting/settings` |

## 5. Save Manifest

Create `manifest.json` next to the captured JSON:

```json
{
  "sourceUrl": "https://app.gohighlevel.com/location/LOCATION_ID/workflow/WORKFLOW_ID",
  "locationId": "LOCATION_ID",
  "workflowId": "WORKFLOW_ID",
  "capturedAt": "YYYY-MM-DDTHH:mm:ssZ",
  "files": [
    {"purpose": "workflow", "path": "workflow.json", "status": 200},
    {"purpose": "trigger", "path": "trigger.json", "status": 200}
  ],
  "skipped": []
}
```

## 6. Validate

Run:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/get-ghl-workflow-json/scripts/validate_workflow_capture.py workflow-json/{LOCATION_ID}/{WORKFLOW_ID}/{YYYY-MM-DD-HHMM}
```

Report validation warnings plainly. Do not pretend a partial capture is complete.

## 7. Expiry And Re-Capture

The iframe JWT's lifetime and re-capture procedure are documented in
`${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` §4. On a `401`, stop and
follow that procedure before continuing.
