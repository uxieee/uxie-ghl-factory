# Rail ledger

_generated from knowledge/catalog/rail-ledger.json — do not edit._

For every GoHighLevel product both the public and the internal API serve, and each job both serve: what each rail
does, how the plugin routes it today and why, and the decision. A decision is taken only once both rails are proven on
the sandbox and every criterion is known, in this order: capability, correctness, auth, writeSemantics, efficiency,
rateLimits. The first criterion that is not `equal` decides `pool-<rail>`; all `equal` gives `both`. `undecided` means
not proven yet; `undecided-public-not-released` means GHL has not released the public side to our accounts.

## Summary

| Product | Jobs both rails serve | Decided | Routed today |
|---|---|---|---|
| workflows | read, create, edit, publish, delete, logs | none yet | internal |
| courses | read, create, edit, delete, enrol, bulk, logs | read: pool-internal | internal, public |
| conversation-ai | read, create, edit, delete | none yet | split, internal |
| voice-ai | read, create, edit, delete, logs | none yet | internal |
| knowledge-base | read, create, edit, delete | read: both | internal |
| agent-studio | read, create | none yet | internal |
| pipelines | read, create, edit, delete | read: both | split, public, internal |
| opportunities | read, create, edit, delete | none yet | public |
| forms | read | read: pool-internal | internal |
| funnel-redirects | read, create, edit, delete | none yet | internal |
| calendars | read, create, edit, delete | none yet | public |
| custom-fields | read, create, edit | read: both | public, split |
| custom-values | read, create, edit | read: both | public |
| tags | read, create | read: both | public, split |
| snapshots | read | none yet | internal |
| contact-enrolment | enrol | none yet | none |
| blogs | create, edit | none yet | none |
| email-templates | read, create | none yet | public |
| countdown-timers | read, use | none yet | internal |

## workflows

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided-public-not-released | internal | `list_workflows`, `get_workflow`, `export_workflow` | `workflows-v3__get-workflow`, `workflows-v3__get-workflow-definition`, `workflows-v3__search-workflows` |
| create | undecided-public-not-released | internal | `build_workflow`, `duplicate_workflow`, `copy_workflow_to_location` | `workflows-v3__create-workflow` |
| edit | undecided-public-not-released | internal | `edit_workflow`, `repair_workflow` | `workflows-v3__update-workflow-definition`, `workflows-v3__validate-workflow-definition` |
| publish | undecided-public-not-released | internal | `publish_workflow`, `unpublish_workflows` | `workflows-v3__update-workflow-status` |
| delete | undecided-public-not-released | internal | `raw_request:DELETE /workflow/{locationId}/{workflowId}` | `workflows-v3__delete-workflow` |
| logs | undecided-public-not-released | internal | `get_workflow_logs`, `get_workflow_stats`, `get_workflow_runtime_window` | `workflows-v3__get-workflow-logs`, `workflows-v3__get-workflow-log-statistics` |

- **read:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **create:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **edit:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **publish:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **delete:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.
- **logs:** GHL's public Workflows API is in private beta: the sandbox's definition read answered 403 "not enabled for location" (2026-10-29), so every job runs on the internal rail. Rule 3: it stays undecided until GHL releases it.

Internal only: steps, triggers, settings via the builder document; versions and restore; trash; bulk unpublish; enrol-stats and runtime windows.
Public only: server-side publish gate; logs/aggregate that refuses to truncate.

Evidence:

- **read:** Sandbox 2026-10-29: the public list (workflows-v3__get-workflow) answers 200, but leaves out every workflow with a workflowType — 135 agent, 2 business, 1 custom-object of 1699; the public definition read answers 403 "not enabled for location" (private beta).

## courses

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | pool-internal | internal | `list_courses` | `courses-v3__list-courses`, `courses-v3__get-course`, `courses-v3__list-categories`, `courses-v3__list-lessons`, `courses-v3__get-lesson`, `courses-v3__list-offers` |
| create | undecided | internal | `build_course` | `courses-v3__create-course`, `courses-v3__create-category`, `courses-v3__create-lesson`, `courses-v3__create-offer` |
| edit | undecided | public | `raw_request:PUT /membership/locations/{locationId}/products/{id}`, `raw_request:PUT /membership/locations/{locationId}/categories/{id}`, `raw_request:PUT /membership/locations/{locationId}/posts/{postId}` | `courses-v3__update-course`, `courses-v3__update-category`, `courses-v3__update-lesson`, `courses-v3__sequence-categories`, `courses-v3__sequence-lessons`, `courses-v3__update-offer` |
| delete | undecided | public | `raw_request:DELETE /membership/locations/{locationId}/products/{id}`, `raw_request:DELETE /membership/locations/{locationId}/categories/{id}`, `raw_request:DELETE /membership/locations/{locationId}/posts/{postId}` | `courses-v3__delete-course`, `courses-v3__delete-category`, `courses-v3__delete-lesson`, `courses-v3__delete-offer` |
| enrol | undecided | internal | `raw_request:POST /membership/smart-list/attach-offer-user` | `courses-v3__create-enrollment`, `courses-v3__delete-enrollment` |
| bulk | undecided | internal | `raw_request:POST /membership/locations/{locationId}/assessments/quiz/questions` | `courses-v3__get-quiz-questions`, `courses-v3__upsert-quiz-questions` |
| logs | undecided | internal | `raw_request:GET /membership/locations/{locationId}/products/user-progress/{productId}` | `courses-v3__list-bulk-progress`, `courses-v3__list-enrollments`, `courses-v3__review-assessment` |

- **read:** The memberships skill builds and edits on the internal rail; the public Courses API (2026-09-24) has not been proven on our sandbox yet.
- **create:** The memberships skill builds and edits on the internal rail; the public Courses API (2026-09-24) has not been proven on our sandbox yet.
- **edit:** D3 (Xander, 2026-11-06): course editing and deletion are public-only. Sequence and delete were ruled pool-public (orchestrator DECISION, w8-1); the public proofs are in sniffs/courses-w8-2026-11-06/01-bakeoff/edit.json and delete.json. The tools below are the internal paths the ruling retires.
- **delete:** D3 (Xander, 2026-11-06): course editing and deletion are public-only. Sequence and delete were ruled pool-public (orchestrator DECISION, w8-1); the public proofs are in sniffs/courses-w8-2026-11-06/01-bakeoff/edit.json and delete.json. The tools below are the internal paths the ruling retires.
- **enrol:** The memberships skill builds and edits on the internal rail; the public Courses API (2026-09-24) has not been proven on our sandbox yet.
- **bulk:** The public upsert replaces every question and drops option text (sandbox 2026-11-06); the internal batch add is the one proven on the build path.
- **logs:** Not run on either rail: needs an enrolled learner and a submission (G4). Grading is observed only in the engine.

Internal only: media, DRM, themes; clone; certificates; analytics.
Public only: synchronous enrolment that says alreadyEnrolled; progress and review; import.

Evidence:

- **create:** Ruled (w8-1 routing, DECISIONS): pool-internal. build_course stays a gated publish until bl-796 is fixed.
- **create:** Free draft offers (sniffs/courses-w8-2026-11-06/01-bakeoff/offers.json): both rails read back. Ruled: both. Delete is excluded.
- **edit:** Ruled (D3, Xander): course editing is public-only. Sequence is ruled pool-public too (orchestrator DECISION, w8-1). Decision left undecided here until the ledger can record a ruling.
- **delete:** Ruled (orchestrator DECISION, w8-1): delete -> pool-public, joins the w8-3 public recipe. Offer delete is excluded (bl-801).
- **enrol:** Enrol, revoke, progress and review: undecided until G4 (DECISIONS).
- **enrol:** 2026-11-07 (bl-833): the public enrol is accepted (201) into a DRAFT offer. Draft offers are not private either (bl-321): an unauthenticated GET of a draft offer returns it.
- **enrol:** Correctness favours public: the internal grant's 200 proves nothing, the public enrolment reports what happened.
- **bulk:** Ruled (w8-1 routing, DECISIONS): pool-internal. The public upsert dropped option text.
- **bulk:** 2026-11-07 (bl-843): the internal batch write REPLACES the whole question set and re-mints every question id on every save (70-research/2026-11-07-quiz-batch-add-replaces-set.md). The w8-6 tool re-posts the stored set in full and verifies by content; its replace mode is not offered (bl-847).
- **logs:** Progress and review: undecided until G4 (DECISIONS).
- **logs:** bl-834: the public bulk progress route read totalLessons 0 for an enrolled student on a 6-lesson course. Untested whether the draft lessons are the cause; the completion leg (bl-840) settles it. The internal user-progress row has no lesson counts.
- **logs:** Progress and review: undecided until G4 (DECISIONS).

Criteria for read (pool-internal):

- capability: internal — 19 fields per item internal, 13 public: the internal answer carries more of each object
- correctness: equal — both rails returned the same ids on the sandbox
- auth: equal — both ran headless on the sandbox. The internal JWT renews itself for 30 days from one browser capture; the PIT needs no browser. For a location-scoped read neither reaches where the other cannot
- writeSemantics: equal — a read writes nothing
- efficiency: equal — one GET on each rail
- rateLimits: equal — not measured on either rail. A public read spends a little of the location's public budget (100 per 10 s, a daily quota) shared with the client's integrations; the internal rail's limits are unpublished and the plugin paces its own calls. One read separates neither

## conversation-ai

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | split | `raw_request:GET /ai-employees/employees/list` | `conversation-ai-v3__search-agent`, `conversation-ai__search-agent` |
| create | undecided | internal | `create_convai_agent` | `conversation-ai-v3__create-agent`, `conversation-ai-v3__create-action` |
| edit | undecided | internal | `update_convai_agent`, `set_convai_outbound` | `conversation-ai-v3__update-agent`, `conversation-ai-v3__update-action`, `conversation-ai-v3__update-followup-settings` |
| delete | undecided | internal | `raw_request:DELETE /ai-employees/employees/{employeeId}` | `conversation-ai-v3__delete-agent`, `conversation-ai-v3__delete-action` |

- **read:** List bots on the internal rail: the public search leaves out flow-builder bots. Read one bot's prompt on either rail; the public search carries fullPrompt. The internal JWT is refused on the shared search path, so the internal rail lists through /ai-employees/employees/list.
- **create:** Configure on the internal rail: the 2026-10-27 features exist only there, and the public rail's writes would not carry them.
- **edit:** Configure on the internal rail: the 2026-10-27 features exist only there, and the public rail's writes would not carry them. Outbound configs and triggers are their own resource: set_convai_outbound.
- **delete:** Configure on the internal rail: the 2026-10-27 features exist only there, and the public rail's writes would not carry them.

Internal only: per-contact AI switch; routing table; prompt history; outbound configs and triggers (start conversations on CRM events); the outbound opener and disclaimer; AI Campaigns (bulk-conversation-ai through /bulk-actions/request); rich elements (richElementSettings); model providers: Claude and Gemini as well as OpenAI (llm; the public agent schema has no llm); MCP servers (source-derived); Build with AI (builder/build); the new test panel (builder/test); V2 flow agents (FLOW_BUILDER_BOT_V2).
Public only: nothing recorded.

Evidence:

- **read:** Sandbox 2026-10-29: the internal list returns 19 bots, a superset of the public 11 (flow-builder bots are missing from the public search); the public answer carries 32 fields per bot against 5. Capability is split, so the row stays undecided; the shared search path answers 403 for the JWT.

## voice-ai

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | internal | `raw_request:GET /voice-ai/agents` | `voice-ai-v3__get-agents`, `voice-ai__get-agents`, `voice-ai-v3__get-agent`, `voice-ai__get-agent` |
| create | undecided | internal | `create_voiceai_agent` | `voice-ai-v3__create-agent`, `voice-ai__create-agent`, `voice-ai-v3__create-action`, `voice-ai__create-action` |
| edit | undecided | internal | `update_voiceai_agent` | `voice-ai-v3__patch-agent`, `voice-ai__patch-agent`, `voice-ai-v3__update-action`, `voice-ai__update-action` |
| delete | undecided | internal | `raw_request:DELETE /voice-ai/agents/{agentId}` | `voice-ai-v3__delete-agent`, `voice-ai__delete-agent` |
| logs | undecided | internal | `get_voice_call_logs` | `voice-ai-v3__get-call-logs`, `voice-ai__get-call-logs` |

- **read:** The internal read returns the whole agent; the public one leaves out what the agent does.
- **create:** Same backend path; the internal token reaches the fields the public schema omits.
- **edit:** Same backend path; internal reaches every field.
- **delete:** Same backend path; routed with the rest of Voice AI.
- **logs:** Same backend path; the typed tool is internal.

Internal only: llmModel; mcpServers; transfer; disclaimer; publish mode; folders.
Public only: nothing recorded.

Evidence:

- **read:** Sandbox 2026-10-29: the same 8 agents on both rails; the list gives 12 fields per item internal, 26 public, while E records the single-agent read the other way (51 internal, 21-27 public). Capability needs a get-by-id differential before this row can be decided.

## knowledge-base

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | both | internal | `raw_request:GET /knowledge-base/all`, `raw_request:GET /knowledge-base/{knowledgeBaseId}` | `knowledge-base-v3__listAllKnowledgeBasesPaginated`, `knowledge-base-v3__getKnowledgeBaseById` |
| create | undecided | internal | `raw_request:POST /knowledge-base/` | `knowledge-base-v3__createKnowledgeBase`, `knowledge-base-v3__create` |
| edit | undecided | internal | `raw_request:PUT /knowledge-base/{knowledgeBaseId}` | `knowledge-base-v3__updateKnowledgeBase`, `knowledge-base-v3__update` |
| delete | undecided | internal | `raw_request:DELETE /knowledge-base/{knowledgeBaseId}` | `knowledge-base-v3__deleteKnowledgeBase`, `knowledge-base-v3__delete` |

- **read:** The internal rail reaches source types the public one lacks; whether its singular paths still answer after the rename is unverified.
- **create:** The internal rail reaches source types the public one lacks; whether its singular paths still answer after the rename is unverified.
- **edit:** The internal rail reaches source types the public one lacks; whether its singular paths still answer after the rename is unverified.
- **delete:** The internal rail reaches source types the public one lacks; whether its singular paths still answer after the rename is unverified.

Internal only: rich_text, table, google and internal_data sources; gaps.
Public only: FAQs; crawler sitemap preview; files.

Evidence:

- **read:** Sandbox 2026-10-29: the singular internal /knowledge-base/all still answers after the 2026-08-18 rename, with the same knowledge bases as the plural public list.

Criteria for read (both):

- capability: equal — the same ids with 4 fields per item internal, 4 public
- correctness: equal — both rails returned the same ids on the sandbox
- auth: equal — both ran headless on the sandbox. The internal JWT renews itself for 30 days from one browser capture; the PIT needs no browser. For a location-scoped read neither reaches where the other cannot
- writeSemantics: equal — a read writes nothing
- efficiency: equal — one GET on each rail
- rateLimits: equal — not measured on either rail. A public read spends a little of the location's public budget (100 per 10 s, a daily quota) shared with the client's integrations; the internal rail's limits are unpublished and the plugin paces its own calls. One read separates neither

## agent-studio

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | internal | `list_agent_sessions` | `agent-studio-v3__getAgents`, `agent-studio-v3__getAgentById` |
| create | undecided | internal | `create_studio_agent` | `agent-studio-v3__createAgent` |

- **read:** Whether both rails address the same agent objects is unverified.
- **create:** Whether both rails address the same agent objects is unverified.

Internal only: super-agent from a template; agent logs.
Public only: versions; execute; managed agents.

Evidence:

- **read:** Sandbox 2026-10-29: the rails hold different agents — internal /agent-studio/agents 0, public /agent-studio/agent 6. They are not the same objects, so there is nothing to decide between.

## pipelines

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | both | split | `raw_request:GET /opportunities/pipelines` | `opportunities-v3__get-pipelines`, `opportunities__get-pipelines`, `opportunities-v3__get-pipeline`, `opportunities__get-pipeline` |
| create | undecided | public | `raw_request:POST /opportunities/pipelines` | `opportunities-v3__create-pipeline`, `opportunities__create-pipeline` |
| edit | undecided | internal | `edit_pipeline` | `opportunities-v3__update-pipeline`, `opportunities__update-pipeline` |
| delete | undecided | public | `raw_request:DELETE /opportunities/pipelines/{pipelineId}` | `opportunities-v3__delete-pipeline`, `opportunities__delete-pipeline` |

- **read:** Reads run on either rail.
- **create:** The pipeline specialist creates pipelines on the public rail; its proven rules ship as patches in the public catalogue.
- **edit:** edit_pipeline is the typed tool, and it calls the very path the public update-pipeline calls, with a different token.
- **delete:** The pipeline specialist deletes on the public rail, behind its confirmation gate.

Internal only: forecast; clone; reorder; permissions; restore.
Public only: nothing recorded.

Criteria for read (both):

- capability: equal — the same ids with 9 fields per item internal, 9 public
- correctness: equal — both rails returned the same ids on the sandbox
- auth: equal — both ran headless on the sandbox. The internal JWT renews itself for 30 days from one browser capture; the PIT needs no browser. For a location-scoped read neither reaches where the other cannot
- writeSemantics: equal — a read writes nothing
- efficiency: equal — one GET on each rail
- rateLimits: equal — not measured on either rail. A public read spends a little of the location's public budget (100 per 10 s, a daily quota) shared with the client's integrations; the internal rail's limits are unpublished and the plugin paces its own calls. One read separates neither

## opportunities

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | public | `raw_request:GET /opportunities/{id}` | `opportunities-v3__get-opportunity`, `opportunities__get-opportunity`, `opportunities-v3__search-opportunities-advanced`, `opportunities__search-opportunities-advanced`, `opportunities-v3__get-lost-reason`, `opportunities__get-lost-reason` |
| create | undecided | public | `raw_request:POST /opportunities` | `opportunities-v3__create-opportunity` |
| edit | undecided | public | `raw_request:PUT /opportunities/{id}` | `opportunities-v3__update-opportunity`, `opportunities-v3__add-followers-opportunity`, `opportunities__add-followers-opportunity`, `opportunities-v3__remove-followers-opportunity`, `opportunities__remove-followers-opportunity` |
| delete | undecided | public | `raw_request:DELETE /opportunities/{id}` | `opportunities-v3__delete-opportunity`, `opportunities__delete-opportunity` |

- **read:** Record reads run on the public rail.
- **create:** Record writes run on the public rail.
- **edit:** Record writes run on the public rail.
- **delete:** Record writes run on the public rail.

Internal only: smart tags and views; bulk actions.
Public only: upsert.

## forms

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | pool-internal | internal | `list_forms`, `list_form_submissions` | `forms-v3__get-forms`, `forms__get-forms`, `forms-v3__get-forms-submissions`, `forms__get-forms-submissions`, `surveys-v3__get-surveys`, `surveys__get-surveys` |

- **read:** The forms skill reads on the internal rail beside its writes; these list paths are shared.

Internal only: create; formData write (merges at formData.form; an omitted key is kept); folders; versions.
Public only: upload to a submission.

Criteria for read (pool-internal):

- capability: internal — 13 fields per item internal, 3 public: the internal answer carries more of each object
- correctness: equal — both rails returned the same ids on the sandbox
- auth: equal — both ran headless on the sandbox. The internal JWT renews itself for 30 days from one browser capture; the PIT needs no browser. For a location-scoped read neither reaches where the other cannot
- writeSemantics: equal — a read writes nothing
- efficiency: equal — one GET on each rail
- rateLimits: equal — not measured on either rail. A public read spends a little of the location's public budget (100 per 10 s, a daily quota) shared with the client's integrations; the internal rail's limits are unpublished and the plugin paces its own calls. One read separates neither

## funnel-redirects

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | internal | `edit_redirects` | `funnels-v3__fetch-redirects-list`, `funnels__fetch-redirects-list` |
| create | undecided | internal | `edit_redirects` | `funnels-v3__create-redirect`, `funnels__create-redirect` |
| edit | undecided | internal | `edit_redirects` | `funnels-v3__update-redirect-by-id`, `funnels__update-redirect-by-id` |
| delete | undecided | internal | `edit_redirects` | `funnels-v3__delete-redirect-by-id`, `funnels__delete-redirect-by-id` |

- **read:** edit_redirects calls exactly the four public redirect paths, with the internal token.
- **create:** Same paths as public; the typed tool is internal.
- **edit:** Same paths as public; the typed tool is internal.
- **delete:** Same paths as public; the typed tool is internal.

Internal only: nothing recorded.
Public only: nothing recorded.

Evidence:

- **read:** Sandbox 2026-10-29: both rails answer 200 with no redirects (limit and offset are required; limit at most 20). A decision needs at least one object on each side.

## calendars

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | public | `raw_request:GET /calendars/{calendarId}`, `raw_request:GET /calendars/events` | `calendars-v3__get-calendar`, `calendars__get-calendar`, `calendars-v3__get-slots`, `calendars__get-slots`, `calendars-v3__get-calendar-events`, `calendars__get-calendar-events`, `calendars-v3__get-groups`, `calendars__get-groups`, `calendars-v3__getCalendarSchedule`, `calendars__get-calendar-schedule`, `calendars-v3__getAllSchedules`, `calendars__getAllSchedules` |
| create | undecided | public | `raw_request:POST /calendars/events/appointments` | `calendars-v3__create-appointment`, `calendars__create-appointment`, `calendars-v3__create-service-catalog`, `calendars__create-service-catalog` |
| edit | undecided | public | `raw_request:PUT /calendars/{calendarId}`, `raw_request:PUT /calendars/events/appointments/{eventId}` | `calendars-v3__update-calendar`, `calendars__update-calendar`, `calendars-v3__edit-appointment`, `calendars__edit-appointment`, `calendars-v3__updateSchedule`, `calendars__updateSchedule`, `calendars-v3__updateCalendarSchedule`, `calendars__update-calendar-schedule` |
| delete | undecided | public | `raw_request:DELETE /calendars/schedules/{scheduleId}/associations/{calendarId}` | `calendars-v3__remove-calendar-from-schedule`, `calendars__remove-calendar-from-schedule` |

- **read:** Calendars run on the public rail: it has the full API, the internal rail has no typed tool.
- **create:** Calendars run on the public rail.
- **edit:** Calendars run on the public rail.
- **delete:** Calendars run on the public rail.

Internal only: nothing recorded.
Public only: the full calendar, event, resource and service API (59 ops); the internal rail has no typed tool.

Evidence:

- **read:** Not decided: the read compared GET /calendars, which is not a path this row claims; a decision needs a read of one of its shared paths.

## custom-fields

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | both | public | `raw_request:GET /locations/{locationId}/customFields` | `locations-v3__get-custom-fields`, `locations__get-custom-fields`, `locations-v3__get-custom-field`, `locations__get-custom-field`, `custom-fields-v3__get-custom-fields-by-object-key`, `custom-fields__get-custom-fields-by-object-key` |
| create | undecided | split | `create_custom_field_folder` | `locations-v3__create-custom-field`, `locations__create-custom-field` |
| edit | undecided | public | `raw_request:PUT /locations/{locationId}/customFields/{id}` | `locations-v3__update-custom-field`, `locations__update-custom-field` |

- **read:** Custom fields run on the public rail (api-worlds); the internal typed tool only makes folders.
- **create:** Fields on the public rail; folders through the internal create_custom_field_folder, which posts to the same path.
- **edit:** Custom fields run on the public rail.

Internal only: folder creation.
Public only: nothing recorded.

Criteria for read (both):

- capability: equal — the same ids with 13 fields per item internal, 13 public
- correctness: equal — both rails returned the same ids on the sandbox
- auth: equal — both ran headless on the sandbox. The internal JWT renews itself for 30 days from one browser capture; the PIT needs no browser. For a location-scoped read neither reaches where the other cannot
- writeSemantics: equal — a read writes nothing
- efficiency: equal — one GET on each rail
- rateLimits: equal — not measured on either rail. A public read spends a little of the location's public budget (100 per 10 s, a daily quota) shared with the client's integrations; the internal rail's limits are unpublished and the plugin paces its own calls. One read separates neither

## custom-values

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | both | public | `search_merge_tags` | `locations-v3__get-custom-values`, `locations__get-custom-values` |
| create | undecided | public | `raw_request:POST /locations/{locationId}/customValues` | `locations-v3__create-custom-value`, `locations__create-custom-value` |
| edit | undecided | public | `raw_request:PUT /locations/{locationId}/customValues/{id}` | `locations-v3__update-custom-value`, `locations__update-custom-value` |

- **read:** Custom values run on the public rail; search_merge_tags is the internal way to find a merge tag.
- **create:** Custom values run on the public rail.
- **edit:** Custom values run on the public rail.

Internal only: merge-tag search.
Public only: nothing recorded.

Criteria for read (both):

- capability: equal — the same ids with 6 fields per item internal, 6 public
- correctness: equal — both rails returned the same ids on the sandbox
- auth: equal — both ran headless on the sandbox. The internal JWT renews itself for 30 days from one browser capture; the PIT needs no browser. For a location-scoped read neither reaches where the other cannot
- writeSemantics: equal — a read writes nothing
- efficiency: equal — one GET on each rail
- rateLimits: equal — not measured on either rail. A public read spends a little of the location's public budget (100 per 10 s, a daily quota) shared with the client's integrations; the internal rail's limits are unpublished and the plugin paces its own calls. One read separates neither

## tags

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | both | public | `raw_request:GET /locations/{locationId}/tags` | `locations-v3__get-location-tags`, `locations__get-location-tags` |
| create | undecided | split | `build_workflow` | `locations-v3__create-tag`, `locations__create-tag`, `contacts-v3__add-tags`, `contacts__add-tags` |

- **read:** Tags run on the public rail.
- **create:** Tags on the public rail; workflow builds create the tags they use on the internal rail, on the same path.

Internal only: tags created as a side effect of building a workflow.
Public only: nothing recorded.

Criteria for read (both):

- capability: equal — the same ids with 6 fields per item internal, 6 public
- correctness: equal — both rails returned the same ids on the sandbox
- auth: equal — both ran headless on the sandbox. The internal JWT renews itself for 30 days from one browser capture; the PIT needs no browser. For a location-scoped read neither reaches where the other cannot
- writeSemantics: equal — a read writes nothing
- efficiency: equal — one GET on each rail
- rateLimits: equal — not measured on either rail. A public read spends a little of the location's public budget (100 per 10 s, a daily quota) shared with the client's integrations; the internal rail's limits are unpublished and the plugin paces its own calls. One read separates neither

## snapshots

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | internal | `list_snapshots`, `get_snapshot_contents` | `snapshots-v3__get-custom-snapshots` |

- **read:** Snapshot work is agency-scoped; the public list needs an agency token, the plugin works per location.

Internal only: create; refresh; push; contents; manifest; conflicts.
Public only: share link; push status.

Evidence:

- **read:** Sandbox 2026-10-29: the internal list returns 9 snapshots; the public read answers 401 "not authorized for this scope" for a location PIT (it needs an agency token).

## contact-enrolment

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| enrol | undecided | none | `raw_request:POST /contacts/{contactId}/workflow/{workflowId}` | `contacts-v3__add-contact-to-workflow`, `contacts__add-contact-to-workflow` |

- **enrol:** Not routed by any skill; corpus api-gap-matrix still calls it not exposed.

Internal only: nothing recorded.
Public only: nothing recorded.

## blogs

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| create | undecided | none | `raw_request:POST /blogs/posts` | `blogs-v3__create-blog-post`, `blogs__create-blog-post` |
| edit | undecided | none | `raw_request:PUT /blogs/posts/{postId}` | `blogs-v3__update-blog-post`, `blogs__update-blog-post` |

- **create:** No skill routes blog posts yet.
- **edit:** No skill routes blog posts yet.

Internal only: nothing recorded.
Public only: nothing recorded.

## email-templates

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | public | `raw_request:GET /emails/builder` | `emails-v3__list-email-templates`, `emails-v3__get-email-template` |
| create | undecided | public | `raw_request:POST /emails/builder` | `emails-v3__create-email-template` |

- **read:** Email templates run on the public rail, through the v3 templates ops; GHL deprecates the shared builder path.
- **create:** Use emails-v3__create-email-template; GHL deprecates the builder create.

Internal only: nothing recorded.
Public only: v3 email templates (emails-v3__*).

Evidence:

- **read:** Sandbox 2026-10-29: emails-v3__list-email-templates answers 200 with 3 templates (bl-443); the internal builder list was not read.

## countdown-timers

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | undecided | internal | `find_ghl_site` | — |
| use | undecided | internal | `build_funnel_page` | — |

- **read:** find_ghl_site reads both (countdownTimers for the list, countdownTimerId for one). A fixed timer whose endDate has passed renders empty on a page, so the read reports expired.
- **use:** The page builder countdown elements (countdown, minute-timer, day-timer) and marketing-countdown (binds a saved timer by id) are in the closed element set. A marketing-countdown must name a saved timer that exists.

Internal only: nothing recorded.
Public only: nothing recorded.

Evidence:

- **read:** Public templates measured 2026-11-07 (knowledge c271e1da, countdown-public-templates-2026-11-07.md): the public op countdown-timer-v3__list-countdown-timer-templates returned 200 with 9 templates through the public runtime (public-api-mcp d98c92c). publicUnmeasured is KEPT: the saved-timer public op countdown-timer-v3__get-countdown-timer has a different route from the internal fetch, so the shared row cannot be cleared as it stands; the re-scope is backlog bl-868.

## Shared paths outside these products

76 paths both rails serve belong to products outside the ledger; their rail choice is owned by:

- W7 (funnel builder reads): 2
- W9 (ad manager): 5
- W9 (brand kit): 4
- W9 (contacts records): 8
- W9 (conversations): 4
- W9 (custom objects): 10
- W9 (invoices): 7
- W9 (location settings): 5
- W9 (payments): 3
- W9 (phone): 4
- W9 (products, bl-479): 4
- W9 (social planner): 1
- W9: 19
