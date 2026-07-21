---
description: First-run setup for the ghl plugin — prerequisites, GHL API token, MCP connection test, version check
---

# /uxie-ghl-factory:setup

Run these in order; report a pass/fail table at the end.

1. PREREQUISITES: node --version (need ≥18); check a Playwright MCP server
   is available (needed only for internal-API skills — if absent, say which
   features degrade: workflow export/creation, funnel building).
2. TOKEN: check env GHL_PIT is set. If not, walk the user through creating
   a Private Integration Token in GHL (Settings → Private Integrations,
   scopes: read everything, write only what they'll use) and how to persist
   the env var for their shell/session, then have them restart or /mcp reconnect.
3. TRUST NOTE (verbatim): "By default, this plugin routes your GHL requests
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
   build/edit/publish, funnel/membership/AI-agent building, fast-forward — 17 tools)
   is **registered automatically** with the plugin (bundled `.mcp.json`); it needs no
   `npm install` and nothing to add by hand. Confirm it shows as a healthy registered
   server. The one thing it needs is a credential — before its tools work, run
   `/uxie-ghl-factory:connect` (the agent opens a browser, the user logs into GHL, the
   agent captures the token). Present the ToS disclosure from
   ${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md once before the first internal-API write.
   (Codex has no auto-registration or slash commands — point Codex users to
   ${CLAUDE_PLUGIN_ROOT}/mcp-internal/README.md to configure it in ~/.codex/config.toml.)
7. POINT FORWARD: suggest /uxie-ghl-factory:brief for their first client, and the
   ghl-orientation skill for agents new to GHL.
