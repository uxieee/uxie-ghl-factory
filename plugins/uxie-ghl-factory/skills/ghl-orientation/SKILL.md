---
name: ghl-orientation
description: GoHighLevel platform fluency — the GHL object model, terminology, which API surface (public MCP vs internal) fits a job, and cross-domain gotchas (calendars, forms, custom fields, tags, snapshots). Use at the start of any GHL task, when unsure what a GHL term means, where a thing lives in GHL, or which API/tool can touch it.
---

# GHL Orientation

Read the reference that matches your gap; don't load all three by default:
- references/object-model.md — what exists in a sub-account and how it relates
- references/api-worlds.md — public vs internal API: capabilities, risk, choosing
- references/domain-gotchas.md — calendars, forms, custom fields, tags, snapshots

Ground rules for agents working GHL:
1. Recon before asking: read the account via the ghl MCP first.
2. Respect the two-API boundary: prefer public; internal only via this
   plugin's capability skills with their gates.
3. Per-client state lives in .ghl/<locationId>/ (brief.md = client context).

## Specialists

For design-level work, hand off to a specialist rather than building directly:
`ghl-workflow-specialist` (workflows) and `ghl-pipeline-specialist` (pipelines)
both recon, blueprint, and get explicit approval before building — follow the
specialist contract instead of duplicating it here.

## Auditor

For a whole-account health check, use `/uxie-ghl-factory:audit` instead of building or
diagnosing surface-by-surface — it runs a read-only, two-altitude (defect +
opportunity) sweep across all 8 surfaces and produces a Mermaid system map
plus an impact-ranked report.
