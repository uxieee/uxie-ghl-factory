# Canary verification — driving the 2026-07-16 fixes on a live account

Unit tests pin every shape below as a pure function. What they CANNOT prove is GHL's runtime
behaviour: that a wait actually pauses, that a backward stage move reports `[success]`, and
that an editor panel opens. This is the checklist for closing that gap.

**Draft-only. Never publish to a live client account.** Build into a scratch sub-account.

## Prerequisites

1. A LeadConnector JWT (`Authorization: Bearer <jwt>` — the `token-id` header is retired for
   the workflow API; see `docs/auth-jwt-capture.md`).
2. A **scratch** sub-account, not a client's. You need: one pipeline with ≥2 stages, and one
   staff user for the notification recipient.
3. A synthetic contact you own, with a real phone/email you can watch.

## The canary IR

Exercises every fix in one workflow. Build with `scripts/build.mjs` (draft, no publish).

```json
{
  "name": "CANARY — engine fixes 2026-07-16",
  "triggers": [{ "ref": "t", "type": "contact_tag", "name": "Canary start",
                 "filters": [{ "field": "tags", "value": "canary-go" }] }],
  "graph": [
    { "ref": "find", "kind": "find_opportunity", "name": "Find opp",
      "find": { "filters": [{ "field": "pipeline_id", "value": "<PIPELINE_ID>" }],
                "sorting": "latest" },
      "onFound": [
        { "ref": "back", "kind": "action", "type": "update_opportunity", "name": "Regress stage",
          "attributes": { "allowBackward": true, "pipeline": "<PIPELINE NAME>",
                          "stage": "<EARLIER STAGE NAME>" } },
        { "ref": "w", "kind": "wait", "name": "Wait 1 day",
          "config": { "unit": "days", "value": 1, "when": "after" } },
        { "ref": "n", "kind": "action", "type": "internal_notification", "name": "Alert",
          "attributes": { "sms": { "body": "canary fired", "userType": "user",
                                   "selectedUser": ["<USER_ID>"] } } }
      ],
      "onNotFound": [
        { "ref": "crt", "kind": "action", "type": "create_opportunity", "name": "Create opp",
          "attributes": { "pipeline": "<PIPELINE NAME>", "stage": "<LATER STAGE NAME>",
                          "name": "{{contact.name}}" } }
      ] }
  ]
}
```

Note the IR authors `kind: 'find_opportunity'` (the alias) and the `update_opportunity`
name path deliberately — both were silent-drop bugs.

## Assertions — build time

| # | Check | Expect |
|---|---|---|
| 1 | Build report | `authored: 5` and `compiled >= 5`. If `authored` is missing or < 5, the alias regressed. |
| 2 | Round-trip GET | `verify.issues` empty, no `stepCountMismatch`. |
| 3 | `find_opportunity` step | `attributes.__customInputFields__[0].filterField === "pipeline_id"` (snake). |
| 4 | `update_opportunity` step | `attributes.allowBackward === true` and `__customInputFields__` contains `pipelineStageId` — **not** `[]`. |
| 5 | `wait` step | `attributes.startAfter === {type:"days",value:1,when:"after"}` — **never** `{}`. |
| 6 | Whole payload | No node has two parents (tree rule). |

## Assertions — runtime (the part tests can't do)

Enrol the synthetic contact (add tag `canary-go`), then read the logs:

```
GET /workflows/logs/v2?locationId=<LOC>&workflowId=<WID>&contactId=<CID>
    &limit=50&action=first&dateType=custom&fromDate=<EPOCH_MS>&toDate=<EPOCH_MS>
```
(epoch ms; returns a **bare array**.)

| # | Check | Expect | Was |
|---|---|---|---|
| 7 | **The wait PAUSES** | The contact sits AT the wait step. Nothing after it runs today. | Everything fired within 6 seconds. |
| 8 | **Backward stage move** | `Stage -> <earlier stage>` logs **`[success]`** and the opp actually moved. | `[skipped]`, silently. |
| 9 | Notification | Fires, and the recipient receives it. | (was already OK) |

> **You do NOT have to wait real time to verify past a wait.** Waits ARE fast-forwardable
> (2026-07-17f): the builder's "Action statistics → move to next step" control moves a parked
> contact straight to the next step. Verify assertion #7 (the contact is parked AT the wait),
> then use the **`ghl-workflow-fast-forward`** skill to push the synthetic contact past each
> wait and drive the whole ladder to `end_of_workflow` in minutes. Caveat: fast-forward moves
> to the next step, it does NOT evaluate the wait's window/condition — so #7 (that it paused at
> all) still has to be checked the real way; only the *duration* is skippable.

## Assertion — item 6, human-only

Open the canary in the real builder and **click the `internal_notification` step**.

- Editor opens with recipient + body populated → item 6 is closed.
- Editor does nothing → item 6 is still open. Do **not** guess a fix; harvest a real UI-built
  step and diff the top-level keys. See `references/step-shapes.md` → "OPEN:
  `internal_notification` steps won't open in the builder editor".

Browser automation cannot judge this: under automation the panel is unreliable for ANY node
type, correct steps included (2026-07-13). Only a human clicking it is a valid test.

## Cleanup

Delete the canary workflow and the synthetic contact's opportunity. The canary is a draft —
it never fires for anyone else, but leaving it around invites confusion.
