# Capture Playbook

The repeatable procedure for capturing a GHL internal API call, proven across Conversation AI,
Voice AI, Agent Studio, and the workflow builder.

## 0. Prerequisites
- A Playwright MCP browser, already authenticated on `https://app.gohighlevel.com/` (no login form →
  you're in). Load tools via ToolSearch: `browser_navigate`, `browser_snapshot`, `browser_click`,
  `browser_type`, `browser_select_option`, `browser_network_requests`, `browser_network_request`,
  `browser_evaluate`, `browser_wait_for`.
- A target sub-account `locationId`. Get one from `localStorage` (`activeLocations`, or an
  `exportFilter-<locId>` key) via `browser_evaluate`, or from the Sub-Accounts list.

## 1. Navigate (the SPA 404 trap)
The server 404s every deep path — only `/` is served; the SPA client-routes. So:
- `browser_navigate('https://app.gohighlevel.com/')` → lands on the agency dashboard.
- Then **click**: `browser_snapshot` to find the nav element → `browser_click` → repeat.
  Typical path: Sub-Accounts → the sub-account row → "Switch to Sub-Account" → the feature's nav icon.
- Do NOT `browser_navigate` to `/v2/location/.../...` — it 404s and resets you to the agency view.

## 2. Perform the action, then capture
1. Do ONE config action in the UI (create, edit-a-field, add-an-action, save).
2. `browser_network_requests({ static:false, filter:"<service-regex>" })` — e.g.
   `"ai-employees|conversations-ai"`, `"voice-ai"`, `"agent-studio"`, `"workflow"`. This lists the
   calls with numbers.
3. Find the POST/PUT/PATCH your action triggered → `browser_network_request(<number>)` → returns the
   full method, URL, request headers, request body, and response body. **The request body is the schema.**
4. Record: endpoint (method + path with `:id` placeholders), auth header name (NOT the value),
   the full body, and the response (server-assigned fields like ids appear only in the response).

## 3. Capture WRITE payloads safely (create → capture → delete)
Many schemas only appear on write. To get them without disrupting the account:
- Create ONE object named `TEST-CAP-<THING>` (e.g. `TEST-CAP-CONVAI`). Keep it DRAFT.
- Edit each section (short test values), saving each → capture each save payload (that's how you learn
  every field + which section it belongs to).
- Add one of each sub-resource (e.g. one action) → capture its create payload + its `type` enum value.
- **DELETE** the `TEST-CAP-*` object. Verify it's gone (list count drops / GET → 404). Report cleanup.
- Never publish, never enroll/trigger a contact, never place a real call, never buy/provision numbers.

## 4. Feature gating
Some surfaces are gated per location (e.g. Voice AI **outbound** needs KYC completed — its
dynamic-fields endpoint returns only a "disabled" warning field otherwise). Don't enable compliance
features yourself. Instead, probe a few sub-accounts and use one where the feature is already enabled.

## 5. Auth token capture
Internal calls need the session token. Grab a fresh one from the browser's own network history
(`browser_network_request` on any authenticated call shows the header) — do NOT reuse a stale saved
token (JWTs expire ~1 hr; a stale one 401s). Match the header to the service (see
`internal-api-map.md`). Redact the value everywhere.

## 6. Save + document
- Raw payloads → `captures/<thing>-<op>.json`: `{ endpoint, method, authHeader, requestBody, responseBody }`
  (token redacted).
- Reference doc → an endpoint-map table + object schema (by section) + PUT merge-vs-replace note +
  action/sub-resource schemas + open items (what you didn't capture, marked clearly).

## Common pitfalls
- **Colon-space in YAML frontmatter** breaks skill loading — quote any `description:` containing `: `.
- **Steps aren't always inline** — the workflow builder stores steps in a versioned Firebase Storage
  blob (`fileUrl`), not in the `PUT /workflow/...` body. Read the blob to see steps.
- **Merge vs replace differs by product** — confirm before building an engine (a partial PUT that
  merges on one product silently wipes fields on a full-replace product).
- **Validate deeply**: `claude plugin validate ./plugins/<name>` checks skill frontmatter;
  plain `claude plugin validate .` only checks the marketplace manifest.
