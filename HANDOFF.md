# Handoff — GHL engine/catalog work (as of 2026-07-27, v0.12.0)

Paste the "NEXT SESSION PROMPT" at the bottom into a fresh session.

---

## Where things stand

Both repos clean and pushed. Plugin **0.12.0** installed. Tests: engine **343**, mcp **176**,
docs-mirror **352** — zero failures. AU account clean (all canaries deleted).

**What got fixed this session** (all live-proven on AU, not just unit-tested):

- The engine reported success on workflows GHL refused to publish. Seven of nine
  `conversationai_*` node types were silently missing required fields. Now defaulted or
  hard-errored. **Verified visually**: the builder's own panel reads
  *"0 Errors — Zero errors, you are all good to go"* on a minimal-attribute build that
  previously showed *"Resolve 7 Errors"*.
- `conversationai_end`'s documented keys were ALL wrong
  (`customMessage`/`reactivate`/`duration` → really `message`/`sleepEnabled`/`sleepDuration`/
  `sleepUnit`). `transfer_bot.prompt` and `continue.prompt` never existed. Fixed in the
  engine, the generated capabilities index, and the ai-agents-specialist skill.
- `verify` asserted persistence only — it now asserts the required-field set.
- `raw_request` double-encoded any string body (blocked every non-GET escape-hatch call).
- A 403 business refusal reported as `TOKEN_EXPIRED` → now `ACCESS_DENIED`.
- Edit ops now name a wrong argument key instead of dying on `.kind`.
- NEW `check_workflow` MCP tool + validation against GHL's own action schema.

---

## THE NEXT JOB — regenerate the catalog from the live rulebook

`GET /workflows-marketplace/location/{loc}/assets?workflowTypes=default,contacts` is the
schema the builder itself validates against. It is **not** a new discovery
(`DISCOVERIES §12`, 2026-05-17) but it was only ever harvested once into static pages.
It has since grown **243→307 actions** and **31→147 triggers**.

Measured gap vs `engine/catalog.data.json` on 2026-07-27:

| | engine | rulebook | overlap | rulebook-only |
|---|---|---|---|---|
| actions | 316 | 307 | 240 | **67** |
| triggers | 59 | 147 | **2** | **145** |

Native actions the engine cannot build at all: `workflow_ai_extract_data` (premium),
`kb_search`, `send_rcs`, `rcs_interactive_message`, `bulk_email_verification`.
Missing triggers include `quiz_submitted`, `reputation_review_received`,
`funnel_website_pageview`, `user_replied`, `whatsapp_referral`, `service_booking`,
`affiliate_sales`.

**Why the trigger overlap is 2 and not a bug:** the engine's triggers are the OG/native set
(`contact_tag`, `contact_created`, …) which live in the JS bundle; the rulebook carries the
marketplace/newer set. Neither source is complete alone — a regenerated catalog must MERGE
both, and the bundle stays required for the OG primitives.

Read before starting: `docs/03-endpoints.md §5.1` in ghl-workflow-api-docs (the full
contract, the gap audit, and the exact error-list reproduction).

---

## Traps that already cost time — do not rediscover these

1. **`gen-catalog.mjs` lives in the DOCS repo and rewrites `catalog.data.json` wholesale.**
   Hand-edits to that file are lost on the next regen. Corrections currently live in
   `engine/required-fields.mjs` (see its "HOW TO RETIRE THIS FILE" block).
2. **The catalog's generated `requiredFields` is marketplace-SCHEMA derived and is NOT the
   emitted shape.** `goto` declares `["placement","targetNodeId"]` but has never emitted
   `placement`. Do not enforce it.
3. **A capture proves what a key IS, never which keys EXIST.** Building a step-example from a
   minimal canary teaches the generator that omitted fields don't exist → the engine then
   REJECTS valid authoring. Capture with EVERY field populated.
4. **Skip `field: "DYNAMIC"`** in the rulebook (UI-only pseudo-field, 72 definitions).
   Treat `''` and `[]` as missing, not just absent keys. Defaults arrive as STRINGS even for
   checkboxes.
5. **The flow builder URL is `/automation/workflow/{wid}?convTriggerBotId={anyFlowBotId}` —
   SINGULAR.** The plural renders an empty page. Read the error count from the panel
   (`#workflow-builder-tab-error-highlight`), NOT from node badges — Vue Flow virtualizes and
   off-screen nodes aren't in the DOM.
6. **`workflowType:"agent"` workflows can't be deleted directly** (403) and are invisible in
   the UI list. PUT them back to `workflowType:"workflow"`, then DELETE.
7. **`claude mcp add` takes `<name>` BEFORE `-e`** — `-e` is variadic and swallows the name.
8. **The launcher runs the newest INSTALLED plugin build, not your repo.** After
   `npm run build`, either `claude plugin update` or point at the repo's `dist/server.mjs`,
   or you will test the old code.
9. **Push needs `gh auth switch -u uxieee`**; the docs repo needs
   `git -c credential.helper='!gh auth git-credential'`.
10. **Bump BOTH manifests** (`.claude-plugin/` + `.codex-plugin/`) — `claude plugin update`
    compares VERSION NUMBERS, so a fix without a bump is invisible.

---

## Standing rules

- **Live-prove BEFORE implement → commit → push.** Green tests are not proof; "green tests ≠
  live behaviour" has bitten this project five times. If proof is blocked (no token), STOP at
  the gate — do not push and backfill.
- **Verify novelty too**: grep the docs repo before calling anything a finding, and measure
  before quoting a number.
- Draft-only on live accounts; never publish without explicit approval. Live-fire on GROM AU,
  never a client account.

---

## Smaller open items

- **3 missing step-example captures** (`conversationai_end`, `_continue`,
  `_services_booking`) — the root cause of the wrong key names. `_continue` is trivial,
  `_end` needs a canary with `message` set, `_services_booking` is BLOCKED (needs an account
  with commerce services; AU has none). See `catalog/corpus-manifest.md`.
- **The agent→flow link PUT 422s** — the documented body is stale. Not a blocker (the builder
  opens without it) but the recipe needs re-capturing from the UI.
- **Trigger-compatibility check** (`requiredTriggers`) is built and unit-tested but has never
  fired on a real broken case — treat as unproven.
- **Two expired token files** in the `Misc` root (`tok-capture.txt`, `funnels-tokenid.json`),
  world-readable. No live risk; should be deleted.

---

## NEXT SESSION PROMPT

> Regenerate the GHL engine catalog from the live marketplace rulebook.
>
> Repo: `/Volumes/Xander SSD/Vibe Code/Misc/ghl-plugin` (plugin, v0.12.0) with its mirror in
> `ghl-workflow-api-docs`. **Read `ghl-plugin/HANDOFF.md` first** — it has the measured gap,
> ten traps that already cost time, and the standing rules.
>
> Goal: `engine/catalog.data.json` currently has no entry for **67 actions and 145 triggers**
> GHL offers today, and it is regenerated wholesale by `gen-catalog.mjs` in the docs repo.
> Merge the live assets endpoint in as a source alongside the bundle/corpus — the bundle is
> still required for the OG primitives (`add_contact_tag`, `send_email`, `sms`, `if_else`,
> `wait`, `custom_webhook`, …) which the rulebook omits entirely.
>
> Then retire `engine/required-fields.mjs` if the regenerated catalog makes it redundant —
> `required-fields.test.mjs` fails by design when that happens and names the entries to
> delete.
>
> **Live-prove before pushing** (`/uxie-ghl-factory:connect` on AU `wdzEoUZnXO9tB3PPzcot`),
> and check `docs/03-endpoints.md §5.1` for the endpoint contract before writing code.
