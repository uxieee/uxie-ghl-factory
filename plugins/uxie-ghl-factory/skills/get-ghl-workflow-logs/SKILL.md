---
name: get-ghl-workflow-logs
description: Read the RUNTIME of a GoHighLevel / HighLevel workflow — its execution logs, enrollment history, and per-step contact counts — from the builder's read-only internal endpoints. Use whenever the user wants to know what a workflow actually DID at runtime rather than how it's configured — for example "why are contacts stuck", "did this workflow actually send the email/SMS", "show me the execution logs", "run history", "enrollment history", "which step is everyone sitting at", "why did this step fail / get skipped", "is this branch dead", "how many contacts went down this path", "who exited early and why", or when they give an app.gohighlevel.com workflow URL and ask what happened to the contacts in it. This is the runtime sibling of get-ghl-workflow-json (which exports the static config). Uses browser JWT interception, human-paced throttling, and read-only GET requests only — never mutates enrollments.
---

# Get GHL Workflow Logs

Capture the *runtime* behind a HighLevel workflow — the execution trace, the enrollment records, and the live per-step occupancy — and turn it into evidence the user can act on. Where `get-ghl-workflow-json` answers "how is this workflow built," this skill answers "what happened when contacts ran through it."

This is a narrow, read-only extraction-and-interpretation skill, not a full audit. It gets the runtime data onto disk and explains what it means. A whole-account audit is `/uxie-ghl-factory:audit`.

## Boundaries

These matter because the token you intercept can, in principle, mutate a live client's automations — and a workflow's runtime data is real people's message history. Stay strictly read-only.

- Use only read-only `GET` requests against `backend.leadconnectorhq.com`. Never `POST`, `PUT`, `PATCH`, or `DELETE` with an intercepted JWT — the runtime-control endpoints (stop-execution, force-resume, requeue/remove stuck) are explicitly out of scope for this skill.
- Use the user's own logged-in browser session; never ask for or store credentials.
- Capture only one location/sub-account per session unless the user explicitly asks to switch.
- Call the throttle before every internal fetch (see runbook §2). If any fetch returns `429` or `403`, record the rejection, stop, and tell the user — don't hammer a client's backend.
- Execution logs contain contact PII and full message bodies. When you save captures, that's fine (it's the user's own data). When you *paste into chat or write a summary/report*, redact or omit personal content unless the user asks to see a specific contact — lead with the diagnostic signal, not the mailing list.
- Auth header format, capture procedure, and token lifetime: see `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` (the canonical auth doc). The intercepted JWT must be scoped to the workflow-builder iframe origin or reads 401 — the auth doc covers this.

## What "runtime" means here — three endpoints

The workflow builder's **Execution logs** and **Enrollment history** tabs are powered by three read endpoints. Each answers a different question; together they reconstruct a workflow's health.

| Endpoint | The question it answers |
|---|---|
| `workflows/logs/v2` | **What fired?** One row per action executed per contact — the step-by-step trace, with success/failure/skip and the reason. |
| `workflows/status/search/workflow-with-filter` | **Who's enrolled, and when do they move?** One row per contact enrollment — current step, next resume time, how they entered. |
| `workflows/status/search/count-per-step` | **Where is everyone right now?** A live count of contacts parked at each step. |

Exact URLs, query params, pagination, and response schemas are in `references/logs-capture-runbook.md`. Read it before fetching.

## Default Workflow

1. **Parse the target.** Workflow URL shape: `https://app.gohighlevel.com/location/{LOCATION_ID}/workflow/{WORKFLOW_ID}`. If either ID is missing, ask for the workflow URL or both IDs.
2. **Understand the ask.** Match the user's intent to the right endpoint(s) so you don't over-fetch:
   - "why are contacts stuck / where is everyone" → `count-per-step` + `workflow-with-filter`
   - "did it send / why did this step fail / execution logs / run history" → `logs/v2`
   - "what happened to contact X" → `logs/v2` with `contactId` filter
   - open-ended "what's going on with this workflow" → all three
3. **Load `references/logs-capture-runbook.md`** for the browser procedure, endpoint params, pagination, and schemas. Load `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` for JWT capture and headers.
4. **Capture the scoped JWT** per the canonical auth doc.
5. **Throttle, then fetch** only the endpoints the ask needs. For `logs/v2`, page with the keyset cursor until you have enough to answer (don't blindly pull the whole history of a busy workflow).
6. **Save raw responses** under the current project:
   - `workflow-logs/{locationId}/{workflowId}/{YYYY-MM-DD-HHMM}/logs.json`
   - `enrollments.json`, `step-counts.json` (whichever were fetched)
   - `manifest.json` with source URL, capture time, endpoints hit, page count, date window, and anything skipped.
7. **Interpret, don't just dump.** Use the diagnostic reading below to turn rows into findings.

## Reading the data (why this is more than a dump)

Raw log rows are only useful once mapped to what they mean. The signal lives in `status` and `meta`:

| Signal | Where | What it tells you |
|---|---|---|
| `status: success` but `meta.status ≥ 400` | logs/v2 | **Silent failure** — the step "ran" but the downstream send/API rejected it. |
| `status: failed` | logs/v2 | Hard error; `meta.msg` / `meta.status` say why. |
| `status: skipped` | logs/v2 | Gated out; `meta.skippedFor.type` (`dnd`, `time-window`, `missing-data`, `active-already`, `appointment-wait`, …) says which gate. |
| `status: finished` | logs/v2 | Contact left the workflow; `meta.removedFrom.type` says why (reply-stop, end-of-workflow, wait-window-in-past). |
| `executeOn` in the **past**, still `wait_time` | workflow-with-filter | **Stuck contact** — should have resumed already. |
| step absent from `count-per-step` | count-per-step | No contact is (or maybe ever was) there — candidate **dead branch**; confirm against logs. |
| `metrics.actionExecutionTime` + `segments[]` | logs/v2 | Where latency is. |
| `meta.addedSource` / `extraMeta.attributionSource` | workflow-with-filter | How the contact entered (trigger, ad campaign, manual). |

**Join keys:** `workflowStatusId` (a ULID) ties one enrollment to all its log rows; `workflowTraceId` groups the rows of a single run. Use these to answer "walk me through what happened to this one contact."

## Output Rules

- Preserve raw JSON exactly on disk. Don't normalize or discard unknown fields — the schema evolves and today's junk field is tomorrow's signal.
- When summarizing to the user, lead with findings: counts by status, stuck contacts, failed/skipped steps with reasons, dead-branch candidates — then point to the saved files. Don't paste raw contact PII unless they ask about a specific person.
- If a fetch fails (401/403/429), keep what you have, report the exact status, and follow the auth/throttle guidance rather than silently retrying.

## Tool Routing

- In Claude Code, use the Playwright MCP tools named in the runbook.
- In Codex, use the Chrome plugin for authenticated GHL pages; lazy-load browser tools if needed.
- If the workflow is already open in the browser, prefer reading the existing network log over reloading. Deep links hard-404 (GHL serves only `/` server-side) — reach a workflow via the SPA's client-side router or by clicking through; the runbook covers this.

## Resources

- `references/logs-capture-runbook.md` — exact endpoints, query params, keyset pagination, date windows, response schemas, and save-file guidance.
- `scripts/throttle.py` — persistent human-pace throttle and cooldown guard (shared design with the sibling read skill).
- `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` — canonical JWT capture + header format.
