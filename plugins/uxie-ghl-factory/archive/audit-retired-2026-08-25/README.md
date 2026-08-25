# The audit, retired 2026-08-25

Parked at Xander's request, pending a focused session on how account auditing should actually
work. **Nothing here is broken and nothing was deleted** — it is unregistered so no agent loads
it, and kept whole so the next session starts from the real thing rather than a memory of it.

## What moved here

| | |
|---|---|
| `audit.md` | the `/uxie-ghl-factory:audit` command — the six-phase orchestrator |
| `surface-auditor.md` | the per-surface subagent |
| `finding-verifier.md` | the adversarial verifier that tried to refute each candidate |
| `ghl-audit-primitives/` | finding schema, severity scale, evidence rules, coverage map |
| `ghl-defect-catalog/` | 48 defect rules across 8 surfaces |
| `ghl-opportunity-catalog/` | 8 opportunity rules |
| `ghl-mermaid-map/` | the system-flow diagram renderer |

## Why it was parked

The design is sound — two lenses, per-surface fan-out, an adversarial verifier, resumable
artifacts. What was never established is whether it **finds what a human expert would find**.
There is no ground truth: no account where someone wrote down the real problems independently and
then compared. Without that, "48 rules" measures coverage of our own catalogue, not of reality.

## What the walk of 2026-08-25 learned that changes the design

The audit currently answers several questions by crawling. Five of them turn out to be single
reads, documented during that walk:

| question | how the audit does it | what exists |
|---|---|---|
| which workflows are broken? | crawl every workflow's logs | `GET /workflow/{loc}/error-notification/list` |
| are triggers actually matching? | not asked | trigger analysis — attempted / matched / unmatched |
| which workflows use step X? | export all, search templates | `POST /workflows/es/search` filtered by action type |
| can premium steps even run? | not asked | agency `billing-config` + `premium-tier-usage` |
| is email deliverable? | not asked | `location-email-provider` — domain, warm-up, rate limit |

The third replaces hundreds of requests with one on a real account.

Two correctness problems in the current rules, also from that walk:

- **`finished` is not completion.** It also means a contact was *ejected*. Any completion metric
  computed from roster status overstates.
- **Execution logs contain synthetic lifecycle rows** (`add_to_workflow`, `added_to_workflow`,
  `remove_from_workflow`) that are not authored steps. Correlating rows to `templates[]` without
  filtering them reports steps that do not exist.

Full detail: `knowledge/corpus/workflows/50-runtime/` and
`knowledge/corpus/workflows/70-research/WALK-CHECKLIST-2026-08-25.md`.

## Before rebuilding

Establish ground truth first. Take one account that is known well, write down what is actually
wrong with it by hand, run the audit blind, and diff. That yields a hit rate, a false-positive
rate, and — most valuable — the list of real problems no rule covers. That last list is the
roadmap; adding more rules without it is guessing.

## To bring it back

Move the directories back and restore the command. Nothing depends on its absence, and the
skills that referenced it have had those pointers removed rather than rewritten around it.
