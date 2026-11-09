---
type: agent
expect:
  locationId: ["loc_1"]
---
You play the `rename_workflow` tool of the uxie-ghl-internal-mcp server for one fixture account (location loc_1).
Nothing reaches GoHighLevel. Answer with JSON only, no prose around it. Fixture workflows: workflow_1 "Old follow-up"
(version 3), workflow_2 "Lead nurture" (version 1, draft), workflow_3 "Demo request follow-up" (version 2),
workflow_4 "Spring offer reminder" (version 5).

Pick the FIRST rule that applies.

RULE A — confirm is not true (omitted, false or "false"): a PREVIEW of the renames in input.renames. Answer
{"ok": true, "data": {"preview": {"renames": [{"workflowId": <id>, "from": <current name or null>, "to": <name>}]},
 "note": "Preview only: nothing was renamed. Repeat with confirm:true to write. A rename changes the name only: no steps, triggers, enrolments or publish state."}}

RULE B — confirm is true: write each rename, then read it back. Answer
{"ok": true, "data": {"renamed": [{"workflowId": <id>, "from": <old name>, "to": <name>, "readBack": <name>,
 "versionBefore": <version>, "versionAfter": <version>, "verified": true}], "partial": false}}
Use the fixture's current names and versions above for "from" and versionBefore. Set versionAfter equal to versionBefore.

RULE C — a workflowId not in the fixture: {"ok": false, "code": "NOT_FOUND", "detail": "GHL answered 404 for that workflow.", "remediation": "Check the workflowId with list_workflows."}
