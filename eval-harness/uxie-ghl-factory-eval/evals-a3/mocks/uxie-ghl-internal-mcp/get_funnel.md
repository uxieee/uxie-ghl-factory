---
expect:
  locationId: ["loc_1"]
---
{
  "ok": true,
  "data": {
    "funnelId": "funnel_1",
    "name": "Spring offer",
    "view": "summary",
    "steps": [
      {
        "stepId": "step_1",
        "name": "Landing",
        "path": "/spring",
        "pages": [{"pageId": "page_1", "name": "Landing page", "publishStatus": "published", "hasDraft": false}]
      },
      {
        "stepId": "step_2",
        "name": "Thank you",
        "path": "/spring/thanks",
        "pages": [{"pageId": "page_2", "name": "Thank-you page", "publishStatus": "published", "hasDraft": false}]
      }
    ],
    "note": "Eval mock: the funnel is live. Read a page with get_funnel before a whole-page write."
  }
}
