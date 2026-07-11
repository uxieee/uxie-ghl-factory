# Domain Gotchas

Small, cross-cutting GHL knowledge that trips up agents but doesn't warrant
its own specialist skill. Read the section that matches what you're touching.

## Calendars

- **Availability** is configured per calendar (hours, date ranges, buffers,
  min-notice, max-booking-window). A calendar with no hours configured, or
  one that's "business-hours-aware" but has no linked hours, doesn't error —
  it silently behaves as always-open or never-bookable, depending on the
  config path. Always check that a calendar actually has hours set before
  trusting its bookability.
- **Round Robin has two distribution modes** and picking the wrong one for
  the business is a common misconfiguration:
  - *Optimize for Availability* — routes to whoever's soonest available.
    Best for inbound where speed-to-contact matters.
  - *Equal Distribution* — rotates evenly regardless of individual
    availability. Best for deliberately balancing workload across a team,
    worse for speed-sensitive inbound (a lead can wait for the "next up"
    rep even if someone else is free right now).
- **Timezone traps:** appointment/reminder logic evaluates in different
  timezones depending on the trigger. Contact-scoped date triggers (e.g.
  Birthday Reminder) evaluate in the **contact's own timezone** — if that
  field is blank, GHL falls back to the location's default timezone, which
  silently shifts the fire time. Don't assume a location-wide timezone
  applies uniformly to contact-scoped automations.
- **No-show mechanics:** an appointment's status transitions include a
  distinct `no-show` state alongside booked/confirmed/cancelled/completed.
  The "Appointment Status" workflow trigger fires per-appointment and
  **bypasses the workflow's re-entry toggle (`allowMultiple`)** entirely —
  a contact with 5 appointments in a week re-enters that workflow 5 times
  by design, even with re-entry off. Don't flag that as a bug; do flag it
  if the downstream actions aren't written to be per-appointment-safe (e.g.
  a generic "welcome" sequence firing every time instead of a status-
  specific message).

## Forms / Surveys

- **Field mapping is by ID, not by label.** A form's fields map to contact
  custom fields (or standard fields) via internal field keys — the visible
  label on the form is cosmetic. Renaming a field's label on the form does
  not break the mapping; changing which underlying field it maps to does.
- **Triggers bind to the form/survey's ID, not its name.** Cloning or
  duplicating a form to "make a copy" produces a new ID. Any workflow
  trigger still configured against the old form silently stops firing —
  nothing alerts the builder, and the form keeps collecting submissions
  the whole time. This is one of the most common "leads vanish" causes.
- **Conditional logic** (show/hide fields based on prior answers) lives in
  the form/survey builder itself — it is UI-only, not inspectable via the
  public API's read-only `forms`/`surveys` categories (list + submissions
  only). If you need to reason about branching logic, that requires reading
  the builder UI, not the API.
- **Attribution:** submissions typically carry UTM/source metadata captured
  at submit time (referring URL, UTM params, session source). This is your
  best signal for "where did this lead actually come from" — cross-check it
  against the contact's own `source` field, which can differ if the contact
  already existed from an earlier touch.

## Custom Fields vs. Custom Values

These two objects are constantly confused, and the confusion is one of the
most common self-inflicted bugs in a GHL account:

| | Custom Field | Custom Value |
|---|---|---|
| Scope | Per-record (per contact, per opportunity, etc.) | Sub-account-wide, single value |
| Addressed by | Internal field ID / `fieldKey` (not the display name) | A generated key from its name, e.g. `custom_values.business_name` |
| Merge syntax | Field-specific token from the picker | `{{custom_values.<key>}}` |
| Typical use | "This contact's preferred appointment date" | "Our Google review link" / "Our business name" shared across every template |
| What breaks | Deleting the field silently no-ops any workflow action that wrote to it | Editing the value changes it **everywhere it's referenced, instantly** — every workflow/template/page using that token updates at once |

The action that trips people up most: **Update Custom Value** vs. **Update
Contact Field**. They look similar in a workflow builder but Update Custom
Value is a sub-account-wide broadcast rewrite, not a per-contact write. If
the value being set looks like it's about one specific contact (e.g. "this
person's appointment time"), the builder almost certainly wanted Update
Contact Field and picked the wrong action.

## Tags as State

Tags have no schema and no ID beyond their literal string — they are GHL's
lightweight, ad-hoc state mechanism. Many accounts effectively build a state
machine entirely out of tag add/remove actions and tag-based triggers/
filters (e.g. `stage:proposal-sent`, `source:facebook-ad`).

- **Tags are referenced by name, everywhere** — workflow triggers, workflow
  actions, smart-list filters, snapshot definitions. Case and whitespace are
  significant: `VIP`, `vip`, and `VIP ` (trailing space) are three different
  tags to the system.
- **There is no atomic, safe rename.** Renaming a tag (in the UI or via API)
  does not cascade to anything referencing the old string — every workflow
  trigger, filter, and smart list that pointed at the old name now silently
  matches nothing. The only safe migration pattern: create the new tag, run
  a migration pass that adds the new tag to every contact carrying the old
  one, manually update every reference, then delete the old tag. There is no
  shortcut.
- Because tags are cheap to create and never enforced against a fixed
  vocabulary, sprawl (near-duplicates from typos, casing, pluralization) is
  extremely common in accounts more than a few months old — a strong signal
  worth checking early in any unfamiliar account.

## Snapshots

A snapshot is a frozen, agency-level template of an account's *configuration
shape* — not its data. Read it as **configuration travels, data doesn't**:

- **Carries:** workflows, funnels/websites, forms, surveys, custom field and
  custom value *definitions* (values set by the snapshot author may also
  carry as literal strings), pipelines and stages, calendars (settings/
  availability, not bookings), tags (definitions only), email/SMS templates,
  products, custom menus.
- **Does not carry:** contacts, conversations, opportunities (pipeline
  *data*), appointments (the bookings themselves), users/staff accounts, any
  third-party integration credentials (Stripe, Twilio/LC Phone, Mailgun/
  SMTP, Google, Meta — all must be reconnected per sub-account), tracking
  pixels added through integrations (head/body script pixels may carry;
  integration-added ones don't).
- **Snapshots don't auto-update.** A snapshot is a point-in-time copy;
  editing the source account afterward does not propagate. Distributing a
  change requires re-capturing and re-pushing.
- **Re-pushing an updated snapshot can overwrite local edits** on
  sub-accounts that already received it — same-ID assets get overwritten by
  default, silently discarding any client-side customization made since the
  original push.
- **No clean detach.** A sub-account can't be decoupled from its originating
  snapshot; the only clean reset is deleting and recreating the sub-account.
- A very common finding: after a snapshot import, workflows/templates still
  reference the agency's own placeholder custom-value strings (e.g.
  `{{custom_values.business_name}}` literally containing the agency's name,
  not the client's) because nobody updated custom values post-import.
  Custom values (and any third-party integration) should always be verified
  immediately after any snapshot import, new or repeated.

## SaaS-Mode Basics

GHL agencies run on tiered plans; SaaS Mode (the ability to resell
sub-accounts to clients with automated billing) is gated by tier, and plan-
tier mismatches ("why can't I do X") are a recurring source of confusion:

- Lower tiers can still rebill consumption-priced services (SMS/voice/email/
  AI tokens) but generally **at cost only** — no agency markup — with the
  documented exception of a small, fixed multiplier on LC Email.
- Full markup control (arbitrary rebilling multipliers, plan/trial
  configuration, cross-sub-account rolled-up reporting) requires the top
  agency tier.
- **Wallet funding, not plan tier, is the most common cause of "SMS/AI
  suddenly stopped working."** Every tier's consumption billing depends on
  a funded wallet (a card on file for auto-reload); an empty wallet fails
  consumption-priced actions silently regardless of what plan the agency is
  on. Check wallet funding before diagnosing a billing/tier issue.
- Snapshots, white-label domain/branding, and most 2025-era permission
  features are **not** tier-gated — don't assume a feature is a plan
  limitation without checking; it may just be unconfigured.

## LeadConnector vs. GHL Naming

"LeadConnector" (often abbreviated **LC**) is GHL's own first-party
infrastructure brand, not a separate company or product:
- **LC Phone** = GHL's native Twilio-backed phone/SMS rail (as opposed to
  bringing your own Twilio account).
- **LC Email** = GHL's native email-sending rail (as opposed to bringing
  your own SMTP/Mailgun).
- The **internal API's host itself is `backend.leadconnectorhq.com`** and
  the workflow builder's iframe origin is
  `client-app-automation-workflows.leadconnectorhq.com` — "LeadConnector" in
  a URL or JWT claim is GHL's own backend, not a third party. Don't treat a
  `leadconnectorhq.com` hostname as an external integration; it's GHL.
- The public API host, by contrast, is `services.leadconnectorhq.com` — same
  brand, different (documented, supported) surface. See `api-worlds.md` for
  the full public/internal contrast.
- Older material and some UI copy still say "HighLevel" — same platform,
  same company, interchangeable with "GHL" in conversation.
