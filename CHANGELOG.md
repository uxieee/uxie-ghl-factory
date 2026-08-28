# Changelog

All notable changes to the `uxie-ghl-factory` plugin are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The plugin ships **two manifests over one tree** — `.claude-plugin/plugin.json` (Claude Code)
and `.codex-plugin/plugin.json` (Codex). Both carry the same version, enforced by
`scripts/check-manifest-parity.mjs`; a version recorded here is a version both harnesses see.

This file starts at 0.25.0. Earlier releases are recorded in the git history, where the
commit bodies carry the detail.

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
