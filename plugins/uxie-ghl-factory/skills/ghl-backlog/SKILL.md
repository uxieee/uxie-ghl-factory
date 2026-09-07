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
  --body "<what you saw, where, and why it matters>" \
  --session "<this session's URL, if you have it>"
```

The CLI mints the id, stamps the date, validates, and refuses a finding with no basis. Never hand-
write the JSON: every writer going through one door is why the rows have the same shape.

`--surface` is the corpus surface the finding belongs to — the directory name under `corpus/`. Use
`platform` for anything cross-cutting.

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
