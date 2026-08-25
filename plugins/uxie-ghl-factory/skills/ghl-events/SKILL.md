---
name: ghl-events
description: "Build and operate GoHighLevel Events — create ticketed or RSVP events, add tickets, add-ons, schedule sessions and speakers, configure the event page's branding and check-in, publish, and read attendees. Use when the user says 'create an event', 'set up ticketing', 'sell tickets', 'add a session or speaker', 'my event page', 'RSVP', 'attendee list', 'check people in', or names a GHL event. Internal API — the public rail has no events surface at all."
---

# GHL Events

> **Hitting a wall?** `search_endpoints` on the internal MCP covers this surface too — 620
> endpoints across every GHL product, with the typed tool that covers each one and whether a
> location token is proven to reach it. Search before concluding something is not possible.

Base: `services.leadconnectorhq.com/events-management`.

**There is no public-API events surface.** Everything below is the internal rail, so the write
gates in `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md` apply: draft first, confirm before any
write, verify by reading back on a separate request.

## Contract

Follow `${CLAUDE_PLUGIN_ROOT}/docs/specialist-contract.md` (recon → brief → intake → blueprint
→ approval → execute → verify). Recon = list the account's existing events before asking
anything.

## The five traps, all proven live

**1. The enums are lowercase.** `type` is `ticketed | rsvp` — not `TICKETED`, not `Ticketed`.
Anything else returns `422 {"message":["type must be a valid enum value"]}`. This one cannot be
guessed; it was found by being refused.

**2. `locationId` is part of the AUTH check, not just a field.** Sending the wrong one does not
return "not found" — it fails authorisation. Confirm the location before you write.

**3. Sessions and events speak different time dialects.** An **event** takes ISO 8601
(`salesStart must be a valid ISO 8601 date string`). A **session** takes a separate `day` plus
`HH:MM` strings (`day must be a string`, `startDateTime must be in HH:MM format`). Sending an
ISO timestamp to a session is a 422; sending `HH:MM` to an event is a 422.

**4. `startDate` must not be in the past**, and `productIds` must be non-empty where required.

**5. Accepted is not applied.** A `PUT /events-management/settings/{eventId}` carrying both
`branding` and `checkIn` returned **200** and did not persist both. Read the settings back on a
separate request and compare field by field — a 200 here is not evidence.

## The surface

```
POST  /events-management/event                      create
PUT   /events-management/event/{eventId}            update
POST  /events-management/event/list                 list
GET   /events-management/events/options
PATCH /events-management/event/{eventId}/publish    publish
GET   /events-management/tickets   ·  POST /events-management/tickets
GET   /events-management/add-ons/{eventId}   ·  POST /events-management/add-ons/{eventId}
GET   /events-management/schedule/{eventId}  ·  POST /events-management/schedule/{eventId}
GET   /events-management/speakers/{eventId}  ·  POST /events-management/speakers/{eventId}
GET   /events-management/settings/{eventId}  ·  PUT  /events-management/settings/{eventId}
POST  /events-management/attendees/list
GET   /events-management/attendees/metrics
DELETE /events-management/attendees/{attendeeId}
GET   /events-management/branding-palette
```

`settings/{eventId}` is where the event page lives — it carries `customCss` and `pageSections`
alongside branding and check-in.

## Public registration (the buyer's side)

A three-step flow, and the steps are bound together by a client-generated id:

```
POST /events-management/attendees/registration/prepare
POST /payments/orders/internal
POST /events-management/attendees/registration/{orderId}/complete
GET  /events-management/public/events/{eventId}/registrations/{attendeeId}/fulfillment
```

⚠️ The `fingerprint` uuid is generated **client-side** and must be the **same value** across the
prepare and complete steps. Generate it once, reuse it; a fresh uuid per call breaks the flow.

Coupons ride the payments rail: `POST /payments/coupon`, `GET /payments/coupon/list`.
⚠️ **`productIds` and `priceIds` are different filters** — a coupon scoped by one does not apply
to the other.

## Knowledge

The corpus is the source of truth and goes deeper than this page:
`knowledge/corpus/events/20-api/events-management-api.md` (the full field tables and every 422
observed) and `20-api/public-registration.md` (the buyer flow, captured end to end).

## Scope

Events only. Memberships and courses are `ghl-memberships`; they are a separate product with a
separate API despite both living under "Memberships" in the GHL nav.
