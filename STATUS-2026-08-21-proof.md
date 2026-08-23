# Workflow Engine: What Is Proven, What Is Only Tested, What Is Claimed (21 Aug 2026)

This replaces `STATUS-2026-08-21.md`, which was written mid-session and is now stale. It exists
because Xander asked for a clear picture before deciding anything. It makes no release
recommendation.

## How to read the grades

- **PROVEN**: executed against the live GROM AU account or measured against real data, the
  result observed, and recorded with a pointer.
- **TESTED**: the automated suite is green, but nothing was observed live.
- **CLAIMED**: inferred from reading code or source, not executed. Treat as a hypothesis.

Every row says what was checked and, just as importantly, what was not.

## 1. The changes, graded

| # | Change | Grade | What was actually observed | What was NOT checked |
|---|---|---|---|---|
| 1 | Root step no longer emits `parentKey: null` (key omitted) | **PROVEN** | 0 of 3,958 corpus nodes carry `null`; 309 of 310 entry nodes omit the key; a builder-saved entry node captured live has no such key. Engine 485/485. | That this caused your original "node has no parentKey" error. Yours was a mid-graph node; this fix is root-scope. Causal link unproven. |
| 2 | Asset pre-flight (`validate-assets` before any write) | **PROVEN** for what it catches | Live on GROM AU: a workflow assigning a nonexistent user was aborted before the create; `list_workflows` confirmed zero workflows created. Differential: catches bogus user and workflow ids, MISSED a bogus calendar id. `companyId` proven optional. | The full set of asset types it checks (4 probes only). The fail-open paths are unit-tested, never observed live. |
| 3 | Catalog regenerated from a fresh capture: 385 steps (+`loop`, +`workflow_ai_generate_image`), 204 triggers | **PROVEN** additive | Diffed on every axis before shipping: nothing lost, nothing narrowed, section drift 0. | History is not clean: commit `3870df2` silently re-sorted 4 steps' sections; fixed in `2841265`. The first regen attempt (never committed) dropped a step type and wiped required fields on 53 steps and was caught only by the diff. |
| 4 | Attribute surface from GHL's model interfaces (`modelFields`; `attrKeys` widened on 36 types; `wait` 2 to 57) | **PROVEN for `wait` only** | All 10 attributes the real builder emitted for a wait are present in `IWait`. | The other 50 types: "interface is a superset of the wire" is ASSUMED. Known softness: UI-side fields (`email.previewUrl`, `createdAt`, `testEmails`) now pass the guard. This RELAXES the engine's key guard for 36 types; it accepts more than before. `type` is never widened (proven: declared on `IContactTag`, 0 of 101 `add_contact_tag` nodes carry it). |
| 5 | Allowed-value lists on 52 fields (`wait.type` = 13 modes, `appointmentCondition` gained `exit`) | **PROVEN as declared** by GHL source; **CLAIMED as accepted** by the server | Values come from `export type` unions and enums in the current source. | No value was live-built to confirm the server accepts it. `recurring_schedule`, `specific_date`, `user_replied` have never been built by this engine. |
| 6 | Per-variant required fields with GHL severity (`variantRules`, 54 types) | **PROVEN as GHL's rule** | Extracted from GHL's own validator code; `wait` carries all 13 modes. | Informational only. The engine enforces none of it (see section 2). |
| 7 | `loop` availability gate | **PROVEN picker-only** | Live: a bare loop built on GROM AU (NOT on the 36-location allowlist) was stored verbatim and rendered by the builder as a full loop container with body slot and end edge, no error panel. Screenshot and aria tree on disk. | Runtime execution. The workflow is a draft and stays one. |
| 8 | `recapture.mjs` (one-command re-capture and drift check) | **PROVEN** end to end | Ran on a real rotation the same day (`wdI8GCwJ` to `BzLmNhAQ`): `--check` exit 2, `--stage` captured, extracted, regenerated, diff reported additive. | The 5 carry-forward commands after `--stage` are still manual. |
| 9 | `build.mjs` now prints the pre-flight outcome | **TESTED** (syntax only) | `node --check` passes. | Not exercised live; that needs another draft build. |

## 2. What the engine enforces today, measured

Compiled offline with a working warning collector (the first attempt had none and reported
"silent" for a case that does warn; that mistake is recorded in the ledger).

| Input | GHL's own grade | Engine today |
|---|---|---|
| `update_contact_field` update with a blank value (the silent no-op) | warning | warns `CONTACT_FIELD_CLEAR_MISMATCH` |
| `update_contact_field` clear with a value present | warning | warns `CONTACT_FIELD_CLEAR_HAS_VALUE` |
| `internal_notification` email with no body | warning | **silent, and fills in `subject:""`, `html:""`** |
| `wait` for 0 minutes | warning | **silent** |
| `wait` until a user replies, with no channel and no repliedBy | **error** | **silent** |

The engine throws on 9 hand-attested conversationai field sets and on structural mistakes
(unknown keys on verified types, dead branches, bad condition shapes). It warns on a handful of
shape advisories. It has no knowledge of GHL's per-variant rules.

Plain statement: **the catalog now knows 635 GHL validation rules; the engine blocks 0 of
them.** Today's work improved what an agent can read. It did not change what the compiler stops.
How GHL's severities (536 warnings, 99 errors) should map onto the engine's tiers is undecided.

## 3. What I got wrong today, so you can weigh the rest

- Published wrong counts in a design doc (659 workflows, actually 326; 436 model files, actually 160).
- Proposed porting GHL's validators on the claim they "have holes". The hole was in the stale May capture; current source handles all 13 wait modes.
- Nearly shipped a pre-flight that would never have run in production (it required a company id the engine does not have). Caught only by running it live.
- First catalog regeneration silently dropped a step and 53 steps' required fields. Caught by diff, not by the generator.
- Committed a 4-step section re-sort in `3870df2`. Caught one commit later.
- Read the builder as "renders nothing" from `innerText`. The aria tree showed a full loop container. Retracted within the same probe.
- Reported the engine silent on the empty-update no-op. My harness could not hear warnings. Retracted (section 2 is the corrected measurement).
- Leaked a live access token into the session transcript through a bad redaction pattern. It expired within the hour.
- Described release as "a timing call, not a risk call" with two open items on the same screen.

## 4. Left on GROM AU, never deleted

- `1c38ae6a-4e77-4193-b009-6b224088409e`: empty draft with one 10-minute wait (this morning's UI exploration).
- `3e65924f-612f-4158-9184-6d56d97b3b77`: draft `ZZ-CLAUDE-LOOP-GATE-PROBE-stage1-DO-NOT-USE`, one bare loop node.

Also: `.ghl/hdrs-capture.txt` holds a captured token (gitignored, 0700 directory).

## 5. Commits, nothing pushed, nothing released

| Repo | Latest | Branch |
|---|---|---|
| `ghl-plugin` | `eba3146` | `main` |
| `ghl-workflow-api-docs` | `c9315c2` | `main` |
| `ghl-internal-api-research` | `7be9f36` | `main` |

The MCP tools still run the installed plugin 0.26.0. None of the above reaches an agent through
the tools. `scripts/build.mjs` from the working tree has all of it.

## 5b. Since this file was first written (same day)

1. Enforcement SHIPPED (`beefbcd`): 133 blocking rules from GHL's own guards, corpus-replayed
   clean, live-accepted on GROM AU. Items 1-2 below are superseded by it.
2. Step-reference integrity (`9547fa9`): the "0 Errors over broken gotos" class — compile
   chokepoint + deleteStep refusal + commit backstop.
3. modifyStep bypass CLOSED (`515e2b6`): field enforcement now runs over the steps an edit
   touched, at the same commit point. Every edit path meets the fresh-build bar.

## 6. Not done

1. ~~Severity mapping~~ — superseded by enforcement tiers (THROW/NEVER/WARN, shipped).
2. ~~variantRules enforcement~~ — shipped as part of the same.
3. Runtime proof of `loop` on a non-allowlisted location.
4. 23 native step types still have no interface mapping (no validator in the registry, or a non-standard signature).
5. Automating the 5 carry-forward commands after `recapture.mjs --stage`.
6. Live exercise of the new `build.mjs` pre-flight line.
7. 64 WARN rules (underivable format/range guards) have no value evaluators yet.
8. Release.

Full evidence, finding by finding: `docs/superpowers/notes/2026-08-21-workflow-shape-findings.md` (local, gitignored).
