# 2026-09-06 rail findings → engine fixes — receipt

**Date:** 2026-09-07 · **Branch:** `engine/rail-findings-2026-09-06` (two commits on top of `main`
at 0.56.1, NOT pushed) · **Input:** the 32-item engine backlog compiled from the four booking
rails (three client sub-accounts and the GROM Sandbox; 28 Aug to 6 Sep 2026) · **Proof
level:** unit and tool-level tests against fixtures that reproduce the live evidence; **no
live-fire yet** — the live differential on the sandbox is owed before the "fixed" claims below are
promoted to `proof: live-runtime`.

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

## Owed before this is called "fixed"

1. **Live-fire on the sandbox** (`rW9hsvyrwCgaaySWzn6B`), by differential, one probe workflow:
   `modifyTrigger` with the wrong shape → refused, nothing written (export unchanged);
   `modifyTrigger` with `trigger.conditions` → read back changed AND `date_updated` moved;
   a NOOP → no PUT (date_updated unmoved on purpose); a `moveStep` → PUT accepted (was
   `INVALID_STRUCTURE`); `addBranch` on a splitter → renders in the builder and the branch is
   chosen in a chat; an over-cap value → refused, then hatched; `update_convai_agent` on an agent
   with `workingHours: null` → 200.
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
