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
free offer (published) → branded theme → credential template **attached to auto-issue on completion**
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
   A text-only lesson omits the key. `text`/`embed`/`html`/`pdf`/`file`/`link` all return
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

## Proof levels — know what you're trusting

- **EXECUTED** (built and sent from code, effect asserted): everything the conformance suite covers,
  plus contacts, media rails, themes, embeds, credential attach.
- **OBSERVED only** (transcribed from the UI, never re-issued independently): `assessments.grade()`,
  learner submission, `user-post-completion`. All member-session-bound; each was driven live through
  the real portal and verified by read-back, but a field the UI sends and we failed to record would
  only surface on first use. `grade()` is marked in-source.

## Limits (state these rather than working around them)

- **Paid offers are unproven** — `one_time`/`recurring` return 500 without a payment provider
  connected. Only `free` is proven; `build-course.mjs` rejects paid offers at validation.
- **Members cannot be fully provisioned headlessly** — portal signup is OTP-gated. See auth §8.3 for
  the softer path (the user record exists before OTP verification).
- **Whether the credential attachment FIRES on completion is unverified** — it's created and reads
  `status: active`, but no member has completed a course to watch it issue.
- **Module-level credential attachment** (`altType: "category"`) is implied by the response shape,
  not verified — `attach()` only exposes product level.
- Community channel create/update, and pending-invite list/revoke (403), are uncaptured.

## Full reference

`references/course-spec.md` — spec format.
The complete endpoint map, schemas, and capture evidence live in the research repo
(`ghl-memberships-recon/BUILD-API.md` + `captures/`), which is the source of truth for anything
this file summarises.
