---
description: Set up + authorize the uxie-ghl-internal-mcp server FOR THE CURRENT PROJECT — registers a project-scoped server (its own account token per folder), the agent opens Playwright, you log into GHL, the agent captures the token. Also the re-authorize path on TOKEN_EXPIRED.
---

# /uxie-ghl-factory:connect

Sets up the internal MCP server **for the current project only** — it is NOT global. Run it in
each GHL client folder you work in; each folder gets its own server registration and its own
account token, so different projects = different accounts (no cross-contamination). **You never
handle the token.** The agent drives the browser; you only log in.

## Credential rule (non-negotiable)

NEVER print, echo, log, or paste any string matching `ey[A-Za-z0-9._-]{20,}` (a JWT). The
token goes **from the browser to the file only**. Confirm success by decoding **claims**
(issuer / role / exp / seconds-remaining) — never the token. Redact by JWT shape if a value
would ever reach the transcript.

## Per-project layout

- **Token (per project):** `<project>/.ghl/uxie-ghl-internal-mcp-tok.txt` (mode `0600`). The
  `.ghl/` dir holds per-client PII and MUST be gitignored — ensure `.ghl/` is in the project's
  `.gitignore`.
- **Launcher (stable, shared):** `~/.uxie-ghl-internal-mcp/launch.mjs` — a copy of the plugin's
  `mcp-internal/launch.mjs`, so the project config points at a path that survives plugin
  updates (it resolves the newest installed plugin build at run time).
- **Registration:** project-scoped via `claude mcp add --scope local`, keyed to this folder.

## Steps (agent runs these)

1. **Copy the launcher to its stable home** (idempotent — refreshes it each run):
   ```bash
   mkdir -p "$HOME/.uxie-ghl-internal-mcp"
   cp "${CLAUDE_PLUGIN_ROOT}/mcp-internal/launch.mjs" "$HOME/.uxie-ghl-internal-mcp/launch.mjs"
   ```
2. **Capture the token to the project-local file** (leak-safe). Open the Playwright browser
   (SEPARATE Chrome profile — the user's normal GHL login does NOT carry over) to the **AI
   Agents** surface so one capture yields both credentials:
   `https://app.gohighlevel.com/v2/location/<LOCATION_ID>/ai-agents/getting-started`
   (referer MUST be `app.gohighlevel.com`, NOT the workflow iframe). Tag `document.title` so the
   user can find the window. Ask the user to log in; wait. Then capture a
   `services.leadconnectorhq.com` request's headers via `browser_network_request`
   `part:"request-headers"`+`filename` → parse `Authorization: Bearer …` and `token-id: …` from
   the FILE → write `<project>/.ghl/uxie-ghl-internal-mcp-tok.txt` (create `.ghl/` `0700`, file
   `0600`) → delete the intermediate. Confirm by claims only. Ensure `.ghl/` is gitignored.
   Format:
   ```
   Bearer <jwt>
   token-id: <firebase-token>
   ```
   (Live-proven: one AI-surface capture authenticates workflow + AI + memberships — no separate
   token needed.)
3. **Register the server for THIS project** (skip if already registered — `claude mcp list`):
   ```bash
   claude mcp add --transport stdio --scope local \
     -e GHL_TOK_FILE="$(pwd)/.ghl/uxie-ghl-internal-mcp-tok.txt" \
     uxie-ghl-internal-mcp \
     -- node "$HOME/.uxie-ghl-internal-mcp/launch.mjs"
   ```
   `--scope local` keeps it private + project-specific (in `~/.claude.json` under this folder).
   The first time Claude Code connects a project server it may show a **workspace-trust dialog**
   — the user accepts it once per folder.
4. **Verify:** the server should connect; call `auth_status` (claims only) then one real read
   tool (`list_workflows`) and confirm `ok`. Report a short pass/fail. (A brand-new registration
   may need the user to reload/approve before the tools appear.)

## Re-authorize on expiry (agent: do this automatically)

GHL JWTs last ~1 hour. **When any internal tool returns `TOKEN_EXPIRED` (or `TOKEN_MISSING`),
re-run this command's capture step (2) automatically** — write a fresh token to the SAME
project file — then retry the tool. The server re-reads the file every call, so no restart or
re-registration is needed; steps 1 and 3 only run on first setup for a folder. Do not stop to
ask; just re-capture (the user still logs in).

## Auth reference

Rails, referer traps, and the dual-credential AI detail live in
`${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`.
