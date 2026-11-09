---
expect:
  locationId: ["loc_1"]
---
{
  "ok": true,
  "data": {
    "workflowId": "workflow_1",
    "name": "Old follow-up",
    "status": "published",
    "version": 3,
    "trigger": {"type": "tag_added", "tag": "lead-form"},
    "steps": [
      {"stepId": "step_1", "type": "wait", "attributes": {"waitMode": "time", "duration": 1, "unit": "days"}},
      {"stepId": "step_2", "type": "send_email", "attributes": {"subject": "Checking in", "bodyMerge": "Hi {{contact.first_name}}"}}
    ]
  }
}
