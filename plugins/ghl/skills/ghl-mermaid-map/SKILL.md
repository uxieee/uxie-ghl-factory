---
name: ghl-mermaid-map
description: Renders the account's system flow as a Mermaid map — entry points, tags, pipeline stages, workflows, messaging sinks, and exits, connected by inferred edges (tag handoffs, stage changes, form submissions, goal events). Descriptive only: the map shows structure, never findings or verdicts. Use whenever an audit needs a system-flow diagram, when recon data is partial and a map still has to ship, or when asked to visualize how contacts move through a GHL sub-account.
---

# GHL Mermaid Map

Turns recon output (workflow roster, pipeline/stage list, tags in use, forms,
and — when available — captured workflow internals) into one `flowchart TD`
Mermaid diagram of the contact journey through a GHL sub-account.

Read `references/grammar.md` before rendering a map. It's the whole grammar:

- Node taxonomy and ID-prefix conventions (§1–2).
- Edge-inference rules — what data pattern implies which edge, and how to
  label it (§3).
- Stub-node handling — the rule that keeps the map shippable even when
  recon is partial (§4).
- The descriptive-not-verdict boundary — the map is structure only;
  findings and severity live in the audit report, never on the diagram (§5).
- A worked, hand-checked example (§6).

## Ground rules

1. **Contact-journey frame, not dependency graph.** Every edge must narrate
   as "a contact arrives here, something happens, the contact ends up
   there." If it can't be told that way, it isn't a map edge.
2. **The map always ships.** Partial data renders as opaque stub nodes
   (`references/grammar.md` §4) — never omit a node or withhold the map
   because a workflow's internals weren't captured.
3. **No verdicts on the diagram.** Labels state facts the data supports
   (`tag: X`, `creates opp @ stage`). Judgments ("broken", "duplicate",
   "wasteful") belong in the audit report as findings, citing the map's
   node/edge as evidence — never in the `.mmd` itself.
4. **Read-only.** This skill only reads recon artifacts already gathered
   elsewhere (`ghl-audit-primitives`, `uxie-ghl-mcp`, or a workflow-JSON
   capture) and writes a Mermaid diagram; it never touches the GHL account.

## Scope

IN: node taxonomy, edge-inference grammar, stub handling, and the
descriptive/verdict boundary for one system-flow map.

OUT: deciding what's in-scope for a given audit mode (thesis vs. deep-dive
vs. sweep scoping), writing the narrative commentary that accompanies the
map, and any finding/severity logic — those live with the auditor orchestration
and `ghl-audit-primitives` respectively.
