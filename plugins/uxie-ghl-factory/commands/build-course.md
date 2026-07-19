---
description: Build a GoHighLevel course / membership portal (lessons, quizzes, assignments, credentials, enrollment)
---
Use the ghl-memberships skill for: $ARGUMENTS
Non-negotiables: write rails first; auth is auth-jwt-capture.md §8 (admin rail needs
`sourceid`; the member rail is a different token class — do NOT port workflow CORS handling).
Compile via scripts/build-course.mjs with --dry-run BEFORE any live build, and verify by
read-back, never by status code. State the known limits rather than working around them:
paid offers are unproven (free only), members cannot be provisioned headlessly (OTP-gated),
and the credential auto-issue trigger is attached but unverified.
