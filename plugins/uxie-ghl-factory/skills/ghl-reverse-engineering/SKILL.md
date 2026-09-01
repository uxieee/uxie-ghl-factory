---
name: ghl-reverse-engineering
description: "Map a GoHighLevel internal surface exhaustively — enumerate every screen, panel, control and save path a feature has, capture the real request behind each one, prove what each field does by differential, and write the result into the corpus. Use when the user wants to understand how a GHL feature works under the hood, extend an engine to an object the public API can't reach, re-sweep a surface that already has partial coverage, or asks to reverse-engineer / sniff / capture / trace anything internal. GHL permits inspecting your own account's traffic. This is a MAPPING skill, not a lookup: it finishes when the surface is exhausted, not when the first endpoint is found."
---

# GHL Reverse-Engineering

Capture and document GoHighLevel's **internal** APIs — the `backend.leadconnectorhq.com` /
`services.leadconnectorhq.com` endpoints the app's own UI calls — so agents can automate
configuration the public API cannot reach.

## The stance

**You are mapping a surface, not answering a question.** A request phrased as one endpoint
("how does it save a wait step?") is the entry point to a surface, never the scope. The scope
is the whole feature: every screen it has, every panel, every control, every save path, every
list-vs-detail difference, every error state.

Three rules follow, and they are the difference between this skill and a network sniff:

1. **Enumerate before you capture.** You cannot know what you missed if you never wrote down
   what exists.
2. **Follow every neighbour.** Anything you find has a settings panel, a list view, an edit
   path, a delete path, and a log somewhere. Check them before moving on.
3. **Stop on evidence, not on satisfaction.** The session ends after two consecutive rounds
   that surface nothing new — not when the original question is answered.

A surface with 90% coverage is a surface that will silently mislead someone later. The one
endpoint you did not open is where the field you eventually need is defined.

## Phase 0 — mine what is already recovered (do this FIRST)

GHL serves its own source maps publicly, and this project has already mined them. Before
opening a browser, read what is recovered: this often answers the whole question and always
narrows the live work.

- **The catalogue first.** `search_endpoints` on the internal MCP is the compiled index of
  everything else in this list — every route the recovered source calls, every route the
  corpus has recorded, every route a shipped tool calls — and `describe_endpoint` gives path,
  query keys, body and response shape where the source declares them, and whether a location
  token has been PROVEN to reach it. Ten seconds there can end the session. A capture that
  rediscovers a catalogued row costs an hour to learn nothing; this was learned the expensive
  way, when a plan was drafted to capture the memberships bundle while its source sat on disk
  already mined. Capture is for what the catalogue does NOT have — or has as a path without
  the behaviour you need: required parameters, allowed values, what a write actually does.
- `knowledge/sniffs/bundle-2026-08-21-2/recovered-source/` — the workflow builder's own
  TypeScript, 1,867 sources including the lazy-chunk page layer, and
  `sniffs/memberships-builder-2026-08-24/recovered-source/` for memberships. Models,
  validators, enums, constructors, defaults. (The AI apps have no recovered source; their
  rows come from the corpus.)
- `knowledge/sniffs/*/i18n-*.json` — every label and error string. **An error string implies
  a code path that raises it**; the absence of one is evidence a check does not exist.
- `knowledge/reference/`, `knowledge/corpus/` — what is already documented, and at what status.
- `knowledge/samples/by-location/` — real stored objects. The ground truth for "what values
  does this field actually carry in the wild".

Read the enum, the interface, and the constructor before you read the network. A union type
in the source is authoritative; a captured example only proves the one value it happened to
carry.

If a capture is stale or a chunk has rotated, re-derive it (`recapture.mjs --check`) rather
than working from a bundle that no longer matches production.

## Phase 1 — enumerate the surface (mandatory, before any capture)

Open the feature in the UI and write down **everything it has**, to a file, before capturing
anything. This list is the work-list and the coverage record.

For the surface, enumerate:

- every **screen** and every **tab** within it
- every **panel, drawer and modal**, including ones that only open from a row action
- every **button, menu item and overflow (⋯) action**
- every **settings toggle**, including account-level settings that change the feature
- every **empty state** and every **error state** you can reach
- every **list view** and its **detail view** (they rarely return the same fields)
- the **save, publish, duplicate, move, rename, archive and delete** paths
- anything **gated** — feature flags, plan tiers, allowlists — noted as gated, not skipped

Write it as a checklist. Nothing is captured until the checklist exists.

## Phase 2 — capture, breadth-first

Work the checklist. Prefer breadth over depth on the first pass: one capture per item beats
three captures of the first item.

1. **Authenticated browser.** Playwright MCP against a logged-in `app.gohighlevel.com`. Deep
   links 404 — only `/` is served, so reach every screen by **clicking** through the SPA.
2. **Act, then read the network.** Perform the action, then `browser_network_requests`
   (filtered to the service) → `browser_network_request` on the specific call. Method, URL,
   headers, and the full request/response **body** — the body is the prize.
3. **Auth is per-surface.** Never assume a token carries across services. See
   `references/internal-api-map.md`. Tokens expire ~1 hr; re-capture from the session's own
   network history.
4. **Record the negative results too.** A control that fires no request, a save that returns
   200 without changing anything, a screen with no backing endpoint — each is a finding.

### The neighbour rule

Every time you capture something, before moving on, ask the six questions:

| | |
|---|---|
| **List vs detail** | Does the list endpoint return fields the detail one does not, or vice versa? |
| **Save** | What does *save* send — the whole object, or a diff? |
| **Edit** | Is the edit path the same endpoint as create, or a different one? |
| **Delete** | Soft or hard? Does it cascade? |
| **Settings** | Is there a settings panel for this object, and what does *it* send? |
| **Logs** | Is there a runtime/history/log view, and what does it read? |

Anything that answers "I don't know" goes on the checklist.

## Phase 3 — prove it, by differential

A capture shows a field's **shape**. It does not show that the field **does** anything.

To prove a field works: make the same call twice, once with it and once without, and compare
the results. To prove a filter works: same query with and without the filter, compare rows.

**Accepted is not applied.** A `200` proves the request was well-formed. Read the object back
on a *separate request* and compare field by field. When a write returns success and the value
did not change, **that is the finding** — record it as one, do not retry until it looks clean.

For a discriminated field, capture **one object per discriminator value**. A single capture
pins one value of every union and teaches the catalog that the other values do not exist.

## Phase 4 — the completeness check (before reporting)

Answer these in writing. The answers become the next round's checklist:

- Which screens on my Phase-1 list did I never open?
- Which buttons did I never press?
- Which endpoints did I see *referenced* in source or in a response, but never call?
- Which fields did I observe but never **vary**?
- Which discriminator values have no capture?
- What did I assume because it was obvious?

**Stop condition:** two consecutive rounds where Phase 4 produces nothing new. One quiet round
is a coincidence; two is a surface.

## Phase 5 — write it down

Findings go into the **corpus** (`knowledge/corpus/`), on the surface's own page, under the
layer that matches (`10-anatomy`, `20-api`, `30-types`, `40-rules`, `50-runtime`,
`60-recipes`, `70-research`). Follow `corpus/_template/PAGE-CONTRACT.md`.

Every page carries a `status` floor: `proven-live` means executed against a live account **and
read back on a separate request**. Anything weaker says so. Raw captures go to `sniffs/`, and
pages cite them rather than copying them.

### The harvester reads your page

A corpus page is not only prose. `knowledge/scripts/harvest-documented-endpoints.mjs` scans
**every** corpus `.md` — `70-research` included — and every `METHOD /path` token it finds, bare
in a code block or backtick-wrapped in prose, mints a catalog row that ships in the plugin. The
row's host comes from the page's single `Base:` declaration, else from a prefix map
(`ORIGIN_BY_PREFIX`), else BACKEND. So:

- **Declare exactly one `Base:` per `20-api` page.** Two bases make every path ambiguous and
  the harvester ignores the declaration and falls back to the prefix map, then backend.
- **Never write a `METHOD /path` token for an endpoint that is inferred, unproven, or known to
  403.** "a bare read of `/x/{id}`" is safe; "`GET /x/{id}` returns 403" mints a row.
- **A research page naming endpoints on a non-default host** either declares the base or avoids
  method tokens — a `70-research` page that did neither filed its rows on backend, and the
  wrong-host duplicate reached the plugin once.
- **After writing, run the harvest and READ the minted rows' hosts** before calling the page done.

The pipeline is page → `harvest-documented-endpoints.mjs` → `merge-endpoint-catalogs.mjs`
(delivers `internal-endpoints.source.json` into the plugin) → the plugin's
`build-endpoint-catalog.mjs` plus the hand-maintained `endpoint-overlay.json` for reach and
notes. Before harvesting, have an adversarial reader check every generated page against the
source it was written from — that read catches invented semantics and over-claimed confidence
before they ship; it did on the first run.

Turning a finding into a skill or an engine capability is a **separate, later decision** — do
not fold it into a mapping session.

### Three more harvester rules, learned by breaking them (2 Sep 2026)

- **A single-segment path (`GET /payment-links/`) is dropped unless the page states a HOST-ONLY
  base** (`Base: backend.leadconnectorhq.com`, no path prefix). A page that declares a prefixed base or
  none at all loses every root-collection call — which is how a surface reached the plugin with its
  `{id}` routes and without its LIST or its CREATE. State the base as the bare host when the paths are
  absolute.
- **Use ONE spelling per path parameter across every page on a surface.** `{calendarId}` on one page
  and `{id}` on another mints two catalogue rows for one endpoint, and the overlay attaches to only one.
  The catalogue already carries 70 such twins; do not add to them.
- **Never let prose mine as a path.** `GET /calendars/events...` (an ellipsis), or a shorthand tail
  like `PUT /rename-workflow/{id}` with the `/workflow/{loc}` prefix elided, becomes a row that 404s.
  Write the full wire path or drop the verb.
- 🔴 **Writing the page is not shipping the knowledge.** The chain is corpus → harvest → merge → build →
  overlay → dist, and each stage can drop a row quietly. **Diff the artefact at every stage** (rows
  added / removed) — "harvested 509" is true and says nothing about which 509. Then re-run the shipped
  ranking for the intent a caller would actually type and check the row is in the top 10.

## Non-negotiables

- **Test on a designated test sub-account, never a client's.** If a surface is feature-gated,
  find a location where it is already enabled rather than enabling compliance features
  yourself.
- **Reads by default; writes are throwaway.** Any write is a `TEST-CAP-*` draft. Never publish,
  never enrol a real contact, never place a real call.
- **Nothing is deleted.** Probe artifacts stay in place, clearly named, for a human to remove.
  Report what you left behind and where.
- **Redact tokens.** Never write a captured JWT or token value into a file, a report, or a
  message. Claim *names* and counts are fine; values never are.
- **Ground every claim.** Record which capture each documented field came from. Do not infer a
  field you did not see. Mark unconfirmed items explicitly rather than smoothing them over.

## Knowledge

- `references/capture-playbook.md` — the full capture procedure
- `references/internal-api-map.md` — per-service base URLs and which credential each takes
