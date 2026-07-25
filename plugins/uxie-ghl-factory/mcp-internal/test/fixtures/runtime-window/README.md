# runtime-window fixtures

Scenario data for `test/workflow-runtime-window.test.mjs` (Task 3 of
`docs/superpowers/plans/2026-07-24-internal-mcp-audit-read-profile.md`).

Every scenario carries a `planBullet` naming the plan bullet (lines 386-404) it exists to
prove, and a `why` sentence saying what would silently break if the scenario were deleted.
The four files group by concern:

| file | concern |
| --- | --- |
| `execution-log-windows.json` | the `/workflows/logs/v2` partition walk |
| `enrollment-walk.json` | the `action=first/next` enrollment cursor walk |
| `step-roster-and-totals.json` | `details-by-step` rosters and enrollment totals |
| `identity-binding.json` | response-side identity binding and quarantine |

## The upstream model these fixtures drive

The fake audit gateway in the test file replays a scenario as if it were the real backend.
Two properties matter and are deliberate:

1. **The log stub is INCLUSIVE on both ends** — a query for `fromDate..toDate` returns every
   corpus row whose `_t` satisfies `_t >= fromDate && _t <= toDate`. Real upstream boundary
   semantics are undocumented (`queryBoundaries: 'upstream-defined'` in the plan's result
   shape). Making the stub inclusive is what makes the collector's OWN half-open
   `[fromDate, toDate)` retention observable: a row at exactly `toDate` comes back from the
   wire and must be dropped locally, and a row at `fromDate - 1` comes back because of the
   mandated one-millisecond expansion and must also be dropped locally.
2. **A corpus row with `"_t": null` is returned for EVERY range.** That models the row the
   collector cannot place in time — the plan's "event with no parseable timestamp". It counts
   against the 20-row page like any other row.
3. **`fromDate` is NON-ZERO in every scenario but one.** The mandated one-millisecond
   lower-bound expansion is `Math.max(0, fromDate - 1)`, so at `fromDate: 0` it is clamped
   away entirely and the real expansion path is never exercised. When almost every scenario
   started at 0, a 636-case differential oracle found 30 windows the collector reported
   `complete:true` while missing events — every one of them at `fromDate: 0`. The single
   deliberate zero case is `window-starting-at-epoch-zero` in `execution-log-windows.json`,
   which pins the clamped-bound behaviour (`expansionMs: 0` plus
   `LOG_WINDOW_LOWER_BOUND_UNEXPANDED`) instead of hiding it.
4. **A scenario that does not pin `statsCache`/`stats` gets a FIXED all-time enrollment
   total**, never a figure derived from the enrollment rows the stub is about to serve. The
   harness used to compute it from those rows, which made total-vs-roster reconciliation
   unfailable by construction — every `complete:true` in every fixture rested on a check
   that could not have fired.

## Row shorthand

Anywhere a row list is accepted, an entry of the form `{"generate": {...}}` expands to N rows
so a 20-row page does not cost 20 lines of JSON. The expansions are spelled out in
`expandRows` / `expandEnrollmentRows` / `expandContactRows` in the test file.
