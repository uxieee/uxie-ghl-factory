---
description: First-run setup for the ghl plugin — prerequisites, GHL API token, MCP connection test, version check
---

# /uxie-ghl-factory:setup

This plugin registers **no global MCP servers** — both the public `ghl` server and the
internal `uxie-ghl-internal-mcp` server are set up **per-project**, so multiple GHL accounts
across different folders don't collide on one credential. Run these in order; report a
pass/fail table at the end.

1. PREREQUISITES: node --version (need ≥18); check a Playwright MCP server
   is available (needed only for internal-API skills — if absent, say which
   features degrade: workflow export/creation, funnel building).
2. TOKEN: get this account's Private Integration Token. If it's not already set/known,
   walk the user through creating one in GHL (Settings → Private Integrations, scopes:
   read everything, write only what they'll use). Because tokens are per-sub-account, each
   client folder uses its OWN token.
3. PUBLIC `ghl` MCP SERVER (per-project): if this folder doesn't already have a public GHL
   MCP server (`claude mcp list`; the user may already run their own), register one scoped
   to this folder with that account's token:
   ```bash
   claude mcp add --transport http --scope local \
     -H "X-GHL-Token: $GHL_PIT" \
     ghl "${GHL_MCP_URL:-https://ghl-mcp-server.xanderjohnrazonroque.workers.dev/mcp}"
   ```
   (`$GHL_PIT` is expanded by the shell — the token is not echoed. `--scope local` keeps it
   private to this folder.) First registration in a folder triggers a one-time
   workspace-trust prompt. If the user already runs their own public GHL MCP here, skip this.
4. TRUST NOTE (verbatim): "By default, this plugin routes your GHL requests
   through the plugin author's Cloudflare Worker, and that means trusting
   the author on two separate things, not just one:
   - Credential forwarding: your GHL Private Integration Token is sent
     THROUGH the plugin author's Cloudflare Worker on every call. The
     author's infrastructure is in a position to see or misuse that token.
   - Tool/response trust: the MCP server's tool descriptions and the
     responses it returns are also authored by the plugin author — a third
     party to you, the installer. Using this server means trusting that its
     tool metadata and results aren't manipulative or tampered with, the
     same way you'd scrutinize any third-party MCP server.
   To remove BOTH dependencies, self-host: deploy
   github.com/uxieee/ghl-mcp-server yourself and set GHL_MCP_URL to your own
   Worker URL — then the author's infrastructure is out of the loop for
   both credential handling and tool/response trust."
4. CONNECTION TEST: call the ghl MCP list_categories; report category/action
   counts. Failure → token/URL troubleshooting, don't proceed.
5. VERSION SKEW: if the Worker exposes a catalog version, compare with the
   plugin's expected catalog and report drift; if the endpoint doesn't exist
   yet, say the check is unavailable in this Worker version.
6. INTERNAL-API MCP SERVER: the `uxie-ghl-internal-mcp` server (workflow
   build/edit/publish, funnel/membership/AI-agent building, fast-forward — 17 tools) is
   **per-project, not global** — you add it to each GHL folder you work in. In the folder
   you want it, run `/uxie-ghl-factory:connect`: it registers a project-scoped server
   (its own account token per folder), then the agent opens a browser, the user logs into
   GHL, and it captures the token. First time in a folder, accept the workspace-trust
   prompt. Present the ToS disclosure from ${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md once
   before the first internal-API write. (Codex has no slash commands — point Codex users
   to ${CLAUDE_PLUGIN_ROOT}/mcp-internal/README.md to configure it in ~/.codex/config.toml.)
7. POINT FORWARD: suggest /uxie-ghl-factory:brief for their first client, and the
   ghl-orientation skill for agents new to GHL.
