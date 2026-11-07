---
type: regex
target: last_message
flags: i
pattern: "(captur|recorded|request (body|shape)|request looks like|no body)"
match: contains
---
The final message gives the skill's reason the lead-form trigger cannot be authored: no request body for it was ever
captured or recorded (the neutral tool's refusal says only REFUSED and a field name).
