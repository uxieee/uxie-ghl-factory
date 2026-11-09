---
type: regex
target: mock_calls
pattern: '"method":"PUT"'
match: not_contains
---
The agent never sends a partial PUT of a workflow document.
