# Editing an existing workflow

The edit ops and their traps: retyping a step (including native → marketplace), inserting
before the first step, the dead-branch guard, adding multipath containers, and editing triggers
on a workflow that already exists.

Read `SKILL.md` first — the gates and the one rule live there, not here.

## Editing an existing workflow (not a fresh create)

`scripts/build.mjs` is CREATE-only. To ADD/insert/delete/modify/move steps or branches
on a workflow that already exists, use the edit CLI:

```
node scripts/edit.mjs <LOC> <WID> <edit-spec.json> [--assume-associated] [--allow-dangling-parentkeys] [--ack-dead-branch] [--dry-run]
```

It GETs the live workflow, applies the ops to `workflowData.templates`, and commits via
the **plain `PUT /workflow/{loc}/{wid}`** (NOT `/auto-save` — that 422s on an existing
workflow). `--dry-run` computes + prints the diff without sending the PUT. The edit-spec is
`{ "ops": [ … ] }` applied in order; ops: `appendStep`, `insertAfter`, `appendToBranch`
(anchor by `branchEntryId`, by `containerId` + `branch` — display name, `__branchKey__`, or id —
or by `branchRef`, a branch `ref` authored earlier in the same call),
`insertBefore`
(each takes a `step: {type,name,attributes}` compiled from IR — a linear step **or a
container**, see "Adding containers" below), `deleteStep`,
`modifyStep` (`attrPatch` for `attributes`, plus an optional `stepPatch` for TOP-LEVEL
fields — **a raw shallow merge onto the stored step: it runs no builder, no UI defaults and no
compile-time lint**, so a wait window patched without `days`, a notification patched with a flat
`notificationType`, or an opportunity patched with a stage NAME is written as given; the commit
refuses the name case (`UNRESOLVED_NAME`) and GHL's own guard rules, nothing else — prefer
`retypeStep`, which replaces the whole attribute set through the compiler), `renameStep` (`{stepId,name}`), `retypeStep` (`{stepId,step}` — change what a step
IS, see "Retyping a step" below), `moveStep`, `addBranch`
(`{containerId,name,conditions}`),
`deleteContainer`, `setStepDisabled` (`{stepId,disabled}`), and `disableStepsByType`
(`{type,disabled}`) — plus the trigger ops `addTrigger` / `modifyTrigger` / `deleteTrigger`
(see "Editing TRIGGERS" below), and **`updateSettings`** (`{settings:{…}}` — the Settings tab's
keys, merged over the stored values and validated by the same contract as `settings:` in a
build: `window`, `timezone`, `stopOnResponse`, `senderAddress`, `workflowNote`, `statsView`…;
a settings-only edit still commits with one PUT). Also `addStepNote` (`{stepId,text}` — the node's Notes popover; lands in `comments[]` newest-first) and `duplicateStep` (`{stepId, afterId?}` — "Copy action" → "Copy here": fresh-id copy after the source, notes not copied, disabled state travels; containers/goals/loops/gotos refused). Trigger side: `duplicateTrigger` (`{triggerId|name, newName?}` — "Copy Trigger": the stored trigger re-posted as "… (Copy)", matching the target workflow's own published/draft state (see "Editing TRIGGERS" below); webhook copies get a fresh `predeterminedId`). Find & Replace, tag mode: `replaceTag` (`{oldTag,newTag,triggers?}` — exact swap in tag arrays and tags-subtype if/else conditions, string replace in `customTags`, plus one PUT per trigger carrying the tag; the UI's text mode has no replace, so there is no text op). The disable operations use GHL's native top-level
`advanceCanvasMeta.isDisabled` flag, preserve the full step config, and commit only changed
step IDs in `modifiedSteps`. Example — add an SMS, delete a step, and natively pause all
internal notifications:

```json
{ "ops": [
  { "op": "insertAfter", "afterId": "abc", "step": { "type": "sms", "name": "Nudge", "attributes": { "body": "Still there?" } } },
  { "op": "deleteStep", "stepId": "xyz" },
  { "op": "disableStepsByType", "type": "internal_notification", "disabled": true }
] }
```

A step's `name` is a **sibling of `attributes`**, not a member of it, so `attrPatch` alone
can never rename anything — that is what `renameStep` (and `modifyStep`'s `stepPatch`) is
for. Re-pointing a step without fixing its label leaves a name that actively lies to the
next reader: an "Update opportunity, Signed Won" whose stage and status have both been
changed is worse than a generic name. Both doors refuse the GRAPH fields (`id`, `type`,
`parent`, `parentKey`, `next`, `order`) — those have dedicated ops that keep the graph
consistent. A rename needs no transport work: the commit sends whole templates, so the
step round-trips like any other modification (live-proven on the UK account 2026-07-31 —
version 14→15, 8 steps intact, `fileUrl` preserved, attributes byte-identical, the
workflow stayed published).

```json
{ "ops": [
  { "op": "modifyStep", "stepId": "abc", "attrPatch": { "stageId": "…", "status": "lost" },
    "stepPatch": { "name": "Update opportunity, Lost" } },
  { "op": "renameStep", "stepId": "xyz", "name": "Tag: nurture exhausted" },
  { "op": "updateSettings", "settings": { "stopOnResponse": true, "window": { "start": "09:00", "end": "18:00", "days": [1,2,3,4,5] } } }
] }
```

### Retyping a step (including native → marketplace)

`retypeStep` changes what an EXISTING step is, in place, without touching the graph:

```json
{ "ops": [
  { "op": "retypeStep", "stepId": "0a711d75-…",
    "step": { "kind": "action", "marketplace": true, "type": "send_outbound_whatsapp_message",
      "name": "Thanks for coming in",
      "attributes": { "message": "Hi {{contact.first_name}}, …", "attachment": "",
        "connected_phone": "", "__dynamicAttachments__": {}, "__customInputs__": {} } } }
] }
```

The step's `id`, `order`, `next`, `parent` and `parentKey` are preserved **byte-for-byte** —
that is the whole safety argument, and the op fails closed if any of them moves. No
delete-and-reinsert, no rewiring, so anything mid-flight walks the identical path after the
edit. It is a separate op rather than a `type` hole in `modifyStep` because a retype
**requires** a full `attributes` replacement, and only a dedicated op can enforce that.

`attributes` are **REPLACED, never merged.** A merge would strand the old type's keys under
the new one — converting an `sms` to a WhatsApp marketplace action with a merge leaves a
stale `body` sitting beside the new `message`. The same rule applies to the step's TOP
level: a structural field the old type carried and the new one does not
(`workflowsActionType`, a native `stepIndex`) is dropped. The one carry-over is
`advanceCanvasMeta` — a disabled step must not silently switch itself back on.

Retyping a CONTAINER is refused: its `next` is a branch array, and no retype can carry a
branch set across types. Delete it and splice a new one in.

**Marketplace steps work on the edit path**, with the same guards the build path applies
(install check, required inputs, envelope keys) — `references/marketplace-steps.md` has the
authoring contract. The per-location marketplace index is fetched only when an op actually
carries `marketplace: true`, so a native edit issues exactly the requests it always has.
The engine renumbers `stepIndex` per action key across the whole workflow and writes
`meta.stepIndexCounter` as a high-water mark; the builder renders that as the canvas `#N`
prefix, which is the cheap visual proof the metadata took. Live-proven 2026-08-18 on a
draft workflow in a real AU clinic account with the goghl.ai app installed: 2 `sms` steps →
2 `send_outbound_whatsapp_message`, version 1→2, 10 steps unchanged, all five graph fields
byte-identical across every step, `#1`/`#2` rendered on the canvas, and the step editor
opened as "Send Whatsapp Message" with the body intact and the merge field still a live
chip.

For a newly compiled workflow, put `disabled: true` directly on any IR step node. This
emits the same native flag; false/absent means enabled. See
`references/step-shapes.md#disabling-steps-native-pause` for the live-proven shape and
the ruled-out notification-recipient workarounds.

Adding an `internal_update_opportunity` this way triggers the `OPP_UNASSOCIATED` guard
(pass `--assume-associated` only if ALL the workflow's triggers are opportunity-based).
Pure core: `engine/edit-driver.mjs` + `engine/edit.mjs` (see their tests).

### Putting a step FIRST (`insertBefore`)

Every other add op needs an anchor to sit *after*, so nothing could become step 1 of an
existing workflow — adding a gate in front of a published workflow meant rebuilding it by
hand in the UI. `insertBefore` closes that:

```json
{ "ops": [
  { "op": "insertBefore", "beforeId": "<head-step-id>",
    "step": { "kind": "if_else", "type": "if_else", "name": "Eligible?",
              "branches": [ { "ref": "y", "name": "Eligible", "conditions": [ … ], "then": [] },
                            { "ref": "n", "name": "None", "else": true, "then": [] } ] },
    "attachTailTo": "Eligible" }
] }
```

Two cases behind one op:
- **Mid-chain** — exactly `insertAfter(predecessor)`, so it inherits every guard that path
  has. One code path, not two.
- **On the head** — a true prepend. For a plain step the old head just re-parents. For a
  **container**, the *entire existing workflow* becomes the displaced tail and must be
  re-scoped onto one branch, so `attachTailTo` is **required and never guessed** — this is
  the `insertAfter` trap at maximum stakes, since the wrong branch reroutes 100% of the
  workflow's traffic rather than some suffix of it.

Inserting before a **branch entry** is refused: a container's `next[]` is structural branch
wiring, not a chain, so nothing can be spliced in front of it. Use `appendToBranch` to add
steps inside the branch.

### The dead-branch guard (`DEAD_BRANCH`)

`editCommitBody` fails closed when this edit splices in a container that sends the
displaced chain down one branch while a **sibling terminates immediately at END**. Live
near-miss this exists for: an `if_else` inserted into a release workflow put the whole
existing chain on one branch and pointed the other straight at END — so the normal path
would never release anything. Nothing in the diff shows it (the branch is simply empty);
it is only visible by opening the canvas.

The guard cannot know which branch is semantically "normal" and does not try — it names the
branch that took the chain and the one going to END, and makes you confirm. Pass
`--ack-dead-branch` (`deadBranchAcknowledged: true`) once you have read it.

Deliberately narrow, so it stays worth heeding: it never fires on a fresh build, on a
container appended at a tail (empty branches are the expected starting state), on a legacy
workflow's own asymmetric branches, or when the chain landed on a **predefined**
`__branchKey__` branch — `find_opportunity`'s Not-Found sibling dead-ending is idiomatic,
not a near-miss, and firing there would train you to pass the override reflexively.

### Adding containers (multipath) to an existing workflow

`appendStep` / `insertAfter` / `appendToBranch` / `insertBefore` each accept a **container** — a
`find_opportunity` with `onFound`/`onNotFound`, an `if_else`, a `workflow_split`, a
multipath wait. The step compiles to a whole subgraph (entry + branch entries + their
children) via the same `compile()` that `build.mjs` runs, so an edit-inserted container is
structurally identical to a freshly built one (`engine/edit-multipath.test.mjs` asserts
that round-trip).

This is what lets **opportunity logic be added to an existing workflow**. Any opportunity
write needs a `find_opportunity` above it — otherwise it skips at runtime with *"Please use
Opportunity trigger/find opportunity action to get the opportunity"*. Before this, the only
way to get one was to build a new satellite workflow; that constraint shaped several live
accounts into 07b/07c/07d micro-workflow chains. It no longer applies.

```json
{ "ops": [
  { "op": "insertAfter", "afterId": "abc",
    "step": { "type": "find_opportunity", "name": "Find Opportunity",
              "find": { "filters": [{ "field": "pipeline_id", "value": "PIPE" }], "sorting": "latest" },
              "onFound": [], "onNotFound": [] },
    "attachTailTo": "predefined_Opportunity Found" }
] }
```

**`attachTailTo` is required** on `insertAfter` when a container lands mid-chain and has
more than one branch. A container is terminal in its scope, so the steps that followed the
anchor are **re-scoped onto one branch** — pointers only, nothing is copied. Name the
branch by display name (`"Opportunity Found"`), stable branch key
(`"predefined_Opportunity Found"` — survives a rename), or branch id. It is never guessed:
on `find_opportunity` the tail belongs on Found ~always, and "~always" is exactly the
default that silently reroutes live contacts in the exception case. It's unnecessary when
nothing follows the anchor, or when the container has a single branch.

A container is terminal in its scope, so `insertAfter <containerId>` and `appendStep` onto
a container tail are both refused — append to one of its **branches** instead.

**Live-proven 2026-07-17** on GROM AU (throwaway canaries, since deleted, account verified
clean). A linear `Head → Tail` workflow, then one `insertAfter` op splicing in a
`find_opportunity` with `attachTailTo: "predefined_Opportunity Found"`:

- commit `PUT 200`; GET back shows `Head → find_opportunity → [Found, Not Found]`, with the
  pre-existing Tail step **re-scoped onto Found** (same id, `parent` = the Found
  transition) and Not Found left null. No duplicate ids.
- **`PUT status:'published'` → 200, status `published`** — GHL's publish validator accepts
  the spliced graph, and the container survives it with both branches. (This is the gate
  that once rejected a duplicated-subtree graph with a misleading "Wait for reply doesn't
  reference the step".)
- **The builder renders it and the step editor OPENS** — all five nodes draw, both branch
  labels draw, and the `find_opportunity` editor shows its Pipeline resolved to the real
  account pipeline. (Not the `internal_notification` "saves but won't open" class.)
- **Round-trip proven against a live fresh build**: the same shape built by `build.mjs` in
  one pass, fetched back, is **content-identical** to the edit-produced one (ids
  normalised; only object key ORDER differs, a serialisation artifact GHL round-trips
  either way).

NOT yet proven: runtime execution down the Found branch (needs a real opportunity on the
pipeline to enroll). The structure, the validator, and the builder are proven; the runtime
path of the container's branches is not.

**Nested containers carry `parent` (live-settled 2026-07-17).** A container nested inside
another container's branch sets `parent` = its scope owner (the branch-entry / transition
id). This engine used to omit it on `if_else` only — the one container type of eight that
did — so engine-built nested `if_else` nodes lacked it while every UI-built one had it.
Harvested from UI-built workflows: 6/6 nested condition-nodes had `parent === scope owner`.
Fixed in v0.3.9 and live-proven (build → GHL persists `parent` → publish 200 → the builder
renders the nested `if_else` inside the Found branch with its own branches and a separate
"When none of the conditions are met" node). Pre-v0.3.9 engine-built workflows with a
nested `if_else` are missing the field; they appear to run, so this is a fidelity fix, not
a known runtime break — leave existing ones alone unless a runtime symptom points here.

### Editing TRIGGERS on an existing workflow

Triggers live in a **separate document** from `workflowData.templates`, with their own CRUD
endpoints — so trigger ops are partitioned out and applied *after* the step commit, never
through the templates diff. Never hand-roll a trigger POST; these ops reuse the same
corpus-traced `buildTrigger` the create path uses:

```json
{ "ops": [
  { "op": "addTrigger", "trigger": { "type": "contact_tag", "name": "Course purchased",
      "filters": [ { "field": "tagsAdded", "value": "course-purchased" } ] } },
  { "op": "modifyTrigger", "name": "VIP added", "trigger": { "filters": [ { "field": "tagsAdded", "value": "gold" } ] } },
  { "op": "deleteTrigger", "triggerId": "abc" }
] }
```

`deleteTrigger`/`modifyTrigger` take a `triggerId`, or a `name`/`type` matched against the
live trigger list — an ambiguous match is a hard error, never a silent pick. `modifyTrigger`
PUTs the full merged object (unspecified fields carry over from the live trigger).

Two things the engine handles that a hand-rolled POST gets wrong:

- **The full envelope is load-bearing.** A lean body (just type/name/conditions) saves and
  returns a believable `200 {id}` but never attaches. `buildTrigger` always sends
  `status/workflowId/schedule_config/conditions/type/masterType/name/actions/active/`
  `triggersChanged/location_id/company_age`. Root `workflowId` is **camelCase**;
  `location_id`/`company_age`/`actions[].workflow_id` are **snake_case** — sending the root
  as `workflow_id` also 200s and also silently doesn't persist.
- **A trigger's `active` is a read-only PROJECTION of its own `status` field** (`"draft"` |
  `"published"`) — `active === (status !== "draft")` (measured 2026-08-28, throwaway
  workflows on the designated test sub-account). `addTrigger`/`duplicateTrigger` send
  `status` matching the **target workflow's own status**: on an already-**published**
  workflow the new/duplicated trigger lands **active immediately**, no separate publish
  needed; on a **draft** workflow it sends `status:"draft"` explicitly and stays inactive
  until the workflow itself is published (draft-first — a trigger edit must never publish a
  workflow as a side effect). `modifyTrigger` never sends `status` unless the caller
  explicitly asks for an activation change (`trigger.active` differing from the stored
  value), translated into `status:"published"`/`"draft"`; any other `modifyTrigger` edit
  leaves activation exactly as it was. If a trigger somehow still reads inactive after the
  add on an already-published workflow, `scripts/edit.mjs`'s post-add check (and
  `publish_workflow`/`orchestrate --publish`, on their own paths) now **repairs** it — one
  per-trigger PUT with the full record + `status:"published"`, verified by a fresh read-back,
  never trusted from the write's own 200 — before reporting `triggers active: N/M`.
  `edit-driver.mjs`'s `translateActiveToStatus` and `planTriggerOps`'s mechanism note carry
  the full mechanism; `edit-triggers.test.mjs` carries the current tests.

**Tags are pre-created for you**, same as on the build path. `scripts/edit.mjs` collects
every tag name the ops reference (trigger filter values, `add`/`remove_contact_tag` steps,
`modifyStep` patches, `addBranch` tag conditions), diffs them against the account, and
creates the missing ones BEFORE the commit and before any trigger POST — aborting if a tag
create fails rather than referencing a tag that doesn't exist. It reports `created tags:`;
`--dry-run` prints `WOULD CREATE`. (GHL references tags by NAME and rejects unknown ones;
a tag trigger on a missing tag never fires.)

**Live-proven 2026-07-17** on GROM AU (throwaway canaries, since deleted, account verified
clean): `modifyTrigger` PUT 200 with the rename + new condition confirmed by GET (value a
plain string); `deleteTrigger` via a name matcher 200. **RUNTIME-proven**: tag write →
`added_to_workflow` in `/workflows/logs/v2` within 4s, i.e. an edit-added trigger genuinely
subscribes. That last check is the only one that counts — `active: true` plus a clean
round-trip is NOT proof a trigger fires (see the 2026-07-16 inert-trigger bug).

Trigger filter values obey the string/array split above — `value: "vip"`, never `["vip"]`.
`expandFilter` unwraps a single-element array on this path too, but author the string.

