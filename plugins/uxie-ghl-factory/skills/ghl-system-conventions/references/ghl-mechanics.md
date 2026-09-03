# Build-time traps, and how to look things up

**The corpus is authoritative, not this page.** Its type layer ships inside this skill
(`node scripts/types.mjs <type>`, or `describe_step_type` with the plugin); the rest reaches
you as files when the `knowledge/` repo sits beside the plugin's source repo on this
machine (see SKILL.md, "The knowledge corpus"). Paths below are relative to that repo.

This page is a short list of things worth knowing *before* you start, each pointing at the
corpus page that proves it. Anything below that conflicts with the corpus: the corpus is
right and this page needs fixing.

## Routing into the corpus

Read `corpus/START-HERE.md` first — it maps intent to path. Then follow `index.md` routers
rather than reading folders. The layer numbering is the same on every surface:

| Layer | Holds | Go here when |
|---|---|---|
| `00-overview` | what the surface is, hosts, auth, coverage | orienting on something new |
| `10-anatomy` | object model, envelope, lifecycle, id resolution | "how is a workflow actually shaped?" |
| `20-api` | endpoints: takes X, returns Y, fails with W | calling something directly |
| `30-types` | **one page per step / trigger type** — filename is the type key | building or editing any step |
| `40-rules` | what GHL rejects or silently ignores; validators; settings semantics | "why did it not do the thing?" |
| `50-runtime` | logs, stats, execution data, and what is *not* obtainable | debugging a live workflow |
| `60-recipes` | end-to-end patterns | building a known shape |
| `70-research` | dated, unedited primary-source reports | the distilled layer doesn't cover it yet |
| `_data/` | machine-readable JSON | you need exact allowed values — prefer this over prose |

Confidence: `status:` in a page's frontmatter is its **floor**. `proven-live` means
executed against a live account and read back — accepted is not applied, a 200 is not
proof. Say which level you relied on when you report a finding.

Beyond the corpus proper: `catalog/step-examples/` and `catalog/trigger-examples/` hold
canonical example JSON, `samples/by-location/` is a 326-workflow crawl of real builds
(useful for "what do real workflows actually put here?"), and `DISCOVERIES.md` is the
original research log.

## Settings that are not what you'd guess

*Source: `corpus/workflows/70-research/SETTINGS.md`, `40-rules/settings-semantics.md`*

- **`stopOnResponse` is workflow-level and defaults to OFF.** One toggle for the whole
  workflow, not a per-step option. It ends the workflow for a contact who responds to a
  message that workflow sent. Decide it per workflow — right for a chase, wrong for a
  reminder run you want to complete.
- **`allowMultiple` (allow re-entry) defaults to TRUE** in fresh workflows, though the
  model getter coerces a missing value to false. And **appointment- and invoice-based
  triggers accept contacts multiple times regardless of the setting.**
- **`allowMultipleOpportunity` is a separate setting** and works even when re-entry is
  off. Don't conflate the two.
- There is **no** per-workflow drip mode, autopilot, stop-on-goal, or re-entry cooldown
  setting — those terms were searched across all recovered sources and don't exist. Don't
  design around a setting GHL doesn't have.

## Waits

*Source: `corpus/workflows/30-types/steps/wait.md`*

`wait` is one step type discriminated by `attributes.type`: `time`, `condition`, `reply`,
`appointment`, `service_booking`, `overdue`, `email_event`, `link_clicked`. The
discriminator changes the entire required-field set — don't migrate a wait between types
without re-validating.

- **Past-anchor behaviour is native.** Appointment-family waits carry
  `appointmentCondition`, deciding what happens when the anchor is already in the past.
  The enum has **four** values (`appointmentConditionType` in the recovered
  `models/conditions/Wait.ts`):

  | Value | Behaviour |
  |---|---|
  | `skip` | Skips all **outbound communication** actions until the next wait or event-start-date action. The contact keeps walking the workflow, so tag writes, stage moves and task creation still run. |
  | `next` | Falls straight through to the next step — this is what produces "every reminder fired in one minute". |
  | `exit` | Removes the contact from the workflow entirely. Careful: putting this on an early wait also kills later reminders whose anchors are still in the future. |
  | `specific-step` | Jumps to the step named by `appointmentSpecificStep`. |

  Stored usage across the sample crawl: `skip` ×95, `specific-step` ×6, `next` ×2, `exit`
  ×0 — so `skip` is the de-facto default in real builds. Set it deliberately; don't build
  an if/else guard in front of the wait.

  ⚠️ The corpus's own `30-types/steps/wait.md` describes this field as `"specific-step"
  etc.` without enumerating it. The four-value enum above is read directly from the
  recovered source and is worth folding back into that page.
- **Hybrid waits carry two exits.** With `convertToMultipath: true` a wait has both `next`
  (the timeout path) and `transitions[]` (the event-fired paths); the runtime takes
  whichever fires first. That's the reply-with-timeout pattern.
- **`window` is timezone-naive** — `start`/`end` are bare `HH:MM` strings resolved against
  the location timezone.
- **The unit value for hours is `hour`, singular**, in the drawer. Stored workflows contain
  both spellings; a stored `hours` was written by an API call, not the UI, and whether the
  scheduler honours it is unproven.
- Conditional waits **cannot** go inside a Loop — blocked types are listed in the corpus
  page.

## Opportunity writes

*Source: `corpus/workflows/30-types/steps/internal_update_opportunity.md`,
`10-anatomy/07-id-resolution.md`*

- **`allowBackward` defaults to `false`.** Any move to an earlier stage needs it set, or
  the move silently does nothing. Present on 100% of corpus occurrences, so real builds do
  set it — check yours does.
- Pipeline, stage, monetary value and status resolve **per sub-account** inside
  `__customInputFields__`. IDs are not portable between accounts; resolve them at build
  time against the target location.

## Before you assert anything else

Rather than trusting a remembered rule about finder filters, tag-trigger timing, branch
shapes, validator behaviour, or AI-agent config, look up the type page in
`corpus/workflows/30-types/` and the relevant `40-rules/` page. Those pages carry the
attribute table, the validator, a canonical example, and a gotchas section, all cited back
to the evidence.

The corpus also records what is **not** knowable — `50-runtime/` documents which runtime
data GHL does and doesn't expose. A question answered "you can't get that" is as useful as
one answered with an endpoint.

## Keeping it honest

Two cheap staleness checks live in the knowledge repo:

```bash
node sniffs/check-app-builds.mjs      # one public GET; exit 2 if a front-end build moved
node scripts/check-catalog-drift.mjs  # hashes the mined source tree the catalogue came from
```

A moved build means pages citing that app are of unknown age — not that they're wrong. If
you discover something the corpus doesn't have, it belongs in the corpus, in the right
layer, with an honest `status:` — not pasted into this skill. See that repo's `CLAUDE.md`
for where findings go and its page contract.
