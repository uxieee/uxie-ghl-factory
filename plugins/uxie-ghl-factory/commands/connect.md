---
description: Authorize the uxie-ghl-internal-mcp server — the agent opens Playwright, you log into GHL, the agent captures the token(s) and writes the credential file. Re-run when a tool reports TOKEN_EXPIRED.
---

# /uxie-ghl-factory:connect

Agent-driven credential capture for the always-registered `uxie-ghl-internal-mcp` server.
**You never handle the token.** The agent drives the browser; the user only logs in.

## Credential rule (non-negotiable)

NEVER print, echo, log, or paste any string matching `ey[A-Za-z0-9._-]{20,}` (a JWT). The
token goes **from the browser to the file only**. Confirm success by decoding **claims**
(issuer / role / exp / seconds-remaining) — never the token itself. If a capture value would
ever reach the transcript, redact it by JWT shape.

## Canonical token file

Write to **`~/.uxie-ghl-internal-mcp/tok.txt`** (the server's `DEFAULT_TOKEN_FILE`; create the
directory, mode `0700`, file `0600`). The auto-registered server re-reads it every call, so a
capture mid-session takes effect immediately — no restart.

Format:
```
Bearer <jwt>
token-id: <firebase-token>
```
`token-id` is only needed for the AI-agent tools; capture it whenever available (the AI
surface provides both in one shot).

## Steps (agent runs these)

1. **Open the Playwright browser (headed).** It is a SEPARATE Chrome profile — the user's
   normal GHL login does NOT carry over. Navigate to the **AI Agents** surface so one capture
   yields both credentials:
   `https://app.gohighlevel.com/v2/location/<LOCATION_ID>/ai-agents/getting-started`
   (referer MUST be `app.gohighlevel.com`, NOT the workflow iframe — the iframe referer yields
   no `token-id`). Tag `document.title` so the user can find the window (it buries behind other
   apps; osascript can't raise it — no Accessibility permission).
2. **Ask the user to log into GHL** in that browser window and confirm when they see their
   sub-account. Wait for them.
3. **Generate a real request** to `services.leadconnectorhq.com` (navigate/refresh the AI
   surface) and **capture its request headers leak-safe**: `browser_network_request` with
   `part:"request-headers"` and a `filename` → parse `Authorization: Bearer …` and `token-id:
   …` from the FILE (never inline) → write the token file → delete the intermediate header file.
4. **Confirm by claims only:** decode each JWT's payload and report issuer / role / type / exp /
   seconds-remaining. Never the token. (Valid AI `token-id`: `iss` =
   `securetoken.google.com/highlevel-backend`, `role: admin`.)
5. **Probe token scoping (resolves the workflow-vs-AI question live).** With the captured
   Bearer, do ONE read-only call to the workflow surface via the server's `list_workflows`
   (or `raw_request` GET to `backend.leadconnectorhq.com`). 
   - **200** → this Bearer covers workflow + AI; done.
   - **401/403** → the workflow tools need a token scoped to the workflow-builder iframe. Tell
     the user, then also navigate the browser to a workflow-builder view, capture that Bearer
     the same leak-safe way, and record the finding (the credential file / gateway may need to
     carry a second, workflow-scoped Bearer — flag it, don't silently ship a half-working set).
6. **Verify end-to-end:** call `auth_status` (claims only), then one real read tool
   (`list_workflows`) and confirm `ok`. Report a short pass/fail.

## Expiry

JWTs last ~1 hour. When any tool returns `TOKEN_EXPIRED`, just re-run `/uxie-ghl-factory:connect`
— re-capture to the same file and the next call succeeds. No restart, no `claude mcp` changes.

## Auth reference

Rails, referer traps, and the dual-credential AI detail live in
`${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`. This command is the agent-run capture path;
that doc is the underlying reference.
