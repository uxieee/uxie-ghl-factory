---
name: ghl-public-mcp-setup
description: Set up, scope, or repair the public GoHighLevel MCP server (`@uxieee/ghl-mcp`) — install it in a folder, add sub-accounts with a Private Integration Token, point a folder at one client, or diagnose why a GHL tool can't see an account. Use when the user says "set up GHL here", "add a sub-account", "add a PIT", "connect this client", "why can't I see <client>", "no GHL tools in this folder", or when a GHL call fails with 401/403 or an unknown-location error. Covers both Claude Code and Codex. Public API only (ToS-clean) — the internal rail is /uxie-ghl-factory:connect instead.
---

# Setting up the public GHL rail

The public rail is an npm package that runs **on the user's own machine** over stdio. Their
token is read from a local file and sent only to GoHighLevel — it never reaches a third party.

**You cannot fetch the credentials.** Both values live behind a GoHighLevel browser login. So
the work is split, and staying on your side of it is the whole discipline here:

| You | The person |
|---|---|
| work out what is missing | opens GHL in a browser |
| say exactly where to click | copies the token and the location id |
| run the command and verify | pastes them back |
| report what **GHL** said | decides which client a folder belongs to |

Never invent a location id, never hand-edit the accounts file, and never report success on
anything you have not seen GHL confirm.

## Always start here

```bash
npx -y @uxieee/ghl-mcp doctor --json
```

It returns the current state and an ordered `nextSteps` array. Follow it rather than guessing
what is wrong — it re-verifies every configured token against GHL, so it distinguishes "not
set up" from "set up but the token died" from "scoped to an account that isn't configured".

| `mode` | meaning | do next |
|---|---|---|
| `unconfigured` | nothing set up | ask for a PIT + location id, then `accounts add` |
| `single` | one token via `GHL_API_TOKEN` | fine for one sub-account; move to a file for more |
| `multi` | accounts file in use | check `accounts[].ok` — a `false` means that token died |

If `ok` is already `true` and the account they want is listed, **say so and stop**. Re-adding
is harmless but the user should know it was already working.

## Add a sub-account

Ask for the two values, naming exactly where each lives:

- **Private Integration Token** — in that sub-account: *Settings → Private Integrations →
  Create*. Read scopes for what they want to read, write scopes only for what they intend to
  write. The token can do nothing they do not grant.
- **Location id** — the long id in the browser URL while they are inside that sub-account:
  `app.gohighlevel.com/v2/location/`**`<THIS>`**`/dashboard`

Then, with the token in a shell variable so it never lands in the transcript:

```bash
npx -y @uxieee/ghl-mcp accounts add --token "$GHL_PIT" --location "$LOCATION_ID" --json
```

**Read GHL's verdict back, not your own.** A success returns the sub-account's real `name`
from the API — that is what proves the pairing, rather than either of you having typed it.
Confirm the name is the client they meant; a valid pairing for the *wrong* client still
returns `ok: true`.

See `references/failure-modes.md` for what each error means and what to ask for next.

## Point a folder at one client

```bash
npx -y @uxieee/ghl-mcp scope "<Client Name>" --json
```

**Always by name, never by id.** A mistyped id fails loudly — the server refuses to start on
an id absent from the accounts file. But a *different real* id fails silently forever, because
both ids are valid and the folder simply operates on another client. Naming removes the chance
instead of catching it afterwards.

- An ambiguous name is refused with the candidates listed. **Ask which one** — do not pick.
- It **merges** into an existing `.mcp.json`; `preserved` names the other servers it left.
- `--all` in the user's own agency folder omits the allowlist entirely, so accounts added
  later are picked up without re-scoping.
- `--list` reports what a folder currently sees. `configured: false` means there is no server
  in that folder at all.

Scoping is per **folder**, and a project `.mcp.json` is inherited by subfolders — so a client
folder with several project subfolders is scoped once, at the client level.

## Verify from the server, not the file

After the config is written, call `list_locations` on the `ghl` server and confirm it returns
the expected sub-accounts **and no others**. A config that looks right and a server that is
scoped right are different claims, and only the second one matters. In Claude Code the folder's
config is picked up on reload; if the tools are not there yet, say so rather than assuming.

## Codex

Codex loads skills but **not** slash commands, and `~/.codex/config.toml` is global — there is
no per-project config. Give each client its own named server:

```toml
[mcp_servers.ghl_acme]
command = "npx"
args = ["-y", "@uxieee/ghl-mcp"]
env = { GHL_ACCOUNTS_FILE = "/Users/you/.ghl/accounts.json", GHL_ALLOWED_LOCATIONS = "<id>" }
```

Codex infers the transport from `command`, and forwards only a fixed set of parent environment
variables to a stdio child — so `GHL_ACCOUNTS_FILE` must be named in `env`, not exported in
the shell.

## Never

- Never print, echo or log a token — not in a command you show, not in a summary.
- Never write a location id you were not given. Unsure which client an id belongs to? Run
  `doctor --json` and read the names back; do not infer from the folder name.
- Never edit `accounts.json` by hand to get past a failed verification. The verification is
  the point: it is what stops a wrong id becoming a silent write to another client.
- Never use this rail's credentials for the internal API. That is `/uxie-ghl-factory:connect`,
  a different token with a different lifetime — see `ghl-orientation`.
