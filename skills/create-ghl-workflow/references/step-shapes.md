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

## Linking multiple steps

`parentKey` = previous step id (null at root) · `next` = next step id (null at end) · `order` increments per step. For `if_else` branches, harvest a real branched workflow and mirror its `parent`/`sibling`/`nodeType` graph — those fields ARE used inside branches (the toxic-field rule is about linear action steps that shouldn't carry them).
