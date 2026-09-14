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

## 4. Record failures in the backlog

For each `FAIL <tool> <assertionId…>` line, when `$GHL_CONSOLE_DIR/bin/backlog.mjs` exists:

1. Look for an existing open row:
   `node "$GHL_CONSOLE_DIR/bin/backlog.mjs" list --state open`, and search for a title that starts
   with `check run: <tool> <assertionId>`.
2. If a row exists, append to it:
   `node "$GHL_CONSOLE_DIR/bin/backlog.mjs" update <id> --note "failed again in receipt <stamp>"`
3. If none exists, add one:
   `node "$GHL_CONSOLE_DIR/bin/backlog.mjs" add "check run: <tool> <assertionId>" --surface <tool's surface from plugin/proofs/<tool>.json> --basis executed --kind behaviour --source "check run" --body "receipt <stamp>, suite <suite>: <assertionId>"`

Every command above uses only flags `backlog.mjs` accepts today (`add` takes `--surface`, `--basis`,
`--kind`, `--body`, `--source`; `update` takes an id plus any of `--state`, `--note`, `--title`,
`--basis`, `--kind`, `--proof`). This skill never passes `--state done` — that transition needs a
`--kind`, a note, and a proof reference that resolves, and deciding a finding is *done* is a fix
judgment, not a recording one.

The operator invoking this skill is the consent to record, so do not ask per row. When the console is
not installed, list the failures in the report instead and carry on.

## 5. Report — and stop

One table:

- passed tools
- failed tools, with their assertion ids
- surfaces with no suite
- tools that are due, GHL shipped or stale **with no suite covering them**

For the last row, open the console's Parity page or read `plugin/proofs/`. Those tools can only be
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
