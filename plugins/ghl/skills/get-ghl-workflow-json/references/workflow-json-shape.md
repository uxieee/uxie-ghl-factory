# Workflow JSON Shape

This is a starter reference for validating captures. Preserve unknown fields; HighLevel changes this schema over time.

## Workflow Config

Expected top-level fields for a useful workflow config:

- `_id` or `id` - workflow ID
- `locationId` - sub-account/location ID
- `name` - builder-visible workflow name
- `status` - commonly `published` or `draft`
- `workflowData` - config container
- `workflowData.templates` - array of workflow steps

Common top-level fields:

- `companyId`
- `version`
- `allowMultiple`
- `stopOnResponse`
- `removeContactFromLastStep`
- `timezone`
- `permissionMeta`
- `workflowNote`
- `createdAt`
- `updatedAt`
- `scheduledPauseDates`

## Step Objects

Each `workflowData.templates[]` item usually includes:

- `id` - step ID
- `order` - builder order
- `name` - builder label
- `type` - action/control type
- `attributes` - type-specific payload
- `next` - next step ID for linear flows
- `parentKey` - previous step ID for linear flows

Branching steps may store branch targets inside `attributes` instead of a single `next`.

## Trigger JSON

Trigger endpoint responses vary. A useful trigger capture is usually one of:

- an array of trigger objects
- an object with an array field such as `triggers`, `data`, or `items`
- an empty array/object when the workflow has no configured trigger

Preserve it as-is. Do not reshape it to match the workflow config.

## Common Capture Problems

- `401`: token came from the wrong origin or expired, or you sent the retired `token-id` header. See `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` §2/§4 to re-capture the iframe JWT.
- `403` or `429`: call throttle rejection and stop.
- HTML/text body: request likely hit the wrong origin, wrong endpoint, or an auth error. Save failed wrapper for debugging.
- Missing `workflowData.templates`: file is not the workflow config or the backend shape changed.
