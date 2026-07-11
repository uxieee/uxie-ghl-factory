# Account Brief — format

Location: .ghl/<locationId>/brief.md  (locationId = GHL location ID, the
canonical client key; NEVER key by business name). Audit artifacts share the
root: .ghl/<locationId>/audits/<timestamp>/. The .ghl/ dir is gitignored (PII).

Template:
---
locationId: ""        # required — canonical key
alias: ""             # human-readable business name
updated: YYYY-MM-DD
---
## Business
(what they do, market, geography)
## Ideal client avatar
(who they sell to; pains; where these people come from)
## Offer & pricing
## Lead sources & volume
(channels, approximate monthly volume, time-sensitivity)
## Goals — ranked
(revenue-path goals first; these drive audit impact-ranking)
## Constraints & compliance
(quiet hours, regulated claims, brand rules, tech constraints)
## Discovered facts
(agent-appended, each line dated; facts recon found that the human confirmed)
