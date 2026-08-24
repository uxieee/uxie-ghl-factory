---
description: Add a GHL sub-account to the public rail — you ask for the two values, the tool verifies them against GHL before anything is written
---

# /uxie-ghl-factory:add-account

Use the **`ghl-public-mcp-setup`** skill and follow its *Add a sub-account* section. Everything
this command needs — where the two values live, what each failure means, what you must never
do — is there, so it stays correct in one place and works for Codex too (which has no slash
commands).

In short: run `doctor --json` first, ask the person for a Private Integration Token and the
sub-account's location id, then:

```bash
npx -y @uxieee/ghl-mcp accounts add --token "$GHL_PIT" --location "$LOCATION_ID" --json
```

Report the `name` **GHL** returns, and confirm it is the client they meant. Nothing is written
unless it verifies. Then offer `/uxie-ghl-factory:scope` to point a folder at it.
