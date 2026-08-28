# What each failure means, and what to ask for

Every error below is what **GoHighLevel** said, surfaced verbatim by the CLI. Treat them as
evidence, not as something to work around.

## `execute_action` refusals

| Response | What actually happened | Ask for |
|---|---|---|
| `No token configured for location "<id>"` | the accounts file has no PIT for that sub-account; the server never substitutes another account's token | run `/uxie-ghl-factory:public-add-account` with a PIT for that location (and `/uxie-ghl-factory:public-scope` if the folder is scoped), then restart the MCP client — the file is read at startup |

## `accounts add` refusals

| Response | What actually happened | Ask for |
|---|---|---|
| `not a Private Integration Token` | the value does not start with `pit-` | they likely pasted an API key, a JWT, or the location id into the wrong field |
| `the token is not valid (401)` | GHL does not recognise the token | a fresh PIT — this one was revoked or is mistyped. Revocation is common when a client reclaims their sub-account |
| `no access to that location (403)` | see below — **two** causes | check the id first, then the scopes |
| `could not reach GHL` | network, not credentials | retry; do not treat as a bad token |

**Nothing is written on any of these.** A failed add leaves the accounts file untouched, so
there is no half-state to clean up.

### The 403 is ambiguous — say so

GHL returns `403` both when the token belongs to a **different sub-account** and when it
belongs to the right one but the PIT lacks the `locations.readonly` scope. The CLI cannot tell
these apart, so neither can you. Ask the person to check both:

1. Is the location id from the same sub-account they created the token in?
2. Does that Private Integration have the locations read scope ticked?

Do not report "wrong sub-account" as settled fact on a 403 alone.

## Server won't start

| stderr | Cause | Fix |
|---|---|---|
| `allowed locations not present in the accounts file: <id>` | the folder is scoped to an id that is not configured | re-run `scope` with the client's **name**; do not edit the JSON |
| `the allowed-locations filter excluded every configured account` | the scope matches nothing | same |
| `accounts file must contain a non-empty "accounts" array` | file was hand-edited or truncated | rebuild with `accounts add`; the CLI writes a valid shape |
| `accounts contains <id> twice` | duplicate entry | `accounts remove <id>` then add once |

A refusal to start is **working as designed**. Half-scoped is worse than not running: it looks
functional while pointing somewhere unintended.

## "The tools aren't there"

Work down this list rather than re-running setup:

1. `doctor --json` — is anything configured at all?
2. `scope --list --json` in that folder — `configured: false` means no server there.
3. Did the client reload? A newly written `.mcp.json` needs Claude Code to pick it up, and the
   first registration in a folder shows a one-time workspace-trust prompt.
4. `list_locations` on the running server — the only claim that counts.

## A tool returns data for the wrong client

Stop and re-scope. This is the failure the whole design exists to prevent, so treat it as
serious rather than adjusting the call:

```bash
npx -y @uxieee/ghl-mcp scope --list --json     # what does this folder actually see?
```

If a folder sees more than it should, it was scoped with `--all` or with an extra name. If it
sees the wrong client entirely, someone wrote an id by hand. Re-run `scope` with names.

## Token died mid-session

`doctor --json` marks it `ok: false` with GHL's reason. PITs do not expire on a timer — a
`401` means it was revoked in the GHL UI, so a new one has to be created. That is different
from the **internal** rail, whose JWT expires roughly hourly and is re-captured by
`/uxie-ghl-factory:internal-connect`. Do not confuse the two: a PIT that stops working is a deliberate
act by someone, and worth mentioning to the user rather than silently replacing.
