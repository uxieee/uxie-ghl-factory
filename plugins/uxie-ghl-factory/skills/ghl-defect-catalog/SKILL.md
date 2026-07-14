---
name: ghl-defect-catalog
description: The DEFECT lens for whole-account GHL audits — per-surface rules for things that are wrong (not merely absent) across workflows, pipelines, funnels, calendars, forms, ai-agents, messaging, and tracking. Each rule states what to look for, how to detect it via read-only recon, a default severity, and which specialist/skill remediates it — every rule cites its source. Use during any surface-auditor pass to know what defects to scan for on that surface; findings are filed in the ghl-audit-primitives finding schema.
---

# GHL Defect Catalog

This skill has no procedure of its own — it's the per-surface rule catalog
a surface-auditor consults while scanning one surface of a GHL sub-account
for **defects**. A defect is `altitude: defect` in the finding schema —
something that's wrong. This is a distinct lens from `opportunity` findings
(things absent or under-leveraged relative to the account brief's goals),
which live in a separate catalog.

- `references/rules.md` — the defect rules, grouped by surface
  (workflows, pipelines, funnels, calendars, forms, messaging, tracking,
  ai-agents). Every rule gives: what to look for, how to detect it via
  read-only recon (MCP call or read-only browser/`get-ghl-workflow-json`/`get-ghl-workflow-logs`
  inspection), a default severity, a remediation pointer (which
  specialist/skill fixes it), and its source citation.
- Finding shape: read
  `${CLAUDE_PLUGIN_ROOT}/skills/ghl-audit-primitives/references/finding-schema.md`
  before emitting a finding — every rule in this catalog is written to be
  filed as one finding in that shape (`id`, `surface`, `altitude: defect`,
  `severity`, `verdict`, `evidence`, `remediation`, `brief_tieback`).

## Ground rules

1. **Read-only detection only.** Every detection step in `rules.md` is a
   read — an MCP list/search/get call, a read-only `get-ghl-workflow-json`
   capture, or a read-only browser inspection. This catalog never proposes
   a write to confirm a defect, and never will.
2. **No manufactured findings.** A rule that doesn't resolve to evidence
   actually read this run produces no finding — see the schema's `evidence`
   field (`no evidence → no finding`).
3. **Severity here is a default, not a verdict.** The severity named per
   rule is a starting point for the surface-auditor to propose; the
   deterministic rubric in
   `${CLAUDE_PLUGIN_ROOT}/skills/ghl-audit-primitives/references/audit-io.md`
   §2 (scored against the account brief's ranked goals) has final say, and
   `verdict` (`confirmed`/`plausible`) is stamped by a separate
   finding-verifier — never self-assigned by whichever pass raised the
   finding.
4. **Grounded, not invented.** Every rule cites a source. Where the
   harvested material for a surface (tracking, ai-agents) is thin,
   `rules.md` says so explicitly in that surface's section rather than
   inventing detailed GHL-specific defects to fill the gap.
5. **Auth is single-sourced.** If a detection step needs browser-based
   capture, it follows `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` —
   this catalog never restates header or token format.

## Scope

IN: per-surface defect rules (what's wrong), each with detection, default
severity, remediation pointer, and source. OUT: opportunity rules (what's
absent/under-leveraged — a different lens, a different catalog), the
finding schema itself (owned by `ghl-audit-primitives`), the Mermaid map
grammar (owned by `ghl-mermaid-map`), and any specialist's full remediation
procedure (owned by that specialist's own skill — this catalog only points
to it).
