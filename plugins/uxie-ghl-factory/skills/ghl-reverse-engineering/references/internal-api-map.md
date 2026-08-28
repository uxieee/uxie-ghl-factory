# GHL Internal API Map

What's known about GHL's internal hosts, auth, and quirks — the orientation for a capture session.
Verified live 2026-07-11; treat specifics as a starting point and re-confirm against the session.

**The compiled form of everything below is the endpoint catalogue** — `search_endpoints` /
`describe_endpoint` on `uxie-ghl-internal-mcp`. It carries every host, prefix and auth rail here as
a field on each row, plus whether a location token has been proven to reach it. Read a row before
you read a bundle.

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
| AI services — Conversation AI (`/ai-employees/...`, `/conversations-ai/...`), Voice AI (`/voice-ai/...`), Agent Studio (`/agent-studio/...`) | `Authorization: Bearer <JWT>` **and** `token-id: <JWT>` together — the dual-credential rail | the `token-id` is a Google securetoken RS256 (`iss: securetoken.google.com/highlevel-backend`; claims `user_id`, `company_id`, `role`, `locations[]`). The plugin's gateway attaches both on `host:"ai"` / `rail:'ai'`, live-proven by the agent-create tools; through the MCP you never set either |

Both are ~1 hr-lived session tokens; capture fresh from the live session, don't reuse saved ones.
`channel: APP`, `source: WEB_USER`, `version: <date>` are **required outside `/workflow/*`** —
without them 21 of 39 probed prefixes returned a 401 whose body says `version header was not
found` (reach differential, 2026-08-25). The gateway sends them on every call; a hand-rolled
request must too.

## Object-write semantics differ by product (the #2 gotcha)
An engine must know whether `PUT` merges or replaces:

| Product | Create | Update semantics |
|---|---|---|
| Conversation AI (`/ai-employees/employees`) | `POST` | `PUT` **merges** partial bodies (send only changed fields) |
| Voice AI (`/voice-ai/agents/:id`) | `POST` | `PUT` **full-replace** (GET, mutate whole doc, PUT it back) |
| Agent Studio Super Agents (`/agent-studio/super-agent/agents/:id`) | `POST /super-agents/build` (SSE) | `PUT` **full-replace** |
| Workflow (`/workflow/:loc/:wf`) | create → auto-save → trigger sequence | steps in a Firebase blob, not the PUT body |
| Smart lists (`/contacts/smartlist/`) | `POST` (both hosts — see "Smart lists" below) | not captured — do **not** assume `PUT`/`DELETE` on `/:id` |

## Sub-resources are often separate
Actions frequently aren't embedded in the parent object:
- Conversation AI actions → `POST /ai-employees/actions { employeeId, locationId, type, name, details }`.
- Voice AI actions → `POST /voice-ai/actions { agentId, actionType, locationId, name, actionParameters }`.
The parent object then exposes them in typed buckets (e.g. `callTransferActions[]`, `workflowActions[]`).

## Cross-references
The UI references other objects by **id** (agent id, calendar id, knowledgeBaseId) — EXCEPT some
literal values (e.g. a workflow's `voice_ai_outbound_call` step stores `fromPhoneNumber` as a literal
E.164 string, not a number-pool id). Capture confirms which.

## Smart lists — a surface with no public API at all
Verified live 2026-08-28 (the designated test sub-account). Smart lists (saved contact list
views) are absent from the public API entirely, so the internal rail is the only programmatic
route to them.

🔴 **Correction to an earlier claim.** "The host is `services`, not `backend`" is **false** as a
generalisation for this surface — proven by differential, the same route answers 200 on **both**
hosts:
- `services.leadconnectorhq.com` — what the **browser** actually calls.
- `backend.leadconnectorhq.com` with plain **Bearer** (no `token-id`) — also 200, and it is the
  engine's **native** rail: an engine that already holds a Bearer JWT for `backend` (the
  workflow-builder credential) needs no second `token-id` credential just to reach smart lists.

Document both hosts. Treat any single-host claim about an internal surface as provisional until
checked by differential (call the neighbouring host too — don't infer "not available there" from
one success elsewhere).

| Operation | Method | Path |
|---|---|---|
| List | `GET` | `/contacts/smartlist/search?locationId={loc}&userId={uid}&globals=true&transform=true` |
| Create | `POST` | `/contacts/smartlist/` → 201 `{smartList: {id, userId}}` |
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
`sharedWith`. Also rejected: `name`, `filters`, `sort`, `visibility` — the intuitive names for the
fields above; the 422 validator is what tells you they're wrong (see the technique below).

The `filters` clause shape is shared with `POST /contacts/search/2`, so a filter can be proven to
return the intended contacts *before* it is saved into a list.

**Say the unverified parts out loud.** Sharing/ownership semantics are **unverified**: the created
object carries `userId` and `sharedWith: []`, and `sharedWith` plus the `globals=true` query param
both imply a sharing model, but whether other users in the location actually see a created list
was not exercised. Update/delete on `/:id` are **not yet captured** — a separate sweep is running;
do not assume they exist just because neighbouring products expose them.

## Technique: let the validator hand you the schema
Several of these services run a strict DTO validator that names **every** violated constraint at
once. POSTing a deliberately minimal or empty body is usually faster than reading the UI bundle:

```
POST /contacts/smartlist/  {"locationId": "..."}
422 -> ["columns should not be empty", "listName must be a string", "filterSpecs must be an object"]
POST … with "columns": [{}]
422 -> ["columns.0.key must be a string", "columns.0.order must be a number", "columns.0.value must be a string"]
```

Two rounds produced the whole schema above. It also tells you what is *rejected* (`"property name
should not exist"`), which is how you learn the intuitive field name is wrong. A 422 is a
validation failure — **nothing is created** — so this is a read-safe probe, but confirm the object
roster afterwards rather than assuming.

Re-verified 2026-08-28 (the designated test sub-account): re-ran the technique end to end and
confirmed both halves still hold — a near-empty POST names every violated constraint in one
response, and the 422 responses created nothing (roster count unchanged before/after).

## Quirk: the contact search index lags direct record reads
Verified 2026-08-28 (the designated test sub-account). After a bulk tag write across 117
contacts, the tag-filtered contact search returned **115** while per-contact `GET /contacts/:id`
returned the tag on **117/117**. The count converged shortly after. Contact search is backed by
an index, not the live record; **direct record reads are authoritative**. This affects more than
search directly — any smart list built on the same query path inherits the same lag. Do not
diagnose a partial write, or a smart list that "isn't picking up" a recent change, from a search
count taken immediately after a bulk mutation; re-check a few minutes later or confirm via direct
record reads first.

## Where the worked examples live
The corpus — `knowledge/corpus/ai-agents/` for Conversation AI, Voice AI and Agent Studio,
`memberships-courses/`, `events/`, `workflows/` — is the source of truth and the template for
documenting a new surface. Recovered source, mined into the catalogue:
`sniffs/bundle-2026-08-21-2/recovered-source/` (the workflow builder, 1,867 files including the
page layer — NOT the older `sniffs/bundle/`, which is the same app at a third of the size) and
`sniffs/memberships-builder-2026-08-24/recovered-source/`. The AI apps have no recovered source;
their catalogue rows come from the corpus.
