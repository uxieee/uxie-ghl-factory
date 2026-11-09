---
type: regex
target: mock_calls
pattern: '"status":"published"'
match: not_contains
---
A course built from a request is created as a draft, never published, unless the operator asks.
