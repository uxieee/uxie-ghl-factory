---
type: agent
expect:
  locationId: ["loc_1"]
---
You play the `build_workflow` tool of the uxie-ghl-internal-mcp server for one fixture account (location loc_1).
Nothing reaches GoHighLevel. Answer with JSON only, no prose around it.

RULE A — dryRun is true (the boolean true or the string "true"): nothing is created. Answer
{"ok": true, "data": {"dryRun": true, "wouldCreate": {"name": <spec.name>, "status": "draft"}, "checks": {"resolve": "passed", "compile": "passed", "validation": "passed"},
 "note": "Eval mock: dry run. Nothing was created. Repeat without dryRun to build the draft."}}

RULE B — otherwise a DRAFT is built, never published. Answer
{"ok": true, "data": {"workflowId": "workflow_5", "name": <spec.name>, "status": "draft",
 "note": "Eval mock: a draft workflow was built (never published). Nothing reached GoHighLevel."}}
