---
name: create-ghl-workflow
description: Use when programmatically creating, building, or publishing a GoHighLevel / HighLevel workflow, or adding triggers/actions/steps to one, via the internal builder API — e.g. "create a GHL workflow", "add a webhook/email step via API", "build a HighLevel automation programmatically", or when a workflow step created via API saves but won't open in the builder. Write counterpart to get-ghl-workflow-json (read-only). Draft-first; publish is opt-in and gated on user confirmation.
---

# Create GHL Workflow (internal builder API + compiler engine)

> **MCP routing:** If the `uxie-ghl-internal-mcp` server is registered in this session, prefer its `build_workflow` / `edit_workflow` / `publish_workflow` tools over running this skill's scripts directly — the tools wrap this same engine behind confirmation gates and round-trip verification. Fall back to this skill's own scripts when the server is not registered.

Build HighLevel workflows by compiling a natural-language intent into an **IR**
(a nested tree of named nodes) and letting the engine emit + POST the exact
builder-API payloads. The public v2 API cannot create workflows; the builder
iframe uses these undocumented `backend.leadconnectorhq.com` routes.

**You describe intent as IR. The engine does everything else** — UUIDs, graph
wiring, casing, situational fields, dependency pre-creation, name→ID resolution,
build, and round-trip verify. You do NOT hand-write UUIDs, `parentKey`, field
soup, or raw API calls.

## Before you author a step: read its card

`search_step_types` then `describe_step_type` give you the **real field set** for any of the 284
documented step and trigger types — every field, its type, whether it is required, its default,
and the notes that matter.

```
search_step_types   { intent: "update a contact field" }   → ranked stubs
describe_step_type  { type: "update_contact_field" }        → the full card
```

**Do this instead of mirroring `catalog/step-examples/`.** An example is one capture, so it pins
**one value of every discriminator** — copy it and you get a step that saves, appears on the
canvas, and does the wrong thing. The card carries the union; the example carries one member of
it. 29 documented types ship no example at all.

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

(This rule is for CREATING a new workflow. To EDIT an existing one — add/delete/modify
steps — use `scripts/edit.mjs`, see "Editing an existing workflow" below.)

## Know what you can build — check before you say "can't"

The catalog is **complete**: 383 step types / 204 trigger types (the live-proven subset
is flagged ✅ in the index; `scripts/query-catalog-cli.mjs` prints the current counts). If you're about to tell the user a step or trigger
"isn't supported", or about to fake a native action with a webhook/custom-code
workaround, **check the catalog first** — your recall of GHL's action list is
incomplete; the catalog is the truth:

```
node scripts/query-catalog-cli.mjs <term>    # e.g. "notification", "opportunity", "reply"
node scripts/query-catalog-cli.mjs           # coverage summary
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
   **NOT** `token-id`. Save the captured `Authorization: Bearer …` line to the file
   `scripts/build.mjs` reads — set `GHL_TOK_FILE=<path>` (recommended) or drop it at
   the default `plugins/.playwright-mcp/tok.txt`. JWT ~1 hr, so it WILL expire mid-run: on 401,
   re-capture it YOURSELF (invoke `uxie-ghl-factory:internal-connect`) and resume where you left
   off. Do not ask first. One re-capture per failure — never retry-loop.
3. **Draft-first.** Everything builds as `draft`. Publish is a separate, opt-in
   `--publish` run gated on explicit user confirmation.

## Which reference for which job

`SKILL.md` is the router. Load only what the task needs — these are big files.

| The job | Read |
|---|---|
| Author a new workflow: the IR shape, settings, sticky notes, object workflows, step outputs, inbound-webhook samples, custom code | `references/authoring-ir.md` |
| Change a workflow that already exists: retype a step, insert before the first, multipath containers, edit triggers, the dead-branch guard | `references/editing.md` |
| The exact field set for one step or trigger type | **`describe_step_type`** (the tool — not a file) |
| Build one of the recipes end to end | `references/build-recipe.md` |
| Marketplace / third-party steps and triggers | `references/marketplace-steps.md` |
| What a step's stored shape must look like, and why mirroring one example misleads | `references/step-shapes.md` |
| Everything the engine can build | `references/capabilities.md` |
| Confirm a build actually took on a live account | `references/canary-verification.md` |
| Does the builder open this step? | `references/drawer-parity.md` |
| Find the ids the builder needs | `references/discovery.md` |
| GoGHL WhatsApp specifics | `references/goghl-whatsapp.md` |

## Read the build report — every time

- `webhookUrls[]` — for every `inbound_webhook` trigger: the receiving URL + the server-assigned `triggerId` (hand the URL to the external system; pin a sample with `pin_webhook_sample`).
- `webhookPins[]` — when `pinWebhookSample` was set: per trigger the pinned `requestId`/`referenceId` and the merge tags now live (or `error`).
- `customCodeTests[]` — per `custom_code` step: sandbox `passed`, real `outputKeys` vs `authoredKeys`, `errorMessage`; `replacedOutput:true` means the saved step carries the sandbox result.

The orchestrator prints exactly what it did. Check it:
- `ABORTED: Missing account dependencies …` → a pipeline/calendar/user/form/agent
  you named doesn't exist. Tell the user; look it up or create it — see
  `references/discovery.md` for the MCP lookups/creates per dependency type — then
  rebuild (or `--ignore-unresolved` to force a build that points at nothing — rarely
  what you want).
- `created tags: …` / `created email templates: …` → dependencies it made for you.
- `round-trip: N clean` with `ISSUES: …` → a step's fields were dropped by the
  server (a shape problem) — investigate before calling it done.
- `triggers: { posted, failed }` → trigger POSTs are retried through the
  post-auto-save settle race ("Workflow not found" 400s); anything in `failed`
  after retries means the workflow has NO working trigger — fix before done.
- `UNRESOLVED (built anyway): …` → only appears with `--ignore-unresolved`.

## What the engine guarantees, so you do not have to

These were once warnings. They are now 147 throw sites and a compiler, so an agent going through
`build_workflow` / `build.mjs` **cannot** get them wrong. They are listed as guarantees rather than
gotchas because a warning about an enforced rule implies you are responsible for it, and you are
not — it sends you checking something that cannot fail.

| Guaranteed | How |
|---|---|
| `Authorization: Bearer`, never `token-id` | the gateway attaches auth after any caller override, so it cannot be shadowed |
| build order: deps → create → auto-save → trigger → publish | the orchestrator owns the sequence; steps go through `/auto-save`, never the plain PUT |
| `if_else` carries `attributes.conditionName` | the compiler sets it (without it the node renders "undefined") |
| trigger casing — root `workflowId` camelCase, `location_id`/`company_id` snake | the compiler's casing-lint, `CASING` |
| condition shapes | author SIMPLE intent (`{conditionType, tag}` / `{conditionType, stage}`); `normalizeCondition` emits the stored four-key shape per type. Never hand-craft the tag/stage shape |
| trigger filters | author lean intent; the engine expands to `{field, operator, value, title, type}` |
| opportunity association | `OPP_UNASSOCIATED` hard-fails a build whose `update_opportunity` has no opp trigger, no prior `create_opportunity`, and no `find_opportunity` Found branch |
| missing account dependencies | the build ABORTS before creating anything, naming what is missing |
| dropped subtrees | `authored` / `compiled` / `round-trip` are reported together, because round-trip alone compares sent-vs-got and once hid a dropped 51-step subtree |

**Mirror, don't invent** is the one doctrine here that is only half-enforced: the compiler injects
`workflowsActionType:INTERNAL` / `stepIndex` where the corpus shows them, but nothing stops you
adding `cat`/`parent`/`sibling`/`nodeType` yourself. Don't.

## What the engine does NOT catch — these are yours

The list above is long, which makes this one easy to skim past. Don't: everything below produces a
workflow that builds clean, verifies clean, and behaves wrongly at runtime.

- **A `DEAD_BRANCH` abort is a question, not an obstacle.** The engine tells you a branch now ends
  at END; only you know whether that is the routing you meant. Do not reflexively pass
  `--ack-dead-branch` — the inverse shipped once and the normal path silently released nothing.
- **Edit-mode has three unchecked opportunity cases.** `editCommitBody` throws when an edit CREATES
  an unassociated `internal_update_opportunity`, but it does not catch moving an existing update
  out of a Found scope, deleting the `create_opportunity` it depends on, or raw template mutation
  that skips `editCommitBody`. Verify those yourself.
- **`workflow_id` takes an ID, not a name.** The engine does not resolve it and the validator does
  not check it exists, so a wrong id publishes clean and silently no-ops at runtime.
- **Marketplace steps build fine and only RUN if the app is installed** on that location. 282 of the
  385 step types are marketplace; a build is not a proof it will fire.
- **A step type's card, not its example.** An example is one capture, so it pins one value of every
  discriminator. `describe_step_type` carries the union.
- **Publishing is never implied.** Everything builds as `draft`; `--publish` is opt-in and gated on
  the user's explicit OK.
- `DELETE /workflow/{loc}/{wid}` works — use it to tear down throwaway builds rather than leaving
  them on the account.

## Red flags — STOP

- About to POST create/auto-save/trigger by hand → use `build_workflow` (or `scripts/build.mjs`).
  Through the tool this is not reachable; it stays here for anyone driving the API directly.
- Build report says `created tags: (none needed)` but your workflow uses new tags →
  something's wrong; the orchestrator should have created them.
- About to ignore an `ABORTED` / `UNRESOLVED` line → don't; that's a missing dependency.
- About to `--publish` without the user's explicit OK → stop.
- Got a 401 → the JWT expired. Re-capture it yourself via `uxie-ghl-factory:internal-connect`
  and resume; this is not a reason to stop or to ask.
- About to add `update_opportunity` with no opp trigger, no prior `create_opportunity`, and outside a `find_opportunity` Found branch → the engine aborts with `OPP_UNASSOCIATED`; build find-or-create first.
- Got `DEAD_BRANCH` on a commit → do NOT reflexively pass `--ack-dead-branch`. Read which branch took the existing chain and which one now ends at END, and confirm that is the routing you meant. This guard exists because the inverse shipped once and the normal path silently released nothing.
- Adding an opportunity step via EDIT-MODE → `editCommitBody` now throws `OPP_UNASSOCIATED` when the edit CREATES an unassociated `internal_update_opportunity`; pass `assumeAssociated: true` only after verifying ALL the workflow's triggers are opportunity-based. Still unchecked: moving an existing update out of a Found scope, deleting the `create_opportunity` it depends on, or raw template mutation that skips `editCommitBody` — verify those yourself.

## Resources

- `references/goghl-whatsapp.md` — the GoGHL.ai WhatsApp app: its 10 actions/11 triggers, the `#btn`/`#list` interactive syntax (compile-linted), spintax rules, and the ban-protection discipline (drip timings, 5-phase warm-up, the mandatory failure/disconnect monitor workflow). Read it before ANY WhatsApp build on an account using GoGHL.
- `references/drawer-parity.md` — what the UI's config DRAWERS write that models alone don't say: per-type stamps, normalizations and traps (assign_user's agreeing quad, webhook's unguarded url, custom_code's online-only output, the find_contact presence flip, attribute-discarding drawers…). Read it before hand-crafting attributes for a type the examples don't cover.

- `scripts/build.mjs` — **the entry point.** IR → verified draft, deps handled.
- `engine/` — IR parser, compiler, catalog, resolver, orchestrator (+ tests).
- `references/capabilities.md` — generated index of ALL 383 step / 204 trigger types
  with attribute keys and filter fields; `scripts/query-catalog-cli.mjs` searches it.
- `references/build-recipe.md` / `references/step-shapes.md` — endpoint/payload truth
  and the mirror-don't-invent doctrine (background; the engine already applies them).
- `references/marketplace-steps.md` — authoring a third-party (marketplace) trigger or
  action with `marketplace: true`: the install check, required-field/operator guards,
  the trigger-only drift limitation, and the `contact_engagement_score` key collision.
- `references/discovery.md` — how to look up / create a missing account dependency
  (forms, custom fields, calendars, …) via the MCP after an `ABORTED` report.
- `scripts/edit.mjs` — edit-mode entry point (GET → apply ops → plain-PUT commit).
- `engine/edit.mjs` / `engine/edit-driver.mjs` (+ tests) — the edit ops + pure driver.
- `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`, `docs/write-rails.md` — auth + gates.
- Inspect/export an existing workflow → the `get-ghl-workflow-json` skill.
