---
name: ghl-recheck
description: Re-prove the plugin's tools live on the designated sandbox, record a proof run per tool the suites exercised, and record failures in the backlog. Use when the operator invokes /ghl-recheck or asks to re-check, re-prove or refresh proofs. Records only — never fixes.
---

# Re-checking proofs, live

This runs **only because the operator asked.** Nothing schedules it. It **records** what it finds.
Fixing a failure is a separate session the operator starts.

## 0. Preconditions — stop on any

- `GHL_LIVE_PROOF_LOCATION` is set. It must be the designated sandbox, never a client account. If it
  is unset, say so in one line and stop; do not pick an account.
- The working directory is the plugin repo root (`gohighlevel/plugin`), on `main`, with a clean tree.

## 1. Pick suites

Surfaces map to suites through the `surfaces` field of each row in `PROOFS` in
`scripts/run-live-proofs.mjs`:

- `workflows` → `workflows`
- `funnels` → `funnels`
- `memberships-courses` → `memberships`

A surface with no suite is **reported, never silently skipped.** With no arguments, run all suites.

## 2. Run

```bash
node scripts/run-live-proofs.mjs --dry-run            # say what will run, against …last-four
node scripts/run-live-proofs.mjs --confirm [--only <suite>]
```

Note the receipt stamp it prints: `audits/live-proofs/<YYYY-MM-DD-HHMM>.json`.

## 3. Record proof runs

```bash
node scripts/proof.mjs from-receipt <stamp>
node scripts/proof.mjs sync-labels
node scripts/proof.mjs validate
```

`from-receipt` writes a run only for a tool whose handler a suite actually called. The memberships
suite calls no handler, so it proves no tool: say so in the report.

If `validate` reports any error, put it in the report as its own line. Still work through §4 for
whatever suite failures the receipt carries — recording those does not depend on validation passing
— but do not run the `git commit` in §5. A proof record that fails its own schema check is not
something to commit around; leave the tree as-is for the operator to look at.

## 4. Record failures in the backlog

For each `FAIL <tool> <assertionId…>` line, when `$GHL_CONSOLE_DIR/bin/backlog.mjs` exists:

1. Look for an existing open row:
   `node "$GHL_CONSOLE_DIR/bin/backlog.mjs" list --state open`, and search for a title that starts
   with `check run: <tool> <assertionId>`.
2. If a row exists, append to it:
   `node "$GHL_CONSOLE_DIR/bin/backlog.mjs" update <id> --note "failed again in receipt <stamp>"`
3. If none exists, add one:
   `node "$GHL_CONSOLE_DIR/bin/backlog.mjs" add "check run: <tool> <assertionId>" --surface <suite's surface, from §1> --basis executed --kind behaviour --source "check run" --body "receipt <stamp>, suite <suite>: <assertionId>. Also serves <any other entries in plugin/proofs/<tool>.json's surfaces array>."`

`plugin/proofs/<tool>.json`'s `surfaces` is an array — some tools carry more than one (`find_ghl_site`
carries `ai-studio` and `funnels` both). `--surface` takes one value: use the surface of the SUITE
that just exercised the tool (§1's mapping), never a value picked from the array by hand, and name
every other surface the tool also serves in `--body` so none of them is lost.

Every command above uses only flags `backlog.mjs` accepts today (`add` takes `--surface`, `--basis`,
`--kind`, `--body`, `--source`; `update` takes an id plus any of `--state`, `--note`, `--title`,
`--basis`, `--kind`, `--proof`). This skill never passes `--state done` — that transition needs a
`--kind`, a note, and a proof reference that resolves, and deciding a finding is *done* is a fix
judgment, not a recording one.

The operator invoking this skill is the consent to record, so do not ask per row. When the console is
not installed, list the failures in the report instead and carry on.

## 5. Report — and stop

One table, tool as the row key:

| tool | suite | result | assertion ids | surface(s) |
|---|---|---|---|---|
| `find_ghl_site` | `funnels` | pass | — | `ai-studio`, `funnels` |
| `edit_workflow` | `workflows` | FAIL | `stepindex-per-type` | `workflows` |

Below the table, three plain lines:

- **Surfaces with no suite** — a corpus surface absent from §1's mapping entirely (nothing ran, ever;
  today's PROOFS covers only `workflows`, `funnels`, `memberships-courses`).
- **Due** — a tool with a proof record, but its latest run is more than 30 days old (this project's
  freshness constant; `global-constraints.md`).
- **GHL shipped / stale, with no suite covering them** — a tool whose proof the platform itself has
  undercut since it was recorded: **GHL shipped** means the app build behind its endpoints has moved
  (the console's Parity page flags this as a build-drift warning); **stale** means `proof.mjs rehash`
  refuses it outright because the tool's own code or endpoint hashes changed since it was proven. Both
  need a live re-check to clear, and neither of the three suites above can do it for a tool their
  mapping doesn't reach — say so by name.

For that last line, open the console's Parity page or read `plugin/proofs/`. Those tools can only be
re-proven by a session, by hand, and this skill does not do that.

Then **commit** the new proof records and label changes:

```bash
git add proofs/ && git add -u && git commit -m "proofs: re-check <stamp>"
```

## What this skill never does

- It never edits a tool, a suite, a script, or anything under `skills/*/scripts/`. A `FAIL` line is
  data for the report and the backlog, not a cue to patch the tool in the same breath.
- It never moves a backlog row to `done`, `dropped` or `confirmed`. It only adds rows and appends
  notes to open ones — closing a finding means someone fixed it and proved the fix, which is a
  different session's job.
- It never releases. Label changes this run produced ship on the next deliberate
  `npm run release -- X.Y.Z`, not here.

Fixing a `FAIL` is the *next* session's task, started on purpose, with this run's report as its
starting point — not a step of this one.
