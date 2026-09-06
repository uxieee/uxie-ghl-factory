# 0.58.0 — the plugin improvement programme, 2026-09-07

Seven workstreams planned in `docs/superpowers/plans/2026-09-07-plugin-improvement-plan.md` after
four read-only recon passes. W0–W6 are done; W7 is the standing owed-proof list and stays open.

## What shipped

| | |
|---|---|
| catalogue rows | 1011 → 1072 |
| rows a typed tool covers | 168 → 177 |
| rows never proven reachable | 936 → 804 |
| MCP tools | 66 → 71 |
| skills | 17 → 19 |
| step types round-trip verify checks | 8 → 57 |
| tests | 1123 → 1132 green |

## Live-fire, all on GROM Sandbox, every write read back on a separate request

**Opportunity upsert** — draft `8b9f2159-7cac-4f85-a0ed-e164cca5173b`. Every emitted key stored
verbatim, `monetary_value` as the string `"180"`, `allow_backward: true` persisted, asset pre-flight
0 errors 0 warnings, and `internal_create_opportunity` kept its `__customInputFields__` shape in the
same workflow.

**Forms rail** — 13 of 13 assertions, form `AhqijQSeEcorOhXiFxlj` left in place. The one that
justifies the tool: after a `formAction`-only edit, `fields` still held three elements and `style`
was still there, where a raw write would have deleted both. Also proven: the confirm gate refuses,
an untagged element is refused before any write, the preview names its preserved keys, the server's
key rename lands as `redirectUrl`, and an unknown id becomes a named refusal rather than a bare 400.

**Reach sweep** — 302 reads executed, 148 answered, 9 refused, 145 inconclusive. Two of the nine
refusals independently reproduce a hand-curated overlay entry from 2026-08-25.

## Defects the work found in itself

Worth more than the features, because each is a class this repo keeps paying for.

1. **Three endpoints shipped twice.** `normalize()` stripped parameter names but not query strings,
   so the six capabilities that declare query switches matched no row: each lost its `coveredBy` on
   the real row and was adopted again as a duplicate. An agent reading the source-only twin was told
   nothing covered a path a shipped tool calls every run.
2. **A 401/403 is not automatically a refusal.** GHL answers "LocationId is required" and "No Product
   id found" with a 403. Four of the first ten refusals were that. `refused` costs −60 in ranking, so
   recording them would have hidden four reachable endpoints because the probe had not sent a
   parameter.
3. **A wrong verdict could make itself permanent.** The probe skipped rows already marked `refused`,
   and it now writes the reach the catalogue reads — so run one's mistakes were invisible to run two.
4. **Two tests were vacuously passing** over an object that does not exist (`catalog.steps`; the
   accessors are `allSteps()` and `step(type)`).
5. **`scripts/build.mjs` crashed on every run** — `pathToFileURL` used, never imported. The skill's
   canonical build entry. Found by using it.
6. **The artefact lied about itself.** The probe result claimed no account id was recorded while GHL
   echoed ids back inside its own error text. `sniffs/` may hold real ids; a note that says otherwise
   is worse than the ids.
7. **A base line dragged an endpoint onto the wrong host.** Stating a services base on the forms
   recipe moved `GET /locations/{locationId}/customFields/{id}` with it. Reverted; the guard caught
   it as a removal.

## Left open, deliberately

- **The opportunity runtime differential.** One contact enrolled twice, the upsert moving the
  existing card where the strict step answers 400. Needs a published workflow.
- **Tier two of the required-field mining.** 62 `get_hasErrors` getters in the recovered builder
  source hold the drawer's red-badge rules; about a third are flat field checks a script could lift,
  the rest delegate to named predicates and need per-type capture.
- **Memberships sidecar.** Its ledger is prose with abbreviated paths and no hosts, and
  reconstructing it would re-key 26 rows onto a host the corpus says must be settled by
  DIFFERENTIAL, not inference. Blocked on evidence, not effort: the sandbox has no courses, so the
  probe cannot reach those rows.
- **Eight forms endpoints still ship twice**, once per host, because the 40-rules and 10-anatomy
  pages state no base. One canonical-spelling decision by the surface owner collapses them and lets
  the plugin drop its `/forms/` host-disagreement exemption.
- **Snapshot typed tools.** The skill ships; the tools do not. That surface is agency-scoped, so its
  create writes at the agency level and deserves its own session.
- **The five UNCATALOGUED skill claims** the new lint records: each is either a wrong skill line or a
  corpus page we owe.

## Artifacts left in place, named

- Sandbox draft workflow `8b9f2159-7cac-4f85-a0ed-e164cca5173b` (TEST-CAP-opportunity-upsert).
- Sandbox form `AhqijQSeEcorOhXiFxlj` (TEST-CAP-forms-rail). It is LIVE at its widget URL, as every
  form is; it carries nothing but two standard fields and a submit button.
- `knowledge/sniffs/endpoint-ledger-result.json` and `knowledge/catalog/endpoint-reach.json`.
- `knowledge/sniffs/drift-watch.log` (gitignored) from the first run of the drift watch.

## Not touched, on purpose

`plugins/uxie-ghl-factory/mcp-internal/catalog/endpoint-overlay.json.bak-2026-09-06` and
`.review3-probe/`, both another session's untracked files.

## The one thing to do next

The drift watch is written and validated but **not installed** — a LaunchAgent is a persistent job
on the machine and that is a person's decision:

```
cp knowledge/sniffs/com.uxieee.ghl-drift.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.uxieee.ghl-drift.plist
```

Its first run already reports drift: the workflow builder's entry chunk has rotated away from the
capture every step shape, validator and enforcement rule was mined from, and 54 federated apps have
moved since the 2026-08-29 pin.
