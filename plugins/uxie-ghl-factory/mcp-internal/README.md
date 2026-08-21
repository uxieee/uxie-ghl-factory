# uxie-ghl-internal-mcp

MCP server exposing the `uxie-ghl-factory` plugin's proven GoHighLevel **internal-API**
engines as schema-validated tools. Complements the plugin's skills — the specialists
design, this server executes.

**Status: shipped in `uxie-ghl-factory` 0.8.0 — all 17 tools LIVE-PROVEN on GROM AU (2026-07-21).**
Every tool has been driven against a real account through a real MCP stdio session — see the
per-tool ledgers below: the read tools; the confirm-gated workflow writes (`build_workflow`,
`edit_workflow`, `publish_workflow`, `fast_forward_contacts`, non-GET `raw_request`); the
memberships tools (`list_courses`, `build_course`); and all three AI-agent create tools
(`create_convai_agent`, `create_voiceai_agent`, `create_studio_agent`). The 2026-07-21
code-review fix set — agent-verification hardening (D1/D2/D3), server-core credential-leak and
error-classification fixes (SC1–SC4), and the membership sub-object key guard (MF2) — was
re-proven live through the real server before shipping (see the 0.8.0 re-proof note below).

## Credential model

Credentials live in a **file on your machine**, written by the agent-driven capture flow
(`/uxie-ghl-factory:connect`, which builds on `docs/auth-jwt-capture.md`). They are never
accepted as a tool argument, never logged, and never echoed in a response or error.

- Default location: **`~/.uxie-ghl-internal-mcp/tok.txt`** (`DEFAULT_TOKEN_FILE`). Override
  with `GHL_TOK_FILE=<path>` or the `set_token_file` tool (a **path**, never a token — a
  JWT-looking value is rejected without echoing it back).
- The file is re-read **on every call**, so re-capturing mid-session works with no restart.
- JWTs last ~1 hour. On expiry you get `TOKEN_EXPIRED` — re-run `/uxie-ghl-factory:connect`.
- Capture is from the **AI Agents surface** (`app.gohighlevel.com`), which yields a Bearer
  **and** the `token-id` the AI tools need. **Live-proven (GROM AU, 2026-07-21):** that same
  Bearer also authenticates the workflow/backend surface (`list_workflows` → 45 workflows),
  so one capture covers every tool family — no separately-scoped workflow token needed.

## Install / registration

This server ships **inside** the `uxie-ghl-factory` plugin as a **self-contained bundle**
(`dist/server.mjs`, deps included), so it boots with just `node` — **no `npm install`**.

It is registered **per-project, not globally** — a plugin `.mcp.json` would load it in every
folder against one credential, which is wrong when you operate multiple GHL accounts across
different folders. Instead:

- **Claude Code:** run `/uxie-ghl-factory:connect` in the folder you want it. It registers a
  project-scoped server (`claude mcp add --scope local`) pointing at a stable launcher
  (`~/.uxie-ghl-internal-mcp/launch.mjs`, which resolves the newest installed plugin build so
  version updates don't break the path), captures that account's token to a project-local file
  (`.ghl/uxie-ghl-internal-mcp-tok.txt`, gitignored), and sets `GHL_TOK_FILE` to it. Each folder
  gets its own server + account. First registration triggers a one-time workspace-trust prompt.
- **Other stdio clients** (Codex, Cursor, Desktop): register it yourself per project, pointing at
  the stable launcher (or the versioned bundle directly) and setting `GHL_TOK_FILE`:
  ```toml
  # ~/.codex/config.toml
  [mcp_servers.uxie-ghl-internal-mcp]
  command = "node"
  args = ["<home>/.uxie-ghl-internal-mcp/launch.mjs"]
  env = { GHL_TOK_FILE = "<project>/.ghl/uxie-ghl-internal-mcp-tok.txt" }
  ```

**Developing on the server?** `stdio.mjs` + `core/` are the source; `dist/server.mjs` is the
shipped bundle. After changing source, run `npm install` (dev deps) then `npm run build`, and
commit `dist/` — a test rebuilds-and-diffs so a stale bundle can't ship.

## Tools

| Tool | Operations |
|---|---|
| `set_token_file` / `auth_status` | — (credential state; claims only, never the token) |
| `list_workflows` | `GET /workflow/{loc}/list` |
| `get_workflow` | summary + step count (use `export_workflow` for the graph) |
| `export_workflow` | workflow body + triggers + sticky notes |
| `get_workflow_logs` | executions, per-step counts, enrollment roster |
| `get_workflow_runtime_window` | one workflow's complete, evidence-qualified runtime window (see **Audit profile**) |
| `list_workflows_complete` | the whole roster walked to a reconciled terminal proof (see **Audit profile**) |
| `get_ai_configuration_bundle` | Conversation AI + Voice AI + Agent Studio discovery and detail (see **Audit profile**) |
| `get_contacts_at_step` | contacts parked at or processed by one step, paginated to the reported total |
| `get_workflow_stats` | the builder's Stats view as data: per-step SMS/email aggregates, per-trigger attempted/matched, contacts per step (last 30 days) |
| `list_workflow_versions` | version history (saved/published snapshots, newest first; 30 days or last 10) |
| `get_workflow_version` | one version snapshot with its full step graph, by number or id |
| `list_account_entities` | pipelines, calendars, users, forms, custom fields, AI agents |
| `list_marketplace_apps` | third-party apps INSTALLED in a location, with each app's triggers/actions — `key`, `version`, `templateId`, full `customVars`/`inputs` schema (`compact:true` by default) |
| `list_courses` | course summaries with status and available chapter/lesson/offer counts |
| `build_course` | no-call validation preview; confirmed course build with created IDs, verification and cleanup evidence |
| `build_workflow` | draft creation and verification; never publishes |
| `edit_workflow` | read-only preview; writes require `confirm: true` and never publish |
| `publish_workflow` | read-only publish preview; publishing requires `confirm: true` |
| `list_workflow_folders` | workflow folders (`type=directory`), or one folder's contents plus its own name |
| `create_workflow_folder` | read-only preview; creation requires `confirm: true`, verified by read-back |
| `duplicate_workflow` | read-only preview; duplication requires `confirm: true`; clone lands DRAFT with triggers cloned but INACTIVE |
| `move_workflows` | read-only preview naming the destination folder; moving requires `confirm: true`, refuses published workflows without `allowPublished: true`, verifies `parentId` by read-back |
| `create_custom_field_folder` | read-only preview listing existing folders; creation requires `confirm: true`; duplicate names are caught before the write and report the existing id |
| `fast_forward_contacts` | read-only parked-enrollment preview; selective requeue only with `confirm: true` |
| `raw_request` | GET escape hatch; non-GET methods require `confirm: true` and return partial-progress evidence |

### Workflow folders: two upstream quirks the tools hide

Both verified live 2026-08-18, including the negative cases.

**Folders are `type: "directory"`.** The workflow list endpoint serves folders and workflows
from one route, discriminated by `type`. `?type=folder` is not rejected — it returns `count: 0`,
which is indistinguishable from "this account has no folders", and is why the folder list was
believed not to exist. `list_workflow_folders` sends `type=directory`; passing `parentId`
instead lists that folder's contents and echoes `folderName`, which is the only way to confirm a
folder id means what you think before filing anything into it.

**The batch move cannot reach root.** `PUT /workflow/{loc}/move` takes many ids in one call but
requires a real folder: `parentId` of `null`, `""` and the sentinel `"root"` all return
404 `Parent directory not found`. Only the single-item `PUT /workflow/{loc}/move-directory/{id}`
accepts `parentId: null`. So `move_workflows` sends one batch call to file INTO a folder and
fans out one call per workflow to move OUT to root — and verifies either way by reading
`parentId` back off each record, because both routes answer only `{"msg":"Updated successfully"}`.

`company_id` / `company_age` are accepted but not required on the folder-create or duplicate
bodies (verified by omitting both; the server fills them from the location), so no tool asks a
caller for them and none spends a read fetching them.

### Custom-field folders: AI host, Bearer rail

`create_custom_field_folder` is the one write that leaves the workflow backend. It targets
`services.leadconnectorhq.com` — but on the **plain Bearer rail, not the dual-credential
`ai` rail.** The browser call that was captured carried a `token-id`; resending it with that
header removed still returned 201, so the tool does not ask for one. Requiring it would have
locked out every caller holding only a location JWT, for a write that never needed it.

Two more facts the tool hides, both measured:

- **`model` is `contact` or `opportunity`, and nothing else.** The server answers anything
  else with `400 Model value need to be either 'contact' or 'opportunity'`. Other models
  (e.g. `business`) exist on folders already in an account but cannot be created here, so
  the tool refuses them locally rather than spending a request to learn that.
- **Folder names are unique per location per model.** A duplicate is a `400 Folder already
  exists` carrying `meta.existingId`; the tool checks before writing AND handles the raced
  case, reporting the existing folder's id either way instead of a bare status.

🔴 Folder reads answer under **`customFieldFolders`**, not the sibling `customFields` key —
that one holds the FIELDS and comes back empty for a folder query, which makes a folder that
*was* created look like it never was.

### The credential guard vs. signed storage URLs

Every tool argument is scanned for credentials and every result is scrubbed, so a token can
never reach the MCP transcript from either direction. One narrow exemption exists, and it is
load-bearing: a GHL workflow document legitimately carries **signed Google storage URLs** —
`fileUrl` at the top level, `attributes.previewUrl` on email steps — each ending in
`?…&token=<uuid>`. The labelled-secret rule read that as a credential, so `raw_request` could
not PUT back any document it had just GET'd, and the scrubber mangled the URLs on the way out.
That removed the escape hatch for exactly the cases the typed tools do not cover, and stripping
the fields is a one-way door: once `fileUrl` is gone you cannot PUT it back either.

URLs on `firebasestorage.googleapis.com` / `storage.googleapis.com` are therefore exempt from
the **labelled-value** rule only. They are storage pointers the API itself just handed us, not
user secrets. The JWT (`ey…`) and `Bearer …` rules still apply everywhere, including *inside* a
storage-shaped URL — a firebase download token is a UUID and is never JWT-shaped, so nothing
real is smuggled out through the exemption. `test/raw-request-storage-url.test.mjs` holds both
halves of that line.

## Error contract

Every tool returns `{ ok, code?, detail?, remediation?, data? }`. Codes are stable and
machine-branchable:

| Code | Meaning |
|---|---|
| `TOKEN_MISSING` | no/unreadable token file, or a credential passed as an argument |
| `TOKEN_EXPIRED` | JWT `exp` passed, or upstream 401/403 |
| `VALIDATION_FAILED` | unsupported argument fields, or upstream 422 |
| `VERSION_CONFLICT` | upstream 409 — re-read for the current `version` |
| `RATE_LIMITED` | upstream 429 |
| `CONFIRM_REQUIRED` | a gated operation needs `confirm: true` |
| `PREVIEW_STALE` | fast-forward preview token is missing or no longer matches fresh parked state |
| `ENGINE_ABORT` | engine threw — usually a spec or dependency problem |
| `HTTP_<n>` | any other upstream status |

## Audit profile

A second, structurally read-only entry point (`stdio-audit.mjs`, bundled as
`dist/audit-server.mjs`) for the weekly whole-account auditor. It is a separate server with a
separate registry, not a flag on the full one, and it publishes exactly seven tools:
`auth_status`, `list_workflows_complete`, `get_workflow`, `export_workflow`,
`get_workflow_runtime_window`, `get_ai_configuration_bundle`, `list_marketplace_apps`.

Only three of those seven carry the audit evidence contract. `list_workflows_complete`,
`get_workflow_runtime_window` and `get_ai_configuration_bundle` go through the audit gateway,
so they get capability-descriptor validation, response identity inspection, the shared limiter
and the shared circuit. `get_workflow`, `export_workflow` and `list_marketplace_apps` are the
ordinary read tools: in the audit process they have the read-only wrapper below them and
nothing else, so a rate limit during one of them neither latches the circuit nor is recorded
as evidence. `auth_status` makes no request at all.

### What is excluded, and what that does and does not mean

`raw_request`, `set_token_file`, every write, every confirmation-gated tool, and the readers
`list_account_entities`, `list_workflows`, `get_workflow_logs` and `get_contacts_at_step` are
all absent from the audit registry. Each of the last four fails a completeness requirement in
its own way: `list_account_entities` and `get_workflow_logs` substitute an empty array for a
failed component, `list_workflows` reads one offset page and never reconciles the reported
count, and `get_contacts_at_step` reports `complete: true` unconditionally.

Read-only-ness rests on TWO independent locks:

1. **The registry filter.** `toolsForProfile('audit')` selects the seven tools from a literal.
   No environment variable and no argv input can widen it.
2. **A gateway wrapper** (`core/audit-readonly.mjs`), installed under every tool because every
   tool obtains its gateway from `deps.makeGw` and `stdio-audit.mjs` is the only construction
   site. Only a `GET` to one of the two approved audit origins can leave the process; a
   body-bearing request and the SSE `stream` channel are refused outright.

Be precise about what this is not. `dist/audit-server.mjs` **still contains** the write
handlers as unreachable dead code, because `core/tools.mjs` declares every tool in one array
literal and esbuild has nothing to tree-shake. The audit bundle is in fact marginally larger
than the full server. Read-only-ness is a property of these two locks, not of the artefact,
and nothing in this repository should be read as claiming otherwise.

### `get_workflow_runtime_window`

Inputs: `locationId`, `workflowId`, `fromDate`, `toDate` (epoch ms, rejected before any
gateway is built when `fromDate >= toDate`), optional `contactId`, `eventTypes` (max 20),
`stepIds` (max 20), the execution-log `logPageSize` (default 100, max 5000) and
`maxLogPages` (default 200), the transient-fault allowance `maxLogRetries` (default 3), and
the budgets `maxEnrollmentPages` (default 200) and `maxStepRosterPages` (default 200). The
enrollment walk reads 20 rows per page and step rosters 50.

Three inputs are **retired and refused, not ignored**: `pageSize`, `maxLogPartitions` and
`minPartitionMs`. Passing any of them is an error naming the replacement. A parameter that is
accepted and does nothing is indistinguishable, from the caller's side, from one that works —
which is the defect described below.

Output: `workflowDefinition`, `runtimeEvents`, `observedEventTypes`, `enrollments`, `perStepCounts`, `stepRosters`,
`enrollmentTotals`, `pagination`, `rateLimit`, `locationBinding`, `sourceRoutes`,
`appliedQueries`, `filters`, `requestedWindow`, `appliedWindow`, `capabilityVersion`,
`capturedAt`, `componentCompleteness`, `configurationBinding`, `complete`, `truncated`,
`warnings`, `contractVersion`, `boundLocationId`, `workflowId`.

**Execution-log completeness.** The analytical window is half-open, `[fromDate, toDate)`. It
is sent to the server — which really does apply it — and then re-checked locally against each
row's own `createdAt`, because a server-side filter is a claim and this module's job is not to
take claims on trust. Upstream both bounds are **inclusive** (measured to the millisecond), so
a row landing exactly on `toDate` arrives and is dropped locally.

> ⚠️ **`fromDate`/`toDate` only work when `dateType=custom` is sent with them.** Without that
> switch the endpoint silently discards the window and serves its own **~30-day default,
> snapped to a day boundary** (not `now-30d` to the millisecond — measured 428 rows vs 419
> on a workflow dense enough to tell them apart): HTTP 200, plausible rows, no warning. On the workflow this was measured against
> that is 37 rows out of 433. The descriptor **pins** `dateType` to `custom` so this rail
> cannot make the other request, and the preset values are not expressible at all — `all`,
> `all_time`, `last_7_days` and any typo also fall through to the same 30-day default, so
> `dateType=all` does not mean all history.

Pages are walked with the endpoint's **cursor** (`action=first`, then `action=next` carrying
`referenceId` **and** `referenceCreatedAt` — the id alone silently re-serves the same page).
Every page re-returns the previous page's last row, so rows are de-duplicated by id, and the
walk terminates on **a page that contributes no new ids** — never on an empty page, which does
not occur. A short page is *not* treated as terminal: the walk spends one more request to
prove exhaustion, because inferring completeness from page length is the exact reasoning that
once published 8% of a workflow's history as a complete window.

`actionType` is a real, working filter on this endpoint that this rail deliberately **does not
send**. Its value enum cannot be established from any available source — the builder's step
catalog is a different vocabulary (`wait` there, `wait_time` here) — and an unrecognised value
returns an empty `200`. Nor could an allow-list rescue it: the only way to distinguish "that
step type never ran" from "that slug was wrong" is to compare against the unfiltered window,
which means fetching the pages the filter was meant to save. Rows are published verbatim with
their `type`, so a **consumer** can filter the returned array; this tool does not do it for you
and exposes no input for it.

`observedEventTypes` reports what the window actually holds — `{byType, byStatus}` counted from
the retained rows. It is the honest replacement for a hard-coded step-type list: derived per
account per window from observation, it cannot drift from the data it describes, where a list
copied from the builder's step catalog would have been wrong on day one (`wait` there,
`wait_time` here). `type` is the step that ran; `status` is what happened to it — the two
vocabularies overlap (`wait_finished` is in both), which is worth knowing before filtering on
either.

`complete:false` and `truncated:true` follow from an exhausted page budget, a cursor that
cannot be advanced, a conflicting duplicate id, an unreadable event timestamp, a rate limit on
any route, a quarantined or unverifiable identity, and an exhausted enrollment or roster
budget. Every one of those carries a coded warning. Wide windows on this endpoint
intermittently answer `HTTP 500` and then serve the identical request cleanly, so log reads
retry up to `maxLogRetries` times on 5xx — never on 401/403/429.

`complete` covers **runtime event coverage only**. The separate `configurationBinding` field
records that nothing on this rail proves the captured workflow definition governed the events
in the window: there is no version-history capability, so `workflowDefinition.validity`
reports `effectiveFrom: null` and `appliesToRequestedWindow: "unproven"`. No consumer may
claim the current configuration explains historical runtime on this evidence.

Two output fields are easy to misread. `enrollmentTotals` is workflow-wide and all-time while
`enrollments` is window-scoped, so the two must never be subtracted. A `stepIds` entry that
the workflow definition does not contain is refused locally with `STEP_ROSTER_UNSEALED` and
`contacts: null`, without a read.

### `list_workflows_complete` and `get_ai_configuration_bundle`

The roster walks by offset and publishes only when the unique workflow count equals a
**stable** reported total; it reports one flat completeness verdict, because it is a single
surface. The AI bundle always attempts all three surfaces (Conversation AI, Voice AI, Agent
Studio), a caller cannot omit one, and it reports per-component
`{applicable, complete, items, pages, sourceRoutes}`. Neither ever substitutes an empty
result for a failed read: a failed component is `null` with a coded warning.

### Credentials, refresh, and partial runs

Authentication continues to come from the configured token file. The location JWT is
short-lived, and the Agent Studio and AI surfaces additionally require the elevated
agency-admin `token-id`, which expires independently. On the `ai` rail that credential is
asserted to reach only `services.leadconnectorhq.com`; no audit tool constructs the other
rail that can carry it.

A run that outlives a credential does not degrade quietly, but the code it surfaces depends on
where the expiry is caught. On the three composites, a locally-detected expiry is rewritten as
`TRANSPORT_FAILED` and aborts the whole call with no partial result; an upstream `401` is
classified `AUTH_REJECTED` on `sourceRoutes[]`, files a `COMPONENT_READ_FAILED` warning, and
latches that rail, after which further reads throw `CIRCUIT_OPEN` (which does carry
`error.partial`). `TOKEN_EXPIRED` is the code for `get_workflow` and `export_workflow` only.

Re-capture with `/uxie-ghl-factory:connect`. Latch scopes are not uniform: a `401` or a
transport failure latches only its own rail, three consecutive unusable response bodies latch
that rail too, a `429` or a location-level throttle latches the whole process, and a `403`
latches nothing at all (it is an entitlement fact about one resource, so a component can
record it and the run can continue). Nothing auto-retries after a latch.

A thrown `CIRCUIT_OPEN` carries the reads already completed on `error.partial`, so a resumer
can checkpoint and continue instead of re-spending its budget. One rule applies to that
partial: **a resumer must not treat `componentCompleteness.enrollments: true` as skippable
unless `enrollmentTotals: true` also holds.** The totals reconciliation runs after the totals
read, so a circuit that latched on the enrollment-totals cache skips the check and the partial
can over-report that one component.

### The API YAML is a specification, not proof

The API YAML is capability documentation and lives outside this repository. It describes what
an endpoint is said to accept; it is not runtime proof that the endpoint behaves that way for
this account. No completeness claim in this profile derives from it.

### Proof model, and the human-gated canary stop line

Every audit composite is labelled `proof: external-receipt-required; risk: read`. That label
is frozen: it is baked into the committed bundle and is **not** rewritten after a successful
canary. Proof is resolved per capability from an external proof index instead, where each
receipt binds a capability descriptor hash, a manifest hash, the exact canaried bundle hash,
and an expiry. The absence of an unexpired receipt for a capability applicable to a run is
machine-enforced and cannot support a Full audit.

The composite completeness contracts are **offline-proven only**. They have never been run
end-to-end against a live account, and **no receipt exists**. Task 7 is the bounded, read-only
live canary that would produce the first ones. It requires explicit human approval, a freshly
captured credential, named location and workflow ids, and an approved closed window. Do not
start it from the plan alone.

The executor IS now built (`scripts/audit-canary.mjs`, 2026-07-27) — it was a planner that
refused to run for its first two months, which meant "spend the canary carefully" was advice
about something nobody could execute. It drives the **committed bundle** over stdio, not the
source, because a receipt for code that was never packaged proves nothing about what ships.

Running it still requires all four gates (`--live`, `GHL_AUDIT_CANARY_APPROVED=1`, a named
`--approver`, and an approved closed window); a dry run remains the default and makes no
network call. Each of the seven steps is judged on the property it exists to prove, never on
`ok:true` — every one of these tools answers `ok:true` with `complete:false` on a surface it
could not read, so a canary checking only `ok` would mint a receipt over reads that never
happened. A run with any failed step is `partial`, never `pass`, and exits non-zero.

Step 7 asks for a step id the definition does not contain and PASSES only if the rail refuses
it locally with `STEP_ROSTER_UNSEALED` and `contacts: null`. A rail that only ever succeeds
has not been shown capable of saying no, and that capability is as much a part of the receipt
as the reads are.

### Recorded gaps a canary must close

These are stated rather than hidden, because each one is a place where offline green does not
imply live correct:

- **Timestamp grammar.** The strict ISO-8601 parser has never met a real
  `/workflows/logs/v2` payload; no captured response exists in this repository. It fails
  closed, so a real event in an unexpected shape marks an honest window incomplete rather
  than vanishing, but the shape itself is unverified.
- **Envelope shapes.** `readTotal` requires a root-level finite `total`; the roster row and
  agent-record envelope key lists are likewise unverified against live payloads.
- **Docs-matrix rows.** Six audit routes carry no row in the capability matrix, and the
  matrix itself lives outside this repository: `/workflows/status/enroll-stats` (the legacy
  enrollment-totals fallback, read on every runtime-window run), `/voice-ai/agents/simple`,
  `/voice-ai/agents/{agentId}`, `/ai-employees/employees/{agentId}`,
  `/agent-studio/agents/agents-with-folders` and
  `/agent-studio/super-agent/agents/{agentId}`. No row id was invented to fill the gap;
  `tool-descriptions.json` records each uncited capability instead, and a test proves every
  declared route is either cited or recorded.
- **Detail identity.** The bundle assumes a detail body's `_id`/`id` equals the discovery
  row's. If that is wrong for a product, every agent falsely mismatches and that component's
  configuration is dropped.
- ~~**Launcher.** `launch.mjs` resolves `dist/server.mjs` only; the audit bundle has no
  launcher yet.~~ **CLOSED 2026-07-27.** `launch-audit.mjs` resolves `dist/audit-server.mjs`
  and nothing else. Two files rather than a flag on one: a flag has to default to something,
  and a full-by-default launcher hands an operator who mistyped it the entire write registry
  while they believe they are read-only. It REFUSES to start when no installed build ships an
  audit bundle rather than downgrading, and `test/launchers.test.mjs` pins that — including
  the composed rule (newest build that HAS an audit bundle, not "fail because the newest one
  lacks it") and semver ordering, since `0.9.0` sorts after `0.10.0` as a string.

## Live envelope recon — 2026-07-27, GROM AU (`wdzEoUZnXO9tB3PPzcot`)

Read-only GETs, driven through the internal MCP against a real account, to settle the envelope
shapes this rail had only ever guessed at. Nothing mutated. The point was not to capture shapes
for their own sake — it was that the reader either matches what GHL returns or the audit reads
nothing, and four of these had never been checked against a live response.

| Route | OBSERVED envelope | Verdict |
| --- | --- | --- |
| `GET /workflow/{loc}/list` | `{rows, count: 55, isLocationRateLimited}` | **The old reader matched NEITHER half.** No root `total` exists at all. `count` is a number and respects filters (`status=published` → 37). |
| `GET /voice-ai/agents/simple` | **bare array**, no envelope, no total | Readable. Total-absent is tolerated because the surface is single-shot. |
| `GET /ai-employees/agents` | **404 "Cannot GET"** | **Route does not exist.** Corrected to `/ai-employees/employees/search`. |
| `GET /ai-employees/employees/search` | `{employees, totalCount: 3, count: 3, traceId}` | `totalCount` is the total. `count` carried the SAME value on a single page — the exact ambiguity for which `count` is excluded from the AI total keys. |
| `GET /agent-studio/agents/agents-with-folders` | `{items, folders, total: 1, totalAgents, totalFolders, page, pageSize, hasMore}` | Root numeric `total` confirmed. |
| `GET /workflows/logs/v2` | **bare array**; row has `status: "finished"`, `_id`, `stepId`, `sequence`, `workflowStatusId`, `meta`, `metrics` | **No `eventType` field and no `outcome` field.** `eventType` is a query param that filters on `status`. |
| `GET /workflows/status/search/workflow-with-filter` | `{statuses, count, isLocationRateLimited, traceId}` | Keyed `statuses`, not `rows` — already in the reader's key list. |
| `GET /workflow/{loc}/trigger` | **bare array** | Readable. Gates `definitionComplete`. |
| `GET /workflows/sticky-notes-all` | `{data, count, traceId}` | Readable. Gates `definitionComplete`. |
| `GET /ai-employees/employees/{id}`, `GET /voice-ai/agents/{id}` | detail `id` == discovery `id` on both; Voice detail carries **both** `_id` and `id` | **Canary item 4 of 4 settled** — the assumption with the widest blast radius. |

Timestamps: every value observed is ISO-8601 UTC with milliseconds and a literal `Z`
(`2026-07-24T07:13:52.421Z`) — **not** the synthetic numeric epochs every fixture uses. The
strict grammar in `core/workflow-runtime-window.mjs` was exercised against the live values and
accepts them, which retires the "unvalidated against live data" warning on that parser.

### The parked-contact probe — `count-per-step` SETTLED

The account had no parked contacts (five workflows all returned `[]`, every enrollment read
`status: "finished"`), so the row key could not be observed by reading alone. Rather than infer
a key name from an empty array, one was parked deliberately:

1. Built a **send-free** throwaway workflow — one `contact_tag` trigger, one 30-day `wait`, and
   nothing else. Zero message steps, so no real person could be contacted by it.
2. Published it (trigger `active: 1/1`).
3. Created a fabricated contact carrying the trigger tag — never a real client record.
4. Read the endpoints while exactly one contact sat at the wait.
5. Deleted contact, workflow, and the auto-created tag; verified each absence against RAW
   response bodies, not success flags (`count` back to 55; contact → `400 Contact not found`;
   tag absent from the list).

```jsonc
// GET /workflows/status/search/count-per-step   → a bare array
[ { "total": 1, "currentStepId": "82446196-93c8-4bb7-97af-8f4705c5c772" } ]

// GET /workflows/status/search/details-by-step  → an envelope
{ "totalCount": 1,
  "rows": [ { "_id": "01KYG6HNNNXG64T6KH8MCKRT47",   // the workflow-status ULID, NOT a contactId
              "contactId": "…", "workflowId": "…",
              "currentStepId": "82446196-93c8-4bb7-97af-8f4705c5c772",
              "executeOn": "2026-08-25T21:50:53.567Z" } ] }
```

**The step key is `currentStepId` and the count key is `total`** — not `stepId`, not `_id`, not
`count`. Cross-confirmed: that `currentStepId` equals the `stepId` the log row reported for the
same wait step, and the drill-down's `_id` equals the log row's `workflowStatusId`.

Two things the probe settled for free. The runtime log for a parked contact carries
`status: "waiting"`, `type: "wait_time"` and a real `nextExecutionAt` — so `waiting` is a live
value of the status enum, and the invented `waiting_on_action` remains absent from every
observation. And the enrollment row keyed `stepId: "added_to_workflow"` — a literal sentinel
string where every other row carries a UUID, which anything parsing `stepId` as an id must
tolerate.

A tag applied **at contact creation** does fire the tag trigger: `added_to_workflow` appeared in
the logs 0.4s later with `addedSource.triggerType: "contact_tag"`. That is the only proof a
trigger fired, per this repo's own rule, and it is now direct rather than inherited.

Incidental, recorded for the workflow-engine project rather than this one: a UI-built
`facebook_lead_gen` trigger read back `masterType: "highlevel"`, where that project's notes
record `"internal"` as the settled value for both flavours. Worth reconciling there.

## Historical live proof ledger — EXECUTED vs OBSERVED

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Workflow: *AU Magic Link Provisioner*
(`6efef18a…`), published, 116 total enrolled. Date: **2026-07-20**. Driven through a real
MCP stdio session (`initialize` → `tools/call`), not unit tests. Read-only; nothing mutated.
This ledger predates the confirmation-gated Task 4 write additions; those additions were
unit-tested only and were not live-called.

| # | Executed | Observed |
|---|---|---|
| 1 | `auth_status` | `ok=true`; `jwt.present=true`, `secondsRemaining≈3448`, uid `CpTT7…`. Raw token **absent** from the response (regex-checked). |
| 2 | `list_workflows` | `ok=true`; `count=45`, 45 returned — e.g. *001 - FB Lead Form* `[published]`, *01 Abandoned Cart Recovery* `[published]`. |
| 3 | `get_workflow` | `ok=true`; name *AU Magic Link Provisioner*, status `published`, version `15`, `stepCount=1`. |
| 4 | `export_workflow` | `ok=true`; `templates=1` — **matches #3's stepCount**; `triggers=1` (type `inbound_webhook`); `stickyNotes=[]` (array, len 0). |
| 5 | `get_workflow_logs` | `ok=true`; `logs=5`, `enrollments=5`, `perStepCounts=0` (correct — 0 *active* enrolled). |
| 6 | `list_account_entities` | `ok=true`; pipelines 5, calendars 4, users 7, forms 5, customFields 46, agents 3. |
| 7 | `raw_request` GET `/workflow/{loc}/list?limit=1` | `ok=true`, upstream `status=200`. |
| 8 | **Negative:** `set_token_file` → `/nonexistent/nope.txt` | `ok=false`, `code=TOKEN_MISSING`, remediation names the capture runbook. |
| 9 | **Negative:** `set_token_file` with a JWT as `path` | `ok=false`, `code=TOKEN_MISSING`, secret **not present** in the response. |
| 10 | **Negative:** `raw_request` with `method: POST` | rejected at the schema layer — writes unavailable in this build. |

### Defect found by this run

`export_workflow` returned `stickyNotes` as a **non-array**. The live envelope is
`{ data: [], count: 0, traceId }` — **not** `{ notes: [] }`, the shape the unit test had
stubbed. Green tests, wrong behavior. Accessor corrected to normalize any of
`data` / `notes` / bare-array onto an array, stubs re-pointed at the real envelope,
and re-verified live: `stickyNotes isArray: true`, `triggers isArray: true`.

Everything above was read off actual tool output. Nothing in this ledger is expected-value.

## Live proof ledger — write tools (Task 5)

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Date: **2026-07-21**. Driven through a real
MCP stdio session. All writes on throwaway canaries, **all deleted afterwards** (verified
by re-read → 404, plus a tag sweep → none remaining).

| # | Executed | Observed |
|---|---|---|
| 1 | `build_workflow` (canary draft) | `ok=true`; `authored=compiled=steps=1` (integrity MATCH); `createdTags=["task5-canary","task5-a"]`; `published=false`. |
| 2 | `edit_workflow` **without** `confirm` | `CONFIRM_REQUIRED`; preview `stepCount {before:1, after:2}`. `export_workflow` then showed **1 step — nothing written** ✓ |
| 3 | `edit_workflow` with `confirm:true` | `ok=true`; export showed **2 steps** — edit landed. |
| 4 | `publish_workflow` without confirm → with confirm | `CONFIRM_REQUIRED`, then `ok=true`. Status `draft→published`, version `3→4`, **triggers still present and `active:true`** (the v0.3.4 downgrade regression did **not** reproduce). |
| 5 | `fast_forward_contacts` (preview) | `CONFIRM_REQUIRED` — "preview is ready; no write was sent." |
| 6 | `raw_request` POST without confirm | `CONFIRM_REQUIRED` — refused **before any network call** (proven by running with an absent token file: a tool that reached the network would have failed `TOKEN_MISSING` instead). |
| 7 | Cleanup | Canary DELETE → 200; re-read → `HTTP_404`. All `task5-*` tags deleted; final sweep: **0 tags, 0 workflows remaining**. |
| 8 | Builder UI check | Correct-type canary renders **with its action icon** and its **step editor opens** (Internal notification: Action Name, Type, From Name/Email, To User Type). |

### Defect found and fixed by this run — `STEP_TYPE_UNKNOWN`

Authoring `send_internal_notification` (the real slug is **`internal_notification`**)
compiled clean, built, round-tripped, and reported `warnings: []` with a MATCHING
authored/compiled/steps count — but in the builder the node rendered as **a bare box with
no action icon, and its step editor would not open**. A control click on a UI-built
`internal_notification` step in the same account opened its editor normally, proving the
defect was ours and not a browser artifact.

Root cause: `compile()` looked the type up with `ctx.catalog.step(t.type)` and simply
skipped when it was missing — an unrecognised type was never rejected. The catalog is
complete (383 step types), so an unknown type is an authoring error.

Fix: `compile()` now throws `STEP_TYPE_UNKNOWN`, naming the offending type and suggesting
the nearest catalog slug, with an explicit `allowUnknownStepTypes` override for the
documented "harvest a live example and extend the catalog" path. Four regression tests
added to `engine/silent-failure.test.mjs`. Verified live: the bad type is now refused
(`ENGINE_ABORT` / `STEP_TYPE_UNKNOWN: 'send_internal_notification' — did you mean
'internal_notification'?`), and the correct type builds, renders and opens.

### Second defect found and fixed — authored `email.to` was silently dropped

Authoring `internal_notification` with `userType: "custom_email"` and
`attributes.email.to` persisted with **no `to` key and no warning** — the builder's
"To Custom Email" field came up empty, so the notification would have reached nobody.
The UI-built control step in the same account carries `to`.

Root cause: `internalNotificationAttributes()` emits an explicit per-channel allowlist
(correct — the editor binds to an exact field set), but `to` was missing from it. The
2026-07-15 corpus that seeded the handler contained no `custom_email` example.

Fix, in two parts:
1. `to` is emitted when authored, and `userType: "custom_email"` **without** a `to` now
   throws `MISSING_FIELD` rather than building a notification that reaches nobody.
2. **Class fix:** any authored channel key the handler does not emit now raises
   `NOTIFICATION_KEY_DROPPED` through `ctx.warn` instead of vanishing — so the next
   unlisted key surfaces loudly instead of repeating this bug.

Four regression tests added. Live-verified on GROM AU 2026-07-21: `custom_email` with no
`to` is refused; with `to` it persists (`"to":"ops@example.com"`) and the builder's
**"To Custom Email" field renders the address** (screenshot-confirmed) — the same field
that was empty before the fix.

Everything above was read off actual tool output and real screenshots. Nothing is expected-value.

## Live proof ledger — memberships tools (Plan 4, Task 4)

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Date: **2026-07-21**. Real MCP stdio session.
Canary courses created and **deleted afterwards** — final `list_courses` returns 0.

| # | Executed | Observed |
|---|---|---|
| 1 | `list_courses` (before) | `ok=true`, `count=0`. |
| 2 | `build_course` **without** `confirm` | `CONFIRM_REQUIRED` + preview (`wouldCreate`: 1 course, 1 chapter, 2 lessons, 1 offer; `estimatedSeconds: 16`). `list_courses` after → still **0 — nothing written** ✓ |
| 3 | `build_course` with `confirm:true` (correct spec) | `ok=true`, `verification.problems = 0`. |
| 4 | `list_courses` (after) | Course present with `counts {chapters:1, lessons:2}` — matches the spec. |
| 5 | **Memberships UI check** | Product renders in *Your Products*; opening it shows **Chapter One (Published) → Lesson A, Lesson B**. Screenshot-confirmed. |
| 6 | **Negative:** typo spec with `confirm:true` | `VALIDATION_FAILED` **at preview, before any object was created** — `unknown key "body" — did you mean "text"?` |
| 7 | Cleanup | Both canaries deleted (one delete returned a transient upstream `503`; retried, `200`). Final sweep: **0 courses on the account** ✓ |

### Defect found and fixed by this run — a preview that green-lit a broken spec

The first live build used `body` instead of `text` for lesson content. The spec validator
did not know the key, **ignored it**, and `previewCourseSpec` returned
`valid: true, errors: []`. The build then created a course with **two empty lessons**, and
the problem only surfaced in *post-build* verification — `ENGINE_ABORT: Course objects were
created but 2 verification check(s) failed` — i.e. after the objects already existed on the
account.

That is worse than having no preview: the confirm gate actively told the caller it was safe
to proceed. Same silent-acceptance class as Plan 3's `STEP_TYPE_UNKNOWN` and the dropped
`email.to`.

Fix: `validateCourseSpec` now rejects unknown keys at **every** level (spec, course,
chapter, lesson, question) with a near-miss hint (`body` → `text`). The key lists are
derived from what the engine actually reads, cross-checked against `course-spec.md` and
`example-spec.json` — **not guessed**. A regression test validates the shipped
`example-spec.json` to prove the guard does not over-reject; that test immediately caught
an over-strict first draft (it had omitted the legitimate `awardCredential` key).

Live-verified both directions: the typo spec is refused before anything is created, and a
correct spec builds with `verification.problems = 0` and renders in the UI.

Everything above was read off actual tool output and real screenshots. Nothing is expected-value.

## Live proof ledger — AI agent tools (Plan 5, Task 6)

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Date: **2026-07-21**. Real MCP stdio session
using the dual-credential AI rail. All canaries **deleted afterwards**, verified against raw
response bodies.

**This run answers a question open in this project since July: does VoiceAI / Agent Studio
agent-create actually work? It does.** Memory said proven, the skill docs said not. The truth
is that **create succeeds in all three products** and the **follow-up configuration step** is
what fails — a much narrower problem than "create is unproven".

| # | Executed | Observed |
|---|---|---|
| 1 | `auth_status` | Both credentials reported as claims — jwt `uid`/`secondsRemaining`, token-id `issuer`/`role: admin`/`scope: agency`/`secondsRemaining`. No raw token anywhere (regex-checked). |
| 2 | `create_convai_agent` **without** confirm | `CONFIRM_REQUIRED` + compiled plan (`POST /ai-employees/employees`, payload field list). No write. |
| 3 | `create_convai_agent` with confirm | Tool returned `AGENT_VERIFICATION_FAILED` — but the agent **was created** (`T6-convai-canary`, 19:28:17Z). Post-create verification is what failed. |
| 4 | `create_voiceai_agent` with confirm | Tool returned `HTTP_422` — the agent **was created** (`6a5e76ed…`). `POST /voice-ai/agents` takes only `{locationId}` and returns an id; the follow-up `PUT /voice-ai/agents/{id}?publishAgent=true&mode=update` 422s, so the agent keeps GHL's default name ("My Agent 916"). |
| 5 | `create_studio_agent` with confirm | Tool returned `HTTP_400` — the agent **was created** (`7e7751c5…`, 19:30:20Z). A later step 400s. SSE behavior therefore still unconfirmed. |
| 6 | Cleanup | All three canaries deleted (ConvAI 200, VoiceAI 204 ×2, Studio 200), each re-read to confirm. Pre-existing agents left untouched: *Finn*, *Booking Finn*, *Marketing Agency*, *My Agent 811* (2026-06-17), studio agent from 2026-06-29. |

### Status change

`create_voiceai_agent` and `create_studio_agent` were labelled **NOT live-proven**. Their
**create** paths are now live-proven; their **configure/verify** follow-ups are proven
*broken*. Tool descriptions and the skill status table must say exactly that — not "proven",
not "unproven".

### Defects found and fixed by this run

**1. `auth_status` was unusable.** It returned `"jwt": "<redacted>"`. The recursive scrubber
blanks the whole subtree under any secret-*named* key (`jwt`, `tokenid`), so the claims —
including expiry — were destroyed. You could not tell whether your token was about to expire.

The first fix (redact only primitives under a secret key) was **wrong** and three existing
tests correctly caught it: `{credentials:{value:"sk_live_…"}}` would then leak, because that
value is neither JWT-shaped nor under a secret-named key. Fixed instead by renaming the
fields to `jwtClaims` / `tokenIdClaims` — the scrubber stays strict, the metadata survives.
A test now asserts the claims survive the *contract boundary* while the credentials do not.

**2. Misleading remediation on spec rejections.** A compiler/validator error (`mode must be
one of …`) reported *"Gateway transport failed before an HTTP result was available; inspect
account state before retrying"* — sending the caller to hunt account state for what was a
typo, when nothing had been sent. Spec rejections now say *"rejected before any request was
sent — nothing was created."*

### Known gap

`raw_request` has **no `base` parameter**, so it cannot reach
`services.leadconnectorhq.com`. Its `VALIDATION_FAILED` on an AI path is *our own guard*, not
GHL — which during this run briefly looked like "the agent is gone" when the agent was very
much still there. Cleanup had to bypass the server. Worth closing.

### Method note

A throwaway verification script reported **"ConvAI agents: 0"** while the canary existed —
a wrong key guess in the script's own parsing. It was caught only by re-checking the **raw
response body**. Object-shape guesses are exactly as unreliable in verification code as in
engine code; assert against raw payloads when confirming cleanup.

Everything above was read off actual tool output and raw API responses. Nothing is expected-value.

### Follow-up (2026-07-21, same day): Voice AI now works end-to-end

Chasing the three follow-up failures found above, `create_voiceai_agent` is now
**fully live-proven**: create → full-replace update → verified re-read → `agentName`
persisted → canary deleted. Final tool result: `ok: true`, `verified: true`, zero mismatches.

Three separate bugs stood between "create works" and "the tool works", each found live:

1. **422 on the full-replace PUT** — the compiler's `DEFAULTS` supplied `''` for
   `businessName`, `welcomeMessage` and `timezone` (contradicting this file's own note that
   instance data "is never defaulted here"). The API rejects those as empty
   (*"must be at least 1 characters long"*, *"Timezone must be a valid timezone"*). Both
   candidate fixes were tested live — omitting the keys → 200, supplying real values → 200.
   **Omitting** was chosen: inventing a business name or timezone for someone's phone agent
   is worse than leaving GHL's own default.

2. **403 on the verification re-read** — the driver read `/voice-ai/agents/{id}` **without**
   `?locationId=`. Probed read-only against an existing agent: with it → 200, without → 403.
   So a correctly created and correctly named agent was reported as a failure *because the
   check itself was malformed*.

3. **37 false mismatches** — the re-read nests voice/behavior settings under `agentSettings`,
   so a flat top-level comparison found none of them and called every one a mismatch.
   Verification now distinguishes **`mismatches`** (the server disagrees) from
   **`unverified`** (the field is not visible at this level). Reporting a false mismatch is
   worse than reporting nothing: it tells the caller their working agent is broken.

Remaining on this surface: Agent Studio's post-create step (400) and its unconfirmed SSE
behavior, and ConvAI's post-create verification. `raw_request` still cannot reach the AI host.

### Follow-up (cont.): ConvAI proven; Agent Studio partially resolved

**ConvAI is now fully live-proven** (2026-07-21): `create_convai_agent` → `ok: true`,
`verified: true`, zero mismatches, canary deleted. No code change was needed beyond the
mismatch/unverified split above — its "failure" was the same false-mismatch class. Note a
write/read key asymmetry worth knowing: the create body uses `employeeName`, the read
returns `name`.

**Agent Studio — what is now established.** The endpoint **is genuinely SSE**, previously
unconfirmed. Driven directly:

- `POST /agent-studio/super-agents/build` → **200**, `content-type: text/event-stream`
- Event sequence: `conversation_started`, `generating`, 748 × `output_delta`,
  `config_partial` ×10, `conversation_complete` ×2, `config_update` ×2, then the two
  terminal events **`agent_saved`** `{id}` and **`done`** `{agentId, durationMs: 16553, mode}`
- The follow-up `PUT /agent-studio/super-agent/agents/{id}` → **200**, config applied
  (name and systemPrompt verified on read-back)

So the full Studio chain works when driven directly, and the driver's terminal-event
expectations (`agent_saved` / `done`) match reality.

**Unresolved:** through the MCP tool the same call returned `SSE_INCOMPLETE`. The gateway's
SSE parser was then replayed against the exact observed stream shape (including the leading
`: connected` comment) and parsed it correctly, extracting `done` — so this is **not** a
parser defect. The run happened with a token-id ~4 minutes from expiry, and **no agent was
created** (account swept and confirmed), which is consistent with the stream genuinely
terminating early. Recorded as unexplained rather than guessed; needs one clean re-run on a
fresh credential.

Worth stating plainly: on that run the guard behaved **correctly** — a truncated stream was
refused rather than reported as a successful creation, and nothing was left on the account.

**Also unresolved:** `create_studio_agent` requires **both** `systemPrompt` (IR validation)
and `buildPrompt` (the SSE build message). Supplying only one fails with a message naming the
other, which reads as contradictory. The two-field requirement should be documented in the
tool description or reconciled into one field.

### Follow-up (cont.): Agent Studio now works end-to-end — SSE mystery resolved

`create_studio_agent` is now **fully live-proven**: `ok: true`, `verified: true`, zero
mismatches, canary deleted. Two things had to be settled, both via a live diagnostic:

1. **The `SSE_INCOMPLETE` was a CRLF/chunking parser bug (fixed, commit `289efd3`).** The
   real stream arrives as ~757 small chunks over ~16.5s with `\r\n\r\n` frame separators;
   `split(/\n\n/)` never split CRLF frames, so the terminal `done` was never seen. An
   opt-in payload-free diagnostic (`GHL_SSE_DIAGNOSTICS=1`, stderr only) confirmed the fixed
   parser now reaches `terminalEvent: "done"` on the real 47950-byte / 757-chunk stream.
   (Codex ranked an upstream timeout first; the live log disproved that — the stream closed
   normally *with* its terminal event once framing was fixed.)

2. **Then a false verification mismatch on `config.triggers` / `config.actions`.** A Studio
   agent is built by the AI from `buildPrompt`, so the server keeps AI-generated triggers
   (the IR expects `[]`, the agent legitimately has one) and stores no `actions` key at all.
   Verifying the whole config asserted fields we never authored. Fixed: Studio verification
   now checks only the identity fields we deterministically set and that round-trip —
   `name` and `systemPrompt`. The follow-up PUT still sends the full config; we just don't
   pretend to verify what the AI produced.

**All three AI create tools are now live-proven end-to-end** (ConvAI, Voice AI, Agent
Studio). Remaining on the surface: `create_studio_agent`'s dual `systemPrompt`+`buildPrompt`
requirement should be reconciled or documented in the tool description. (`raw_request` now
reaches the AI host via `host:"ai"` — live-proven 2026-07-21.)

## Live proof ledger — 0.8.0 code-review re-proof (2026-07-21)

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Driven through a real MCP stdio session on a
freshly captured credential pair. The review fix set changed the AI-agent verification logic
(D1 nested-key classification, D2 SSE-id recovery, D3 confirmed-key requirement), so per this
project's "green tests ≠ live" rule those two write paths were re-driven end-to-end, not just
unit-tested.

| Tool | EXECUTED | OBSERVED |
|---|---|---|
| `create_studio_agent` | SSE build → follow-up PUT → GET re-read | `ok:true, verified:true`; confirmed `config.name`, `config.systemPrompt`; 0 mismatches; agent id extracted from the SSE stream (D2 path). **Deleted afterwards** (`200 {success:true}`). |
| `create_voiceai_agent` | POST create → full-replace PUT → GET re-read | `ok:true, verified:true`; 21 top-level keys confirmed; the 37 `agentSettings`-nested fields correctly bucketed as `unverified`, **not** false mismatches (D1). **Deleted afterwards** (`204`). |

Cleanup was verified against the raw list bodies of both surfaces — neither canary id
remained, and the pre-existing agents were left untouched. Regression tests were added for
each fix (server 152→159, ai-agents 182→186, memberships 12→13).
