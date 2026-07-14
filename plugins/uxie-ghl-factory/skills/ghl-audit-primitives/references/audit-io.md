# Audit I/O: folder layout, impact rubric, throttle, read-only stance

Shared substrate every surface-auditor, the finding-verifier, and the aggregator
read and write against. Adapted from `ghl-specialist/runbooks/audit-common.md`
§3 (folder layout), §5 (severity), and `throttle.md` / `session-start.md` for the
multi-surface, multi-agent shape this auditor runs — see the provenance note
under each section for what changed and why.

> **Provenance vs. loadable references.** Citations to `ghl-specialist/...` throughout
> this file (`audit-common.md`, `throttle.md`, `owned-account-check.md`, `map-generation.md`)
> mark where a convention was harvested from. `ghl-specialist` is a separate USER-LEVEL
> skill (`~/.claude/skills/ghl-specialist`), **not bundled in this plugin** — these are
> provenance notes, NOT files to `Read`. Everything you actually need is in this plugin.

---

## 1. Audit folder layout

```
.ghl/<locationId>/audits/<timestamp>/
├── inventory.json           # Phase A entity counts across all surfaces
├── raw/
│   ├── _shared/
│   │   └── workflows/       # the workflow-JSON corpus, captured ONCE in Phase 1.5
│   │                         # (<wid>.json + <wid>.trigger.json). READ-ONLY to every
│   │                         # surface-auditor — pipelines/forms/calendars/messaging/
│   │                         # funnels rules cross-reference workflow triggers/actions
│   │                         # here instead of re-capturing them per surface.
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
  it only ever inspected workflows in depth. This auditor spans every GHL surface
  (§5), so the split is by *surface* instead; each surface-auditor owns one
  subdirectory and doesn't touch another's.
- **`raw/_shared/workflows/` is new** — the one exception to "each auditor owns
  its own subdir." So many non-workflow rules cross-reference workflow internals
  (a Form Submitted trigger, a Pipeline Stage Changed trigger, a Send action with
  `userType:user`) that having each surface re-capture the workflow corpus would
  multiply the human-paced browser handoff and the throttle load. Instead the
  corpus is captured ONCE in Phase 1.5 into this shared, read-only store, and every
  surface-auditor reads it. Only the workflows-auditor writes here (during 1.5);
  all others treat it as read-only.
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
agent) — this auditor fans out across every GHL surface (§5, ~22), and unbounded
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
session actually admins the target `locationId`. An audit begins MCP-only (the
browser JWT may never be captured), so the gate is **MCP-native**:

1. **Primary (MCP, always available):** fetch the target location via the `ghl`
   MCP (`locations get`/`search`) and confirm it resolves under the configured
   token, then cross-check the account-holder via the MCP's user-search action.
   If the location doesn't resolve, or the user isn't an admin on it, the check
   fails.
2. **Secondary (only if a JWT was already captured for a depth dive):** decode the
   captured JWT's claims per `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` §3
   and confirm the target location is in scope. Do NOT force a browser capture
   just to run this gate — the MCP check above is sufficient to start.

Refuse to proceed if the check fails; accept an explicit `OVERRIDE: <reason>` from
the user, logged verbatim to `log.md` — never a silent override.

---

## 5. Surface coverage map + recon manifest (audit EVERY GHL surface)

A whole-account audit must inspect **every surfaceable area of the sub-account**, not
just the ones with deep rule catalogs. GHL exposes ~42 distinct domains (the `ghl` MCP's
83 categories, deduped across v2/v3). This map is the single source of truth for what an
audit run covers; the orchestrator enumerates it in Phase 1 and dispatches a surface-auditor
for every row. Two tiers:

- **Tier 1 — deep catalog:** curated defect + opportunity rules exist (`ghl-defect-catalog`,
  `ghl-opportunity-catalog`). Run both lenses.
- **Tier 2 — baseline coverage:** no deep rule catalog yet, but the surface is still audited
  every run via the **baseline protocol** below and findings are marked `coverage: baseline`.
  This is how "every surface is checked" without fabricating unvetted deep rules — a Tier-2
  surface is never silently skipped; at worst its section reads "checked, no issues (baseline)".

**Recon manifest** — for each surface, `search_actions` within the listed MCP categories
(prefer the `-v3` category where it exists) and call only the read shapes (`list`/`get`/
`search`/`count`). Cite the exact action ids you actually call in evidence; this manifest
names the categories, not the action ids, so it can't drift.

| Surface | Tier | MCP categories (recon entry) | What to look at |
|---|---|---|---|
| `workflows` | 1 | `workflows`, `campaigns` (+ shared workflow-JSON corpus) | see defect/opportunity catalogs |
| `pipelines` | 1 | `opportunities` | " |
| `funnels` | 1 | `funnels` | " |
| `calendars` | 1 | `calendars` | " |
| `forms` | 1 | `forms`, `surveys` | " (surveys audited under this surface) |
| `ai-agents` | 1 | `conversation-ai`, `voice-ai`, `agent-studio`, `knowledge-base` | " |
| `messaging` | 1 | `conversations`, `emails`, `email-isv` | " |
| `tracking` | 1 | (cross-cutting: `funnels` pixels + `locations` analytics) | " |
| `contacts` | 2 | `contacts`, `custom-fields`, `objects`, `associations`, `links` | data hygiene: duplicate rate, custom-field sprawl / unused fields, tag chaos, DND state, trigger-link usage, custom-object/association setup |
| `commerce` | 2 | `payments`, `products`, `invoices`, `store`, `proposals` | products/prices configured, Stripe live-vs-test, orphaned/unlinked products, unpaid/overdue invoices, order forms wired to a real product |
| `deliverability` | 2 | `phone-system`, `email-isv` | **compliance (high):** A2P/10DLC registration status, dedicated sending domain + DKIM/SPF, number/DNS health |
| `email-marketing` | 2 | `emails`, `campaigns` | template sprawl / orphaned templates, misconfigured or never-sent campaigns |
| `social` | 2 | `social-planner-v3`, `social-media-posting` | connected social accounts healthy, scheduled queue not stale/empty |
| `reputation` | 2 | (`conversations` review requests + workflow review steps) | is a review-request loop firing; responses monitored |
| `memberships` | 2 | `courses` | courses/communities configured, offers granted, orphaned content |
| `users-access` | 2 | `users` | staff roles, orphaned assignments (workflows/calendars pointing at removed users), over-permissioned accounts |
| `settings` | 2 | `locations`, `businesses`, `brand-boards`, `custom-menus` | timezone, business hours, business profile completeness, missing branding |
| `integrations` | 2 | `oauth`, `marketplace`, `medias` | connected accounts healthy/unexpired, installed apps, media library |
| `blogs` | 2 | `blogs` | published state, SEO basics |
| `ads` | 2 | `ad-manager`, `ad-publishing-v3` | ad accounts connected, spend/lead tracking wired |
| `affiliates` | 2 | `affiliate-manager` | program configured, payouts sane |
| `saas` | 2 | `saas-api`, `snapshots` | (only if an agency-SaaS sub-account) SaaS plans, rebilling, snapshot drift — else mark N/A |

**Read-depth ladder — pull the deepest layer available for your surface.** The MCP is
only the FLOOR. Where an internal-API read skill exists, config-level MCP data is not
enough — read the internals; where execution/runtime evidence exists, a defect isn't
proven from config alone. Per surface:

| Surface | (A) MCP config | (B) internal-API deep read | (C) runtime / execution evidence |
|---|---|---|---|
| `workflows` | list/count | **`get-ghl-workflow-json`** — step logic, trigger JSON, sticky notes (→ shared corpus, Phase 1.5) | **`get-ghl-workflow-logs`** — `logs/v2`, `count-per-step`, enrollment history (the only true execution log in GHL) |
| `funnels` / `tracking` | list | **`ghl-funnels-pages`** read recipes — `GET /funnels/funnel/fetch`, `/builder/page/data` (page content + tracking codes) | ⚠️ GAP — pageview/conversion analytics not captured (see below) |
| `ai-agents` | `conversation-ai` list | **`ghl-ai-agents-specialist`** (token-id, read) — bot config, actions, KB | conversation outcomes surface under `messaging` |
| `pipelines` | opportunities list | — | stage aging / open-count via MCP (runtime-ish) |
| `calendars` | calendars list | — | appointment statuses (booked/no-show/cancelled) via MCP |
| `forms` | forms/surveys list | — | submission counts/recency via MCP |
| `messaging` | conversations list | — | message history, response times, send status via MCP |
| Tier-2 surfaces | manifest categories | — (mostly) | none beyond MCP status fields |

Rules: (1) **Use B before concluding from A** on `workflows`/`funnels`/`ai-agents` — a
config-only read of those surfaces misses the defects that live in the internals. (2) A
defect-catalog rule tagged "runtime-proven" (workflows-13..16) REQUIRES layer C evidence —
don't file it from config. (3) When only layer A is available for a surface, say so in the
finding's evidence ("config-level only; runtime not captured") rather than implying you
proved runtime behavior.

**Known runtime-capture gap (reverse-engineering candidate).** Funnel pageview/conversion
analytics and email open/click/deliverability stats have **no capture path in this plugin
yet** — they're visible in the GHL UI but neither the public MCP nor an existing read skill
exposes them. Until captured, findings on funnel/email *performance* are config-level
inferences, not measured. To add a surface's runtime read, use the **`ghl-reverse-engineering`**
skill to capture the internal endpoint (read-only), document it, and add it to this ladder —
same pattern that produced `get-ghl-workflow-logs`.

**Baseline protocol (Tier-2 surfaces).** For each Tier-2 surface, the surface-auditor runs
these five generic checks against its recon reads (+ the shared workflow-JSON corpus for
cross-references), scoring with the §2 rubric and gating on the brief like any finding:

1. **Recon & count** — list/count the surface's objects via its manifest categories; save raw reads under `raw/<surface>/`.
2. **Populated-vs-expected** — the surface is empty/absent while the brief implies it should be in use → an `opportunity` finding (brief-tied).
3. **Configured-but-orphaned** — objects exist but nothing references or uses them (a dead product, an unused custom field, a disconnected social account).
4. **Obvious misconfiguration** — disabled, missing required config, test-mode in production, expired connection, non-compliant (A2P), N/A-but-half-set-up.
5. **Referenced-but-missing** — another surface points at an object here that doesn't exist (cross-ref via the shared corpus / MCP) → a `defect` finding.

Every Tier-2 finding carries `coverage: baseline` (honest depth marker, per spec §10). If a
Tier-2 surface yields nothing, log "`<surface>`: checked, no issues (baseline)" to `log.md`
so the report can prove the surface was inspected, not skipped. A Tier-2 surface that
repeatedly surfaces real findings is the signal to promote it to a Tier-1 deep catalog via
each catalog's "How to extend" convention.
