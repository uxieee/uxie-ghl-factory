# Changelog

All notable changes to the `uxie-ghl-factory` plugin are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The plugin ships **two manifests over one tree** — `.claude-plugin/plugin.json` (Claude Code)
and `.codex-plugin/plugin.json` (Codex). Both carry the same version, enforced by
`scripts/check-manifest-parity.mjs`; a version recorded here is a version both harnesses see.

This file starts at 0.25.0. Earlier releases are recorded in the git history, where the
commit bodies carry the detail.

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
