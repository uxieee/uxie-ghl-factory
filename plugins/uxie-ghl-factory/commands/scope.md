---
description: Point this folder at one client's sub-accounts by name, so the ghl MCP server here sees that client and no others
---

# /uxie-ghl-factory:scope

Writes this folder's `.mcp.json` so the public `ghl` server registered here sees only the
sub-accounts that belong to this client. One credential file, narrowed per project.

## Why by name

You know the client by **name**. The location id is a 20-character opaque string, and copying
one by hand is how a project ends up quietly pointed at the wrong client.

A *typo* fails loudly — the server refuses to start on an id that is not in the accounts file.
But pasting a **different real** id fails silently forever: both ids are valid, so the folder
simply operates on another client and nothing ever complains. So: **name the client, never
type an id.** The tool resolves it.

## Steps

1. **Check what this folder already sees** before changing it:
   ```bash
   npx -y @uxieee/ghl-mcp scope --list --json
   ```

2. **Scope it.** Name one or more sub-accounts exactly as `accounts list` shows them:
   ```bash
   npx -y @uxieee/ghl-mcp scope "<Client Name>" --json
   npx -y @uxieee/ghl-mcp scope "<Client> Main" "<Client> Second Location" --json
   ```
   In the user's own agency folder, where they want everything:
   ```bash
   npx -y @uxieee/ghl-mcp scope --all --json
   ```
   `--all` omits the allowlist entirely rather than listing every id, so sub-accounts added
   later are picked up without re-scoping.

3. **Read the result back.** `scopedTo` names what the folder now sees, and `preserved` lists
   the other MCP servers in that `.mcp.json` that were left alone (it merges, it does not
   replace). Confirm the names are the client the user meant.

   An **ambiguous** name is refused with the candidates listed, and nothing is written. Ask
   the user which one rather than picking — "Acme" matching both *Acme Dental* and *Acme Med
   Spa* is exactly the case where guessing puts you in the wrong account.

4. **Verify from the server, not the file.** After Claude Code reloads the folder's config,
   call `list_locations` on the `ghl` server and confirm it returns those sub-accounts **and
   no others**. A config that looks right and a server that is scoped right are different
   claims; only the second one matters.

## Notes

- Scoping is per **folder**, and project-scoped `.mcp.json` is inherited by subfolders — so a
  client folder with several project subfolders needs scoping once, at the client level.
- If `doctor --json` reports `GHL_ALLOWED_LOCATIONS` naming an id absent from the accounts
  file, the server will refuse to start. Re-run `scope` rather than editing the JSON.
- Codex has no per-project MCP config: `~/.codex/config.toml` is global. Give each client its
  own named server there instead (`[mcp_servers.ghl_acme]`), each with its own
  `GHL_ALLOWED_LOCATIONS`.
