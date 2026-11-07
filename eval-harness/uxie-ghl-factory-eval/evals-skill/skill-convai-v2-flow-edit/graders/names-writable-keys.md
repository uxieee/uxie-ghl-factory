---
type: regex
target: last_message
flags: i
pattern: "(cancelEnabled|rescheduleEnabled|cancel(lation)?[ /,a-z]{0,12}reschedul)"
match: contains
---
The final message says what the tool CAN change on a V2 flow agent (only cancel / reschedule).
