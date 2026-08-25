# Changelog

All notable changes to the `uxie-ghl-factory` plugin are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The plugin ships **two manifests over one tree** — `.claude-plugin/plugin.json` (Claude Code)
and `.codex-plugin/plugin.json` (Codex). Both carry the same version, enforced by
`scripts/check-manifest-parity.mjs`; a version recorded here is a version both harnesses see.

This file starts at 0.25.0. Earlier releases are recorded in the git history, where the
commit bodies carry the detail.

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
