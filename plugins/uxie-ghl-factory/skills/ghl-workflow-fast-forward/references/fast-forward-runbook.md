# Fast-forward runbook — endpoints, shapes, pagination

Harvested from the builder UI and live-proven 2026-07-17f. Host is
`backend.leadconnectorhq.com`. All three calls use the standard builder header set; only the
last one mutates.

## Headers

The intercepted JWT must be scoped to the workflow-builder iframe origin (see the canonical
auth doc `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`) or the calls 401.

```
authorization: Bearer <iframe JWT>
channel: APP
source: WEB_USER
version: 2021-07-28
accept: application/json, text/plain, */*
referer: https://client-app-automation-workflows.leadconnectorhq.com/
# writes additionally send:
content-type: application/json
origin:  https://client-app-automation-workflows.leadconnectorhq.com
```

The move's `userId` is the token's `authClassId` claim (decode the JWT payload).

## 1. count-per-step — where is everyone? (READ)

```
GET /workflows/status/search/count-per-step?workflowId=<WID>&locationId=<LOC>
→ [ { total: 1, currentStepId: "<stepId>" }, ... ]
```

One entry per occupied step. Use it to find which wait step your test contact is parked at,
and to confirm the move landed (the contact should leave the wait's `currentStepId`).

## 2. details-by-step — who is parked at ONE step? (READ)

```
GET /workflows/status/search/details-by-step?workflowId=<WID>&locationId=<LOC>
    &skip=0&limit=11&currentStepId=<stepId>&showTotalCount=true
→ { totalCount, rows: [ { _id: "01KXQRV9HE…", contactId, workflowId, currentStepId, executeOn }, ... ] }
```

- **`_id` is the workflow-status ULID** — this is what the move consumes. It is NOT the
  contactId. `contactId` is present too, so you can select "the row(s) for this contact".
- **`limit` defaults small** (the harvested call used `limit=11`). A busy step needs
  pagination: page `skip += pageSize` until `rows.length >= totalCount`. `ff.mjs`'s `allParked`
  does this.

## 3. requeue-stuck-statuses — the move (WRITE)

```
POST /workflow/<LOC>/<WID>/requeue-stuck-statuses/<stepId>
Body {
  "actionFrom": { "userId": "<UID>", "channel": "web_app", "source": "action_stats_page" },
  "statusIds": [ "01KXQRV9HEE7115MD39ZZB4TTD", ... ]   // the _id values from step 2
}
→ 200 { "error": false, "msg": "#reQueueStuckContacts-success:<LOC> in step:<stepId> WF:<WID>" }
```

- `statusIds` are the workflow-status ULIDs from `details-by-step`, exactly the ones you want
  moved. It is **selective**, not all-or-nothing.
- The move sends the contact to the **NEXT step** and fires it. It does **not** evaluate the
  wait's window/condition — you are skipping the wait, not advancing simulated time.

## Selective vs bulk

- **Selective (the safe default):** get `_id`s for the specific contact(s) you're testing
  (`parkedAt` → filter by `contactId`) and move only those. Proven for the single-contact case.
- **Bulk (`--all`):** page `details-by-step` to collect every `_id` at the step, then move them.
  The `ff.mjs --all` path is a DRY RUN until `--confirm` is added.

## Proven (GROM AU, 2026-07-18)

- **Selective move with >1 parked** ✅ — 3 parked, moved 1 by contactId, the other 2 stayed. The
  moved contact's next step fired (proven by a tag it adds), so it's a real advance, not just a
  pointer move.
- **Bulk `--all`** ✅ and **pagination** ✅ (`allParked` with `pageSize=1` drained all 3).
- The whole ladder (2 waits) driven to `end_of_workflow` in ~2 min.

## Still unproven — flag, don't assert

- **The UI "Select all N contacts" link** may post a different body (a flag rather than an id
  list). Only the ids-based body above was captured; `ff.mjs` builds the id list itself rather
  than depending on that link, so this doesn't affect the script.

## Test loop (why this exists)

To drive a long chase ladder end-to-end in minutes:

1. Enrol a synthetic contact you own; note the workflow + first wait step.
2. `peek` `count-per-step` → find the wait `currentStepId` the contact sits at.
3. `move <stepId> --contact <cid>` → past that wait.
4. Read `logs/v2` (via `get-ghl-workflow-logs`) to confirm the next step(s) fired.
5. Repeat 2–4 for each subsequent wait until `end_of_workflow`.
