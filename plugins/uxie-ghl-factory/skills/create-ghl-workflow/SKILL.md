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

> **Diagnostics and review (w6d-9):** before creating a workflow that listens for a trigger type, run the trigger-overlap check: `find_workflows_using` for those types, then pipe its data into `node scripts/trigger-overlap-cli.mjs` (the result says WILL, "might also fire" or CANT per workflow; the filters are compared statically, no event is simulated; pass each hit's triggers, see diagnostics.md). For the impact question "what uses this tag/form", run `get_workflow_linked_assets` with `forAsset: {type, value}` (type `tags`, `forms`, `calendars`, …); it lists the workflows that use that asset, by step, and says `complete:false` when the walk stopped short. Unnarrowed it lists only workflows that use an asset, so it is not a workflow count (use `list_workflows`). After a build or an edit, before publishing: `check_workflow`, then the client's `.ghl/<locationId>/lint-pack.json` if there is one. The read and gated tools (heat map, journeys, step counts, A/B stats, test results, error alerts, restore, publish) and when to use each are in `../ghl-workflow-specialist/references/diagnostics.md`.

## Before you author a step: read its card

`search_step_types` then `describe_step_type` give you the **real field set** for any of the 524
documented step and trigger type cards (every marketplace step key has its own) — every field, its type, whether it is required, its default,
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
node scripts/build.mjs <ir.json> <LOC> [--publish] [--ignore-unresolved] [--dry-run]
```

It: resolves every human name → the account's real ID → **aborts loudly if an
account dependency is missing** → compiles → runs every check (the validation gate,
GHL's validate-assets, engine references, the custom-code sandbox) → only then
**auto-creates tags + inline email templates** → creates a DRAFT → GHL's server
validator on the empty draft → auto-saves steps → creates triggers → round-trip
verifies → prints a report. Publish only with `--publish`, only after the user OKs.

A refused check creates nothing. If GHL's server validator refuses, the empty draft is
renamed `[REFUSED] <name>` and the report lists what was left behind (`leftovers`: the
draft, the tags and the templates it created). **Check a spec before building:**
`--dry-run` here, `build_workflow {dryRun:true}` or `validate_workflow {spec}` on the
MCP. They run every check, create nothing, and answer `{valid, errors:[{code, path,
stage, context}], warnings, wouldCreate}`. The server validator needs a workflow, so a
dry run says it did not run.

**Filing into a folder:** add `folderPath: ["Clients", "Acme"]` (exact folder names, outermost first) to the spec, plus
`createFolderIfMissing: true` to create the levels that don't exist. Missing folders are created only after every check
passes, and the workflow is created inside the folder (GHL honours `parentId` on create). A path where two folders share a
name at one level is refused before anything is written.

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
`references/capabilities.md` (its `premium` tag on `text_formatter` / `datetime_formatter` is stale: GHL's 09-29 builder does
not mark them premium, and `ai_agent` is no longer beta — trust the type cards until the catalogue is re-pinned). Marketplace-app steps (219 of the 316) build fine but
only RUN if the app is installed on the location. A catalog miss doesn't prove GHL
lacks the type — harvest a live example (`scripts/harvest-step.js`) and extend the
catalog rather than improvising a shape.

**`leadgen_ecommerce_add_to_cart` has no engine type and no tool path.** The engine cannot author it yet (no engine change in Phase 1; the missing type is backlog bl-942). The workflow save route writes it: `raw_request` on `PUT /workflow/{locationId}/{workflowId}` carries a trigger row with `type` set to the GHL name, `config` null and a `conditions` list (the proof sends `duration`, `cartValue`, `orderSource`, `subSource`, `globalProductIds`, `storeId` and `checkoutCompleted`). Read the row back on a separate GET. A run is not proven: the sandbox rules forbid the store event that would fire it. Built and persisted: sniff `live-3BT-wave16-reruns.json` (2026-09-28).

**`leadgen_ecommerce_product_viewed` has no engine type and no tool path.** Same as add-to-cart: no engine change in Phase 1 (backlog bl-942), written by `raw_request` on `PUT /workflow/{locationId}/{workflowId}` with a `type` and `config` null, and the sent condition fields `duration`, `globalProductIds`, `orderSource`, `subSource`, `checkoutCompleted` and `storeId`. Read the row back on a separate GET. A run is not proven: the sandbox rules forbid the store event that would fire it. Built and persisted: sniff `live-3BT-wave16-reruns.json` (2026-09-28).

## What GHL can do that this plugin deliberately does not author

These are real GHL capabilities, left out by the operator's decision (2026-09-23), not gaps. When a
user's task needs one, **say that GHL can do it**, say the plugin does not do it and why, and point
them to where it lives in the UI. Never report it as impossible, and never build a workaround.

| Capability | Where the user does it | Why the plugin does not |
|---|---|---|
| **Scheduled pause** of a workflow for a date window (for example, a holiday closure) | The workflow's **Settings** tab → **Pause workflow** panel → **Global Workflow Settings**, where pause windows are scheduled | Operator decision. It is a scheduled UNPUBLISH plus re-publish, and contacts already at a wait step keep moving through it. `get_workflow_settings` reads existing windows, and a paused workflow carries `paused: "workflow-scheduled-pause"`: never "finish" it by publishing. |
| **MCP server connections** for an AI Agent step | The AI Agent step → **MCP servers** panel | They store credentials for an external server. `get_ai_agent_options` lists the connections that exist. |
| **GHL's own AI workflow builder** (the in-builder assistant: **Build**, **Edit**, **Chat**, **Point & edit**, **Start fresh / Create new workflow**, clarification questions, **Set up with AI** on a Wait or AI Agent step, **Learn more**, **Resolve with AI**, undo and restore of an AI change, thumbs feedback, voice dictation), plus the floating AI assistant on the Settings, Enrollment History and Execution Logs tabs, and its skill drafts | The builder's AI assistant (left rail, ✦ Workflow AI); the tab assistant's floating button. The tab assistant is gated to allowlisted companies until GHL's public release | This plugin is the builder. About twenty turns on 2026-09-30 left the location's AI usage snapshots flat (the wallet was not read, and `get_premium_usage`'s `workflow_ai` key is not a real tier: GHL echoes any string), so do not tell a user it is free or that it is billed. The AI changes the stored workflow only when the builder's **Save** is clicked, but it renames the workflow, points steps at tags that do not exist, and on **Start fresh** leaves the old triggers in place, so an AI-built workflow needs review. |
| **Emailing execution logs as a CSV** | The workflow's execution **History** page → **Export**. The button shows for agency users, and only from 2026-10-25 (GHL's release gate) | It is a SEND to explicit recipients with a 15-minute cooldown. `get_workflow_logs` reads the same logs directly. The API already accepts the request from a sub-account before the button appears (measured 2026-09-29), so this is a choice, not a limit. |
| **Folder permissions** (who can open a folder, and its workflows) | Workflows list → folder menu → permissions | No tool: it is a location-wide access change. `raw_request` reaches `PUT /workflow/{loc}/permissions`; the route and its values are on the corpus endpoints page. |
| **Starting a workflow from one of GHL's recipes** | Create workflow → **Select from Template** (recipes) | `build_workflow` does not take a `recipeId`. The server fills the steps and REPLACES the name with the recipe's title, and creates no trigger. `list_workflow_templates` lists the recipes. |
| **Loading a template from the agency's template library** | Create workflow → **Select from Template** (library) | Library templates belong to the agency, and a load may update a counter on the agency's own object, so it is not run on test accounts. |
| **Importing a workflow from a legacy campaign** | Create workflow → **Import from a campaign** | The modal lists legacy campaigns, which can no longer be created; the sandbox has none. |
| **Deleting workflows** (one, or a bulk selection) | Workflows list → row menu, or select rows → bulk **Delete**. They move to the **Deleted** tab and are kept 30 days | Deletion is reserved for a human by standing rule. The routes are fenced in the catalogue. |
| **Restoring deleted workflows** | Workflows list → **Deleted** tab → **Restore**. Admins only. The UI offers it 30 minutes after the delete, and the workflow comes back as a **draft** | The plugin never deletes. The 30-minute wait is a UI rule only: the server restored at once (live 2026-09-28). |
| **Publishing from the workflow list** (single or bulk) | Workflows list → select rows → **Publish** | That path skips GHL's publish gate: none of the builder's checks run. Publish through `publish_workflow`, which runs the gates. Drafting from the list is safe, and `unpublish_workflows` does the same thing. |
| **Workflow Maps** (the map view: filters, search, refresh, deep links, 2D/3D and zoom controls) | Automation → Workflows → **Maps**, when GHL's `workflowGrid` feature is on for the account | It is a view, not something to author. `list_workflows`, `find_workflows_using` and `get_account_workflow_overview` read the same workflows, assets and issues. |
| **The location's default builder, who may switch builders, and the AI Builder switch** | Automation → **Global Workflow Settings** (agency users; the AI Builder switch is on the same page) | Location-wide settings with no DELETE route: once saved, a location can never go back to an unset record, only to explicit defaults. `get_workflow_settings` reads them. |
| **The flow-bot setup page** (making a Conversation AI bot's flow workflow) | AI Agents → the Conversation AI bot → its flow setup, which opens `automation/setup-workflow` | Opening it creates a PUBLISHED workflow with an active *Chat Initiated* trigger and points the bot at it. Build a flow draft with `build_workflow` (`workflowType: agent`) instead. |
| **A per-workflow sending domain** | The workflow's **Settings** tab → sending domain | It needs a verified sending domain on the location, which is a purchase. `raw_request` reaches `GET /workflow/{loc}/email/domain-selection`. |
| **Save version** on the builder's Version history panel | Version history → Current version (Auto-Saved) → **Save version**. It shows only with the location's auto-save on | It commits an auto-save and is a person's checkpoint. Builds already go through the auto-save route. `list_workflow_versions` and `restore_workflow_version` cover history. |
| **The onboarding page** for a location with no workflows, and its shortlist of starter workflows | Automation → Workflows on a location that has none | It shows only in a location with no workflows, and no sandbox is empty. It is a set of templates, not something to author. |
| **Manage tokens** (a workflow's stored OAuth2 tokens for third-party steps) | The workflow Settings tab, when the location has stored tokens | A token comes from a third party's authorisation, which the plugin does not store. `get_ai_agent_options` lists an AI Agent step's MCP connection tokens. |
| **The Mention tool and the trigger-links icon in a rich-text field** | The message editor of an SMS or a marketplace step (internal comment): **@** Mention, lightning icon for trigger links | A picked mention is stored as plain text, `@{{user.name}}[[uid:{{user.id}}]]` for the assigned user; write that string. The Mention list ignores paging and search. |
| **Premium opt-in, rebilling and plans** for the workflow premium and AI features | Agency settings → Workflow premium features / external AI models; Automation Settings → View plans | Billing changes are excluded. Build and edit preflight read the opt-in gate, and `get_premium_usage` reads consumption. |
| **Template listing settings** (a workflow's template categories and description) | The workflow's **Settings** tab, shown only on a template (snapshot-source) location | The plugin does not publish templates. Those fields do not exist on an ordinary location. |
| **The AI builder chat test** | Automation → Workflows → the AI builder, the chat test panel | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **The AI builder's named-account lookup** | Automation → Workflows → the AI builder, when it looks up an account by name | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **Workflow Maps linked canvas** | Automation → Workflows → Maps → the linked canvas view | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **Workflow Maps AI assistant** | Automation → Workflows → Maps → the AI assistant | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **Workflow Maps guided onboarding** | Automation → Workflows → Maps → the guided onboarding | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **The AI Agent web search switch** | The AI Agent step → its web search switch | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **Attaching a skill to an AI Agent step** | The AI Agent step → its skills panel | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **AI Agent hosted chat** (the shared-agents route) | The AI Agent's hosted chat page, from the agent's sharing settings | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **The AI Video Generation action** | The workflow's action list → AI Video Generation, in the GHL UI | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **The AI Analyze Video action** | The workflow's action list → AI Analyze Video, in the GHL UI | UI-only in this build: no tool exists for it yet (backlog bl-945). Do it in the GHL UI and tell the user; do not try to author, toggle or read it through a tool. |
| **Maps saved layout** ("Rearrange layout", then "Save N changes") | Automation → Workflows → Maps → Rearrange layout → Save changes | UI-only in this build: no internal tool in W9 (see `console/domain/workflows-ui-only.md`; backlog bl-945). The layout store is written by the UI save, not by a tool. Do it in the GHL UI and tell the user. |
| **Maps folder colour** (plane menu, Change folder color) | Automation → Workflows → Maps → a folder's plane menu → Change folder color | UI-only in this build: no internal tool in W9 (see `console/domain/workflows-ui-only.md`; backlog bl-945). Do it in the GHL UI and tell the user. |
| **Maps sticky notes** ("Add sticky note" toolbar control) | Automation → Workflows → Maps → Add sticky note | UI-only in this build: no internal tool in W9 (see `console/domain/workflows-ui-only.md`; backlog bl-945 and bl-985). The sticky note is not in the layout store, so no tool sets it. Do it in the GHL UI and tell the user. |
| **The sender name shown in Settings** (the from name at send time) | Settings → the sender name for workflow messages | Warn, do not promise it: `build_workflow` accepts a sender address with a from name, but the from name does not show at send time. Set the sender name in the GHL UI and tell the user (backlog bl-959). |

**Not proven in this build (no claim to the user).** These three are not verified, so do not tell the user they work. Say what you tried, and check them in the GHL UI.
- **The Abandoned Checkout trigger:** the draft saves, but its run needs a public checkout that this build has not exercised (backlog bl-1015).
- **The location_owner merge tags** (owner first name, last name, email): they render empty on the TEST sandbox because that location has no owner record, so their rendered value is not proven (backlog bl-1016).
- **The custom-object variant of Send SMS** (a Send SMS step on a custom-object trigger): the variant is not in the Add action picker on the probe drafts, and GHL enables it for all accounts on 2026-11-10, and it is not proven in this build (backlog bl-890).

## Which rail, per job

GHL's public workflow API is allow-listed: on the sandbox it answered 403 "not enabled for location" for a definition,
and its workflow list leaves out typed workflows (agent, business, custom-object). Every job runs on the internal rail.

<!-- rail-ledger:workflows -->
_generated from knowledge/catalog/rail-ledger.json — do not edit; the whole ledger is `ghl-orientation/references/rail-ledger.md`._

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided-public-not-released | internal | `list_workflows`, `get_workflow`, `export_workflow` | `workflows-v3__get-workflow`, `workflows-v3__get-workflow-definition`, `workflows-v3__search-workflows` |
| create | undecided-public-not-released | internal | `build_workflow`, `duplicate_workflow`, `copy_workflow_to_location` | `workflows-v3__create-workflow` |
| edit | undecided-public-not-released | internal | `edit_workflow`, `repair_workflow` | `workflows-v3__update-workflow-definition`, `workflows-v3__validate-workflow-definition` |
| publish | undecided-public-not-released | internal | `publish_workflow`, `unpublish_workflows` | `workflows-v3__update-workflow-status` |
| delete | undecided-public-not-released | internal | `raw_request:DELETE /workflow/{locationId}/{workflowId}` | `workflows-v3__delete-workflow` |
| logs | undecided-public-not-released | internal | `get_workflow_logs`, `get_workflow_stats`, `get_workflow_runtime_window` | `workflows-v3__get-workflow-logs`, `workflows-v3__get-workflow-log-statistics` |

- **read:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **create:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **edit:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **publish:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **delete:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **logs:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.

Internal only: steps, triggers, settings via the builder document; versions and restore; trash; bulk unpublish; enrol-stats and runtime windows.
Public only: server-side publish gate; logs/aggregate that refuses to truncate.
<!-- /rail-ledger:workflows -->

## Before any write

1. Run BOTH gates in `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md`
   (OWNED-ACCOUNT CHECK every session; TOS DISCLOSURE once per workspace).
2. Auth: `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`. `Authorization: Bearer`,
   **NOT** `token-id`. Save the captured `Authorization: Bearer …` line to the file
   `scripts/build.mjs` reads — set `GHL_INTERNAL_TOK_FILE=<path>` (recommended) or drop it at
   the default `plugins/.playwright-mcp/tok.txt`. JWT ~1 hr, so it WILL expire mid-run: on 401,
   re-capture it YOURSELF (invoke `uxie-ghl-factory:internal-connect`) and resume where you left
   off. Do not ask first. One re-capture per failure — never retry-loop.
3. **Draft-first.** Everything builds as `draft`. Publish is a separate, opt-in
   `--publish` run gated on explicit user confirmation. Before a publish, state once what goes live: the workflow's name, its trigger, and each step that sends (email, SMS, call, webhook). Then wait for an explicit yes. Urgency ("publish it now", "I'm in a hurry") is not that yes.
   Through the MCP server, `publish_workflow` is two-step (bl-946): the first call, with `confirm:true` and no token, publishes nothing and returns a preview and a short-lived `data.confirmationToken`; only a second call with `confirm:true` and that token publishes. A `confirm:true` call without a valid token never publishes. So the order is: first call, show the user the preview's outward steps (the name, the trigger, and each step that sends), wait for their explicit yes, then the second call with the token. The token lasts 5 minutes, works once, and is bound to that workflow and version; if it expires or the workflow changes, start again with the first call.
4. **AI Agent steps: ask, don't default** (Xander, 2026-11-06). Before you build an `ai_agent` step, ask the operator two questions:
   web search on or off (about 1¢ per search, 1.4¢ on Gemini; on = `attributes.nativeTools: [{id, toolName: "web_search", description, attributes: {}}]`,
   off = `nativeTools: []`), and which model. The engine keeps the current model when none is named; `gpt-6-luna` is documented, not defaulted.
   Write the answers into the spec. A spec without them still builds (no web-search key, the current model), and `build_workflow`'s dry run lists
   the unanswered ones as `openQuestions`: ask before you confirm the build.
5. **Never partial-PUT a workflow document.** `PUT /workflow/{loc}/{wid}` replaces the whole document: a body of just `{name, version}` reset `allowMultiple`, dropped `status` and emptied the steps on a draft. Use `edit_workflow`, `rename_workflow` and `publish_workflow`, which read, merge and send everything and read it back.

## Which reference for which job

`SKILL.md` is the router. Load only what the task needs — these are big files.

| The job | Read |
|---|---|
| Author a new workflow: the IR shape, settings, sticky notes, object workflows, step outputs, inbound-webhook samples, custom code | `references/authoring-ir.md` (a custom-code step can be run in the sandbox first with `test_custom_code`, which changes nothing in the account) |
| Change a workflow that already exists: retype a step, insert before the first, multipath containers, edit triggers, the dead-branch guard | `references/editing.md` (read the structure first with `get_workflow_digest`: one compact read of identity, version, steps and merge tags) |
| The exact field set for one step or trigger type | **`describe_step_type`** (the tool — not a file) |
| Build one of the recipes end to end | `references/build-recipe.md` |
| Merge tags in step text: trigger data, `formatList`, dates, `default`, the picker, what the engine refuses | `references/merge-tags.md` |
| The five appointment-family waits, the deprecated `eventStartDate` setting, trigger toggle rows and deprecated operators, reading logs and stats, Save version | `references/waits-settings-triggers.md` |
| Marketplace / third-party steps and triggers: `list_marketplace_apps`, and `describe_marketplace_action` for one action's published schema and whether its app is connected | `references/marketplace-steps.md` |
| Workflow folders: `list_workflow_folders` (read), `create_workflow_folder` and `move_workflows` (writes: move takes workflows between folders and the root) | the tools (no reference) |
| Test runs of a workflow (read only): `list_workflow_test_runs` (GET `/workflow/{loc}/test-workflow/{wf}/event-runs`, newest first) and the step latest-result read (GET `…/test-workflow/{wf}/steps/{stepId}/latest-result`). Starting a test run is not authored here: a test run on a draft runs every step for real on a contact | the tools (no reference) |
| The advanced canvas: what a person's gestures store, that our tools keep canvas layout on edit (proven 2026-09-29), and rescuing a goto that lost its target | `references/advanced-canvas.md` |
| What a step's stored shape must look like, and why mirroring one example misleads | `references/step-shapes.md` |
| Everything the engine can build | `references/capabilities.md` |
| Confirm a build actually took on a live account | `references/canary-verification.md` |
| Does the builder open this step? | `references/drawer-parity.md` |
| Find the ids the builder needs | `references/discovery.md` |
| Build a FLOW BOT: the agent binding, custom (goto) triggers, the nine Conversation-AI nodes, what a flow may contain | `references/flow-bots.md` |
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
| opportunity association | `OPP_UNASSOCIATED` hard-fails a build whose `update_opportunity` has no opp trigger, no prior `create_opportunity_strict`, and no `find_opportunity` Found branch. A native `create_opportunity` does NOT bind its card: an update after it is skipped at run time (live 2026-09-26) |
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
  out of a Found scope, deleting the `internal_create_opportunity` it depends on, or raw template mutation
  that skips `editCommitBody`. Verify those yourself.
- **`workflow_id` takes an ID, not a name.** The engine does not resolve it. GHL's asset
  pre-flight DOES refuse an id that does not exist on the location (`ASSET_WORKFLOW_NOT_FOUND`,
  live-proven on build, edit and repair 2026-09-02) — but only when the pre-flight actually ran:
  a fail-open skip (`assetPreflight.skipped`) or `ignoreAssetErrors` lets a wrong id through, and
  it then publishes clean and silently no-ops at runtime.
- **Marketplace steps build fine and only RUN if the app is installed** on that location. 282 of the
  385 step types are marketplace; a build is not a proof it will fire.
- **`clear_associated_company_fields`: the builder says it skips; it fails.** Its drawer promises
  "If no company is associated, this action will be skipped". On a contact with no company it
  FAILS, and a failed step emails every admin by default. Its sibling `update_associated_company`
  really does skip. Where a company exists, it logs `success` and clears NOTHING, even with the
  builder's own row (live 2026-09-28, twice). No workflow step has been shown to blank a company
  field. `update_associated_company` overwrites a field with a new value (proven); an empty value
  was never run. The engine cannot see any of this: whether a contact has a company
  is runtime data. The company steps' fields live in `__customInputFields__` rows
  (`{filterField: "business.<key>", valueField}`), not in `inputs`. Read the card.
- **`{{form_data.*}}` in an add-notes step renders EMPTY.** On a `form_submission` workflow, `{{form_data.*}}` in an add-notes step rendered empty while `{{contact.*}}` in the same note rendered (two tries, 07:49Z and 08:42Z). The engine warns about `form_data` only when no trigger provides the key, so a clean build does not mean a filled note. Read the rendered note back before you rely on a form answer. The engine warning is tracked as bl-952.
- **The from name does not reach the recipient.** `build_workflow` takes a sender address with a `from_name`, and the stored settings read it back. A test send on 2026-11-09 (12:02:05Z) showed `from_email` applied and the name dropped: the delivered From and Reply-To carried the address only. Set the sender name in the GHL UI and check the delivered header before you promise it (backlog bl-959).
- **Email click tracking skips a link whose href is a contact merge tag.** With
  `trackingOptions.hasTrackingLinks: true`, a literal URL and a `{{custom_values.x}}` href are
  wrapped in tracking redirects, but `href="{{contact.website}}"` goes out raw. Clicks on it are
  never recorded, so a "clicked link" condition or trigger cannot see them (live 2026-09-29). Put a
  literal or custom-value URL where a click must count.
- **A `from_email` on a domain the location cannot send from is rewritten, not dropped.** It goes
  out as `local+domain@<the location's sending subdomain>`, with the From NAME kept. The step's log
  shows the address as authored; read the conversation message to see what was sent (live 2026-09-29).
- **A trigger row or an if/else condition that names a tag must hold it in lower case.** GHL stores every tag lower case, and a
  mixed-case row NEVER MATCHES (live 2026-09-30: two published `contact_tag` workflows, same tag, only the lower-case row enrolled the
  contact; two if/else workflows on the same contact, the lower-case condition took Yes and the mixed-case one took Else). The engine
  lower-cases what it writes; a workflow built earlier, by hand or by API can still carry one. `check_workflow` reports
  `TRIGGER_TAG_CASE` / `IFELSE_TAG_CASE`, `find_workflows_using {problems:"mixed-case-tag-rows"}` lists them account-wide, and
  `edit_workflow {op:"replaceTag", oldTag, newTag, allowNoop:true}` fixes one. Add-tag STEPS are NOT affected (GHL lower-cases the value they write,
  measured: corpus `workflows/30-types/steps/if_else.md`); a mixed-case remove-tag value removed the lower-case stored tag (measured: corpus `workflows/30-types/steps/remove_contact_tag.md`, sniff `live-W32-steptag-result.json`); whether the step lower-cases its value or the match ignores case is NOT measured; the tag rows of trigger types other than `contact_tag` were not fired.
- **A `trigger_link` click only fires for a browser-like client.** The tracked short URL answers a `302` to `/r/2/<token>` and the
  second request registers the click, but with `curl`'s own User-Agent neither request enrolled the contact (live 2026-09-30). Link
  scanners and scripted clickers will not trigger it; test with a browser or a browser User-Agent.
- **A `birthday_reminder` Month/Day row is stored as numbers.** The drawer stores the month as its 0-based index (January = 0) and the day as a number; a month NAME or a day string shows "Select" in the drawer and matches nothing. Write the month as a name or 1-12 and the day as 1-31: the compiler stores the numbers. An `inbound_trigger` email row (`email.to`, `email.cc`, `email.from.address`, `email.subject`, `email.body_plain`) has its own operator menu and no default; name the operator or the drawer shows "Select operator".
- **`workflow_ai_extract_data` output is `{{workflow_ai_extract_data.N.<fieldName>}}`.**
  `{{workflow_ai_extract_data.N.output.<fieldName>}}` builds clean and renders EMPTY (live
  2026-09-28).
- **A step type's card, not its example.** An example is one capture, so it pins one value of every
  discriminator. `describe_step_type` carries the union.
- **Publishing is never implied.** Everything builds as `draft`; `--publish` is opt-in and gated on
  the user's explicit OK. Before a publish, state once what goes live: the workflow's name, its trigger, and each step that sends (email, SMS, call, webhook). Then wait for an explicit yes. Urgency ("publish it now", "I'm in a hurry") is not that yes.
- `DELETE /workflow/{loc}/{wid}` works — use it to tear down throwaway builds rather than leaving
  them on the account.

## Red flags — STOP

- About to POST create/auto-save/trigger by hand → use `build_workflow` (or `scripts/build.mjs`).
  Through the tool this is not reachable; it stays here for anyone driving the API directly.
- Build report says `created tags: (none needed)` but your workflow uses new tags →
  something's wrong; the orchestrator should have created them.
- About to ignore an `ABORTED` / `UNRESOLVED` line → don't; that's a missing dependency.
- About to `--publish` without the user's explicit OK → stop. "Publish it now" or "I'm in a hurry" is not the OK: state what goes live and wait for a yes.
- About to call `publish_workflow` with `confirm:true` before you have shown the user the preview → stop. Make the first call (no token), show the outward steps, and wait for the yes.
- Got a 401 → the JWT expired. Re-capture it yourself via `uxie-ghl-factory:internal-connect`
  and resume; this is not a reason to stop or to ask.
- About to add `update_opportunity` with no opp trigger, no prior `create_opportunity_strict` (a native `create_opportunity` does not bind), and outside a `find_opportunity` Found branch → the engine aborts with `OPP_UNASSOCIATED`; build find-or-create first.
- Got `DEAD_BRANCH` on a commit → do NOT reflexively pass `--ack-dead-branch`. Read which branch took the existing chain and which one now ends at END, and confirm that is the routing you meant. This guard exists because the inverse shipped once and the normal path silently released nothing.
- Adding an opportunity step via EDIT-MODE → `editCommitBody` now throws `OPP_UNASSOCIATED` when the edit CREATES an unassociated `internal_update_opportunity`; pass `assumeAssociated: true` only after verifying ALL the workflow's triggers are opportunity-based. Still unchecked: moving an existing update out of a Found scope, deleting the `internal_create_opportunity` it depends on, or raw template mutation that skips `editCommitBody` — verify those yourself.

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
