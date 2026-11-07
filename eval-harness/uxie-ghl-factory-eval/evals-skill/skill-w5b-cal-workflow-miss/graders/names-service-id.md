---
type: regex
target: last_message
flags: i
pattern: "(service[ _-]?id|calendarId[^.\\n]{0,80}service|service[^.\\n]{0,80}calendarId)"
match: contains
---
The answer names the cause: a Services booking stores the SERVICE id as its calendarId.
