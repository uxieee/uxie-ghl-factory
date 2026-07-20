# uxie-ghl-internal-mcp

MCP server exposing the `uxie-ghl-factory` plugin's proven GoHighLevel **internal-API**
engines as schema-validated tools. Complements the plugin's skills — the specialists
design, this server executes.

**Status: Plan 3 complete and LIVE-PROVEN on GROM AU (2026-07-21).** Its read tools and the
confirm-gated write tools (`build_workflow`, `edit_workflow`, `publish_workflow`,
`fast_forward_contacts`, non-GET `raw_request`) have all been driven against a real
account through a real MCP session. Plan 4 Tasks 1–3 add `list_courses` and the
confirm-gated `build_course`; both are implemented and locally verified, but **neither MCP
tool has been live-proven yet**. Plan 4 Task 4 remains human-gated. AI-agent tools are not
implemented yet.

## Credential model

Credentials live in a **file on your machine**, written by the Playwright capture
runbook (`docs/auth-jwt-capture.md`). They are never accepted as a tool argument,
never logged, and never echoed in a response or error.

- Point the server at the file with `GHL_TOK_FILE=<path>` or the `set_token_file` tool
  (a **path**, never a token — a JWT-looking value is rejected without echoing it back).
- The file is re-read **on every call**, so re-capturing mid-session works with no restart.
- JWTs last ~1 hour. On expiry you get `TOKEN_EXPIRED` naming the runbook to re-run.
- The token is scoped to the workflow-builder iframe origin. A token captured from a
  request whose `referer` is `app.gohighlevel.com` is unscoped and 401s on every call.

## Install

```bash
claude mcp add ghl-internal -e GHL_TOK_FILE="/abs/path/to/tok.txt" -- node /abs/path/to/mcp-internal/stdio.mjs
```

## Tools

| Tool | Operations |
|---|---|
| `set_token_file` / `auth_status` | — (credential state; claims only, never the token) |
| `list_workflows` | `GET /workflow/{loc}/list` |
| `get_workflow` | summary + step count (use `export_workflow` for the graph) |
| `export_workflow` | workflow body + triggers + sticky notes |
| `get_workflow_logs` | executions, per-step counts, enrollment roster |
| `list_account_entities` | pipelines, calendars, users, forms, custom fields, AI agents |
| `list_courses` | course summaries with status and available chapter/lesson/offer counts |
| `build_course` | no-call validation preview; confirmed course build with created IDs, verification and cleanup evidence |
| `build_workflow` | draft creation and verification; never publishes |
| `edit_workflow` | read-only preview; writes require `confirm: true` and never publish |
| `publish_workflow` | read-only publish preview; publishing requires `confirm: true` |
| `fast_forward_contacts` | read-only parked-enrollment preview; selective requeue only with `confirm: true` |
| `raw_request` | GET escape hatch; non-GET methods require `confirm: true` and return partial-progress evidence |

## Error contract

Every tool returns `{ ok, code?, detail?, remediation?, data? }`. Codes are stable and
machine-branchable:

| Code | Meaning |
|---|---|
| `TOKEN_MISSING` | no/unreadable token file, or a credential passed as an argument |
| `TOKEN_EXPIRED` | JWT `exp` passed, or upstream 401/403 |
| `VALIDATION_FAILED` | unsupported argument fields, or upstream 422 |
| `VERSION_CONFLICT` | upstream 409 — re-read for the current `version` |
| `RATE_LIMITED` | upstream 429 |
| `CONFIRM_REQUIRED` | a gated operation needs `confirm: true` |
| `PREVIEW_STALE` | fast-forward preview token is missing or no longer matches fresh parked state |
| `ENGINE_ABORT` | engine threw — usually a spec or dependency problem |
| `HTTP_<n>` | any other upstream status |

## Historical live proof ledger — EXECUTED vs OBSERVED

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Workflow: *AU Magic Link Provisioner*
(`6efef18a…`), published, 116 total enrolled. Date: **2026-07-20**. Driven through a real
MCP stdio session (`initialize` → `tools/call`), not unit tests. Read-only; nothing mutated.
This ledger predates the confirmation-gated Task 4 write additions; those additions were
unit-tested only and were not live-called.

| # | Executed | Observed |
|---|---|---|
| 1 | `auth_status` | `ok=true`; `jwt.present=true`, `secondsRemaining≈3448`, uid `CpTT7…`. Raw token **absent** from the response (regex-checked). |
| 2 | `list_workflows` | `ok=true`; `count=45`, 45 returned — e.g. *001 - FB Lead Form* `[published]`, *01 Abandoned Cart Recovery* `[published]`. |
| 3 | `get_workflow` | `ok=true`; name *AU Magic Link Provisioner*, status `published`, version `15`, `stepCount=1`. |
| 4 | `export_workflow` | `ok=true`; `templates=1` — **matches #3's stepCount**; `triggers=1` (type `inbound_webhook`); `stickyNotes=[]` (array, len 0). |
| 5 | `get_workflow_logs` | `ok=true`; `logs=5`, `enrollments=5`, `perStepCounts=0` (correct — 0 *active* enrolled). |
| 6 | `list_account_entities` | `ok=true`; pipelines 5, calendars 4, users 7, forms 5, customFields 46, agents 3. |
| 7 | `raw_request` GET `/workflow/{loc}/list?limit=1` | `ok=true`, upstream `status=200`. |
| 8 | **Negative:** `set_token_file` → `/nonexistent/nope.txt` | `ok=false`, `code=TOKEN_MISSING`, remediation names the capture runbook. |
| 9 | **Negative:** `set_token_file` with a JWT as `path` | `ok=false`, `code=TOKEN_MISSING`, secret **not present** in the response. |
| 10 | **Negative:** `raw_request` with `method: POST` | rejected at the schema layer — writes unavailable in this build. |

### Defect found by this run

`export_workflow` returned `stickyNotes` as a **non-array**. The live envelope is
`{ data: [], count: 0, traceId }` — **not** `{ notes: [] }`, the shape the unit test had
stubbed. Green tests, wrong behavior. Accessor corrected to normalize any of
`data` / `notes` / bare-array onto an array, stubs re-pointed at the real envelope,
and re-verified live: `stickyNotes isArray: true`, `triggers isArray: true`.

Everything above was read off actual tool output. Nothing in this ledger is expected-value.

## Live proof ledger — write tools (Task 5)

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Date: **2026-07-21**. Driven through a real
MCP stdio session. All writes on throwaway canaries, **all deleted afterwards** (verified
by re-read → 404, plus a tag sweep → none remaining).

| # | Executed | Observed |
|---|---|---|
| 1 | `build_workflow` (canary draft) | `ok=true`; `authored=compiled=steps=1` (integrity MATCH); `createdTags=["task5-canary","task5-a"]`; `published=false`. |
| 2 | `edit_workflow` **without** `confirm` | `CONFIRM_REQUIRED`; preview `stepCount {before:1, after:2}`. `export_workflow` then showed **1 step — nothing written** ✓ |
| 3 | `edit_workflow` with `confirm:true` | `ok=true`; export showed **2 steps** — edit landed. |
| 4 | `publish_workflow` without confirm → with confirm | `CONFIRM_REQUIRED`, then `ok=true`. Status `draft→published`, version `3→4`, **triggers still present and `active:true`** (the v0.3.4 downgrade regression did **not** reproduce). |
| 5 | `fast_forward_contacts` (preview) | `CONFIRM_REQUIRED` — "preview is ready; no write was sent." |
| 6 | `raw_request` POST without confirm | `CONFIRM_REQUIRED` — refused **before any network call** (proven by running with an absent token file: a tool that reached the network would have failed `TOKEN_MISSING` instead). |
| 7 | Cleanup | Canary DELETE → 200; re-read → `HTTP_404`. All `task5-*` tags deleted; final sweep: **0 tags, 0 workflows remaining**. |
| 8 | Builder UI check | Correct-type canary renders **with its action icon** and its **step editor opens** (Internal notification: Action Name, Type, From Name/Email, To User Type). |

### Defect found and fixed by this run — `STEP_TYPE_UNKNOWN`

Authoring `send_internal_notification` (the real slug is **`internal_notification`**)
compiled clean, built, round-tripped, and reported `warnings: []` with a MATCHING
authored/compiled/steps count — but in the builder the node rendered as **a bare box with
no action icon, and its step editor would not open**. A control click on a UI-built
`internal_notification` step in the same account opened its editor normally, proving the
defect was ours and not a browser artifact.

Root cause: `compile()` looked the type up with `ctx.catalog.step(t.type)` and simply
skipped when it was missing — an unrecognised type was never rejected. The catalog is
complete (316 step types), so an unknown type is an authoring error.

Fix: `compile()` now throws `STEP_TYPE_UNKNOWN`, naming the offending type and suggesting
the nearest catalog slug, with an explicit `allowUnknownStepTypes` override for the
documented "harvest a live example and extend the catalog" path. Four regression tests
added to `engine/silent-failure.test.mjs`. Verified live: the bad type is now refused
(`ENGINE_ABORT` / `STEP_TYPE_UNKNOWN: 'send_internal_notification' — did you mean
'internal_notification'?`), and the correct type builds, renders and opens.

### Second defect found and fixed — authored `email.to` was silently dropped

Authoring `internal_notification` with `userType: "custom_email"` and
`attributes.email.to` persisted with **no `to` key and no warning** — the builder's
"To Custom Email" field came up empty, so the notification would have reached nobody.
The UI-built control step in the same account carries `to`.

Root cause: `internalNotificationAttributes()` emits an explicit per-channel allowlist
(correct — the editor binds to an exact field set), but `to` was missing from it. The
2026-07-15 corpus that seeded the handler contained no `custom_email` example.

Fix, in two parts:
1. `to` is emitted when authored, and `userType: "custom_email"` **without** a `to` now
   throws `MISSING_FIELD` rather than building a notification that reaches nobody.
2. **Class fix:** any authored channel key the handler does not emit now raises
   `NOTIFICATION_KEY_DROPPED` through `ctx.warn` instead of vanishing — so the next
   unlisted key surfaces loudly instead of repeating this bug.

Four regression tests added. Live-verified on GROM AU 2026-07-21: `custom_email` with no
`to` is refused; with `to` it persists (`"to":"ops@example.com"`) and the builder's
**"To Custom Email" field renders the address** (screenshot-confirmed) — the same field
that was empty before the fix.

Everything above was read off actual tool output and real screenshots. Nothing is expected-value.

## Live proof ledger — memberships tools (Plan 4, Task 4)

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Date: **2026-07-21**. Real MCP stdio session.
Canary courses created and **deleted afterwards** — final `list_courses` returns 0.

| # | Executed | Observed |
|---|---|---|
| 1 | `list_courses` (before) | `ok=true`, `count=0`. |
| 2 | `build_course` **without** `confirm` | `CONFIRM_REQUIRED` + preview (`wouldCreate`: 1 course, 1 chapter, 2 lessons, 1 offer; `estimatedSeconds: 16`). `list_courses` after → still **0 — nothing written** ✓ |
| 3 | `build_course` with `confirm:true` (correct spec) | `ok=true`, `verification.problems = 0`. |
| 4 | `list_courses` (after) | Course present with `counts {chapters:1, lessons:2}` — matches the spec. |
| 5 | **Memberships UI check** | Product renders in *Your Products*; opening it shows **Chapter One (Published) → Lesson A, Lesson B**. Screenshot-confirmed. |
| 6 | **Negative:** typo spec with `confirm:true` | `VALIDATION_FAILED` **at preview, before any object was created** — `unknown key "body" — did you mean "text"?` |
| 7 | Cleanup | Both canaries deleted (one delete returned a transient upstream `503`; retried, `200`). Final sweep: **0 courses on the account** ✓ |

### Defect found and fixed by this run — a preview that green-lit a broken spec

The first live build used `body` instead of `text` for lesson content. The spec validator
did not know the key, **ignored it**, and `previewCourseSpec` returned
`valid: true, errors: []`. The build then created a course with **two empty lessons**, and
the problem only surfaced in *post-build* verification — `ENGINE_ABORT: Course objects were
created but 2 verification check(s) failed` — i.e. after the objects already existed on the
account.

That is worse than having no preview: the confirm gate actively told the caller it was safe
to proceed. Same silent-acceptance class as Plan 3's `STEP_TYPE_UNKNOWN` and the dropped
`email.to`.

Fix: `validateCourseSpec` now rejects unknown keys at **every** level (spec, course,
chapter, lesson, question) with a near-miss hint (`body` → `text`). The key lists are
derived from what the engine actually reads, cross-checked against `course-spec.md` and
`example-spec.json` — **not guessed**. A regression test validates the shipped
`example-spec.json` to prove the guard does not over-reject; that test immediately caught
an over-strict first draft (it had omitted the legitimate `awardCredential` key).

Live-verified both directions: the typo spec is refused before anything is created, and a
correct spec builds with `verification.problems = 0` and renders in the UI.

Everything above was read off actual tool output and real screenshots. Nothing is expected-value.

## Live proof ledger — AI agent tools (Plan 5, Task 6)

Account: **GROM AU** (`wdzEoUZnXO9tB3PPzcot`). Date: **2026-07-21**. Real MCP stdio session
using the dual-credential AI rail. All canaries **deleted afterwards**, verified against raw
response bodies.

**This run answers a question open in this project since July: does VoiceAI / Agent Studio
agent-create actually work? It does.** Memory said proven, the skill docs said not. The truth
is that **create succeeds in all three products** and the **follow-up configuration step** is
what fails — a much narrower problem than "create is unproven".

| # | Executed | Observed |
|---|---|---|
| 1 | `auth_status` | Both credentials reported as claims — jwt `uid`/`secondsRemaining`, token-id `issuer`/`role: admin`/`scope: agency`/`secondsRemaining`. No raw token anywhere (regex-checked). |
| 2 | `create_convai_agent` **without** confirm | `CONFIRM_REQUIRED` + compiled plan (`POST /ai-employees/employees`, payload field list). No write. |
| 3 | `create_convai_agent` with confirm | Tool returned `AGENT_VERIFICATION_FAILED` — but the agent **was created** (`T6-convai-canary`, 19:28:17Z). Post-create verification is what failed. |
| 4 | `create_voiceai_agent` with confirm | Tool returned `HTTP_422` — the agent **was created** (`6a5e76ed…`). `POST /voice-ai/agents` takes only `{locationId}` and returns an id; the follow-up `PUT /voice-ai/agents/{id}?publishAgent=true&mode=update` 422s, so the agent keeps GHL's default name ("My Agent 916"). |
| 5 | `create_studio_agent` with confirm | Tool returned `HTTP_400` — the agent **was created** (`7e7751c5…`, 19:30:20Z). A later step 400s. SSE behavior therefore still unconfirmed. |
| 6 | Cleanup | All three canaries deleted (ConvAI 200, VoiceAI 204 ×2, Studio 200), each re-read to confirm. Pre-existing agents left untouched: *Finn*, *Booking Finn*, *Marketing Agency*, *My Agent 811* (2026-06-17), studio agent from 2026-06-29. |

### Status change

`create_voiceai_agent` and `create_studio_agent` were labelled **NOT live-proven**. Their
**create** paths are now live-proven; their **configure/verify** follow-ups are proven
*broken*. Tool descriptions and the skill status table must say exactly that — not "proven",
not "unproven".

### Defects found and fixed by this run

**1. `auth_status` was unusable.** It returned `"jwt": "<redacted>"`. The recursive scrubber
blanks the whole subtree under any secret-*named* key (`jwt`, `tokenid`), so the claims —
including expiry — were destroyed. You could not tell whether your token was about to expire.

The first fix (redact only primitives under a secret key) was **wrong** and three existing
tests correctly caught it: `{credentials:{value:"sk_live_…"}}` would then leak, because that
value is neither JWT-shaped nor under a secret-named key. Fixed instead by renaming the
fields to `jwtClaims` / `tokenIdClaims` — the scrubber stays strict, the metadata survives.
A test now asserts the claims survive the *contract boundary* while the credentials do not.

**2. Misleading remediation on spec rejections.** A compiler/validator error (`mode must be
one of …`) reported *"Gateway transport failed before an HTTP result was available; inspect
account state before retrying"* — sending the caller to hunt account state for what was a
typo, when nothing had been sent. Spec rejections now say *"rejected before any request was
sent — nothing was created."*

### Known gap

`raw_request` has **no `base` parameter**, so it cannot reach
`services.leadconnectorhq.com`. Its `VALIDATION_FAILED` on an AI path is *our own guard*, not
GHL — which during this run briefly looked like "the agent is gone" when the agent was very
much still there. Cleanup had to bypass the server. Worth closing.

### Method note

A throwaway verification script reported **"ConvAI agents: 0"** while the canary existed —
a wrong key guess in the script's own parsing. It was caught only by re-checking the **raw
response body**. Object-shape guesses are exactly as unreliable in verification code as in
engine code; assert against raw payloads when confirming cleanup.

Everything above was read off actual tool output and raw API responses. Nothing is expected-value.
