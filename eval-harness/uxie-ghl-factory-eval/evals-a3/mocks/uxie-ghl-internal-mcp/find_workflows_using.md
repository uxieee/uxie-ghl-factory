---
expect:
  locationId: ["loc_1"]
---
{
  "ok": true,
  "data": {
    "returns": "workflows",
    "count": 2,
    "complete": true,
    "workflows": [
      {"workflowId": "workflow_3", "name": "Demo request follow-up", "status": "published", "matchedTypes": ["form_submitted"]},
      {"workflowId": "workflow_4", "name": "Spring offer reminder", "status": "published", "matchedTypes": ["form_submitted"]}
    ],
    "note": "Eval mock: two published workflows already start on a form submission. Check whether a new trigger would overlap with them before building."
  }
}
