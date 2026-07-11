# Finding Schema

The canonical finding record every surface-auditor (workflows, pipelines, funnels,
calendars, forms, ai-agents, messaging, tracking) emits. One finding per issue —
do not bundle. This is the whole-account auditor's version of `ghl-specialist`'s
finding object (`ghl-specialist/runbooks/audit-common.md` §2), extended with two
fields the single-account, single-altitude skill never needed: `altitude` and
`brief_tieback`.

```yaml
finding:
  id: <surface>-<n>
  surface: workflows|pipelines|funnels|calendars|forms|ai-agents|messaging|tracking
  altitude: defect | opportunity
  title: <one line>
  severity: high|medium|low   # assigned by the deterministic rubric (audit-io.md), not gut
  verdict: confirmed | plausible   # stamped by finding-verifier, never self-assigned
  evidence: [ {source, what_was_read, value} ]   # no evidence → no finding
  remediation: <concrete next step; which specialist/skill would do it>
  brief_tieback: <which brief goal this defect blocks / opportunity advances>
```

## Field-by-field

- **id** — `<surface>-<n>`, stable within one audit run. Surface prefix lets
  findings be re-assembled from `findings/<surface>.json` shards (see
  `audit-io.md`) without collision.
- **surface** — exactly one of the eight enumerated surfaces. A finding that
  spans two surfaces (e.g. a workflow driving a broken calendar booking) still
  picks the surface where the defect *lives*; use `remediation` or a future
  cross-reference to point at the other surface, don't dual-file it.
- **altitude** — **new field.** `ghl-specialist` only ever reported defects
  (things wrong); this auditor also surfaces `opportunity` findings (things
  absent or under-leveraged relative to the brief's goals — e.g. no re-engagement
  workflow exists at all, not just "the existing one is broken"). Altitude is
  set once at emission and never flips; a defect and the opportunity it implies
  are two separate findings if both are worth reporting.
- **title** — imperative and specific (harvested rule, unchanged): the user
  should be able to grep for it a month later. Not "workflow issue" — "Speed-
  to-lead workflow has no wait cap before escalation."
- **severity** — `high|medium|low`. Assigned by the deterministic impact-ranking
  rubric in `audit-io.md` §2 (revenue-path proximity × blast radius × frequency,
  scored against the brief's ranked goals) — never a model's gut feel, and never
  inflated. When a scoring input is ambiguous, round down a tier (harvested rule
  from `audit-common.md` §5: "when uncertain between tiers, demote").
- **verdict** — `confirmed | plausible`. **Never self-assigned** by the agent
  that raised the finding — a separate finding-verifier stamps this. This is a
  structural change from `ghl-specialist` (one agent, one pass): the whole-
  account auditor runs a surface-auditor → finding-verifier split so a finding
  a surface-auditor is confident about isn't taken on faith.
- **evidence** — array of `{source, what_was_read, value}`. Harvested rule,
  unchanged in spirit: evidence is an artifact, not a claim (`audit-common.md`
  §2). Every item must resolve to something actually read this run — a
  `raw/<surface>/...` file, an MCP response slice, a specific field value. **No
  evidence → no finding.** No manufactured findings, ever.
- **remediation** — a pointer, not a how-to: names the concrete next step and
  which specialist/skill in this plugin would execute it (e.g.
  `ghl-workflow-specialist`, `ghl-pipeline-specialist`, `create-ghl-workflow`).
  Full fix detail lives with that specialist; don't re-document it here.
- **brief_tieback** — **new field.** Names which ranked goal from
  `.ghl/<locationId>/brief.md`'s "Goals — ranked" section (see
  `${CLAUDE_PLUGIN_ROOT}/docs/brief-format.md`) this finding blocks (defect) or
  advances (opportunity). This is what makes the severity rubric's "scored
  against brief goals" input concrete and auditable — a finding with no
  plausible tieback to a stated goal is a signal the finding may not matter to
  this business; the rubric downgrades it accordingly (see `audit-io.md` §2).

## Rules carried over unchanged from `ghl-specialist`

- One finding per issue. Don't bundle unrelated symptoms under one title.
- `cross_refs` (list of other finding `id`s) may be added ad hoc when findings
  interact (e.g. a duplication finding compounds a re-entry finding) — optional,
  not part of the required shape above.
- No severity inflation. If torn between tiers, drop a tier.
- Findings render grouped by severity (high → medium → low) in
  `audit-report.md`; grouping *within* a tier is the aggregator's call.
