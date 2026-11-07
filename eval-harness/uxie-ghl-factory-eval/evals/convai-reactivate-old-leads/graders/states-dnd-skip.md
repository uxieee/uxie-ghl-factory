---
type: regex
target: last_message
flags: i
pattern: "(\\bDND\\b|do[- ]not[- ]disturb)"
match: contains
---
The final message mentions DND (contacts with Do Not Disturb are skipped).
