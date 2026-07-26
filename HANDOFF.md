# Handoff — GHL engine/catalog work (as of 2026-07-27, v0.13.0)

Paste the "NEXT SESSION PROMPT" at the bottom into a fresh session.

---

## Where things stand

Both repos clean and pushed. Plugin **0.13.0** (both manifests). Tests: docs-engine **364**,
plugin-engine **351**, mcp **176**, docs-scripts **15** — zero failures. AU account clean
(canary deleted; 49 workflows, back to the pre-canary count).

**This session: the catalog was regenerated from the live marketplace rulebook.**

`GET /workflows-marketplace/location/{loc}/assets?workflowTypes=default,contacts` — the schema
the builder itself validates against — is now `gen-catalog.mjs`'s fifth source.

| | before | after |
|---|---|---|
| step types | 316 | **383** (67 minted, 212 placeholders upgraded) |
| trigger types | 59 | **204** (145 minted) |

New pieces:

- `engine/distill-assets.mjs` (docs repo) — turns a raw ~3.2 MB capture into
  `sniffs/assets/{actions,triggers}.json` + `meta.json`, stripping the per-action
  `locationIds`/`companyIds` allow-lists (they name real accounts; the repo is public) and
  `executionConfig`. `assertNoAccountIds()` throws rather than write a leaky file.
- `engine/rulebook.test.mjs` in **both** repos — the docs copy checks snapshot→catalog
  fidelity, the plugin copy checks the invariants of whatever catalog was copied across.
- `buildTrigger` now throws `TRIGGER_MASTERTYPE` rather than guess (see the next job below).
- `dev/sweep-marketplace-triggers.mjs` — read-only masterType sweep across an account.

### LIVE-PROVEN on AU (`2cac4362-…`, since deleted)

A draft canary built from **four actions that had no catalog entry before this session** —
`bulk_email_verification`, `workflow_ai_extract_data`, `kb_search`, `send_messenger_optin` —
under a **rulebook-minted trigger** (`quiz_submitted`):

- All four render **with their action icons**; every step editor **opens** and shows the
  authored values in the right UI fields (`kb_search`: `query` → "Search query",
  `limit: 3` → "Max results"). That is the exact failure mode `STEP_TYPE_UNKNOWN` exists to
  prevent, and it did not occur.
- `workflow_ai_extract_data` renders as **"#1 AI extract data"** — the step-index badge — and
  the other three do not. That is the builder itself confirming the
  `showStepIndex → premium → top-level stepIndex` derivation.
- The trigger persisted with `masterType: "internal"` on read-back.
- GHL's own panel reads **"Resolve 2 Errors"**, naming `kb_search` / *"Knowledge Bases" is a
  required field* and `send_messenger_optin` / *"Sub text" is a required field* — the same two
  steps, stepIds and message strings the engine predicted **before sending**. The two
  fully-filled steps are clean.
- The **`requiredTriggers` check fired on a real broken case for the first time**
  (`send_messenger_optin` needs `facebook_comment_on_post`/`customer_reply`; the workflow had
  `quiz_submitted`). It was previously unit-tested only.

### `required-fields.mjs` was NOT retired — checked, not assumed

The brief was to retire it if the regen made it redundant. It does not, and the reason is now
in the file's header. Three of the four corrections AGREE with the rulebook — and are still
load-bearing, because a correction carries `confidence: 'verified-live'`, which is what arms
the ATTR_KEY guard for that type. Schema data cannot justify that tier (its field list is
incomplete wherever GHL hides keys behind a DYNAMIC row), so deleting the corrections would
silently disarm the guard on exactly the types it was added for. The fourth
(`conversationai_end`) is still outright needed: `sleepDuration`/`sleepUnit` live behind its
DYNAMIC row and the schema cannot name them.

---

## Design rules the merge follows — do not "simplify" these away

1. **The rulebook never overwrites an attested shape.** For the 240 overlapping types it
   contributes an advisory `schema` block and nothing else. Regeneration is byte-identical on
   all 316 pre-existing steps and 59 triggers apart from that block — verified by diffing the
   before/after catalogs, not by inspection.
2. **Minted entries stay `confidence: 'live-schema'`.** That leaves the ATTR_KEY guard off,
   which is the point — see above.
3. **`schemaFilters`, never `filterRows`.** `expandFilter` reads the bundle-recovered
   `{value,label,id,type}` row shape; the assets rows are `{field,title,fieldType}` and would
   be mis-expanded silently.
4. **`section` is not back-filled on existing entries.** The rulebook's vocabulary
   ("Conversation AI", "Google Contacts") differs from the bundle's lowercase slugs, and
   filling it re-sorted ~20 types into new headings in the capabilities index for no
   behavioural gain. Its value lives on `schema.section`.
5. **A `live-schema` entry that predates the rulebook IS replaced.** Those came from
   `UNIFIED_ACTION_INDEX.tsv`, which contributed a type name and nothing else (empty
   `attrKeys`; `premium`/`usesCustomInputs` hardcoded false). 212 of them.

Predictor accuracy, measured on the 25 types carrying BOTH a verified-live example and a
rulebook entry — re-measure before trusting any new one:

| catalog flag | predictor | agreement |
|---|---|---|
| `isMultipathContainer` | `branchesConfig` present | 25/25 |
| `premium` (top-level stepIndex) | `showStepIndex === true` | 25/25 |
| `usesCustomInputs`, `situational` | `workflowsActionType === 'INTERNAL'` | 23/25 |

`additionalConfig.isPremium` is GHL's BILLING flag and disagrees with the catalog's `premium`
(which means "carries a stepIndex"). Do not conflate them; both are recorded separately.

---

## THE NEXT JOB — settle `masterType` for marketplace triggers

104 of the 145 new triggers are `workflowsTriggerType: INTEGRATION_AI`, and the assets payload
**does not carry `masterType`**. The entire corpus evidence is the INTERNAL half:
`proposal_estimate_update` and `affiliate_new_lead`, both persisted as `"internal"` — and a
read-only sweep of all 49 AU workflows this session found exactly one instance
(`proposal_estimate_update`, `internal`), so that account has no INTEGRATION_AI evidence to read.

The generator therefore assigns `"internal"` to the 43 INTERNAL triggers and **nothing** to the
104 others, marking them `masterTypeUnknown`; `buildTrigger` throws `TRIGGER_MASTERTYPE` unless
the author supplies it. The silent fallback would have been `"highlevel"`, and a wrong
masterType saves cleanly and never fires.

`"app"` appears in some earlier reference pages (`reference/triggers/marketplace/*.md`). It has
**never been corpus-observed** — treat those notes as unverified.

**How to settle it:** add one marketplace trigger through the UI and read what the builder
itself POSTs to `/workflow/{loc}/trigger`. That is definitive. Attempted this session and
abandoned — an overlay intercepted the click on "Add new trigger"; close the error panel and
fit-to-screen first, or drive it from the picker in a fresh workflow. Then delete the
`masterTypeUnknown` branch in `gen-catalog.mjs` and the guard in `buildTrigger`.

---

## Traps that already cost time — do not rediscover these

1. **`gen-catalog.mjs` + `distill-assets.mjs` live in the DOCS repo** and rewrite
   `catalog.data.json` wholesale. Hand-edits there are lost on the next regen. Corrections go
   in `engine/required-fields.mjs`.
2. **The catalog's generated `requiredFields` is marketplace-SCHEMA derived and is NOT the
   emitted shape.** `goto` declares `["placement","targetNodeId"]` but has never emitted
   `placement`. Advisory only.
3. **A capture proves what a key IS, never which keys EXIST.** Build step-example canaries with
   EVERY field populated — a minimal one teaches the generator that omitted fields don't exist,
   and the engine then REJECTS valid authoring.
4. **Skip `field: "DYNAMIC"`** (69 action inputs, plus some trigger filters). Treat `''` and
   `[]` as missing, not just absent keys. Defaults arrive as STRINGS even for checkboxes.
5. **The flow builder URL is `?convTriggerBotId=` — SINGULAR.** Read the error count from
   `#workflow-builder-tab-error-highlight`, NOT from node badges — Vue Flow virtualizes and
   off-screen nodes aren't in the DOM. (Re-confirmed this session; the panel gives step names,
   stepIds and messages.)
6. **`workflowType:"agent"` workflows can't be deleted directly** (403). PUT them back to
   `workflowType:"workflow"`, then DELETE.
7. **`claude mcp add` takes `<name>` BEFORE `-e`** — `-e` is variadic and swallows the name.
8. **The MCP launcher runs the newest INSTALLED plugin build, not your repo.** To live-test
   engine changes, drive the repo's own CLI:
   `GHL_TOK_FILE=… node skills/create-ghl-workflow/scripts/build.mjs <ir.json> <LOC>`.
   That is what proved this session's work; the installed 0.12.0 build would have rejected all
   four new types with `STEP_TYPE_UNKNOWN`.
9. **`import.meta.url === \`file://${process.argv[1]}\`` is broken here** — the repo path
   contains a space, which the URL percent-encodes and argv does not, so a CLI guarded that way
   silently no-ops. Compare `fileURLToPath(import.meta.url) === resolve(process.argv[1])`.
10. **Push needs `gh auth switch -u uxieee`**; the docs repo needs
    `git -c credential.helper='!gh auth git-credential'`.
11. **Bump BOTH manifests** (`.claude-plugin/` + `.codex-plugin/`) — guarded by
    `scripts/check-manifest-parity.mjs` in the pre-commit hook.

---

## Standing rules

- **Live-prove BEFORE commit → push.** Green tests are not proof; "green tests ≠ live
  behaviour" has bitten this project five times. If proof is blocked (no token), STOP at the
  gate — do not push and backfill.
- **Verify novelty too**: grep the docs repo before calling anything a finding, and measure
  before quoting a number.
- Draft-only on live accounts; never publish without explicit approval. Live-fire on GROM AU,
  never a client account.

---

## Smaller open items

- **3 missing step-example captures** (`conversationai_end`, `_continue`,
  `_services_booking`) — still the root cause of the wrong key names, and the only path to
  retiring `required-fields.mjs`. `_continue` is trivial, `_end` needs a canary with `message`
  set, `_services_booking` is BLOCKED (needs an account with commerce services; AU has none).
  See `catalog/corpus-manifest.md`.
- **`send_rcs` / `rcs_interactive_message` carry `disabled: true`** in the rulebook on AU —
  catalogued but not exercisable there. Test on an account with RCS enabled.
- **Trigger-compatibility (`requiredTriggers`) is now live-proven** — remove it from any list
  of unproven checks.
- **The agent→flow link PUT 422s** — the documented body is stale. Not a blocker (the builder
  opens without it) but the recipe needs re-capturing from the UI.
- **Two expired token files** in the `Misc` root (`tok-capture.txt`, `funnels-tokenid.json`),
  world-readable. No live risk; should be deleted.

---

## NEXT SESSION PROMPT

> Settle `masterType` for GHL marketplace (`INTEGRATION_AI`) workflow triggers.
>
> Repo: `/Volumes/Xander SSD/Vibe Code/Misc/ghl-plugin` (plugin, v0.13.0) with its mirror in
> `ghl-workflow-api-docs`. **Read `ghl-plugin/HANDOFF.md` first** — it has the evidence so far,
> eleven traps that already cost time, and the standing rules.
>
> The catalog now knows 204 trigger types, but 104 of them carry `masterTypeUnknown` because
> the assets payload does not state it and the corpus has no instance. `buildTrigger` throws
> `TRIGGER_MASTERTYPE` rather than guess. Add one marketplace trigger through the builder UI on
> AU (`wdzEoUZnXO9tB3PPzcot`) and capture what the builder itself POSTs to
> `/workflow/{loc}/trigger` — that is definitive. Then encode the answer in
> `gen-catalog.mjs::triggerFromRulebook`, drop the guard, and correct the
> `reference/triggers/marketplace/*.md` notes that claim `"app"` without evidence.
>
> **Live-prove before pushing.** Re-authorize with `/uxie-ghl-factory:connect` if the token has
> expired, and remember trap 8: test with the repo's own `scripts/build.mjs`, not the installed
> plugin build.
