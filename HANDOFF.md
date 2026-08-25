# Handoff — GHL engine/catalog work (as of 2026-07-27, v0.14.0)

Paste the "NEXT SESSION PROMPT" at the bottom into a fresh session.

---

## Where things stand

Both repos clean and pushed. Plugin **0.14.0** (both manifests). Tests: docs-engine **364**,
plugin-engine **351**, mcp **176**, docs-scripts **15** — zero failures. AU account clean
(all three canaries + their auto-created tag deleted; 49 workflows, back to the pre-canary count).

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
- `buildTrigger` emits the marketplace trigger envelope (`masterType` + `workflowsTriggerType`)
  captured from the builder itself — see the masterType section below.
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

## masterType — SETTLED 2026-07-27 (was the next job; now done)

The assets payload does not carry `masterType`, and it is the field that decides whether a
trigger ever fires. Settled by adding a Calendly trigger through the builder UI on AU and
reading the request the builder itself sent:

```jsonc
// POST /workflow/{loc}/trigger  — the builder's own body
{ "type": "lc_calendly_new_routing_form_submission",
  "masterType": "internal",                  // ← for an INTEGRATION_AI trigger
  "workflowsTriggerType": "INTEGRATION_AI",  // ← the builder sends this too
  "conditions": [], "actions": [{ "workflow_id": "<wid>", "type": "add_to_workflow" }], … }
```

**Both flavours use `"internal"`.** `"app"` — asserted by 102 `reference/triggers/marketplace/*.md`
pages and the marketplace README — was never corpus-observed and is WRONG; all of them are
corrected. GHL persists both fields (read back off the stored document), so `gen-catalog.mjs`
records both and `buildTrigger` emits `workflowsTriggerType` wherever the catalog has one —
never inventing it for OG triggers, which keep `"highlevel"`.

Consequences: `masterTypeUnknown` and the `TRIGGER_MASTERTYPE` guard are **gone**. All 145
rulebook triggers now build without the author supplying anything.

**Proof:** the same trigger type was then built by the ENGINE into a second workflow, and the
two persisted trigger documents were diffed field by field — **identical on all 11 fields**
(type, masterType, workflowsTriggerType, name, conditions, actions, active, belongs_to,
schedule_config, location_id, deleted). Both canaries and the auto-created tag deleted.

How it was captured, for next time: the picker's marketplace triggers mostly need an OAuth
connection, and a trigger with a REQUIRED filter cannot be saved without one (its option list
404s/400s, and the panel refuses with "Oops! Looks like you've missed out on some fields").
Pick one with **no required filters** — `sniffs/assets/triggers.json` has 35 such
INTEGRATION_AI triggers; `lc_calendly_new_routing_form_submission` worked. Also: "Save trigger"
in the panel only commits to LOCAL state — the POST does not fire until you press the
workflow's own **Save** button (top right, which flips from a disabled "Saved" to an enabled
"Save" with a red dot).

---

## THE NEXT JOB — capture the 3 missing step-examples and retire `required-fields.mjs`

That overlay is the last hand-maintained patch over the generated catalog. It cannot be
deleted from evidence we have; it needs real captures. `catalog/step-examples/` has none for:

    conversationai_end               needs a canary with `message` ALSO set
    conversationai_continue          trivial — just `instructions`
    conversationai_services_booking  BLOCKED on AU (needs configured commerce services)
    conversationai_transfer_bot      capture exists only in a research doc, not step-examples/

⚠️ **Build each canary with EVERY field populated, not just the required ones.** A minimal
canary teaches gen-catalog that the omitted fields DO NOT EXIST, and the engine then REJECTS
valid authoring — strictly worse than the wrong names being patched today. Then export,
anonymise ids to `<uuid-00N>`, save as `catalog/step-examples/<type>.json` (full node
envelope, matching `conversationai_ai_message.json`), re-run `gen-catalog.mjs`, copy the
catalog across, and run the suite: `required-fields.test.mjs` FAILS BY DESIGN on each
correction that has become redundant and names it for deletion.

Do all four in one pass on an account that HAS commerce services and the file goes away
entirely. Behaviour is identical either way — this is housekeeping, not a fix.

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
- **Marketplace triggers still need their upstream OAuth connection to FIRE.** The trigger
  document saves and round-trips without one; that is not proof of runtime delivery.
- **The agent→flow link PUT 422s** — the documented body is stale. Not a blocker (the builder
  opens without it) but the recipe needs re-capturing from the UI.
- **Two expired token files** in the `Misc` root (`tok-capture.txt`, `funnels-tokenid.json`),
  world-readable. No live risk; should be deleted.

---

## NEXT SESSION PROMPT

> Capture the missing `conversationai_*` step-examples and retire `engine/required-fields.mjs`.
>
> Repo: `/Volumes/Xander SSD/Vibe Code/Misc/gohighlevel/plugin` (plugin, v0.14.0) with its mirror in
> `ghl-workflow-api-docs`. **Read `ghl-plugin/HANDOFF.md` first** — it has the retirement
> procedure, eleven traps that already cost time, and the standing rules.
>
> `catalog/step-examples/` has no capture for `conversationai_end`, `_continue`,
> `_services_booking` or `_transfer_bot`, which is why four hand-written corrections still sit
> over the generated catalog. Build one canary per type in the flow builder with EVERY field
> populated (a minimal canary is worse than the bug — see the trap in HANDOFF), export,
> anonymise, drop into `catalog/step-examples/`, regenerate, and delete whatever
> `required-fields.test.mjs` then names as redundant.
>
> `_services_booking` needs an account with configured commerce services — AU has none, so do
> that one on a client account or leave it and say so.
>
> **Live-prove before pushing.** Re-authorize with `/uxie-ghl-factory:internal-connect` if the token has
> expired, and remember trap 8: test with the repo's own `scripts/build.mjs`, not the installed
> plugin build.
