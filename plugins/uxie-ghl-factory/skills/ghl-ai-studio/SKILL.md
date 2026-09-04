---
name: ghl-ai-studio
description: GoHighLevel AI Studio — the AI website builder, internally called `vibe`. Use when a task involves reading, auditing, building, iterating on or publishing a site that was made in AI Studio, or when someone names a site and you do not know which GHL surface owns it. Also use when a GHL site cannot be found in funnels/websites — AI Studio is a separate collection and querying the wrong one returns an empty list.
---

# AI Studio (`vibe`)

The AI website builder. It generates a **Vite + React + shadcn/ui** codebase, runs it in a
sandbox, and publishes to its own edge. Corpus: `knowledge/corpus/ai-studio/`.

**It is called `vibe` internally.** Routes, API prefix and config keys all say `vibe`; only the
sidebar says "AI Studio". Searching a bundle for the user-facing name finds nothing.

**The tools are not yet live-fired.** All fifteen carry `proof: documented` in
`tool-descriptions.json` — the *endpoints* were mapped live on 2026-09-04 with 118 captures in
`knowledge/sniffs/ai-studio-2026-09-04/`, but the *tools* built on top of them have never been
executed against a real GoHighLevel account. That distinction is invisible once you're holding a
tool call — the description reads the same as any proven tool. This skill is where the caveat
lives instead. Expect the first real run to surprise you: a param name that doesn't quite match,
a status field that isn't where the docs say it is. Prefer the sandbox sub-account over a
client's for that first run.

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
not exist, sweep every location the registration is bound to.

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
version, the diffs and **what it cost**. It spends real money, metered in USD, and nothing on the
account blocks it. Watch `sessionSpendUsd`. There is no cap to describe — the account measured
had `unlimited: true` and `blockOnLimit: false`, and nothing here changes that.

If the build pauses on a question, the result carries `question`. Answer it with
`answer_studio_question` — pass the answer, not a variant; the tool reads the question and picks
the shape. A secret request is different: store the value with `set_studio_secrets` **first**,
then answer, because the secret never travels through the conversation.

If a turn is still running when the tool returns, you get `pending: true` and a message id.
Resume with `get_studio_generation_status`. Nothing was lost.

## Before you publish — two required steps

**Look at it.** An MCP server cannot see a page. Call `get_studio_preview` and open the URL in a
**browser** (chrome-devtools or Playwright). A plain HTTP fetch returns a Cloudflare challenge
regardless of site state, so `curl` tells you nothing — a 403 from curl says nothing about the
site.

This is not ceremony. On 2026-09-04 a generated site's source read clean and its diff was correct
while the rendered page showed `Couldn't load weather right now.` Only looking caught it.

Expect `Warning: Function components cannot be given refs…` once per section in the console —
that is the preview harness attaching refs for visual editing, not a defect.

Two preview hosts, and they differ: the sandbox is `{projectId}.vibepreview.com`, the published
site is `{slug}.vibepreview.com`. Sandboxes expire — `ready:false` with an empty url while
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

## Out of scope here

Custom domains, deletes, and version restore are deliberately not exposed. Brand boards and
brand voices are **not** AI Studio — different surface, different rail.
