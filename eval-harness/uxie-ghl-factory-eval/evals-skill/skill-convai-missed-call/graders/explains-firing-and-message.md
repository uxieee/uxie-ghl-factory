---
type: llm
---
Pass only if ALL hold: (1) the final message says the Sales Assistant will text missed callers ON ITS OWN as soon as the
trigger is enabled because the agent's mode is auto-pilot (the mode decides whether the trigger fires; with mode off it
would send nothing); (2) it says what the text will consist of: the agent's outbound opening message (here an
AI-generated greeting written from an instruction) plus the disclaimer and/or a platform-added opt-out line such as
"Reply STOP to unsubscribe"; (3) it asks the user for an explicit yes before enabling. Fail if it claims the trigger is
already live, or proposes a workflow instead of the agent's trigger.
