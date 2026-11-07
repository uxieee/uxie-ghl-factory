---
type: regex
target: last_message
flags: i
pattern: "(outbound[^.\\n]{0,40}\\b(on|enabled|active|activated)\\b|(switched|turned) on[^.\\n]{0,30}(outbound|texting|SMS)|(texting|sending) is (already )?(switched|turned) on|campaign-eligible|enabled (SMS )?outbound config)"
match: contains
---
The final message ties the campaign to the agent's enabled SMS outbound config (what makes an agent campaign-eligible).
