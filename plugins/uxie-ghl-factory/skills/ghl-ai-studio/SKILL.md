---
name: ghl-ai-studio
description: GoHighLevel AI Studio — the AI website builder, internally called `vibe`. Use when a task involves reading, auditing, building, iterating on or publishing a site that was made in AI Studio, or when someone names a site and you do not know which GHL surface owns it. Also use when a GHL site cannot be found in funnels/websites — AI Studio is a separate collection and querying the wrong one returns an empty list.
---

# AI Studio (`vibe`)

The AI website builder. Every new project is **TanStack Start** (`tech_stack: "tanstack_start_ts"`,
server-rendered, file routes under `src/routes/`, server functions) — since the 2026-09 SSR release a
React/Vite project can no longer be created, and a `tech_stack` key in the create body is ignored
(proven live 2026-10-30). Older projects may still be `vite_react_shadcn_ts`; `create_studio_site` and
`get_studio_site` report which. It runs the code in a sandbox and publishes to its own edge. Corpus:
`knowledge/corpus/ai-studio/` (the 2026-10 wave: `70-research/2026-10-30-ai-studio-wave.md`).

**It is called `vibe` internally.** Routes, API prefix and config keys all say `vibe`; only the
sidebar says "AI Studio". Searching a bundle for the user-facing name finds nothing.

**All fifteen tools are live-fired.** They carry `proof: live-runtime (2026-09-04)`, earned by
`STATUS-2026-09-04-ai-studio-live-fire.md` at the plugin repo root: every tool executed through its
registered handler against a real account, the Firestore rail end-to-end, the account boundary
failing closed, publish→unpublish confirmed 404 in a browser. Read the receipt's **Not proven**
section before leaning on the two `answer_studio_question` variants that never arose. A build the
UI showed as failed was stored afterwards as `buildStatus: "superseded"` (2026-10-30) — the tools treat
`superseded` as finished and say so; a literal `failed` has still not been caught live. A first run on a *new* account can still surprise
you (plan gating, an expired sandbox); prefer a throwaway project over a client's.

## Start here, every time

**1. Resolve before you reach for a tool.** AI Studio projects and funnels/websites are
**disjoint** collections. Measured 2026-09-04: a location with 25 AI Studio projects and 9 live
custom domains returned 12 funnels from `/funnels/funnel/list` and **zero** overlap. Querying the
wrong one returns an empty list that reads as "the site does not exist" rather than "wrong
surface". For any "work on `<site>`" request, call `find_ghl_site` first.

**2. `find_ghl_site` can come back `unknown` — that is not `not-found`.** Beyond the expected
`ai-studio | funnel | not-found`, the tool can return `surface: "unknown"` with
`funnelsChecked: false` and a warning, when the funnels half of the sweep failed and AI Studio
did not match. This is deliberate: a failed check must never read as "the site does not exist".
Treat `unknown` as *undetermined — ask again*, not as absent. A `not-found` result is only
trustworthy when `funnelsChecked` is `true`; if it's `false`, the funnels leg never actually ran.

**3. The two halves of the resolver run on different credentials, and can fail independently.**
AI Studio is Bearer-only — `/vibe-ai` returns `401 authorization token required` on `token-id`
alone. The funnels half runs on `token-id`. A half-failed sweep (AI Studio answers, funnels
doesn't, or vice versa) is a normal outcome of this split, not a bug to chase.

**4. There is no agency-level list.** Projects are per sub-account. Before concluding a site does
not exist, sweep every location the registration is bound to. Within one location, `list_studio_sites`
lists its AI Studio sites (a read) when the site is known by name but not yet resolved. It is an AI Studio project tool: input `locationId`; it returns the projects and folders, each project with its id, name, slug and folderId.

## Reading a site

`read_studio_site_content` returns the whole codebase with content — that is how you read a
site's copy as structured text. `get_studio_site` gives the page list. Use
`get_studio_site_history` and `get_studio_site_diffs` to see how it got that way: every prompt,
every version, and a unified diff per file per turn.

**`thumbnail_url` is a public link, unauthenticated.** Every project row carries one on
`vibe.filesafe.space` — proven live for unpublished drafts, no credentials required to fetch the
PNG. Do not paste one anywhere you would not paste the draft itself.

## Building

`generate_studio_site` preflights usage, sends the prompt, waits for the build and returns the
version, the diffs and **what it cost**. A generation still running can be stopped with
`cancel_studio_generation` (a write: confirm with the user first). It is an AI Studio project tool: inputs `locationId`, `projectId` and `messageId`; the project must belong to that location, and it is checked before the cancel is sent. It spends real money, metered in USD. Watch
`sessionSpendUsd`, and read `spendMeter` beside it: the meter depends on the billing mode. Under
`billingModeIfCharged: "agency_free_ai"` (the sandbox since 2026-10) the `AI_STUDIO` usage snapshot does
not move per turn, so the tool reads the project policy's `fup.usedAmount` instead
(`spendMeter: "policy.fup"`); on `pay_per_use` it reads the snapshot (`spendMeter: "snapshots"`). A
`spendUsd: null` with a `spendNote` means the cost is unknown (the usage window reset mid-turn, or the policy meter could
not be read) — say so, never report $0; `sessionSpendIncomplete: true` then marks `sessionSpendUsd` as a floor. A turn
that ends `passed` with a version is a settled build (the app shows it like `ready`).
`agency_free_ai` carries a fair-use allowance (`fup.includedAmount`) and `extraUsage.blockingEnabled`,
so a generation may be refused by policy once the allowance is spent (inferred from those two keys; not
observed) — the tool stops before chatting whenever the policy says `allowed: false`.

If the build pauses on a question, the result carries `question`. Answer it with
`answer_studio_question` — pass the answer, not a variant; the tool reads the question and picks
the shape. A secret request is different: store the value with `set_studio_secrets` **first**,
then answer, because the secret never travels through the conversation.

If a turn is still running when the tool returns, you get `pending: true` and a message id.
Resume with `get_studio_generation_status`. Nothing was lost.

## Before you publish — three required steps

**Confirm the change actually landed.** `buildStatus: "ready"` and a confident `summary` are **not**
evidence the file changed. Live-fired 2026-09-04: a turn returned `ready`, minted a version, and
summarised *"Added the broken import at the top of `src/pages/Index.tsx` and referenced
`ThisDoesNotExist` in the component body"* — and the file contained neither. The rendered page was
the untouched scaffold. That turn's diff said `Created` where an edit was claimed, but **`action` is not
a reliable tell**: on 2026-10-30 a genuine 145-line rewrite of an existing route file also logged
`Created`. Only the file content settles it.

So read the source back with `read_studio_site_content` and check the thing you asked for is in it.
That prompt deliberately asked for broken code, so the builder may have declined and reported
optimistically — whether this happens for ordinary prompts is **untested**. Do not assume it is rare.

**Look at it.** An MCP server cannot see a page. Call `get_studio_preview` and open the URL in a
**browser** (chrome-devtools or Playwright). A plain HTTP fetch returns a Cloudflare challenge
regardless of site state, so `curl` tells you nothing — a 403 from curl says nothing about the
site.

This is not ceremony. On 2026-09-04 a generated site's source read clean and its diff was correct
while the rendered page showed `Couldn't load weather right now.` Only looking caught it.

Expect `Warning: Function components cannot be given refs…` once per section in the console —
that is the preview harness attaching refs for visual editing, not a defect.

Two preview hosts, and they differ: the sandbox is `{projectId}.vibepreview.com`, the published
site is `{slug}.vibepreview.com`. For TanStack projects the SEO panel names `{slug}.vibepreview.app`
and the sandbox also answers on `preview-{projectId}.vibepreview.app` — the published `.app` host is
**unproven** (nothing has been published since the SSR change), so check the URL publish returns.
Sandboxes expire — `ready:false` with an empty url while
`has_builds` stays true — and `get_studio_preview` re-provisions them.

**Check the facts.** AI Studio **fabricates social proof by default**. Unprompted, one generation
invented conversion statistics, a 4.9/5 rating, three named testimonials with job titles and
companies, and a three-tier price list. On a client site that is a liability.

**Nothing generated publishes without a factual pass.** Read the copy for invented numbers, fake
testimonials, and pricing nobody agreed to. Replace or remove them, then publish.

## Publishing

`publish_studio_site` needs `confirm:true` and the operator's word. The live URL is keyed on the
**slug**; the sandbox is keyed on the **project id**. `unpublish_studio_site` reverses it —
and note it journals nothing, so the read-back is the only evidence it happened.

## Traps that bite

| | |
|---|---|
| create rewrites the name | `create_studio_site` reports `requestedName` and `storedName`. Rename after create for an exact name; the slug will not follow. |
| `alt_id` does not scope by-id reads | verify `alt_id` on the returned record |
| routes include soft-deleted rows | the tools filter them; raw calls do not |
| secrets merge and are write-only | reads return names only, never values |
| sandboxes expire | `ready:false` with an empty url while `has_builds` stays true; `get_studio_preview` re-provisions |

## The More panel — mapped, no tools yet

Since 2026-10 a project's **More** panel holds features the tools do not drive. Each is mapped in
`70-research/2026-10-30-ai-studio-wave.md`; reach them by raw_request only after reading that page, and
treat each as a write with side effects:

| Feature | What to know before touching it |
|---|---|
| **Cloud** | a per-project Supabase instance. The UI's "Enable Cloud" is a **billed chat turn** (`action: "enable_cloud"`), not the cloud route. Tables are created by chat; rows read back as positional arrays. Secrets live under Cloud → Secrets. |
| **Payments** | enable is a project write; a product shows in the catalogue only when `availableInStore` is true. Checkout options (two-step, required phone, hidden address) live in the generated **code** as component props, not in a record. Enabling writes five managed files. |
| **Chat Widgets** | "Add a chat widget" pauses on an `integration_input` question; answering Connect **creates a real chat widget** on the location. |
| **Git / GitHub** | the connect start returns a GitHub OAuth URL; nothing is stored until OAuth completes. Push/pull are source-only. |
| **Analytics / SEO** | reads only; empty until the project is published. |

## Out of scope here

Custom domains, deletes, and version restore are deliberately not exposed. Migrate-to-SSR needs an
`Idempotency-Key` header raw_request cannot set. Brand boards and brand voices are **not** AI Studio —
different surface, different rail.

**Embed credentials.** AI Studio has no user control to view or set embed credentials; they are system-issued (walked 2026-11-10: studio list, builder, More view; no embed route in the live bundle).

## Routes for the studio surface (raw_request, proven live 2026-11-09 on the TEST project)

These routes are in the catalogue and were executed against the TEST sandbox with a read-back on a separate request. Use the stated path form (ids are placeholders); a write is an approved TEST action only.

| Method | Path | What it does |
|---|---|---|
| GET | `/vibe-ai/projects` | list projects |
| GET | `/vibe-ai/projects/{projectId}` | read one project (stored name, slug, starred state) |
| PATCH | `/vibe-ai/projects/{projectId}/name` | rename the project; read back on a separate GET |
| PATCH | `/vibe-ai/projects/{projectId}/star` | toggle the starred state; read back |
| PATCH | `/vibe-ai/projects/{projectId}/slug` | store the slug literal; read back |
| DELETE | `/vibe-ai/projects/{projectId}` | delete a project (match on id and stored name first) |
| PATCH | `/vibe-ai/projects/{projectId}/folder` | move a project into a folder |
| GET | `/vibe-ai/folders` | list folders |
| POST | `/vibe-ai/folders` | create a folder |
| PATCH | `/vibe-ai/folders/{folderId}` | rename a folder |
| DELETE | `/vibe-ai/folders/{folderId}` | delete a folder |
| GET | `/vibe-ai/projects/{projectId}/settings` | read project settings |
| PATCH | `/vibe-ai/projects/{projectId}/settings` | write project settings; read back |
| GET | `/vibe-ai/projects/{projectId}/sandbox` | sandbox state (ready flag) |
| POST | `/vibe-ai/projects/{projectId}/sandbox` | start the sandbox. Billed where the AI meter applies: check the meter before and after |
| POST | `/vibe-ai/projects/{projectId}/sandbox/keep-alive` | keep the sandbox alive. Billed where the AI meter applies |
| POST | `/vibe-ai/projects/{projectId}/versions/{versionId}/restore` | restore a version; prewarm after |
| POST | `/vibe-ai/projects/{projectId}/versions/{versionId}/prewarm` | prewarm a version |
| GET | `/vibe-ai/projects/{projectId}/versions/{versionId}/download` | download a version |
| PATCH | `/vibe-ai/projects/{projectId}/versions/bookmark` | bookmark a message version (message id and flag) |
| POST | `/vibe-ai/projects/{projectId}/meta/image` | set the project meta image |
| POST | `/vibe-ai/projects/{projectId}/edit-code` | edit project code through the API |
| GET | `/vibe-ai/projects/{projectId}/usage/policy` | read the usage policy (read only) |
| GET | `/vibe-ai/banners/active` | read the active banners (read only) |
| GET | `/chat-widget/list` | list chat widgets (read only; catalogue host services) |
