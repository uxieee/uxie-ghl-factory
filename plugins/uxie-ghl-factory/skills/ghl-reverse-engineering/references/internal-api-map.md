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

## Sub-resources are often separate
Actions frequently aren't embedded in the parent object:
- Conversation AI actions → `POST /ai-employees/actions { employeeId, locationId, type, name, details }`.
- Voice AI actions → `POST /voice-ai/actions { agentId, actionType, locationId, name, actionParameters }`.
The parent object then exposes them in typed buckets (e.g. `callTransferActions[]`, `workflowActions[]`).

## Cross-references
The UI references other objects by **id** (agent id, calendar id, knowledgeBaseId) — EXCEPT some
literal values (e.g. a workflow's `voice_ai_outbound_call` step stores `fromPhoneNumber` as a literal
E.164 string, not a number-pool id). Capture confirms which.

## Where the worked examples live
The corpus — `knowledge/corpus/ai-agents/` for Conversation AI, Voice AI and Agent Studio,
`memberships-courses/`, `events/`, `workflows/` — is the source of truth and the template for
documenting a new surface. Recovered source, mined into the catalogue:
`sniffs/bundle-2026-08-21-2/recovered-source/` (the workflow builder, 1,867 files including the
page layer — NOT the older `sniffs/bundle/`, which is the same app at a third of the size) and
`sniffs/memberships-builder-2026-08-24/recovered-source/`. The AI apps have no recovered source;
their catalogue rows come from the corpus.
