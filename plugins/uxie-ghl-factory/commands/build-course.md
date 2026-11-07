---
description: Build a GoHighLevel course / membership portal (lessons, quizzes, assignments, credentials, enrollment)
---
Use the ghl-memberships skill for: $ARGUMENTS
Non-negotiables: write rails first; auth is auth-jwt-capture.md §8 (admin rail needs
`sourceid`; the member rail is a different token class — do NOT port workflow CORS handling).
Compile via scripts/build-course.mjs with --dry-run BEFORE any live build, and verify by
read-back, never by status code. State the known limits rather than working around them:
paid offers need a connected payment integration (bl-877) and their checkout is unproven, members cannot be provisioned headlessly (OTP-gated),
and the credential auto-issue trigger is attached but unverified.

W8 routing (2026-11-07, skill "Which rail, per job"): build_course creates draft throughout (bl-796 fixed; a publish is a separate
gated step). Course edits go through the public courses-v3 actions (update, sequence, delete); course creation stays on the
internal rail. Adding quiz questions goes through edit_quiz_questions, which re-posts every stored question (the batch write
replaces the whole set and re-mints every question id, bl-843); it never uses courses-v3__upsert-quiz-questions. A free draft
offer can be enrolled into (bl-833): a draft is not private (bl-321). Progress reads have no lesson counts on the internal route
(bl-834). Grading needs a portal submission (bl-842).
