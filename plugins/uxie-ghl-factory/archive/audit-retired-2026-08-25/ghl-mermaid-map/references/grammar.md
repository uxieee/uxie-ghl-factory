# Mermaid Map Grammar

Grounded in `~/.claude/skills/ghl-specialist/runbooks/map-generation.md`
(§1, §4, §5, §10) — **provenance only; `ghl-specialist` is a separate user-level
skill, not bundled in this plugin, so don't try to `Read` that path.** This
reference restates that runbook's grammar as a standalone skill so the auditor can
render a system-flow map without pulling in the full `ghl-specialist` audit-mode
machinery (thesis/deep-dive/sweep scoping, narrative beats, learning-log wiring).
This file is self-contained. Scope control (which
nodes are in-frame for a given audit) and the narrative-commentary writeup
stay upstream of this skill — this file owns node taxonomy, edge inference,
the descriptive-not-verdict boundary, and stub handling only.

---

## 1. What the map shows

The map is the **contact journey** — not a workflow-dependency diagram, not an
org chart. Every edge must be defensible in that frame: a contact arrives
here, something happens, the contact ends up there. If an edge can't be
narrated that way, it doesn't belong on the map.

Six node classes (harvested verbatim from map-generation.md §1):

- **Entry points** — forms, funnel pages, inbound SMS / call / email, manual
  contact creation, public API webhooks, integration webhooks (FB Lead Form,
  Stripe, Shopify).
- **Tags** — each distinct tag applied by a workflow or trigger. Tags are
  first-class nodes because in GHL they're the de facto message bus between
  workflows.
- **Pipeline stages** — each stage is a node; the pipeline itself is a
  subgraph wrapping its stages.
- **Workflows** — each workflow is a node. Messaging (email, SMS, internal
  notifications) attributes to the sending step, usually collapsed into a
  single `Msg_*` sink when multiple workflows point at the same recipient
  pattern.
- **Handoffs** — Goal Events, Go-To actions, tag-triggered chains,
  stage-change-triggered chains. Handoffs aren't a separate node class; they
  are how edges get inferred between the other five classes (§2 below).
- **Exits** — won / lost / abandoned pipeline outcomes, unsubscribe, DND,
  contact removal, or a terminal step with no outbound edge.

---

## 2. Node taxonomy and ID conventions

| Node class | ID prefix | Example |
|---|---|---|
| Form (entry point) | `F_` | `F_fbLeadForm["Form: FB Lead Form"]` |
| Funnel page (entry point) | `P_` | `P_bookingPage["Page: Booking"]` |
| Tag | `T_` | `T_srcMeta["Tag: src_meta"]` |
| Workflow | `W_` | `W_wf01fbDef["WF: 01. FB DEF \| Create Opp + Notify"]` |
| Pipeline | `Pipe_` (subgraph only) | `subgraph Pipe_sales["Pipeline: Sales"]` |
| Stage | `S_` | `S_intake["Stage: Intake"]` |
| Calendar (entry point) | `Cal_` | `Cal_smp["Calendar: SMP Consult"]` |
| Exit | `Exit_` | `Exit_won["Exit: Won"]` |
| Message sink | `Msg_` | `Msg_staffAlert["Msg: Staff Alert (email+sms+app)"]` |

Slug rules: use the first 8 chars of the underlying object ID for uniqueness
on name collisions; quote labels containing spaces, colons, or punctuation.
Use `flowchart TD` (top-down) for every map this skill emits — `graph TD` is
equivalent Mermaid syntax but `flowchart TD` is the convention carried over
from map-generation.md and should stay consistent across audits so `.mmd`
files diff cleanly against each other.

Edge label conventions:
- `-->|label|` — solid, standard flow (most edges).
- `-. "label" .->` — dashed, for goal events and conditional/optional/
  unconfirmed edges (see stub handling, §4).
- Wait steps ≥24h: append `(wait Nh)` to the edge label rather than drawing a
  separate node — waits are annotations, not journey steps.

---

## 3. Edge-inference rules

Edges are inferred by matching workflow internals (triggers, actions, goal
events) against the account skeleton (pipelines/stages, forms, tags in use)
and against other workflows' internals. Harvested from map-generation.md §4.1–4.5:

### 3.1 Tag handoff
Workflow A applies tag `X` (`add_contact_tag`), Workflow B triggers on tag `X`
(`Contact Tag Added`) → edge **A → B**, labeled `tag: X`. Render the tag as
its own node when the map needs to show orphan-tag relationships (a tag
applied that nothing listens on — a candidate finding, but the *finding*
belongs in the audit report, not on the map; see §5).

### 3.2 Opportunity → pipeline stage
An action with `pipeline_id = P`, `pipeline_stage_id = S`
(`create_opportunity` / `update_opportunity`) → edge **A → Stage(S)**,
labeled `creates opp @ stage`. `Stage(S)` lives inside the `Pipe_P` subgraph.
An `opportunity_status` of `won` / `lost` / `abandoned` draws to an `Exit_*`
node instead of a stage.

### 3.3 Form submission → workflow entry
A `Form Submitted` trigger referencing form `F` → edge **Form(F) → B**,
labeled `submit`. If the trigger references a deleted or cloned form, render
the edge dashed and note the ambiguity in scope notes rather than asserting
it — this is common silent breakage after snapshot pushes.

### 3.4 Stage change → workflow entry
A `Pipeline Stage Changed` trigger on stage `S` → edge **Stage(S) → B**,
labeled `stage →`. The same `Stage(S)` node is also a target of §3.2 edges —
stages are natural handoff hubs, expect fan-in and fan-out on them.

### 3.5 Goal event → target
A `goal_event` pointing to a downstream step inside the same workflow renders
as a dashed internal edge. If it triggers another workflow instead, it
reduces to §3.1 (tag) or §3.4 (stage) — the tag or stage is the actual bus;
the goal event is just how that trigger got satisfied.

### 3.6 Merge rule
When two rules would produce an edge between the same node pair, merge the
labels (`tag: X, tag: Y`) instead of drawing parallel edges — Mermaid stacks
parallel edges awkwardly and it reads as noise, not signal.

### 3.7 Unencoded cases
Not yet reduced to a rule (surface via the specialist's learning-log if
encountered, per map-generation.md §9): inbound webhook chains,
custom-field-change triggers, appointment-triggered chains across calendars,
membership events. Render these as best-effort dashed edges with a note, not
as confident solid edges.

---

## 4. Stub-node handling (the map always ships)

Recon data is routinely partial — a workflow roster with no internals
inspected yet, an account too large to fully capture in one pass, or an API
gap. The map ships regardless. Rule: **where the underlying data for a node
is partial, render an opaque stub node instead of omitting the node or
blocking the map.**

- **No internals for a workflow.** Render `W_<slug>["WF: <name> (internals
  not inspected)"]`. Draw only the edges the skeleton alone supports (e.g. a
  pipeline/stage link from metadata); cross-workflow tag edges are impossible
  without internals — say so in scope notes, don't guess.
  - Trigger words for this case: not-inspected, roster-only, metadata-only.
- **Partial internals.** Workflows with internals render fully; workflows
  without render as stubs. Edges between a captured node and a stubbed node
  use skeleton-level inference only (§3.2–3.4), never tag-chain inference
  (§3.1), since that needs both sides' internals.
- **Out of thesis/deep-dive scope but touched by an edge.** Render as a stub
  labeled `(not in scope)` rather than a full node — same opaque-stub
  mechanism, different reason for opacity.
- **Uncertain/ambiguous edge** (e.g., a trigger referencing a form that may
  have been deleted or cloned). Render the edge dashed, not solid, and don't
  suppress it — a dashed, caveated edge beats a missing one.

Principle (harvested verbatim from map-generation.md §10): **a partial map is
strictly better than no map.** Never withhold the map because inputs are
incomplete — stub the gaps and name them.

---

## 5. Descriptive, not verdict — the map shows structure only

The map is topology: what connects to what, and why (via §3's inference
rules). It is not the place for judgment calls. Concretely:

- Node and edge labels state facts derivable from the data (`tag: X`,
  `creates opp @ stage`, `stage →`) — never a quality judgment (no "broken",
  "duplicate", "wasteful", "misconfigured" on the map itself).
- Structural oddities that are visible from the topology (an orphan tag with
  no listener, a workflow with no incoming edge, a pipeline stage nothing
  advances from, a convergent `Msg_*` sink fed by several workflows) are
  real signal — but they surface as **findings in the audit report**, using
  the map only as the evidence citation (which node/edge to look at). The
  `.mmd`/map artifact itself carries no severity, no verdict, no remediation
  text.
- If a caption or narrative accompanies the map, it may *describe* what the
  diagram shows ("Leads arrive via the FB form, land in Sales › Intake...")
  but any evaluative claim ("...and this duplicate-alert pattern wastes
  send credits") belongs to the audit report's finding record, not to map
  narration. Keep the two artifacts separable: structure vs. judgment.

This mirrors the audit-primitives finding schema's separation of evidence
from verdict — the map is pure evidence, the report carries the verdict.

---

## 6. Worked example

Small realistic account fragment: a Facebook Lead Form feeds a workflow that
creates an opportunity at the Intake stage of a Sales pipeline, tags the
contact, and fans out three duplicate notifications (collapsed into one
message sink). A second workflow — not yet internals-inspected — is known
only by name and renders as a stub, linked in from the same tag.

```mermaid
flowchart TD
    F_fbLeadForm["Form: FB Lead Form"]
    W_wf01fbDef["WF: 01. FB DEF | Create Opp + Notify"]
    T_srcMeta["Tag: src_meta"]
    Msg_staffAlert["Msg: Staff Alert (3x email/SMS + in-app)"]
    W_wf02nurture["WF: 02. Nurture Follow-up (internals not inspected)"]
    Exit_won["Exit: Won"]

    subgraph Pipe_sales["Pipeline: Sales"]
      S_intake["Stage: Intake"]
    end

    F_fbLeadForm -->|submit| W_wf01fbDef
    W_wf01fbDef -->|creates opp @ stage| S_intake
    W_wf01fbDef -->|applies| T_srcMeta
    W_wf01fbDef -->|notifies| Msg_staffAlert
    T_srcMeta -->|tag: src_meta| W_wf02nurture
    S_intake -.->|stage → won (not confirmed)| Exit_won
```

Reading it (structure only, no verdicts):
- `F_fbLeadForm --> W_wf01fbDef`: §3.3 (Form submission → workflow entry).
- `W_wf01fbDef --> S_intake`: §3.2 (`create_opportunity` with a pipeline/stage
  target), stage lives inside the `Pipe_sales` subgraph.
- `W_wf01fbDef --> T_srcMeta`: the tag-apply half of §3.1; `T_srcMeta -->
  W_wf02nurture` is the tag-trigger half — together, one A→B tag-handoff
  edge with `W_wf02nurture` rendered as an opaque stub (§4, internals not
  yet inspected) so the map ships without waiting on that workflow's capture.
- `W_wf01fbDef --> Msg_staffAlert`: three notification actions collapsed
  into a single message sink per §1's messaging-attribution rule.
- `S_intake -.-> Exit_won`: dashed because the won-exit path isn't confirmed
  by a captured `Pipeline Stage Changed`/status-update trigger — §4's
  "uncertain edge" handling, not asserted as solid.

Validity check performed by eye: 6 top-level node declarations + 1 subgraph
(1 node inside it) = 7 distinct node IDs, all referenced consistently; every
`subgraph`/`end` pair is balanced (one pair); 6 edges, each using a valid
Mermaid arrow token (`-->`, `-->|label|`, or `-.->|label|`); no dangling
brackets or unmatched quotes in labels.
