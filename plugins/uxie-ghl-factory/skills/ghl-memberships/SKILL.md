---
name: ghl-memberships
description: Build and operate GoHighLevel Memberships via the internal API — courses, chapters with drip/gating, lessons (text, video, audio, PDF, embed), quizzes with questions, assignments, offers, themes, credentials, enrollment, progress and submissions, plus community groups. Use when the user asks to build a GHL course or membership site, create an onboarding/client portal, add quizzes or assignments, enroll or revoke a member, issue a certificate, collect learner-submitted documents, or read course progress.
---

# GHL Memberships Builder

> **MCP routing:** If the `uxie-ghl-internal-mcp` server is registered in this session, prefer its `build_course` / `list_courses` tools over running this skill's scripts directly — the tools wrap this same engine behind confirmation gates and post-build verification. Fall back to this skill's own scripts when the server is not registered.

Writes to a GHL account via the undocumented internal Memberships API.

## Before any write
1. Run BOTH gates in `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md`.
2. Auth: `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` — **§8 is the Memberships section.**
   The admin rail is §1 **plus a `sourceid` header**; the member rail is a different token class.
   Memberships auth is **looser than the workflow builder** — no iframe origin, no `origin`/`referer`.
   Do not port the workflow CORS handling here.

## Fastest path: compile a whole course from a spec

```bash
GHL_TOKEN='<LC JWT>' GHL_LOC='<locationId>' \
  node ${CLAUDE_PLUGIN_ROOT}/skills/ghl-memberships/scripts/build-course.mjs <spec.json> [--dry-run]
```

`--dry-run` validates the spec without touching the account — **always run it first**.
Spec format + a worked example: `references/example-spec.json` and `references/course-spec.md`.

One command produces: course → chapters (order, drip, nesting, gating) → lessons (rich HTML body,
video/audio upload, PDF attachments, external embeds) → quizzes **with questions** → assignments →
free offer (draft; published only when the spec says `publish: true`) → branded theme → credential template **attached to auto-issue on completion**
→ optional enrollment. Then it verifies every item by read-back and prints a teardown command.

Remove: `node scripts/build-course.mjs --delete <productId>`
⚠️ **Offers and credential templates do NOT cascade** — delete those separately.

## Prove the API hasn't drifted

```bash
GHL_TOKEN='<LC JWT>' GHL_LOCATION='<locationId>' node ${CLAUDE_PLUGIN_ROOT}/skills/ghl-memberships/scripts/conformance.mjs
```

Runs the real admin lifecycle live and asserts on **effects, not status codes**
(grant → member appears → revoke → member gone), re-checks the documented traps, and tears down.
**21 passed / 0 failed / 4 skipped.** This is an undocumented API that drifts — run this before
trusting the reference on any account you haven't touched recently. The 4 skips are member-session
writes that cannot run unattended (see Limits).

## Which rail, per job

The public Courses API (2026-09-24) returned the same courses as the internal rail on the sandbox (2026-10-29).

<!-- rail-ledger:courses -->
_generated from knowledge/catalog/rail-ledger.json — do not edit; the whole ledger is `ghl-orientation/references/rail-ledger.md`._

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
<!-- /rail-ledger:courses -->

## Object model

```
Product (course) → Category (chapter, self-nesting) → Post (lesson)
Offer   = access gate        Theme = per-product design tokens
Credential template + attachment = certificate/badge, auto-issued on completion
```

A post carries rich-HTML `description` (the body) + ONE primary media + N `post_materials`.

## Engine API (prefer this over hand-rolling requests)

| Module | Use for |
|---|---|
| `engine/api.mjs` | products, categories, posts, video/audio upload, PDF materials, offers, theme, `setEmbed`, `parseIframe` |
| `engine/members.mjs` | invite, magicLink, **grantOffer/revokeOffer**, publishOffer, productProgress, allMembers, waitForEnrollment |
| `engine/assessments.mjs` | quiz + **addQuestions**, assignments, listSubmissions, **grade** |
| `engine/credentials.mjs` | template CRUD, **issue**, listIssued, **attach** (auto-issue on completion) |
| `engine/communities.mjs` | admin group CRUD + `CommunitiesMember` (portal rail: join, createPost) |

## Traps that will cost you hours

1. **`contentType` is a CLOSED MySQL ENUM: `video | audio | quiz | assignment` — or OMIT it.**
   GHL has no `text` lesson type. A text lesson is a `video`-typed post with the text in its description: send
   `contentType: 'video'` explicitly and put the text in `description`. Do not read a `video` read-back on a text
   lesson as a bug. `text`/`embed`/`html`/`pdf`/`file`/`link` all return
   `500 Data truncated for column 'content_type'`. There is no embed or PDF *lesson type*.
2. **Embeds: `POST /posts` SILENTLY DROPS `embedJson`.** It returns 200 and the embed is simply
   absent on read-back. **Create the post, then PUT it** (`api.setEmbed()`). The server mints
   `metaData.embedMediaId` itself — you never create that id, which is why no "embed media"
   endpoint exists.
3. **`quizId !== postId`.** `POST /assessments/quiz` creates it; re-read via
   `getQuizByPost(postId)` to get the quiz's own id, which is what the questions endpoint wants.
4. **Auto-issue a certificate is a course-level ATTACHMENT**, not a field on the lesson
   (`credentials.attach()` → `certificate-attachments`, `eventType: product_complete`).
5. **The category tree is a PARTIAL projection** — `GET /categories?posts=true` omits
   `post_materials` and `asset_urls`. Verify lessons with `GET /posts/{id}` or you get false negatives.
6. **Theme needs TWO calls**: PUT the theme, then PUT `products/apply-theme` — saving alone does nothing.
7. **`user-purchase/no-of-users` lies about enrollment** — it counts purchases, returns 0 for an
   admin-attached member. Verify with `products/user-progress`.
7b. **The grant's own 200 lies too, and it is the worse of the two.**
   `POST /membership/smart-list/attach-offer-user` answers
   `200 {ok:true, msg:"…successfully queued"}` for an **empty body**, for fabricated ids, and for
   the wrong key names — proven on the test sub-account, with a nonexistent sibling path answering
   404 as the control. Two operators have been told a grant was queued and granted nothing. The
   body is `{contactId, offerId, source:'admin'}` — **singular `contactId`, no `locationId`** (that
   rides on the `sourceid` header). Then read back: `members.waitForEnrollment(productId,
   {expectContactIds})`, which looks for **those contacts**. A non-empty check is not a check —
   it passes on a member who was already there.
8. **Deletes don't cascade to offers, credential templates, or assessment submissions.**
   Submissions have no delete route at all.
9. **assets-drm wants a LEADING SLASH** on the `path` that `signed-url/upload` returns without.
   Client supplies `durationInSeconds` (ffprobe).
10. **Community group list reads are eventually consistent (~1.5 s)** — don't assert a write failed
    on one immediate re-read.
11. **A UI Save that "fires no request" is usually a lie.** Twice on this surface it was a
    product-tour overlay (`fd-tour-overlay`, Pendo `#pendo-base`) swallowing the click, or a
    too-narrow network filter — GHL splits one feature's read and write across `membership/`,
    `courses/`, `services/` and `clientportal-middleware/`. Re-check with a **host-level** filter
    before concluding a flow is client-side.
12. **`createGroup` sends `marketplaceLocationId` (the UI's Discovery switch ON) unless `discovery: false`** (2026-10
    switch, default ON as in the UI; OFF omits the key — that the group then stays off the marketplace is the switch's
    stated purpose, not separately observed). Ask the operator which they want for a private client community.
13. **Moderation keywords live on the ADMIN rail too** — group rows carry `settings.moderationSettings.blockedKeywords`
    and the admin group PUT writes them (the portal read then shows them, proven 2026-10-30). Read the row and send
    `settings` back whole with your change. Owner and admin posts are **never held**, so testing a keyword as the
    owner proves nothing; the held queue and member reports are portal-only (403).
14. **Notification preferences are one document per member per group**; the portal UI's save also turns the
    member's `newsletter` push OFF (no push control on that row) — do not copy the UI's body.

## Proof levels — know what you're trusting

- **EXECUTED** (built and sent from code, effect asserted): everything the conformance suite covers,
  plus contacts, media rails, themes, embeds, credential attach.
- **OBSERVED only** (transcribed from the UI, never re-issued independently): `assessments.grade()`,
  learner submission, `user-post-completion`. All member-session-bound; each was driven live through
  the real portal and verified by read-back, but a field the UI sends and we failed to record would
  only surface on first use. `grade()` is marked in-source.

## Limits (state these rather than working around them)

- **Paid offers are supported by the engine but need a connected payment integration** (bl-877). On a sandbox with none, a paid create returns `400 Integrations not found`. The enum is `onetime` (or `subscription`); `one_time` and `recurring` return 500. Checkout is unproven. Only `free` is proven end to end.
- **Members cannot be fully provisioned headlessly** — portal signup is OTP-gated. See auth §8.3 for
  the softer path (the user record exists before OTP verification).
- **Whether the credential attachment FIRES on completion is unverified** — it's created and reads
  `status: active`, but no member has completed a course to watch it issue.
- **Module-level credential attachment** (`altType: "category"`) is implied by the response shape,
  not verified — `attach()` only exposes product level.
- Community channel create/update, and pending-invite list/revoke (403), are uncaptured.

## Editing a course (public rail, ghl-multi)

Course editing is **public-only** (Xander, D3, 2026-11-06). Use `execute_action` on the ghl-multi server with these action ids. Every
write takes `dry_run: true` first; read the preview; then send the same call with `confirm: true` where the server asks.
After every write, read the course back with the internal `get_course` (one read: title, offers, normalised tree) and compare.

| Job | Action | Notes |
|---|---|---|
| change a lesson | `courses-v3__update-lesson` `{productId, lessonId, …fields}` | partial body: only the fields you send change (measured 2026-11-06) |
| change a chapter | `courses-v3__update-category` `{productId, categoryId, …fields}` | partial body (measured) |
| change the course | `courses-v3__update-course` `{productId, …fields}` | partial body (measured) |
| reorder chapters | `courses-v3__sequence-categories` `{productId, ids}` | `ids` lists every chapter in order (measured) |
| reorder lessons in a chapter | `courses-v3__sequence-lessons` `{productId, categoryId, ids}` | `ids` lists every lesson of that chapter in order (measured) |
| move a lesson to another chapter | `courses-v3__update-lesson` with `categoryId`, then `sequence-lessons` on the new chapter | two calls, see trap 3 |
| remove a lesson | `courses-v3__delete-lesson` `{productId, lessonId}` | 204; the lesson then 404s (measured) |
| remove a chapter | `courses-v3__delete-category` `{productId, categoryId}` | **cascades**: its lessons go with it (trap 2) |
| remove a course | `courses-v3__delete-course` `{productId}` | 204 (measured on a probe product) |
| add a lesson or chapter | `courses-v3__create-lesson` / `courses-v3__create-category` | create as `visibility: "draft"` unless the user has asked to publish |

Traps (the first three are measured on the sandbox; the rest are from the same runs):

1. **A reorder that names only some lessons is not measured.** Always send every lesson of the chapter in `ids`. What the server
   does with unnamed lessons is unknown, so do not rely on them keeping their place.
2. **Deleting a chapter deletes its lessons.** Before `delete-category`, list the chapter's lessons (`get_course`) and say so to
   the user. The internal route also cascades (measured), so this is not a rail difference.
3. **A cross-chapter move is two writes, and the lesson keeps its old number.** `update-lesson` with `categoryId` moves the
   lesson but does not renumber it (measured). Follow it with `sequence-lessons` on the new chapter, naming every lesson in order,
   or the moved lesson can collide with an existing number.
4. **Do not use the internal whole-document PUT for these edits.** The internal routes take the full object (the engine sends it
   whole), so an edit there is a read-modify-write of the whole object. The public routes merge a partial body (measured).
5. **Deleting an offer reads back as a ghost.** `courses-v3__delete-offer` returns 204, but a later `get-offer` returns 200
   with an empty body. Verify an offer removal with `get_course` (the offers list), not with `get-offer` (bl-801).
6. **Do not use `courses-v3__upsert-quiz-questions` to edit questions.** It replaces the whole question set (measured: two
   questions gone when one was sent) and the option text is not read back. To add questions, use `edit_quiz_questions` (below).
7. **Gated, do not run without the owner's go:** publishing a course, chapter, lesson, offer or channel (the spec's `visibility:
   "published"` or any `*-publish`); any paid offer; any enrolment or grant that e-mails a member (G4). A dry run of these is fine.

## Granting and revoking access

- Internal: `set_course_access {locationId, contactId, offerId, action: grant|revoke, confirm}`. Preview first (no account call; `sends` says
  whether a grant e-mails the member: `unknown` for a grant, not yet measured; `false` for a revoke). Confirmed, it reads the course membership, sends
  the change, reads it again, and reports `granted`, `already-had`, `revoked`, `already-absent` or `queued-unconfirmed`. Trust the outcome, never the 200.
- Public: `courses-v3__create-enrollment` (201 new, 200 `alreadyEnrolled`), `courses-v3__delete-enrollment` (revoke), `courses-v3__list-enrollments` (read back).
- **A draft offer still grants access.** A public enrol into a free draft offer answered 201 and read back (bl-833). Do not treat an offer's draft
  status as a guard. Never put anything confidential in an offer, and treat its id as public (an unauthenticated GET of `/membership/offers/{id}`
  returns the draft, with the location and feature flags, bl-321).
- A grant or enrol may e-mail the member. Every send is a gated action (G4) for a real student. Check the preview `sends` before confirming.

## Progress and completion

- Internal: `get_course_progress {locationId, courseId, email?}` walks every page and returns each student's course percent (`completedPercentage`),
  the user's e-mail and `lastLogin`, plus a per-course summary. `complete: false` (with `failure`) means the walk did not finish: do not read a
  partial list as the whole course. The internal route gives **no lesson counts**, so `completedLessons` is null there.
- `lastActivity` on that tool is the last **login**, not the last lesson. Do not read it as lesson activity.
- Public (ghl-multi): `courses-v3__list-bulk-progress {contactId, productIds}` returns `totalLessons` and `completedLessons` for a student, and
  `courses-v3__list-category-progress` and `courses-v3__list-completions` give per-chapter progress and completions.
- **Caveat (bl-834):** on the sandbox the public bulk route returned `totalLessons: 0` for a student on a course with 6 lessons. The likely cause is that
  the lessons were draft (a count of published lessons only). This is untested: it needs a published lesson, which is a gated publish. Until it is settled,
  do not trust a `0/0` lesson count without checking the lessons' visibility first.

## Quiz questions and grading

- **Add questions in a batch:** `edit_quiz_questions {locationId, quizId, add: [{title, questionType, explanation?, options: [{statement, isCorrect}]}], confirm?}`.
  `quizId` is the **quiz** id (the one `GET …/assessments/quiz/{postId}` returns), not the lesson id. Preview first (no write). A single-choice question
  needs exactly one correct option; duplicate question text in one batch is refused before anything is sent.
- **The batch write replaces the whole question set** (measured on the sandbox, 2026-11-07: a one-question add to a quiz holding one question left two,
  and the stored one was gone). So a confirmed `edit_quiz_questions` re-posts every stored question in full, then the additions, and it is refused
  before any POST when a stored question's option text cannot be read. It reads the quiz again on a separate request and reports `added` only when that
  read matches the expected set by content (question ids change on every save, so they are not compared, and a question id kept from before an edit is stale); otherwise `unverified`, with the full before list. A failed batch POST is read back the same way (the route replaces, so a failed POST may still have changed the set): the result carries `postFailed` with the HTTP status, and the after read.
  Its `replace` argument is refused. Do not reach for `upsert-quiz-questions` (trap 6).
- **Grade a submission (public):** `courses-v3__list-assessments {productId, status?, pageSize?, pageNumber?}`, `courses-v3__get-assessment {productId,
  assessmentId}`, and `courses-v3__review-assessment` (PUT) with body `{status: passed | failed | processing, score?, feedback?}`. A grade is visible to
  the learner. Only a submitted attempt can be graded, so the grading route needs a learner who has submitted in the portal.
- **Not exposed:** the internal `Assessments.grade()` is observed only (transcribed from the admin UI) and needs a member session. Do not present it as a tool.
- **Not yet proven on the sandbox:** a learner's quiz or assignment submission and its grade. That leg needs a portal session and is tracked on the
  backlog (bl-842), not run in this build.

## Communities: paid channels and plans (know about)

- Announced 2026-11-02: **paid channels** and **multiple pricing plans** in Communities. Nothing here reads a paid flag, a plan or a price: the admin rail's group and location records carry no such key, and channel paid flags sit behind the PORTAL_USER scope.
- **Every write is unproven.** Creating a paid channel, creating or editing a pricing plan, and connecting a payment provider for Communities are all paid actions and gated. Do not run them to "test" the route.
- Know-about only: which surface shows what, and what is still open, is in the corpus page `70-research/2026-11-06-communities-paid-channels-and-know-about.md`.
- Course video analytics and the Discover Courses & Offers storefront have no route taught here; the courses analytics routes in the endpoint index are proven for dashboards, not for video watch data.

## Routes with a proven raw_request write (settings, CSS and code, instructor fields, portal users)

These operations have no typed tool. Each one was proven on the sandbox (the write, then a read on a separate request, then a restore), so the
route and body shape below are evidence, not a guess. Send them with `raw_request {locationId, method, path, body, confirm: true}`. Preview first
where the tool offers it, and never send a body whose keys you have not read first: several of these writes replace the whole object.

- **Course CSS, custom code and header/footer (product document):** `PUT /membership/locations/{locationId}/products/{productId}` with the FULL product
  object (read it with `GET` on the same path first). The custom fields are `customCss`, `customJs`, `customHeader`, `customFooter`. Proven: set to a TEST
  value, read back on a separate GET, restored to `null`. Clearing a field back to `null` works; an empty string is not the same and is not used.
- **Instructor name, title, bio and heading (customization):** `PUT /membership/locations/{locationId}/products/customizations/{customizationId}`, with
  the customization record read first (`GET /membership/locations/{locationId}/products/{productId}`, the `customizations` block). Proven: name, title and
  bio set and read back, the heading read back unchanged, then restored.
- **Course site settings (site title, domain, builder settings):** three separate settings routes, sent together on one Save in the admin UI:
  `PUT` on the domain route, the site-info route (title) and the builder-settings route (`downloadOption`, `pwaEnabled`, `appSettings`). Each body
  must equal the value you read (a route that is not sent is left alone). Proven: site-info title set to a TEST value and read back on a separate GET,
  then restored to the original empty string. Read the three keys before the write; a body that differs from the read is refused by the guard.
- **Portal settings (portal banner text, app permissions, and the other portal-settings keys):** `PUT /clientclub/portal-settings/{locationId}` with the
  full document. The keys the GET carries must equal the read value, except the one test field. Keys the GET does not carry are sent only as the form's
  own defaults. Proven for `portalBannerText` and for app permissions: set, read back on a separate GET, restored. Once a portal name is set the UI
  cannot clear it (an empty name is refused before any request), so a name is a one-way write on a sandbox.
- **Invite a portal user:** `POST /clientclub/{locationId}/users/invite` with the contact's email as the body field the invite form uses. It returns
  `201 {success: true}`. The invite is not visible in the portal-settings totals until the person signs up (read `invitedUsers` instead). It sends a real
  invite mail: only to a TEST contact you own, never to a real person.

Not covered here: course analytics progress and the analytics dashboards (their data is `POST /courses/analytics/...` queries; the progress view has
no proven write), and learner-side rendering. Those stay as the corpus describes them.

## Full reference

`references/course-spec.md` — spec format.
Semantics and capture evidence: the corpus surface `knowledge/corpus/memberships-courses/`, the
source of truth for anything this file summarises. The **endpoint index** is `search_endpoints`
on the internal MCP: every `/membership/*`, `/courses/*`, `/certificates/*` and `/clientclub/*`
route, mined from the memberships front-end's own source — most never exercised here.
`describe_endpoint` gives the exact `raw_request`, and `raw_request` sends the `sourceid` this
surface's front-end pins. The engine modules above remain the way to WRITE: a catalogued route is
a path, not a proven write.
