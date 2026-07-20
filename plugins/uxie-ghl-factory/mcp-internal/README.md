# uxie-ghl-internal-mcp

MCP server exposing the `uxie-ghl-factory` plugin's proven GoHighLevel **internal-API**
engines as schema-validated tools. Complements the plugin's skills — the specialists
design, this server executes.

**Status: read-only surface (Plan 2 of 4). Live-proven on GROM AU 2026-07-20.**
Workflow write tools, fast-forward, memberships and AI agents land in Plans 3–4.

## Credential model

Credentials live in a **file on your machine**, written by the Playwright capture
runbook (`docs/auth-jwt-capture.md`). They are never accepted as a tool argument,
never logged, and never echoed in a response or error.

- Point the server at the file with `GHL_TOK_FILE=<path>` or the `set_token_file` tool
  (a **path**, never a token — a JWT-looking value is rejected without echoing it back).
- The file is re-read **on every call**, so re-capturing mid-session works with no restart.
- JWTs last ~1 hour. On expiry you get `TOKEN_EXPIRED` naming the runbook to re-run.
- The token is scoped to the workflow-builder iframe origin. A token captured from a
  request whose `referer` is `app.gohighlevel.com` is unscoped and 401s on every call.

## Install

```bash
claude mcp add ghl-internal -e GHL_TOK_FILE="/abs/path/to/tok.txt" -- node /abs/path/to/mcp-internal/stdio.mjs
```

## Tools

| Tool | Reads |
|---|---|
| `set_token_file` / `auth_status` | — (credential state; claims only, never the token) |
| `list_workflows` | `GET /workflow/{loc}/list` |
| `get_workflow` | summary + step count (use `export_workflow` for the graph) |
| `export_workflow` | workflow body + triggers + sticky notes |
| `get_workflow_logs` | executions, per-step counts, enrollment roster |
| `list_account_entities` | pipelines, calendars, users, forms, custom fields, AI agents |
| `raw_request` | escape hatch — **GET only** in this build |

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
| `ENGINE_ABORT` | engine threw — usually a spec or dependency problem |
| `HTTP_<n>` | any other upstream status |

## Live proof ledger — EXECUTED vs OBSERVED

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Workflow: *AU Magic Link Provisioner*
(`6efef18a…`), published, 116 total enrolled. Date: **2026-07-20**. Driven through a real
MCP stdio session (`initialize` → `tools/call`), not unit tests. Read-only; nothing mutated.

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
