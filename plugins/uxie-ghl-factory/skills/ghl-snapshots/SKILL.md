---
name: ghl-snapshots
description: GoHighLevel snapshots — capturing a sub-account's assets into a reusable snapshot, refreshing one, curating what it carries, and checking load conflicts. Use when a task involves creating or updating a snapshot, deciding what an account template should include, asking why a snapshot came out empty or is stuck processing, or planning a rollout onto other sub-accounts. Read it BEFORE calling any /snapshots path by raw_request — two of the write endpoints silently do the wrong thing.
---

# Snapshots

Agency-level captures of a sub-account's assets, used to stamp out new accounts. Corpus:
`knowledge/corpus/platform/20-api/snapshots.md` (the read half) and `snapshots-authoring.md` (the
write half, `proven-live` 2026-09-07, recovered from the `snapshotsApp` remote's public source maps
— 60 request builders in `service/SnapshotsService.ts`).

**Five typed tools now cover the surface** — `list_snapshots`, `get_snapshot_manifest`,
`check_snapshot_conflicts`, `create_snapshot`, `refresh_snapshot` (0.61.0). Prefer them: they carry
the four traps below, which `raw_request` does not. `create_snapshot` validates every id against the
account's own manifest before writing and diffs the stored contents afterwards, and
`refresh_snapshot` refuses to send an empty selection. Everything they do not cover still goes
through `raw_request`, and this skill exists because four of these calls do something other than
what their name suggests.
Snapshots are **agency-scoped**: `?companyId=`, Bearer alone (`token-id` alone answers 401 on
create). A mistake here is not confined to one sub-account.

## The rules that bite

**1. Use the appengine create. Not `/snapshots/create`.**

| | |
|---|---|
| `POST /snapshots-appengine/v2/snapshots` | 200. `selectedAssets` is a strict whitelist. **Use this one.** |
| `POST /snapshots/create` | 201, then hangs in `processing`. A category you omit is captured **whole**, and `exemptClone` is ignored. |

Body: `{name, location_id, company_id, selectedAssets: {category: [ids]}, exemptClone: []}`.

**2. `extras: {}` on a refresh DISCARDS the curation.** `POST /snapshots-appengine/v2/snapshots/{id}/refresh`
takes `{extras: {selectedAssets, exemptClone}}`. Send an empty `extras` and it re-captures the whole
account, silently replacing a carefully curated snapshot with everything. Always re-send the
selection you want kept.

**3. A bad id, a bad category or a mismatched `location_id` gives you 200 and an EMPTY snapshot.**
Nothing is validated and nothing is reported. Build the manifest from the account's own prefetch and
check the ids you are about to send actually appear in it — the 200 will not tell you.

**4. The conflicts endpoint refuses the wizard's own key names.** `POST /snapshots/{id}/conflicts`
wants `{selectedLocationIds, selectedSnapshotAssets}`. The names the UI shows — `locationIds`,
`selectedAssets` — answer `400 ["Required","Required"]`. The call is non-destructive, so it is the
safe way to see what a load would collide with.

**5. Dehydration is asynchronous.** A snapshot reads `processing` for a while, and reading its
contents too early answers `400 "Can't find account data"`. Poll the contents, do not assume.

Also: `assets-status` keys on `assetsStatus` — `assetMappings` is a 400. Names are unvalidated.

## Building the manifest

- `GET /snapshots/assets/asset-names` — the 51 categories.
- `GET /snapshots/v2/preFetchAssets/{locationId}` — **omit `assetType` and one call returns
  everything.** Workflow folders live inside `workflow`; field folders inside `custom_fields`.
- `GET /snapshots/snapshot-ipp-assets/{locationId}` — the IPP asset set.

Then create, poll until it leaves `processing`, and **diff the stored contents against the manifest
you asked for**. That diff is the only thing that catches rule 3.

## Known broken, do not chase

`GET /snapshots/location-assets/{id}/assets-list` → 500. `GET /snapshots/snapshot-versions/{id}/{v}/summary`
→ 500. The v1 `preFetchAssets` → 404. The list endpoint ignores `type=`. The backend host **does**
serve this surface — an earlier 403/404 was a credential artefact, not a host one, and the corpus
row that said otherwise is corrected.

## What does not travel

**A Conversation AI FLOW BOT does not travel**, so a sub-account stamped from a snapshot needs its
flow bot configured by hand. ⚠️ Not because the category is missing — an earlier version of this
line said that and it is wrong. `conversation_ai` IS one of the 51, and an account offers entries
under it (2 on the test sub-account, measured 2026-09-07, alongside 4 `knowledge_bases` and 1
`agent_studio`). That category holds **AI employees**; flow bots never appear in it. Check
`platform/40-rules/snapshot-carry-matrix.md` before promising a rollout carries something — the
matrix is per-asset and several answers are counter-intuitive.

## Out of scope until someone proves them

Never executed, all outward-facing or destructive, none to be run casually on an agency: push /
`set_assets_to_locations` (writes into OTHER sub-accounts), share link, share email, redeem, delete,
retry. A load has never been executed end-to-end either, so the carry matrix is source-derived on
the overwrite question. If the operator asks for one of these, get their explicit word first, do it
on a throwaway account, and write the result into the corpus.
