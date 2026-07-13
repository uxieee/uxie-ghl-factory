---
name: create-ghl-workflow
description: Use when programmatically creating, building, or publishing a GoHighLevel / HighLevel workflow, or adding triggers/actions/steps to one, via the internal builder API — e.g. "create a GHL workflow", "add a webhook/email step via API", "build a HighLevel automation programmatically", or when a workflow step created via API saves but won't open in the builder. Write counterpart to get-ghl-workflow-json (read-only). Draft-first; publish is opt-in and gated on user confirmation.
---

# Create GHL Workflow (internal builder API + compiler engine)

Build HighLevel workflows by compiling a natural-language intent into an **IR**
(a nested tree of named nodes) and letting the engine emit + POST the exact
builder-API payloads. The public v2 API cannot create workflows; the builder
iframe uses these undocumented `backend.leadconnectorhq.com` routes.

**You describe intent as IR. The engine does everything else** — UUIDs, graph
wiring, casing, situational fields, dependency pre-creation, name→ID resolution,
build, and round-trip verify. You do NOT hand-write UUIDs, `parentKey`, field
soup, or raw API calls.

## The one rule that matters most

**ALWAYS build through `scripts/build.mjs` (→ the orchestrator).** Never
hand-assemble `create`/`auto-save`/`trigger` calls yourself. The orchestrator is
the only path that pre-creates dependencies and resolves names — skip it and you
get the classic failure: *a workflow that references tags/pipelines/calendars
that were never created, so it silently does nothing at runtime.*

```
node scripts/build.mjs <ir.json> <LOC> [--publish] [--ignore-unresolved]
```

It: resolves every human name → the account's real ID → **aborts loudly if an
account dependency is missing** → **auto-creates tags + inline email templates**
→ compiles → creates a DRAFT → auto-saves steps → creates triggers → round-trip
verifies → prints a report. Publish only with `--publish`, only after the user OKs.

## Know what you can build — check before you say "can't"

The catalog is **complete**: 316 step types / 59 trigger types (62 native steps +
58 native triggers live-proven). If you're about to tell the user a step or trigger
"isn't supported", or about to fake a native action with a webhook/custom-code
workaround, **check the catalog first** — your recall of GHL's action list is
incomplete; the catalog is the truth:

```
node engine/query-catalog.mjs <term>    # e.g. "notification", "opportunity", "reply"
node engine/query-catalog.mjs           # coverage summary
```

Full scannable index (every type, with attribute keys and trigger filter fields):
`references/capabilities.md`. Marketplace-app steps (219 of the 316) build fine but
only RUN if the app is installed on the location. A catalog miss doesn't prove GHL
lacks the type — harvest a live example (`scripts/harvest-step.js`) and extend the
catalog rather than improvising a shape.

## Before any write

1. Run BOTH gates in `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md`
   (OWNED-ACCOUNT CHECK every session; TOS DISCLOSURE once per workspace).
2. Auth: `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`. `Authorization: Bearer`,
   **NOT** `token-id`. Save the header line to `../.playwright-mcp/tok.txt`. JWT
   ~1 hr; on 401 mid-run stop, re-capture, resume — never retry-loop.
3. **Draft-first.** Everything builds as `draft`. Publish is a separate, opt-in
   `--publish` run gated on explicit user confirmation.

## Authoring the IR

Write intent, using **human names** — the resolver turns them into IDs:

```yaml
name: "VIP nurture"
triggers:
  - { ref: t1, type: contact_tag, name: "VIP added",
      filters: [ { field: tagsAdded, value: "VIP" } ] }   # lean filter → engine expands
graph:
  - { ref: a, kind: action, type: add_contact_tag, name: "Tag welcomed",
      attributes: { tags: ["welcomed"] } }                # new tags auto-created
  - { ref: o, kind: action, type: create_opportunity, name: "Open deal",
      attributes: { name: "Deal", pipeline: "Sales", stage: "New Lead", status: open } }  # names → IDs
  - ref: b
    kind: if_else
    name: "High value?"
    branches:
      - { ref: y, name: "Yes", conditions: [ { conditionType: contact_detail, conditionSubType: tag, conditionOperator: contains, conditionValue: high-value } ], then: [ ... ] }
      - { ref: n, name: "No", else: true, then: [ ... ] }
```

- **Node kinds:** `action` (any linear type), `wait`, `if_else` (N≥2 branches, one
  optional `else: true`), `split` (`workflow_split`, weighted/random), `ai_decision`
  (`workflow_ai_decision_maker`, Default + N branches), `goto` (must be last in its
  branch). Pre-set 2-branch finders (`find_contact`/`find_opportunity`/`lc_merge_contact`)
  use `onFound`/`onNotFound`.
- **Names the resolver understands:** `attributes.pipeline`/`stage` (opportunity
  steps), `attributes.user` (assign_user), `attributes.calendar` (appointment_booking),
  `attributes.assignedTo` (task), `attributes.agent`/`employee` (voice/ConvAI), and
  trigger filter values referencing pipeline/form/calendar/survey names.
- **Inline emails:** put `attributes._template: { title, html, previewText }` on an
  `email` node — the orchestrator creates the template first and links it.
- **Coverage:** 316 step types / 59 trigger types are catalogued; 62 native steps +
  58 native triggers are live-proven. Full index: `references/capabilities.md`;
  per-type lookup: `node engine/query-catalog.mjs <term>`.

## Read the build report — every time

The orchestrator prints exactly what it did. Check it:
- `ABORTED: Missing account dependencies …` → a pipeline/calendar/user/form/agent
  you named doesn't exist. Tell the user; create/rename it (or `--ignore-unresolved`
  to force a build that points at nothing — rarely what you want).
- `created tags: …` / `created email templates: …` → dependencies it made for you.
- `round-trip: N clean` with `ISSUES: …` → a step's fields were dropped by the
  server (a shape problem) — investigate before calling it done.
- `UNRESOLVED (built anyway): …` → only appears with `--ignore-unresolved`.

## Critical gotchas (the engine handles these — don't re-introduce them)

- `Authorization: Bearer`, **NOT** `token-id`.
- Order is fixed: **deps → create → auto-save (steps) → trigger → publish.** Steps go
  through `/auto-save`, never the plain PUT.
- **Mirror, don't invent** step fields — the catalog carries verified-live shapes; the
  compiler injects `workflowsActionType:INTERNAL` / `stepIndex` only where the corpus
  shows them. Never add `cat`/`parent`/`sibling`/`nodeType` yourself.
- `if_else` container needs `attributes.conditionName` or the node renders "undefined"
  (compiler sets it). `goto` must be the last node in its branch.
- Trigger casing: root `workflowId` **camelCase**; `location_id`/`company_id` snake.
  The compiler's casing-lint enforces this.
- Filters: trigger conditions are `{field, operator, value, title, type}` (engine
  expands lean intent filters); `if_else` conditions use a different shape
  `{conditionType, conditionSubType, conditionOperator, conditionValue}`.
- `DELETE /workflow/{loc}/{wid}` works (confirmed) — used for clean teardown of
  throwaway/failed builds.
- **Opportunity actions need an associated opportunity.** `update_opportunity` is a runtime no-op unless the contact entered via an opportunity trigger (`opportunity_created`, `opportunity_status_changed`, `opportunity_changed`, `pipeline_stage_updated`, `opportunity_decay` — and ALL triggers must be opp-based, a mixed set doesn't count), or the path already ran `create_opportunity`, or the step sits in a `find_opportunity` **Opportunity Found** branch. The engine hard-fails with `OPP_UNASSOCIATED` otherwise — build the find-or-create pattern (see `references/build-recipe.md` §6). `assocGuaranteed: true` on the node/branch is the escape hatch for shapes the checker can't prove (trigger-identity if/else, goto convergence).

## Red flags — STOP

- About to POST create/auto-save/trigger by hand → use `scripts/build.mjs`.
- Build report says `created tags: (none needed)` but your workflow uses new tags →
  something's wrong; the orchestrator should have created them.
- About to ignore an `ABORTED` / `UNRESOLVED` line → don't; that's a missing dependency.
- About to `--publish` without the user's explicit OK → stop.
- Got a 401 → JWT expired; re-capture and resume.
- About to add `update_opportunity` with no opp trigger, no prior `create_opportunity`, and outside a `find_opportunity` Found branch → the update will silently do nothing at runtime; build find-or-create first.
- Adding an opportunity step via EDIT-MODE → `editCommitBody` now throws `OPP_UNASSOCIATED` when the edit CREATES an unassociated `internal_update_opportunity`; pass `assumeAssociated: true` only after verifying ALL the workflow's triggers are opportunity-based. Still unchecked: moving an existing update out of a Found scope, deleting the `create_opportunity` it depends on, or raw template mutation that skips `editCommitBody` — verify those yourself.

## Resources

- `scripts/build.mjs` — **the entry point.** IR → verified draft, deps handled.
- `engine/` — IR parser, compiler, catalog, resolver, orchestrator (+ tests).
- `references/capabilities.md` — generated index of ALL 316 step / 59 trigger types
  with attribute keys and filter fields; `engine/query-catalog.mjs` searches it.
- `references/build-recipe.md` / `references/step-shapes.md` — endpoint/payload truth
  and the mirror-don't-invent doctrine (background; the engine already applies them).
- `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`, `docs/write-rails.md` — auth + gates.
- Inspect/export an existing workflow → the `get-ghl-workflow-json` skill.
