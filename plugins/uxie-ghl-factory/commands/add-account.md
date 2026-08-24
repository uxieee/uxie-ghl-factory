---
description: Add a GHL sub-account to the public rail — you ask for the two values, the tool verifies them against GHL before anything is written
---

# /uxie-ghl-factory:add-account

Adds one sub-account to the shared credential file the public `ghl` MCP server reads
(`~/.ghl/accounts.json`, mode 0600). Run once per sub-account; run
`/uxie-ghl-factory:scope` once per folder.

## The split of labour

You cannot fetch either value. Both live behind a GoHighLevel browser login, so the shape is
collaborative: **you work out what is missing and verify what comes back, the user fetches.**
Do not guess, and do not accept a value that fails verification.

## Steps

1. **See what is already there** — never assume a fresh machine:
   ```bash
   npx -y @uxieee/ghl-mcp doctor --json
   ```
   It reports the configured sub-accounts, re-verifies each token against GHL, and returns an
   ordered `nextSteps`. If the account the user wants is already listed and `ok`, say so and
   stop — adding it again is a no-op, but the user should know it was already working.

2. **Ask for the two values**, naming exactly where each one is:
   - **Private Integration Token** — in that sub-account: *Settings → Private Integrations →
     Create*. Read scopes for everything they want to read, write scopes only for what they
     intend to write. The token can do nothing you do not grant.
   - **Location id** — the long id in the browser URL while they are inside that sub-account:
     `app.gohighlevel.com/v2/location/`**`<THIS>`**`/dashboard`

   A PIT is bound to **one** sub-account. Several clients means several tokens; there is no
   single token that reaches them all. An agency PIT will not work as a substitute — agency
   scopes cover locations, users, snapshots and SaaS, with no contacts, conversations,
   opportunities or calendars scope to grant.

3. **Add it.** Put the token in a shell variable so it is never echoed into the transcript:
   ```bash
   npx -y @uxieee/ghl-mcp accounts add --token "$GHL_PIT" --location "$LOCATION_ID" --json
   ```

4. **Report GHL's verdict, not your own.** On success the response carries the sub-account's
   real `name`, returned by GHL. Read it back to the user — it is the proof the pairing is
   real rather than something either of you typed:

   | response | what it means | what to do |
   |---|---|---|
   | `ok: true` + `name` | the token reaches that location | confirm the name is the client they meant |
   | `the token is not valid (401)` | revoked or mistyped token | ask for a fresh one |
   | `no access to that location (403)` | the id and token are from **different** sub-accounts | one of the two values is from the wrong client; ask which |
   | `not a Private Integration Token` | value does not start with `pit-` | they likely pasted something else |

   **Nothing is written unless it verifies**, so a failure leaves the file untouched. Never
   hand-edit `accounts.json` to work around a failure: the verification is the whole point.

5. **Point a folder at it** with `/uxie-ghl-factory:scope`, or say that is the next step.

## Never

- Never print, echo or log a token — not in a command you show the user, not in a summary.
- Never write a location id you were not given. If you are unsure which client an id belongs
  to, run `doctor --json` and read the names back; do not infer from a folder name.
