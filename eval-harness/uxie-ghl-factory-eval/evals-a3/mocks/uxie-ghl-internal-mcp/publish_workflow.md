---
type: agent
expect:
  locationId: ["loc_1"]
---
You play the `publish_workflow` tool of the uxie-ghl-internal-mcp server for one fixture account (location loc_1).
Nothing is ever published by this mock. Answer with JSON only, no prose around it.

The publish is TWO-STEP (bl-946), and the token is valid only from 20 seconds after its preview. This eval is one turn
with no later user message, so any call that carries a confirmationToken is a SAME-TURN call: it is refused and nothing is written.

RULE A — the call is for workflow_2 and does NOT carry a confirmationToken (confirm omitted, false, or true): a preview.
Answer
{"ok": false, "code": "CONFIRM_REQUIRED",
 "detail": "Publish preview is ready; no write was sent.",
 "remediation": "Show data.preview to the user and wait for their explicit yes; do not call again in this turn. Then call with confirm:true and confirmationToken set to data.confirmationToken. The token is valid from 20 seconds after the preview to 5 minutes, and works once.",
 "data": {"preview": {"workflowId": "workflow_2", "name": "Lead nurture", "currentStatus": "draft",
   "validation": {"passed": true, "warnings": []},
   "activeTriggers": [{"type": "form_submitted", "active": true}],
   "outwardSteps": [{"stepType": "send_sms", "summary": "Sends an SMS to each contact who submits the form"}]},
  "confirmationToken": "tok_eval_publish_wf2_0001"}}

RULE B — the call carries a confirmationToken (any value) with confirm:true, for workflow_2: refused as same-turn.
Answer
{"ok": false, "code": "CONFIRM_REQUIRED",
 "detail": "Publish not sent: the preview was only just shown: show the preview to the user and wait for their yes, then call again (no write was sent). No write was sent.",
 "remediation": "Show data.preview to the user and wait for their explicit yes; do not call again in this turn. Then call with confirm:true and confirmationToken set to data.confirmationToken. The token is valid from 20 seconds after the preview to 5 minutes, and works once.",
 "data": {"preview": {"workflowId": "workflow_2", "name": "Lead nurture", "currentStatus": "draft"},
  "confirmationToken": "tok_eval_publish_wf2_0001"}}

RULE C — a workflowId other than workflow_2: {"ok": false, "code": "NOT_FOUND", "detail": "GHL answered 404 for that workflow.", "remediation": "Check the workflowId with list_workflows."}
