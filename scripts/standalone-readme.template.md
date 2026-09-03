# ghl-system-conventions

A Claude Code / Codex skill: **how a GoHighLevel system should look before anyone builds it.**

{{DESCRIPTION}}

## Install

```bash
npx skills add uxieee/ghl-system-conventions
```

That installs it for every agent the `skills` CLI supports (Claude Code, Codex, Cursor, …).
Claude Code users can also take it as part of the [uxie-ghl-factory](https://github.com/uxieee/uxie-ghl-factory)
plugin, where it sits alongside the build engines and the internal MCP server.

## What it does

- **Recon before responding.** Never answers a build question cold — reads the account first,
  then asks only what the account could not answer.
- **Guides, doesn't hand over.** Walks the design one layer at a time — business and offer →
  pipeline → workflow list → each workflow → copy — with a confirmation gate at each.
- **Naming and data discipline.** `NN - Name` workflows in journey order, `namespace:value` tags,
  `snake_case` fields and custom values, and a six-step rule for where a piece of data lives
  (pipeline stage, custom field, tag, or nothing).
- **Hard rules.** No Lost stage. Every journey gets its own workflow. Notifications live inside
  the workflow that fires them. Escalation never dead-ends. Opportunity value is never zero.
  No em dashes in anything a customer reads.
- **The pre-build approval document.** One self-contained HTML file — interactive wiring map,
  one card per workflow in GHL's own vocabulary, mermaid diagrams, full copy appendix — that
  the operator approves *before* anything is created. A worked example ships in `assets/`.

## What it knows about GHL

GoHighLevel's workflow vocabulary ships inside the skill: **{{TYPE_COUNT}} step and trigger
types** ({{NATIVE_COUNT}} native, the rest marketplace apps), each with its fields, allowed
values, validator behaviour and a proof status — compiled from a corpus of recovered front-end
source, captured traffic and live-account probes.

```bash
node scripts/types.mjs wait          # the full card for one type
node scripts/types.mjs appointment   # search
```

`references/ghl-types-index.md` lists every type on one line. `references/ghl-mechanics.md`
carries the build-time traps that fail silently (settings defaults, the four-value
`appointmentCondition`, `allowBackward`).

**With the plugin installed** you get more reach: the same type cards as a tool
(`describe_step_type`), the internal endpoint catalogue, whole-account recon, and the build
engines that turn an approved design into real workflows.

## Layout

```
SKILL.md                         the conventions
references/tags-and-data.md      namespaces, lifecycle classes, worked taxonomies
references/ghl-mechanics.md      builder behaviours that fail silently
references/build-doc-spec.md     the pre-build HTML approval document
references/ghl-types-index.md    every step and trigger type, one line each   (generated)
catalog/type-cards.json          the full cards                                (generated)
scripts/types.mjs                read a card / search
assets/example-prebuild-doc.html an approved worked example
```

## This repo is a mirror

Published from the [uxie-ghl-factory](https://github.com/uxieee/uxie-ghl-factory) plugin's copy
at every plugin release — currently **{{VERSION}}**. Please open issues and pull requests
**there**; edits made here are overwritten on the next publish.

## License

MIT — see `LICENSE`.
