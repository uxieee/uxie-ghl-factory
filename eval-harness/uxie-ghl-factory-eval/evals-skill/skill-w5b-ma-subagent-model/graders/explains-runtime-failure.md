---
type: llm
---
Pass only if ALL hold: (1) it tells the user that a subagent on openrouter/google/gemini-3.8-flash is accepted when saved
but fails when the parent delegates to it at run time (the parent then quietly does the work itself); (2) it proposes
an alternative: omit the subagent's model (runs on the parent's) or another model from the server's subagent roster.
