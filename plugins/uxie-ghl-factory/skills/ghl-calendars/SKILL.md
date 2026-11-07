---
name: ghl-calendars
description: "GoHighLevel calendars, appointments, Services and Rentals — the three booking modules, appointment statuses (custom statuses, statusId/state), recurring appointments, booking notifications, staff and availability. Use when the user says 'set up a calendar', 'book an appointment', 'service appointment', 'sell a service with add-on products', 'rental listing', 'deposit / partial payment', 'custom appointment status', 'recurring appointment', 'why is no slot bookable', 'my booking widget shows no times', 'the confirmation email didn't/did go out', or asks why an appointment workflow does not fire for a service booking. Classic calendars and appointments are on the PUBLIC rail; Services, Rentals, statuses and the module switch are internal."
---

# GHL Calendars

Corpus: `knowledge/corpus/calendars/` — start at `00-overview/index.md`; the 2026-10 wave is
`70-research/2026-10-30-calendars-wave.md`. The write gates in `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md`
apply to every write below: preview, confirm, read back on a separate request.

## First: which product is the user talking about?

Since 2026-09 Calendars is three modules, switched per sub-account in `subAccountConfig.modules`
(default `["meetings"]`):

| Module | Books | Object | Rail |
|---|---|---|---|
| `meetings` | classic calendars: personal, round robin, class, collective, event, and the v1 **Service menu** type (`service_booking`, now labelled "Service calendars (v1)") | a calendar | **public** (`calendars-v3__*`) |
| `services` | a **service**: duration, price, staff, a catalog product, retail add-on products, an attached form | a service (`industryType: "service"`) | internal |
| `rentals` | a **listing** by day/time with fees, add-ons, deposits, partial payments | a service (`industryType: "rental"`) | internal |

🔴 **"Service calendar" is ambiguous.** A v1 `service_booking` calendar is a meetings calendar; the Services product
is a different object on a different route family. Ask, or read the module config, before building either. Never
build a classic Service-menu calendar when the user wants the 2026 Services product, or the reverse.

**Read the module config first** (raw_request, backend host):
`GET /calendars/configuration/location/{locationId}` → `{subAccountConfig: {modules, isRentalsEnabled},
isMigrationCompleted}`. If `services` or `rentals` is missing, those screens and routes do not exist on that account.
Turning a module on is an **account-level change the operator makes** (agency view → Sub-accounts → Setup Calendars)
— do not do it yourself. If they ask you to: it is a PUT of the same path; 🔴 **services appears asynchronously** —
the PUT echoes it, an immediate re-read lacks it, it lands ~30 s later with `isMigrationCompleted: true`. And the
migration has side effects: it copies every v1 service calendar into a Service plus a product (originals untouched),
creates a staff record for every user, and turns on staff e-mails for every booking (below).

## Classic calendars and appointments — public rail

`search_actions` → `calendars-v3__create-calendar`, `calendars-v3__update-calendar`, `calendars-v3__get-calendar-events`,
`calendars-v3__create-appointment`, `calendars-v3__edit-appointment`, the event-calendar schedule ops. Traps:

- 🔴 **The calendar PUT replaces.** A body naming only slot fields reset `openHours` to `{}`; the calendar then still
  read active and rendered its widget while offering **no slots**. GET the calendar, change the whole document, send it
  back, then check a field you did NOT send (corpus `40-rules/calendar-put-replaces-it-does-not-merge.md`).
- 🔴 **`startTime`/`endTime` on the events read are epoch MILLISECONDS.** An ISO string answers 200 with no events — a
  booked day looks free.
- 🔴 **`toNotify: false` is not silent.** The calendar's notification settings decide; a confirmation went out with it.
  To stop e-mails, change the calendar's notifications, not the flag.
- **Read status by `appoinmentStatus ?? appointmentStatus`** (GHL's typo; the contact route carries only the typo), and
  never by `isCancelled` — it read `false` on a cancelled appointment.
- `autoConfirm` decides the status an appointment is BORN with; a `status == new` trigger never sees an auto-confirmed
  booking.
- Creating a calendar in the UI also rewrites the assignee's default availability schedule with `calendarIds:
  [<new id>]` only. Whether that unbinds an earlier calendar is untested — read the schedule after.

## Appointment statuses (2026-10)

Every appointment now carries **`statusId`** (an id from its module's status set) and **`state`** (`pending`,
`active`, `completed`, `noshow`, `cancelled`, `invalid`), beside the old string. With the Lab
`calendars.customStatuses` (🔴 **irreversible** — never flip it without the operator's explicit yes) the operator can add
statuses under each state (Settings → Calendars → Preferences → Appointment status; `GET/POST
/calendars/statuses/{module}[/{state}]` on the services host). 🔴 **Status ids are per module** (`meeting`, `service`): a
"Confirmed" id from meetings does not match a service booking. What the old `appointmentStatus` string reads after an
appointment is set to a *custom* status is **unproven** — do not promise a workflow filter on the old strings will
catch custom statuses.

## Recurring appointments

The in-app Custom → Recurring create adds `isCustomRecurring: true` and an RFC 5545 `rrule`; each occurrence's id is
`<masterId>_<epochMs>_<durationSec>`. A series sends ONE confirmation with the recurrence text in the date. Changing
one occurrence takes `recurringEventUpdateType` (`this_event` proven). 🔴 **Cancelling one occurrence detaches it into
a NEW appointment** (new id, its own status) and the contact's activity logs "New appointment created" — expect
appointment-created automations to see it.

## Services (internal, services host unless noted)

- **Create a service**: `POST /calendars/services` — a catalog product is created with it; a new service has no
  `calendarId`. The service PUT is **whole-document** (like the calendar PUT).
- **Book one**: the proven path is the app's own **multipart** `POST /calendars/bookings/create` (backend host) with
  parts `bookingData`, `formId`, `formData`. The public rail also lists `calendars-v3__create-service-booking` — never
  executed here; prefer it only after proving it on a test account.
  - custom price per appointment: `selectedSlotInfo.services[].custom.price` + `orderDetails.products[].overridePrice`.
    🔴 A **negative** price saves as **$0** — validate before sending.
  - retail products: `retailProducts[]` + `orderDetails.products[]` with `skipPriceLookup`; stock is decremented, the
    catalog price is not changed.
  - 🔴 `paymentMeta.paymentStatus` reads `"completed"` even with `processPayment: false` — do not report it as paid.
- 🔴 **A service appointment's `calendarId` is the SERVICE id** (`serviceId`) and its `groupId` the service category.
  A workflow trigger filtered to a calendar, or any pre-flight keyed on a calendar id, **misses every service
  booking**. Filter on the service id, or not by calendar at all.
- **Staff**: `/calendars/service-users`. Assigning a role badge (`/calendars/calendar-badges`, label ≤ 30 chars) from
  the staff editor also writes a default availability onto the staff record — read it back.
- 🔴 **Notifications**: enabling Services stores defaults that e-mail the **contact AND the assigned staff member** on
  booked and confirmation. Ask before leaving staff e-mails on. Toggle with `PUT /calendars/event-notifications/bulk-update`
  `{_id, isActive, altId: <locationId>, altType: "location"}` (the UI's body, on the services host); a bare `{_id, isActive}` sent to the backend host answered **500** — send the UI's body.

## Rentals (internal, services host)

A listing is `POST /calendars/services` with `industryType: "rental"`, `bookingUnit`, `pricingRule`. Fees are
`/calendars/service-entities` (`entityType: "additionalFee"`, flat or percentage); add-ons are
`/calendars/service-addons`. 🔴 The same idea is spelled `perBookingUnit` on fees and `per_booking` on add-ons. Attaching a
fee is a whole-document listing PUT (`serviceEntities[]`). Partial payments, deposits and the self-serve cancellation
window are Global settings; a rental booking needs a connected payment provider and has **not** been executed here.

## Notifications (meetings)

Turning a calendar's e-mail channel on **auto-saves with every receiver active** (contact, assigned user, extra
e-mails) until each is unticked; send the receiver set in one write if scripting it. The defaults are stored as literal
text in the business's language at the moment of enabling and are not re-translated later.

## "Why is this slot not bookable?"

The calendar setup assistant's Troubleshoot mode reads the troubleshoot-free-slots grid: per slot `status` and
`conflicts` (`past`, `duration` with `blockingEventIds`, `blocked_slot`). Only in-hours slots exist in it, so "why not
7 AM" outside working hours gets no clean answer — check the availability schedule and `openHours` first. The
assistant's troubleshoot state sticks across turns: start a new chat per question.

## Side effects to tell the operator about

A booking on a calendar whose user has Google/Outlook connected is written to that external calendar. A calendar create
rewrites the assignee's default schedule. Enabling Services creates staff records, products and staff e-mails.
