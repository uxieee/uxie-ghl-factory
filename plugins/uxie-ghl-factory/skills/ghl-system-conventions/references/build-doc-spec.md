# The pre-build approval document

One self-contained HTML file that the operator reads **before anything is built in GHL**.

Its purpose is specific: they approve the diagrams, and then building is *transcription*
rather than fresh decision-making. Every trigger, step, wait and exit is decided on this
page. If the builder has to think about what a step should be, the page failed.

**A worked, approved example ships with this skill: `assets/example-prebuild-doc.html`.**
Open it before building one — match its shape rather than reinventing the format. It is
written in the system-book idiom the operator reads every day; the example asset *is* that idiom.

## File

- **One HTML file, fully self-contained.** Opens from `file://` with no CDN, no remote
  fonts, no fetch. Diagrams are mermaid, and the mermaid library is **inlined into the
  file** (~3.3MB) — lift the bundle from the system book or the example asset rather than
  linking a CDN.
- **Fixed sidebar nav**: overview, system map, pipeline, one entry per workflow, then
  reference sections (data, AI, copy appendix, open questions).
- **Full-width layout, no dead space.** Prose caps around 70ch for readability; frames,
  tables and diagrams use the width. Never park a big empty panel on screen waiting for
  interaction — detail appears on demand or not at all.
- **Light and dark both work, with a visible toggle.** Define the palette as CSS custom
  properties in three places: `:root` (light), `@media (prefers-color-scheme:dark)` guarded
  with `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`. A small button in
  the sidebar cycles **auto → light → dark**, writes `data-theme` on `<html>` (removing it for
  auto), and remembers the choice in `localStorage` inside a try/catch. Reading the document
  on a bright screen and reading it at night are different jobs, and following the OS is not
  always what the reader wants.
- **Diagrams are themed from the page palette, so the toggle has to re-render them.** Mermaid
  reads its `themeVariables` once at `initialize()` and REPLACES each source block with an SVG.
  A theme change therefore has to: restore the stashed source text into every `.mermaid`
  element, drop their `data-processed` attribute, re-`initialize()` with freshly read computed
  properties, and re-`run()`. Stash the sources on the first render or the second one finds
  empty divs. Same applies when the system flips underneath you while on auto — listen to
  `matchMedia('(prefers-color-scheme:dark)')`. Any hand-built SVG (the system map) should use
  `var(--token)` for every fill and stroke so it rethemes with no JavaScript at all.

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

- **Header**: serif workflow number, name, then the trigger line in mono across the full
  width (`Trigger: Appointment · status = confirmed · calendar = Smile Assessment`).
- **Settings pills**: stop-on-response with its reason, quiet hours, re-entry, and the
  removal contract both directions (`removes from 01, 03, 06, 09` / `removed by 05, 07, 12`).
- **A mermaid `flowchart TD`, centered in the card.** The shape vocabulary:
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
