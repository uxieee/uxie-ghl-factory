# The pre-build approval document

One self-contained HTML file that the operator reads **before anything is built in GHL**.

Its purpose is specific: they approve the diagrams, and then building is *transcription*
rather than fresh decision-making. Every trigger, step, wait and exit is decided on this
page. If the builder has to think about what a step should be, the page failed.

**A worked, approved example ships with this skill: `assets/example-prebuild-doc.html`.**
Open it before building one — match its shape rather than reinventing the format. It is
written in the system-book idiom the operator reads every day; the example asset *is* that idiom.

## File

- **One HTML file, fully self-contained.** Opens from `file://` with no CDN and no fetch.
  Diagrams are mermaid, and the mermaid library is **inlined into the file** (~3.3MB) — lift
  the bundle from the example asset rather than linking a CDN. The one remote request is the
  Google Fonts stylesheet (see *The look*); every font stack ends in system faces, so the file
  still reads correctly offline.
- **Fixed sidebar nav**: overview, system map, pipeline, one entry per workflow, then
  reference sections (data, AI, copy appendix, open questions).
- **Full-width layout, no dead space.** Prose caps around 70ch for readability; frames,
  tables and diagrams use the width. Never park a big empty panel on screen waiting for
  interaction — detail appears on demand or not at all.
- **Light and dark both work, with a visible toggle.** Define the palette as CSS custom
  properties in three places: `:root` (light), `@media (prefers-color-scheme:dark)` guarded
  with `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`. The toggle is
  **light and dark only, no auto mode.** The first load follows the OS once; after that a
  small button in the sidebar (`theme: light` / `theme: dark`) flips between the two and
  remembers the choice in `localStorage` inside a try/catch. `data-theme` is always stamped
  on `<html>`.
- **Diagrams are themed from the page palette, so the toggle has to re-render them.** Mermaid
  reads its `themeVariables` once at `initialize()` and REPLACES each source block with an SVG.
  A theme change therefore has to: restore the stashed source text into every `.mermaid`
  element, drop their `data-processed` attribute, re-`initialize()` with freshly read computed
  properties, and re-`run()`. Stash the sources on the first render or the second one finds
  empty divs. Any hand-built SVG (the system map) should use `var(--token)` for every fill
  and stroke so it rethemes with no JavaScript at all.
- **Wait for `document.fonts.ready` before the first mermaid render.** Mermaid measures label
  text when it lays out; rendered before IBM Plex arrives, it measures the fallback face and
  the labels clip once Plex swaps in. Mermaid's `fontFamily` is IBM Plex Sans, not mono.
- **The example's app script already declares `MM`** (the map's position helper). Name
  nothing else `MM` when extending it.

## The look

Taken from the system book the operator prefers. The full stylesheet, light and dark tokens
included, is the `<style>` block of the example asset; lift it whole rather than restyling.

- **Ground and panels**: cool paper ground (`#f2f4f7` light, `#12161c` dark), flat white
  (or dark) panels, square corners, no rounded cards, no shadows.
- **Type**: Archivo condensed (`font-stretch:87.5%`, weight 700) for display and section
  labels, IBM Plex Sans for body, IBM Plex Mono for stamps, chips and trigger lines. Loaded
  from Google Fonts with system fallbacks.
- **Left index**: a plain sticky nav with no background panel. Links are marked by a 2px
  left rule that turns accent on hover and on the active section; group labels are small
  uppercase Archivo eyebrows.
- **Masthead** (the first section): mono stamp line, 36px Archivo `h2`, lede, closed by a
  2px solid ink rule. Section `h2` is 25px Archivo; `h3` is 13px uppercase, letter-spaced, `--ink-3`.
- **Panels**: 1px line border plus a 5px coloured left edge (blue general, green workflow,
  orange new). Callouts are a soft fill plus a 4px left rule: green `.note`, amber `.q`
  for open questions.
- **Tables**: panel background, 1px border, header row on `--panel-2` with uppercase
  Archivo 12px labels.
- **Chips and pills**: chips are small mono, 3px radius, soft fills (`.tok`, `.status`);
  pills are 10px-radius mono on `--panel-2`.
- The older token names (`--ground`, `--surface`, `--stop`, `--warn`, `--human`, `--fill`,
  `--fs`, `--fm`, `--fserif`) are aliased onto the new palette, so the hand-built map SVG
  and the mermaid `themeVariables` follow without touching their code.

## 1. System map — interactive wiring flow

The first screen. Answers two questions: what triggers each workflow, and which workflows
are wired to each other.

- Workflow cards in phase columns (capture → engage → … → after), each showing its
  trigger type, number + name, and what it removes from.
- **Solid arrows = leads to**, labelled with the causing signal, on small background
  plates so lines never run through text. Orthogonal routing; an edge that skips a card
  in its own column detours through a channel beside the column, never through a card.
- **Dashed red = removal wiring, ON by default** with a toggle. Each removal edge gets
  its own horizontal channel *below* the graph (labelled `04 ⊣ 09`), so the layer that's
  invisible in GHL's builder is legible instead of spaghetti.
- **Click to isolate**: clicking a node dims everything except that node, its edges, and
  their endpoints; clicking an edge highlights it and both ends; clicking empty space
  resets. A status line says what's selected in words.
- Cross-cutting workflows (escalation, stale recovery) get a dashed border so they don't
  read as part of the linear flow.

## 2. Per-workflow cards — the system book idiom

One `.wf` card per workflow, stacked full-width in numbering order:

- **Header**: the workflow number as a small mono chip, name, then the trigger line in mono
  across the full width (`Trigger: Appointment · status = confirmed · calendar = Smile Assessment`).
- **Settings pills**: stop-on-response with its reason, quiet hours, re-entry, and the
  removal contract both directions (`removes from 01, 03, 06, 09` / `removed by 05, 07, 12`).
- **A mermaid `flowchart TD`, centered in the card** on the card's green left edge. The
  shape vocabulary:
  - `([...])` stadium — trigger at top, exits and terminal outcomes
  - `[...]` — actions, in GHL vocabulary with the config that matters in the label
  - `[/"Wait: ..."/]` — waits, including the `appointmentCondition` where relevant
  - `{"..."}` — if/else decisions, with `-->|label|` branch edges
  - `-.->` dotted — goal exits ("removed by 04 on booking")
  - **Ladders collapse into one narrative node** ("The chase ladder: SMS-02 at 1h,
    EM-01 at 22h, SMS-03 at day 2") — one box per decision, not per micro-step. This is
    what keeps diagrams readable; a 10-step sequence is usually 5 nodes.
- **A decision paragraph under the diagram**, editorial style with the load-bearing
  choice bolded up front ("**Every wait carries `appointmentCondition: skip`**, so a
  same-day booking…"). This is where the *why* lives — the diagram shows what, the
  paragraph defends it.

## 3. Diagrams are click-to-enlarge

Every workflow diagram sits in **one fixed-size window, 520px tall**, scaled to fit whole and
centred, like a zoomed-out fit view, so a 4-node and a 12-node flow take the same room on the
page. The CSS is `.diagram{height:520px;overflow:hidden;align-items:center}`, the
`pre.mermaid` inside it `width:100%;height:100%;display:flex` centred, and its `svg`
`width:100%!important;height:100%!important;max-width:none!important`; all three reset to
`auto` inside `#lbstage` so the lightbox gets the natural size. This needs mermaid's
`flowchart:{useMaxWidth:false}`, so every svg keeps its width and height attributes plus a
`viewBox`.

Every diagram (map and workflows) opens in a lightbox: hover shows "click to enlarge",
click opens it fitted to the window, then pinch / ⌘-scroll zooms toward the cursor,
scroll and drag pan, double-click refits, esc closes. The inline diagram is for reading
the shape; the lightbox is for reading the detail.

## 4. Copy

- Message copy is **not** inline in diagrams — steps reference message IDs (`SMS-07`).
- The **copy appendix** holds every message in journey order, grouped by workflow, each
  with its ID and timing, so the whole script reads end to end in one pass.
- Identical copy reused across lanes appears once, with the lanes it serves listed.

## 5. The rest of the document

- **Overview**: what the system optimises for, in the client's numbers, plus the
  boundary with any external system (what this build deliberately does NOT own).
- **Pipeline and stages**: the stage table with what each stage means and which single
  workflow moves it; the no-Lost-stage rationale stated in place.
- **Data**: tags (with class, applier, remover, reader), fields (with type and why the
  type), custom values.
- **AI agents**: the lineup, jobs, and hard limits.
- **Open questions**: the blocking design questions, each stating what changes depending
  on the answer. An honest "we haven't decided this" box is worth more than a diagram
  that looks finished and isn't.
- **Every `{{FILL_*}}` token visually chipped** wherever it appears, plus one roster of
  all outstanding tokens.

## What this document is not

It isn't a client deliverable and it isn't a report of work done. It's the thing that
gets argued with before the work starts.
