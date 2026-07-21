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
6. OPTIONAL — internal API: ask whether they want internal-API features now;
   if yes, walk ${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md §2 once,
   including the ToS disclosure from ${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md.
6b. OPTIONAL — internal-API MCP server: the internal-API capabilities (workflow
    build/edit/publish, funnel/membership/AI-agent building, fast-forward) are also
    available as a local stdio MCP server at ${CLAUDE_PLUGIN_ROOT}/mcp-internal/ — an
    alternative to driving the skills' scripts. It is OPT-IN and never auto-started
    (it needs a captured JWT). If they want it, walk
    ${CLAUDE_PLUGIN_ROOT}/mcp-internal/README.md "Install" (one-time `npm install`
    there, then `claude mcp add ghl-internal -e GHL_TOK_FILE=<path> -- node
    ${CLAUDE_PLUGIN_ROOT}/mcp-internal/stdio.mjs`). The credential model is the same
    file-based JWT as the skills; nothing new to trust beyond what step 6 covered.
7. POINT FORWARD: suggest /uxie-ghl-factory:brief for their first client, and the
   ghl-orientation skill for agents new to GHL.
