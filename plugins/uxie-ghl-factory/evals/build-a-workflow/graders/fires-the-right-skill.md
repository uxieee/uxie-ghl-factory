---
with-only: true
---
The response must show that the **`create-ghl-workflow`** skill was invoked for this request.

Pass if the transcript shows that skill being used (a Skill tool call naming it, or
content that could only have come from it). Fail if a different GHL skill fired, or if
no skill fired and the model answered from general knowledge.

This grades ROUTING, not answer quality: a correct-sounding answer that did not use the
skill is a FAIL, because the skill's description did not do its job.
