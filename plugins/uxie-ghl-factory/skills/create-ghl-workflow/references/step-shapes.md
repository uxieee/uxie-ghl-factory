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

## Disabling steps (native pause)

GHL's per-action ⏸ button is represented by one top-level template flag:

```json
{
  "id": "{STEP_ID}",
  "type": "internal_notification",
  "attributes": { "...full step config...": "..." },
  "advanceCanvasMeta": {
    "position": { "x": 248, "y": 96 },
    "isDisabled": true
  }
}
```

- `advanceCanvasMeta.isDisabled` is a sibling of `advanceCanvasMeta.position` and is **not** inside `attributes`.
- `true` disables the step. `false` or an absent flag enables it.
- The flag applies to **every step type**. A disabled step keeps its complete config, is skipped at runtime, and appears in the builder with the `(Disabled)` label. Flipping the flag is fully reversible and exactly matches the per-action ⏸ button.
- At author time, set `disabled: true` on any IR step node. The compiler merges `isDisabled: true` into existing `advanceCanvasMeta`, preserving `position` and any other metadata.
- For an existing workflow, use edit op `{ "op":"setStepDisabled", "stepId":"...", "disabled":true|false }`, or batch by exact type with `{ "op":"disableStepsByType", "type":"internal_notification", "disabled":true|false }`. Both are idempotent and add only steps whose state changed to `modifiedSteps`.
- The proven commit path is: GET `/workflow/{loc}/{wid}?includeScheduledPauseInfo=true`, mutate the fetched `workflowData.templates`, then plain PUT `/workflow/{loc}/{wid}` with the fresh workflow envelope, `updatedBy` from JWT `authClassId`, `status:fresh.status`, `version:fresh.version`, `triggersChanged:false`, `workflowData:{templates:newTemplates}`, `createdSteps:[]`, changed IDs in `modifiedSteps`, and `deletedSteps:[]`. Keeping the fetched status commits in place without unpublishing a published workflow; do not use a live-builder auto-save session for this edit.

Two approaches are known-wrong and must not be used as substitutes:

- Blanking `internal_notification` recipients with `selectedUser: []` fails with GHL 400 `recipient mandatory`.
- Switching `userType` to `assign` changes recipient semantics; it does not pause the action.

`advanceCanvasMeta.isDisabled` is the only correct native pause mechanism.

## Verified shapes (live account, 2026-06)

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
- If this webhook is paused, `isDisabled` belongs beside `position` in the same top-level `advanceCanvasMeta` object; never place it in `attributes`.
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

### `voice_ai_outbound_call` — needs `workflowsActionType: "INTERNAL"`; both attribute fields required

```json
{
  "id": "{UUID}",
  "order": 0,
  "attributes": {
    "outboundGuidelines": "",
    "agentId": "6a2632febba50b0bbd1031d2",
    "fromPhoneNumber": "+61481610656",
    "type": "voice_ai_outbound_call",
    "__customInputs__": {}
  },
  "name": "Voice AI outbound call",
  "type": "voice_ai_outbound_call",
  "workflowsActionType": "INTERNAL",
  "next": null,
  "parentKey": null
}
```

- `agentId` = the Voice AI agent record id (from the location's configured Conversation AI / Voice AI agents), not a name.
- `fromPhoneNumber` = the literal E.164 phone number string (e.g. `"+61481610656"`) of a connected LC phone number — NOT a number-pool id.
- Both fields are `required: true` in the live dynamic-fields schema; the engine throws `IRError('MISSING_FIELD', ...)` at compile time if either is missing.
- `outboundGuidelines` is a frozen, non-interactive info-banner field (scheduling/throttling rules, not configurable) — always emit it as `""`; the builder echoes its own HTML back on real saves, but an empty string round-trips fine for this action.
- No retry/schedule/number-pool fields exist on this action — scheduling (8am–8pm local time, 1 call/day/number, 10 calls/min) is fully server-side.
- Like `internal_create_opportunity`, this is an internal action and carries top-level `workflowsActionType: "INTERNAL"` (not inside `attributes`).

## Linking multiple steps

`parentKey` = previous step id (null at root) · `next` = next step id (null at end) · `order` increments per step. For `if_else` branches, harvest a real branched workflow and mirror its `parent`/`sibling`/`nodeType` graph — those fields ARE used inside branches (the toxic-field rule is about linear action steps that shouldn't carry them).
