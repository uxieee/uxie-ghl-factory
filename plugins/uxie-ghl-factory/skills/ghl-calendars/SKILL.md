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
- **Stored settings the public calendar update accepts** (verified on a test calendar, each read back on a separate GET and
  restored): the booking form (form id, submit type, redirect URL, thank-you message), `autoConfirm`, guest type and the
  consent label. A changed value shows on the public widget payload (thank-you message, guest type and consent label do).
- 🔴 **A partial calendar PUT is refused on a collective calendar** (the server answers that the primary team member flag is required). Send the team
  members, form id, submit type and thank-you message from a fresh GET together with the change, then check that no
  other field moved.
- **Keys outside the public update schema** (enable guests, guest collection mode, enable consent check, show seats per
  slot, reserve-service, price id) are writable only with a raw PUT to the same calendar route; the public tool does not
  accept them. The seats-per-slot flag shows on the public payload.
- **Raw keys on the same calendar PUT** (`PUT /calendars/{calendarId}`, the whole document: send the team members and form id too, then read back on a separate GET and restore): look busy is the nested `lookBusyConfig` `{enabled, lookBusyPercentage}` (the flat `lookBusyEnabled` and `lookBusyPercentage` keys are refused 422 "should not exist"); the redirect after booking is `formSubmitType` `RedirectURL` together with `formSubmitRedirectURL` (capital R in URL), since the lower-case form is refused and the read-back key is `formSubmitRedirectUrl`; guests are `enableGuests` with `guestType` (set and restored on a TEST collective calendar). Evidence for each is cited in the knowledge calendars sniffs.

**Calendar fields a raw_request PUT /calendars/{calendarId} sets** (the route is in the plugin catalogue on both hosts; send the required keys with the change, read back on a separate GET, restore):

| Field (stored key) | What it controls | Live proof (knowledge sniff) |
|---|---|---|
| `enableOfficeHours` | the availability office-hours switch | live-f4s-b1-editor-set.json |
| `showSeatsPerSlot` | the seats-per-slot display flag on event capacity | live-cal2-stored-seats.json |
| `stripe.amount` | accept payments on a meetings calendar (a positive amount) | live-cal.payments.b.json |
| `stripe.deposit` and `stripe.depositType` | a meeting deposit as an amount or a percentage | live-cal.payments.b.json |
| `enableChargeGuests` with `enableGuests` and a `stripe` amount | charge per attendee | live-cal.payments.b.json |
| `stripe.deposit` and `stripe.depositType` (percentage) | booking deposit | live-log.jsonl |
| `preBuffer` | the pre-buffer time before a booking (Booking rules) | live-f4s-b1-editor-set.json |
| `slotBuffer` (with `slotBufferUnit`) | the post-buffer time after a booking (Booking rules) | live-log.jsonl |
| `allowBookingAfter` (with `allowBookingAfterUnit`) | how far ahead a booking may be made, in hours (allow booking after). Clearing it needs both keys sent as explicit `null`: a PUT that omits them returns 200 and leaves the value (a restore without them did not take) | live-log.jsonl |
| `teamMembers[].locationConfigurations[].kind` (the meeting location, sent in the team members of the calendar PUT) | the meeting location: `custom`, `inbound_call` (phone) or `physical` (address). `phone` and `address` are refused with 422, so send the stored kinds | live-log.jsonl |
| `allowCancellation` | whether a booker may cancel from the public page | live-cal2-bulk-d-scrubbed.json |
| `allowReschedule` | whether a booker may reschedule from the public page | live-cal2-bulk-d-scrubbed.json |
| `stickyContact` | sticky contact on the booking | live-log.jsonl |
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

**Rename a custom status** (proven live on the production services host: one rename and one restore, each read back on a separate GET): `PATCH /calendars/statuses/rename/{statusId}` with body `{locationId, status: "<new label>"}`. Only the rename route is covered here. Reorder, archive and restore are not proven, and custom statuses exist only with the Lab flag on.

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

## The booking-page view (UI only)

The booking-pages list and the View booking page tab are a rendered view. The calendar object and the public widget payload carry no page-view key, so there is no API setting to read back or set. Open it in the app at `app.gohighlevel.com/v2/location/{locationId}/settings/calendars` (the settings tab, then the booking pages list). Do not send a write for the view itself.

## Raw-route rows for calendar fields (proven by set and restore)

Each row names a catalogued route, the body shape the proof sent, and what to read back. Every set is followed by a restore to the prior value and a separate read-back. Ids are left out.

- **Editor Basic details, description:** `PUT /calendars/{calendarId}` with the whole document (teamMembers, formId, formSubmitType, formSubmitThanksMessage) and the one changed field. A partial body is refused on a collective calendar. Read back on a separate GET.
- **Editor Staff and location, custom meeting location label:** `PUT /calendars/{calendarId}` with teamMembers, the custom label changed on one team member and the rest of the member kept. Read back on a separate GET; the label goes back to the original.
- **Services create:** `POST /calendars/services` returns 201 for one service. Then `PUT /calendars/services/{serviceId}` with the full document and one changed field, read back, and the original document restored.
- **Payments, recurring meetings:** `PUT /calendars/{calendarId}` with enableRecurring and stripe.recurringAppointmentsPaymentType, set and restored to false and {}. No checkout, no provider call.
- **Payments, coupon on the payment page:** `PUT /calendars/{calendarId}` with stripe.isCouponEnabled, set and restored.
- **Service setup, reserve service:** `PUT /calendars/{calendarId}` with reserveService, set and restored. The price id and the wizard step are not sent.
- **Class seats per class:** `PUT /calendars/{calendarId}` with appointmentPerSlot. The key is proven on a class calendar; the UI label "Seats per class" is not yet confirmed to save to it.
- **Round robin event type and distribution:** `PUT /calendars/{calendarId}` with eventType, set between `RoundRobin_OptimizeForAvailability` and `RoundRobin_OptimizeForEqualDistribution` and restored to the prior value; read back on a separate GET. The calendar type is set at create and read back.
- **Round robin staff priority:** `PUT /calendars/{calendarId}` with the whole teamMembers array, one member's priority changed (1 to 0.5) and the rest of the array unchanged. Read back on a separate GET; the array is restored to the exact prior value.
- **Round robin max bookings per slot per user:** `PUT /calendars/{calendarId}` with appoinmentPerSlot (2) on the round-robin calendar. Read back on a separate GET; restored to absent, which reads back absent.
- **Booking date range:** `PUT /calendars/{calendarId}` with allowBookingFor (60) and allowBookingForUnit (days), set and read back on a separate GET; restored with both keys null, which GHL drops, so the keys read back absent. Effect check: free-slots beyond day 60 go to zero after the set.
- **Calendar groups:** `POST /calendars/groups` creates a group (201). `PUT /calendars/groups/{groupId}` with name and slug only (a body that carries locationId is refused 422) renames it, read back on a separate GET, then restored. `PUT /calendars/groups/{groupId}/status` with isActive set false, read back, then restored to true.
- **Activity log (audit feed):** `GET /audit/search/v2` (services host; query page, pageSize, startAt, endAt, locationId). After a calendar PUT, the newest entries show a calendar UPDATED entry naming the changed field. The feed does not record every PUT, so the restore may not appear in it; read the calendar object to confirm the restore.
- **User default meeting location:** `PUT /users/{userId}` with locationWiseMeetingLocation for the location. Restored to null; the prior absence of the location key is not reproduced.
- **Account language and week start:** `PUT /locations/{locationId}` with appStartDayOfWeek and the language, set and restored.
- **Booking page, client portal booking:** `PUT /calendars/{calendarId}` with the stored key enableClientPortalBooking (false, then true, then restored), read back on a separate GET. The other keys on the booking-page screen are page copy and are not stored settings.
- **Calendar view, view mode and week:** UI only. The view is kept in the browser (a local key, set and read back after a reload), and no server route stores it. There is no raw route to name, so the calendar setup and this view are a UI step.
- **Module gate (read only):** `GET /calendars/configuration/location/{locationId}` returns subAccountConfig modules. No sub-account write route is captured, so the modules are read, not set.
- **Recurring meeting settings (the recurring object):** `PUT /calendars/{calendarId}` with the whole document, enableRecurring true and `recurring` set to the object (freq, interval, count, weekDays, bookingOption, bookingOverlapDefaultStatus). Each sub-field is set and read back on a separate GET. The restore sets `recurring` back to its prior value; a recurring object that was absent before reads back as an empty object after the restore. Proven live 2026-11-11 on a TEST class calendar.
- **Collective owner:** `PUT /calendars/{calendarId}` with the whole teamMembers array. The owner flag moves to a second team member, read back on a separate GET, then the exact prior team is restored. The second member must already exist in the location; the availability change on that member is left as residue. Proven live 2026-11-11 on a TEST collective calendar.
- **Collective video, custom link:** `PUT /calendars/{calendarId}` with teamMembers, the owner member's locationConfigurations[0] set to a custom link (kind custom), read back on a separate GET, then the prior team restored. Proven live 2026-11-11 on the same TEST collective calendar. The integration kinds (Zoom, Google Meet, Microsoft Teams, LC meet) are not tested here: they need connected outside accounts.
- **Event notifications (WhatsApp, SMS and email rows):** `PUT /calendars/event-notifications/bulk-update` with a one-element array holding the row as read from `GET /calendars/event-notifications/list`, with one field changed (the body text, the additional phone, the subject or the additional email IDs). Read back on a separate list GET, then the prior row is sent the same way. Proven live 2026-11-10 on a TEST calendar. Do not create a row to test: the create path can revive a deleted row. A recipient-name list on a contact-type row is not stored by this write; the write is accepted and dropped.
- **Slot duration and interval:** `PUT /calendars/{calendarId}` with the whole document and slotDuration and slotInterval changed in one PUT (30 to 45 and 30 to 15), read back on a separate GET, then both restored. Proven live 2026-11-11 on a TEST class calendar.
- **Event share link (slug):** `PUT /calendars/{calendarId}` with the whole document and slug set to a probe value, read back on a separate GET, then the original slug restored and read back equal. Proven live 2026-11-09 on a TEST calendar.
- **Rooms and equipment:** `POST /calendars/resources/{type}`, with type `rooms` (name, capacity, locationId) or `equipments` (name, quantity, locationId). A create returns 201 and the new item reads back on a separate GET. Proven live 2026-11-09 on the sandbox with a TEST-CONF name. The TEST item is left in place; no delete route is in the catalogue for it.

### UI-only units (no raw route to name)

These units are a rendered view, a browser-side setting, or a page the calendar object does not store. Use the app for them; do not send a write for them.

- **Calendar list: service calendars (v1), calendar troubleshoot, calendar export, manage view, timezone release:** no catalogued write route was found for a stored value. The app is the only path named here.
- **Appointment list view and settings modal:** the saved view and timezone keys go through a user-settings features route that is not in the catalogue. Read it in the app; no raw route is named.
- **Booking page view:** blocked on the booking-page view; see the booking-page view section above.

## Side effects to tell the operator about

A booking on a calendar whose user has Google/Outlook connected is written to that external calendar. A calendar create
rewrites the assignee's default schedule. Enabling Services creates staff records, products and staff e-mails.
