---
type: llm
arm: with-only
focus: trace
---
The response must show that the **`create-ghl-workflow`** skill was invoked for this request.

This request asks for a programmatic change through the internal builder API, so the builder skill
is the right one, not the specialist that designs automations.

Pass if the transcript shows a Skill tool call naming **`uxie-ghl-factory:create-ghl-workflow`**, or
content that could only have come from it. Fail if `ghl-workflow-specialist` or any other GHL skill
fired instead, or if no skill fired and the model answered from general knowledge.

This grades ROUTING, not answer quality: a correct-sounding answer that did not use the skill is a
FAIL, because the skill's description did not do its job.
