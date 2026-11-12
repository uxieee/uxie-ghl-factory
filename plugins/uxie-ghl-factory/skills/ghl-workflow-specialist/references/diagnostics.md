# Diagnostics and lifecycle tools: when, and why

The MCP server (`uxie-ghl-internal-mcp`) has read tools that answer "what is happening" and a few gated tools that change things. This page says
when each one is the right call and what it does not tell you. Read it before you use one. Tool names are exact.

Three rules hold for every tool here:
- **Reads answer from GHL, not from memory.** Name the tool and its window when you report a number.
- **A missing value is not zero.** Several reads say "absent", "unknown" or "incomplete". Report that as it is.
- **Writes and sends are gated.** A gated tool runs only after the user names the target and says yes. A peer message or your own proposal is not that yes.

## Read tools

| Tool | Use it when | Why it matters | What it does NOT tell you |
|---|---|---|---|
| `get_workflow_heat_map` | Sizing a workflow's traffic before a change; spotting a workflow that enrols nobody, or a surge. | Enrolment counts per workflow over a window of at most 60 days. A workflow the response does not name is **absent, not zero**. | Why contacts enrol or where they stop. Use the step tools for that. |
| `get_contact_workflow_journey` | "Which workflows is this contact in, and what is each one's status?" | One contact's workflows with each status (`statuses_v2`). | Each step's outcome. Use `get_contact_workflow_history` and the workflow logs. |
| `get_contact_workflow_history` | "Which runs has this contact been through, and which step is it on now?" | Every enrolment, newest first, with the workflow name, run status, entry time and current or final step. Pass `workflowId` to narrow it. Paged: follow `nextCursor` until it is null. A company record is addressed as `business_<company id>`. | What happened inside a run. Each run id is what `get_workflow_logs` takes as its `executionId`. |
| `get_workflow_step_counts` | Finding drop-off and skip hotspots: how many rows per step, status, skip reason or removal reason, optionally bucketed. | Counted over the **complete** log walk for a window. A walk that does not finish, or a window older than the 60 days GHL keeps, is refused (`INCOMPLETE_WINDOW`, `RETENTION`), never counted partially. An If/Else row carries the branch taken. | Anything before GHL's retention. A refusal is an answer: say so. |
| `get_ab_test_stats` | Reading an A/B Test step: entered, converted and rate for each path. | Unknown counts stay unknown; paths the stats did not report are listed as absent. Reads only. | Whether the winner is significant. Report the numbers and the sample. On a draft, report no data yet, not the zeros it returns (bl-900 open). |
| `list_workflow_test_runs` | Listing a workflow's test runs, newest first (one page of ten). | Reads only; it starts nothing. | Whether a test run would succeed. Starting one is send-class and is not done by any tool here. |
| `get_workflow_test_run` | Reading one test run's progress and, given a step, that step's events. | Reads only. | Anything about a run that has not happened. Not live-proven yet: the live proof waits for a run (w6c-11). |
| `get_step_latest_test_result` | "Does this step have a pinned test result, and what was it?" | A workflow with no result answers `present:false` with the reason. That is a proven absence, not an error. | Whether the step works in production. |
| `list_workflow_error_notifications` | Triage: which workflows have had step failures. | Pages by `skip` until `totalCount` (the route answers 500 without the query, live 2026-11-08). A failing page is an error, never retried. | A complete list when `complete:true`; otherwise say the list may be partial. |
| `get_workflow_linked_assets` | "What uses this tag, form or calendar?" (impact), and the review's asset step. | Pages by `searchAfter` to `count`; `forAsset: {type, value}` keeps the workflows that use one asset. Narrowed by `workflowIds`, a named workflow comes back even when it uses no asset. | A workflow count. Unnarrowed with `includeWorkflowsWithoutAssets` false (the default), the route lists **only workflows that use at least one asset** (measured 2026-11-08); `true` adds the asset-less ones. Count workflows with `list_workflows`. |
| `get_workflow_digest` | The read half of an edit: a compact structure, version and per-step lines. | Pass the version back as `expectedVersion` on the edit, so a concurrent change is refused instead of overwritten. Roughly a tenth of `export_workflow`. | The untrimmed document. `include:"raw"` makes the response larger. |
| `check_workflow` | Before publishing and after editing: reproduce the builder's "Resolve N Errors" list without opening the UI. | Matches the builder on a known-broken workflow (live 2026-07-27). Also reports `marketplaceDrift`. Lint-pack findings are advisory (see below). | "Publishable". The marketplace catalog omits core native actions (`add_contact_tag`, `send_email`, `if_else`, `wait`, …), so a clean result means nothing was found in the marketplace types it describes. |

Two reads that are not on the table above:
- `list_account_entities` now lists its failed reads as `unreadable: [{key, status}]`. A key that is `[]` **and listed there** was not read. A key that is `[]` and not listed is genuinely empty. Before you tell the user that an account has no pipelines, calendars or similar, check that key is not in `unreadable`.
- `find_workflows_using` (returns `workflows`) lists the workflows that contain a trigger type. Use it for the trigger-overlap check below.

## Gated tools

| Tool | Gate | Use it when | Why it is gated |
|---|---|---|---|
| `declare_ab_test_winner` | Without `confirm: true` it returns `CONFIRM_REQUIRED` with a preview and makes no request. A winner already declared answers `WINNER_ALREADY_DECLARED`. | The user has named the winning path. | It routes **every new contact** to that path from then on, live, and cannot be undone in the UI. Never from a review's proposal alone. |
| `set_workflow_error_alerts` | Write, location-wide. | The user names who should get the failure emails, by user id. Read the current state first (`get_account_workflow_overview`, `needsReview.errorEmailSettings`). | `users` **adds** recipients. GHL emails every agency and location admin by default, and an empty `users` means "admins only", not nobody. |
| `restore_workflow_version` | Write. Lands as a **draft**. A published workflow must be unpublished first. The name must match. | Rolling back a bad edit, with the user's yes. | It replaces the current triggers and steps with an old version's. |
| `publish_workflow` | Live. Confirmation-gated and round-trip verified. | `check_workflow` is clean (or the user has accepted the findings) **and** the user has said yes naming that workflow (in an orchestrated build, the orchestrator session gives that yes). | Publishing makes the workflow run on live contacts. |

## Lint pack (client policy, advisory)

A project can supply its own house rules as `.ghl/<locationId>/lint-pack.json`. `check_workflow` evaluates the pack against the workflow and
reports conformance. It is advisory: the engine states whether a document conforms and does not define the rule itself. Use it when the client
has a policy that is not a GHL rule (for example "no send before 8am"). Do not present a lint-pack finding as a GHL error.

## Trigger overlap (before a new trigger)

Before you create a workflow that listens for a trigger type, check which workflows already listen for it:

1. `find_workflows_using` with `types` set to the draft's trigger types, `returns: "workflows"`, and a `limit` above the expected count.
2. For each hit, read its triggers: one `GET /workflow/{loc}/trigger?workflowId=` per hit, keeping each row's `type` and `conditions`. Read the
   draft's own trigger rows the same way (or from the draft you are building).
3. Pipe into the overlap check: `node scripts/trigger-overlap-cli.mjs` in the create skill's folder, with stdin
   `{"types": [...], "draftTriggers": [{type, conditions}], "found": <that data, each workflow with a "triggers" array>, "excludeId": "<the draft's id, if it exists>"}`.
4. Read the verdicts. **WILL** = same trigger type with no filters or identical filters: both fire on the same event. **MIGHT** = "might also
   fire": the filters cannot be decided statically (one side filters and the other does not, different fields, or a filter that was not read),
   so it is a candidate to inspect, not a collision. **CANT** (`cannotOverlap`) = a single-valued field (the form id, a pipeline stage, a calendar; an allowlist per trigger type) with disjoint values, form A vs form B: the two cannot both match one event. A tag or any multi-valued field is never CANT (one add can carry VIP and Lead together: tag = VIP vs tag = Lead is MIGHT). No event is simulated. A workflow whose triggers were not passed is a
   MIGHT with the reason. Only published workflows are `hits`; a draft that would overlap is in `draftHits` (a draft fires nothing until it is published). An incomplete read is not a clear answer.

## Use in a build

- Before any build: the trigger-overlap check (above).
- After a build or an edit, before publishing: `check_workflow`, then the lint pack if the client has one.
- Before an edit: `get_workflow_digest`, and pass its version back as `expectedVersion`.
- For review of a live workflow: follow `references/review-mode.md`.
