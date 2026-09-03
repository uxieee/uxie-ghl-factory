---
name: ghl-system-conventions
description: House conventions for building GoHighLevel systems — workflow naming and structure, tag/field/custom-value discipline, pipeline and opportunity decisions, copy rules, and the pre-build approval document the operator signs off before anything gets created. Account-agnostic, for ANY GHL sub-account. Use whenever designing, building, editing, reviewing, or discussing GHL workflows, automations, pipelines, stages, opportunities, tags, custom fields, custom values, calendars, or AI agents — even if the user never says "conventions" or "standards". Load it BEFORE proposing a design or creating any GHL object, so the proposal already looks the way the operator wants it.
---

# GHL System Conventions

How the operator builds in GoHighLevel, especially **workflows**. This is account-agnostic:
no agency, client, or persona names live here. Anything client-specific (persona name,
business name, prices, links, cadences, copy) is per-build data, not a convention.

This skill decides what a design **looks like** — the shape, the names, where data lives,
the gates a design passes through. It does not build.

## What this needs

It works in two settings. Know which one you are in, because it changes where truth comes from.

- **Standalone** (installed with `npx skills add uxieee/ghl-system-conventions`). Everything
  here applies. GHL's own vocabulary — every trigger and step type, its fields, allowed values,
  validator and proof status — ships inside this skill: `references/ghl-types-index.md` to see
  what exists, `node scripts/types.mjs <type>` for the full card. Reading the account is up to
  whatever GHL access you have (the public `ghl` MCP, or the UI). Building is by hand in the
  builder, from the approved pre-build document.
- **With the `uxie-ghl-factory` plugin installed.** Same skill, more reach: `describe_step_type`
  serves the same type cards as a tool, `search_endpoints` adds the internal API, the internal
  MCP reads the whole account at once (`list_account_entities`,
  `get_account_workflow_overview`), and execution runs through the plugin's specialists —
  `ghl-workflow-specialist` (which delegates the build to `create-ghl-workflow`) and
  `ghl-pipeline-specialist` — on their shared `docs/specialist-contract.md` loop
  (recon → brief → intake → blueprint → approval → execute → verify). Load this skill before the
  blueprint so the proposal already looks right.

In either setting: **when you cannot verify a mechanic, say so.** Never fill the gap with
web knowledge — the GHL article layer is largely AI-written restatement that gets basic
mechanics wrong.

## Before you answer anything: recon

**Never respond to a build question cold.** Go and look first, then talk. A reply that
arrives instantly is a reply written from assumptions, and the operator can tell — the
fastest way to lose their confidence is to ask them something the account would have told you.

Recon is **silent and read-only**. Don't narrate each call or ask permission to look; just
go, then come back with what you found. Nothing gets created or modified during recon.

Where to look, in order:

1. **The account**, if there is one. Get the location, then read its actual state:
   existing workflows and their status, pipelines and stage lists, tags, custom fields,
   custom values, calendars, AI agents, forms and funnels. With the plugin, the internal MCP
   covers the builder surfaces — `list_account_entities` and `get_account_workflow_overview`
   are the fastest way to see an account whole — and the public `ghl` MCP covers contacts,
   opportunities and the rest. Standalone, the public MCP or the UI is what you have; read
   what you can and say what you could not. Prefer a typed tool over a raw request, since
   the typed ones carry the verification.
2. **The client folder on disk** — briefs, prior audits, design docs, meeting notes,
   earlier handoffs. Half the questions you were about to ask are usually already answered
   in a file from three weeks ago.
3. **The knowledge corpus** for any platform mechanic you're about to rely on.

Then, and only then, respond — leading with what you found, and asking only what recon
genuinely could not answer. If the account doesn't exist yet, say so plainly; a greenfield
build is the one case where questions are all you have, and even then the folder is worth
checking.

## The meta-rule: guide the operator to a plan, don't hand them one

Your job is to walk the operator to a design **they have agreed to, one decision at a time**. It is
not to produce a finished system in your first reply. Most structural choices here are
genuinely situational — how many pipelines, what the stages are, how the ladders run — and
a complete build proposal that arrives before the business is understood looks impressive
while resting on facts nobody established. That's the failure mode to avoid, and it's more
seductive than it sounds: a plausible full design is easy to write and hard to argue with.

Three things follow.

### 1. Know the business before you design anything

"Dental clinic doing Invisalign" is a vertical and a treatment. It is not a brief. You
cannot choose a pipeline shape without knowing what is actually being sold and how it gets
sold. When the brief is this thin, **the correct response is the specific questions, not a
system.** Saying "I can't design this yet, here's what I need" is a good answer, not a
failure to be helpful.

What you typically need before the first structural decision:

- **The offer** — what exactly is being advertised, at what price, and is that the thing
  they actually make money on, or a front-end into something bigger?
- **How it's sold** — does the ad go straight to a booking, or is there a consult,
  assessment, scan, quote, or deposit in between? How many touches before money changes
  hands?
- **What happens after they book** — who sees them, how long is the appointment, and what
  is the next step after that visit? Multi-visit treatments change the whole tail.
- **Who does what on their side** — who answers messages, who dispositions appointments,
  what will they realistically action versus ignore.
- **What already exists** — calendar, diary, payment processor, existing CRM or workflows,
  and whether booking lives in GHL or somewhere else.
- **Volume and capacity** — leads per month, and how many they can actually handle.

Ask for what's missing in a batch they can answer in one pass, grouped by topic, and say why
each one changes the build — a structured list they can work through, or forward to the
client, is the right shape here. What makes it land is that every question in it survived
recon: you looked, and these are the ones the account genuinely could not answer.

### 2. Move one layer at a time, and stop at each

Each layer's answer changes the next one, so running ahead wastes both your work and their
attention. The order, with a confirmation gate between every step:

1. **Business and offer** — confirmed above, in their words, before anything structural.
2. **The pipeline** — how many, and the stage list. Agree this before workflows exist,
   because stages determine what the workflows have to move.
3. **The workflow list** — names and one-line jobs only. No steps, no copy. This is where
   they decide what the system *contains*.
4. **Each workflow in detail, one at a time** — trigger, steps, waits, exits. They check
   each before you move to the next.
5. **Copy** — once the structure is settled.
6. **The pre-build document** — the whole agreed design in one self-contained HTML file
   (system map, one card per workflow, full copy appendix), approved before anything is
   built. Say from the first reply that this is where the design lands, so nobody expects
   a build to start from a chat.

Present a layer, give your reasoning and recommendation, then stop and let them respond.
A recommendation is welcome; a finished document they have to unpick is not.

### 3. Gaps

- If two different answers would produce **two different builds**, that's a design
  question — ask, and don't pick for them.
- If it's just a missing value (a price, an address, a link), collect it — ask, or gather
  every missing item into one markdown file they can fill in one pass. Never guess, and
  never let a placeholder end up in a live timer.

## Hard rules

These hold regardless of the build.

**Structure**
- **No emoji in any GHL object name** — workflows, tags, fields, stages, calendars.
- **No Lost stage.** Lost and Won are opportunity *statuses* in GHL, and a status write
  leaves the card in the stage where it died — which is how you see where the leak is.
  Use the native lost reason field, not a custom one.
- **Each distinct journey gets its own workflow.** Don't bolt a reschedule handler onto
  the booking workflow. Where there are parallel lanes, each lane gets its **own full
  ladder**, not a shared one with branches.
- **Notifications live inside the workflow that triggers them.** Never a standalone
  notifications workflow.
- **Escalation never dead-ends.** If a lead asks for a human, trace the path and prove a
  human is actually told. "Someone will follow up" with nobody notified is a defect.
- **Cancellation gets a win-back sequence before anything writes Lost.**
- **Genuinely different deals get their own opportunity.** Don't overwrite a card for
  one offer because the same contact bought something else.
- **Opportunity value is set at creation and never zero** — a zero-value pipeline makes
  drop-off look costless and makes stage-value reporting meaningless. Default to the
  advertised offer price. If realised revenue isn't tracked in-system, label reporting
  as *advertised*, not realised.

**Copy**
- **No em dashes** in anything a lead, caller, or client can see, and none in AI agents'
  instruction text so the agents never emit one. Internal docs and analysis are exempt.
  The rule exists so customer-facing writing doesn't read as machine-written.
- **It has to read like a human wrote it.** If only an AI would phrase it that way,
  rewrite it.

**AI**
- **The AI persona name lives in a custom value** and is referenced everywhere — copy,
  prompts, agent config. Never hardcoded, never assumed from another build.
- **Every bot gets tested** before it's live. Flow bots have no sandbox, so that means a
  controlled real conversation on a number or inbox the build team owns.

## Naming

**Workflows** — `NN - Name`. Two-digit zero-padded number, Title Case name.
- Numbers run in **journey order**, not creation order.
- Numbering is **contiguous**. If a workflow dies, renumber the ones after it. No gaps.
- **No sub-numbers.** `07b`, `16.1` — renumber instead.
- **Refer to workflows by name, not number** when talking to the operator. Numbers move when
  things get renumbered; names don't.
- Retired workflows get an **`X ` prefix** and are unpublished, so dead things look dead.
- **Test objects say TEST in the name.** Nobody should have to wonder.
- **Group workflows into GHL folders by system or rail** (per funnel, per booking rail,
  per parallel system). Number within the journey.

**Tags** — `namespace:value`, lowercase, hyphens inside multi-word values.
GHL normalises tags to lowercase on write, so casing is not something to police. What it
does *not* normalise is delimiters, word order, and synonyms — that's where duplicates
actually come from.

**Fields** — human-readable name, `snake_case` key, and every field gets a real
description in GHL. Same split as custom values: the name is for the person picking it in a
dropdown, the key is what automations reference.

**Custom values** — the **name is human-readable** ("AI Persona Name", "Review Link");
GHL derives the `snake_case` **key** from it, and the key is what you reference:
`{{custom_values.ai_persona_name}}`. Name it for the human reading the picker, then use the
key everywhere. Foldered values show in pickers as `folder.name`, so the folder is part of
how it reads. Every account constant lives here: business details, links, prices, review
link, AI persona name. Copy and prompts reference the custom value so nothing has to be
changed in twenty places.

**Opportunity cards** — `<something that describes the opportunity> - <Full Name>`, so
the board is readable at a glance.

**Calendars and payment products** — the names are load-bearing, because workflows filter
on the exact string. Decide them once, write them down, never respell.

## Tags, fields, and where data lives

This is the area with the most room to get wrong, so here's the decision rule. Take the
first "yes":

1. **Is it sales progression the business reports conversion on?** → pipeline stage.
2. **Is it one-of-N, a number, a date, or something you'll report on?** → custom field.
   A field holds one value, so mutual exclusion is enforced by the data structure instead
   of by every workflow remembering to remove three other tags.
3. **Does it only need to exist during one workflow run?** → don't persist it at all.
   Use branching or a wait-for-condition. A tag added at step 3 and removed at step 9 of
   the same workflow is usually a step you didn't need.
4. **Must another workflow react the instant it becomes true?** → tag. The tag trigger is
   the cheapest cross-workflow event bus GHL gives you.
5. **Is it a durable yes/no fact you'll segment on?** → tag.
6. Otherwise → a note, or nothing.

The sharpest test: **if a tag's name contains a number, a date, or a category, it wants
to be a custom field.**

**Tags are deliberate.** Every tag needs a named applier, a named remover (or "permanent"),
and at least one consumer. A tag that duplicates what a pipeline stage or a field already
says is a defect — now there are two sources of truth and they will drift.

**Opted-out contacts get a tag.** DND is the native mechanism and still does the actual
suppression, but the tag is what makes opt-out visible to humans and filterable in lists.
Write it from the same workflow that sets DND so the two can never disagree — a tag that
says one thing while the send-eligibility says another is worse than no tag.

**Cooldowns and throttles want a timestamp field, not tags.** GHL has no native
per-contact rate limit, so the reflex is a cooldown tag per sender. That scales badly:
every guarded workflow needs one explicit condition per cooldown, and a tag gets stranded
forever if the workflow that was meant to remove it is edited or exits early. One
`last_outbound_at` date field replaces all of them with a single relative-date condition.
Tags are still right for **terminal exhaustion** ("this contact has finished this
sequence, never again") because that genuinely is permanent.

For namespace design, lifecycle classes, worked taxonomies, and the platform mechanics
behind all of this, read `references/tags-and-data.md`.

## Pipelines and opportunities

Situational, so these are tests to reason with, not rules to apply.

- **Split pipelines on stage identity, not subject matter.** Two things belong in one
  pipeline if they move through the same stages and merely differ in what was sold, who
  sold it, or where. They belong in separate pipelines when the stage sets genuinely
  differ. Product, region, source, and rep are all card properties — never pipelines.
  (Owner is already a first-class filter and dashboard grouping in GHL; a per-rep pipeline
  buys a filter you already have and destroys the comparable funnel.)
- **A stage is a buyer position, not a task and not a bot state.** Test: if two people
  could disagree about whether a deal belongs in a stage, rename the stage. "Follow Up"
  and "Interested" are tasks and feelings; they become accumulation points.
- **Five to seven stages** is the range both GHL practitioners and general sales-ops
  literature land on independently. Ten-stage pipelines get abandoned.
- **If two stages would trigger the same downstream action, they're one stage.**
- **One card per cycle.** Reschedules, cancellations, and no-shows are all the same
  unfinished conversation and reuse the card. A genuinely new deal is a new card.
- Note the platform constraint: **allow-multiple-opportunities is a global, effectively
  one-way toggle** — it can't be set per pipeline, turning it off doesn't clean up
  existing duplicates, and pipeline value widgets will double-count contacts with several
  open cards. Decide it at design time and say so in client reporting.

## Workflow architecture

- **Every sequence declares its exits.** Document which workflows remove a contact from
  which — booking kills the chase, a reply kills the nurture. A lead who has progressed
  must never keep getting chased. Watch the inverse case too: a payment or deposit chase
  usually needs to survive other workflows' cleanup, or the client stops getting paid.
- **Stop-on-response is a per-workflow decision, not a blanket default.** It's a
  workflow-level setting (`stopOnResponse`, defaults to off) that ends the workflow for a
  contact who replies to a message it sent. Right for a chase ladder, wrong for a reminder
  sequence you want to finish regardless. Decide it per workflow and say which and why.
- **No touch ceiling.** Don't impose a global cap on messages per contact — how much
  contact is appropriate is a strategy question that belongs to the build, not a
  convention.
- **Quiet hours where the strategy calls for them.** Nobody should be getting messages at
  3am by accident, but the send window is a per-build decision.
- **Alert channel is a deliberate choice with a reason.** SMS costs money and email
  doesn't, which is often enough to settle it — but state the reason rather than
  defaulting silently.
- **Appointment-anchored waits use GHL's native past-anchor handling, not a manual
  branch.** An `appointment` / `service_booking` / `overdue` wait carries
  `appointmentCondition`, which decides what happens when the anchor has already passed.
  Four values: `skip` (suppress outbound sends until the next wait — the contact keeps
  walking the workflow, so tag writes and stage moves still run), `next` (fall straight
  through to the next step, which is what produces the everything-at-once bug), `exit`
  (remove the contact from the workflow entirely), and `specific-step` (jump to a step
  named by `appointmentSpecificStep`). Set it deliberately. Building an if/else guard in
  front of the wait is reinventing a setting that already exists.
- Editing a live workflow: **deleting steps is fine when that's the right change.** Just
  make sure the change is deliberate and captured in the before/after report.

## The knowledge corpus is the source of GHL truth

GoHighLevel's internals are documented in a proven knowledge corpus — built from recovered
front-end source, captured traffic, and probes executed against live accounts. It beats
recollection, and it very much beats anything on the open web, where the GHL article layer
is largely AI-written restatement that gets basic mechanics wrong. **Check it before
asserting how GHL behaves.**

It reaches you three ways:

- **Inside this skill, always.** The type layer ships here: `catalog/type-cards.json` is
  one card per step and trigger type — the real field set, allowed values, validator
  behaviour and proof status, the full union of every discriminator — regenerated from the
  corpus at every release. `references/ghl-types-index.md` lists them; `node
  scripts/types.mjs <type>` prints a card. Read the card before asserting what a step takes.
- **Through the plugin's MCP, when installed.** `search_step_types` / `describe_step_type`
  serve the same cards as a tool; `search_endpoints` / `describe_endpoint` add every
  internal endpoint with its proof status; `search_merge_tags` the merge-tag vocabulary.
- **As files, when the corpus is on the machine.** The full corpus (nine surfaces —
  workflows, ai-agents, funnels, memberships-courses, events, platform, marketplace-apps,
  ask-ai, plus shared rails; around 390 pages for workflows alone) lives in a `knowledge/`
  repo beside the plugin's source repo. It has no remote, so it is only present on the
  machine it was built on. If it is there, read it for anything the tools do not carry:
  `40-rules/` (what GHL rejects or silently ignores), `50-runtime/`, `60-recipes/`,
  `70-research/`. If it is not there, say so and work from the tools plus what you can
  verify in the account — never quietly substitute half-remembered web knowledge, which
  is where most wrong GHL answers come from.

Two things make the corpus usable rather than overwhelming:
- **Every page and every type card carries a `status:`** — `proven-live`,
  `source-derived`, `inferred`, or `deprecated` — and that status is the page's *floor*,
  the weakest claim on it. Stronger or weaker individual claims are annotated inline. When
  you rely on something, say which level you relied on. `proven-live` means executed
  against a live account and read back.
- **Every directory has an `index.md` that routes.** Follow the routers; don't read whole
  folders. `corpus/START-HERE.md` maps intent to path.

`references/ghl-mechanics.md` holds the short list of build-time traps worth knowing
before you start, each pointing at the corpus page that proves it. The corpus wins on any
conflict — including with this skill.

## Working with the operator

- **Recon before you speak.** Silent, read-only, every time there's an account to read.
- **They're in the planning loop, layer by layer.** Confirm the business, then the pipeline,
  then the workflow list, then each workflow — stopping for their answer at each. They decide
  at every gate; you bring the reasoning and a recommendation.
- **Nothing gets built until they say the design is good.** That gate comes before the
  first object is created.
- **Build one at a time.** Create workflows one by one so they can check each. It's a
  back-and-forth, not a batch drop — the same rhythm as the design conversation.
- **Default to drafts.** The operator usually publishes in the UI themselves, but will say
  when they want something published — publishing on request is fine, publishing on your own
  initiative isn't.
- **Verify against the live account.** A green script or a tidy doc is not evidence the
  account agrees. Read it back.
- **E2E test the whole system before launch** — a real, clearly-marked TEST lead through
  every entry point, walked all the way through — and keep a written record of results.
- **Every change set ships with a before/after and a report of what was actually done.**
- **Explain clearly.** Technical detail is fine; unexplained jargon isn't. They need to
  understand what a thing does and why, not just what it's called.
- **Never delete anything of theirs.** Mark it (`X ` prefix, TEST label) and leave it for
  them to remove. Deleting *steps inside a workflow* as part of a deliberate edit is a
  different thing and is fine.
- Keep client folders organised — dated build folders, backups before mutations, no loose
  files in the root.

## The pre-build document

Before anything is built, the operator reviews a **single self-contained HTML file**. This is
the approval artifact, not a report: they approve the diagrams, and building becomes
transcription rather than fresh decision-making. That means every diagram has to be in
GHL's own vocabulary — real trigger names, real action types, real filters, real waits.

The short version: one self-contained file with a sidebar, an interactive wiring-flow
system map at the top (removal wiring on by default, click to isolate), then one card per
workflow in the system-book idiom — trigger line, settings pills, a centered mermaid
flowchart with ladders collapsed into narrative nodes, and a decision paragraph — with
every diagram click-to-enlarge and all message copy in a full script appendix. Diagrams
are the default and prose is the support.

Full spec is in `references/build-doc-spec.md`, and an approved worked example ships at
`assets/example-prebuild-doc.html` — match it rather than reinventing the format.

## References

- `references/tags-and-data.md` — tag namespaces, lifecycle classes, worked taxonomies,
  and the platform mechanics behind tags, fields, and custom values.
- `references/ghl-mechanics.md` — builder behaviours that fail silently. Read before
  creating or editing workflow steps, pipelines, or AI agents.
- `references/build-doc-spec.md` — the pre-build HTML approval document.
