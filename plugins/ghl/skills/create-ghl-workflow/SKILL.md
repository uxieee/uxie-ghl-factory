---
name: create-ghl-workflow
description: Use when programmatically creating, building, or publishing a GoHighLevel / HighLevel workflow, or adding triggers/actions/steps to one, via the internal builder API — e.g. "create a GHL workflow", "add a webhook/email step via API", "build a HighLevel automation programmatically", or when a workflow step created via API saves but won't open in the builder. Write counterpart to get-ghl-workflow-json (read-only). draft-only proven — creates and verifies workflows in DRAFT state only; the publish/runtime path is untested.
---

# Create GHL Workflow (internal builder API)

Build and publish HighLevel workflows by POST/PUT to the internal builder API at `backend.leadconnectorhq.com`. The public v2 API cannot create workflows; the builder iframe uses these undocumented routes. This is the WRITE counterpart to `get-ghl-workflow-json` (read-only export).

## Before any write

1. Run BOTH gates in ${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md
   (OWNED-ACCOUNT CHECK every session; TOS DISCLOSURE once per workspace).
2. Auth: ${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md — capture, expiry,
   re-auth contract. On 401 mid-run: stop, re-capture, resume; never retry-loop.
3. Workflows are created in DRAFT only. Never publish. Say so in your blueprint.

## Boundaries (this is a WRITE skill — be careful)

- Auth header format, capture procedure, and token lifetime: see `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` (the canonical auth doc). One-line reminder: `Authorization: Bearer`, **NOT** `token-id`.
- **Draft-first.** Build and verify everything as `draft`. Require explicit user confirmation before the publish PUT — and even then, this skill is draft-only proven; treat publish as unverified.
- **Never invent step fields.** Always harvest a real UI-created step of the same `type` and mirror its exact key set. Invented fields produce steps that save but won't open in the builder. See `references/step-shapes.md`.
- One sub-account (location) per session unless told otherwise.

## Inputs to gather first

- `LOC` — location id, from the builder URL `.../location/{LOC}/...`.
- `Bearer JWT`, `UID`, `CID` — capture and derive per `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` (§2 capture, §3 UID/CID derivation).
- Trigger target + action config. Discover form / custom-field / contact ids via the GHL public MCP — see `references/discovery.md`.

## Recipe (strict order)

1. **Validate token:** `GET /workflow/{LOC}/list?type=workflow&limit=1` → expect 200; grab `companyId` → `CID`.
2. **Harvest templates:** for each action type, run `scripts/harvest-step.js <type>` to dump a real working step to mirror.
3. **Create** empty draft: `POST /workflow/{LOC}` → returns `{id}` = `WID`.
4. **Auto-save** with the step(s): `PUT /workflow/{LOC}/{WID}/auto-save` (NOT the plain PUT).
5. **Create trigger(s):** `POST /workflow/{LOC}/trigger`.
6. **Verify:** GET the workflow + GET `/workflow/{LOC}/trigger?workflowId={WID}`; confirm the saved step's key set matches the harvested template.
7. **Confirm with user, then publish:** GET the workflow, set `status:"published"`, strip `autoSaveSession`/server fields, `PUT /workflow/{LOC}/{WID}`.

Full payloads in `references/build-recipe.md`. Use `scripts/ghl.js` for every call.

## Critical gotchas

- `Authorization: Bearer`, **NOT** `token-id`.
- Build order is fixed: create → auto-save (steps) → trigger → publish. **Steps go through `/auto-save`, not the plain PUT.**
- Step envelope must mirror a harvested step. **Don't add** `cat`/`parent`/`sibling`/`nodeType`/`comments`/`workflowsActionType` unless the harvested step of that exact `type` has them — adding fields the UI didn't emit breaks the editor panel (these are usually absent on modern linear steps, but some — e.g. `if_else` branches, or `workflowsActionType` on certain internal actions — legitimately carry a subset). (`custom_webhook` needs `stepIndex`+`advanceCanvasMeta`; `email` needs `parentKey`.)
- Trigger: `type:"form_submission"` with `conditions:[{field:"form.id",operator:"is-any-of",value:[id]}]` and `actions:[{workflow_id,type:"add_to_workflow"}]`. Root `workflowId` camelCase; `location_id`/`company_id` snake_case.
- Strip `autoSaveSession`/`autoSaveSessionId`/`__v`/`filePath`/`createdAt`/`updatedAt` before the publish PUT.
- bash: `export UID=...` silently fails (`UID` is readonly) → use `USERID` or pass inline differently.
- Custom webhook headers can be dropped by the sender — carrying a secret as a `?secret=` URL param is a robust fallback.

## Red flags — STOP

- About to send `token-id` → use `Authorization: Bearer`.
- About to hand-write a step's fields → harvest a real one first and mirror it.
- About to PUT steps to `/workflow/{LOC}/{WID}` → that's publish; steps go to `/auto-save`.
- About to publish without user confirmation → stop; it stays draft until they OK it.
- Got a 401 mid-build → the JWT expired; re-capture and resume.

## Tool routing

- **Discovery** (form / custom-field / contact / location ids): GHL public MCP (`uxie-ghl-mcp`), separate server-side auth, no JWT needed — see `references/discovery.md`.
- **Workflow CRUD:** the internal API via `scripts/ghl.js`.
- **Inspect / export** an existing workflow: use the `get-ghl-workflow-json` skill.

## Resources

- `references/build-recipe.md` — endpoints, headers, full verified create/auto-save/trigger/publish payloads.
- `references/step-shapes.md` — the mirror-don't-invent rule, toxic-field list, verified `custom_webhook` + `email` shapes.
- `references/discovery.md` — getting ids via the GHL public MCP.
- `scripts/ghl.js` — authenticated internal-API caller.
- `scripts/harvest-step.js` — dump a real step of a given type to mirror.
- Upstream docs: `github.com/uxieee/ghl-workflow-api-docs` (fork: `github.com/zedricedwardc/ghl-workflow-api-docs`). Treat their payloads as a starting point; the shapes in `references/` are verified against a live account.
