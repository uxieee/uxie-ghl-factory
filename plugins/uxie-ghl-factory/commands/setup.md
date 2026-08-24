---
description: First-run setup for the ghl plugin — prerequisites, GHL API token, MCP connection test, version check
---

# /uxie-ghl-factory:setup

This plugin registers **no global MCP servers**. Both rails are set up **per-project**, for
two different reasons worth keeping straight:

- The **public rail** keeps every sub-account's token in one file, so folders no longer
  collide on a credential. They are separated by *scope* instead: each folder is pointed at
  the client it belongs to, and sees no others.
- The **internal rail** holds a ~1-hour JWT captured by browser login, one account at a time.
  It cannot be global, and per-folder is also the safer default: the rail that can write
  workflows is armed only where you deliberately set it up.

Run these in order; report a pass/fail table at the end.

1. PREREQUISITES: node --version (need ≥18); check a Playwright MCP server
   is available (needed only for internal-API skills — if absent, say which
   features degrade: workflow export/creation, funnel building).
2. CREDENTIALS: the public rail needs two values per sub-account, and **you cannot fetch
   either** — both live behind a browser login. Ask the user for them:
   - **Private Integration Token** — in that sub-account: Settings → Private Integrations →
     Create. Scopes: read everything, write only what they'll use.
   - **Location id** — the long id in the browser URL while they are in that sub-account:
     `app.gohighlevel.com/v2/location/<THIS>/dashboard`

   A PIT is bound to **one** sub-account, so a user with several clients has several tokens.
   An agency PIT cannot substitute: agency scopes cover locations, users, snapshots and SaaS,
   but there is no contacts/conversations/opportunities/calendars scope to grant.

3. PUBLIC `ghl` MCP SERVER: the public rail is an **npm package that runs locally over
   stdio** (`@uxieee/ghl-mcp`) — the token never leaves the user's machine. Start by asking
   the tool what is already set up, and follow the `nextSteps` it returns:

   ```bash
   npx -y @uxieee/ghl-mcp doctor --json
   ```

   a. **Add each sub-account once**, to one credential file (`~/.ghl/accounts.json`, mode
      0600). Never echo the token; pass it through a shell variable:
      ```bash
      npx -y @uxieee/ghl-mcp accounts add --token "$GHL_PIT" --location "$LOCATION_ID" --json
      ```
      On success GHL returns the sub-account's **real name** — that is proof the token
      actually reaches that location rather than something either of you typed. `401` = the
      token is revoked or wrong; `403` = the id and the token belong to *different*
      sub-accounts. **Nothing is written unless it verifies**, so a mistyped location id
      cannot become a silent write to another client.

   b. **Point this folder at the right client**, by name — never by id:
      ```bash
      npx -y @uxieee/ghl-mcp scope "<Client Name>" --json
      ```
      That writes this folder's `.mcp.json`, merging so any other MCP servers in the folder
      survive (the result lists what it preserved). An ambiguous name is refused with the
      candidates listed rather than guessed. In the user's own agency folder, `scope --all`
      gives every sub-account.

   Repeat (a) per sub-account, (b) per folder. First registration in a folder triggers a
   one-time workspace-trust prompt. If the user already runs their own public GHL MCP here,
   skip this and say so.

   *Already on the hosted Cloudflare Worker?* It still answers today but is being retired.
   Migrate with the two commands above, then remove the old registration
   (`claude mcp remove ghl`). Do not set up new folders on the Worker.

4. TRUST NOTE (verbatim): "The public GHL rail runs on your own machine as an npm package,
   so your Private Integration Token is sent only to GoHighLevel — it does not pass through
   the plugin author's infrastructure. What you are still trusting is the code: the MCP
   server's tool descriptions and the responses it returns are authored by a third party to
   you, and deserve the same scrutiny as any third-party MCP server. The source is
   github.com/uxieee/uxie-ghl-mcp-server, and the npm package is published from it."

5. CONNECTION TEST: call the ghl MCP `list_categories`; report category/action counts, and
   `list_locations` to confirm the folder sees the sub-accounts you expect **and no others**.
   Failure → run `doctor --json` and follow its `nextSteps`; don't proceed.

6. VERSION SKEW: `npx -y @uxieee/ghl-mcp doctor --json` reports the running package version.
   Compare with the plugin's expected catalog and report drift. `npx -y` fetches the current
   version each start, so a stale server usually means a pinned registration, not a bad
   package.
7. INTERNAL-API MCP SERVER: the `uxie-ghl-internal-mcp` server (workflow
   build/edit/publish, funnel/membership/AI-agent building, fast-forward — 17 tools) is
   **per-project, not global** — you add it to each GHL folder you work in. In the folder
   you want it, run `/uxie-ghl-factory:connect`: it registers a project-scoped server
   (its own account token per folder), then the agent opens a browser, the user logs into
   GHL, and it captures the token. First time in a folder, accept the workspace-trust
   prompt. Present the ToS disclosure from ${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md once
   before the first internal-API write. (Codex has no slash commands — point Codex users
   to ${CLAUDE_PLUGIN_ROOT}/mcp-internal/README.md to configure it in ~/.codex/config.toml.)
8. POINT FORWARD: suggest /uxie-ghl-factory:brief for their first client, and the
   ghl-orientation skill for agents new to GHL.
