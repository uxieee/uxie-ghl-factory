# Reference Pipeline Shapes — by business model

> Starting points, not templates to paste unmodified — always adapt stage names and
> automation choices to the account's actual sales motion (per the client brief),
> per `references/stage-design.md` §1. Each shape lists the ordered stages, the
> **state** each stage represents, and which stage-to-stage transitions should (or
> should not) carry an automated `Pipeline Stage Changed` workflow.

## 1. Local service — lead → job (handyman, HVAC, cleaning, agency-managed home
services)

| # | Stage | State it represents |
|---|---|---|
| 1 | New Lead | Inbound contact exists, not yet reached |
| 2 | Contacted | A human has made first contact; awaiting response |
| 3 | Estimate/Quote Sent | Price is in the customer's hands; awaiting decision |
| 4 | Scheduled | Customer accepted; job is booked on the calendar |
| 5 | Job In Progress | Crew is actively on-site / working the job |
| 6 | Completed — Invoiced | Work is done; payment is outstanding |
| 7 | Won (Paid) | Payment received — terminal, `status: won` |
| — | Lost | Any prior stage, terminal, `status: lost` with a lost reason |

**Automate:**
- New Lead entry → speed-to-lead workflow (first-touch SMS/call task within minutes).
- Estimate Sent → stale-reminder workflow if no response after N days (this is the
  stage most local-service pipelines silently bottleneck in — watch it via
  `opportunities-v3__search-opportunity` bucketed by `pipelineStageId`).
- Completed — Invoiced entry → invoice-sent + review-request sequence, scoped to the
  invoice (invoice triggers bypass `allowMultiple`, so design the downstream actions
  per-invoice, not per-contact — see `ghl-workflow-specialist
  references/anti-patterns.md` §5).

**Don't automate:**
- The Contacted → Estimate Sent move itself. This transition should reflect a rep
  actually producing a quote, not a timer; auto-advancing it hides whether estimates
  are actually going out.

## 2. Coaching / high-ticket sales (applications, discovery calls, close on a call)

| # | Stage | State it represents |
|---|---|---|
| 1 | New Application | Lead applied/opted in; not yet screened |
| 2 | Qualified | A human has screened them as a fit for a call |
| 3 | Call Scheduled | Discovery/sales call is booked |
| 4 | Call Completed — Proposal Sent | Call happened; offer/pricing is in their hands |
| 5 | Negotiation | Active back-and-forth on terms/price |
| 6 | Won — Onboarding | Contract signed, payment received |
| — | Lost | Any prior stage, terminal, with lost reason (price, timing, fit, etc.) |

**Automate:**
- Call Scheduled entry → booking-confirmation + reminder sequence (this is the
  highest-leverage automation in this shape — no-show rates are the biggest lever
  in high-ticket pipelines).
- Call Scheduled with a `no_show` calendar outcome → no-show recovery workflow
  (reschedule sequence).
- Call Completed — Proposal Sent → stale-reminder if no movement after N days.

**Don't automate:**
- New Application → Qualified. Qualification is a judgment call about fit; an
  automatic advance (e.g. "everyone who books a call counts as qualified") erases the
  screening signal the stage exists to capture, and close-rate-by-source reporting
  becomes meaningless once "qualified" no longer means "a human said yes."

## 3. E-commerce / repeat-purchase (post-purchase upsell, wholesale accounts, or
subscription win-back tracked as opportunities — not the storefront cart itself)

| # | Stage | State it represents |
|---|---|---|
| 1 | New Customer | First order placed; not yet in a nurture track |
| 2 | Post-Purchase Nurture | Thank-you/review-request sequence is live |
| 3 | Upsell/Cross-sell Offered | A targeted next-purchase offer has gone out |
| 4 | Repeat Purchase — Won | Customer bought again — terminal, `status: won` |
| — | Churn Risk (Stale) | No repeat purchase after the expected repurchase window |

**Automate:**
- New Customer entry → post-purchase thank-you + review-request sequence
  (Order/Invoice-triggered, per-order-scoped — treat like the local-service
  Completed-Invoiced case for re-entry semantics).
- Post-Purchase Nurture → Upsell Offered, timed off the product's typical
  repurchase-cycle length, not a fixed calendar date.
- Entry into Churn Risk (Stale) → win-back offer workflow, using a `Stale
  Opportunities`-style staleness rule scoped to the repurchase window, not a generic
  60-day default.

**Don't automate:**
- The move into "Repeat Purchase — Won" itself off of a generic "customer visited the
  site again" signal — tie it to an actual completed order event, not to weaker
  intent signals that inflate the win count.

## 4. Agency / B2B retainer sales (consultative sale, proposal + contract cycle)

| # | Stage | State it represents |
|---|---|---|
| 1 | Lead | Inbound or sourced contact, not yet engaged |
| 2 | Discovery Call Booked | A scoping call is on the calendar |
| 3 | Proposal Sent | Scope + pricing is in the prospect's hands |
| 4 | Contract Sent | Prospect verbally agreed; paperwork is out |
| 5 | Won — Onboarding | Contract signed — terminal, `status: won` |
| — | Lost | Any prior stage, terminal, with lost reason |

**Automate:**
- Discovery Call Booked entry → confirmation + reminder sequence (same no-show logic
  as the coaching shape).
- Proposal Sent → stale-reminder if no response after N business days.
- Contract Sent → internal task/notification to ops for onboarding prep, fired the
  moment the stage is entered (don't wait for the Won move — prep should start on
  contract-out, not contract-signed).

**Don't automate:**
- Proposal Sent → Contract Sent. This move reflects the prospect actually saying yes;
  automating it off of, say, an email-open event manufactures false pipeline
  velocity and breaks close-rate reporting the same way auto-qualifying breaks it in
  the coaching shape.

## Cross-cutting notes for all shapes

- Every shape above ends in a real terminal `status` (`won`/`lost`/`abandoned`), not
  just a last stage — see `references/stage-design.md` §2 on keeping `status` and
  `pipelineStageId` in sync.
- Before proposing any shape, read the account's existing pipeline via
  `opportunities-v3__get-pipeline` / `get-pipelines` and the brief's ICA/offer — these
  shapes are starting hypotheses to confirm against the account's real sales motion
  during intake, not answers to skip intake with.
- If the account's motion doesn't cleanly match any shape above, build from the
  stages-as-states principle directly (`references/stage-design.md` §1) rather than
  forcing a mismatched template.

## Adjacent surface: calendars-v3 writes are FULL-REPLACE

Pipeline work often touches booking calendars (discovery-call stages). When updating
a calendar via `calendars-v3__update-calendar`, the PUT is a **full replacement** —
same family of trap as `opportunities-v3__update-pipeline` (reported live 2026-07-13):

- **Omitting a field WIPES it** — e.g. leaving out `slotDuration` resets it to 30,
  leaving out `openHours` clears the availability entirely. Always GET the calendar,
  mutate the full document, and PUT the whole thing back.
- `openHours` needs **one entry per weekday** you want open — a single entry does not
  fan out across days.
- `teamMembers` entries must **NOT include a `primary` key** — strip it from the GET
  response before PUTting, or the update is rejected.
