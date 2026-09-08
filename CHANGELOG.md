# Changelog

All notable changes to the `uxie-ghl-factory` plugin are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The plugin ships **two manifests over one tree** — `.claude-plugin/plugin.json` (Claude Code)
and `.codex-plugin/plugin.json` (Codex). Both carry the same version, enforced by
`scripts/check-manifest-parity.mjs`; a version recorded here is a version both harnesses see.

This file starts at 0.25.0. Earlier releases are recorded in the git history, where the
commit bodies carry the detail.

## [0.66.0] — 2026-09-09

Three shipped claims that had nothing behind them, and the snapshot push tool that waited for its brake.

### Added

- **`push_snapshot`** — loads a snapshot into sub-accounts. Deliberately not built until
  `unpublish_workflows` existed *and* `change-status` was proven live: on the operation that
  already put 26 workflows live on an account taking ~230 enrollments a week, shipping the
  accelerator before the brake was the wrong order.

  Two rails, both from the finding that asked for it:

  - **`assets` is required and explicit.** The wizard's Assets step renders no Workflows row
    while the body it sends carries every workflow id in the snapshot — a tool that mirrors
    the UI ships workflows nobody chose. A category you do not name ships as an empty array.
  - **Published workflows are refused.** It reads each selected workflow on the snapshot's
    source account and stops, returning the stand-down plan rather than only the complaint.
    `allowPublishedWorkflows: true` overrides and still returns the plan.

  A third rail nobody asked for: an id that cannot be **read** is reported `UNDETERMINED`,
  not safe. A folder id lives inside `workflow` and reads as neither published nor draft, and
  folding it into "not published" is how a live workflow slips through a check that looks
  like it passed.

  The stand-down plan matches by **name** — the load mints new ids on each target, so the
  pushed source ids are useless there.

  It never claims verification: the push answers "queued", so the result carries
  `queued: true, verified: false` and says so.

### Fixed

- **`unpublish_workflows` no longer states two things it never proved.** Its description
  quoted the missing-`updatedBy` 400 as `{"message":"Invalid value updatedBy"}`; the server
  says `"updatedBy is required and must be a non-empty string"`. A wrong quoted string is
  worse than none — it is what a caller writes a matcher against. It also asserted that draft
  "does not remove contacts already in flight". The probe workflows carried no enrollments, so
  that question was never asked; it is now disclosed as unproven, in the description **and** in
  the two runtime notes that repeated it.

  Newly documented: the refusal carries a **full `results` envelope** (`failedUpdates: 1`,
  `details` naming the workflow), so a caller keying on the presence of `results` rather than
  on the status code reads a refusal as a result.

- **`check_snapshot_conflicts` required `assets`, and stopped letting an empty result read as
  clearance.** The API answers `400 ["selectedSnapshotAssets must contain at least one asset
  key"]` — there is no "check everything" call — so the tool now refuses before the wire and
  names `get_snapshot_manifest` as where ids come from.

  More important: a conflicts check run against a target that provably holds every asset in
  the snapshot returned **empty for all ten categories asked**. The list holds the *snapshot's*
  ids the server reports as colliding, and the app only flips "no conflicts" when a returned id
  matches — so "No conflicts found" means nothing matched, not nothing collided. Treat an empty
  result as no information, not as clearance.

- **The `ghl-funnels-pages` skill was shipping advice that destroys data.** It said
  `funnel/update-settings` ignores empty strings and therefore *"you can safely send the full
  payload without wiping fields you did not mean to touch"* — beside a payload whose defaults
  are all `""`. Empty strings **are** applied and **do** clear: `faviconUrl`,
  `headTrackingCode` and `bodyTrackingCode` each stored a canary and each came back empty after
  a subsequent `""`, proven set → read → clear → read. Following that advice on a live funnel
  wipes its tracking codes and favicon and detaches its chat widget.

- **Chat-widget attach/detach moved from "UI only" to supported.** `update-settings` does both,
  proven live; the server derives `isChatWidgetLive`, so callers must not send it.

- **The SEO recipe stopped blaming a missing credential.** It told readers to extend the auth
  capture, which would not have helped: the capture already holds a Firebase ID token
  (`securetoken.google.com/highlevel-backend`, admin/agency, self-renewing). Firestore's rules
  simply refuse it `funnel_pages` — proven by differential against a collection the same token
  reads fine. Also recorded: a collection **list** is denied even where `documents:runQuery`
  succeeds, so its `403` is not evidence of a bad token.

### Catalogue

- `POST /snapshots/snapshot-asset-mapper/{snapshotId}/conflicts` — a third conflicts route,
  taking `locationIds` / `selectedAssets`, the exact key names the other two refuse. Source-derived;
  not called, because "mapper" may mean it writes.

## [0.65.0] — 2026-09-09

A 401 that was never about the credential, sending callers to re-capture a working token over a typo.

### Fixed

- **A 401 whose body names a missing request field is now `VALIDATION_FAILED`, not `TOKEN_EXPIRED`.**
  Proven by differential on the sandbox, across 29 calls on one token:

  ```
  POST /opportunities/pipelines/permissions  body {}            -> 401
      {"statusCode":401,"error":"Unauthorized",
       "message":"pipelineId can't be undefined","code":"COMMON_PIPELINE_ID_UNDEFINED"}
  POST /opportunities/pipelines/permissions  body {pipelineId}  -> 422
  ```

  Same endpoint, same credential, seconds apart; the only difference is one key in the request
  body. `fromHttp` mapped every 401 to `TOKEN_EXPIRED`, so a missing field sent the caller to
  re-capture a credential that was doing authenticated work on both sides of the call — a browser
  login, to fix a typo.

  The check reads the **body**, not the path, because GHL is inconsistent with itself:
  `COMMON_PIPELINE_ID_UNDEFINED` is a 401 while its sibling `COMMON_LOCATION_ID_UNDEFINED`, on
  `POST /opportunities/pipelines` on the same service, is a 422. The status does not say what went
  wrong.

  `isValidationBody` is deliberately narrow — GHL's own `COMMON_<FIELD>_UNDEFINED` code family, or
  a message of the exact shape `<field> can't be undefined`, and nothing else. A real expiry says
  `Unauthorized` and names no field, and still lands on `TOKEN_EXPIRED`. The tests pin the
  near-misses as hard as the hits.

### Changed

- **The server instructions no longer imply only one 401 exception.** They said a 401 saying
  "version header was not found" is not an auth failure. They now say to read the body before
  believing the status, and name both exceptions.

## [0.64.0] — 2026-09-07

An endpoint that says "successfully queued" for an empty body, and the read-back that was not checking anything.

### Fixed

- **The course grant's 200 is not evidence, and nothing said so.**
  `POST /membership/smart-list/attach-offer-user` — the call that puts a member in a course — answers
  `200 {ok:true, msg:"The request to attach the offer to the user has been successfully queued"}` for an
  **empty body**, for fabricated ids, and for the wrong key names. Proven on the designated test
  sub-account, with the control that makes it a measurement rather than an impression: a nonexistent
  sibling path answers `404 {"msg":"Not found"}`, so the uniform 200 is that route replying and not a
  catch-all swallowing the prefix. Nothing is validated at the edge. Two operators have now been told a
  grant was queued and granted nothing — the body is `{contactId, offerId, source:'admin'}`, **singular
  `contactId`, no `locationId`** (that rides on the `sourceid` header), and an undeclared plural key
  falls through while the declared one arrives absent.
- **`waitForEnrollment` returned on ANY non-empty page, which discriminates nothing.** A product that
  already has members satisfied it on somebody else's row, and granting three contacts satisfied it the
  moment one landed — both reported a confirmed enrollment nobody had checked. It now takes
  `expectContactIds` and resolves only when every one of them is present, naming the ones still absent
  when it gives up. Progress rows carry `contactId`, so the contacts granted are the contacts matchable.
- **`build_course` reported every accepted grant as an enrollment.** Its result now separates `granted`
  (what was sent, which the 200 does not vouch for) from `enrolled` (what the read-back actually found),
  and names the difference in `enrollmentUnconfirmed` instead of leaving a caller to infer it from a
  null count.
- **The conformance run asserted a row COUNT where it meant a specific member.** It now asserts that
  *this* contact appears, and re-checks the empty-body ack as a trap so the rule stays true rather than
  merely written down.

### Changed

- **An overlay row aimed at a typed-tool endpoint now reaches it.** The eight rows adopted from the
  capability manifest — the strongest evidence in the catalogue, since a shipped tool calls each of them
  on every run — were the only rows the hand-maintained overlay could not annotate. A key aimed at one
  orphaned instead, which is how `attach-offer-user` shipped with `body: unresolved` and no trap note
  while the corpus had carried its proven body for months. Adopted rows now take `kind`, `summary`,
  `note` and `reach` from the overlay like every other row, and an orphan warning means what it says
  again. `describe_endpoint` for that path now states the exact body and what its 200 does not mean.

## [0.63.1] — 2026-09-07

The wait-name rule was never firing, because the harness did not reproduce the canvas merge.

### Fixed

- **`waitValidator`'s name-length check is live again.** It reads `attributes.name`, and a stored
  workflow document keeps the display name on the **step row** — `attributes.name` is absent on
  essentially every step, so replaying the validator against the document short-circuits and that
  rule silently never runs. It is not dead in the product: `models/conditions/Wait.ts` constructs
  with `attributes.name || name` and serialises `this.attributes.name = this.name`, so the builder
  merges the row name in when a wait passes through its model. The runner now does the same.
  Applied to `wait` **only** — it is the one model that merges the ROW name; the interactive
  messenger and custom-object actions also write `attributes.name` but set a *derived* label, so
  copying the row name onto them would feed the validators something the builder never produces.
  An existing `attributes.name` is never overwritten.

## [0.63.0] — 2026-09-07

`check_workflow` now runs GHL's own validators instead of only describing what it cannot check.

### Added

- **The builder's validators, replayed over the API.** GHL validates a workflow client-side and
  nothing on the API rail does. Its 67 recovered validator bodies turn out to be runnable, so
  `check_workflow` compiles them into one shared scope — they call each other — and runs them.
  On a published workflow this took coverage from **7 of 35 steps to 25 of 35** and immediately
  found a defect the publish endpoint had accepted: an `assign_user` step pointing at a user that
  no longer exists.
- **`builderValidators`** in the result: `findings` (entries the error panel would show),
  `resourceLookups` (deferred existence checks the builder posts to the server — normal, numerous,
  and not problems), `uncheckedByType`, `crashed`, and `helperFidelity`. **Read `uncheckedByType`
  before `findings`:** zero findings over few validated steps is not a clean workflow.
- The headline names both passes rather than one.

### Fixed

- **`waitValidator` crashed on every named wait step**, because `isWithinLimits` was missing from
  the helper preamble. Found by running the port on an account that had one; ported faithfully from
  the recovered `utils/validation.ts`.
- **The coverage number is 61, not 136.** 136 type cards carry a `Validator` line and 118 name one,
  but only 61 have a body in the capture — the remainder are mostly *trigger* validators, which this
  capture does not include. Reporting the larger number would overstate coverage by more than double.

### Security

- The validator bodies are evaluated with `new Function`, so they are **embedded at build time and
  never sourced from the wire**, and the compiler refuses any entry that does not bind the
  identifier it is filed under — rejecting the whole set rather than one entry. Provenance is the
  control; the shape check exists so a tampered or truncated artefact fails loudly instead of
  compiling into something that looks like GHL.

## [0.62.1] — 2026-09-07

`check_workflow` now says what a zero error count does not mean.

### Changed

- 🔴 **GHL enforces a validator on 51 of 385 step types**, and the result now says so. The coverage
  note already said native steps are skipped rather than asserted clean, which reads like a limit of
  this tool; the larger fact is that it is GHL's hole and reproducing the builder more faithfully
  would not close it. The uncovered set is the one authors use most — `if_else`,
  `task-notification`, `goto`, `transition`, `find_opportunity`, `internal_update_opportunity`,
  `workflow_ai_decision_maker` — so **the builder's own Check Errors panel is blind to them too**.
  Measured on our mined rule set and corroborated by another operator replaying GHL's 67 validator
  bodies over 853 live steps: 528 validated, 325 with no validator to run.
  `task-notification` has no GHL validator at all, which is why the inner-type defect fixed in
  0.62.0 could sit published across 23 workflows: the *"Due date is a required field"* message that
  eventually exposed it comes from the drawer's Vue form, and that runs only when a human opens the
  step.

## [0.62.0] — 2026-09-07

A compiler bug that shipped 33 broken steps to one account, and the check that should have caught it.

### Fixed

- 🔴 **`task-notification` was built with the wrong inner type.** The compiler stamped
  `attributes.type` from the step row for every type, so the hyphenated row type landed inside
  `attributes` where GHL wants the **underscore** form. Such a step saves `200`, publishes clean and
  round-trips clean — GHL's publish validator does not inspect native step attribute shapes — and
  then the builder's task drawer cannot bind its model, falls back to its FIRST required field, and
  reports **"'Due date' is a required field"** on a step whose `dueDate` is set. Reported with 33
  live instances across 23 published workflows on one account, 33 hyphen and 0 underscore, because
  the engine stamped it rather than the author.
  Scope measured, not assumed: of the 56 types with a captured example carrying `attributes.type`,
  three diverge from their row type. Two are discriminators with their own builders
  (`internal_notification` carries the channel, `wait` the subtype); `task-notification` is the only
  rename. A test derives that set from the captures and fails naming any fourth.
- **`check_workflow`'s headline no longer impersonates the builder.** It read exactly
  `"Resolve N Errors"` — the builder's banner, word for word — while measuring only
  marketplace-described steps, and said `"Resolve 0 Errors"` about the very workflow whose builder
  banner read `"Resolve 1 Errors"`. The coverage note was honest and got read past, because the
  headline looked like a verdict. It now states its own scope:
  `"Resolve 0 Errors (1 of 17 steps checked)"`. A comment claiming the headline was a live-proven
  exact reproduction of the builder's panel is deleted, being disproven.

### Added

- **`check_workflow.nativeShapeIssues`** — a card-driven pass over the native steps the marketplace
  catalog does not describe, catching this class in workflows already built. Reported separately
  from `errorCount`, like `marketplaceDrift`, so the count keeps one meaning.
- **The opportunities surface, mapped.** The remote ships no source maps, so the request builders
  were mined from its 52 minified chunks and then executed: four forecast reports (all `POST`, all
  answering `201` for a read) with their enums recovered by probing, and the `smart-filters`
  collection — one route serving both saved views and smart tags, scoped **per pipeline**, with
  machine-readable error codes. 5 catalogue rows on that surface became 18.
- 🔴 **A `404` on the `/opportunities/` prefix is never evidence a route is absent.** The service
  reads any unmatched segment as an opportunity id and answers `OPPORTUNITY_NOT_FOUND` — the same
  trap as `/knowledge-base/`, now recorded on both.

## [0.61.0] — 2026-09-07

Typed tools for snapshots, four uncatalogued routes drained, and a test gate that was missing 962 tests.

### Added

- **Five snapshot tools** — `list_snapshots`, `get_snapshot_manifest`, `check_snapshot_conflicts`,
  `create_snapshot`, `refresh_snapshot`. This surface is **agency-scoped**, so a mistake is not
  confined to one sub-account, and three of its four traps are silent. `create_snapshot` uses the
  appengine endpoint (the legacy one captures any category you omit *whole*), validates every id
  against the account's own manifest before writing, and diffs the stored contents afterwards —
  a bad id otherwise answers `200` and produces an EMPTY snapshot with nothing reported.
  `refresh_snapshot` refuses an empty selection, which would re-capture the whole account and
  silently replace a curated snapshot. `check_snapshot_conflicts` sends the key names the server
  wants rather than the ones the wizard displays, which answer `400 ["Required","Required"]`.
- **Four catalogue routes** our own skills named and the catalogue lacked, each probed with ids that
  do not exist so nothing was written: `PUT /voice-ai/actions/{actionId}` (agentId and locationId go
  in the **body**), `PUT /calendars/events/appointments/{eventId}`,
  `POST /contacts/{contactId}/workflow/{workflowId}`, and `POST /knowledge-base/` — whose **trailing
  slash is load-bearing**: without it the same request answers `404` with an empty body and reads as
  "no create route". 1065 rows.

### Fixed

- **`npm test` never ran the skills' own suites.** It globbed `mcp-internal/test` only, so 962 tests
  across 78 files — the compiler, the lints, memberships, fast-forward — were invisible to the
  release gate, and a compiler regression could have shipped green. 1174 → 2149 tests.
- **The agency id was unreachable.** `auth.mjs` parsed `companyId` from the JWT and the return
  statement dropped it, and these tokens carry no such claim regardless. It now rides alongside
  `uid`, and the snapshot tools resolve it from `GET /locations/{locationId}`.
- **"There is no Conversation AI snapshot category" was wrong**, and the corpus contradicted itself
  about it. Measured: `asset-names` returns 51 categories including `conversation_ai`, and the test
  sub-account offers 2 of them. The operational conclusion holds — a flow bot still does not travel —
  but the category exists and holds AI *employees*. The skill and both corpus pages now say so.

### Changed

- **The catalog's declared `requiredFields` stays advisory, now with a measurement behind it.**
  Replaying every type's declaration against its own verified-live capture: 19 of 39 captures
  *violate* their own declared requirements, a 49% false-positive rate, because the declaration is a
  variant union rather than a requirement. Promoting it — even to the warn tier — would fire wrongly
  on half of all step types. Enforcement coverage cannot be widened by mining; only by capture.

## [0.60.2] — 2026-09-07

`create_smart_list`'s envelope is render-proven, so its advice now points at what is actually open.

### Changed

- **The result's `verification` line no longer sends operators to re-check the nesting.** It said only
  a browser could prove what the operator sees, which was true when the tool shipped and is no longer
  the open question. Measured in a logged-in browser against a control on the designated test
  sub-account: a list built by this tool showed **5 of 239** contacts with `Filters (1)` and no banner,
  while the same filter written one level flatter showed **all 239** with an "unsaved changes" banner.
  Same account, same user, same tag, same minute — only the nesting differed. The line now states the
  envelope is render-proven and points at the one thing an API still cannot answer: whether the
  operator's own filter selects the contacts they meant.

### Proof

- The negative case had to be written on the raw rail, because `create_smart_list` refuses to emit a
  one-level envelope. That refusal is the tool's entire purpose, so obtaining the control meant
  bypassing it deliberately. The broken list is left in place and named; there is no delete on this rail.

## [0.60.1] — 2026-09-07

The create-only opportunity helper skips on a duplicate; it does not fail the run.

### Fixed

- **`create_opportunity_strict`'s refusal text was wrong about the consequence.** It said the
  create-only helper "fails 400 duplicate opportunity when one exists". Runtime differential on the
  designated test sub-account says otherwise: the call does answer `400 OPPORTUNITY_NO_DUPLICATE`
  (with `meta.existingId` naming the card already on the contact), but the workflow records the step
  as `status: "skipped"`, `isSkipped: true`, `needRetry: false`, and the contact walks on to the end
  of the run. Nothing is marked failed and no error notification fires. That is precisely why 31
  mis-typed steps in a client build stayed invisible — there was no failure to find. The message,
  the compiler comments and both type cards now say *skipped*, and note that anything asserting the
  step ran must look for `skipped` rather than for the absence of an error.

### Proof

- **`create_opportunity` is an upsert — measured, no longer inferred from a display name.** Two
  published workflows differing only in the value and stage their step writes, both fired at one
  contact: same opportunity id, `createdAt` unchanged, value 111 → 222, stage New Lead → Engaged,
  still one card, read back through the public API on a separate rail. The create-only helper on that
  same contact in the same minute refused. Two step types, one contact, opposite outcomes.

## [0.60.0] — 2026-09-07

A typed create for smart lists, built so the caller cannot produce the one shape that breaks them.

### Added

- **`create_smart_list`** — the 73rd tool, and the first write on this surface. A smart list's
  `filterSpecs.filters` has to be nested **two levels** (an outer group whose children are groups),
  and one level fewer — the envelope `POST /contacts/search/2` takes, and the one any reasonable
  caller writes — is accepted with a `201`, reads back byte-identical, returns the correct rows from
  the search endpoint, and is then **discarded by the contacts screen at load**, which renders every
  contact on the account. No response and no read-back tells the two apart. So the tool never takes
  an envelope: it takes flat `conditions` (or `groups`) and builds the nesting itself.
- **Two hard refusals, both for inputs that create an invisibly-broken list.** An empty filter means
  "show every contact" on this surface rather than "not configured yet" — it is what the screen's own
  Copy/Save-as path produces — and a filter naming a field outside the account's filter-field
  catalogue is dropped at render for the identical symptom. Neither is written.
- **A count differential before the write.** `POST /contacts/search/2` with `pageLimit: 0` and
  `includeTotal: true`, against an unfiltered control, so the preview reports *matched vs account
  total* instead of a bare success. A filter matching the account total is called out as not
  filtering.
- **A structural read-back.** After the create the record is re-read on a separate request and the
  stored envelope re-judged with the same classifier `check_smart_lists` audits with. The result says
  plainly what it does not prove: only a browser settles what the operator sees.

### Changed

- **The nesting rule now lives in one place**, `core/smart-lists.mjs`, shared by the builder and the
  auditor. Two tools holding two copies of it is how this surface goes wrong twice — the auditor
  blessing a shape the builder does not emit, or the reverse — and neither disagreement would appear
  in any API response. Round-trip tests assert that what the builder writes, the auditor calls healthy.
- **Reach:** `POST /contacts/smartlist/`, `POST /contacts/search/2` and the contact `customFields`
  read are `proven` rather than `source-only`, and `GET /knowledge-base/associated-entities` likewise.

### Proof

Live-fired on the designated test sub-account: `TEST-CAP-smartlist-01` and `-02` created, both read
back byte-identical with the canonical nesting and classified `ok`, differential 5 matched against an
account total of 237; the unknown-field and empty-filter inputs both refused with nothing written.
The render itself is **not** proven — the browser available here has no session — and the corpus page
and the tool result both say so rather than implying the API check settles it. 21 new tests, 1174 green.

## [0.59.3] — 2026-09-07

A blank user id was as silent as a missing one, and is now refused.

### Fixed

- **`check_smart_lists` guards the empty `userId` case, not just the absent one.** 0.59.2 fixed the
  missing parameter; the session that mapped the surface then measured the full matrix and found
  `userId=` answers `200` with an empty array too — the shape a caller hits when a variable is
  undefined rather than absent, and one that slips past any "did I include userId" check. The
  server-side trigger is `globals=true`, which converts the missing-parameter 422 into an empty
  success. This tool takes the value from the credential, and that is `null` whenever the token
  carries no `authClassId`, so the case was reachable. It now refuses with a named error instead of
  reporting a clean account, and points at the escape hatch that works without a user id — checking
  one list by id, since the detail read is not user-scoped.

## [0.59.2] — 2026-09-07

The smart-list audit reported clean accounts as empty, and now checks the field half too.

### Fixed

- **`check_smart_lists` reported "no smart lists" on an account holding seven.** Its roster read
  omitted `userId`, which the route requires. Omitted WITHOUT `globals` it answers 422; omitted WITH
  `globals=true` — the spelling the corpus documented — it answers **200 and an empty array**, while
  every one of those lists reads back in full by id. An audit tool that says "clean" when six of
  seven lists render the whole account is worse than no tool, and on the strength of that empty
  answer I had already told a colleague their probe lists were deleted. They were not. The read now
  sends `userId`, and an empty roster claims only what it establishes: that this user owns none,
  not that none exist.

### Added

- **The field check the previous release could only name.** No endpoint serves the filter-field
  catalogue — the contacts screen assembles it in the browser — so the static half (89 keys plus 13
  aliases and 5 join paths, mined from contactsApp build 2490) is synced from the corpus and
  embedded in the bundle, and the account half is read live from its contact custom fields.
  `FILE_UPLOAD` and `SIGNATURE` fields are excluded exactly as the builder excludes them. A filter
  naming a field the account does not offer is now caught — that is what a deleted custom field does
  to a list that worked yesterday.
- **Each row says WHICH failure it found**, because an unknown field and a flattened envelope produce
  the identical symptom and an operator told only "renders everything" fixes the wrong one. A list
  with both says both, and says that correcting the nesting alone will not fix it.
- Two things stay deliberately unjudged and are stated in the output: `score`, which is only real
  when the account has a published score profile that nothing here reads, and an unresolved
  `custom_fields.*` on an account holding a TEXTBOX_LIST field, whose option ids the customFields
  endpoint returns as plain strings with no ids. Both would be false positives, and a false
  "renders everything" sends someone to break a list that works.

  Live-fired on the sandbox: 7 lists checked, 6 caught, and the one that passes is the one the
  session that mapped this surface had verified in a browser.

## [0.59.1] — 2026-09-07

The smart-list audit states the one failure mode it cannot check, rather than letting a clean
verdict be read as more than it means.

### Changed

- **`check_smart_lists` now says what it does not check.** There is a fourth way a list renders the
  whole account: the contacts screen drops any filter whose FIELD is not in that account's
  filter-field catalogue, down the same code path, with the same result, and it keeps a
  `removedCount` it never shows. That is invisible from the nesting, and no endpoint this project
  knows serves the catalogue it would need — so the tool reports the fields it found and states in
  its output that a verdict of "ok" means the SHAPE is right, not that every field resolves.
  Inventing an allowlist would have flagged working custom-field filters as broken, which is a
  worse answer than a named gap.

## [0.59.0] — 2026-09-07

A read-only audit for the smart-list failure that no read-back can catch.

### Added

- **`check_smart_lists`** — reads every smart list on a sub-account and reports which ones render
  as the WHOLE ACCOUNT despite storing a filter. `filterSpecs.filters` must be nested two levels;
  a one-level shape (which is exactly what `POST /contacts/search/2` takes, and what any reasonable
  caller writes) is accepted with a 201, reads back byte-identical, returns the correct rows from
  the search endpoint, and is then discarded by the contacts screen at load. Five lists across three
  client accounts were in that state on 2026-09-07 while every API check agreed they were fine. The
  tool also catches an empty filters array (the Copy/Save-as path produces these: it carries name,
  columns and sort but no filter) and reads a `400 "Invalid SmartList id"` as DELETED, because this
  surface never answers 404 and reading its 400 as a bad argument blames the caller for someone
  else's deletion.
  Read-only on purpose: a smart list **cannot be deleted through the API** — `DELETE` is 404,
  `PUT {deleted:true}` is refused, and the `/lists/dynamic` delete answers 200 while the record
  survives in the projection the contacts screen reads. So a create is permanent and its tool needs
  the operator's word. The classifier is pinned against both shapes exactly as the corpus records
  them, the canonical one taken from a list a human built in the interface.

## [0.58.2] — 2026-09-07

One rule, promoted to where every agent sees it.

### Added

- **"Assume replace, not merge" is now in the MCP server instructions.** Three unrelated rails were
  found doing it independently: `POST /forms/{id}` deletes every key absent from the body and has no
  PATCH; `PUT /calendars/{id}` reset `openHours` to `{}` for a body that named only the slot fields;
  the public update-calendar and update-pipeline rails do the same, which the pipeline-specialist
  skill had already recorded from a client build in July. The damage is always to a field the caller
  never mentioned, so a read-back that checks only what was sent reports success on it — which is
  why this sits beside the existing "a 200 is not proof" paragraph rather than in a skill. The
  calendar half is proven in `knowledge/corpus/calendars/40-rules/`; the forms half in
  `knowledge/corpus/forms/40-rules/`.

## [0.58.1] — 2026-09-07

The forms surface settled on one canonical host, and the harvester learned that a page's stated
base is about its own surface rather than every endpoint the page mentions.

### Fixed

- **Eight forms and survey endpoints shipped twice**, once per host, purely by which corpus page
  recorded them. The surface owner settled the spelling at `services` (the rail the builder itself
  sends on), and the duplicates collapse: catalogue 1072 → 1064. Three of the eight were survey
  paths minted from a sentence saying nothing in the product calls them — the same shape as the
  `GET /forms/{bad}` line fixed earlier, now reworded in prose on both the corpus page and the
  `ghl-forms` skill. The skill-claims lint added in 0.58.0 caught the skill's copy of that fault on
  its first real run, which is exactly what it is for.
- **`POST /workflow/generate-image-ai/{locationId}/prompt/enhance` was on the wrong host.** It sat
  under `services` because the page that documents it states a services base, while that page's own
  text says the `/workflow` prefix IS the backend spelling. Corrected to backend.
- A stated base could drag an unrelated endpoint onto the wrong host — a forms page naming
  `POST /locations/{locationId}/customFields/` in passing moved it off backend. It happened twice
  and only the loss guard caught it. The harvester now scopes a page's base to the segments its
  surface's sidecar claims, but only where a mined tree already owns the prefix, so pages whose
  surface has no sidecar keep correcting the mined host (the inbound-webhook rail is live-proven on
  backend while the mined tree files it on services).

### Changed

- The `/forms/` host-parity ledger entry says why consolidating made it cover MORE rows, not fewer:
  the corpus now spells every forms path `services` while all five typed forms tools dial the
  proven backend Bearer rail. Both are right; the entry records that rather than hiding it.

## [0.58.0] — 2026-09-07

A plugin improvement programme: the opportunity step that silently no-opped, a round-trip verifier
that was blind on sixty step types, a typed rail for forms, live probe verdicts reaching the
catalogue, and three gates that were built and never wired. Seven of the defects fixed here were
found by the work itself rather than reported. Receipt:
`STATUS-2026-09-07-plugin-improvement-programme.md`.

### Fixed — the reports-success-does-nothing family, continued

- **`create_opportunity` compiled to a create-only action, so every create-or-update intent
  silently no-opped for returning contacts.** The compiler mapped the IR type to
  `internal_create_opportunity`, a picker-invisible helper whose own GHL description reads "if
  duplicate opportunities are disabled and an opportunity already exists in the same pipeline, the
  action will not execute" — and the IR then rewrote the wire name back onto the lean one, so the
  builder's real **Create/Update Opportunity** action (`create_opportunity`, locale key
  `create_update_opportunity`) was unreachable except through `kind:'raw'`. The step saved,
  published and round-tripped clean; the failure was a `400 duplicate opportunity` at runtime that
  nothing on the build path could see. One client build had 31 steps retyped by hand (2026-09-06).
  `create_opportunity` now compiles to the builder's own upsert: flat snake_case attributes,
  `allowBackward` / `allowMultiple` for the drawer's two mutually exclusive switches, `pipelineId`
  required (GHL's validator emits `pipeline_required` without one), status checked against GHL's
  Status enum, and `lostReasonId` refused unless the status is `lost`. A stage-less step is allowed
  and warned, because it can only ever update. The create-only helper stays reachable by its own
  name, `create_opportunity_strict`.
  **Live-proven on the sandbox** (draft `8b9f2159-7cac-4f85-a0ed-e164cca5173b`, read back on a
  separate request): GHL stored every emitted key verbatim, `allow_backward: true` persisted, asset
  pre-flight returned 0 errors and 0 warnings, and the strict type kept its
  `__customInputFields__` shape beside it. **Still owed:** the runtime differential — one contact
  enrolled twice, the upsert moving the existing card where the strict step answers 400. That
  needs a published workflow.
- Because the type now compiles to the action GHL actually validates, an opportunity step whose
  pipeline never resolved is **refused at compile** by GHL's own mined `pipeline_required` guard
  instead of being built blind. `ignoreUnresolved` does not buy past it: enforcement is a separate
  gate and `build_workflow` exposes no `skipEnforcement`.
- **Round-trip verify was blind on 60 step types.** It asked only the attested required-field
  table, which knows eight (all `conversationai_*`, each one paid for with a live probe), so a
  workflow could come back `{pass: N, issues: []}` while the builder rendered a step with a red
  error badge and refused to publish it. The compiler already refuses 49 types against GHL's own
  mined publish validators; verify now replays those same throw-tier guards against what GHL
  actually STORED and reports `failsGhlGuard`. Coverage goes from 8 types to 57, and reading the
  guards off the read-back also catches a required field the server dropped after accepting it.
  Warn-tier guards stay compile-time advice and never become verify issues.
- **`scripts/build.mjs` crashed on every run** — `pathToFileURL` was used and never imported, so
  the skill's canonical build entry died with a `ReferenceError` before it read anything. Found by
  using it.

### Changed — the forms rows carry their own proof

- The forms surface's proof ledger reached the catalogue as nothing but paths. A
  `_data/endpoints.json` sidecar now declares all 25 routes with a proof tier (21 executed, 4
  observed — share, image, export and delete were never run on any account), so 20 rows gained
  proof, bodies, returns and their traps. Three folder rows move host because the folders page now
  states the base it always used; the loss guard named all three first. Eight forms endpoints still
  ship twice, once per host, because other pages state no base — that is one canonical-spelling
  decision away and it is recorded, not silently fixed. 1070 → 1072 rows.

### Changed — reach stops being a guess on 76 rows

- **Live probe verdicts now reach the catalogue.** `reach` came from a hand-maintained overlay and
  nothing else, so 893 rows said `source-only` — indistinguishable from "nobody has looked". The
  knowledge repo's probe has existed since 2026-08-25 and dead-ended in `sniffs/`; it now writes
  `catalog/endpoint-reach.json`, which the build reads BELOW the overlay and ABOVE a sidecar's
  `proof`. That precedence is the point: a human who probed beats a script that probed beats an
  author's claim the code cannot verify. A read-only sweep of 302 rows on the sandbox promoted 70
  to `proven` and 6 to `refused`, with zero demotions and zero rows added or removed.
  **source-only 893 → 817.**
- The 145 inconclusive answers promote nothing. Fifty-six are 422s where the endpoint named a query
  key the probe did not send, which is a statement about the arguments, not about reach.

### Added — the forms rail, and two surface skills

- **Five typed tools for forms** — `list_forms`, `get_form`, `create_form`, `update_form_data`,
  `list_form_submissions`. The surface was mapped and live-proven on 2026-09-06 and until now
  reached an agent only through `raw_request`, which carries none of its four traps: the save is a
  whole-document REPLACE with no PATCH (so a bare write of one key deletes the rest of the form), a
  save issued right after the create answers 404 seven times out of seven, reads lag writes by
  seconds so an immediate read-back returns the previous document, and two keys are renamed by the
  server on write. `update_form_data` reads-merges-writes and its preview names every key it is
  preserving; `create_form` runs the save as a polled retry and verifies on field tags; `get_form`
  turns GHL's 400-for-unknown-id into a named refusal instead of a bare bad-request.
  **Live-fired on the sandbox 2026-09-07, 13 of 13 assertions**, including the one that matters: a
  `formAction`-only edit left all three fields and the styling intact, where a raw write would have
  destroyed them. Form `AhqijQSeEcorOhXiFxlj` left in place.
- **`ghl-forms` and `ghl-snapshots` skills.** Forms documents the four traps, the no-draft-state
  rule (a form is live at its widget URL the moment it exists), the world-readable document, and
  the strict query shapes. Snapshots has no typed tool yet and the skill is why: four of its write
  calls do something other than what their name suggests — `/snapshots/create` hangs where the
  appengine create works, an empty `extras` on refresh silently discards the curation, a bad id
  gives you a 200 and an empty snapshot, and the conflicts endpoint refuses the wizard's own key
  names. Both skills' endpoint claims are checked by the new lint.

### Added — gates

- **A skill-claims lint.** Skills are hand-written prose telling an agent which endpoint to call,
  and nothing checked those claims against the catalogue shipped beside them — while the catalogue
  is regenerated from the corpus on every knowledge commit and the skills are not. Every
  `METHOD /path` token in `skills/**/*.md` must now resolve to a catalogue row (parameter spelling,
  `:id` style and trailing slashes normalised). It runs under `npm test`, so under `pretest` and
  the release suite, with no new hook. 99 distinct claims, 15 unmatched today, each recorded with
  a reason and a class: PROSE (notation, not an endpoint), RELATIVE (real, written against a base
  the section states), PUBLIC_API (a different rail), and UNCATALOGUED — five claims that look real
  and have no row, each either a wrong skill or a corpus page we owe. That last count is pinned so
  it cannot grow quietly, the allowance list is checked for rot, and the scan asserts it actually
  read something so it cannot pass by finding nothing.
- `scripts/check-example-pointers.mjs` has existed since the type-catalogue work and was wired into
  nothing. It now runs in `pre-push`.

### Changed

- The capabilities index and the workflow-specialist catalogue now say which opportunity action is
  which, and `internal_create_opportunity`'s entry carries GHL's own "will not execute" sentence.

## [0.57.0] — 2026-09-07

The 2026-09-06 rail findings: 32 engine items compiled from four booking rails on four accounts
(28 Aug to 6 Sep). The highest-value family first — **a write that reports success and does
nothing** — then the two warnings that pushed people to rewrite working flows, then the caps,
then the convenience ops and tool notes. Every item names the finding it came from. Receipt:
`STATUS-2026-09-07-rail-findings-engine-fixes.md`.

### Fixed — the reports-success-does-nothing family (backlog 1–4, 13, 16, 31, 32)

- **Op keys are STRICT.** Every `edit_workflow` op accepts a fixed key set; an unknown key refuses
  the whole call BY NAME, with the accepted list and, for the known mistakes, where the value goes.
  Four live findings, one mechanism: `modifyTrigger` with `conditions` at the op's top level
  (R-67, R-96 — eight dead rails on one account, recurring a day later on another), `modifyTrigger`
  with a top-level `name` meant as the NEW name (R-101 — the top-level `name` is the MATCHER, so
  the rename verified clean and never happened), `modifyTrigger` with `status` (R-80), and
  `modifyStep` with `attributes` instead of `attrPatch` (R-115). In each the engine consumed
  nothing, re-sent the stored record, and its verifier compared that record against itself.
  `triggerId` together with a top-level `name`/`type` is refused as ambiguous. **Only an op's
  TOP-LEVEL keys are checked**: `stepId` on `modifyStep`, `step.attributes` inside
  `appendStep`/`insertBefore`/`insertAfter`/`retypeStep`, and `trigger.filters` stay exactly as
  they were — nothing that used the documented shapes breaks.
- **`modifyTrigger` takes `trigger.conditions` in the STORED shape, verbatim** — R-67's proven hand
  recipe, typed — or `trigger.filters` (author rows, expanded like a create); never both. A patch
  whose every value already matches the store is planned as a **NOOP**: shown in the preview with
  the reason, warned `TRIGGER_NOOP`, not sent (D-67: a no-op PUT "verified" a write that never
  happened). `addTrigger` takes `conditions` verbatim too, so a stored trigger can be cloned onto
  another workflow without silently posting `conditions: []`.
- **The trigger verifier reads the store, not the intent.** Each planned write records
  `requested` — the fields the CALLER named, as they must read back — and the round trip holds the
  store to them (`requestedByCaller` on a mismatch) and to the server's own `date_updated`, which
  the server stamps itself on every write it applies and ignores from the client. An unmoved stamp
  after a 200 is a `date_updated` mismatch: the PUT changed nothing. Every check reports
  `dateUpdated {before, after, moved}`.
- **The asset pre-flight says which document it describes**, `phase: 'pre-write'`, and is re-run
  over the PERSISTED document after a write (`verify.assetPreflightAfter`, phase `post-write`); an
  error that survives on a touched step warns `ASSET_ERROR_PERSISTS_AFTER_WRITE`. R-96 read a
  correct, persistent pre-write error as a stale cache. **`ignoreAssetErrors` is refused** when the
  flagged asset id is one this edit's own ops are REPLACING (`replaceFieldId` / `replaceTag` /
  `replaceInAttributes` old values) — that is exactly the case where the error is real and the
  write is the fix. The plain refusal names the phase and the risk instead of offering the hatch as
  a third option.

### Fixed — false warnings (backlog 17, 24, 6)

- **`GRAPH_CONTEXT` "a branch leading with a container is never chosen" was FALSE.** Agent span
  traces on a live client account show a splitter choosing a branch whose first step is a NESTED
  SPLITTER, repeatedly, on real patients (R-113, R-131). The rule is narrowed to the one head type
  that was measured (`conversationai_book_appointment`, sandbox 2026-08-30) and worded as a
  heuristic to verify against a live run, not a platform rule.
- **`OPP_WRITE_UNBOUND_PATH` fired on the canonical pattern it recommends.** The edit and repair
  verifiers handed the lint only the touched steps, so its parentKey walk hit a missing parent on
  the first hop for a step sitting directly under `find_opportunity → Opportunity Found` while the
  runtime log showed it updating the card (D-85, D-89). The lint now walks the whole document and
  reports only the touched steps (`scope`).
- **`MODIFY_NOT_NORMALISED` fires only for keys a patch INTRODUCES** on a non-normalisable type.
  Overwriting keys the wire shape already carries (a goto's `targetNodeId`, an opportunity step's
  rows) is silent; the warning names the new keys.

### Added — measured caps (backlog 15, 25)

- **`engine/field-caps.mjs`**: the four caps crossed live and read back —
  `conversationai_objective.instructions` 1000, `conversationai_ai_message.message` 600,
  `conversationai_book_appointment.promptInstructions` 500, `conversationai_ai_splitter.description`
  500 (D-68, D-74, D-81, D-88, R-144; `conversationai_continue` has none, 821 stored and ran).
  `edit_workflow` and `repair_workflow` REFUSE an over-cap value on a step they touch
  (`VALIDATION_FAILED`, length and cap named; hatch `allowOverCap:true` writes it and keeps a
  `FIELD_CAP` warning); `build_workflow` warns; `describe_step_type` carries `caps` on the card.
  Every live schema violation also lands in `warnings` as `SCHEMA: …`, not only inside
  `schemaViolations` — three caps were crossed in one week because nobody read that block.

### Added / Fixed — engine ops (backlog 12, 18, 20, 5, 8, 19)

- **`moveStep` moves the `parentKey` back-pointers with the `next` edges.** GHL's save validator
  refuses a document whose two disagree (`INVALID_STRUCTURE`), so no reorder through the engine
  had ever committed while the preview looked clean (D-15, D-64). The entry step cannot be moved
  (`insertBefore` is the door).
- **`addBranch` on a `conversationai_ai_splitter`** appends a user-defined transition row plus its
  `transition` node, last, in the compiler's shape; `addSplitterBranch` is an accepted spelling;
  the new branch is an `appendToBranch` target by name. Every new intent on a live flow bot was a
  hand-authored whole-document PUT before this (Deposit S17).
- **`updateSettings.name`** renames the workflow (ED-09; builder cap 100 characters, R-58).
- **Tag rows union their operators**: `contact.tags` is two catalogue rows with one value ("Has
  tag" `index-of-true`, "Doesn't have tag" `index-of-false`); reading only the first flagged the
  UI's own "Doesn't have tag" as off-menu on every `customer_reply` trigger (R-74).
- `replaceInAttributes` already reached nested paths (`__customInputFields__[].value`,
  `branches[].segments[].conditions[].conditionValue`); pinned by test, documented (backlog 5).
- `insertBefore`/`insertAfter` with `stepId` name `beforeId`/`afterId` (backlog 19).

### Added / Fixed — tools (backlog 14, 28, 11, 26, 10, 23, 29, 30, 21, 27)

- **`update_convai_agent` strips `workingHours` and `steps`** from the read-merge-write body: the
  PUT's DTO refuses them outright (`422 "property workingHours should not exist"`), so no agent
  whose GET carried them could be edited, and the autoPilot mode switch failed the same way
  (R-143, D-68, backlog 28).
- **The secret scrubber no longer redacts HTML `data-*` attribute names.** GHL step HTML carries
  `data-cv-token="true">{{message.body}}`; the labelled rule read `token="true"` as a credential and
  `export_workflow` returned `<redacted>` where the visitor's message belonged — a clone built from
  that export lost it (R-98). The JWT and `Bearer …` rules still scan every string.
- **`get_trigger_logs` flags `conv_ai_trigger` / `conv_ai_autonomous_trigger` as `noStats`**: 0
  attempts on every account minutes after a proven fire (R-150, D-84); the `added_to_workflow`
  enrolment row in `get_workflow_logs` is the only proof of a conv-AI fire. The note lists nine
  no-stats types.
- **`raw_request` refuses a trigger POST carrying root `workflow_id` and no `workflowId`** — the
  create route binds from camelCase `workflowId` only, so the stored shape returns 200 with an id
  and mints an ORPHAN (R-95: four on a client account). The per-trigger PUT is untouched.
- **`deleteStep`/`deleteContainer` on a PUBLISHED workflow counts the contacts parked on the
  deleted steps first** (one `count-per-step` read) — `preview.parkedOnDeletedSteps` and a
  `DELETE_EJECTS_PARKED_CONTACTS` warning: those runs end `step_was_deleted_by_user`, and an
  autonomous trigger does not re-fire for them in that session (D-83).
- **`replaceFieldId` resolves the NEW id on this account** (`GET /locations/{loc}/customFields/{id}`)
  and refuses `UNRESOLVED_DEPS` when it does not — field ids differ per account, standard fields
  included, so a cloned objective can carry a foreign id that "works" (D-86). Hatch:
  `ignoreUnresolved`.
- **`get_workflow_logs` labels a refused objective write** (`objectiveWriteFailed`, from
  `actionFrom.response.msg` "Objective met but field update failed - proceeding due to
  allowPartialSuccess") and counts them (`objectiveWriteFailures`) — the only trace of a write the
  Conversation AI service dropped; a platform transient seen in bursts on every account (D-86,
  D-90).
- **Large documents go through files.** `export_workflow {stepIds?, writeTo?}`,
  `get_workflow_logs {writeTo?}` (scrubbed, absolute path, summary returned), and
  `repair_workflow {templatesPath}` (an export file, a raw GET body, `{templates}` or a bare
  array). A 120-step flow bot is above the inline argument and result caps, which is why every
  read-back on the rails was a file parse (ED-09, D-78, R-146).

### Already true, recorded so nobody re-files them

- Backlog 22 (a new root appended to the END of the templates array never runs): `edit_workflow`
  and `repair_workflow` have refused `ENTRY_NOT_FIRST` since the entry-step lint; the finding was
  about a hand PUT, which no guard sees.
- Backlog 9 (the rename rail bumps `version`, R-66): that rail is a client-side script, not in the
  plugin; nothing here gates on `version` after a rename.
- Backlog 7 (a trigger that only DELETE stops, R-80): not reproducible from the corpus; the
  `status` rail is live-proven elsewhere and the account-specific case is recorded, not fixed.
- Backlog 31 (`PUT /contacts/{id}` with `{"phone": ""}` answers 200 and changes nothing; `null`
  clears): recorded, not annotated — the catalogue has no row for that endpoint (no mined
  front-end calls it and no corpus page documents it), so the note has nowhere to attach until
  a contacts surface is captured.

### Changed

- **Three endpoints shipped twice, and the corpus's own proof never reached the catalogue.** The
  adoption guard compares a typed tool's declared path against the catalogue, and its `normalize`
  stripped parameter names but not the query string — so the six capabilities that carry required
  query switches (`…/categories?product_id=…`, `…/apply-theme/{id}?template_id=…` and four more)
  matched no row: each lost its `coveredBy` on the real row AND was adopted a second time as a
  `typed-tool` twin. An agent that found the source-only twin was told nothing covered a path a
  shipped tool calls on every run. Query stripped; 1076 → 1070 rows, zero duplicates, and six rows
  gained `coveredBy` (172 covered, up from 168). Three memberships rows now read `source-only`
  where a duplicate twin used to read `proven` — the coverage that decides what an agent calls is
  unchanged, and the memberships host contradiction behind it is a probe, not an assertion.
  Separately, a `_data/endpoints.json` sidecar records per row whether its author EXECUTED the
  call or only OBSERVED it in the app's request builders, and the build dropped that field
  entirely: 43 executed rows shipped indistinguishable from paths nobody has called. `proof` is
  carried through and promotes `reach` to `proven` (never to `proven-live`, which stays reserved
  for a dated overlay note; the hand-curated overlay still outranks it). 936 → 893 source-only.
  `search_endpoints` now always states `reach`, so "known to be unreached" is no longer
  indistinguishable from "nobody has looked". Three new tests pin all of it: no duplicate row, no
  silently unmatched capability, and the promotion ladder.
- **The endpoint catalogue regenerates losslessly again.** `knowledge/`'s harvester never read the
  AI Studio sidecar its 40 `/vibe-ai/*` rows had been hand-merged from, so any regeneration — the
  release's own step 3 included — dropped 52 rows. It now reads every `_data/endpoints.json` first,
  resolves base-less page paths against it, and both it and the merge that `npm run sync` runs
  REFUSE to write when a row would vanish, naming each (`--allow-removals` to override). Catalogue
  1011 → 1076 rows: the forms surface (34), the snapshot surface (28), the AI usage/domain rows and
  the brand-kit list calls. `tool-host-parity` records `/forms/` as a both-hosts family (the forms
  corpus proves it by differential); no tool changed host.
- `edit_workflow`'s description and `references/editing.md` carry the strict-key contract, the
  `modifyTrigger` shape, the NOOP rule, the caps, the file paths and the parked-contact warning.
  Three schema-check tests that pinned "an over-cap value still commits" now pin the hatch.
  `capability-manifest.json` regenerated (238 rows: `count-per-step` and `customFields/{id}` on
  `edit_workflow`).

## [0.56.1] — 2026-09-04

The fifteen AI Studio tools now carry **`proof: live-runtime (2026-09-04)`**, up from `documented`.

### Changed

- **Proof labels earned by the live-fire pass.** 0.56.0 shipped the AI Studio tools as
  `proof: documented` because none had been executed against a real account. Every one of them has
  now been, through its registered handler with the real gateway — receipt
  `STATUS-2026-09-04-ai-studio-live-fire.md` at the repo root. The catalogue, the `describe()`
  fallbacks and the guard tests move together; the guard now pins the *dated* label, so a newer date
  needs a newer receipt and an older label is a regression.
- `ghl-ai-studio` skill: the "not yet live-fired" paragraph is replaced with what the receipt proves
  and, more usefully, what it does **not** — the two `answer_studio_question` variants that never
  arose, and a `failed` build status that has still never been observed.

Nothing else moves. The 0.56.0 "Known limitations" entry below stays as the record of what was true
when 0.56.0 was cut.

## [0.56.0] — 2026-09-04

A new surface: **GoHighLevel AI Studio**, internally called `vibe` (routes, API prefix and config
keys all say `vibe`; only the sidebar says "AI Studio" — searching a bundle for the user-facing
name finds nothing). Fifteen typed tools, a fourth gateway rail, a new skill, and one narrow
exemption in the credential guard. Tool count 51 → 66.

### Added

- **Fifteen AI Studio tools**: `find_ghl_site`, `list_studio_sites`, `get_studio_site`,
  `read_studio_site_content`, `get_studio_site_history`, `get_studio_site_diffs`,
  `get_studio_preview`, `create_studio_site`, `generate_studio_site`,
  `get_studio_generation_status`, `answer_studio_question`, `cancel_studio_generation`,
  `set_studio_secrets`, `publish_studio_site`, `unpublish_studio_site`. `find_ghl_site` resolves a
  domain, slug or name to the surface that actually owns it — AI Studio projects and funnels are
  disjoint collections, so asking the wrong one returns an empty list that reads as "does not
  exist" rather than "wrong surface".
- **A fourth gateway rail: `firebase`**, reaching Firestore directly. AI Studio keeps its
  conversation, its versions and its per-file diffs there, and none of it has a REST endpoint.
  Every request carries a per-request host assertion against `firestore.googleapis.com`, the same
  treatment the existing `ai` rail already gives the agency-admin `token-id`.
- **`ghl-ai-studio`** — a new skill, plus orientation routing (`ghl-orientation` now sends any AI
  Studio / `vibe` / "AI website builder" task here). It carries what the tools alone cannot:
  resolve the surface before acting (see `find_ghl_site` above), look at the rendered page in a
  browser before publishing — a plain HTTP fetch returns a Cloudflare challenge, and a prior sweep
  found a page whose builder-reported success hid a live weather widget silently failing on the
  actual DOM — and a required factual pass, because AI Studio fabricates social proof by default
  and nothing generated publishes without one.
- **Spend is reported, never capped.** `generate_studio_site` preflights the usage policy and
  refuses only when the server itself says no; every generation returns `spendUsd` and a
  cumulative `sessionSpendUsd`. Deliberate: the account this was measured against carries
  `unlimited: true` and `blockOnLimit: false`, and nothing here adds a ceiling GHL doesn't already
  enforce.

### Changed

- **`core/errors.mjs`**: the credential guard now permits conventional secret NAMES (`API_KEY`,
  `SESSION_TOKEN`, etc.) as keys inside a `secrets` map, and only there — the guard was otherwise
  refusing the most ordinary input a secrets map can hold. Values are still scanned in full, and a
  credential passed as a top-level argument is untouched. This is a change to a security control,
  narrow and deliberate: it suppresses the key-NAME rule for the direct children of a `secrets`
  object, nothing else.

### Fixed

- **`/internal-connect` runs on Windows** (PR #4, [@zedricedwardc](https://github.com/zedricedwardc)).
  Six embedded snippets loaded the plugin's own modules with a raw `C:/…` path, which Node's ESM
  loader refuses (`ERR_UNSUPPORTED_ESM_URL_SCHEME`), so every mode died on its first statement;
  and an un-normalised `process.cwd()` made a *registered* folder read as unregistered, routing to
  `claude mcp add` — which rewrites the entry and drops `GHL_INTERNAL_LOCATIONS`. Both fixed with
  `pathToFileURL` and separator normalisation; the doc-contract test now guards against any raw-path
  import returning. The same defect in `create-ghl-workflow/scripts/build.mjs` is fixed alongside.

### Known limitations

- **Not yet live-fired.** All fifteen tools carry `proof: documented`. The endpoints behind them
  were mapped live on 2026-09-04 (117 captures), but the tools themselves have not been executed
  against a real GoHighLevel account. Live proof is a separate, operator-gated pass that will land
  as a dated `STATUS-…-ai-studio-live-fire.md` receipt.
- **Deliberately absent**: custom-domain attach/remove, every `DELETE`, version restore/prewarm,
  feedback, and brand boards/voices (a different surface entirely). Left out on purpose, not
  discovered missing by trying them.

## [0.55.0] — 2026-09-04

Three corrections to `ghl-system-conventions`, all found by actually using it: two by running its
evals against the standalone install, one raised by the operator reading the output.

### Changed

- `ghl-system-conventions`: the layer list ends with the pre-build document as layer 6, so a
  first reply that is (correctly) all questions still says where the design will land. Found by
  running the skill's evals against the standalone install: a thin brief got questions, as the
  rule demands, but never mentioned the approval document.
- `ghl-system-conventions` / `build-doc-spec.md`: the pre-build document now specifies a
  **visible light/dark toggle** (auto → light → dark, `data-theme` on `<html>`, remembered in
  `localStorage`), not just `prefers-color-scheme`. It also specifies what the toggle has to do
  about mermaid: the library bakes its palette in at `initialize()` and replaces each source
  block with an SVG, so a theme change means stashing the sources, restoring them, dropping
  `data-processed`, re-initialising from freshly read custom properties and re-running. Proven
  on a generated document: 17 diagrams, 0 errors, node fill and page ground both flip, choice
  survives a reload.
- `ghl-system-conventions`: **custom values and custom fields have a human-readable NAME and a
  `snake_case` KEY**, and the skill only said "snake_case" — which read as though the name itself
  were snake_cased. The name is what a person picks from a dropdown (foldered values show as
  `folder.name`); the key is what automations reference (`{{custom_values.ai_persona_name}}`).
  Corrected for both. Raised by the operator; confirmed against the corpus.

## [0.54.0] — 2026-09-04

`ghl-system-conventions` is now also a **standalone skill** anyone can install without the plugin:

```
npx skills add uxieee/ghl-system-conventions
```

### Added

- **The skill carries GHL's type vocabulary itself.** `catalog/type-cards.json` (a byte-identical
  copy of the plugin's catalogue — 293 step and trigger types, 145 native) plus a generated
  `references/ghl-types-index.md` and `scripts/types.mjs` (`types.mjs wait` prints the card,
  `types.mjs <term>` searches). Standalone users get the same schema truth `describe_step_type`
  serves in the plugin; the plugin path still wins when installed. Both files are produced by
  `scripts/build-skill-types.mjs`, run by `npm run sync`, checked by the freshness gate
  (`skill-types`), pinned by `test/skill-types.test.mjs`.
- **`scripts/publish-standalone.mjs`** (`npm run publish-skill -- --version X`) publishes the skill
  to `github.com/uxieee/ghl-system-conventions` — a **mirror**: fresh clone, tree replaced from
  the plugin copy, README rendered from `scripts/standalone-readme.template.md`, commit + tag
  stamped with the plugin version. `npm run release` runs it last (`--no-mirror` to skip), so the
  mirror can only ever carry a version that exists as a plugin release.

### Changed

- The skill's text now names its two settings — standalone, and with the plugin — and says
  where truth comes from in each (a new "What this needs" section; recon and corpus sections
  reworded so no path points at a tool the standalone user does not have).
- The skill addresses "the operator" rather than a named person, so the public page reads
  neutrally. The rules are unchanged.

## [0.53.0] — 2026-09-03

### Added

- **`ghl-system-conventions`** — the sixteenth skill: how a GHL system should *look*. Recon
  before responding, layer-by-layer design gates (business → pipeline → workflow list → each
  workflow → copy), naming (`NN - Name`, `namespace:value`, `snake_case`), the stage-vs-field-
  vs-tag decision rule, pipeline tests, the hard rules, and the pre-build HTML approval
  document with a worked example. Account-agnostic. Moved here from a standalone folder; the
  corpus references now go through `describe_step_type` / `describe_endpoint` first and read
  the `knowledge/` repo only when it is beside the plugin source.
- `docs/specialist-contract.md`: the blueprint step loads `ghl-system-conventions`, and intake
  asks in one structured list (grouped, each with why it changes the build) rather than one
  question at a time — the format that survived three correction rounds.
- **`npm run sync`** (`scripts/sync-generated.mjs`) — regenerate every generated artefact in
  place and run the freshness gate. `knowledge/`'s `post-commit` hook now runs it, so a corpus
  commit updates the plugin's copies instead of leaving a reminder; the hook never commits and
  never fails the corpus commit. `release.mjs` uses the same script as its regenerate step, so
  there is one regeneration path.

## [0.52.0] — 2026-09-03

A release can no longer be cut from stale generated artefacts. The plugin ships five things that
are compiled from elsewhere — type cards from the corpus, the mined endpoint source, the compiled
catalogue, the two capability manifests, and the dist bundles that embed all of it — and until
now nothing but memory said when to regenerate them. Today's two releases showed the cost: 0.50.0
went out with a red test because the suite ran on a development branch instead of the tagged
tree, and a second 0.50.0 was prepared on a branch that had not fetched.

### Added

- **`scripts/check-generated-freshness.mjs`** — regenerates every generated artefact into a temp
  dir and fails on any difference, **naming what differs** (rows added, rows the shipped copy has
  that regeneration would DROP, rows whose fields changed — shipped → regenerated). Wired into
  `pre-push` and into mcp-internal's `pretest`, so `npm test` refuses a stale tree. The checks
  that need the sibling `knowledge/` repo skip, and say so, when it is absent.
  `mcp-internal/test/generated-freshness.test.mjs` pins it from both sides: green on the real
  tree, red — with the row named — when a shipped artefact is made stale on purpose.
- **`npm run release -- <version>`** (`scripts/release.mjs`) — the one door a version leaves
  through: preflight (main, fetched, not behind, clean, version above current, dated CHANGELOG
  entry) → print the drift → regenerate everything → freshness gate → bump both manifests → full
  suite on *this* tree → commit, tag, push, GitHub release, `claude plugin update`. `--dry-run`
  stops before any git state changes and restores the manifests. Rules live in
  `scripts/release-lib.mjs`, pinned by `test/release-lib.test.mjs`.
- `build-endpoint-catalog.mjs --out <path>` so the gate can compile without overwriting what it
  is checking.
- A repo-root `package.json` carrying `freshness`, `release` and `test`.
- In `knowledge/`: an advisory `post-commit` hook that says when the plugin's corpus-derived
  copies have fallen behind. It never writes into the plugin; being behind mid-harvest is normal.

### Fixed

- The endpoint-catalogue test asserts a **count**; same-count drift (a `kind` flipping, a
  `coveredBy` tool vanishing) passed it. The freshness gate diffs by row and field.

## [0.51.0] — 2026-09-03

One browser profile per token file. The per-folder credential binding was never the thing that
could put you in another client's account — the browser was.

### Fixed

- **The token capture no longer shares one Chrome profile across every folder.**
  `capture-token.mjs` hardcoded `~/.uxie-ghl-internal-mcp/pw-profile`, so every capture on the
  machine opened the same profile. A Chrome profile holds a GHL session, which made the agency
  logged in last the agency the next capture ran in — and a capture writes whatever account the
  browser is signed into straight into the *calling* folder's token file, where nothing downstream
  can tell it is the wrong one. The guard was per folder; the login it was handed was machine-wide.
  Measured 2026-09-03: a session working in one client's folder drove a browser to that client's
  sub-account and was redirected to a **different** client's agency launchpad, because the shared
  profile still held that other agency's session.

  The profile is now derived from the token file the capture is about to write
  (`~/.uxie-ghl-internal-mcp/profiles/<project>-<hash>`): same token file, same profile, so a login
  persists per client; different token file, different profile, so one client's session can never
  answer for another. Symlinked token files resolve to one profile because they are one login.
  `GHL_INTERNAL_PW_PROFILE` overrides it and `--print-profile-dir` prints it without launching
  Chrome. Pinned by `test/capture-profile.test.mjs`.

  **There is deliberately no fallback to the old shared profile.** Seeding each client's slot with
  it would carry over exactly the session that caused the bug. The cost is one login per client,
  once; the old profile is left on disk, untouched and unused. A fresh profile shows the login
  page — that is correct, not a failure, and the capture now says which profile it opened.

### Documentation

- **`/uxie-ghl-factory:internal-connect` now states that browsers are not governed by a binding.**
  Per-project layout documents the derived profile; the capture step says to use a profile
  belonging to the folder; re-authorize gained a verify-the-login-you-captured rule (decode
  `authClassId`, restore the previous file on a mismatch rather than leaving a folder
  authenticated as another client).
- **`audit` gained a tier 3: the surfaces it does not cover.** Three of them, all measured on
  2026-09-03. The public `@uxieee/ghl-mcp` server treats an **empty or absent
  `GHL_ALLOWED_LOCATIONS` as every account in the accounts file** — one folder was offering all 18
  accounts across six agencies. Plugin-level browser servers share one Chrome profile machine-wide.
  Sub-folders carry their own registrations. Tier 1 also enumerates by name prefix, so a
  registration of this server under any other name is invisible to it; six such servers were found
  by hand, each refusing every call with `LEGACY_TOKEN_FILE_ENV` while still presenting a full tool
  set.
- `docs/auth-jwt-capture.md` and `mcp-internal/README.md` carry the same profile rule, including
  the `--user-data-dir` / `--userDataDir` flags for the Playwright and Chrome-DevTools MCP servers.

## [0.50.0] — 2026-09-03

The Agent Logs surface — `services.leadconnectorhq.com/agent-logs/*`, the only place GHL shows *why* a
flow bot said what it said — mapped to the reverse-engineering skill's stop condition and shipped as
six read tools. The whole API client was recovered from the screen's federated bundle before a single
capture: 15 endpoints, every enum, the exact request-body builder.

### Added

- **`list_agent_sessions`** — the Sessions table with every filter the bundle builds, including two
  the Add Filter menu never shows (`contactId`, `voiceName`), `metadataFilters`, and `all:true` to walk
  the cursor. A POST that reads, so it takes no write confirmation.
- **`get_agent_session`** — summary, per-product `customConfigs`, every interaction (paged internally)
  and the per-session metrics.
- **`get_agent_message_trace`** — the span trace for one message, digested: ordered steps with node
  type, splitter branch id (named when `workflowId` is given) and its reasoning, knowledge sources by
  title, tool calls, which node's text actually reached the contact, tokens. `metadata.prompt` is
  stripped unless `includePrompt:true`. The digest flags the two failure modes the trace exposes —
  replies generated and discarded, and a model-side `conversation_ended` on a message that deserved an
  answer.
- **`get_ai_response_details`** — the older per-message rail (`source=conversation` fixed), prompt
  stripped unless asked.
- **`list_agent_contacts`** and **`get_agent_metrics`** — the Contacts and Metrics tabs, which return
  per-contact aggregates and 35 dashboard datasets none of the four above do.
- **15 catalogue rows** for `/agent-logs/*` with proven reach; `search_endpoints` names the covering
  tool. The four writes (`DELETE /agent-logs/logs/{id}` is wired but UI-unreachable; the three
  `metrics-layouts` writes) are catalogued `source-only` and were never called.

### Encoded rules (`core/agent-logs.mjs`), each live-proven on the sandbox

- Paging offset `(page-1)×limit` is capped at **500**. `limit` is uncapped; `pageToken` walks past the
  cap **only when `page` is omitted** (`page` silently wins). The cursor is timestamp-keyed — under any
  other `sortBy` it never advances, so the tool refuses that pair. `asc` is inclusive (de-duplicated),
  `desc` exclusive. The cursor carries no filters; every hop re-sends them.
- On `/spans`, **`conversationId` is not sent**. The UI sends it and it drops the `ai_splitter` span —
  the branch decision — from the trace (6 of 24 traces; the splitter every time).
- The service validates **types** (422) but never **values**: a bogus `timeRange`/`sortBy` is silently
  ignored, a bogus product or channel filters to zero rows. Epoch-millisecond dates match nothing, so
  the tool rejects them.
- Either credential alone reaches this surface (Bearer or `token-id`, R18-proven); the page itself
  sends only `token-id`.

### Notes for tool authors

- The agent-log session id is exposed as **`agentSessionId`**, not `sessionId`: that key is in the
  credential scrubber's `SECRET_KEYS`, so an argument by that name is refused before the handler runs
  and the value would be redacted on the way out.
- A capability on a different host from the tool's rail declares `origin:` per capability
  (`get_agent_message_trace`'s workflow read, for branch names).

## [0.49.0] — 2026-09-02

The rollout-findings review (R-01…R-65). Two engine guards, two conversation-AI tool defects, a
documentation-pipeline bug that had kept a whole surface out of the catalogue, and nine skill
references corrected so agents act on what the review proved live.

### Fixed

- **`edit_workflow` no longer aborts on a builder-saved opportunity step.** The commit guard tested
  name-key PRESENCE (`pipeline !== undefined`) while its own lint had been taught on 31 Aug that a
  builder-written `pipeline: null` is not a leaked name, so any edit whose scope walked past a
  UI-stored step failed with "carries name key(s) [pipeline, stage]" — naming the step by display
  name, which two steps shared. One predicate now lives in `opp-shapes.mjs` (`leakedOppNames`) and
  both the guard and the lint import it; the error names the step **id** and the retype remedy.
- **`update_convai_agent` can update a flow-bot agent again.** The read-merge-write replayed
  `employeeType`, `errors`, `isDeleted` and `rootParentAgentId` — keys every GET returns and the PUT
  refuses — so the call 422'd having written nothing. All four are stripped.
- **`create_convai_agent` accepts `mode: "auto-pilot"`.** GHL stores the hyphenated spelling and
  returns it on every read, so a live record could not be copied into a spec. The IR normalises it
  to the wire spelling `autoPilot`; a genuinely wrong value still fails `BAD_MODE`.
- **The corpus harvester dropped every root-collection call.** A single-segment path such as
  `/payment-links/` was skipped as "relative to an unstated base" even when the page stated a
  host-only base — so the payment-links family reached the catalogue with its `{id}` routes and
  without its LIST or CREATE, and `search_endpoints` answered "payment links" with `/links/search`.
  Fixed at the harvester; three prose-mined rows that would have 404'd (`/rename-workflow/{id}`,
  `/status/enroll-stats`, `/status/search/enroll-stats`) corrected at source.

### Added

- **`NAME_LENGTH` lint** (platform pack, warning) for steps and triggers. The builder's drawer
  refuses a name outside 1..100 characters; the API stores anything, so a workflow could read clean
  by API and be unsaveable by hand.
- **21 catalogue rows and 21 overlay notes**, every note from a live call: calendar events (epoch-ms
  only; the misspelled `appoinmentStatus` key), `?version=N` silently ignored, the pipeline PUT's
  trimmed body and full-replace stages, call-disposition `includeDeleted` returning ONLY deleted
  rows, `/ai-employees/actions/search` refusing `locationId`, the smart-list detail read, the
  contact filter DSL, the full payment-links family, `gen-url` minting a stable short link. Rename
  and the pipeline write now rank #1 for their intents (were #9 and absent).
- Skills: `ghl-conversation-ai` (actions are add-only pointers; flow-bot flags on the record; merge
  tags in `promptInstructions`; delete the agent never the flow; what the UI duplicate drops),
  `ghl-workflow-specialist` anti-pattern §12 (the four appointment-rail rules), `ghl-orientation`
  (calendar-delete cascade; what a snapshot load actually does), `ghl-pipeline-specialist` (the
  write contract), `get-ghl-workflow-logs` (`sourceId` as the bound-appointment tell),
  `ghl-reverse-engineering` (four harvester rules), `ghl-public-mcp-setup` (PIT by API),
  `create-ghl-workflow/editing.md` and `flow-bots.md`.

### Changed

- Three skill claims that were wrong: `responseLength` does NOT pass through on create (it is
  hardcoded `balanced` — unfixed, filed as R-64); the agent PUT is replace-what-you-omit, not
  "merge UNPROVEN"; `botType` has three values. `flow-bots.md` no longer says the drawer requires
  all four autonomous-trigger filters — the engine validates them only when supplied.

## [0.48.0] — 2026-09-02

The build path's validation ladder, completed on the edit path. `edit_workflow` had grown most of
`build_workflow`'s six-phase ladder piecemeal (name resolution, the compiler, workflow rules, the
action-schema check, tag pre-creation, round-trip verify with intent lints) — but four layers had
never made it over, so an edit could point a step at a deleted user, write custom code that throws
on its first run, or leave a builder-required field missing, and the tool reported ok.

### Added

- **Asset pre-flight on edit** (`validate_assets`, the build path's phase). GHL's own reference
  validator judges the post-edit document BEFORE anything is written. Errors on steps this edit
  touched refuse the call (hatch: `ignoreAssetErrors`, same name as the build's); errors on
  untouched steps are legacy debt and demote to warnings. Fail-open, stateless, and gated on the
  same op class as the schema check — a rename or a move still sends nothing new.
- **Custom-code sandbox pre-flight on edit.** Every `custom_code` step this edit creates or
  modifies runs in GHL's sandbox (`/workflow/custom-code/run-test`); a passing run replaces the
  authored `output` sample with the real return object before the PUT, so
  `{{custom_code.N.<key>}}` refs are pickable. Same switches as build: `skipCustomCodeTest`,
  `strictCustomCode` (refuse instead of warn). Untouched legacy code is never re-run — a pass
  would silently rewrite outputs the caller did not ask to change.
- **Graph-context rules on edit** (`goto` placement, `math_operation`'s upstream reference) —
  whole-document on purpose, because a deleted upstream math step is exactly the class of break
  an edit introduces on a step it never touched. Warning-severity in GHL, so advisory here too.
- **Account-readiness signals on edit** (the build's G15 advisory), scoped to the steps and
  triggers this edit wrote — an SMS step edited on a location with no number now says so.
- **Persisted required-field check in the edit round-trip** (`verify.missingRequired`): the
  build path's assertion that a step whose attributes round-tripped perfectly can still be
  missing a field the BUILDER requires, read off the re-GET, scoped to touched steps.

All five surface in the confirm PREVIEW as well as the committed result, so the verdicts are
visible while the edit can still be changed.

- **The same ladder on `repair_workflow`.** The whole-document write now runs the five layers
  above through the same shared helpers, plus the action-schema check and the opportunity-intent
  lint on the persisted document. With no op list to gate on, the diff against the stored document
  is the gate and the touched set: an unchanged document sends nothing new. This also makes the
  tool's description true — it had promised "workflow rules" since it shipped, but only the commit
  guards actually ran; `checkWorkflowRules` now runs, trigger-aware, with the `skipWorkflowRules`
  hatch. Same hatches as build/edit: `ignoreAssetErrors`, `strictCustomCode`, `skipCustomCodeTest`.

## [0.47.0] — 2026-08-31

The certification-run findings, re-verified and closed. Of the twenty-three live findings in the
Standard's certification file, thirteen were real at HEAD; this release fixes every one that is
engine work. Three were disproved along the way — including the headline claim that the log
reader drops `skipped` rows, which a live differential refuted before anything was built.

### Fixed

- **An opportunity CUSTOM field is now addressed as `custom_fields.<id>`.** The action turns
  `filterField` into a top-level body property and the opportunities DTO whitelists those, so the
  bare id the compiler used to emit came back `property <id> should not exist` — a 400 buried in a
  `skipped` row — on every booking since the build. Worse, the compiler *refused* the working
  spelling with `OPP_FIELD_UNKNOWN`; the knowledge had sat in the harvest corpus all along, skipped
  by one line in `gen-opp-shapes.mjs`. The compiler now accepts the bare id, the prefixed id and
  the `opportunity.*` fieldKey, emits the single wire spelling, and joins in the account's own
  `dataType` — closing the "contact→opp dataType join pending" warning deferred since F5-15.
  Standard properties keep their bare name; one shared `OPP_CUSTOM_FIELD_PREFIX` in
  `opp-shapes.mjs` keeps the emit and the guard from drifting.
- **Two opportunity lints that over-fired on correct steps — and aborted the edit path.**
  `OPP_NAME_KEY` tested key *presence*, so the builder's own `pipeline: null` / `stage: null`
  tripped it; it now fires only on a non-empty string. `OPP_STAGE_NO_PIPELINE_ROW` read only the
  rows, so every correctly-built `create_opportunity` (top-level `pipelineId` by design, stage as
  a row) tripped it; a top-level id now satisfies it **on create only** — on update the pipeline
  belongs in a row and the rule keeps its teeth. Both proven live on a builder-authored workflow.
- **The edit path now runs GHL's own action schema before the write.** A 614-character
  `conversationai_ai_message` prompt had returned 200, round-tripped clean and published — and the
  builder then showed "Resolve 1 Errors — Maximum 600 characters are allowed". Round-trip cannot
  see this by construction (sent equals stored). `edit_workflow` now checks the mutated templates
  against the marketplace assets catalog pre-write and names violations in the confirm preview
  (`preview.schemaViolations`) and the committed result (`schemaViolations`, `schemaHeadline`).
  Advisory and fail-open like the build path; gated to the eleven ops that write attributes so
  the pinned network contract does not grow for a rename; reuses the payload a marketplace op
  already fetched. Note the caps are per node type — `continue` is 1000, not uncapped.
- **`build_workflow` no longer swallows an unknown top-level key.** `parentId` was accepted,
  ignored, and never mentioned — the build reported success and left the workflow at the account
  root. The node level has had a key registry since v0.3.0; the top level had none. `parseIR` now
  raises `TOP_KEY`, and `parentId` specifically gets the recipe: build, then
  `move_workflows({locationId, workflowIds:[wid], parentId})` — the create POST cannot file a
  workflow. A typo'd `setings:` dies the same loud death instead of the old silent one.
- **The standalone scripts refuse a stale `GHL_TOK_FILE` loudly.** 0.43.0 renamed the env var and
  the MCP server has refused the old name ever since; `capture-token.mjs`, `build.mjs` and
  `edit.mjs` silently fell back — to *different* default paths, so a fresh capture wrote one file
  while edit read another ("fresh capture still 401s", `ABORTED (ENOENT)`). All three now abort
  in the server's own wording, share `~/.uxie-ghl-internal-mcp/tok.txt` as the default, and
  `rename-step-minimal.mjs` drops its one-off `GHL_TOKEN_FILE` — one env name plugin-wide. A
  `--print-token-file` seam lets the suite assert capture and edit resolve the same path.
- `check_workflow`'s description no longer pins a stale type count; the live number is in
  `coverage.schemaTypes`.

### Added

- **`OPP_CUSTOM_FIELD_BARE_ID`** (error) — a bare 20-character id in an opportunity `filterField`,
  with the exact DTO rejection and the correct spelling in the message.
- **`splitter-branch-leads-with-container`** (graph-context, warning) — a `conversationai_ai_splitter`
  branch whose first step is a multipath container is never offered to the model; measured across
  four live conversations whose wording matched the branch label almost verbatim, and fixed by one
  simple step at the branch head.
- **`manual-task-unassigned`** (hygiene, warning) — an unassigned `manual-call`/`manual-sms` is
  parked, not skipped: GHL queues it for nobody and the contact waits behind it indefinitely. GHL
  has no validator for this.
- **`book-appointment-unsteered`** (hygiene, warning) — stock `promptInstructions` on
  `conversationai_book_appointment` ships both measured defaults: it names an appointment already
  attended and offers past times, and with several bookings silently picks the soonest.
- **`get_workflow_logs` flags a no-op opportunity write.** A `success` row for
  `internal_create_opportunity`/`internal_update_opportunity` whose `meta.actionFrom` is empty
  never reached the premium-actions-worker — measured on a manual enrolment where "Mark the card
  LOST" logged success twice and the card never moved. Labelled `actionDispatched:false` with a
  note. Scoped to exactly those two types: `internal_notification` legitimately runs with an
  empty `actionFrom`, and even a `skipped` opportunity row carries a populated one.
- **`OPP_WRITE_UNBOUND_PATH`** (warning) — the operator's rule, mechanised: a card write must sit
  on a path that binds the card itself (`find_opportunity` → Not Found: create → Found: update),
  never rely on how the contact entered. Fires on any `internal_update_opportunity` whose
  `parentKey` walk meets no create and no Found transition — the shape that works through the
  opportunity trigger and silently no-ops on an `add_to_workflow` or manual/API enrolment.
  Live-proven from the working tree: both LOST writes in the Standard's stale-lead workflow fire
  it; the AI flow's writes (all under find→Found) stay silent.
- **`flow-bot-rules-drift`** (warning) — C-13's byte-identical rule, mechanised zero-config:
  sentences ≥ 40 chars shared verbatim by ≥ 2 speaking nodes are the rules block; a node carrying
  a near-variant (token Jaccard ≥ 0.6) of one is named with both spellings, and a node carrying
  none of the core block is told a global rule does not reach it. Speaking nodes are the five
  prompt-driven types; `conversationai_custom_message` is excluded by ruling — its `message` is
  sent to the lead verbatim, so a rules block there would be texted to the customer. Live-proven
  silent on the certified flow, whose block was already frozen byte-identically.
- `GOTO_TRIGGER_RACE` and the flow-bot references now carry the *resolved* cause of the
  mid-conversation kill — a trigger-**priority** collision, closed by giving the booking trigger
  top priority (0/11 → 5/5) — and distinguish it from a genuine second inbound message, which
  restarts the run benignly. `flow-bots.md` gains a "Runtime doctrine" section from a week of
  live conversations; `goghl-whatsapp.md` records that a vendor WhatsApp send reports `success`
  for a contact with no phone and leaves no trace.

### Skills — six skills now act on what the corpus learned

- **`ghl-conversation-ai`** — "my bot isn't replying" now starts at the Agent Deployment
  **routing table**, not the prompt: one row per channel, and a Live_Chat row pinned to a dead
  widget id mutes the agent with no error anywhere. The full-row PATCH that fixes it (captured
  from the product UI; a partial body is unproven), the widget picker's required `offset`/`limit`,
  the bot-type trade-off (flow-bot half measured, prompt-bot half inferred), the node-scope
  caveat, and the corrected `eq` → `==` operator. The custom-trigger runtime paragraph states
  only what was measured; the kill mechanism is marked as the inferred model it is.
- **`ghl-knowledge-base`** — gaps are a dated log of misses, not an inventory: the list endpoint,
  the never-self-closes differential, the four-step reading order, and that the DISMISS write was
  never captured.
- **`ghl-orientation`** — snapshots carry knowledge bases and **not** Conversation AI (agent, flow
  workflow, routing rows); the assets read to diff a snapshot before pushing; the wizard's
  per-asset conflict step replaces the old "overwrites by default" claim.
- **`ghl-workflow-specialist`** — a seven-rule flow-bot design block in `anti-patterns.md` §11,
  and the `conversationai_*` catalog row now names nine nodes, not five.
- **`get-ghl-workflow-logs`** — "Reading a run honestly": `skipped` rows are returned and a 4xx
  body inside one is a finding; `actionDispatched:false` is a no-op card write; a vendor WhatsApp
  `success` is queued, not delivered; restart vs kill in a flow-bot log; check the credential
  before believing an empty sweep.
- **`ghl-reverse-engineering`** — the harvester reads your page: every `METHOD /path` token
  mints a shipped catalog row on the page's single `Base:`, else the prefix map, else backend —
  with the discipline that keeps an inferred or 403ing path out of the catalog.
- Every edit was adversarially read against its corpus source before landing; the pass caught
  an over-claimed "live-proven" on the inferred kill mechanism in three places and corrected it
  at source (`flow-bots.md`, `step-shapes.md`, the `GOTO_TRIGGER_RACE` text).

### Audit — the bundle can finally see a muted agent

- **`get_ai_configuration_bundle` reads each Conversation AI agent's Agent-Deployment routing
  table** — the per-channel rows that decide which widgets/numbers actually reach the agent, and
  the surface on which a Live_Chat row pinned to a deleted widget id mutes a fully-configured
  agent with no error anywhere (C-21). Built with the framework's full ceremony: a new sealed
  capability (`conversation_ai_deployment_routing`, query-bound `agentId`, seal enforcement
  extended to query bindings at the gateway chokepoint), a third per-item phase on the
  `conversation_ai` component (rows verbatim on each item, `routingRead` against the detail
  denominator, `routingEnvelopeShape`, two new failure codes that gate `complete`), and a
  component-level `routingPinned` advisory summarising every row with `allIdentifiers: false` —
  pinned to specific identifiers, verify they still exist. The response envelope was pinned by a
  live capture before the reader was written: a bare array whose rows self-identify, with the tag
  keys absent on some rows (hence strict boolean reads). Live-proven read-only from the working
  tree: the sandbox agent's four rows flow through, `routingPinned` empty because every channel
  is on All widgets, `complete: true`. Both manifests and both dists regenerated; the
  `AI_BUNDLE_CAPABILITY_VERSION` moved (as designed, invalidating old receipts) while
  `ROSTER_CAPABILITY_VERSION` did not; a fresh human-approved canary is required before Full-audit
  claims. 14 new tests (992 total).

### Catalog

- **16 new endpoint rows harvested from the corpus** into the internal catalog (876 → 892) — the snapshot surface
  (`/snapshots/…`, nine reads, `assets` proven and carrying the fact that a snapshot has NO
  Conversation AI category), knowledge-base gaps (`/knowledge-base/gaps`, proven: a gap row is a
  dated log that never closes itself), Agent Deployment routing (`/agent-deployment/routing-config/configs`
  GET + PATCH, proven: a Live_Chat row pinned to a dead widget id mutes the agent silently), and
  custom-field/value folders (`customFields/{id}` read proven; `customValues` folder POST proven;
  `customFields/search` needs `includeStandards=true` to list folders at all). 20 overlay rows
  carry the live reach results and the trap notes. The harvester's prefix→origin map learned
  `/agent-deployment` and `/snapshots`, after a research page without a `Base:` filed them on the
  wrong host once.

### Disproved — do not build

- `get_workflow_logs` does **not** drop `skipped` rows (no filter exists; live: two returned, with
  their 400 bodies). The trigger verifier's casing bug and the edit engine's "cannot see
  find_opportunity children" were both fixed on 29 August by other mechanisms. Step ops commit
  *before* trigger writes, so a trigger abort never swallows batched step edits.

## [0.46.0] — 2026-08-31

The browser login becomes a monthly event at most. 0.45.0 kept a live session's credentials fresh;
this restarts them after an idle of any length up to 30 days, from a token the plugin already
receives on every renewal. Measured live before it was written (probes 19-21): the app's own
cold-start exchange, caught on the wire, then replayed from plain node with no browser and proven
by an authenticated read.

### Added

- **Cold start from the 30-day refresh token.** `GET /oauth/2/login/current` has always handed back
  a `refreshToken` with a 30-day lifetime beside the hourly one. The plugin now stores it as a
  fourth `refresh-token:` line in the 0600 token file, replacing it with the fresh one every
  renewal returns. When a call finds the hourly token already dead, the gateway exchanges the
  30-day token at `POST /oauth/2/login/token` (the token rides both as a `refresh-token` header
  and as body `{refreshTokenV2}`, exactly as the app sends it), writes the bearer it buys at once,
  then runs the existing hourly path on that fresh bearer so the AI-rail `token-id`, the Firebase
  key exchange, `companyId` and the newest refresh token all come along. Same discipline as the
  hourly path: one shared in-flight attempt, 60-second back-off, failures to stderr only, and any
  failure falls through to today's `TOKEN_EXPIRED` and the browser capture.
- **The capture records the refresh token too.** One session call on the captured bearer writes
  the 30-day token and, where none exists, `agency.json` with the agency's `companyId` — so a
  folder is cold-start-ready from its first capture, not its first hourly renewal.
- 14 offline tests: the exchange's exact request shape, that no bearer is sent with it, that the
  hourly step runs on the EXCHANGED bearer, that a hourly-step failure still leaves a working file
  with the still-valid `token-id` kept, that a pre-0.46.0 file makes no network call and still
  gets `TOKEN_EXPIRED`, one shared exchange for concurrent callers, back-off after failure, and
  the gateway sending a fresh bearer where it used to throw.

### Known limits

- **Removing the access token is not the same as it expiring.** Measured: the app treats a missing
  access cookie as logged-out and wipes its session; only an expired one is refreshed. The plugin
  never deletes a token line, so this is a note for anyone hand-editing the file.
- An expired **30-day** token was not measured (that takes 30 days). The exchange is assumed to
  fail like the hourly one does, and the design falls through to the browser either way.
- Token files written before 0.46.0 gain the `refresh-token:` line at their first hourly renewal
  or next capture; until then an idle past the hour still needs the browser once.

## [0.45.1] — 2026-08-31

### Fixed

- **The Firebase web key is captured, not shipped.** 0.45.0 hardcoded GHL's public Firebase web
  key in `core/token-renewal.mjs` (and so in both bundles) for the `token-id` exchange; GitHub's
  secret scanner flagged `dist/server.mjs` within minutes of the push. The key is a public
  client-side value every browser loading the app receives — nothing of ours was exposed and
  nothing needed rotating — but it is GHL's, not ours to commit, and a constant breaks the day
  they rotate it. It now travels like the other two credentials: `capture-token.mjs` reads it off
  the app's own identitytoolkit call and writes it as a third `firebase-key:` line in the 0600
  token file; `GHL_INTERNAL_FIREBASE_KEY` overrides. A file without one still renews the bearer
  and logs why the token-id did not. Existing folders pick the line up at their next capture.
- **`check-privacy.mjs` now fails on any Google API key** (`AIza` + 35 characters), so this class
  cannot recur. The key is gone from the tip; it remains in commit `43f75a9`'s history.

## [0.45.0] — 2026-08-31

The hourly credential wall is gone for any session that is actually in use. The server renews
BOTH credentials in the token file itself — no browser, no restart, no user action — and the
browser capture becomes the cold-start path for a server that sat idle past the hour. Every
mechanism here was measured live on 2026-08-31 before it was written down — 18 probes, each rule
below attributed to the one that established it.

### Added

- **Auto-renewal in the gateway** (`core/token-renewal.mjs`, wired into both entry points). When a
  call finds the bearer alive but within 5 minutes of expiry, the gateway first calls GHL's own
  `GET /oauth/2/login/current` with the current bearer and takes the fresh 60-minute `authToken`,
  exchanges the Firebase custom token in that same response for a fresh `token-id` at Google's
  identitytoolkit (the app's public web key, read off the wire), rewrites the token file
  atomically at 0600, re-reads it, and then sends the call it was asked for. One in-flight renewal
  is shared by every concurrent caller and attempts are at least 60 seconds apart. A renewal
  failure is logged to stderr — never stdout, the MCP transport — and the call proceeds on the
  credentials it has. `GHL_INTERNAL_AUTO_RENEW=0` disables it.
- **`agency.json` beside the token file**, written on a successful renewal when none exists: the
  refresh response carries `companyId`, which is not a JWT claim and which `internal-connect`'s
  `bind`/`audit` modes need for their online tier. Never overwrites a file `connect` captured.
- 22 offline tests pin the rules that cost a probe each: `authToken` not `token` (the first JWT in
  the body is a Firebase custom token and 401s as a bearer), the real Firebase key not
  `body.apiKey` (GHL's own key, rejected by Google), renew only while the bearer is ALIVE (an
  expired one 401s `Invalid JWT`), one shared in-flight refresh, back-off after failure, atomic
  0600 writes that round-trip through `readCredentials`, and a partial renewal keeping the
  existing `token-id`.

### Changed

- `formatTokenFile` moved to `core/token-renewal.mjs`; `scripts/capture-token.mjs` re-exports it,
  so the two writers of the token file share one definition.
- The shipped agent instructions and `internal-connect`'s re-authorize section now say what
  `TOKEN_EXPIRED` means post-renewal: the server idled past the hour, and the browser is required.

### Known limits

- **The chain does not survive a >60-minute idle.** An expired bearer cannot refresh, so a server
  that sat unused past expiry still needs the browser capture once. The refresh response also
  carries a 30-day `refreshToken`; `POST /oauth/refresh` exists (401, not 404) but its contract is
  not yet known — exchanging that token would make cold starts monthly. Not in this release.
- Renewal keys off the bearer's own `exp`. A token-id that dies while the bearer is healthy also
  triggers a renewal, but a file with no token-id at all does not gain one automatically.

## [0.44.2] — 2026-08-31

### Fixed

- **Privacy: two client names scrubbed from engine comments (leak #5).** A roster sweep against
  `check-privacy.mjs`'s name denylist found TEN active client names the gate did not know — its 18
  hashes dated from the earlier scrubs and never tracked the roster as it grew. Adding them
  immediately caught two names live in seven provenance comments under
  `skills/create-ghl-workflow/engine/`, carried into both committed bundles. Names replaced with
  anonymous descriptors (the provenance facts — dates, what was proven — stay), bundles rebuilt.
  The gate now fails on reintroduction of any of the ten. Git history and pre-0.44.2 release
  bundles still carry the two names; scrubbing history remains a separate, pending decision.

## [0.44.1] — 2026-08-31

Pays the follow-up 0.44.0's Known limits promised: the refusal guidance now routes to `bind`
mode, and the two contracts the command file restates are pinned by tests. This one DOES touch
`core/` and rebuilds `dist/` — that is the point.

### Fixed

- **`LOCATION_UNBOUND`/`LOCATION_FORBIDDEN` no longer route agents to the entry-clobbering
  command.** `core/instructions.mjs` and both remediations in `core/location-binding.mjs` now
  point at `/uxie-ghl-factory:internal-connect`'s `bind` mode — discover, propose, write
  additively — and say outright never to rebind with a bare `claude mcp add`, which rewrites the
  whole server entry and drops every env var not on that command line. The location-binding tests
  pin the new routing (`remediation` must name `internal-connect`).
- **`parseLocations` counts the rows it drops** (`skipped` on its return) instead of hiding them,
  and the discovery snippet's roster gate now separates the two causes a short list can have:
  malformed rows the parser dropped versus rows the fixed `limit=200` request never received.
  Previously either cause reported as pagination truncation.

### Added

- **`test/internal-connect-doc-contract.test.mjs`** — pins `commands/internal-connect.md` to the
  code it restates: every `scripts/*.mjs` module the command imports must exist on disk, and the
  hand-copied discovery headers must match `core/gateway.mjs`'s literal character-for-character
  (read from the source at test time, so the two cannot drift apart silently). Proven
  fails-on-reintroduction: corrupting the header in the command makes it fail. This is the same
  failure this file has already had once — it and `capture-token.mjs` asserted opposite referer
  rules for months until `capture-referer.test.mjs` pinned them together.

## [0.44.0] — 2026-08-31

`internal-connect` gains two modes — `bind` and `audit` — beside the existing `connect`, so a
folder's `GHL_INTERNAL_LOCATIONS` binding can be discovered from its own agency and proposed,
instead of being typed by hand. Nothing set that binding before this: it was populated by hand
across 8 registrations, and that hand pass immediately found two that had been silently wrong.
The three modules behind it stay pure and unbundled (`mcp-internal/scripts/`, never imported by
`core/` or either entry point) — `dist/` does not change in this release. The three modes live
inside this command rather than a new skill because the credential and the binding are the SAME
object in `~/.claude.json` — `claude mcp add` rewrites it wholesale, so a second owner writing to
it independently would silently clobber the first's write.

### Added

- **Mode selection on `internal-connect`.** `connect` (a folder with no registration): capture →
  register → discover → propose → verify. `bind` (a folder already registered): discover → diff
  bound vs. available → propose → write. `audit` (only when explicitly asked): a read-only sweep
  of every registration that changes nothing. Mode is decided by reading the registration, not by
  guessing, and the command says so and stops on anything ambiguous (a stale-path shadow, an
  audit-only folder that looks unregistered).
- **`registrations.mjs`** — the one owner of `~/.claude.json` for this rail: `listRegistrations`,
  an EXACT-path `findRegistration`, and an additive `setEnv` with a backup. Exact-path because
  stale `/Users/<user>/Documents/…` project entries shadow the real ones, carry no `mcpServers`,
  and sort first — a suffix match on them hid 5 of 11 registrations on the manual pass. Additive
  because `claude mcp add` rewrites a whole server entry, which is how a credential refresh
  silently erases a location binding.
- **`agency-binding.mjs`** — builds the `/locations/search` discovery request and parses its
  response (rows nested at `data.json.locations`, the agency total at `data.json.hit[0].count`),
  then reconciles bound-vs-available into `matched` / `missing` / `unknown`. An empty available
  list yields no findings at all rather than marking every bound id `unknown`, so a failed read
  can never masquerade as a wrong binding.
- **`audit-report.mjs`** — the offline health tier over registrations and token claims: unbound
  registrations, expired or unreadable credentials, legacy env names, and accounts reachable from
  more than one folder. Every folder is marked `onlineChecked: false`, and the report names what
  it did NOT check — a health check that implies a folder is clean when its credential was too
  dead to verify is worse than none.

### Known limits

- **The online tier (does this folder's binding match its agency's real roster?) is manual and
  per-folder**, run one credential at a time under `bind` or `audit`'s tier 2 — there is no
  scheduled or batch sweep across registrations.
- Sub-account creation and credential renewal remain untouched; this release only reconciles a
  binding against accounts and credentials that already exist.
- **The shipped agent instructions still point `LOCATION_UNBOUND`/`LOCATION_FORBIDDEN` at
  `claude mcp add`.** `core/instructions.mjs` tells an agent to surface the error's own
  remediation rather than retrying or re-running internal-connect, and that remediation
  (`core/location-binding.mjs`) is a `claude mcp add` that rewrites the whole server entry and
  binds only the single refused id — exactly what rule 1 exists to prevent, and what this
  command's prose now tells agents to run `bind` for instead. Not fixed in 0.44.0:
  `core/instructions.mjs` is a bundled file, and this release deliberately changes nothing under
  `core/` or `dist/`. Owed as a follow-up.

## [0.43.0] — 2026-08-31

**BREAKING.** The internal server has a second, unrelated public rail now
(`@uxieee/ghl-mcp`, Private Integration Tokens), and `GHL_TOK_FILE`/`GHL_LOCATIONS` said
nothing about which one they belonged to. Both are hard-renamed with the `INTERNAL` prefix
that names the rail on sight, and there is no fallback that reads the old names' values.

**Migration:** every existing internal-server registration must swap the flag names (same
values):

```
-e GHL_TOK_FILE=...    -> -e GHL_INTERNAL_TOK_FILE=...
-e GHL_LOCATIONS=...   -> -e GHL_INTERNAL_LOCATIONS=...
```

### Added

- **`LEGACY_TOKEN_FILE_ENV`** — the migration guard. A hard rename has one specific hazard: the
  entry points build `state.tokenFile` as `process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE`
  (`core/auth.mjs:12`), so a registration that missed the migration and still sets only the OLD
  `GHL_TOK_FILE` would see the new name as simply unset and silently fall back to the shared
  default token file (`~/.uxie-ghl-internal-mcp/tok.txt`) — quietly authenticating as whatever
  account owns that file. That is a silent wrong-account failure, the exact class of bug
  0.42.0's location binding exists to prevent, so it is closed here instead of shipped. Both
  `stdio.mjs` and `stdio-audit.mjs` compute `legacyTokenFileEnv` from the OLD variable's
  **presence only** (never its value) and hand it to `readCredentials()` (`core/auth.mjs`),
  which throws an `AuthError` naming both variables and the fix before any file is touched — the
  same `fail()`/`AuthError` contract every other credential failure uses, never a hand-built
  object. An explicit `set_token_file` call VALIDATES its path independently of the guard (it
  never carries the stale-env flag), and once that validation succeeds it also CLEARS
  `legacyTokenFileEnv` on state — the operator named a real file themselves, so there is nothing
  left for the guard to protect against, and every later call (this tool's own `authStatus`
  reply included) stops refusing without a server restart.
- **`LEGACY_LOCATIONS_ENV`** — the same guard shape, mirrored onto `GHL_LOCATIONS` ->
  `GHL_INTERNAL_LOCATIONS`, added after review caught that "unbound fails safe" is only true of
  *writes*. `checkLocationBinding` returns `null` (allowed) for an unbound registration's
  *reads* — 0.42.0 deliberately made a bound registration's `LOCATION_FORBIDDEN` apply to reads
  too (`mcp-internal/README.md`'s "does not keep reading everywhere else the credential happens
  to reach"), so a registration that migrates `GHL_INTERNAL_TOK_FILE` but leaves `GHL_LOCATIONS`
  stale would keep refusing writes (already fail-safe) while silently WIDENING reads from its
  bound set to every location the credential reaches — a security feature quietly getting
  weaker, with nothing said. `checkLocationBinding` now refuses every guarded call (read or
  write) with `LEGACY_LOCATIONS_ENV` when `state.legacyLocationsEnv` is set — computed the same
  presence-only way as the token guard, in `stdio.mjs` only (the audit profile has never read
  this variable at all, and still doesn't).

### Changed

- Every user-facing string that told an operator to set `GHL_TOK_FILE` or `GHL_LOCATIONS` — the
  `LOCATION_UNBOUND`/`LOCATION_FORBIDDEN` remediations in `core/location-binding.mjs`, both
  READMEs, `HANDOFF.md`, `commands/internal-connect.md`, and the `create-ghl-workflow` /
  `ghl-workflow-fast-forward` `SKILL.md` files — now names the new variable. A stale instruction
  here would produce exactly the misconfiguration the guard above refuses.
- The CLI-rail scripts (`skills/create-ghl-workflow/scripts/build.mjs`, `.../edit.mjs`,
  `skills/ghl-workflow-fast-forward/scripts/ff.mjs`, `mcp-internal/scripts/capture-token.mjs`)
  read `GHL_INTERNAL_TOK_FILE` now. They keep their own pre-existing fallbacks (a
  project-relative `.playwright-mcp/tok.txt`, or an explicit throw) unchanged — those are a
  different, lower-risk shape than `DEFAULT_TOKEN_FILE` and were not the hazard this release
  closes.

### Known limits

- The migration guard covers the two stdio entry points only, the same footprint as 0.42.0's
  location binding — it does not reach the standalone CLI scripts above, which have never read
  `GHL_LOCATIONS`/`GHL_INTERNAL_LOCATIONS` at all.

## [0.42.0] — 2026-08-30

Location binding. One GHL login serves many client sub-accounts and the JWT carries no location
claim, so the credential alone cannot tell them apart: 39 of the internal server's 45 tools take
`locationId` as a free string, and 17 mutate a live account. Nothing stood between one client's
account and another's beyond the caller not making a mistake.

### Added

- **`GHL_LOCATIONS`** — a per-registration env var declaring the comma-separated location ids a
  server instance may act on, enforced at the tool choke point (`core/location-binding.mjs`) so
  every one of the 39 location-bearing tools is covered from one place rather than 39 call sites.
  Unset registrations keep every read available and refuse every write with `LOCATION_UNBOUND`,
  whose remediation names the exact `claude mcp add` command to bind it — existing registrations
  upgrade without losing read access, and a write against an unbound registration fails loud
  rather than landing on whichever account the token happens to reach. A bound registration that
  targets an account outside its set is refused with `LOCATION_FORBIDDEN`.
- **`raw_request` gets its own path-level checks**, since it is the one tool whose target isn't a
  typed `locationId` argument: `LOCATION_PATH_REWRITE` refuses a path containing a relative (`.`
  or `..`) segment or one that resolves off the expected origin, rather than reasoning about where
  it would actually land; `LOCATION_DENYLISTED` refuses the one endpoint that writes settings
  across every location under the agency, because no per-location allowlist can sanction it. The
  request body is scanned for `locationId`/`location_id`/`locations`/`locationIds` keys (string or
  array-of-string values only; any other shape at that key is refused) up to a bounded depth/node
  budget, so a nested or array-shaped foreign location can't slip past a check that only looked at
  the top level — including the account list that `POST .../membership/locations/{locationId}/
  products/clone/{productId}` clones a course product **into**, which arrives under `locations`
  rather than `locationId`.
- **`core/instructions.mjs`** now tells the agent that `LOCATION_UNBOUND` and `LOCATION_FORBIDDEN`
  are not credential problems and that re-capturing a token will not help — without it, a refusal
  reads as an auth failure and burns a re-capture loop against a guard that is working correctly.
- `commands/internal-connect.md` and `mcp-internal/README.md` document `GHL_LOCATIONS` beside
  `GHL_TOK_FILE`. The audit registration is unaffected and unchanged — it is structurally
  read-only and its entry point reads no such variable.

### Known limits

- **The guard covers the MCP server only.** Three standalone CLI scripts reach the same accounts
  with a location id passed directly, entirely outside this server and its checks:
  `skills/create-ghl-workflow/scripts/build.mjs`, `skills/ghl-workflow-fast-forward/scripts/ff.mjs`,
  and `skills/ghl-memberships/scripts/cli-gateway.mjs`. A documented one-command path around the
  guard, available to the same agent. Closing it is separate, unstarted work.
- **A `%2f`-encoded path segment is not decoded by WHATWG URL parsing**, so a location hidden that
  way in a `raw_request` path is not seen by the path-rewrite check. It falls to the next limit
  below rather than being caught.
- **A path the catalogue does not recognise cannot have its location verified.** `raw_request`
  exists for endpoints outside the catalogue, so an unmatched path is not refused outright; when
  bound, such a call is **allowed** rather than refused. Both residuals are stated limits of the
  design (spec §5.3, §5.4), not vulnerabilities discovered after the fact. The `locationVerified:
  false` advisory flag designed for this case was deferred to a follow-up.

## [0.41.0] — 2026-08-29

Phase-5 plan 6 — **surfaces and lifecycle**. Endpoint and entity knowledge becomes DATA, and the
read-after-write lag gets one primitive instead of four hand-rolled loops.

### Added

- **An account-object REGISTRY** (`engine/entities.mjs`). The sweep was 21 hand-written GETs beside
  21 hand-written projections, so adding an object meant editing three files — and a tool
  description that had already drifted from both, advertising six kinds while returning twenty.
  Adding one is now a row. `agents` stays hand-written and says so: it is the one key that MERGES
  two endpoints.
- **Opportunity LOST REASONS and call DISPOSITIONS** are fetched, resolvable, and validated. A lost
  reason now authors by NAME through the same resolver every other nameable kind uses; an
  unresolved one is refused by the same door guard as pipeline and stage. `call_status` matches
  dispositions BY NAME, so a name absent from Settings can never match — the compiler now warns,
  naming what the account actually has.
- **`gw.readBackUntil`** — one polled read-back primitive. GHL's list indexes lag a write by a
  second or two, so a single immediate read reported `verified: false` on folders that HAD been
  created, and a flag that cries wolf is one callers learn to ignore.
- **A tool/catalogue host-parity test.** F5-01 shipped because a tool named a rail the catalogue
  disagreed with and nothing compared them. The test found 37 disagreements across 7 families on
  its first run; where the TOOL is live-proven on the host it uses, that is recorded as a reviewed
  ledger entry with its evidence, and anything outside the ledger fails.

### Fixed

- **The harvester could not see `{mp}`-prefixed endpoint lines**, so a corpus page could document a
  surface completely and harvest nothing from it: 93 endpoints appeared once the placeholder was
  allowed, with zero rows lost.
- **A path-prefix guess outranked a page's stated base.** That is backwards, and it is how every
  `/hooks/*` row was forced onto the services host while the inbound-webhook rail was live-proven
  on backend.
- **The memberships corpus page named the wrong production host** — the bundle's own constant, the
  recon page, and the live course lifecycle all say backend.

### Fixed — findings recorded after the review was written

- **The runtime enters at `templates[0]`, not at the parentKey-less step** (F5-34). A root wired
  correctly by parentKey/next but APPENDED to the end of the array **never executes**, and the
  builder draws it as the head the whole time — proven live by runtime logs, and two workflows
  shipped that way. `lintEntryStep` names it on a read; `editCommitBody` refuses to commit it.
- **`appointmentCondition: 'appointment'` saves and cannot be published** (F5-33). The enum is
  `skip | next | specific-step | exit`; the field is the PAST-TIME behaviour, not which
  appointment. Refused at compile. 55 legacy steps carry the bad value.
- **Publish is the only validator that matters** (F5-33): 21 workflows passed `check_workflow`
  with 0 errors and the publish PUT refused three. `lintPublishRules` adds the two structural
  rules the marketplace schema cannot see — next/parentKey disagreement, and
  `update_contact_field` rows missing `title`/`type`.
- **`custom_date_reminder` needs the config block AND a conditions row** (F5-08). A config with no
  matching row is DISCARDED on save, which is why it once looked server-derived. The engine had no
  handling for this trigger at all; it now emits both plus root `match_year` from one lean intent.
- **The opportunity search is an INDEX and lags a create by tens of seconds** (F5-36) — a
  `find_opportunity` soon after a `create_opportunity` now warns.
- **An externally-ended run is indistinguishable from a completed one** in the roster (F5-35).
  `get_workflow_logs` now labels every removal with `removalOrigin` and counts `externalRemovals`.
- **The two token-capture procedures contradicted each other** and neither had a test. Both
  referers work — settled by reading back the referer of the request that produced this
  programme's own live credential. The rule is one tested function, and writing that test caught
  two further bugs: importing the module launched a browser, and the referer check was a
  `startsWith` that accepted `app.gohighlevel.com.evil.test`.

### Added — knowledge

- **Five provisioning corpus pages**: lost reasons, call dispositions, snippets, manual actions
  and calendar availability schedules, with two new surfaces registered. 473 documented endpoints,
  zero lost.
- **`check-app-builds.mjs`** — one unauthenticated GET reports which of GHL's **122 federated
  front-end apps** has shipped a new build, exit 2 on drift. Verified both ways.

### Not done in this release

- Headless JWT auto-renewal (plan 6 task 8 steps 2–5). Its prerequisite — how long the persistent
  browser profile stays logged in — is unmeasured, and spawning a browser from inside the MCP
  server on every 401 is not something to ship on an assumption about the very case it handles.
- The AI apps ship **no sourcemaps** (`.map` is 404 on appcdn, verified), so there is no
  TypeScript to recover for them; `check-app-builds.mjs` answers the cheap question instead of
  pretending to answer the expensive one.

## [0.40.0] — 2026-08-29

Phase-5 plan 4 — **drawer parity**. Everything below is a place the engine INVENTED where the
builder offers a choice, or had no way to express a shape the drawer writes.

### Added

- **Operator MENUS are enforced, never invented** (F5-25). Where a row has a menu and no default,
  the drawer forces the author to pick; the engine used to invent one from the row's TYPE, so a
  `message.body` filter got an operator its menu never contained — saves clean, never matches.
  `FILTER_OPERATOR_REQUIRED` now names the menu, and `FILTER_OPERATOR` refuses an off-menu choice.
- **Custom-field row templates** (F5-26). A `contact_changed` row on a custom field exists only
  once the field does, so it could not be expressed at all. The catalog now carries the drawer's
  row template and the account's own field list instantiates it — the author may name the field by
  id, `contact.<id>`, display name, or fieldKey. `PHONE`/`FILE_UPLOAD`/`SIGNATURE` force
  `has-changed`, because there is no value to compare.
- **Marketplace operators per FILTER TYPE** (F5-19). "Exactly two operators, and no equals" was a
  string-filter fact applied to every type, so a multiselect customVar could not be filtered at
  all. Marketplace conditions also finally carry `type` and `title`.
- **A real `specific_date` wait branch** plus GHL's own `checkForSpecificDateError` and
  `checkForDateOffsetError`, ported. A date-field wait previously had to be written as raw
  attributes, and one real build authored `timePeriodInputMode` — a TIME-delay key — producing a
  wait that stored clean and did nothing.
- **The notification "Assigned owners" block.** `assignedOwners`, `alsoNotifyContactFollowers` and
  `alsoNotifyOpportunityFollowers` were absent from the emitted-key allowlist, so the drawer's own
  fields were reported dropped and could not be authored.
- **Drawer-parity fixtures** — five UI shapes diffed against `buildTrigger` on every run, so a
  generator change that breaks a drawer shape fails a named fixture instead of shipping.
- **A manual-step warning**: a `manual-call` / `manual-sms` is a TASK, and the run WAITS there for
  a human, so an outbound send below it does not go out on a schedule.
- **The note colour palette** as an advisory — an off-palette hex renders, but the drawer shows no
  swatch selected, so a one-digit typo is invisible until someone opens the step.

### Added (plan 5 — the read side)

- **A whole-document lint runner** with three packs. `check_workflow` ran exactly ONE layer (the
  marketplace action schema) while the build path ran about ten, so recon on a live account found
  nothing the build path alone checks — a client shipped a literal `{{appointment.date}}` for three
  weeks under a clean `check_workflow` (RC-F). `platform` mirrors GHL and the engine's own guards,
  `hygiene` names shapes that are legal and almost always a mistake, and `doctrine` evaluates CLIENT
  policy the engine never defines, supplied as declarative JSON from
  `.ghl/<locationId>/lint-pack.json` or inline.
- **`check_workflow` survives an assets outage.** When the schema fetch fails it now returns
  `errorCount: null` — unknown, not zero — with `schemaChecked: false`, and every other layer still
  reports. It used to return `VALIDATION_FAILED` and discard all of it.
- **`search_merge_tags`** — the picker's 442 static tags ranked by intent, plus this account's own
  custom fields and values when a `locationId` is given. The vocabulary was previously findable only
  by already knowing the name, which is how `{{appointment.date}}` came to be invented.
- **`get_workflow_digest`** — a compact read of one workflow (identity, version, a structural
  fingerprint, the trigger set, one line per step, the linear chains), roughly a tenth of
  `export_workflow`. The read half of every edit.
- **`expectedVersion` and `acknowledgeDrift` on `edit_workflow`**, backed by a per-project read
  cache. A workflow PUT carries the whole templates array, so an edit authored against a graph
  someone else has since changed erases the other edit silently; that window was unguarded.

### Fixed

- **`is-not-empty` was a label transcribed as a wire value.** The marketplace "Is not empty"
  operator is `has_value` (`MarketplaceFilter.ts:1397-1400`); the engine shipped the i18n key
  fragment instead, so it accepted a value GHL never writes and would have refused the real one.
  Both are accepted now, with `is-not-empty` marked legacy.
- **A duplicate `wait` key in `COUPLED_FIELDS`** silently discarded a whole rule set — a duplicate
  key in a large object literal is invisible. Found while adding the specific-date rules.
- **`BOT_TYPES` listed two of three** — `FORM_BASED_BOT` ships in the builder's own enum.

### Changed

- A marketplace filter with no operator now takes the drawer's own per-type default instead of
  being fatal. The old refusal existed because the engine had no idea what the default should be;
  it now knows, and the drawer shows that operator pre-selected the moment you pick the field.

## [0.39.0] — 2026-08-29

**Live-proven on GROM Digital AUS (`wdzEoUZnXO9tB3PPzcot`), 2026-08-29, against the working tree:**

| Finding | Receipt |
|---|---|
| F5-17 | A build authored `{ conditionType: 'trigger', trigger: 'booked' }` and the STORED condition reads `YtUYRKq8va8quhnUJnbb` — exactly the live "Booked" trigger id (workflow `84cf461e`). The branch can match. |
| F5-12 | An `appendToBranch` anchored by `containerId` + the branch NAME "Booked path" added a `goto` whose `target` was the step NAME "Tag other"; the stored `targetNodeId` resolves to that step. Both were impossible before this release. |

The first attempt at the F5-17 repair FAILED live, and the guard said so rather than reporting
clean: `TRIGGER REFS UNREPAIRED`. The diagnosis is now in the code — replaying the original
auto-save body is refused `422 "Looks like your previous changes were not committed"` because the
trigger POSTs advance the document version, so the repair re-reads the current document and
commits with the plain workflow PUT. Probe artifacts left in place for a human to remove:
workflows `6c3140b3`, `92e3802f` (the failed first attempt, kept as evidence) and `84cf461e`.

`update_convai_agent`'s live gate has NOT been run — it needs a disposable agent on the test
sub-account, and the credential expired before it could be created.


Phase-5 plan 2 — **one compile pipeline behind every door** (RC-A). The engine had one guarded
path (`build_workflow`) and four unguarded ones. Every change below moves a door onto the guarded
path, or removes the reason someone reached for the hand-rolled PUT instead.

### Added

- **References resolve against the LIVE document.** An edit op compiles ONE node, so every
  reference check inside it was a false positive by construction — a `goto` pointing at a step
  sitting on the canvas threw `GOTO_UNRESOLVED`. The compiler now takes `ctx.externalRefs`, seeded
  from the live templates plus the refs earlier ops in the same call minted. A unique live NAME
  resolves; a name shared by two steps raises `REF_AMBIGUOUS` rather than guessing. (F5-12)
- **`appendToBranch` takes three anchors**: `branchEntryId`, `containerId` + `branch` (display
  name, `__branchKey__`, or id), or `branchRef` — a branch ref authored earlier in the same call.
  It previously demanded an id obtainable only by exporting the workflow and reading `next[]` by
  position.
- **The account resolver runs on the edit path**, gated on an op actually carrying a name so a
  native edit stays network-identical. An unresolved name fails `UNRESOLVED_DEPS` exactly as
  `build_workflow` does, with the same `ignoreUnresolved` opt-out. (F5-09)
- **`replaceFieldId`** — a custom field's `dataType` is immutable, so converting one produces a
  NEW id and every reference must move, across both documents. Merge tags are deliberately left
  alone: they key off `fieldKey`, which the new field regenerates from its name. (F5-18)
- **`replaceInAttributes`** — a literal string replace at ONE dotted attribute path, optionally
  scoped to a step type. No regex, no path guessing.
- **`repair_workflow`** — the full-document PUT with every edit guard and a round-trip verify.
  The sanctioned replacement for the hand-rolled PUT that skips all of them; `expectedVersion`
  refuses a stale read with `VERSION_CONFLICT` instead of overwriting another edit.
- **Op-name aliases and a nearest-match unknown-op error.** `unknown edit op: X` named nothing,
  which is how the escape hatch became the default. The error now lists all four op families and
  suggests the nearest match, comparing against aliases as well as canonical names.

### Changed

- **`modifyStep` runs the builder dispatch instead of a raw shallow merge.** A wait window patched
  without `days` and a notification patched with a flat `notificationType` were written exactly as
  given while the build path's builders knew the full drawer shape all along. Types whose author
  shape is not their wire shape, and containers, still merge as given and warn
  `MODIFY_NOT_NORMALISED` naming `retypeStep`. Guarded by a loss test over all 70 shipped step
  examples. (F5-20)
- **A trigger `target` may be a live step id or a unique step name**, resolved against the
  post-edit roster — so a goto trigger can point at a step the same call just created.

### Added (plan 3 — intent verification)

- **Two intent lints over the STORED document.** `lintOpportunityWrites` names an empty
  `__customInputFields__`, a top-level name key, a row whose value is not id-shaped, and a stage
  row with no pipeline row — each a step that saves, round-trips clean, renders half-empty and
  moves nothing. `lintTriggerRows` requires string `operator`/`type` universally and, where the
  catalog models the row, warns on an off-menu operator.
- **Both verifiers now assert intent, not echo.** On a build every step and trigger is that run's
  own work, so an intent error fails the build. On an edit the assertion is scoped to the steps
  the edit TOUCHED — an error there returns `ENGINE_ABORT` naming the finding, while an untouched
  legacy step is reported and never fails the caller's edit.
- **`if_else` can route on trigger identity in one build** (F5-17). A trigger may carry a `ref`,
  and a branch may say `{ conditionType: 'trigger', trigger: '<ref>' }`. Placeholder ids are
  minted before the graph is flattened and reconciled against the server's ids after the POST
  loop, rewriting only the placeholders the document actually references.
- **ConvAI `tones`, the UI-save rule table, and summary knobs** (F5-31). The tier between "the API
  422s" and "the API accepts but the write is inert" is *the API accepts it and the builder then
  refuses to save the agent*. Rules are ported verbatim from the shipped validator bundle.
- **`update_convai_agent`** — read-merge-write with a collateral diff.

### Fixed (plan 3)

- **A ConvAI partial `PUT` resets omitted agent-level booleans** (F5-04). The "it merges" claim
  came from a capture whose at-risk fields were already `false`, so a reset was invisible in it.
  Updates now GET the record, overlay, apply the builder's own bot-type cleanup, PUT the WHOLE
  record, re-read, and diff every field the update did not set — because it is precisely the
  fields we did not set that a bad PUT silently resets. Any movement fails
  `AGENT_COLLATERAL_CHANGED`.
- **`BOT_TYPES` listed two of three.** `FORM_BASED_BOT` ships in the builder's own enum and has
  its own pre-PUT cleanup branch.
- **`predeterminedId` is sent for `inbound_webhook` only.** The builder's
  `addPredeterminedIdIfRequired` sets it for that type and resets it to `''` for every other —
  emitting it everywhere would have been exactly the off-dialect guess this release removes.

### Removed

- **The `TARGET_REF_UNSUPPORTED` refusal.** It existed only because `buildTrigger` had no refMap
  on the edit path; it does now, so only a genuinely unresolvable target is refused.

## [0.38.0] — 2026-08-29

Phase-5 guards and data. Every item below is a defect that produced a **clean-looking result** —
a 200, a green round-trip, a "built successfully" report — while the thing the author asked for
did not happen. The theme of the release is closing the gap between "GHL kept my keys" and "the
stored body expresses my intent".

**Live-proven on the designated test sub-account (GROM Digital AUS `wdzEoUZnXO9tB3PPzcot`),
2026-08-29, against the WORKING TREE — the installed 0.37.1 build still carries these bugs:**

| Finding | Before | Receipt |
|---|---|---|
| F5-01 | threw `AI_RAIL_HOST_INVALID` by construction | `ai`-rail `GET /marketplace/core/search/module` with **no explicit base** → `200` on both the actions and triggers legs, hitting `services.leadconnectorhq.com`. The `jwt` rail still reaches `backend.` with `200`, and an explicitly wrong base is still refused. |
| F5-16 | 0 of 7 `call_status` triggers POSTed (`500` each) | 7 of 7 persisted on workflow `6c3140b3-65fc-4223-a47d-ebe72dcc2681`; every stored filter reads `type: "multiselect"` (a string) with `operator: "contains-any"` — no `__dynamic__` object on the wire. |
| F5-11 | `ENGINE_ABORT` "did not persist" on a trigger that DID persist; retrying duplicated it | `addTrigger` → `200`, verified clean, trigger count 7 → 8 with exactly one instance of the added trigger. |

Probe artifact left in place for a human to remove, per the standing rule: workflow
`6c3140b3-65fc-4223-a47d-ebe72dcc2681` on GROM AU, named
"PROBE 2026-08-29 F5-16 call_status multiselect (safe to delete)", plus the tag `probe-f5-16`.

### Fixed

- **`list_marketplace_apps` threw `AI_RAIL_HOST_INVALID` on every call, in both profiles, from
  0.23.0 to 0.37.1.** The gateway pinned the request base to the backend host as a *parameter
  default*, so an `ai`-rail call always carried an explicit wrong base and the rail guard refused
  its own most natural call. The base now follows the rail. (F5-01)
- **A failed marketplace read reported "app not installed".** A network or auth failure on the
  assets/actions/triggers legs was indistinguishable from a genuine absence, so the compiler
  refused valid marketplace keys with a confident wrong reason. Each leg now reports its own
  outcome and a read failure raises `MARKETPLACE_READ_FAILED`. (F5-02)
- **`ValueDataType.MULTI_SELECT` reached the wire as an object.** Four trigger filter rows carried
  an unresolved enum, and `POST /workflow/{loc}/trigger` returned 500 on all 7 `call_status`
  triggers while the steps saved fine. Non-string condition `type`/`operator` are now refused
  (`FILTER_SHAPE`), and the extractor resolves the enum at source. (F5-16)
- **A trigger that failed to POST left a workflow that looked complete.** The build now re-lists
  triggers after the POST loop and compares authored / posted / persisted. (F5-03)
- **`edit_workflow addTrigger` reported `ENGINE_ABORT` "did not persist" on triggers that DID
  persist.** The verifier read `workflowId` while GHL stores `workflow_id`; retrying on that false
  negative duplicated the trigger. The verifier now compares the stored shape. (F5-11)
- **A container authored by its wire type silently dropped its whole subtree.** `kind` is now
  inferred from the type, wire type aliases are canonicalised at intake, and `branches`/`paths`/
  `target` on a non-container is refused rather than discarded. (F5-08)
- **A pipeline or stage NAME could reach the wire on four different doors** — the lean type, the
  wire type, an edit-op insert, and a `modifyStep` patch — where GHL stores it verbatim as a dead
  top-level key and the stage move never happens. It reached eight client workflows on 2026-08-28
  while the build reported clean. All four doors now refuse it (`UNRESOLVED_NAME`), and the
  documented `ignoreUnresolved` opt-out still works, loudly. (F5-09)
- **Eight of thirteen edit anchor lookups were silent no-ops on an unknown step id** — including
  `retypeStep`, `moveStep` and `deleteContainer`. All thirteen now fail closed. (F5-12)
- **`describe_step_type` served truncated unions, wrong defaults, and inverted required flags.**
  The type-card generator split markdown table cells on every `|`, escaped or not, so a cell
  listing a union was cut at its first member *and every column after it shifted left*. 35 cells
  across 19 cards; 10 fields were reported OPTIONAL that are required, including
  `remove_from_workflow.workflow_id` — omit it and the step is inert. `custom_webhook.method` was
  served as optional with default `"PUT" \` against a real default of `"POST"`. (F5-23, F5-20)

### Added

- **`MERGE_TAG_UNKNOWN`** — a merge-tag policy derived from the renderer's own source rather than
  from corpus counts. A `{{tag}}` GHL cannot resolve renders as literal text to the customer, and
  nothing in GHL catches it: `{{appointment.date}}` and `{{appointment.time}}` went out for three
  weeks. The old check read a corpus verdict that called `appointment` an OPEN namespace — a
  conclusion drawn from a single published typo. Closed namespaces now error; `contact.*`,
  `opportunity.*` and `custom_values.*` are checked against *this location's* fields and values;
  gated and unknown namespaces warn. Findings carry suggestions. Hatches: `strictMergeTags:false`,
  `skipMergeTagCheck`. (F5-27)
- **`triggerIntegrity` and a top-level `partial` flag** on the `build_workflow` report.
- **`deadBranchAcknowledged`, `allowDanglingParentKeys`, `allowDanglingStepRefs`** on
  `edit_workflow`. All three were enforced by the commit layer but absent from the tool schema, so
  no MCP caller could ever set them — an unreachable hatch is its own defect class.
- **`WAIT_UNIT`** — wait units are validated against the drawer's own option list
  (`seconds | minutes | hour | days`). An unknown unit publishes clean and leaves the pause
  undefined. `hours` is accepted with a warning pending a live probe.

### Changed

- **Ten documentation sites corrected to current truth**, stale text replaced rather than
  annotated: `eq` vs `==` on custom triggers (the save validator has refused `eq` since GHL's
  ~2026-08-27 update), marketplace operators are per filter type, `modifyStep` is a raw shallow
  merge that runs no builder and no lint, calendar availability is schedule-governed and entirely
  on the PUBLIC rail, the ConvAI partial `PUT` resets omitted agent-level booleans (the "merge"
  claim came from a capture whose at-risk fields were already `false`), and
  `list_account_entities` returns 20 entity kinds, not the 6 it advertised.
- **Catalog regenerated** behind a new `diff-catalog.mjs` gate: 0 lost on every axis, 22 merge tags
  gained, 15 `document` labels realigned, 4 filter row types resolved. Three generator defects
  fixed upstream — most seriously a comment stripper that treated a `/*` inside a `//` comment as
  a block-comment opener and deleted 2,330 characters of live source, taking 13 real picker tags
  with it and reporting nothing.
- Both self-retiring overlays (`ENGINE_STATIC_TAGS`, `resolveMultiSelectType`) were named by their
  own staleness tests and removed.

## [0.37.1] — 2026-08-29

A polish release: one advisory fix, one latent bug caught in review before it ever fired, and a
documentation-wide rewrite under a new house rule — comments and docs state what is true now;
git and this file hold the history. Roughly thirty layered "superseded / corrected on <date>"
comment blocks across the engine, the MCP server and the skills were collapsed into present-tense
statements, with every measured fact and every "do not do X" kept (the review audited each rewrite
against the old text for fact loss and found none).

### Fixed

- **`requiresPublish` now flags an activation that lands on a draft workflow.** A `modifyTrigger`
  setting `active: true` on a trigger whose workflow is still draft genuinely activates the trigger
  — it will evaluate and match — but a draft workflow does not enrol, so reporting "nothing more to
  do" under-advised. The response now says the workflow must be published before anything runs.
- **`modifyTrigger` refuses a `target` ref with a clear message** instead of a misleading
  `REF_DANGLING` throw. `target` is an IR ref; the edit path has no IR graph to resolve it against —
  the refusal says so and names `targetActionId` as the field to use.
- **A supplied non-boolean `input_trigger_params` is refused**, never passed through — the string
  `"False"` is exactly the value GHL rejects with "Expected boolean".
- **The spurious `TRIGGER_TARGET: … NO target` warning no longer fires** on every modify of a goto
  trigger: the stored `targetActionId` is forwarded into the rebuild rather than surviving by
  spread order. `renameStep` on an unknown id now names `renameStep` in its error.

### Changed

- `CATALOG_CORRECTIONS` `note` evidence now renders into the generated capabilities index alongside
  `docNote`; the `TRIGGER_CORRECTIONS` staleness check is a generic loop that fails loudly on an
  entry shape it cannot check; the `docNote` render path and the `input_trigger_params` default
  each gained a direct regression test.

## [0.37.0] — 2026-08-28

Two long-open community pull requests, verified rather than adopted. Every claim was re-tested
against a live account before anything landed; two were corrected by the testing, one was refuted
outright, and the refutation root-caused a bug that had been misattributed since July. Contributed
work is credited with `Co-authored-by` on every commit.

### Added

- **Knowledge Base rich-text UPDATE.** `compileRichTextUpdate()` compiles the
  `PUT /knowledge-base/rich-text/{id}` full-replace — verified live: byte-identical read-back, the
  server re-chunks and re-embeds itself (no separate retrain call; poll the status endpoint exactly
  as for create). Without it the only ways to edit a live rulebook were delete-and-recreate, which
  leaves an agent with **no** rulebook if the create leg fails, or adding a second document, which
  cannot remove a contradicting passage.
- **The compiler now REFUSES a `contentMarkdown` key**, on create as well as update.
  `contentMarkdown` is server-derived: a direct write returns **200 and changes nothing** (measured
  in both shapes on an existing document). Silently forwarding it would recreate exactly the
  "acknowledged but inert" defect class this engine has been eliminating all week. The create-path
  guard is explicitly marked preventive rather than separately measured.

### Changed

- **`ghl-knowledge-base`** documents the update path, the async retrain, the `contentMarkdown` trap
  and the newly captured KB-create schema (`POST /knowledge-base/` `{locationId, name}`).
- **`ghl-conversation-ai`** documents the two workflow-facing conversation-summary outputs —
  `summary.customFieldId` (writes each summary to a contact custom field) and
  `summary.workflowIds[]` (enrols workflows when a summary commits). Field existence is corroborated
  from our own captures; the behavioural details and the UI location are labelled
  contributor-attested and not independently re-verified.
- **`ghl-reverse-engineering`** gains the contact smart-list surface, and corrects the contributed
  claim that it is `services`-only: the same routes answer on **both** hosts, each on its own single
  credential — `services` + `token-id` (what the browser calls, with no `Authorization` header at
  all) and `backend` + plain `Bearer`. So a caller already holding the workflow-rail Bearer needs no
  second credential here. Also adds the 422-schema-recovery technique (re-verified in use), the
  deep-link-404-partial-shell trap, and the contact-search index lag.

### Not adopted

- The contributed "trigger `_id` registration trap" — that an in-place trigger PUT reuses the `_id`
  and is never re-subscribed, so tag/stage triggers save but never fire — is **refuted**. Drive-test
  on four triggers with different life histories, including one carried through ~7 in-place PUTs on
  the same `_id`: all four fired ~5.5 s after the event. The real cause was the `status: "draft"`
  clobber fixed in 0.36.0, which silently deactivated every trigger `modifyTrigger` touched. The
  proposed delete-and-recreate remedy is now actively harmful: it mints a new trigger id, which
  breaks trigger-identity `if_else` routing, resets stats, and re-mints inbound-webhook URLs.

## [0.36.0] — 2026-08-28

The 0.35.0 release shipped a limit stated as fact: "a trigger reading inactive on an
already-published workflow cannot be activated through any known API path." Re-investigation
disproved it the same day — and on the way found a live, client-affecting bug that predates every
recent release. The mechanism, measured one variable at a time on throwaway workflows: a trigger's
`active` flag is a **read-only projection of the trigger's own `status` field**
(`active === status !== "draft"`). `active` itself is never a write; `status` is. The recovered
source had said so all along (`Trigger.ts:74,79`) — in a research page the API page contradicted.

### Fixed

- 🔴 **`modifyTrigger` deactivated every trigger it edited on a published workflow.** The trigger
  body was rebuilt through `buildTrigger`, which hardcodes `status: "draft"` — so any content edit
  silently switched the trigger off. This is the unexplained "active flipped to FALSE" observation
  from 2026-08-17, finally root-caused. A modify now sends no `status` at all (absent = unchanged,
  measured) unless the caller asked for an activation change.
- 🔴 **`addTrigger` on an already-published workflow created a trigger that could never fire** —
  it landed `status: "draft"` with no publish transition ever coming. Triggers created on the edit
  path now carry `status` matching the target workflow's publish state; the build path keeps
  `"draft"` deliberately, so a new workflow's triggers stay inert until publish.
- 🔴 **The 0.35.0 refusal of an explicit `active` change is replaced by the real write.**
  `active: true` translates to `status: "published"`, `active: false` to `status: "draft"`; a value
  matching the stored state, or no `active` at all, sends no status key. Live-proven: a trigger
  stranded inactive by the old engine shape was activated through `scripts/edit.mjs` and read back
  active, alongside a content-only modify that stayed active.
- 🔴 **`requiresPublish` no longer tells a caller to undo their own deactivation.** Caught in
  review before shipping: after an explicit `modifyTrigger active: false`, the response instructed
  the caller to run `publish_workflow` — whose cascade would have turned the just-disabled trigger
  back on. A modifyTrigger translate is self-contained in both directions and never needs a publish.
- **`publish_workflow` (and both other publish paths) now REPAIR inactive triggers** on an
  already-published workflow: one per-trigger PUT with `status: "published"` per inactive trigger,
  verified by a fresh read-back, failing loudly only after the repair. The 0.35.0 "no known API
  path" comments and tool descriptions are corrected, with the belief-and-disproof history kept.

### Changed

- A bogus `status` value is accepted by GHL with a 200 and silently ignored — measured — so every
  status write remains proven by reading `active` back, never trusted.
- Round-trip verification now checks `active` when (and only when) the op carried an explicit
  `active` request, in both directions.
- Known, recorded, not yet fixed: a `modifyTrigger` activation applied to a trigger of a
  still-draft workflow gets no advisory that the workflow itself must be published before anything
  enrols — the trigger will evaluate and match, but enrolment stays gated by workflow status
  (measured: draft-first holds one layer lower than assumed).

## [0.35.0] — 2026-08-28

GHL tightened its save-time validation around 2026-08-27 and engine-built workflows stopped being
saveable — by the API and, worse, by a human clicking Save in the builder. Four independent data
faults, each fixed at the boundary where the request body is assembled, each proven by a live A/B
that changed exactly one variable. The acceptance test is the one that cannot be faked: an
engine-built flow opened in the real builder, edited, and saved with a 200 and no manual repair.

### Fixed

- 🔴 **Terminal steps shipped `next: null`, and the save validator refuses it.** A step with an
  explicit null `next` is rejected with `Next is invalid. Please provide a valid value.` — naming a
  step the caller never touched, so one legacy terminal blocked every edit to the whole workflow.
  The builder omits the key entirely; the server stores it absent. Live A/B on a throwaway probe:
  `next: null` → 400, key absent → 200, same body otherwise. Normalisation now happens at every
  boundary that assembles a request body — build, edit, and both publish paths — through the new
  `engine/terminals.mjs`. This also un-broke `publish_workflow`, which echoed a fresh GET verbatim
  and inherited every stored null.
- 🔴 **`add_to_workflow` steps shipped without `input_trigger_params`, blocking EVERY save on the
  workflow.** GHL refuses the document with `Input Trigger Params is required`. It must be a real
  boolean — the UI drawer writes the string `"False"`, which the validator rejects with
  `Expected boolean`. Proven by differential against two captured builder bodies: the one that
  returned 200 carries the flag on both enrol steps, the one that returned 400 carries neither.
  The compiler now defaults it, and the edit and publish paths repair legacy steps on the way out.
- 🔴 **`conv_ai_autonomous_trigger` conditions shipped `operator: "eq"`, which the updated validator
  refuses** with `trigger-condition-invalid`, one error per row. Live A/B: identical body, `eq` →
  400, `==` → 200. Corrected through a new trigger-side catalog overlay, because the value comes
  from a generated file that must never be hand-edited. Blast radius is narrower than it looks and
  is documented: the validator only runs when triggers ride in the request body, which the engine's
  own commit never does — so stored `eq` triggers block a human clicking Save, not `edit_workflow`.
- 🔴 **Five edit operations returned a clean empty diff for a step id that does not exist**, so a
  typo or truncated id read back as a successful no-op (`ok`, `stepCount 6 → 6`, `createdSteps: []`).
  `deleteStep`, `insertAfter`, `modifyStep`, `insertBefore` and `insertSubgraphBefore` now throw,
  matching `addStepNote` and `duplicateStep`, which already did.
- 🔴 **`edit_workflow` reported `ENGINE_ABORT` after every successful edit that touched a terminal.**
  The round-trip verifier compared the in-memory graph (terminals still `next: null`, by design)
  against the read-back (key now absent), and told the operator to inspect a workflow that was
  perfectly fine. Both sides are now normalised identically.
- 🔴 **Trigger activation was written through a rail that cannot persist it.** Measured 2026-08-28:
  publishing with **no** trigger write at all flips a trigger to `active: true` within 0.28s of the
  publish PUT returning, while a per-trigger PUT setting `active` returns **200** and changes
  nothing in either direction. `active` is a server-managed projection of the workflow's publish
  state. The inert write is removed; the post-publish verification that reports the truth is kept;
  and `modifyTrigger` now refuses an attempted `active` change instead of silently no-op'ing.
  Known limit, recorded rather than papered over: a trigger reading inactive on an ALREADY-published
  workflow cannot be activated through any known API path.
- **`conversationai_objective`'s `proceedIfNotMet` means the opposite of its name**, and nothing said
  so. It is bound directly to the checkbox "Don't Proceed to Next Objective If Criteria not Met.",
  so `true` blocks. Checking it also makes `closingMessage` required — a field the engine did not
  know, so it could not author a valid blocking objective at all. Both keys added, the coupling
  enforced, and the polarity documented at every site that describes the field.
- **A real staff name shipped inside a captured example** in this public repo, and the privacy gate
  reported clean because it matches only names someone had registered. Scrubbed, and the name
  registered so a recurrence fails the gate — proven both directions. A sweep of all 99 capture
  files found no other real person's name.

### Added

- **Goto loops are refused at compile time** (`GOTO_LOOP`). A goto that closes a cycle gets the
  workflow stamped `loopIdentified` by GHL's backend and demoted to draft — a published workflow
  silently stops. The detector follows goto jump edges as well as `next`, so a mutual two-goto cycle
  is caught. The edit path carries the same check, scoped to the steps an edit touched so a legacy
  loop cannot brick an unrelated edit, with an `allowGotoLoops` escape hatch that `edit_workflow`
  now exposes.
- **A warning when a spec relies on `conv_ai_autonomous_trigger` re-entry** (`GOTO_TRIGGER_RACE`).
  GHL can deliver one trigger event twice ~15s apart; the second delivery's remove lands on the run
  the first created and no re-enrol follows, killing the run mid-conversation. Reproduced 3/3.
  The docs now carry GHL's own safer pattern instead.

### Changed

- **`build_workflow` no longer asserts a publication state it never checked.** It records the status
  read back after the build and warns when that is not `draft`. This surfaced a platform behaviour
  worth knowing: `workflowType: "agent"` flow workflows are stored **published** by GHL regardless of
  what was requested, while ordinary workflows store `draft` correctly.

## [0.34.0] — 2026-08-26

Flow bots become buildable. A `FLOW_BUILDER_BOT`'s logic **is** a workflow, and the engine has
been able to emit those nodes for a while — but it bound them to the wrong field, could not
author the trigger that jumps into them, and compiled one of the nine nodes into a step that
saves and cannot branch. All three are fixed and live-proven.

### Fixed

- 🔴 **Flow workflows were built UNBOUND.** The compiler emitted `convTriggerBotId` as a
  top-level key on `conv_ai_trigger`. GHL **discards** it — it does not even round-trip as an
  unknown key. The real binding is a condition row,
  `{ operator: "==", field: "botId", value: <AGENT_ID>, title: "", type: "input" }`, which is
  what GHL's own client stores. Every flow built since the key was introduced on 2026-07-15 had
  an entry trigger bound to nothing, while the build reported `verify.pass: 1` and zero warnings —
  round-trip verification compared the engine's output to itself, so a field the server dropped
  was never in the comparison. A/B-proven on the designated test sub-account and confirmed by
  GHL's own flow builder, which now renders `Bot Id is "<agent>"` on the trigger node.
  An unbound `conv_ai_trigger` now warns (`FLOW_BINDING:`).
- 🔴 **`conversationai_services_booking` compiled as a plain node.** The marketplace asset gives
  it two pre-defined branches (`Appointment Booked` / `Appointment Not Booked`), the same shape as
  `conversationai_book_appointment`. The catalogue carried `isMultipathContainer: false` from a
  2026-07-15 panel read and the compiler had no case for it, so an authored node emitted with no
  `cat`, no `transitions[]` and `next: null`. It now compiles as a container with both branches.
- **Two more wrong key names were still shipping.** `conversationai_end` carried
  `customMessage`/`reactivate`/`duration` and `conversationai_continue` carried `prompt` — the
  exact names the corpus corrected in prose on 2026-07-27, never corrected in the generator. Real
  keys are `message`/`sleepEnabled`/`sleepDuration`/`sleepUnit` and `instructions`. Both now have
  committed captures and are `verified-live`.

### Added

- **Per-field validation rules are enforced.** The marketplace catalog carries a `validations[]`
  array on each input — 55 fields across 307 actions — holding the rules the builder evaluates in
  the browser for its "Resolve N Errors" banner. The engine parsed required-ness and dropped these
  entirely. **Eleven sit on seven of the nine flow-bot nodes**: 600-character caps on
  `ai_message`/`custom_message`, 500 on `ai_splitter.description`, `book_appointment
  .promptInstructions` and `objective.objective`, 1000 on the two `instructions` fields, 300 on
  `end.message` and `objective.responseExample`, and `objective.maxAttempts` bounded to 1–5.
  **The server enforces none of them** — `maxAttempts: 99999` was written and stored clean in a
  live probe — so exceeding one produces a workflow that saves and carries a red badge.
  🔴 Rule strings are **never evaluated**: the catalog arrives over the network, so its
  arrow-function sources are untrusted input. Two shapes are pattern-matched into comparators and
  everything else is skipped and named by `unreadableRules()` — 44 of 59 readable, all 11 flow-bot
  rules among them, the 15 remaining being composite expressions on third-party app actions.
- **Flow-trigger guards (`FLOW_TRIGGER`).** Probed live: the API enforces **none** of the drawer's
  custom-trigger rules — it accepted 8 custom triggers on one workflow (the cap is 3), a
  `targetActionId` naming no step, no target at all, duplicate targets, `priority: "999"` and
  `sensitivity: "telepathic"`, all 200 and all persisted. The engine now refuses them, because
  nothing downstream does: a custom trigger without a `conv_ai_trigger` to jump within, more than
  three of them, an out-of-range priority, or a sensitivity outside `low|medium|high`. Two custom
  triggers on the same target warn rather than throw — legal, but usually a slip.
- **Custom (goto) triggers are authorable.** `conv_ai_autonomous_trigger` — "Custom trigger" in
  the UI — does not start a flow, it **jumps the contact to a named step**. Author it with
  `target: "<step ref>"`, resolved to the real step id exactly as `goto` does; a dangling ref
  throws `REF_DANGLING` rather than emitting a trigger with nowhere to send the contact. Its four
  required filters expand to the envelope GHL's builder writes — `operator: "eq"` (not the `==`
  the `botId` row uses), `type: "input"`, `title: ""`.
- **`references/flow-bots.md`** — the authoring guide: the binding, workflow-first creation order
  (the agent 422s without an `objectiveBuilderWorkflowId`), custom triggers, and the
  terminal/container/label-vs-key rules for the nine Conversation-AI nodes.
- **The whole flow-bot surface is now in the corpus** — nine step pages where there were none
  (`describe_step_type` returned nothing for all nine), both trigger pages rewritten with real
  filter rows, and `40-rules/flow-bot-action-compatibility.md`: a flow is an ordinary workflow
  minus a **denylist of 59 native action keys**, so third-party marketplace actions ARE permitted
  (proven with a GoGHL WhatsApp step), while **all 7 native WhatsApp actions are blocked**.
- **`scripts/check-example-pointers.mjs`** — 28 of the shipped catalogue's `example:` pointers
  resolved nowhere. The trigger examples now ship, scrubbed of every identifier.
- Endpoint overlay: `PUT /workflow/{loc}/only-triggers/{wid}` and `POST /workflows/es/search`
  proven, with the traps that make them worth knowing.

### Changed

- `edit_workflow` **refuses** `modifyTrigger` / `deleteTrigger` on a `conv_ai_trigger`. GHL's API
  enforces none of the builder's immutability — live-proven: rebinding to another agent and
  retyping the trigger away from `conv_ai_trigger` both return 200 and apply. Breaking either half
  orphans the bot. Hatch: `ctx.allowFlowTriggerEdit`.

### Known limits

- **Nothing here is runtime-proven.** No contact has chatted with a flow bot; these are stored
  shapes and what the builder renders.
- Flow workflows come back `status: "published"` on creation, engine-built or UI-built. The
  draft-first guarantee does not hold for `workflowType: "agent"`. Unexplained.
- `conversationai_services_booking` needs a configured commerce service; the builder refuses to
  save it without one.

## [0.33.0] — 2026-08-25

The internal rail gains discovery. Capability used to arrive only through hand-written
skills and tools; an endpoint nobody had wrapped was, for an agent, an endpoint that did
not exist. **`search_endpoints` / `describe_endpoint` now index 806 endpoints across every
GHL product this project knows** — the mirror of `search_actions` on the public rail.

### Added

- **806-endpoint catalogue**, from four kinds of evidence, and every row says which:
  324 mined from the workflow builder's own recovered source, 160 from the memberships
  front-end, 308 transcribed into the corpus from live traffic, 14 adopted from what the
  shipped tools call. A row carries what it DOES (`kind`), what it returns (`summary`),
  the typed tool that already covers it (`coveredBy`), whether a location token has been
  PROVEN to reach it (`reach`), and the one trap worth knowing (`note`).
- **`describe_endpoint` hands you `callWith`** — a copy-pasteable `raw_request` path with
  the prefix folded in — or says plainly that `raw_request` cannot make the call at all
  (multipart, blob, SSE, or a header it has no way to set). 31 rows are in that category.
- **A funnels corpus surface**, 9 pages. That surface's entire body of knowledge had lived
  inside one skill's recipe file, outside the corpus.
- **Server instructions on both profiles** — neither published any before.
- `scripts/build-surfaces.mjs` in `knowledge/`, because SURFACES.md claimed "this table is
  generated from the tree, so it cannot drift" and nothing generated it. It had drifted
  four ways.

### Changed

- **Skills stop warning about what the engine enforces.** `create-ghl-workflow`'s gotchas
  are split into what the engine GUARANTEES (147 throw sites: auth header, build order,
  casing, condition shapes, `OPP_UNASSOCIATED`, the pre-write abort) and what it does NOT
  catch — the ones that build clean and behave wrongly at runtime. The second list was
  buried under the first.
- **The two capture skills lead with their tools**, not with JWT capture. `get-ghl-workflow-logs`
  says outright that the tools get you the rows while the interpretation is what stops a
  confident wrong answer.
- **`ghl-events` and `ghl-knowledge-base` drop their endpoint tables**, keeping every trap.
  `ghl-events`' public-registration sequence survives — it is procedure, not a lookup.
- **`ghl-orientation`'s router gains the internal mirror rule.** It had "unsure about a
  public endpoint? `search_actions` first" and no equivalent for the internal rail.
- Ranking knows what an endpoint DOES. A destructive row no longer surfaces for a
  read-shaped question, and 25 rows proven to 401 from this rail are demoted rather than
  wasting a turn.
- `raw_request` sends `sourceid`, which the memberships surface pins on every request.

### Fixed

- **The committed bundles carry the endpoint catalogue.** `dist/` read it from a sibling
  directory, so `search_endpoints` worked in this repo and failed anywhere else — and the
  bundle test passed because listing tools never touches the catalogue.
- **The capability manifest was stale**, 137 rows against 158; 21 real capabilities were
  missing from the shipped artefact with nothing failing.
- **The privacy and manifest gates run in `npm test`.** They ran only from an opt-in git
  hook, so a fresh clone had neither.
- A stub catalogue entry no longer shadows a hand-written tool description.

## [0.32.0] — 2026-08-25

### Removed

- **The audit is retired**, pending a focused redesign. `/uxie-ghl-factory:audit`, the
  `surface-auditor` and `finding-verifier` agents, and the four audit skills
  (`ghl-audit-primitives`, `ghl-defect-catalog`, `ghl-opportunity-catalog`, `ghl-mermaid-map`)
  are unregistered and moved **whole** to `archive/audit-retired-2026-08-25/`, with a note on why
  and what a rebuild should change. Nothing was deleted. 19 skills → 15, 12 commands → 11.

### Fixed

- **`get_workflow_logs` now labels GHL's lifecycle rows.** `add_to_workflow`,
  `added_to_workflow` and `remove_from_workflow` are emitted alongside authored steps, carry a
  `stepName` that reads like a real step, and match no `templates[]` entry — so correlating them
  invents steps that do not exist. They are flagged `isLifecycleRow: true` rather than dropped,
  because `added_to_workflow` is still the only proof a trigger fired.
- **The tool's note now says what `finished` means.** A roster status of `finished` covers both
  *completed the workflow* and *was removed from it*; the roster cannot distinguish them, so any
  completion rate computed from it overstates.

### Changed

- `get-ghl-workflow-logs` teaches the three traps that cost real time — `finished` is not
  completion, some log rows are not steps, and execution logs carry contact PII
  (`contactName`/`contactEmail` on every row).
- `ghl-workflow-specialist`'s anti-patterns records that **`allowMultiple: false` has two
  bypasses** — an appointment **or invoice** trigger, and opportunity fan-out — and that re-entry
  during an active enrolment is *skipped, not queued*.
- The gateway documents why `channel`/`source`/`version` are sent on every call: without them
  anything outside `/workflow/*` returns 401 with `version header was not found`, which reads as
  an auth failure and is not one. The version value is validated against an allowlist, not merely
  required.

## [0.31.1] — 2026-08-25

### Fixed

- **`describe_endpoint` was telling users something false.** It claimed `/workflow/*` and
  `/workflows/*` are "different auth scopes on the same host". They are not — they share the
  token. Endpoints outside the `/workflow/*` prefix need three extra headers
  (`Channel: APP`, `Source: WEB_USER`, `Version: 2021-04-15`) and return `401` with the body
  *"version header was not found"* without them, which reads like an auth failure and is not one.

  Proven by differential: one endpoint, one Bearer, five header sets — only the set carrying
  `Version` returned `200`. Three endpoints previously written off as unreachable all answer
  `200` with the headers, and a `/workflow/*` control still answers with or without them, so the
  headers are additive and safe everywhere on this host.

  `describe_endpoint` now reports the header requirement per row instead of asserting a scope
  split.

## [0.31.0] — 2026-08-25

### Added

- **Graph-context rules** — the last two GHL validators that could not live in the attribute
  layer, because one needs the node's parent and the other needs every other step of its type.
  Both warn, matching GHL's own severity.
  - **`goto` placement.** A goto jumps away, so any step below it in the same branch can never
    run. GHL asks whether the parent still points onward; so do we.
  - **`math_operation` upstream references.** A math step can read an earlier one's result via
    `{{math_operation.N.result}}`. Two failures are invisible on the node itself: the upstream
    step was deleted, or its type drifted (the first op switched to `date` while this one still
    declares `numerical`). GHL resolves N by `stepIndex` and falls back to template order when
    it is unset — both paths reproduced, because they disagree in the tree view.

## [0.30.1] — 2026-08-25

### Fixed

- **Two of the enforcement rules shipped in 0.30.0 were dead.** Nine step types take a dedicated
  attribute builder, and `enforceRequiredFields` is wired into the generic path only — so those
  types reached GHL having run none of their rules. `email.html` was among them: the rule that
  stops a step **sending a blank email** shipped doing nothing, as did both `custom_webhook`
  body-shape rules.

  This was found on `wait` during 0.30.0 and patched per-branch, which fixed one symptom and left
  the rest. The seam now wraps the whole dedicated-builder set, so a tenth builder cannot silently
  disarm its rules.

  Found by live-fire, not by tests: all 866 unit tests passed throughout, because they call
  `enforceRequiredFields` directly and never exercise the dispatch. The new regression test asserts
  the invariant through `compile()` and is proven to fail when the seam is bypassed.

## [0.30.0] — 2026-08-25

### Changed

- **Commands renamed to name their rail.** `/setup` sets up both rails, so it keeps its name;
  the three rail-specific commands now say which one they touch:
  `/add-account` → **`/public-add-account`**, `/scope` → **`/public-scope`**,
  `/connect` → **`/internal-connect`**. Nothing about their behaviour changed. The old names
  are gone rather than aliased — an alias would leave two ways to say the same thing in a
  surface whose whole problem was ambiguity about which rail you are on.

### Added

- **`search_endpoints` and `describe_endpoint`** — a discovery layer for the internal rail,
  over 235 endpoints mined from GHL's own builder source. Previously the rail had 39 typed
  tools and nothing else: any other endpoint was reachable only if you already knew its path.
  There is deliberately no `execute_endpoint`; `raw_request` already executes, already carries
  the confirm gate and the secret scrub, and a second executor would drift from the first.
- **`scripts/capture-token.mjs`** — out-of-band internal-token capture. The token is read off
  the wire inside its own process and written at mode 0600; only claim names, a TTL and the
  origin are ever printed. It also enforces the iframe-origin scoping rule, refusing a Bearer
  that would 401 on every workflow endpoint later.

### Fixed

- Nine enforcement rules GHL states that the generated catalog had dropped, including
  `email.html` — the engine wrote `html: ''` on the inline path, so "subject, no body"
  compiled, saved, opened clean and **sent blank**.
- README counts that had gone stale: 17 → 41 internal tools, 45 → 83 public categories.

## [0.29.0] — 2026-08-25

Two capabilities, and a portfolio that now has a rule behind it.

### Added

- **The workflow type catalog.** A builder could see 68 step examples; the union of valid values
  lived in 284 corpus cards that did not ship, and 29 step types shipped nothing at all. An
  example pins ONE value of every discriminator, which `references/step-shapes.md` calls
  "actively misleading" — the result saves, renders on the canvas, and does the wrong thing.

  `search_step_types` → ranked stubs, `describe_step_type` → the one card. The whole catalog is
  ~134,000 tokens and is never loaded: a search page costs ~360, a card ~400, and a session that
  never builds a workflow pays nothing.

  Proven end to end on a live account with `array_functions`, a type with **no example**: built
  from its card alone, opens in the builder, every value landed. The first attempt wrote
  `operation` where the card says `operations` — it saved, rendered, opened, and had nothing
  selected. The card was right; the reader was not. That is exactly the failure this closes.

- **`ghl-events`** — ticketed and RSVP events, tickets, add-ons, sessions, speakers, attendees
  and the three-step public registration flow. The public rail has no events surface at all, so
  this was a registered corpus surface with proven-live pages and no way to act on it.

### Changed

- **`ghl-ai-agents-specialist` split three ways.** One skill covered four products and this
  week's measurements gave them four different answers, so it could not carry all of them:
  `ghl-conversation-ai` (**public** rail — 17/17 sub-accounts return 200, every agent with its
  system prompt, and public exposes `fullPrompt`/`instructions`/`personality` that internal
  does not), `ghl-voice-ai` (**internal** — public shows 27 fields to internal's 51, and the gap
  is the whole behaviour layer), `ghl-knowledge-base` (**internal** — 5 of 9 source types have
  no public equivalent). Agent Studio is out of scope. The shared compilers moved to
  `engines/ai/`, since they served all three and had no business inside one of them.

- **Three "skills" are declared as libraries.** `ghl-audit-primitives`, `ghl-defect-catalog` and
  `ghl-opportunity-catalog` are only ever loaded by `/audit` and its subagents — nothing
  user-facing triggers them. Their descriptions now say so instead of competing for user intent.
  The loading paths are untouched.

### Fixed

- **The Voice AI verifier watched a third of what it wrote** (0.28.0), now 52 of ~55 fields.
- **A memberships test asserted a contract that no longer exists** — paid offers work; the
  rejection message it expected was gone and the test had been red since.

### Documented

- Nine places narrated their own history ("this reverses earlier guidance", "Corrected 2026-…",
  "previously said"). All rewritten to state the fact. One proven-status block had four layers
  of correction stacked on it and contradicted itself three times in twenty lines.
- `scripts/check-type-catalog.mjs` asserts the shipped cards match the corpus, at pre-push.

## [0.28.0] — 2026-08-25

A verification fix on the Voice AI rail, and the evidence behind it.

### Fixed

- **The Voice AI verifier was watching a third of what it wrote.** The full-replace PUT sends
  ~55 fields flat; the GET returns most of them nested under `agentSettings`, wraps two as
  objects, and renames two more:

  ```
  sent  voiceId / language / voiceModel / ringDurationSeconds: 5 / inboundPhoneNumber
  read  agentSettings.voice{voiceId,…} / agentSettings.language{code,…} /
        agentSettings.voiceModel / agentSettings.ringDurationMs: 5000 / inboundNumber
  ```

  The July fix had reclassified absent keys as `unverified` rather than `mismatched`, which
  correctly stopped 37 false alarms on a working agent — but left those 37 with no assertion
  behind them. A **real** failure would also have read `unverified`, indistinguishable from
  "the read does not expose it".

  `normalizeRead` now lifts `agentSettings`, unwraps `voice`/`language`, and undoes both
  renames, for the `voiceai` kind only. Live on the test sub-account, same agent:

  | | confirmed | unverified | mismatches |
  |---|---:|---:|---:|
  | before | 22 | 37 | 0 |
  | after | **52** | **4** | 0 |

  Each of the 52 was checked against the compiler's `DEFAULTS` — every value had in fact
  persisted, so the old run was under-reporting rather than the write failing.

### Documented

- **The 2026-07-21 "Voice AI update is broken (422)" entry was stale.** Re-proven end to end:
  create → full-replace update → verify returns **200** and `verified:true, mismatches:[]`. The
  422 came from `DEFAULTS` supplying `''` for `businessName` / `welcomeMessage` / `timezone`;
  `OMIT_WHEN_EMPTY` fixed it and has shipped since **0.20.0**. The corpus said a working
  capability was broken for five weeks.
- **The 4 fields that remain unverified are described honestly**, each checked against *two*
  agents rather than one: `backchannelFrequency` and `prompts` are **conditional** (present only
  when backchannel is on / the agent is configured); `numberPoolId` and `knowledgeBasePrompt`
  are **unknown** — absent on both agents tested, but neither agent was in a state that would
  reveal them. Absence in a single read is not evidence about the contract.

## [0.27.0] — 2026-08-24

The public rail moves off the hosted Cloudflare Worker and onto a local npm package, and the
setup becomes something an agent and a person can do together instead of a prompt only a
person can answer.

### Added

- **`/uxie-ghl-factory:add-account`** — add one GHL sub-account to the public rail. The
  agent cannot fetch either value (both live behind a browser login), so the command is
  explicit about the split: it works out what is missing and verifies what comes back, the
  person fetches. Verification is GHL's, not ours — a successful add returns the
  sub-account's **real name** from the API, which is what proves the token reaches that
  location rather than something either party typed.
- **`/uxie-ghl-factory:scope`** — point a folder at one client's sub-accounts **by name**.
  One credential file, narrowed per project.

### Changed

- **`/uxie-ghl-factory:setup` no longer sets up the Cloudflare Worker.** Step 3 previously
  ran `claude mcp add --transport http` against the hosted Worker with one token per folder.
  That Worker is being retired, so the command now sets up `@uxieee/ghl-mcp` from npm, adds
  sub-accounts to one verified credential file, and scopes the folder. Existing Worker users
  get a migration note rather than being left on it.
- **The trust note lost half its content, correctly.** It used to disclose that the user's
  Private Integration Token was forwarded *through* the author's Cloudflare Worker on every
  call. Running locally, the token goes only to GoHighLevel, so that paragraph is no longer
  true and is gone. What remains is the honest half: the server's tool descriptions and
  responses are still third-party code, and deserve the same scrutiny as any third-party MCP
  server.
- **Codex config is now the stdio form** in both READMEs — `command`/`args`/`env` rather than
  `url`/`http_headers`. Codex infers transport from `command`, and forwards only a fixed set
  of parent environment variables to a stdio child, so `GHL_ACCOUNTS_FILE` is named in `env`
  rather than assumed from the shell. `~/.codex/config.toml` is global, so the per-client
  pattern there is one named server per client rather than per-project config.
- **Both rails are still per-project, but for different reasons**, and `setup.md` now says
  which is which. The public rail no longer collides on credentials (they live in one file);
  folders are separated by *scope*. The internal rail holds a ~1-hour browser JWT for one
  account, so it cannot be global — and per-folder is the safer default anyway, since the
  rail that writes workflows is then armed only where it was deliberately set up.

### Corrected

- **`1,207 actions across 83 categories` → `671 distinct operations across 45 categories`**,
  in six places including the Claude manifest description, `ghl-orientation`'s
  `api-worlds.md`, and `ghl-audit-primitives`' surface map. The catalog still holds 1,207
  entries; the server now collapses the v2/v3 twins and returns one row per operation naming
  the other id, so 671/45 is what a caller actually sees. The number was read back from a
  live `list_categories` rather than copied from a README.
- `audit-io.md` claimed 83 categories were "deduped across v2/v3". They were not — 45 is the
  deduped count.
- The self-hosting link pointed at `github.com/uxieee/ghl-mcp-server`; the repository is
  `uxieee/uxie-ghl-mcp-server`.
- `setup.md` had two steps numbered 4.

## [0.26.0] — 2026-08-18

### Added

- **`create_custom_field_folder`** — create a folder to group custom fields under, on the
  contact or opportunity object. Confirm-gated like the rest of the write rail, and it
  returns the full stored record (the create response carries one, unlike the workflow
  writes that hand back a bare id), confirmed by reading the folder list back.

### Documented

Everything here was measured, including the negative cases:

- **AI host, but the plain Bearer rail.** The write targets
  `services.leadconnectorhq.com`, not the workflow backend. The captured browser call
  carried a `token-id`; resending it with that header removed still returned 201, so the
  tool does not ask for one — requiring it would have locked out every caller holding only a
  location JWT, for a write that never needed it.
- **`model` is `contact` or `opportunity`, and nothing else** — the server rejects anything
  else outright. Other models (e.g. `business`) exist on folders already in an account but
  cannot be created, so the tool refuses them locally rather than spending a request.
- **Folder names are unique per location per model.** A duplicate returns
  `400 Folder already exists` with `meta.existingId`. The tool checks before writing *and*
  handles the raced case, reporting the existing folder's id either way — so a re-run tells
  you what to reuse instead of just failing.
- 🔴 **Folder reads answer under `customFieldFolders`, not `customFields`.** The sibling key
  holds the FIELDS and comes back empty for a folder query, which makes a folder that *was*
  created look like it never was. This cost a wrong conclusion during capture and is now
  pinned by a test.

### Proof

Live round-trip through the real handler: preview (no write) → create, verified by read-back
→ duplicate name caught with the existing id → bad model refused without a request →
`opportunity` model created. Both throwaway folders deleted afterwards; the account finished
on the five folders it started with.

Suites: 757 MCP tests, 469 engine tests.

## [0.25.0] — 2026-08-18

Two independent rails, developed in parallel and released together. 0.24.0 was claimed by
the first of them mid-development and never shipped on its own; it is skipped rather than
back-dated.

### Added

- **Marketplace steps on the EDIT path.** `edit_workflow` and `scripts/edit.mjs` can now put
  a third-party marketplace action (a goghl.ai WhatsApp step, say) into a workflow that
  already exists — previously build-only. The per-location marketplace index is fetched
  **only** when an op actually carries `marketplace: true`, detected by walking the ops' step
  subgraphs rather than string-scanning them, so a purely native edit stays
  network-identical.
- **`retypeStep` edit op.** Changes what an existing step IS — its `type` and its whole
  `attributes` set — while preserving `id`, `order`, `next`, `parent` and `parentKey`
  byte-for-byte, failing closed if any of them moves. Zero graph churn: no
  delete-and-reinsert, no rewiring, so anything mid-flight walks the identical path after
  the edit. `attributes` are REPLACED, never merged — a merge strands the old type's keys
  under the new one. Containers are refused.
- **Workflow organisation tools** on the internal MCP: `list_workflow_folders`,
  `create_workflow_folder`, `duplicate_workflow`, `move_workflows`. All confirm-gated, none
  of them deletes anything, and every move is verified by reading `parentId` back off each
  record.

### Fixed

- `meta.stepIndexCounter` is recomputed from the final templates on every edit and written
  as a **high-water mark**, never accumulated onto the stored value — accumulating sent a
  counter to 24 for 12 steps. A marketplace step's `stepIndex` is renumbered per action key
  across the whole workflow, and any step whose number moved is reported in `modifiedSteps`
  so the server actually persists it. The builder renders that number as the canvas `#N`
  prefix.
- The capability matrix carried an INFERRED, disproved row for folder creation
  (`POST /workflow/{loc}/folder`, "unproven"). The real route is
  `POST /workflow/{loc}/directory`; the inferred row is replaced rather than left standing
  beside the truth.

### Documented

Three upstream behaviours that cost real time to discover, now in the tool descriptions and
the README rather than in someone's notes:

- **Workflow folders are `type: "directory"`, not `"folder"`.** `?type=folder` is not
  rejected — it returns `count: 0`, indistinguishable from "this account has no folders",
  which is why the folder listing was believed not to exist.
- **The batch move cannot reach root.** `PUT /workflow/{loc}/move` requires a real folder id;
  `parentId` of `null`, `""` and the sentinel `"root"` all 404. Only the single-item
  `PUT /workflow/{loc}/move-directory/{id}` accepts `null`, so root moves fan out one call
  per workflow.
- **Duplicated workflows DO keep their triggers** — name, type and conditions intact — but
  they land `active: false` and fire only after a draft→published cycle, so a fresh
  duplicate enrols nobody. The clone's `triggersFilePath` ending in `NaN` is cosmetic.

### Proof

Both rails were live-proven on real sub-accounts on 2026-08-18, not just unit-tested.

- Marketplace edit: 2 `sms` steps retyped to `send_outbound_whatsapp_message` in a draft
  workflow — version 1→2, 10 steps unchanged, all five graph fields byte-identical across
  every step, `#1`/`#2` rendered on the canvas, and the step editor opened in the builder as
  "Send Whatsapp Message" with the body intact and the merge field still a live chip.
- Organisation rail: full round-trip through the real handlers — list folders by name →
  create folder → duplicate a draft → move in (verified) → list the folder → move back to
  root (verified `null`) → published guard refuses a live workflow. Every throwaway object
  created during capture and acceptance was deleted; the account finished on exactly the
  rows and folders it started with.

Suites: 742 MCP tests, 469 engine tests.
