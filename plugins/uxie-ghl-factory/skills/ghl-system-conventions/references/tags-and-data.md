# Tags, fields, and custom values

Reference for deciding where a piece of information lives and how to name it. The
decision rule itself is in SKILL.md; this is the depth behind it.

⚠️ **On platform behaviour, the corpus wins over this page.** The taxonomy and
decision-making guidance here is judgement, drawn from practitioner sources and from real
accounts. The mechanical claims are weaker evidence than the corpus — check
`node scripts/types.mjs contact_tag` (or `describe_step_type` with the plugin, or, with the corpus on disk,
`corpus/workflows/30-types/triggers/contact_tag.md` and the relevant `40-rules/` pages)
before relying on anything mechanical below.

## What GHL actually does (verified, not folklore)

**Tags are normalised to lowercase on write.** Almost every published article about GHL
tags claims they're case-sensitive and that `Facebook` and `facebook` are two tags. This
was checked against real accounts via `GET /locations/{id}/tags` — five sub-accounts,
around 610 tags, including one 457-tag legacy account fed by years of imports, manual
entry and integrations. Not one uppercase character anywhere. You cannot create
`Facebook`; you get `facebook`.

So casing is not a discipline worth enforcing. **Delimiters, word order, and synonyms are**,
because GHL normalises none of those. Real duplicates observed in one account:

- `cash buyer` / `cash-buyer`, `case study` / `case-study`, `listing agent` / `listing-agent`
- four delimiters in simultaneous use: space, hyphen, underscore, and ` - `
- seven spellings of a single certification
- **five different ways to say "don't contact this person"** — which means any suppression
  filter written against one of them silently misses the other four

That last one is the expensive failure. Everything else is untidy; that one mails someone
you promised not to mail.

**Half-finished migrations are worse than no convention.** An account that adopted
`namespace:value` partway through and left the old flat tags behind has filters that look
correct and silently miss every contact carrying the old spelling. If you start a
migration, finish it.

**Import artefacts are real.** Tags containing raw JSON (`"buyer lead"`,
`[\"do-not-engage`, `"imls"]`) appear when something POSTs a string where the API wants an
array. They sort to the top of the tag list under `"`, can never be matched by a filter,
and nobody finds them unless they look. After any bulk import or new integration, pull the
tag list and check the head of it for quote and bracket characters.

## Namespace shape

`namespace:multi-word-value` — lowercase, colon between namespace and value, hyphens
inside the value.

Two reasons this beats the alternatives (`source-meta-ads`, `src_facebook_ads`, freeform):

1. **The tag picker is a substring search over an alphabetical list.** Typing `status:`
   returns the complete set of status tags in one glance. This matters more than it
   sounds, because *sprawl is caused by failed search* — someone can't find the existing
   tag, so they type a new one. A namespace is a search affordance first and documentation
   second.
2. **A colon makes the boundary visible.** `status:long-term-nurture` parses instantly;
   `status-long-term-nurture` doesn't.

**Six to eight namespaces, hard stop.** The namespace list is the schema. If it's growing
past eight, two of them are the same thing, or one of them is a custom field.

More than about ten values under one namespace usually means that namespace should have
been a single-select custom field.

## Lifecycle classes

Every tag belongs to exactly one class, and the namespace should make the class obvious
from the name alone:

| Class | Lifecycle | Removal |
|---|---|---|
| **Identity** — a durable fact about the person | set once, effectively permanent | never — source is history, and rewriting it corrupts attribution |
| **State** — current position, mutually exclusive | exactly one at a time | mandatory: applying one removes its siblings **in the same workflow step** |
| **Flag** — a reversible operational condition | independent, add/remove freely | when the condition ends |
| **Ephemeral** — campaign or run-scoped | days to weeks | scheduled sweep of the whole namespace |

**Mutual exclusion is enforced in the step, in the same action, or it doesn't exist.**
Otherwise contacts end up simultaneously a lead, a customer, and churned, and every
segment built afterwards is wrong.

**The ephemeral namespace is the pressure valve, not a concession.** Governance that says
"only admins create tags" fails in practice, because both the add-tag and remove-tag
workflow actions let any builder mint a tag by typing it — there is no gate. Governance
that says "create whatever you want under `tmp:` and it gets swept quarterly" survives
contact with a real team, and it's what keeps the other namespaces clean.

## A starting taxonomy

Roughly twenty tags, six namespaces. Adapt per build; the shape is the point.

```
src:      set once, never removed          — attribution truth
          src:meta-ads  src:google-ads  src:organic  src:referral  src:manual

status:   exactly one at a time            — applying one removes the siblings
          status:new  status:engaged  status:booked  status:customer
          status:churned  status:disqualified

flag:     independent, reversible          — operational conditions
          flag:vip  flag:opted-out  flag:needs-human  flag:payment-failed

ai:       AI rail control surface
          ai:off  ai:escalated  ai:human-takeover

exh:      terminal — sequence consumed, never re-enroll
          exh:speed-to-lead  exh:no-show-recovery  exh:nurture

tmp:      anyone may create, swept quarterly, no questions asked
          tmp:webinar-mar-2026  tmp:promo-launch
```

Rules that ship with it: `status:` is mutually exclusive and enforced in-step; `src:` is
never rewritten even when someone re-converts through another channel; `flag:opted-out` is
written by the same workflow that sets DND; nothing exists outside the namespaces, and a
tag that doesn't fit is a custom field.

## Custom fields

- **Constrained types where the values are genuinely known and stable** — a dropdown beats
  a text field for anything you'll branch or report on. But this is a per-field judgement
  call, not a blanket rule: run field types past the operator rather than deciding alone.
- **Anything an AI agent writes must be TEXT.** AI field-write actions can't bind picklist
  options. Document the expected values instead.
- **Anything that has to merge into message copy belongs on the contact.** Opportunity is
  not in GHL's documented merge-field list, and the failure is silent — you get blank text
  or literal braces in a live message, with no error anywhere.
- **Check what an opportunity trigger can actually filter on before designing around it.**
  Web sources claim opportunity custom-field filters only work on constrained types
  (checkbox, radio, dropdown, date); the corpus's `opportunity_changed` page lists a
  specific set of filter rows and doesn't corroborate that framing. Read
  `corpus/workflows/30-types/triggers/opportunity_changed.md` and confirm against the
  account rather than trusting either source.
- **Leave unknowable values blank.** Never write filler like "Unknown" — blank is a fact,
  "Unknown" is a lie that reports as data.
- Restrict who can create fields. Unrestricted creation produces `Lead Source` /
  `Lead-Source` / `Source of Lead` in the same account.

## Custom values

Account-wide constants — the things that change once a year. Business details, booking
links, review links, prices, legal lines, the AI persona name.

- Descriptive names that say where the value is used; consistent prefixes to group them.
- Check the scope: a value defined at agency level when you needed location level (or vice
  versa) simply isn't available where you're referencing it.
- **The failure mode is silence.** A misspelled custom value doesn't error — it renders as
  nothing, or as literal braces, in a live client email.
- Don't create a custom value for every individual word. Meaningful chunks only.
- For repeated manual reply text, snippets are the better primitive, and snippets can
  contain custom values.

## Migration costs — why this is a design-time decision

Retrofitting custom values is cheap. Retrofitting the tag/field boundary is not: moving a
concept from tags to a custom field in an established account means rewriting every
dependent workflow, template, smart list and report. Practitioners estimate 8–16 hours;
custom-field consolidation 4–8; custom values 1–3.

Build order that avoids most of it: fields and tags first, then workflows, then smart
lists last — after the taxonomy has stabilised.

## Anti-patterns, worst first

1. **Suppression spread across several spellings.** One canonical opt-out tag, written
   alongside DND, or the filter is decorative.
2. **Tag-as-data** — `budget-1k`, `score-72`, `industry-ecommerce`. Fields update; tags
   accrete. A contact tagged `budget-1k` eighteen months ago still carries it.
3. **Date-stamped tags** — `attended-jan-2026`, `attended-feb-2026`, forever. Unbounded
   cardinality is guaranteed sprawl. If you need the date, you need a date field.
   (Probe and test tags are a fair exception, under `tmp:`.)
4. **Duplicating pipeline state in tags.** The opportunity already carries both status and
   stage. A third representation makes three sources of truth.
5. **Per-event tags with no expiry** — legitimate need, wrong lifetime. That's what the
   ephemeral namespace is for.
6. **Inline tag creation in workflow actions** — the largest sprawl vector, and no
   governance scheme addresses it.
7. **Renaming a live tag.** Historically this removed the tag from contacts and *fired
   remove-tag triggers* — one report describes it sending dozens of errant texts. Marked
   fixed in 2024, but add-migrate-retire costs minutes and has no downside.

## When something else is the right tool

- **Channel suppression** → DND, per channel. Set automatically on STOP replies, bounces
  and spam complaints.
- **Subscription preferences** → Preference Management, which auto-filters contacts out of
  conflicting campaigns regardless of how they were added — a tag can't do that, it
  requires every sender to remember to check. Caveat: enabling it is irreversible, so it's
  a deliberate per-account decision.
- **One-of-N / many-of-N attributes** → single or multi-select custom field.
- **Numbers, dates, money, scores** → typed fields. Only fields give you greater-than and
  less-than in if/else.
- **Sales progression** → pipeline stages.
- **State needed only inside one run** → the workflow's own branching and goals.
- **Preventing re-enrolment** → the workflow's re-entry setting, not a guard tag. Note it
  now defaults to *on* for new workflows, and appointment-triggered workflows allow
  re-entry regardless.
- **One-off human context** → a note. Not every fact needs to be machine-readable.

## Two things nobody has documented

Worth a ten-minute sandbox probe before relying on either:
- Whether removing a tag a contact doesn't have still fires the remove-trigger.
- Whether duplicate tags on a single contact are still possible.

There is also **no published evidence that tag count degrades GHL query performance**, and
no documented limit on tags per contact. Don't justify a cleanup on performance grounds —
justify it on correctness, because that's where the real damage is.
