# Review mode: read a live workflow, propose changes

Use this when the user asks to review a workflow that is running (or was): "why is nobody getting through", "is this A/B test done",
"what's failing in this workflow", "tune this". It reads the account, finds the evidence, and proposes concrete changes. It changes nothing.

## Rules
- **Read-only.** No edit, publish, restore, test run, or alert change happens in review mode. Every proposal goes to the create skill, and
  then only with the user's explicit yes naming the workflow.
- **Name the window and the source.** Every number says which tool gave it and over what window (`get_workflow_step_counts` over a window,
  `get_workflow_heat_map` at most 60 days, and so on).
- **Absent is not zero.** A workflow the heat map does not name, a path the A/B stats do not report, a step with no test result, a refused
  count: say that, and do not turn it into a zero.
- **Incomplete reads say so.** `list_workflow_error_notifications` says `complete:false` when its walk stopped short. Say the error list may be incomplete then.
- **Never declare an A/B winner from a review.** `declare_ab_test_winner` routes every new contact live and cannot be undone. A review may
  name a candidate with its numbers. The decision is the user's, and the call needs `confirm: true` after they name the path.

## Procedure

1. **Structure.** `get_workflow_digest` for the workflow: its version, trigger set, and one line per step with its branch. Note the version; it
   is the `expectedVersion` for any later edit.
2. **Flow.** `get_workflow_step_counts` over the window the user asks about (default: the last 30 days, within the 60-day limit). Read the rows
   per step and per status. A refusal (`INCOMPLETE_WINDOW`, `RETENTION`) is an answer: narrow the window and retry, or report it.
3. **Volume.** `get_workflow_heat_map` for the enrolment counts over the same window. Compare the workflow with its siblings only if the user asks.
4. **Sample journeys (only if the user names a contact or asks for examples).** `get_contact_workflow_history` for that contact, narrowed with
   `workflowId`. Follow `nextCursor` only as far as needed.
5. **Failures.** `list_workflow_error_notifications` for the location, then keep the rows that name this workflow. Say the list may be partial.
6. **Branch and A/B evidence.** If the digest shows an A/B Test step, `get_ab_test_stats` for it. On a draft the tool answers zeros with a null rate (seen 2026-11-07, bl-900 open): report that as no data yet, never as a 0% result.
7. **Tests.** For a step the user asks about, `get_step_latest_test_result` (a `present:false` is a proven absence, not a failure). List runs
   with `list_workflow_test_runs` only if the user asks; starting a test run is not something this skill does.
8. **Assets.** `get_workflow_linked_assets` with `workflowIds` set to this workflow: the tags, forms, calendars and other assets it uses, by step.
   A narrowed read answers even when the workflow uses none, so say "uses no asset" only from that answer. `complete:false` means say the list may be partial.

## What a proposal looks like

Each proposal has five parts: the **finding** (with the number and its window), the **evidence** (tool and window), the **likely cause** (the
step, the branch or the setting), the **proposed change** (concrete: which step, which setting, which value), and **what would confirm it**
(a read that would show the change worked). Keep the list short. Rank by impact.

The proposal types this mode produces:
- **Unreached branch.** A branch of an If/Else, router, or split whose step counts are zero while its parent receives entries. Proposal: check
  the branch condition's values against the stored data, or remove the branch if it is dead.
- **Drop-off step.** A step with many entries and few exits, with the skip or removal reason from the step counts. Proposal: the reason-specific
  fix (for example a wait that outlasts the contact's window, or a condition that names a tag in the wrong case).
- **Failing step.** A step with error rows or error notifications. Proposal: the failing configuration, with the error text as given.
- **A/B winner candidate.** The path with the best rate and an adequate sample, with its numbers, the unknown counts, and the caveat that the
  decision is the user's. Never a declaration.
- **Trigger overlap** (if the user is building a second workflow on the same trigger). Use the overlap check; label each hit WILL, "might also fire", or CANT (cannot fire on the same event).

## What the review does not say

- Whether a fix will work. Propose it, and name the read that would show it.
- That a workflow "is broken" from a count alone. A zero can be a real zero, an absent value, or a refused window.
- Anything about contacts beyond the sample the user asked for.
