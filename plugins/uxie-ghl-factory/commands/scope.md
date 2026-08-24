---
description: Point this folder at one client's sub-accounts by name, so the ghl MCP server here sees that client and no others
---

# /uxie-ghl-factory:scope

Use the **`ghl-public-mcp-setup`** skill and follow its *Point a folder at one client* section,
then its *Verify from the server, not the file* section. The reasoning for why this is done by
name and never by id lives there.

In short:

```bash
npx -y @uxieee/ghl-mcp scope --list --json          # what does this folder see now?
npx -y @uxieee/ghl-mcp scope "<Client Name>" --json # point it at one client
```

An ambiguous name is refused with the candidates listed — ask which one, do not pick. Then call
`list_locations` on the running server and confirm it returns those sub-accounts and no others.
