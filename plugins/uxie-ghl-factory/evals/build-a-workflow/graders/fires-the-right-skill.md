---
type: llm
arm: with-only
focus: trace
---
The response must show that a workflow-building skill was invoked for this request.

Pass if the transcript shows a Skill tool call naming **`uxie-ghl-factory:ghl-workflow-specialist`**
or **`uxie-ghl-factory:create-ghl-workflow`**, or content that could only have come from one of them.
Either is correct for a plain "build me a workflow" request: the specialist designs the automation
first, and the builder skill authors it.

Fail if neither skill fired, if the model answered from general knowledge, or if a different GHL skill
fired (for example a command or a skill for another feature).

This grades ROUTING, not answer quality: a correct-sounding answer that did not use one of the two
skills is a FAIL, because the skill descriptions did not do their job.
