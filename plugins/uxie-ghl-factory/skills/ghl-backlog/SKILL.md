---
name: ghl-backlog
description: Record a finding about GoHighLevel's internal API into the operator's Surface Console backlog, so it is not lost when the session ends. Use whenever you notice something worth keeping while working on the internal API — an endpoint that behaves differently than documented, a gap in the corpus, a stale or wrong claim, a rule nobody has proven, a capture that was never fed into the generator, a tool standing on evidence weaker than it looks. Also use when the operator says "note that", "add that to the backlog", "we should look at that later", or "don't lose that". ALWAYS propose the finding and wait for the operator's yes before writing anything.
---

# Recording a finding

Findings evaporate. The corpus's own `pending[]` arrays are the proof: forty-three bare strings
scattered across `corpus/*/meta.json` with no id, no date, no author, and no record of whether
anyone ever closed them. This skill exists so the next one does not join them.

## Ask first. Always.

**Propose the finding and wait for the operator's yes before writing.** One or two lines: what you
saw, which surface, and what basis you have for it. Then stop.

Silent writes were considered and deliberately rejected. A backlog is only useful if every row is
one a human agreed was real — otherwise it fills with an agent's passing impressions and the
operator stops reading it, which is worse than having no backlog.

If they say no, drop it. Do not re-propose the same finding later in the session.

## What is worth recording

A finding is something that **should change what we build or believe**, and that would otherwise
be lost:

- a documented claim you found to be wrong, or true only under a condition nobody wrote down
- an endpoint, field, or rule the corpus does not cover
- a capture that exists but was never fed into the corpus or a generator
- a shipped tool resting on evidence weaker than its status implies
- a negative result — something that does **not** work, or is not obtainable
- a gap you hit and worked around

**Not worth recording:** anything already in the corpus; a task the operator just asked you to do
(that is the task, not a finding); a preference; a tidy-up; something you are about to fix in this
same session.

## The one field that matters

`--basis` is required and has no default. It is the difference between evidence and impression:

| basis | means |
|---|---|
| `executed` | you built and sent the call, and asserted the effect — a write read back on a separate request |
| `read-only` | you read it in source, a capture, or the catalogue, and never re-issued it |
| `inferred` | you did not directly observe it; you concluded it |

Choose the weakest one that is honestly true. There is no `verified` flag anywhere in the schema,
because a boolean would flatten exactly this distinction. A `200` is not `executed` — accepted is
not applied.

## Writing it

```bash
node "$GHL_CONSOLE_DIR/bin/backlog.mjs" add "<one-line title>" \
  --surface <workflows|ai-agents|forms|platform|…> \
  --basis <executed|read-only|inferred> \
  --kind <behaviour|knowledge> \
  --workstream <W2|W3|W4|W5|W6|W7|W8|W9|W10|xander> \
  --body "<what you saw, where, and why it matters>" \
  --session "<this session's URL, if you have it>"
```

The CLI mints the id, stamps the date, validates, and refuses a finding with no basis. Never hand-
write the JSON: every writer going through one door is why the rows have the same shape.

`--surface` is the corpus surface the finding belongs to — the directory name under `corpus/`. Use
`platform` for anything cross-cutting. The CLI refuses a name that is not a known surface.

**A finding arrives routed (since 2026-10-29).** `add` refuses a row without both:
- `--kind`: `behaviour` = something to build, fix or prove by running it; `knowledge` = a fact to write down.
- `--workstream`: where the work happens, from `console/PLAN-plugin-improvement-2026-10.md` §6: W2 watcher/drift,
  W3 public catalogue, W4 rail choice, W5 teach the agent what GHL shipped, W6 workflow engine, W7 funnels and
  websites, W8 courses and memberships, W9 every other surface, W10 corpus and docs, `xander` = only Xander can do it.

**Before the session ends**, run `node "$GHL_CONSOLE_DIR/bin/backlog.mjs" list --untriaged` and route anything you
filed that shows up (`update <id> --kind … --workstream …`). A duplicate of an open row is closed into it with
`update <id> --state dropped --duplicate-of <canonical id>`, never left open beside it.

## Rows the GHL watcher filed

The console's release watcher (`bin/watch-ghl.mjs`, the **Check GHL releases** button on the Drift screen) files a row for
every GHL release with no approval step, by the operator's decision: `origin.source` is `watcher` and the row lands in
W2. Its title starts with the row's type, which is also stored as `origin.type`:

- **`[teach + prove]`**: GHL shipped a feature on a surface the agent is taught.
- **`[rail review]`**: GHL added or changed public API operations on a surface we cover. Decide whether the public or
  the internal rail serves it better.
- **`[census]`**: a release on a GHL area with no surface of ours yet. Later releases on that area add notes to the
  open row.

Every row starts with `Source: <link> (<date>)`. Work one through the **release loop**:
1. Recon what it does and which rail reaches it.
2. Teach the agent: a corpus or skill update, with unproven items marked as unproven.
3. Prove it on the sandbox.
4. Add a unit to that surface's parity inventory.

Close the row with proof like any other. Do not file your own row for a release the watcher already filed: add a note
to its row. The lines ending `(id …)` and `(key …)` are how the watcher knows what it has filed, so leave them in.

## When the console is not installed

`GHL_CONSOLE_DIR` points at the operator's `console/` directory. If it is unset and you cannot find
`console/bin/backlog.mjs` beside the knowledge repo, **say so in one line and carry on with the
task**. Do not error, do not stall, do not write the finding somewhere else, and do not invent a
file. A missing console means this operator does not run one — not that something is broken.

## What you may not do

- **You may not confirm your own finding.** An agent can move a finding to `done`; only the
  operator sets `confirmed`, and the console's API refuses it without a sentence saying what was
  checked. Do not ask the operator to confirm a finding you wrote in the same breath as writing it.
- **Do not invent provenance.** If you do not have the session URL, omit it — the console records
  and displays `unknown` rather than a guess. That honesty is the point of the field.
- **Do not record the same thing twice.** Check first:
  `node "$GHL_CONSOLE_DIR/bin/backlog.mjs" list --surface <surface>`

## Related

- `ghl-reverse-engineering` — the discipline that produces most findings
- `ghl-system-conventions` — house conventions for building, not for recording
