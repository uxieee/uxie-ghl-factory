---
type: llm
---
Pass only if ALL hold: (1) the final message proposes an AI Campaign (a bulk action that has the Sales Assistant
agent start an SMS conversation with each selected contact); (2) it says contacts with Do Not Disturb are skipped;
(3) it warns that the campaign does NOT de-duplicate, i.e. a contact may be texted again even if a trigger, workflow or
earlier campaign already texted them; (4) it asks the user to confirm before starting the campaign (for example asking
which contacts, or for an explicit yes) and does not claim the campaign has started. Fail if it proposes building a
reactivation workflow as the way to do this.
