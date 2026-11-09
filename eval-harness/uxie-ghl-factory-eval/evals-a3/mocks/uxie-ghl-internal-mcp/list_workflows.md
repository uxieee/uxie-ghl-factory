---
expect:
  locationId: ["loc_1"]
---
{
  "ok": true,
  "data": {
    "count": 4,
    "complete": true,
    "workflows": [
      {"workflowId": "workflow_1", "name": "Old follow-up", "status": "published", "version": 3, "folderId": null},
      {"workflowId": "workflow_2", "name": "Lead nurture", "status": "draft", "version": 1, "folderId": null},
      {"workflowId": "workflow_3", "name": "Demo request follow-up", "status": "published", "version": 2, "folderId": null},
      {"workflowId": "workflow_4", "name": "Spring offer reminder", "status": "published", "version": 5, "folderId": null}
    ]
  }
}
