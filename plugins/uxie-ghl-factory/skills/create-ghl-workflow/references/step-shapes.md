# Step shapes — mirror, never invent

The builder only opens a step's editor panel if the step matches the shape the builder itself produces. Steps built from invented fields **save fine and appear on the canvas, but clicking them does nothing**. This is the single most common failure when building steps via the API.

## The rule

1. `node scripts/harvest-step.js <type>` → dump a REAL step of that type from this account.
2. Copy its EXACT key set. Change only values inside `attributes`.
3. Generate a fresh `id` (uuid). Set `next`/`parentKey` for position (null for a single/last step).

## Don't-invent fields — add these ONLY if the harvested step has them

`cat`, `parent`, `sibling`, `nodeType`, `comments`, `workflowsActionType`

On a modern linear action step these are usually **absent**, and adding ones the UI didn't emit breaks the editor panel. Older docs/quickstarts show them on every step — ignore that and mirror a live step of the exact `type` you're adding.

Caveat: they aren't universally forbidden — some steps legitimately carry a subset. `parent`/`sibling`/`nodeType` are real inside `if_else` branch substructure, and `workflowsActionType` appears on certain internal actions (e.g. `internal_create_opportunity` has it; `internal_notification` doesn't). That's exactly why the rule is *mirror the harvested step*, not *always add* or *always omit*.

## OPEN: `internal_notification` steps won't open in the builder editor

**Status: root cause NOT yet established. Do not "fix" this by guessing.**

Symptom: engine-built `internal_notification` steps render on the canvas and FIRE correctly
at runtime, but clicking one does not open its editor panel, so an operator can't tweak the
recipient or copy in the UI. Observed 2026-07-16 on live workflows built by the engine.

What is ESTABLISHED:
- The `attributes` payload is correct and identical to a working UI-built step. The problem
  is the step's TOP-LEVEL node shape, not its attributes.
- Real UI-built steps carry a top-level **`parent`** alongside `parentKey`, with a
  **different value** (`sniffs/FIELDS_GLOSSARY.json`: `parent` appears on 2,949 live
  step-top-levels, `parentKey` on 3,674). The engine emits `parent` only for steps inside a
  branch scope, never for a root-level linear step.
- `parent` is **NOT** the DAG edge — `parentKey` is (per the glossary). So `parent` is not
  simply "the previous step's id", and setting it to that is an invention.

What is NOT established (and why this is still open):
- **What `parent` actually points to for a root-level linear step.** The derived glossary has
  the counts but not the raw blobs, so it cannot be inferred offline.
- The earlier report that the engine emits `workflowsActionType: 'INTERNAL'` on
  `internal_notification` does **not** reproduce: the catalog marks it `situational: []`, the
  engine emits no such field, and this file already records that `internal_notification`
  doesn't carry it. If a live blob shows it, GHL's backend is adding it on save — which would
  make it a red herring for the editor bug rather than a cause.

To close this, harvest ground truth and diff — do not reason from first principles:

```
node scripts/harvest-step.js internal_notification     # a REAL UI-built step, this account
```

Then diff its top-level key set against an engine-built one in the same workflow at the same
position, and confirm what `parent` references (a sibling? the trigger? the canvas group?).
Only then change the emitter. Per this file's own rule: **mirror, never invent.**

## Verified shapes (live account, 2026-06)

### `wait` (time) — the duration lives in `startAfter`, and an EMPTY one does not pause

```json
{ "ref": "w1", "kind": "wait", "name": "Wait 1 day",
  "config": { "unit": "days", "value": 1, "when": "after" },
  "window": { "condition": "when", "days": [0,1,2,3,4,5,6], "start": "07:00", "end": "18:00" } }
```

The IR's canonical spelling is node-level `config` + `window`; `attributes.startAfter` +
`attributes.window` (the shape a live blob stores — see `catalog/step-examples/wait.json`)
is accepted as an equivalent alias. Both compile to `attributes.startAfter {type,value,when}`.

> ⚠️ **An empty or partial `startAfter` means the wait DOES NOT PAUSE.** Every step after it
> fires immediately. Live 2026-07-16: a warm-catch + nudge + two close messages + a tag all
> fired within **6 seconds** instead of over 6 days — 4 messages blasted at a real customer
> at once. The compiler now rejects this at build time (`IRError EMPTY_STEP`); it can never
> be emitted again. If you are hand-assembling payloads outside the engine, check this first.

### `wait` (appointment-anchored) — relative to the appointment, not enrolment

```json
{ "ref": "w2", "kind": "wait", "name": "24h before appt",
  "attributes": { "type": "appointment", "appointmentCondition": "appointment",
    "appointmentStartAfter": { "when": "before", "type": "hours", "value": 24, "distributed": {} } } }
```

Verified live 2026-07-16 (workflow 07e). `distributed: {}` is required and always empty.

### `update_appointment_status` — targets an appointment you cannot name

```json
{ "ref": "s1", "kind": "action", "type": "update_appointment_status", "name": "Confirm",
  "attributes": { "category": "appointment", "type": "update_appointment_status",
                  "status_type": "confirmed" } }
```

`status_type` is `confirmed` | `cancelled`. **Which appointment it acts on is implicit**: in an
appointment-triggered workflow it is the TRIGGERING appointment; entered any other way (e.g.
`payment_received`) GHL acts on *the most recent appointment the contact is carrying*. There is
no field to target a specific one — if the contact can hold several, confirm "most recent" is
the one you mean.

### Reschedule detection — there is NO native reschedule trigger or status

GHL has no "rescheduled" trigger and no `rescheduled` status. The only working pattern is two
parts: trigger on the `appointment` event **with no status filter**, then gate with

```json
{ "conditionType": "appointment", "conditionSubType": "appointmentRescheduled",
  "conditionOperator": "is", "conditionValue": "true" }
```

`conditionValue` is the STRING `"true"`, not a boolean. Verified live 2026-07-16.

### `remove_from_workflow` — `workflow_id` is an ARRAY

```json
{ "ref": "r1", "kind": "action", "type": "remove_from_workflow", "name": "Exit nurture",
  "attributes": { "workflow_id": ["<wid>", "<wid>"] } }
```

Always an array, even for a single workflow. A bare string removes nothing.

### `custom_webhook` — needs `stepIndex` + `advanceCanvasMeta`

```json
{
  "id": "{UUID}",
  "stepIndex": 1,
  "order": 0,
  "attributes": {
    "event": "CUSTOM",
    "method": "POST",
    "url": "https://example.com/hook?secret=SHARED_SECRET",
    "body": {
      "contentType": "application/json",
      "rawData": "{\n  \"email\": \"{{contact.email}}\",\n  \"contactId\": \"{{contact.id}}\"\n}",
      "keyValueData": []
    },
    "headers": [],
    "parameters": [],
    "authorization": { "type": "NONE", "data": null },
    "saveResponse": false,
    "webhookResponse": { "isSampleRequested": false, "selectedContact": "" }
  },
  "name": "Custom Webhook",
  "type": "custom_webhook",
  "advanceCanvasMeta": { "position": { "x": 248, "y": 0 } },
  "next": null
}
```

- This shape was harvested as a single/root step, so it has no `parentKey`. When chaining it after another step, add `parentKey` = the previous step's `id` (see "Linking multiple steps" below) — `parentKey` is a normal edge field, not a don't-invent field.
- The request body is a STRING template in `rawData` with `{{merge.fields}}` — not nested JSON.
- Custom headers (`headers: [{key,value}]`) can be dropped by the sender; carrying a secret as a `?secret=` query param on `url` is a robust fallback if the receiver supports it.

### `email` — needs `parentKey`; attributes are minimal

```json
{
  "id": "{UUID}",
  "order": 0,
  "attributes": {
    "isCloned": false,
    "subject": "Subject line",
    "html": "<p>Hi {{contact.first_name}},</p><p>...</p>",
    "attachments": []
  },
  "name": "Send Email",
  "type": "email",
  "next": null,
  "parentKey": null
}
```

- Omit `from_name`/`from_email` to use the account's default sender, or set both explicitly.
- Email merge tokens use the field's `fieldKey` (e.g. `{{contact.zoom_join_url}}`), not the field id.

**Inline HTML formatting (quick-compose rendering, observed live 2026-07-13):** GHL's
quick-compose renderer STRIPS `<br>` tags and COLLAPSES `<p>` margins, so naive HTML
arrives as a wall of text. For blank-line spacing use an explicit spacer paragraph
`<p>&nbsp;</p>` between paragraphs; use `<strong>` for bold (not `<b>`); and put each
signature line in its own `<p>` (name, title, company as three separate paragraphs),
again separated by `<p>&nbsp;</p>` where you want visible gaps.

## Verifying a built step — GET, not the editor panel

The "editor panel won't open" symptom is a *human-clicking* diagnostic. Via **browser
automation** the builder's editor panel is unreliable to open for ANY node type —
correct steps included — so a panel that won't open under automation proves nothing
(observed live 2026-07-13). Verify programmatically instead: GET the workflow back and
diff the step's key set + attributes against what you sent (the engine's round-trip
verify does exactly this), and check the node renders with the right type/icon on the
canvas. Only a human manually clicking the node is a valid panel test.

## Linking multiple steps

`parentKey` = previous step id (null at root) · `next` = next step id (null at end) · `order` increments per step. For `if_else` branches, harvest a real branched workflow and mirror its `parent`/`sibling`/`nodeType` graph — those fields ARE used inside branches (the toxic-field rule is about linear action steps that shouldn't carry them).
