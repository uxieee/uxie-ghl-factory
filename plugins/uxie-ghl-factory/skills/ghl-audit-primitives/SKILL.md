---
name: ghl-audit-primitives
description: Shared substrate for whole-account GHL audits — the finding record schema, the audit folder layout, the deterministic impact-ranking rubric, throttle/concurrency limits, and the human-pace handoff gate. Read-only, never writes to the account. Use before or during any GHL audit work (surface-level audits, the aggregated whole-account audit, or a finding-verifier pass) so every piece writes findings and artifacts in the same shape.
---

# GHL Audit Primitives

This skill has no procedure of its own — it's the shared substrate the
whole-account auditor's surface-auditors, finding-verifier, and report
aggregator all build on. Load the reference that matches your gap:

- `references/finding-schema.md` — the finding record every surface-auditor
  emits (id, surface, altitude, title, severity, verdict, evidence, remediation,
  brief_tieback). Read this before emitting a single finding.
- `references/audit-io.md` — the `.ghl/<locationId>/audits/<timestamp>/` folder
  layout, the deterministic impact-ranking rubric that assigns severity, bounded
  concurrency + throttle rules, the human-pace handoff prompt for browser depth
  dives, and the read-only / owned-account posture.

## Ground rules

1. **Read-only, always.** This auditor never writes to the GHL account — no
   workflow, pipeline, funnel, calendar, form, ai-agent, message, or tracking
   change, ever. It only writes local artifacts under `.ghl/<locationId>/audits/`.
   See `references/audit-io.md` §4.
2. **Auth is single-sourced.** Any browser-based capture needed for a depth
   dive follows `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` exactly — this
   skill and its references never restate header formats, capture steps, or
   token claim names. If a doc anywhere in this plugin teaches auth details
   directly, it's stale; point back here instead.
3. **Brief-grounded.** Severity and altitude both tie back to
   `.ghl/<locationId>/brief.md` (format: `${CLAUDE_PLUGIN_ROOT}/docs/brief-format.md`).
   A finding with no plausible tie to a ranked goal in the brief scores low,
   regardless of how technically real it is.
4. **No manufactured findings.** Every finding cites evidence actually read
   this run. No evidence, no finding.

## Scope

IN: the shared schema, folder layout, rubric, and throttle/handoff rules every
audit surface and the verifier/aggregator build on. OUT: any single surface's
audit logic (that's the surface-specific agents built on top of this skill) and
any capability that writes to the account (out of scope for this auditor
entirely).
