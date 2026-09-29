# The advanced canvas: what a person's gestures write, and what our tools keep

Read this when a user works in GHL's **Advanced builder** (the free canvas, as opposed to the top-down Standard builder),
when an export shows `advanceCanvasMeta`, `comments[]` or a trigger `targetActionId`, or when a user asks how to do
something on the canvas that the tools do not do. Everything here was measured on a live sub-account and read back on a
separate request (2026-09-29).

## Our tools keep the canvas intact

`edit_workflow` (a no-op and a real edit), `repair_workflow` and `publish_workflow` / `unpublish_workflows` were run on
advanced-canvas workflows and the stored canvas fields read back **byte-identical**: `meta.advanceCanvasMeta`, every
step's `advanceCanvasMeta` (position, disabled flag, stats mode) and `comments[]`, and every trigger's `targetActionId` and
position (proven live 2026-09-29). Editing a canvas workflow with the tools does not scramble a person's layout.

## Where the canvas stores things

| Where | Field | Meaning |
|---|---|---|
| workflow | `meta.advanceCanvasMeta.enabled`, `.enabledAt` | the workflow uses the advanced canvas (header switch + Save) |
| step / trigger | `advanceCanvasMeta.position` `{x, y}` | where the node sits |
| step | `advanceCanvasMeta.isDisabled` | switched off (skipped at runtime; a disabled WAIT still waits) |
| step | `advanceCanvasMeta.hasErrors`, top-level `hasErrors` | dropped from the picker with required fields empty; publish gates refuse it |
| step | `advanceCanvasMeta.currentState` | `"stats"` after "Show Stats mode" |
| trigger | `targetActionId` | the step this trigger enters at when that is not `templates[0]` |
| step | `comments[]` `{id, userId, timestamp, comment}` | step notes |
| ai_agent step | `advanceCanvasMeta.toolPositions` | where each tool node sits |

`templates[0]` is the default entry step. Positions are laid out on the first advanced open of a workflow built by API.

## Gestures a person can do that the tools do not model

Tell the user GHL can do these on the canvas, and where:

- **Drag / Format tree** (key `2`) moves positions; **Convert to default root action** (node menu on a root) moves a step to
  `templates[0]` and points the old root's triggers at it with `targetActionId`.
- **Draw a trigger edge to a non-root step** sets that trigger's `targetActionId`.
- **Notes** (node menu) append to `comments[]`; **Show Stats mode** sets `currentState`.
- **⇧D** disables the selected steps; unlike the ⏸ button it DOES disable a goto and a single-path wait (saved and read back).
  **⇧E** re-enables them (seen on the canvas; the builder's key map binds it — not saved and read back).
- **⌘C / ⌘V across workflows** copies steps with new ids; a pasted trigger is created as "Copy of <name>". 🔴 Pasting a
  trigger identical to one the workflow already has makes Save fail: "Duplicate trigger".
- **⇧N** creates a new workflow from the selection. 🔴 It keeps the source's step ids and a `next` to a step it did not
  copy, so GHL's validator refuses the new workflow until that edge is cleared by hand.
- **Changelog** (header history icon) and ⌘Z undo/redo up to the last 50 changes; nothing is written until Save.
- **`?layoutDirection=vertical`** re-lays the canvas top-down; the next Save overwrites every saved position.

## Traps

- 🔴 **A goto that lost its target cannot be re-targeted on the advanced canvas after a reload.** Deleting a goto's edge
  removes `attributes.targetNodeId` (GHL's validator then refuses the workflow). Drawing a new edge marks the workflow
  unsaved, but Save stays disabled. **Fix it with `edit_workflow`**: `modifyStep` with `attrPatch: {targetNodeId: <step id>}`
  (proven live 2026-09-29: GHL's "Target Node is required" cleared, the disabled flag kept).
- **A Split locks once a contact has passed through it**: distribution type, path names and percentages are disabled and
  "Add path" disappears. To change the weights of a split that has run, build a new split.
- A step dropped from the picker with an empty required field is stored with `hasErrors: true` and blocks publish until
  someone fills it in the drawer.
