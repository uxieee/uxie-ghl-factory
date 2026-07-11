# GHL Object Model

> What exists in a GoHighLevel (GHL) account and how the pieces relate. Read
> this when you're not sure what a term refers to, or what breaks when an ID
> changes.

## The hierarchy

```
Agency (company)
  └── Sub-account (a.k.a. "Location" — locationId is the object's real ID)
        ├── Contacts
        ├── Pipelines → Opportunities
        ├── Workflows
        ├── Funnels/Websites → Pages
        ├── Calendars → Appointments
        ├── Forms / Surveys → Submissions
        ├── Custom Fields (schema) / Custom Values (variables)
        ├── Tags
        └── Conversations
```

An **agency** is the top-level account an agency owner (or a GHL reseller)
logs into. It owns one or more **sub-accounts**. In the API and most GHL UI
copy, a sub-account is called a **Location** and identified by `locationId` —
this is the single most important ID in the platform: almost every write
targets a specific `locationId`, and almost every cross-sub-account bug
traces back to an action running against the wrong one. The agency itself
has a `companyId` (CID); you will not usually operate at that scope except
for agency-level settings (SaaS mode, snapshots, users).

Everything below "Sub-account" in the diagram lives **inside one
`locationId`** and does not automatically exist anywhere else. Cloning or
templating between sub-accounts happens only via snapshots (see
`domain-gotchas.md`) or manual re-creation — there is no live sync.

## Contacts

The CRM record: a person plus their fields, tags, notes, tasks, and
conversation history. `contactId` is stable for the life of the record.
Contacts are **per-location** — the same phone number/email creates
independent contact records in different sub-accounts (no cross-account
contact identity).

**What commonly goes wrong:** duplicate contacts from multiple intake
channels (form + Facebook lead ad + manual entry) that never get merged;
custom-field values assumed to carry when a contact is exported/imported
manually (they don't unless the target field with the same key exists).

## Pipelines / Opportunities

A **pipeline** is a named sequence of **stages** (e.g. New → Contacted →
Qualified → Won/Lost) representing a sales or fulfillment process. An
**opportunity** is one deal/lead moving through a pipeline, sitting in
exactly one stage at a time, with a `pipelineId` + `pipelineStageId`, a
`status` (`open` / `won` / `lost` / `abandoned`), and a monetary value.

**ID role:** `pipelineId` and `stageId` are what workflow triggers (e.g.
"Pipeline Stage Changed") filter on — a trigger scoped to the wrong pipeline
or with no stage filter fires far more broadly than the builder intended.

**What commonly goes wrong:** stages left at GHL's generic defaults instead
of reflecting the real sales motion; opportunities piling up in one stage
with no automation on stage change; `lostReason` left empty on lost deals
because nothing enforces it; stale opportunities (no activity for weeks)
skewing pipeline reports because the "Stale Opportunities" trigger was never
configured. Pipelines and stages are now fully CRUD-able via the public v3
API (see `api-worlds.md`) — this used to be a read-only gap; it isn't
anymore.

## Workflows

GHL's automation engine: a **trigger** (the entry condition) feeding a
sequence of **actions** and branching logic (If/Else, Split, Wait, Goal
Event, Go To). Each workflow has a `workflowId`; each contact that enters is
an **enrollment**, and a workflow's `allowMultiple` setting controls whether
the same contact can re-enter while already enrolled (off by default; some
triggers like Appointment Status and Invoice bypass this setting entirely
and always re-run per event).

**What commonly goes wrong:** an If/Else branch with no "else" leg silently
strands contacts at that node; a Go To / Send to Workflow pointing at a
workflow that's since been deleted or renamed no-ops with no alert; multiple
workflows independently triggering on the same tag/event send duplicate
messages to the same contact on the same day. Workflow triggers/actions
reference tags **by name** and custom fields **by internal ID** — a tag
rename silently breaks every reference; a deleted custom field silently
no-ops the action that wrote to it.

## Funnels / Pages ("Websites")

A **funnel** is a named sequence of **pages** (a.k.a. steps) — e.g. a
landing page → order form → thank-you page. Standalone multi-page sites are
called **Websites** in newer GHL UI copy but share the same underlying page
model. Each funnel has a `funnelId`; each page a `pageId`, with its own
tracking-code and SEO settings.

**What commonly goes wrong:** tracking pixels (Facebook, GA4, Google Ads)
never installed on funnels running paid traffic — especially after a
snapshot import, since pixels don't carry (see `domain-gotchas.md`); a
funnel cloned or duplicated gets a new `funnelId`, breaking anything that
referenced the old one by ID.

## Calendars

A calendar defines bookable availability and produces **appointments**.
Types include Personal (one user), Round Robin (rotates across a team), and
Service/Group calendars. See `domain-gotchas.md` for availability,
round-robin-mode, timezone, and no-show detail — this section is just the
object shape: `calendarId` for the calendar, and each booking is an
**appointment** with its own status (booked / confirmed / cancelled /
no-show / completed).

**What commonly goes wrong:** a calendar with no linked hours/availability
silently behaves as always-open or never-bookable depending on config;
external calendar sync (Google/Outlook) left unconnected causes double-
bookings that GHL never sees.

## Forms / Surveys

**Forms** collect structured field submissions (lead capture, applications);
**Surveys** are typically multi-step/branching questionnaires. Both produce
**submissions** tied to a specific `formId`/`surveyId` — not to the form's
*name*.

**What commonly goes wrong:** cloning a form/survey produces a new ID; any
workflow trigger ("Form Submitted") still pointing at the old ID silently
stops firing even though the form still collects submissions. A form with
active submissions but no downstream workflow is one of the most common
"leads vanish into the void" findings.

## Custom Fields vs. Custom Values

These are **frequently confused** and behave very differently — see
`domain-gotchas.md` for the full contrast. In object-model terms: a
**custom field** is a per-record schema extension (on Contact, Opportunity,
etc.) — every contact has its own value (or none) for that field, addressed
internally by `fieldKey`/field ID, not display name. A **custom value** is a
single sub-account-wide variable (like a template variable) — one value,
shared by every workflow/template/page that references it.

## Tags

A tag is a plain string label attached to a contact — no schema, no ID of
its own beyond its name. Tags are the platform's lightweight state
mechanism: workflows both filter on tags and add/remove them, often as the
entire "state machine" driving a contact's journey (see `domain-gotchas.md`
→ tags-as-state).

**What commonly goes wrong:** tags are referenced **by name only** — case
and whitespace matter (`VIP` ≠ `vip` ≠ `VIP `) — so a rename breaks every
workflow/filter/smart-list that referenced the old name, with no cascade and
no atomic-rename API. Tag sprawl (near-duplicate tags from typos/casing) is
one of the most common hygiene findings in older accounts.

## Conversations

The unified inbox: every inbound/outbound message across SMS, email, Facebook
Messenger, Instagram DM, WhatsApp, Google Business Messages, and live chat,
threaded per contact. A conversation is not the same object as a workflow
action — actions like "Send Email"/"Send SMS" write into a contact's
conversation thread, and inbound replies on *any* connected channel can fire
a single "Customer Replied" trigger regardless of channel.

**What commonly goes wrong:** a workflow assuming "Customer Replied" means
"SMS reply" when it actually fires on any channel, so email-oriented logic
runs against a Facebook comment reply; email open/click triggers relying on
tracking pixels/link rewrites that privacy tools (Apple Mail Privacy
Protection, corporate proxies) silently block, making "opened" signals
directionally useful at best.
