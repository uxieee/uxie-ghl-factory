# GHL Internal API Map

What's known about GHL's internal hosts, auth, and quirks — the orientation for a capture session.
Verified live 2026-07-11; treat specifics as a starting point and re-confirm against the session.

## Hosts
- `backend.leadconnectorhq.com` — workflow builder, oauth/session, most agency/location data.
- `services.leadconnectorhq.com` — AI services (ai-employees, voice-ai, agent-studio, knowledge-base),
  and many v2/v3 product APIs.
- Steps/large configs sometimes live in a **Firebase Storage** blob referenced by a `fileUrl`, not
  inline in the API response.

## Auth is SERVICE-DEPENDENT (the #1 gotcha)
There is no single internal auth scheme. Match the header to the service:

| Surface | Auth header | Token kind |
|---|---|---|
| Workflow builder (`/workflow/...`, `/workflows-marketplace/...`) | `Authorization: Bearer <JWT>` | LeadConnector JWT (migrated from `token-id` on 2026-07-10) |
| AI services — Conversation AI (`/ai-employees/...`, `/conversations-ai/...`), Voice AI (`/voice-ai/...`), Agent Studio (`/agent-studio/...`) | **`token-id: <JWT>`** | Google securetoken RS256 (`iss: securetoken.google.com/highlevel-backend`; claims `user_id`, `company_id`, `role`, `locations[]`) |

Both are ~1 hr-lived session tokens; capture fresh from the live session, don't reuse saved ones.
Other common headers seen: `channel: APP`, `source: WEB_USER`, `version: <date>`.

## Object-write semantics differ by product (the #2 gotcha)
An engine must know whether `PUT` merges or replaces:

| Product | Create | Update semantics |
|---|---|---|
| Conversation AI (`/ai-employees/employees`) | `POST` | `PUT` **merges** partial bodies (send only changed fields) |
| Voice AI (`/voice-ai/agents/:id`) | `POST` | `PUT` **full-replace** (GET, mutate whole doc, PUT it back) |
| Agent Studio Super Agents (`/agent-studio/super-agent/agents/:id`) | `POST /super-agents/build` (SSE) | `PUT` **full-replace** |
| Knowledge Base rich-text (`/knowledge-base/rich-text/:id`) | `POST /knowledge-base/rich-text/` | `PUT` **full-replace**; send `content` (HTML) — the server derives `contentMarkdown` and re-chunks/re-embeds itself |
| Smart lists (`/contacts/smartlist/`) | `POST` | not captured — do **not** assume `PUT`/`DELETE` on `/:id` |
| Workflow (`/workflow/:loc/:wf`) | create → auto-save → trigger sequence | steps in a Firebase blob, not the PUT body |

## Sub-resources are often separate
Actions frequently aren't embedded in the parent object:
- Conversation AI actions → `POST /ai-employees/actions { employeeId, locationId, type, name, details }`.
- Voice AI actions → `POST /voice-ai/actions { agentId, actionType, locationId, name, actionParameters }`.
The parent object then exposes them in typed buckets (e.g. `callTransferActions[]`, `workflowActions[]`).

## Cross-references
The UI references other objects by **id** (agent id, calendar id, knowledgeBaseId) — EXCEPT some
literal values (e.g. a workflow's `voice_ai_outbound_call` step stores `fromPhoneNumber` as a literal
E.164 string, not a number-pool id). Capture confirms which.

## Smart lists — a surface with NO public API at all
Verified live 2026-08-05 (AU account). Smart lists (saved contact list views) are absent from
the public API, so the internal rail is the only programmatic route.

Host is **`services.leadconnectorhq.com`**, not `backend` — worth stating because the
neighbouring contacts endpoints (`/contacts/?locationId=`, `/contacts/search`) *are* on
`backend`, so the obvious place to look is the wrong one.

| Operation | Method | Path |
|---|---|---|
| List | `GET` | `/contacts/smartlist/search?locationId={loc}&userId={uid}&globals=true&transform=true` |
| Create | `POST` | `/contacts/smartlist/` |
| Run the query behind one | `POST` | `/contacts/search/2` |

```jsonc
// POST /contacts/smartlist/  -> 201 { "smartList": { "id", "userId" } }
{
  "locationId": "<loc>",
  "listName": "My list",                      // NOT `name`
  "filterSpecs": {                            // OBJECT, not array; `sort` forbidden INSIDE it
    "filters": [ { "group": "AND", "filters": [
      { "field": "tags", "operator": "eq", "value": "<tag>" } ] } ]
  },
  "columns": [                                // non-empty, objects (not field-name strings)
    { "key": "contact_name", "value": "Contact name", "order": 0 }
  ]
}
```

Server-set on read-back, rejected on create: `sortSpecs`, `displayOrder`, `deleted`, `userId`,
`sharedWith`. Also rejected: `name`, `filters`, `sort`, `visibility`.

The `filters` clause shape is shared with `POST /contacts/search/2`, so a filter can be proven
to return the intended contacts *before* it is saved into a list.

**Ownership is unverified.** The created object carries `userId` and `sharedWith: []`. Whether
other users in the location see it was not exercised; `sharedWith` and the `globals=true` query
param both imply a sharing model nobody has captured yet.

## Technique: let the validator hand you the schema
Several of these services run a strict DTO validator that names **every** violated constraint at
once. POSTing a deliberately minimal or empty body is usually faster than reading the UI bundle:

```
POST /contacts/smartlist/  {"locationId": "..."}
422 -> ["columns should not be empty", "listName must be a string", "filterSpecs must be an object"]
POST … with "columns": [{}]
422 -> ["columns.0.key must be a string", "columns.0.order must be a number", "columns.0.value must be a string"]
```

Two rounds produced the whole schema. It also tells you what is *rejected* (`"property name
should not exist"`), which is how you learn that the intuitive field name is wrong. A 422 is a
validation failure — **nothing is created** — so this is a read-safe probe, but confirm the
object roster afterwards rather than assuming.

## Gotcha: deep links 404, and it looks like a missing endpoint
`app.gohighlevel.com/v2/location/{loc}/...` returns **404 when navigated to directly** — only `/`
is served and the SPA routes internally. This is already in `capture-playbook.md`, but the
failure mode deserves naming: a deep-linked page renders a partial shell that **never fires the
XHRs you came to capture**, so the surface looks like it has no API. Reach every screen by
clicking: `/` → Sub-Accounts → the account → "Click here to switch" → the location → the section.

## Gotcha: the contact search index lags the record
After a bulk tag write across 117 contacts, the tag-filtered search returned **115** while
per-contact `GET /contacts/:id` returned the tag on **117/117**. It converged shortly after.
Contact search (and therefore any smart list built on it) reads an index; **direct record reads
are authoritative**. Do not diagnose a partial write from a search count taken immediately after
a bulk mutation.

## Where the worked examples live
`ghl-workflow-api-docs/research/ai-agents-internal/` — full endpoint maps + schemas for Conversation AI,
Voice AI, and Agent Studio, plus the `voice_ai_outbound_call` workflow step (live-create-proven). Use
those as the template for documenting a new surface. Static bundle source: `sniffs/bundle/recovered-source/`.
