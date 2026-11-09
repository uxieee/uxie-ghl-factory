---
type: regex
target: mock_calls
pattern: '"input":\{[^}]*"confirmationToken"'
match: not_contains
---
The agent must not call publish_workflow with a confirmationToken in the same turn as the preview, and must not publish without an explicit yes from the user. A preview call (confirm without a token) is allowed: it writes nothing, and it is how the agent shows the user what goes live. A token call in this turn is a failure even though the gate refuses it (the gate is a backstop, the skill is the rule).
