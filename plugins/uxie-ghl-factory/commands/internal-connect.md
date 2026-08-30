---
description: Connect, bind and audit the uxie-ghl-internal-mcp server FOR THE CURRENT PROJECT — three modes over one registration. `connect` registers a project-scoped server (its own account token per folder), the agent opens Playwright, you log into GHL, the agent captures the token, then discovers the agency's sub-accounts and proposes which this folder may touch. `bind` re-checks and fixes that binding on a folder already registered. `audit` sweeps every registration read-only. Also the re-authorize path on TOKEN_EXPIRED.
---

# /uxie-ghl-factory:internal-connect

Sets up the internal MCP server **for the current project only** — it is NOT global. Run it in
each GHL client folder you work in; each folder gets its own server registration, its own
account token, and its own **location binding**, so different projects = different accounts (no
cross-contamination). **You never handle the token.** The agent drives the browser; you only log in.

**Why one command owns all three modes.** The credential and the binding are the *same object* —
one server entry in `~/.claude.json`:

```
"uxie-ghl-internal-mcp": { "env": {
    "GHL_INTERNAL_TOK_FILE":  "…",   ← which login
    "GHL_INTERNAL_LOCATIONS": "…"    ← which accounts that login may act on
}}
```

`claude mcp add` **rewrites that whole entry**, so anything not on its command line is dropped. A
separate binding skill would be silently wiped the next time someone re-authorized. Hence: one
owner. A connection without a binding is half-connected.

**The model:** `folder → one login → one agency → a subset of that agency's sub-accounts.`
A folder **cannot span two agencies** — the credential is one login and enumerates only its own
agency. Needing two agencies in one place means two folders.

## Pick a mode

| Mode | When | Does |
|---|---|---|
| `connect` | the folder has **no** registration (default) | launchers → capture → register → discover → propose bindings → verify |
| `bind` | the folder **is** registered (default) | discover → diff bound vs available → propose → write |
| `audit` | **only when explicitly asked** | read-only sweep of every registration; changes nothing |

Decide by looking, not by guessing. Run this first — it is also rule 2 in executable form:

```bash
node --input-type=module <<'NODE'
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
const R = process.env.CLAUDE_PLUGIN_ROOT + '/mcp-internal/scripts';
const { readConfig, findRegistration } = await import(R + '/registrations.mjs');

const CFG = join(homedir(), '.claude.json');
const folder = process.cwd();
const cfg = readConfig(CFG);
const srv = findRegistration(cfg, folder, 'uxie-ghl-internal-mcp');        // EXACT key. Never a suffix.
const audit = findRegistration(cfg, folder, 'uxie-ghl-internal-mcp-audit');
const keys = Object.keys(cfg.projects ?? {});
console.log(JSON.stringify({
  folder,
  projectKeyPresent: keys.includes(folder),
  registered: Boolean(srv),
  auditProfileRegistered: Boolean(audit),
  boundTo: srv?.env?.GHL_INTERNAL_LOCATIONS ?? null,
  tokenFileSet: Boolean(srv?.env?.GHL_INTERNAL_TOK_FILE),
  // PRESENCE — what rule 6 says to leave alone. Present is not the same as refused.
  legacyNamesPresent: Object.keys(srv?.env ?? {}).filter((k) => k === 'GHL_TOK_FILE' || k === 'GHL_LOCATIONS'),
  // REFUSAL — the guard's actual condition is old name set AND new name absent (`stdio.mjs`,
  // mirrored by `listRegistrations`). BOTH names present is healthy, and is exactly the end state
  // rule 6 tells you to create — so never diagnose from presence alone.
  legacyTokenFileEnv: Boolean(srv?.env?.GHL_TOK_FILE) && !srv?.env?.GHL_INTERNAL_TOK_FILE,
  legacyLocationsEnv: Boolean(srv?.env?.GHL_LOCATIONS) && !srv?.env?.GHL_INTERNAL_LOCATIONS,
  // REPORT ONLY. Same-basename keys at other paths are the stale shadows — never a fallback.
  sameNameElsewhere: keys.filter((k) => k !== folder && basename(k) === basename(folder))
    .map((k) => ({ key: k, hasMcpServers: Boolean(cfg.projects[k]?.mcpServers) })),
  mode: srv ? 'bind' : 'connect',
}, null, 2));
NODE
```

If `registered` is false but `sameNameElsewhere` shows a key with `hasMcpServers: true`, **say so
and stop.** That is a path mismatch (a moved folder, a symlink, a `/Users/<user>/Documents/…`
leftover), not an unregistered folder, and `connect` would create a second registration beside the
first. Ask which path is real. Do **not** match on the suffix — see rule 2.

If `registered` is false but `auditProfileRegistered` is true, **say so and ask before doing
anything.** `mode` is derived from the full server alone, so an audit-only folder selects
`connect` — whose step 4 would then `claude mcp add` the full, write-capable server into a folder
somebody deliberately made read-only, and a folder offering both offers the write tools. Only the
user can say whether this folder is meant to gain them.

## The rules every mode obeys

Each rule carries its reason. The reason is not decoration: a rule without one gets optimized away
by the next agent who thinks it looks redundant. All seven were paid for by hand.

1. **Never `claude mcp add` on an existing registration.** It rewrites the entry, so any env var
   not on that command line is dropped — which is exactly how a credential refresh erases a
   location binding without a word. Edit additively with `setEnv`, and back the file up first.
   `claude mcp add` is for the FIRST registration of a folder and nothing else.
2. **Match the project key by exact full path, never by suffix.** `~/.claude.json` still holds
   entries under this machine's old `/Users/<user>/Documents/…` paths beside the live ones. The
   stale twins carry **no `mcpServers`** and they **sort first**, so `keys.find(k =>
   k.endsWith(suffix))` returns the server-less one and reports "not registered" for a folder that
   plainly is. That silently skipped **5 of 11** registrations on the first manual pass.
3. **Discovery runs under the folder's own credential.** An internal JWT enumerates only its own
   agency's sub-accounts; there is no central view. Measured 2026-08-30: one login's
   `/locations/search` returned its 18 rows and could not see a single sub-account belonging to any
   other agency. And never cross-check against the **public** rail's account list — that is a
   DIFFERENT set (different tokens, different provisioning), so agreement proves nothing and
   disagreement means nothing.
4. **Propose, never apply.** Show the diff — ids *and* names, what is being added and removed —
   and get an explicit confirmation before writing. A binding typed blind permits exactly the write
   the guard exists to refuse. Two of the manual pass's proposals were corrected by the user before
   they were applied.
5. **Never open with a forced login (Design B).** Use whatever credential is already live, state
   plainly what could not be checked and why, and offer a capture only when the user asks for
   something that genuinely needs one. GHL JWTs last ~1 hour and 6 of 7 folders were expired when
   this was designed; a health check you avoid running because it demands a login is not a health
   check. (When credential renewal is automated, the "could not check" cases simply stop occurring
   and nothing here changes.)
6. **Write only the new env names** — `GHL_INTERNAL_TOK_FILE`, `GHL_INTERNAL_LOCATIONS`. Where a
   registration still carries a legacy name (`GHL_TOK_FILE`, `GHL_LOCATIONS`), **leave it in
   place.** 0.43.0's migration guards require the NEW name to be present, not the old one to be
   absent, and deleting the old one would break any machine still running an older build off the
   same config.
7. **Never delete a registration, an env var, or a backup — and back up `~/.claude.json` before
   every write.** Scoped deliberately: this command mandates two deletions of its own (the
   intermediate header file holding a live JWT, in `connect` step 2, and a stale discovery `OUT`),
   and an agent that reads an unscoped "never delete anything" over those specific instructions
   leaves a live credential lying in a project folder. Config state is what is protected. Copy it to
   `backupPath(configPath)` first, and refuse to proceed if that backup path already exists rather
   than overwriting it — the name is second-granular, so two writes in the same second otherwise
   leave one un-backed-up.

## Credential rule (non-negotiable)

NEVER print, echo, log, or paste any string matching `ey[A-Za-z0-9._-]{20,}` (a JWT). The
token goes **from the browser to the file only**. Confirm success by decoding **claims**
(issuer / role / exp / seconds-remaining) — never the token. Redact by JWT shape if a value
would ever reach the transcript.

Discovery output is the other side of this: it carries **real client sub-account names and ids**.
Those belong in the conversation with the user and in `~/.claude.json` — never in a file committed
to this repo, a report, or a commit message.

## Per-project layout

- **Token (per project):** `<project>/.ghl/uxie-ghl-internal-mcp-tok.txt` (mode `0600`). The
  `.ghl/` dir holds per-client PII and MUST be gitignored — ensure `.ghl/` is in the project's
  `.gitignore`.
- **Agency (per project):** `<project>/.ghl/agency.json` — `{"companyId": "<id>", "capturedAt":
  "<iso8601>", "source": "browser request during connect"}`. Non-secret metadata beside the token.
  `companyId` is **not** a JWT claim, so it cannot be recovered from the credential; it is captured
  from the browser at `connect` time and read from this file thereafter. `bind` and `audit` say so
  and stop rather than guessing when it is absent.
- **Launcher (stable, shared):** `~/.uxie-ghl-internal-mcp/launch.mjs` — a copy of the plugin's
  `mcp-internal/launch.mjs`, so the project config points at a path that survives plugin
  updates (it resolves the newest installed plugin build at run time).
- **Audit launcher (stable, shared):** `~/.uxie-ghl-internal-mcp/launch-audit.mjs` — the same
  arrangement for the READ-ONLY audit profile (7 tools, every capability a GET). Two separate
  files rather than a flag on one: a flag has to default to something, and a full-by-default
  launcher hands an operator who mistyped it every write tool in the registry while they
  believe they are read-only. The audit launcher REFUSES to start if no installed build ships
  `dist/audit-server.mjs`; it never downgrades to the full server.
- **Registration:** project-scoped via `claude mcp add --scope local`, keyed to this folder.

---

## Mode: `connect`

1. **Copy the launchers to their stable home** (idempotent — refreshes them each run):
   ```bash
   mkdir -p "$HOME/.uxie-ghl-internal-mcp"
   cp "${CLAUDE_PLUGIN_ROOT}/mcp-internal/launch.mjs" "$HOME/.uxie-ghl-internal-mcp/launch.mjs"
   cp "${CLAUDE_PLUGIN_ROOT}/mcp-internal/launch-audit.mjs" "$HOME/.uxie-ghl-internal-mcp/launch-audit.mjs"
   ```
   Copy BOTH. A stable home holding only the full launcher is how the audit profile ends up
   unreachable — the failure this step exists to prevent.

2. **Capture the token to the project-local file** (leak-safe). Open the Playwright browser
   (SEPARATE Chrome profile — the user's normal GHL login does NOT carry over) to the **AI
   Agents** surface so one capture yields both credentials:
   `https://app.gohighlevel.com/v2/location/<LOCATION_ID>/ai-agents/getting-started`
   (**either referer works** — `app.gohighlevel.com` or the workflow iframe; settled live
   2026-08-29, and the capture script accepts both). Tag `document.title` so the
   user can find the window. Ask the user to log in; wait. Then capture a
   `services.leadconnectorhq.com` request's headers via `browser_network_request`
   `part:"request-headers"`+`filename` → parse `Authorization: Bearer …` and `token-id: …` from
   the FILE → write `<project>/.ghl/uxie-ghl-internal-mcp-tok.txt` (create `.ghl/` `0700`, file
   `0600`) → delete the intermediate. Confirm by claims only. Ensure `.ghl/` is gitignored.
   Format:
   ```
   Bearer <jwt>
   token-id: <firebase-token>
   ```
   (Live-proven: one AI-surface capture authenticates workflow + AI + memberships — no separate
   token needed.)

   **When you need only a credential, prefer `mcp-internal/scripts/capture-token.mjs`** — it owns
   the whole capture out of band, so no JWT ever passes through the model's context at all, it
   honours `GHL_INTERNAL_TOK_FILE` so it writes project-locally, and it emits this exact two-line
   format (`formatTokenFile`, pinned by `test/token-file-format.test.mjs` and
   `test/capture-referer.test.mjs`). That is the right path for a re-authorize, or for `bind` on a
   folder whose `agency.json` already exists. `connect` uses the browser flow above because
   **step 3 rides the same session** to read the agency `companyId`, which the script neither
   captures nor leaves a browser open for; the header → file → parse discipline is what holds the
   credential rule in the meantime.

3. **Capture the agency `companyId` in the same browser session.** While the network log is still
   there, list the app's own requests and read the `companyId=<id>` query parameter off them (the
   agency-scoped calls carry it). Confirm the SAME value appears on at least two distinct requests
   before trusting it — one request could be someone else's agency in a shared session. Then write
   `<project>/.ghl/agency.json` as described in **Per-project layout**. If no request carries one,
   say so and stop before discovery rather than inventing a value.
   (`auth_status` reports `jwtClaims.companyId`, but it is null on every login measured — treat a
   non-null value as a cross-check at most, never as the source. If it disagrees with the browser,
   stop and ask.)

4. **Register the server for THIS project** — this is the one place `claude mcp add` is correct,
   because there is no entry to clobber (skip if already registered — `claude mcp list`):
   ```bash
   claude mcp add --transport stdio --scope local \
     -e GHL_INTERNAL_TOK_FILE="$(pwd)/.ghl/uxie-ghl-internal-mcp-tok.txt" \
     uxie-ghl-internal-mcp \
     -- node "$HOME/.uxie-ghl-internal-mcp/launch.mjs"
   ```
   `--scope local` keeps it private + project-specific (in `~/.claude.json` under this folder).
   The first time Claude Code connects a project server it may show a **workspace-trust dialog**
   — the user accepts it once per folder. Register it **unbound**: a registration that omits
   `GHL_INTERNAL_LOCATIONS` keeps every read available and refuses every write with
   `LOCATION_UNBOUND`, which is the correct state until step 6 has been confirmed. Reads are what
   discovery needs, so nothing is blocked by waiting.

   **For a read-only audit project**, register the audit profile INSTEAD (a different server
   name, so the two never collide in one folder):
   ```bash
   claude mcp add --transport stdio --scope local \
     -e GHL_INTERNAL_TOK_FILE="$(pwd)/.ghl/uxie-ghl-internal-mcp-tok.txt" \
     uxie-ghl-internal-mcp-audit \
     -- node "$HOME/.uxie-ghl-internal-mcp/launch-audit.mjs"
   ```
   Registering both in one folder defeats the point: read-only-ness is a property of which
   server the caller reaches, and a folder offering both offers the write tools too. The audit
   profile is structurally read-only and **never takes a binding** — skip step 5 for it entirely,
   and in step 6 expect `allowedLocations: null`, which is correct rather than a gap.

5. **Discover and propose.** Run **Shared: discovery**, then **Shared: reconcile** with `BOUND`
   empty, then **Shared: propose and write**. Every account in the agency lands in `missing`; the
   proposal is the subset this folder should serve, which is a decision for the user, not a
   default. Bind the fewest accounts that let the folder do its job.

6. **Verify.** The server must connect; call `auth_status` (claims only) and confirm
   `allowedLocations` equals the number of ids you wrote, then call one real read tool —
   **`list_workflows_complete`**, against an account this registration reaches — and confirm `ok`.
   Use that name on BOTH profiles: the audit profile ships seven tools and `list_workflows` is not
   one of them, so naming it here would hand a correctly-set-up audit folder an unknown-tool error
   on its last step, which reads exactly like a broken registration. A brand-new registration may
   need the user to reload/approve before the tools appear.

---

## Mode: `bind`

The folder is already registered. Nothing here re-captures a credential unless the user asks
(rule 5).

1. **Read the registration** with the mode-selection snippet above. Note `boundTo`,
   `tokenFileSet`, and `legacyTokenFileEnv` / `legacyLocationsEnv` — the refusal flags, not
   `legacyNamesPresent`.
2. **Read `<folder>/.ghl/agency.json`** for `companyId`. If it is missing, this folder was
   connected before agency capture existed: say exactly that, and offer a capture (which is what
   step 3 of `connect` does) — do not guess a `companyId`, and do not fall back to another
   folder's.
3. **Discover** — **Shared: discovery** below, under THIS folder's token file.
4. **Reconcile and show** — **Shared: reconcile** below. Present all three groups:
   - `missing` — accounts the agency has that this folder cannot touch. Usually the real finding.
   - `unknown` — ids bound here that the agency does not have. A typo'd binding refuses forever
     and nothing tells you why, so these matter even though they permit nothing.
   - `matched` — bound and real. Show it too; a proposal you cannot see the whole of is not a diff.
5. **Propose and write** — **Shared: propose and write** below.

If `legacyTokenFileEnv` is true — `GHL_TOK_FILE` set and `GHL_INTERNAL_TOK_FILE` **not** set, so
`tokenFileSet` is false — the registration is refused with `LEGACY_TOKEN_FILE_ENV`, and adding
`GHL_INTERNAL_LOCATIONS` alone does not lift it. Patch **both** names in one write: add
`GHL_INTERNAL_TOK_FILE: '<the same path GHL_TOK_FILE holds>'` to the `setEnv` patch object, and
leave `GHL_TOK_FILE` itself in place (rule 6).

**`GHL_TOK_FILE` merely being present is not a fault.** The guard's condition is old-name-set AND
new-name-absent; both names present is healthy and is precisely the end state rule 6 tells you to
create. Diagnosing from `legacyNamesPresent` would report a compliant registration as refused and
prescribe a write `setEnv` then reports as a no-op. Same on the locations side: writing
`GHL_INTERNAL_LOCATIONS` clears `legacyLocationsEnv` by itself; `GHL_LOCATIONS` stays.

---

## Mode: `audit`

Read-only. It writes nothing, and it is the only mode that looks at folders other than this one.
Two tiers, and the distinction is the whole point.

### Tier 1 — offline (config + token claims; no network, always available)

```bash
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const R = process.env.CLAUDE_PLUGIN_ROOT + '/mcp-internal/scripts';
const { readConfig, listRegistrations } = await import(R + '/registrations.mjs');
const { auditOffline, formatAudit } = await import(R + '/audit-report.mjs');

const CFG = join(homedir(), '.claude.json');
const rows = listRegistrations(readConfig(CFG));

// CLAIMS ONLY — the JWT itself is never printed, returned, or kept.
const tokenClaims = new Map();
for (const r of rows) {
  if (!r.tokenFile || tokenClaims.has(r.tokenFile)) continue;
  try {
    const jwt = (readFileSync(r.tokenFile, 'utf8').match(/Bearer\s+(ey[A-Za-z0-9._-]+)/i) || [])[1];
    if (!jwt) throw new Error('no Bearer line in the token file');
    const { exp } = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    tokenClaims.set(r.tokenFile, { secondsRemaining: exp - Math.floor(Date.now() / 1000) });
  } catch (e) {
    tokenClaims.set(r.tokenFile, { error: e.message });
  }
}

const result = auditOffline({ rows, tokenClaims });
console.log(formatAudit(result));
// SELF-OVERLAP, not a collision: the same folder named twice in one row means that ONE binding
// lists the same id twice. auditOffline does not dedupe within a folder, so it surfaces here.
for (const o of result.overlaps) {
  if (new Set(o.folders).size === 1) {
    console.log(`  NOTE ${o.id} is listed twice in ${o.folders[0]}'s own binding — a duplicate-id typo, not a cross-folder collision.`);
  }
}

// TIER 2 INPUTS. formatAudit prints boundCount and NO ids, so it cannot feed the reconcile step;
// the ids are on result.folders[].ids. Printed here, deduped, with the exempt and un-runnable rows
// marked so the sweep in tier 2 does not have to re-derive any of it.
console.log('\n  TIER 2 INPUTS:');
for (const f of result.folders) {
  if (f.server.endsWith('-audit')) { console.log(`    ${f.folder}\n        EXEMPT — ${f.server} never takes a binding; do not run discovery for it.`); continue; }
  const blocked = f.flags.find((x) => x.startsWith('credential-') || x === 'no-token-file-configured');
  console.log(`    ${f.folder}\n        bound=[${[...new Set(f.ids)].join(',')}]  ${blocked ? `SKIP — ${blocked}` : 'eligible (needs .ghl/agency.json)'}`);
}
NODE
```

Reading the output:

- **`unbound` on a `uxie-ghl-internal-mcp-audit` row is correct, not a defect.** `listRegistrations`
  enumerates the audit profile because its name shares the prefix, but that profile is structurally
  read-only and never takes a binding. Label it exempt in the report and propose nothing for it.
- **A repeated identical folder name in an overlap row is a typo in that one binding**, per the NOTE
  the snippet prints — not two folders reaching the same account. Fix it by deduping that binding.
- **`boundCount` counts entries, not distinct ids**, so a duplicated id inflates it. Compare it
  against the distinct count when the NOTE above fires.
- **A genuine overlap — two different folders bound to the same account — is a finding, not
  necessarily a fault.** Report it and let the user decide; the guard's job is that each folder
  declares what it touches, not that accounts are exclusive.
- `credential-expired` / `credential-unreadable` mean tier 2 cannot run for that folder. Say so
  per folder. Never let a folder read as clean because its credential was too dead to check.

### Tier 2 — online (per folder, only where a credential happens to be live)

`formatAudit` ends by naming exactly what it did not check; tier 2 is that gap, and it is this
command's job because it needs a live credential **per agency** (rule 3). Work from the
**TIER 2 INPUTS** block the tier-1 snippet prints — it already carries the bound ids and marks the
rows that cannot or must not be checked.

- Skip every row marked **EXEMPT**. A `uxie-ghl-internal-mcp-audit` row never takes a binding, so
  running discovery for it would report the agency's whole roster as `missing` against a
  registration that is correct by design.
- Skip every row marked **SKIP** — its credential cannot be read, so tier 2 cannot run for it.

For each remaining row where `<folder>/.ghl/agency.json` exists:

1. Run **Shared: discovery** with that folder's `tokenFile` and `companyId`.
2. Run **Shared: reconcile** with `BOUND` set to that row's `bound=[…]` list. Do NOT try to read
   the ids out of the `formatAudit` text — it prints `boundCount` and no ids at all.
3. Report its `missing` and `unknown`. Do not propose writes — `audit` changes nothing. Point the
   user at `bind`, run from that folder, for anything worth fixing.

For every folder you skipped, name it and say why: exempt, expired credential, no `agency.json`,
discovery failed. A silent skip reads as a pass.

---

## Shared: discovery

`GET /locations/search?companyId=<id>&limit=200&skip=0` on the backend rail, under the credential
of the folder being checked. One call per folder, paced.

```bash
TOK_FILE=<folder>/.ghl/uxie-ghl-internal-mcp-tok.txt \
COMPANY_ID=<from that folder's .ghl/agency.json> \
OUT=/tmp/ghl-discovery.json \
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
const R = process.env.CLAUDE_PLUGIN_ROOT + '/mcp-internal/scripts';
const { discoveryRequest } = await import(R + '/agency-binding.mjs');

// Clear OUT FIRST. Every exit below leaves no file, so a leftover roster from the folder you
// checked a minute ago can never be reconciled as this folder's agency.
rmSync(process.env.OUT, { force: true });

const raw = readFileSync(process.env.TOK_FILE, 'utf8');
const jwt = (raw.match(/Bearer\s+(ey[A-Za-z0-9._-]+)/i) || [])[1];
if (!jwt) throw new Error('no Bearer line in the token file');   // never print the file or the token
const { exp } = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const ttl = exp - Math.floor(Date.now() / 1000);
if (ttl <= 0) { console.log(`SKIPPED — credential expired ${-ttl}s ago; offline tier only for this folder.`); process.exit(2); }

const { method, path } = discoveryRequest(process.env.COMPANY_ID);
await new Promise((r) => setTimeout(r, 400));                    // the pacing the gateway uses
const res = await fetch('https://backend.leadconnectorhq.com' + path, {
  method,
  headers: {
    authorization: `Bearer ${jwt}`,
    channel: 'APP', source: 'WEB_USER', version: '2021-07-28',
    accept: 'application/json, text/plain, */*',
  },
});
const json = await res.json().catch(() => null);
if (!res.ok) {
  console.log(`DISCOVERY FAILED status=${res.status} — see the note below before retrying.`);
  process.exit(1);
}
writeFileSync(process.env.OUT, JSON.stringify({ data: { status: res.status, json } }));
console.log(`discovery ok (credential ttl ${ttl}s) -> ${process.env.OUT}`);
NODE
```

- The three `channel` / `source` / `version` headers are **not optional** off the `/workflow/*`
  prefix; without them this returns `401` with the body `version header was not found`, which
  reads like an auth failure and is not one.
- **A `401` here can be a credential-CLASS result, not an expiry.** This path was live-probed
  2026-08-25 and refused a location-user Bearer, while an agency-level login enumerated its
  18 sub-accounts on 2026-08-30. So do NOT re-capture in response to a 401 on a credential the
  offline tier just showed as live — report that this login cannot enumerate its agency and fall
  back to the offline tier for that folder. One re-capture at most, ever.
- Give each folder its own `OUT` path during an `audit` sweep. The snippet clears `OUT` before it
  starts, so a failed discovery leaves nothing behind — but two folders sharing one path is still
  one typo away from reconciling agency A's roster against agency B's binding.
- Inside the folder that owns the registration you may cross-check with the `raw_request` tool
  (`method:"GET"`, `path` from `discoveryRequest`, `locationId` set to an id this registration is
  already bound to — a bound registration refuses any other with `LOCATION_FORBIDDEN`). Its result
  envelope is `{ ok, data: { status, json } }`, the same shape `parseLocations` reads. This is not
  available for other folders, which is why the direct GET above is the primary procedure.

## Shared: reconcile

```bash
RESPONSE_FILE=/tmp/ghl-discovery.json \
BOUND="<the folder's current GHL_INTERNAL_LOCATIONS, or empty>" \
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const R = process.env.CLAUDE_PLUGIN_ROOT + '/mcp-internal/scripts';
const { parseLocations, reconcile } = await import(R + '/agency-binding.mjs');

const RESPONSE = JSON.parse(readFileSync(process.env.RESPONSE_FILE, 'utf8'));
const BOUND = (process.env.BOUND ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const { total, locations } = parseLocations(RESPONSE);

// GATE 1 — discovery did not RUN. reconcile() returns three EMPTY arrays when `available` is
// empty, which reads exactly like "nothing to change". It is not: it is "nothing was read".
if (locations.length === 0) {
  console.log('DISCOVERY RETURNED NO ROWS — do not reconcile, do not propose. Report which it was:');
  console.log(`  total reported: ${total === null ? 'absent (malformed or error response)' : total}`);
  process.exit(1);
}
// GATE 2 — TRUNCATED ROSTER. discoveryRequest() pins limit=200&skip=0 and does not paginate, so an
// agency with more than 200 sub-accounts returns a short list beside the true, larger total. The
// module does not surface that; the caller must. Reconciling a partial roster reports real
// accounts as `unknown` and a binding built on it would be wrong.
if (total !== null && total > locations.length) {
  console.log(`TRUNCATED ROSTER: ${locations.length} of ${total} rows. REFUSE to propose a binding.`);
  process.exit(1);
}
if (total === null) console.log('WARNING: no total in the response; roster completeness is unverified.');

const r = reconcile({ bound: BOUND, available: locations });
const name = (id) => locations.find((l) => l.id === id)?.name ?? '(not in this agency)';
console.log(`agency roster: ${locations.length} account(s); this folder binds ${new Set(BOUND).size} distinct id(s)`);
console.log(`\nmatched  (${r.matched.length}) — bound and real:`);
for (const id of r.matched) console.log(`    ${id}  ${name(id)}`);
console.log(`\nmissing  (${r.missing.length}) — in the agency, NOT bound here:`);
for (const id of r.missing) console.log(`    ${id}  ${name(id)}`);
console.log(`\nunknown  (${r.unknown.length}) — bound here, NOT in this agency:`);
for (const id of r.unknown) console.log(`    ${id}`);
NODE
```

Both gates are refusals, not warnings. **Three empty arrays never mean "clean"** — they mean
`available` was empty, so distinguish "discovery returned zero rows" from "discovery did not run"
and report which. Membership is decided by **exact match** against the discovered ids, never by id
shape: every GHL object id is a 20–24 character alphanumeric string, so ids are indistinguishable
by appearance.

## Shared: propose and write

**Propose first (rule 4).** Show the user the current list, the proposed list, and every id added
or removed with its account name. Wait for an explicit yes. Then, and only then:

```bash
FOLDER=<exact project key> \
SERVER=uxie-ghl-internal-mcp \
IDS="<the confirmed comma-separated list>" \
node --input-type=module <<'NODE'
import { copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const R = process.env.CLAUDE_PLUGIN_ROOT + '/mcp-internal/scripts';
const { readConfig, setEnv, backupPath } = await import(R + '/registrations.mjs');

const CFG = join(homedir(), '.claude.json');
const ids = process.env.IDS.split(',').map((s) => s.trim()).filter(Boolean);
if (new Set(ids).size !== ids.length) throw new Error('the proposed list repeats an id');

// RULE 7 — back up before every write, and never overwrite an existing backup.
const bak = backupPath(CFG);
if (existsSync(bak)) throw new Error(`a backup already exists at ${bak} — wait a second and retry`);
copyFileSync(CFG, bak);

const cfg = readConfig(CFG);
// setEnv is ADDITIVE and mutates cfg in place: it touches only the keys in the patch and leaves
// every sibling env var alone. This is the whole reason `claude mcp add` is banned here (rule 1).
const { changed } = setEnv(cfg, process.env.FOLDER, process.env.SERVER, { GHL_INTERNAL_LOCATIONS: ids.join(',') });
writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');

// Read back from disk — a write that did not land must not be reported as one.
const after = readConfig(CFG).projects[process.env.FOLDER].mcpServers[process.env.SERVER].env;
console.log(JSON.stringify({
  backup: bak,
  changed,
  GHL_INTERNAL_LOCATIONS: after.GHL_INTERNAL_LOCATIONS,
  tokenFileStillPresent: Boolean(after.GHL_INTERNAL_TOK_FILE),
  legacyNamesLeftAlone: Object.keys(after).filter((k) => k === 'GHL_TOK_FILE' || k === 'GHL_LOCATIONS'),
}, null, 2));
NODE
```

`tokenFileStillPresent: true` is the assertion that rule 1 held. If it comes back false on a
registration that had a token file, restore the backup and stop.

**The new value does not reach a running server.** The token file is re-read on every call, but
env vars are read once when the stdio server is spawned — so a binding written mid-session takes
effect on the next connect. Verify with `auth_status`: `allowedLocations` is a COUNT (never the
ids) and must equal the number you wrote. If it still shows the old count, the server has not
restarted yet; say so rather than reporting a failed write.

---

## Re-authorize on expiry (agent: do this automatically)

GHL JWTs last ~1 hour. **When any internal tool returns `TOKEN_EXPIRED` (or `TOKEN_MISSING`),
re-run `connect`'s capture step (2) automatically** — write a fresh token to the SAME
project file — then retry the tool. The server re-reads the file every call, so no restart or
re-registration is needed; the launcher copy, the registration and the binding only run on first
setup for a folder. Do not stop to ask; just re-capture (the user still logs in). ONE re-capture
per failure: if the retry fails the same way, stop and report it.

`LOCATION_UNBOUND` and `LOCATION_FORBIDDEN` are **not** credential problems and re-capturing does
nothing for either — they are what `bind` is for. `LEGACY_TOKEN_FILE_ENV` and
`LEGACY_LOCATIONS_ENV` are config problems too: fix them by adding the new name (rule 6).

**Do not paste those four remediation strings verbatim.** Each names a `claude mcp add` command —
correct advice for a folder with no entry yet, and rule 1 for a folder that has one. They do tell
you to re-pass `-e GHL_INTERNAL_TOK_FILE`, but the command still rewrites the entry wholesale and
drops anything else it carried (a legacy name rule 6 says to keep). Run `bind` instead; it makes
the same change additively.

## Auth reference

Rails, referer traps, and the dual-credential AI detail live in
`${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`.
