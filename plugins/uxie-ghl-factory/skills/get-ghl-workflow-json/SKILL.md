---
name: get-ghl-workflow-json
description: Capture, export, and validate GoHighLevel / HighLevel workflow JSON from the workflow builder's read-only internal endpoints. Use when the user asks to get, download, export, inspect, archive, harvest, or troubleshoot raw workflow JSON/config; workflow trigger JSON; sticky notes; step counts; workflow settings; trigger/action catalogs; or when they provide an app.gohighlevel.com location/workflow URL and want the underlying JSON. Uses browser JWT interception, human-paced throttling, and read-only GET requests only.
---

# Get GHL Workflow JSON

> **MCP routing:** If the `uxie-ghl-internal-mcp` server is registered in this session, prefer its read tools (`export_workflow`, `get_workflow`, `list_workflows`) over running this skill's scripts directly. Fall back to this skill's own scripts when the server is not registered.

Capture the raw JSON behind a HighLevel workflow builder view, preserve it on disk, and validate that the capture is structurally useful. This is a narrow extraction skill, not a full audit skill.

## Boundaries

- Use only read-only `GET` requests against `backend.leadconnectorhq.com`.
- Never `POST`, `PUT`, `PATCH`, or `DELETE` with an intercepted JWT.
- Use the user's own logged-in browser session; do not ask for or store credentials.
- Capture only one location/sub-account per session unless the user explicitly asks to switch.
- Call `scripts/throttle.py wait` before every internal fetch. If any fetch returns `429` or `403`, call `scripts/throttle.py reject <status>`, stop, and tell the user.
- Auth header format, capture procedure, and token lifetime: see `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` (the canonical auth doc). Do not use `refreshedToken` or other localStorage tokens. (The old `token-id` header was retired in GHL's 2026-07 auth migration and now returns 401.)

## Default Workflow

1. Parse the target.
   - Workflow URL shape: `https://app.gohighlevel.com/location/{LOCATION_ID}/workflow/{WORKFLOW_ID}`.
   - If either ID is missing, ask for the workflow URL or both IDs.
2. Load `references/capture-runbook.md` for the browser procedure and `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` for the exact JWT capture/header-format details.
3. Capture the scoped JWT per the canonical auth doc.
4. Fetch the workflow config and trigger JSON by default.
5. Fetch optional related JSON only when useful or requested: sticky notes, step counts, workflow settings, trigger/action catalogs, pipelines, or custom values.
6. Save raw responses under the current working project:
   - `workflow-json/{locationId}/{workflowId}/{YYYY-MM-DD-HHMM}/workflow.json`
   - `trigger.json`
   - optional endpoint files, named by purpose
   - `manifest.json` with source URL, capture time, endpoint list, and any skipped endpoints
7. Run `scripts/validate_workflow_capture.py` against the capture directory before reporting success.

## Output Rules

- Preserve raw JSON exactly. Do not normalize, redact, summarize into replacement files, or discard unknown fields.
- If summarizing to the user, include workflow name, status, step count, trigger count, saved folder, and validation result.
- If validation fails, keep the files and report the specific missing/odd fields.
- If the user wants JSON pasted into chat, provide the relevant complete object only when it is small enough to be useful; otherwise point to the saved file path and summarize.

## Tool Routing

- In Codex, use the Chrome plugin for authenticated remote GHL pages when available. Lazy-load Chrome tools if needed.
- In Claude Code, use the Playwright MCP tools named in the runbook.
- If only browser network data is needed and the workflow is already open, prefer reading the existing tab/network log over reloading repeatedly.

## Resources

- `references/capture-runbook.md` - exact JWT capture, CORS, fetch headers, endpoints, and save-file guidance.
- `references/workflow-json-shape.md` - starter schema and common validation expectations.
- `scripts/throttle.py` - persistent human-pace throttle and cooldown guard.
- `scripts/validate_workflow_capture.py` - structural validator and summary printer for captured files.
