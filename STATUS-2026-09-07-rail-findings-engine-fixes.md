# 2026-09-06 rail findings → engine fixes — receipt

**Date:** 2026-09-07 · **Branch:** `engine/rail-findings-2026-09-06` (two commits on top of `main`
at 0.56.1, NOT pushed) · **Input:** the 32-item engine backlog compiled from the four booking
rails (three client sub-accounts and the GROM Sandbox; 28 Aug to 6 Sep 2026) · **Proof
level:** unit and tool-level tests, **plus a live differential on the sandbox 2026-09-07** — the
EXECUTED/OBSERVED ledger is at the end of this file. The live pass found three further defects the
tests could not, which are fixed and proven in the same run.

## What was DISPROVED by reading the code, before anything was changed

| Finding | What the code actually did | Root cause |
|---|---|---|
| 1, 16, 32, R-80, R-115 — silent no-ops | `checkOpShape` checked REQUIRED keys only; trigger ops had no shape check at all. `modifyTrigger` read `op.trigger.{name,filters,active,target,…}` and nothing else; a top-level `conditions`/`name`/`status` fell through. The top-level `name` is the MATCHER (`resolveTrigger`). | one mechanism, four findings |
| 2 — the verifier passes a no-op | `verifyTriggerRoundTrip` compared the PUT BODY to the store. When the op key was dropped, the body carried the stored values, so the compare passed. | intent, not request |
| 13 (D-67) — unmoved `date_updated` | nothing read `date_updated`; the round-trip GET is live (the read cache is a version-drift cache, not a GET cache) so the write genuinely never landed | no tamper-evident field |
| 24 — `OPP_WRITE_UNBOUND_PATH` on the canonical pattern | `lintOpportunityWrites(gotTemplates.filter(touched))` — the lint received ONLY the touched steps; its parentKey walk hit a missing parent on hop one. The stored shape of `find_opportunity → transition → step` matches what the walk expects (checked against a saved sandbox export). | subset input |
| 17 — the splitter rule | the rule fired on ANY container head; the only measured case was a `conversationai_book_appointment` head; R-113/R-131 show a nested-splitter head chosen live | over-broad rule |
| 6 — `MODIFY_NOT_NORMALISED` noise | unconditional for every `NORMALIZE_SKIP` type | no key diff |
| 12 — `moveStep` | re-linked `next` only; `parentKey` of the displaced steps stayed stale | half an edge |
| 18 — `addBranch` on a splitter | required `nodeType === 'condition-node'` | if/else only |
| 8 (R-74) — `index-of-false` off-menu | `rows.find(field)` returned the FIRST of two `contact.tags` catalogue rows (has-tag / doesnot-have-tag) | first row only |
| 11 (R-98) — `<redacted>` in step HTML | `LABELED_SECRET` matched `token="true"` inside `data-cv-token="true"` | attribute name read as a label |
| 14/28 — `update_convai_agent` 422 | `SERVER_KEYS` lacked `workingHours` and `steps`; the read-merge-write echoed them and the PUT's DTO refused | echo of read-only projections |
| 5 — `replaceInAttributes` top-level only | FALSE on current code: dotted paths with `[]` were already supported; the finding dates from an older build. Pinned by test. | stale finding |
| 22 — root appended last never runs | ALREADY guarded (`ENTRY_NOT_FIRST`) on both write tools; the finding was a hand PUT | already covered |
| 9 — rename rail bumps `version` | that rail is a client script; nothing in the plugin | not in scope |

## What changed (each with the test that pins it)

| # | Change | Test |
|---|---|---|
| 1,16,32,19 | strict op keys, per-op hints, matcher/rename ambiguity refused, `trigger.conditions` verbatim, NOOP planning | `engine/edit-op-strictness.test.mjs` (18) |
| 2,13 | verifier holds the store to `requested` + `date_updated` moved | `test/edit-workflow.test.mjs` (D-67, R-96, happy, NOOP, shape) |
| 3,4 | pre-flight `phase`, post-write re-check, hatch refused on a replaced id, remediation reworded | `test/edit-workflow-validation-parity.test.mjs` (3) |
| 17 | splitter rule narrowed to the measured head type | `engine/graph-context-rules.test.mjs` (2 new) |
| 24 | opportunity lint walks the whole document, reports the scope | `engine/lints/opportunity.test.mjs`, `test/edit-workflow.test.mjs` (D-89) |
| 6 | `MODIFY_NOT_NORMALISED` only for introduced keys | `engine/template-normalize.test.mjs` (2) |
| 15,25 | `engine/field-caps.mjs`; refuse + `allowOverCap`; `describe_step_type.caps`; `SCHEMA:` warnings | `engine/field-caps.test.mjs`, parity (3), schema-check (3 amended) |
| 12 | `moveStep` parentKey consistency; entry step refused | `engine/edit.test.mjs` (3) |
| 18 | `addBranch` on a splitter + `addSplitterBranch` alias | `engine/edit.test.mjs` (2) |
| 20 | `updateSettings.name` | `engine/settings-edit.test.mjs` |
| 8 | tag rows union operators | `engine/lints/trigger-rows.test.mjs` |
| 14,28 | `workingHours`/`steps` stripped | `engines/ai/convai-compiler.test.mjs` |
| 11 | `data-*` attribute names exempt from the labelled rule | `test/errors.test.mjs` |
| 26,10,23,29,30,21,27 | `noStats`, orphan-POST guard, parked-contact count, field-id resolution, objective write failures, `writeTo`/`stepIds`/`templatesPath` | `test/rail-findings-2026-09.test.mjs` (6) |

## Suites on this tree

| Suite | Result |
|---|---|
| engine (`skills/create-ghl-workflow/engine`) | 916 / 916 |
| convai compiler (`engines/ai`) | 45 / 45 |
| mcp-internal (`test/**`) | 1120 / 1123 — the 3 failures are `dist/*.mjs` sync and the catalogue freshness gate, both caused by an UNCOMMITTED `catalog/endpoint-overlay.json` edit from another session (forms surface, 2026-09-06) that the release's `sync-generated` step will fold in; `dist` was deliberately not rebuilt here so that WIP does not ride into these commits |

Baseline before any change: engine 882 / 882, mcp 1101 / 1104 (the same three).

## Live-fire, 2026-09-07 — EXECUTED vs OBSERVED

Run from SOURCE on the branch (not the installed 0.56.1 bundle) through each tool's registered
handler with the real gateway, against the GROM Sandbox with the Rail 3 session's clearance.
Probe workflow `TEST-CAP-0.57.0 engine live-fire (2026-09-07)` (draft, never published) in its own
folder. Every row is a DIFFERENTIAL — the same call with one variable changed, read back separately.

| # | Claim | Executed | Observed | Verdict |
|---|---|---|---|---|
| L1 | The R-96 op shape is refused and writes NOTHING | `modifyTrigger` with top-level `conditions`, `confirm:true` | `ENGINE_ABORT` naming trigger.conditions/filters; export after: version, `date_updated` and conditions ALL unmoved | **PROVEN** |
| L2 | The R-101 shape is refused | `modifyTrigger` triggerId + top-level `name` | `ENGINE_ABORT` "the MATCHER … got a verified rename that never happened" | **PROVEN** |
| L3 | The R-115 shape is refused | `modifyStep` with `attributes` | `ENGINE_ABORT` naming attrPatch | **PROVEN** |
| L4 | The right shape lands AND the stamp moves | `modifyTrigger` `trigger.conditions` (stored shape) | ok; stored value changed; `date_updated` 17:47:40 → 17:49:54; check carries `requested` + `dateUpdated.moved:true` | **PROVEN** |
| L5 | A no-change re-send is a NOOP, not a write | the identical op again | ok, `triggerChangesApplied: 0`, one `noops` entry, `TRIGGER_NOOP` warning, `date_updated` UNMOVED | **PROVEN** |
| L6 | `moveStep` produces a document GHL accepts | move the tail step up | ok, roundTrip true, chain reordered, **0 parentKey mismatches** (this is the shape that used to be refused `INVALID_STRUCTURE`) | **PROVEN** |
| L7 | The entry step cannot be moved | `moveStep` on the root | `ENGINE_ABORT` naming insertBefore | **PROVEN** |
| L8 | A measured cap refuses; the hatch writes | 640-char `conversationai_ai_message` | `VALIDATION_FAILED` "640 … cap is 600"; with `allowOverCap` the preview carries `FIELD_CAP` + two `SCHEMA:` warnings | **PROVEN** |
| L9 | `addBranch` works on an AI SPLITTER | append a splitter, add a 4th branch, then `appendToBranch` by name | 3→4 branches, row `conditionType:"user-defined"`, node parented correctly, and the branch then leads to the appended step | **PROVEN** |
| L10 | `replaceFieldId` refuses a foreign new id | real old id + nonexistent new id | `UNRESOLVED_DEPS` naming the old id's `fieldKey`; with two real ids it previews and reports both | **PROVEN** |
| L11 | The file rails round-trip | `export_workflow` stepIds + writeTo → edit the file → `repair_workflow templatesPath` | narrowed to 1 step with `exportFilter.missing`; file written; repair applied the rename; relative path refused | **PROVEN** |
| L12 | The R-95 orphan POST is refused | `raw_request` POST trigger with root `workflow_id` | `VALIDATION_FAILED` naming ORPHAN; **zero gateway calls sent**; the camelCase body passes | **PROVEN** |
| L13 | GRAPH_CONTEXT no longer fires on a nested-splitter branch head | preview with a splitter under a branch | no `GRAPH_CONTEXT` warning | **PROVEN** |

### What the live-fire found that the unit tests could not — three MORE defects, now fixed

Stripping `workingHours`/`steps` was necessary but NOT sufficient. With that 422 gone the next
layers became reachable, and each was a live failure on a write the tests reported as fine:

1. **`summary` / `emailSettings` read back as `{}` and the PUT refuses them field by field**
   ("summary.enabled must be a boolean value", …). An empty one is the server's "unset". Dropped;
   proven by the identical PUT succeeding with them dropped, read-back leaving them `{}` and every
   collateral field intact.
2. **`actions` is WRITE-ONLY** — the PUT sends `null` as the UI does, the record reads back the real
   list, so the verifier reported `AGENT_VERIFY_MISMATCH` on every successful update. Excluded from
   the verified set. After both fixes `update_convai_agent` returns `verified: true,
   confirmed: [personality, locationId]`, collateral unchanged.
3. **`create_convai_agent` never ran `applyBotTypeCleanup`**, so it sent `tones` on a
   `PROMPT_BASED_BOT` and the server refused the whole create — every prompt-bot creation through
   that tool was failing. Fixed and proven: create now returns `verified: true` with 20+ confirmed
   fields. Dropped keys are NAMED (`BOT_TYPE_KEY`), not silently removed.

### Left in place on the sandbox (nothing deleted)

- folder `6980504f-2c67-4ba4-842d-dce877edf988` "TEST-CAP-0.57.0 probes (2026-09-07)"
- workflow `7fbb2603-a8e4-45e6-ae08-660c802cf68b` (draft, in that folder)
- tags `probe-057-a`, `probe-057-b`, `probe-057-go`, `probe-057-changed`
- Conversation AI agents `0az8xPNSEFlf25Hd6xoh` and `Itl3RL2G6LMjCprqcluI` (both mode off, unrouted)
- Probe driver + ledger: the session scratchpad (`probe057*.mjs`, `probe057-ledger.json`)

## 🔴 Do NOT commit a regenerated endpoint catalogue yet — it LOSES AI Studio rows

Twice today the `knowledge/` post-commit hook ran `plugin/ npm run sync` and rewrote four
generated files in this working tree (`catalog/internal-endpoints{,.source}.json`,
`dist/{server,audit-server}.mjs`), each time marked "M — commit it with your work". Both times I
reverted them rather than let them ride into 0.57.0, because the diff is not additive.

Measured on the second run (999 → 1023 rows): **65 added, 52 removed, 32 of the removals
`/vibe-ai/*`** — the AI Studio surface shipped in 0.56.0. It is not a clean re-key. Of eight
sampled removals only three have a de-prefixed twin (`/vibe-ai/projects/{projectId}` →
`/projects/{projectId}`); the other five — including `GET /vibe-ai/projects`, `GET /vibe-ai/folders`,
`GET /vibe-ai/banners/active` and both DELETEs — have **no replacement row at all**. Only 8
`/vibe-ai/*` rows survive. Committing that would ship an AI Studio catalogue with holes and orphan
every overlay key that addresses those paths.

The wanted rows in the same diff are real (16 snapshot rows from the concurrent snapshot mapping,
plus the forms rows). So this needs a deliberate pass by whoever owns the AI Studio rows — read
every removed row, decide re-key vs loss, fix the extractor or the overlay keys — and it must not
be done as a side effect of a release. Until then: **revert the four generated files whenever the
hook rewrites them**, and cut 0.57.0 from the artefacts already committed at 0.56.1.

Note this also means `npm run release` will regenerate and hit the same diff at step 3. Either fix
the extractor first, or run the release with the catalogue step reviewed by hand.

## Carried in from another session — for the backlog, NOT fixed here

A concurrent build session reports that the compiler maps IR `create_opportunity` to
`internal_create_opportunity`, which is CREATE-ONLY and fails `400 duplicate opportunity` whenever
the contact already has a card — so every create-or-update intent silently no-ops at runtime and
nothing in build, publish or round-trip catches it. They retyped 31 steps by hand to the
user-facing `create_opportunity`. Receipt: that session's client build log, 2026-09-06 (outside this repo).
This is the same reports-success-does-nothing family as the rest of this document and should be
the next item picked up.

## Owed before this is called "fixed"

1. ~~Live-fire on the sandbox~~ — **DONE 2026-09-07**, see the ledger above. Still owed from it:
   the splitter branch was proven STRUCTURALLY (it renders and takes an appended step) but never
   CHOSEN in a real conversation, and the parked-contact count (backlog 23) was not exercised
   against a published workflow — I told the Rail 3 session this probe would never publish, and
   kept to that. Both need a flow bot on a throwaway account.
2. **Release.** `npm run release -- 0.57.0` refuses while `endpoint-overlay.json` is modified and
   uncommitted (another session's forms work). Either that session commits its overlay first, or
   the two are reconciled by hand — do not stash someone else's WIP. The CHANGELOG entry is dated
   2026-09-07; the release script requires the date to be the release day, so bump it if the
   release slips.
3. Backlog 31 (contacts `{"phone": ""}` no-op) is a one-line overlay note, deferred for the same
   reason.

## Not touched, on purpose

- `plugins/uxie-ghl-factory/mcp-internal/catalog/endpoint-overlay.json` (another session's
  uncommitted work) and its `.bak-2026-09-06`.
- `.review3-probe/` (untracked, pre-existing).
- No client identifiers appear in any test or doc added here; the privacy gate ran clean on
  both commits.
