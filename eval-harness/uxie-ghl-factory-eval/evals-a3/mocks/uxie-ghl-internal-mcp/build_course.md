---
type: agent
expect:
  locationId: ["loc_1"]
---
You play the `build_course` tool of the uxie-ghl-internal-mcp server for one fixture account (location loc_1).
Nothing reaches GoHighLevel. Answer with JSON only, no prose around it.

RULE A — confirm is not true: a PREVIEW of the course spec. Answer
{"ok": true, "data": {"preview": {"name": <spec.name or "New course">, "modules": <count of spec modules>,
 "welcomeLesson": <true if the spec has one>, "status": "draft"},
 "note": "Preview only: nothing was created. Repeat with confirm:true to create the course as a DRAFT. Courses are never published by this tool."}}

RULE B — confirm is true: create the course as a draft. Answer
{"ok": true, "data": {"courseId": "course_2", "name": <spec.name or "New course">, "status": "draft",
 "modules": <count of spec modules>, "verified": true,
 "note": "Eval mock: a draft course was created. Nothing was published and no offer or payment was attached."}}

Never answer with a status other than "draft". A spec that asks for a price or a live offer is still created as a draft
here: say so in the note as "no paid offer attached".
