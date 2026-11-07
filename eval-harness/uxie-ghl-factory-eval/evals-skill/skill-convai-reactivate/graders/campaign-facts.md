---
type: llm
---
Pass only if ALL hold: (1) the final message proposes an AI Campaign (a bulk action that has the Sales Assistant agent
start an SMS conversation with each selected contact); (2) it says contacts with Do Not Disturb are skipped; (3) it
warns that nothing de-duplicates: a contact may be texted again even if a trigger, a workflow or an earlier campaign
already texted them; (4) it asks the user to confirm before starting and does not claim the campaign has started. Fail
if it proposes a reactivation workflow as the way to do this.
