---
tags: [skill]
max_turns: 25
allowed_tools: [Skill, Read, Glob, Grep]
---

Create a Managed Agent called "Research Lead" on location loc_1. It researches a topic on the web and delegates the write-up to a subagent named "summariser", which should run on openrouter/google/gemini-3.8-flash to keep costs down. Show me the preview first; don't create it until I say so.
