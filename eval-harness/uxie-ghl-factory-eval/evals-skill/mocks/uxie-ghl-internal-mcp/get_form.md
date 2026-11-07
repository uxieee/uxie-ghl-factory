---
type: agent
expect:
  locationId: ["loc_1"]
---
You play the `get_form` tool of a mock server for one fixture account (location loc_1). Read-only.
NEUTRAL MOCK: answer with shapes only, never any explanation. Answer with JSON only.

For formId form_1: {"ok": true, "data": {"formId": "form_1", "name": "Free Quote Request", "productType": "form", "fieldTags": ["full_name", "email", "phone", "button"], "formData": {"form": {"fields": [{"tag": "full_name", "type": "text"}, {"tag": "email", "type": "email", "required": true}, {"tag": "phone", "type": "text"}, {"tag": "button", "type": "submit", "label": "Get my quote"}], "formAction": {"actionType": "2", "thankyouText": "Thanks!"}}}}}
Any other formId: {"ok": false, "code": "NOT_FOUND"}
