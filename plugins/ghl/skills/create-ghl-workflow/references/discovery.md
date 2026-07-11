# Discovery — the IDs you need, via the GHL public MCP

The internal builder API needs ids the JWT doesn't carry. Get them with the GHL public-API MCP (`uxie-ghl-mcp`: `search_actions` → `execute_action`). The MCP has its own server-side auth — no builder JWT needed for discovery.

| Need | How |
|---|---|
| `LOC` location id | From the builder URL `.../location/{LOC}/...` |
| `CID` company id | `GET /workflow/{LOC}/list` → any row's `companyId`; or `locations__get-location` |
| `UID` user id | Decode the JWT payload → `authClassId` claim |
| location details / safe sender email | `locations__get-location` (path `locationId`) → `companyId`, business `email` |
| **form id** (form_submission trigger) | `forms__get-forms` (query `locationId`, `limit` ≤ 50) → the form `id` |
| **contact custom fields** | `locations__get-custom-fields` (path `locationId`, query `model=contact`) → field `id` (for triggers / write-back) and `fieldKey` (e.g. `contact.zoom_join_url`, for email merge tokens) |
| create a custom field | `locations__create-custom-field` — body `{name, dataType:"TEXT", model:"contact"}`; returns `{id, fieldKey}` |
| a contact id (to test a webhook write-back) | `contacts__get-contacts` (query `locationId`, `query=<email>`) |

Tip: `execute_action` supports `result_filter`, `result_fields`, and `result_limit` as top-level params to shrink large array responses (e.g. `result_filter` a custom field by name, `result_fields:"id,name,fieldKey"`).
