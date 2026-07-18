---
name: ghl-workflow-fast-forward
description: Fast-forward contacts parked at a GoHighLevel / HighLevel workflow WAIT step to the next step — the builder's "Action statistics → move to next step" control, driven via the internal API. Use to accelerate end-to-end workflow testing (drive a multi-day wait ladder to completion in minutes instead of waiting real time), to unstick contacts stranded at a wait, or when the user says "fast-forward this wait", "skip the wait", "move parked/stuck contacts to the next step", "requeue stuck contacts", "test this long delay without waiting days", or gives an app.gohighlevel.com workflow URL and asks to push contacts past a wait. This MUTATES live enrollments (it fires whatever steps come next, i.e. real SMS/email to real people) — it is a WRITE skill and follows the plugin's write-rails. It is the mutating counterpart to the read-only get-ghl-workflow-logs.
---

# Fast-forward a GHL workflow wait

The builder can move a contact sitting at a wait step straight to the next step — the UI path
is: click the wait step → its contact-count badge → **Action statistics** → tick the contacts →
the running-person icon → **Move all**. That control posts to an internal endpoint, so it can be
driven programmatically. This turns a **120-hour chase ladder into a ~3-minute test**: loop
`count-per-step` → move past each wait → read the logs → repeat. It is the single biggest
constraint removed from GHL end-to-end testing.

**This is a WRITE skill.** Moving a contact fires whatever comes after the wait — real SMS,
real email, real pipeline moves — to real people. Treat it like publishing, not like reading
logs. It is the mutating sibling of `get-ghl-workflow-logs` (which is read-only and explicitly
must NOT do this).

## What it does — and does not — do

- It moves a contact to the **NEXT step**. It does **not** evaluate the wait's own
  window/condition (the "only on weekdays 9–5" gate, the appointment-anchor, the reply-wait).
  You are skipping the wait, not simulating its passage of time — anything the wait was
  supposed to check is bypassed.
- It is **per-contact / selective**: you pass exactly the workflow-status ids you want moved.
  It is not inherently all-or-nothing.
- `statusIds` are **workflow-status ULIDs, not contactIds** — you read them from
  `details-by-step`. Passing a contactId where a statusId is expected moves nothing (or the
  wrong thing).

## Gates — pass these before the first move

This skill issues internal-API writes, so both write-rails gates apply, plus a third gate
specific to fast-forwarding (it sends real comms):

1. **Gate 1 — Owned-account check** (`${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md` §Gate 1).
   Every session, before the first move: confirm the authenticated user is an admin on the
   target `locationId`. Refuse otherwise; override only via the logged, in-their-own-words path.
2. **Gate 2 — ToS disclosure** (`write-rails.md` §Gate 2). Once per workspace: this goes through
   the undocumented internal API. Record acknowledgment at `.ghl/tos-acknowledged`.
3. **Gate 3 — Real-comms confirmation (this skill).** Fast-forwarding is meant for **e2e
   testing with synthetic contacts on a workflow you own**. Before moving:
   - Prefer synthetic test contacts you created for the test, on a scratch/owned workflow.
   - If the contacts to be moved are or might be **real leads on a live client workflow**,
     STOP and get explicit confirmation naming what will be moved and what it will fire. Do not
     blanket-move. A wrong move here sends a real, un-recallable message to a real customer.
   - Never move `--all` at a step without an explicit, per-run `--confirm` from the user.

Auth (header format, JWT capture, token claims, expiry) lives ONLY in
`${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`. The intercepted JWT must be scoped to the
workflow-builder iframe origin or the endpoints 401.

## Default workflow

1. **Parse the target.** Need `locationId` + `workflowId` (from the URL
   `…/workflow/{WORKFLOW_ID}`). Ask if missing.
2. **Gates.** Run Gate 1 + (first-time) Gate 2; hold Gate 3 in mind for the move itself.
3. **Capture the scoped JWT** per the canonical auth doc. Point `GHL_TOK_FILE` at the file that
   holds the captured `Authorization: Bearer …` header.
4. **See where everyone is (read-only).** `count-per-step` lists every occupied step + counts;
   `details-by-step` lists the parked enrollments at one step (with their status ULIDs). The
   script's `peek` does this without writing.
5. **Move — selectively.** Move by contactId (one test contact) or by explicit statusIds. Only
   use `--all --confirm` when you genuinely want every parked contact at that step moved, and
   the account/workflow is yours to test on.
6. **Verify with logs.** Re-read via `get-ghl-workflow-logs` (or `count-per-step`) — the moved
   contact should now be at the step after the wait and the intervening step(s) should show in
   `logs/v2`. Loop back to step 4 for the next wait in the ladder.

## The script

`${CLAUDE_PLUGIN_ROOT}/skills/ghl-workflow-fast-forward/scripts/ff.mjs` — an importable module
+ CLI. It defaults to **read-only**; a move requires an explicit subcommand and, for `--all`, an
explicit `--confirm`.

```
GHL_TOK_FILE=/path/to/token.txt node ff.mjs <LOC> <WID> peek                 # count-per-step
GHL_TOK_FILE=… node ff.mjs <LOC> <WID> peek <STEP_ID>                        # details-by-step (who's parked)
GHL_TOK_FILE=… node ff.mjs <LOC> <WID> move <STEP_ID> --contact <CID>        # move ONE contact past the wait
GHL_TOK_FILE=… node ff.mjs <LOC> <WID> move <STEP_ID> --status <ID,ID>       # move explicit status ULIDs
GHL_TOK_FILE=… node ff.mjs <LOC> <WID> move <STEP_ID> --all --confirm        # move EVERY parked contact (paginates)
```

Without `--confirm`, a `--all` move prints what WOULD move and stops (dry run). `move` with an
explicit `--contact`/`--status` performs the move.

## Live-proven (GROM AU, 2026-07-18)

Drove a 3-contact / 2-wait canary end to end via this skill's `ff.mjs`, tags proving each step
actually fired (not just a pointer move):

- **`count-per-step` / `details-by-step` / `requeue-stuck-statuses`** all work with the iframe
  JWT. `details-by-step` `_id`s are workflow-status ULIDs, distinct from `contactId`.
- **Selective move with >1 parked** ✅ — 3 parked at a wait, moved ONLY one (by contactId); it
  alone advanced (its next step fired) and the other two stayed put.
- **Bulk `--all`** ✅ — moved the remaining two; both advanced. The `--all` dry-run guard (no
  `--confirm`) correctly moved nothing and reported `wouldMove`.
- **Pagination** ✅ — `allParked` with `pageSize=1` drained all 3 rows across pages.
- Full ladder driven to `end_of_workflow` in ~2 min (both waits fast-forwarded).

## Still not proven — flag, don't assert

- **The UI "Select all N contacts" link** may post a different body (a flag rather than an id
  list). The script deliberately builds the id list itself (`allParked` → `requeue`) rather than
  relying on that link, so this is untested and doesn't matter for the script — but if you ever
  reverse-engineer that link, capture its body separately.

## Resources

- `references/fast-forward-runbook.md` — exact endpoints, headers, request/response shapes,
  pagination, and the selective-vs-bulk decision.
- `scripts/ff.mjs` — the driver (peek + selective/bulk move).
- `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md` — the two mandatory write gates.
- `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` — canonical JWT capture + header format.
