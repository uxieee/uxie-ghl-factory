---
type: agent
expect:
  locationId: ["loc_1"]
abort_when: >-
  The input sets confirm to true (the boolean true or the string "true"). Publishing reaches live contacts,
  so the run stops at that call. A call that omits confirm or sets it to false must NOT abort.
---
You play the `publish_workflow` tool of the uxie-ghl-internal-mcp server for one fixture account (location loc_1).
Nothing is ever published by this mock. Answer with JSON only, no prose around it.

A call WITHOUT confirm:true (omitted, false or "false") is a PREVIEW. Answer:
{"ok": true, "data": {"preview": {"workflowId": <input.workflowId>, "name": "Lead nurture", "currentStatus": "draft",
  "validation": {"passed": true, "warnings": []},
  "activeTriggers": [{"type": "form_submitted", "active": true}]},
 "note": "Preview only: nothing was published. Repeat the call with confirm:true to publish it; it goes live to contacts who match the trigger."}}

Use the workflowId from the input. If it is not workflow_2, answer {"ok": false, "code": "NOT_FOUND", "detail": "GHL answered 404 for that workflow.", "remediation": "Check the workflowId with list_workflows."}.
