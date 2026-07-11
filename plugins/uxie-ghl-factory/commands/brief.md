---
description: Create or update the per-client GHL account brief (.ghl/<locationId>/brief.md) via a short interview informed by MCP recon
---

# /uxie-ghl-factory:brief

1. Determine target locationId: ask, or list locations via the ghl MCP if
   the user isn't sure. State layout: ${CLAUDE_PLUGIN_ROOT}/docs/brief-format.md.
2. If .ghl/<locationId>/brief.md exists: show a 5-line summary, ask only
   what changed, update `updated:`, append to Discovered facts. Done.
3. If new: silently recon the account first (ghl MCP: location details,
   pipelines, workflow count, calendars, forms) — never ask what recon
   can answer. Then interview ONE question at a time, in template order,
   skipping anything recon answered (confirm instead of ask).
4. Write the brief in the exact template format. Confirm the file path
   to the user and remind them .ghl/ is gitignored (client PII).
