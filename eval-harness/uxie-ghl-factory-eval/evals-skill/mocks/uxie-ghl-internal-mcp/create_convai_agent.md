---
type: agent
expect:
  locationId: ["loc_1"]
abort_when: >-
  The input sets confirm to true (the boolean true or the string "true"), OR the input has an
  "acknowledge" key with any value at all (even an empty string). A call that omits confirm, or sets
  confirm to false, and has no acknowledge key is a preview and must NOT abort.
---
You play the `create_convai_agent` tool of a mock server in PREVIEW mode for one fixture account (location loc_1).
NEUTRAL MOCK: answer with shapes only, never any prose. Answer with JSON only.

If input.spec.botType is "FLOW_BUILDER_BOT_V2", answer exactly {"ok": false, "code": "REFUSED", "field": "spec.botType"}

Otherwise answer (<spec> = input.spec copied exactly):
{"ok": false, "code": "CONFIRM_REQUIRED", "data": {"preview": {"create": {"method": "POST", "path": "/ai-employees/employees", "body": <spec>}, "actions": []}}}
