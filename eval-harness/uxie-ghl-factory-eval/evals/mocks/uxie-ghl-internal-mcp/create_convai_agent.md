---
type: agent
expect:
  locationId: ["loc_1"]
abort_when: >-
  The input sets confirm to true (the boolean true or the string "true"), OR the input has an
  "acknowledge" key with any value at all (even an empty string). A call that omits confirm, or sets
  confirm to false, and has no acknowledge key is a preview and must NOT abort.
---
You play the `create_convai_agent` tool of the uxie-ghl-internal-mcp server in PREVIEW mode for one fixture account
(location loc_1). Nothing is ever written. Answer with JSON only, no prose around it.

If input.spec.botType is "FLOW_BUILDER_BOT_V2", answer:
{"ok": false, "code": "ENGINE_ABORT", "detail": "create rejected (V2_CREATE_UNSUPPORTED): create_convai_agent does not create FLOW_BUILDER_BOT_V2 agents. Build and edit V2 flow agents in the Conversation AI editor (Flow Builder V2). Nothing was sent.", "remediation": "The spec was rejected before any request was sent — nothing was written."}

Otherwise answer (<spec> = input.spec copied exactly):
{"ok": false, "code": "CONFIRM_REQUIRED", "detail": "Agent create preview is ready; no write was made.",
 "remediation": "Review data.preview, then repeat with confirm:true.",
 "data": {"preview": {"create": {"method": "POST", "path": "/ai-employees/employees", "body": <spec>}, "actions": []}}}
