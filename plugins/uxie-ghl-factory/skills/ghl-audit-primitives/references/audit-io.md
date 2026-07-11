# Audit I/O: folder layout, impact rubric, throttle, read-only stance

Shared substrate every surface-auditor, the finding-verifier, and the aggregator
read and write against. Adapted from `ghl-specialist/runbooks/audit-common.md`
§3 (folder layout), §5 (severity), and `throttle.md` / `session-start.md` for the
multi-surface, multi-agent shape this auditor runs — see the provenance note
under each section for what changed and why.

---

## 1. Audit folder layout

```
.ghl/<locationId>/audits/<timestamp>/
├── inventory.json           # Phase A entity counts across all surfaces
├── raw/
│   └── <surface>/           # workflows/ pipelines/ funnels/ calendars/ forms/
│                             # ai-agents/ messaging/ tracking/ — raw MCP + capture
│                             # payloads this surface's auditor read, one file per read
├── findings/
│   └── <surface>.json       # this surface-auditor's findings, schema per
│                             # references/finding-schema.md, pre-verification
├── system-flow.mmd          # Mermaid map of the account (entry points, workflows,
│                             # pipelines, exits) — see ghl-specialist/runbooks/map-generation.md
├── audit-report.md          # aggregated, severity-grouped, verified findings
└── log.md                   # continuous append-only log: pushbacks, overrides,
                              # phase transitions, throttle stops — never overwritten
```

**Provenance / what changed from `ghl-specialist`:**
- **Keyed by `locationId`, not a business-name slug.** Per
  `${CLAUDE_PLUGIN_ROOT}/docs/brief-format.md`: `locationId` is the canonical
  client key; never key state by business name. `ghl-specialist`'s
  `audits/<sub-account-slug>/<timestamp>/` predates that convention.
- **`inventory.json` is new** — a real artifact, not a log note. `ghl-specialist`
  sweep-audit's Phase A Step A1 ("count entities... save as a single `note`
  event") did this informally inline; this auditor is multi-surface and
  multi-agent, so the counts need to be a shared, machine-readable artifact
  every surface-auditor and the aggregator can read.
- **`raw/<surface>/` replaces `raw-data/mcp/` + `raw-data/workflows/`.** The
  source skill split by *data source* (MCP vs. captured workflow JSON) because
  it only ever inspected workflows in depth. This auditor spans eight surfaces,
  so the split is by *surface* instead; each surface-auditor owns one
  subdirectory and doesn't touch another's.
- **`findings/<surface>.json` is new**, one shard per surface-auditor, written
  before verification. `ghl-specialist` had one agent writing directly to
  `audit-report.md`; this auditor's surface-auditors run independently (see §3
  concurrency) and a separate finding-verifier consumes the shards before
  they're merged into `audit-report.md`.
- **`system-flow.mmd` and `audit-report.md` names carried over unchanged**
  (`audit-common.md` §3) — no reason to rename what already works.
- **`log.md` replaces `conversation-log.md`** — same contract (append-only,
  never overwritten, never retro-summarized; logs every pushback, override,
  dropped finding, phase transition — see `audit-common.md` §4), shorter name
  to match the rest of this layout.

---

## 2. Impact-ranking rubric (deterministic, not model gut)

`ghl-specialist`'s severity tiers (`audit-common.md` §5) were a qualitative,
one-paragraph judgment call: low/medium/high defined by example, "when uncertain,
demote." That's a reasonable single-auditor calibration, but a whole-account
audit runs multiple independent surface-auditors whose severities must be
comparable to each other and reproducible across runs — so this rubric is
scored, not felt.

**This section is authored for this auditor** (no equivalent rubric exists
verbatim in `ghl-specialist`); it operationalizes the qualitative tiers above
using the axes `ghl-specialist` already gestures at (compliance/money-loss vs.
operational risk vs. style) plus the brief-tieback concept from
`brief-format.md`'s "Goals — ranked... these drive audit impact-ranking" line.

### The three axes

Score each 1–3 (low/medium/high) per finding:

| Axis | 1 (low) | 2 (medium) | 3 (high) |
|---|---|---|---|
| **Revenue-path proximity** — how close is the defective/missing thing to money changing hands? | Internal hygiene, no contact-facing effect | Touches nurture/retention, one step removed from a conversion | Directly on the primary conversion path named in the brief (booked call, trial, purchase) |
| **Blast radius** — how much of the account/contact base does it touch? | One workflow, one segment, or cosmetic | A funnel, pipeline stage, or tag family used across multiple flows | Account-wide (deliverability, compliance, a trigger used everywhere) |
| **Frequency** — how often does it fire / how many contacts hit it? | Rare, edge-case, low volume | Regular but bounded (a specific campaign or stage) | High-volume / continuous (every inbound lead, every stage change) |

### Scoring

```
raw_score = revenue_path_proximity × blast_radius × frequency   # range 1–27
```

Map to severity:

- `raw_score >= 18` → **high**
- `raw_score >= 8` and `< 18` → **medium**
- `raw_score < 8` → **low**

### Brief-goal gate (before scoring, not after)

Before scoring, the finding must have a `brief_tieback` (see
`finding-schema.md`) — a ranked goal from `.ghl/<locationId>/brief.md` it
blocks (defect) or advances (opportunity). **A finding with no plausible
brief_tieback is capped at `low`** regardless of raw score — it may be true, but
if it doesn't connect to a goal the business actually ranked, it isn't worth
the reader's attention at higher severity. This is the deterministic stand-in
for "scored against brief goals": the brief's ranked goal list is the only
input allowed to override the raw axis score, and only downward.

### Ties to the harvested rules

- No severity inflation; when an axis score is ambiguous, score it down, not up
  (same spirit as `audit-common.md` §5's "when uncertain, demote").
- Compliance / money-loss / mass-misdelivery / destructive-operation findings
  (A2P unregistered, PII to debug endpoints, GDPR gaps) route to `high` by
  definition — the axes above are for the general case; these push-back-tier
  findings from `ghl-specialist/references/push-back-guide.md` don't need the
  formula to know they're high.

---

## 3. Throttle and human-pace rules

### Bounded concurrency

Surface-auditors may run **concurrently, capped at 3–4 in flight at once.**
This is new relative to `ghl-specialist` (which ran one audit, one session, one
agent) — this auditor fans out across up to eight surfaces, and unbounded
fan-out against `backend.leadconnectorhq.com` / the MCP is exactly what trips
GHL's WAF (the failure mode `throttle.md` exists to prevent). Each concurrent
surface-auditor still runs its own `throttle.wait()` before every fetch — the
concurrency cap and the per-call throttle are separate belts on the same
concern, not substitutes for each other.

### Per-call throttle (harvested, unchanged)

Every internal-endpoint fetch and every MCP call routes through the throttle
contract described in `ghl-specialist/runbooks/throttle.md` and cited in
`session-start.md` Step 6: a minimum interval between calls, a burst cap over a
rolling window, and a mandatory cooldown-and-stop on rejection. On any `429` or
`403`:

1. Record the rejection against the throttle state immediately.
2. **Stop** — do not retry in the same turn, do not let a different concurrent
   surface-auditor pick up the slack by hammering harder.
3. Surface the rejection to the user and wait out the cooldown before resuming.

This is a hard stop, not a suggestion (spec posture: read-only, human-pace, one
account in flight per audit run).

### Human-pace handoff for depth dives

Some surfaces can't be fully audited from the MCP alone — workflow step
internals, funnel page contents, form-builder internals, ConvAI prompts need a
depth dive via the browser, following `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`
for the capture mechanics (this file does not restate that procedure). When a
surface-auditor needs one, it pauses and hands off to the human rather than
driving the browser itself. Adapted from the A→B handoff prompts in
`ghl-specialist/runbooks/audit-common.md` §6 (generalized here from
"workflows only" to any surface needing staged tabs):

> Recon flagged **[N]** items across **[SURFACE(S)]** that need a depth dive —
> internals only visible via the browser, not the public API. Open these in
> your browser, staged one tab per target: **[LIST WITH NAMES AND URLS]**.
> Reply `ready` when the tabs are open. If a browser session with tabs staged
> isn't available right now, I'll pause here — everything so far is saved to
> `.ghl/<locationId>/audits/<timestamp>/`, and the depth dive can continue in
> another session picking up from this folder.

Copy this verbatim; fill only the bracketed slots. Do not proceed with a depth
dive without the explicit `ready`.

---

## 4. Read-only stance

This auditor **never writes to the GHL account.** Every action it takes against
`backend.leadconnectorhq.com` or the MCP is a read (`GET` / list / search /
count). It writes only to local artifacts under `.ghl/<locationId>/audits/<timestamp>/`
(this section's own layout) — never a workflow, pipeline, funnel, calendar,
form, ai-agent config, message, or tracking pixel in the account itself.

This is the harvested, non-negotiable posture from `ghl-specialist`'s
read-only / human-pace / one-account-per-run design (`throttle.md`'s "why",
and the owned-account gate below) — it does not weaken for this auditor just
because it spans more surfaces.

**Owned-account check (harvested from `ghl-specialist/runbooks/owned-account-check.md`,
adapted to current auth terms):** before auditing, confirm the authenticated
session actually admins the target `locationId`. Decode the captured JWT's
claims per `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` §3, confirm the
target location is one the session is scoped to, and cross-check the
account-holder's role via the MCP's user-search action. Refuse to proceed if
the check fails; accept an explicit `OVERRIDE: <reason>` from the user, logged
verbatim to `log.md` — never a silent override.
