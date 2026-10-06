# Native GHL Events: sandbox recon findings (2026-10-06)

Field notes from a full reverse-engineering pass on native **Events** (Memberships → Events, Labs Beta, events web app
build **2661**), run with `uxie-ghl-internal-mcp` and the `ghl-reverse-engineering` skill against a **dedicated test
sub-account**. No client account was called. Contacts were `@example.com`; payments were in event test mode.

This is a research note for the maintainer, not a corpus page. It is written so it can be folded into
`knowledge/corpus/events/` and the endpoint overlay, and it lists the corrections it implies for `skills/ghl-events`.

**Status labels.**
- **PROVEN:** executed with the MCP's own Bearer token and read back on a separate request.
- **UI-CAPTURED:** seen on the wire when the UI did it, with a 2xx, but not executed by our token.
- **IMPOSSIBLE:** with the evidence stated.
- **NOT DEPLOYED:** in the bundle, but the server answers framework `404 Cannot GET/POST`.

Raw captures and per-proof request/response files exist on our side (redacted); they can be shared on request.

---

## 1. Corrections to `skills/ghl-events/SKILL.md`

| Skill says | Observed | Evidence |
|---|---|---|
| `Base: services.leadconnectorhq.com/events-management` | The web UI calls **`backend.leadconnectorhq.com/events-management/*`** for every route. A plain MCP Bearer (no `token-id`) reached every route tested on backend. `services` also answers some (e.g. `events/options`) | All UI captures; every MCP proof |
| "Creating or removing a registration as an admin is still unlocated; cleanup only through the UI" | **Located.** Admin add = prepare → `payments/orders/internal` → complete with `createdBy` (+ `record-manual-payment` for cash). RSVP admin add = POST `/events-management/attendees`. Cancel, refund, single and **bulk DELETE** all exist (§4) | PROVEN |
| "Public registration (the buyer's side)": prepare → `orders/internal` → complete | That chain is the **admin** flow (order `origin: crm_events_admin`). The real public flow is POST `/events-management/public/events/{eventId}/contact` → POST `/payments/orders` → POST `/events-management/public/events/{eventId}/orders/{orderId}/complete`, and **both public writes carry a reCAPTCHA Enterprise token** (`captchaToken`, `enterpriseCaptchaToken`) | UI-CAPTURED |
| Trap 4: "`startDate` must not be in the past" | **A new event with past `dates[]` was created (201) and published**, showing `eventState:"past"`. Admin adds and check-ins on it work. The original 422 may come from ticket `salesStart` or an older build. Worth re-checking | PROVEN |
| Trap 5: settings PUT "did not persist both" | Refined: PUT `/settings/{id}` **merges per top-level section**, so send whole sections. Two fields are **accepted but not applied**: `privacy` and `registration.guest.collectInfo:false` (stays `true`). Also, **GET `/settings/{id}` bumps `updatedAt`** (a read with a write side effect) | PROVEN |

---

## 2. Events

| Operation | Call | Status | Notes |
|---|---|---|---|
| Create | POST `/events-management/event` | UI-CAPTURED (ticketed), PROVEN (RSVP) | A ticketed event **auto-creates a payments product** (`productId`); RSVP doesn't. **`dateMode` accepts only `"single"`**: `recurring`, `tbd` and `multiple` return 422 on create and update, although the bundle names them. Several days = several `dates[]` entries under `single` |
| Update | PUT `/events-management/event/{eventId}` | PROVEN | **Merges partial bodies.** Live/test = `{liveMode, requireCreditCard}`. Changing dates after tickets are issued keeps every QR valid |
| Publish | PATCH `/events-management/event/{eventId}/publish?locationId=` (no body) | PROVEN | Admin "Add Attendee" is disabled until published |
| Unpublish | — | IMPOSSIBLE | No route in the bundle client, no UI control. Archive is the nearest |
| Archive | PATCH `/events-management/event/{eventId}/archive?locationId=` | PROVEN | Not in the UI. Listed under `status:["archived"]` |
| Delete | DELETE `/events-management/event/{eventId}?locationId=` | PROVEN | Soft; GET then 404s. Whether the auto-product is removed: unverified |
| Duplicate | POST `/events-management/event/{eventId}/duplicate` `{name, targetType?, locationId}` | PROVEN | Returns a draft with **no tickets or sessions**. The only way to change `type` |
| Copy components | POST `/events-management/event/{eventId}/copy-asset` `{sourceEventId, components[], locationId}` | PROVEN | `components` enum: speakers, tickets, addons, schedule, faq, styling, checkout, copy, colors, fonts, layout, customCss, sponsors, advertisements, attendeeApp, exhibitors, notifications |
| List | POST `/events-management/event/list` `{skip, limit, status[], sort?, endDateBefore?, locationId}` | PROVEN | 201 for a read |
| Capabilities | GET `/events-management/capabilities` | PROVEN | `eventsClientPortal.available:false` on the test account |

## 3. Tickets, add-ons, coupons

| Operation | Call | Status | Notes |
|---|---|---|---|
| Create tier | POST `/events-management/tickets` | UI-CAPTURED | Free = `price:0`. Each tier = a **price** (`priceId`) on the event product. No virtual / no-QR tier type exists |
| Update tier | PUT `/events-management/tickets/{ticketId}` | PROVEN | Whole object, no `eventId`. **`prepare` holds a seat**: abandoned prepares consume inventory |
| Pause / resume / reorder / delete | PATCH `/events-management/tickets/{ticketId}/pause` · `/resume` · PATCH `/events-management/tickets/reorder` · DELETE `/events-management/tickets/{ticketId}` | PROVEN | Pause also hides the tier. Delete is soft |
| Add-ons | POST/PUT/DELETE/GET `/events-management/add-ons/{eventId}[/{addOnId}]` | PROVEN | `ticketIds` on PUT is **silently dropped**. `prepare` ignores add-ons. No add-on QR is ever issued (`addon-qr` exists only as a method label in the bundle) |
| Coupon | POST `/payments/coupon` | UI-CAPTURED + read-back | **Fixed amount is allowed** (`discountType:"amount"`) as well as percentage. Scoped by tier **priceIds** |

## 4. Registration, cancel, refund, delete

| Operation | Call | Status | Notes |
|---|---|---|---|
| Admin add (ticketed) | POST `/events-management/attendees/registration/prepare` → POST `/payments/orders/internal` → POST `/events-management/attendees/registration/{orderId}/complete?eventId=&locationId=` | PROVEN | Contact created at prepare. `fingerprint` reused across steps. Complete is async (`processing`, retry ~3 s). Paid cash: `completeOrder:true` + POST `/payments/orders/{orderId}/record-manual-payment` `{mode:"cash", amount, notes≥10}`, then complete with `&transactionId=` |
| Guests / multi-seat | prepare `guests[]`, order `multiAttendee:true` | PROVEN | One attendee and one QR per seat. ⚠️ **A guest sharing the buyer's email gets no contact, its seat lands on the buyer, and the buyer contact's name is overwritten with the guest's.** `allowGuestList:false` returns 400 |
| RSVP admin add | POST `/events-management/attendees` `{eventId, checkoutType:"default", answers:[], firstName, lastName, email, locationId}` | PROVEN | Creates the contact; QR ~4 s later |
| Bare add (existing contact) | POST `/events-management/attendees` `{eventId, contactId, locationId}` | PROVEN | `source:"manual"`, **no QR ever**. RSVP: check-in allowed. Ticketed: `paymentStatus:"pending"`, check-in refused `PAYMENT_STATUS_NOT_ALLOWED` |
| One per contact | settings `registration.singleRegistrationPerContact:true` | PROVEN | Duplicates return 409 "Contact is already registered" |
| Capacity | `event.registrations.capacity` and `settings.registration.capacity` | PROVEN | Enforced on admin add ("Event is at capacity"). **Writing the settings capacity overwrites the event capacity** |
| Cancel | POST `/events-management/attendees/registration/cancel` `{orderId \| attendeeId (RSVP), reason?, eventId, locationId}` | PROVEN | Response always reports **`qrRevokeFailures:1`** and the QR image is still served, though check-in is refused (`ATTENDEE_CANCELLED`) |
| Refund | POST `/events-management/attendees/registration/refund` `{orderId, amount, tickets[], notes?, eventId, locationId}` | PROVEN (cash orders) | Partial → `partially-refunded`, full → `refunded`. **`registrationStatus` stays `succeeded`**, and `refunded` is in the default `checkInPaymentStatuses`, so **a fully refunded attendee can still check in** unless that setting changes |
| Edit / visibility | PUT `/events-management/attendees/{attendeeId}` · PATCH `/events-management/attendees/visibility` | PROVEN | Hidden attendees still appear in the admin list |
| Delete | DELETE `/events-management/attendees/{attendeeId}` · DELETE `/events-management/attendees?attendeeIds=a,b` | PROVEN | Soft; GET then 404s; seats released. **No trigger fires** |
| Resend | POST `/events-management/attendees/{attendeeId}/resend-confirmation` `{channels[]}` | UI-CAPTURED | Sends a real message |
| Card payments | — | IMPOSSIBLE on the test account | No card provider was connected. Event test mode (`liveMode:false`) only selects a provider's test keys; there is no account-level test gateway. Untested, not disproven |

## 5. Check-in

| Operation | Call | Status | Notes |
|---|---|---|---|
| **QR scan** | POST `/events-management/check-in/qr` `{scannedValue, eventId, locationId}` | PROVEN | This is the route behind scanning; no phone needed. QR payload = `v1.<attendeeId>.<43-char signature>` (decoded from `qrLink` SVGs). Verdicts: admitted · `alreadyCheckedIn` · `WRONG_EVENT` 409 · `ATTENDEE_CANCELLED` 409 · `INVALID_QR_PAYLOAD` 400 (tampered signature) · `PAYMENT_STATUS_NOT_ALLOWED` 400 (status not in `checkInPaymentStatuses`; differential proven both ways). **No date window: a scan 3 days before the event start was admitted** |
| Manual | POST `/events-management/check-in/manual` `{eventId, attendeeIds[], checkedInBy, locationId}` | PROVEN | Batch `results[]` with the same codes. No date window |
| Legacy single | PATCH `/events-management/attendees/{attendeeId}/check-in?locationId=` | PROVEN | Writes **no `checkInMethod`**, and `checked_in_by.*` merge tags render empty |
| **Undo** | PUT `/events-management/attendees/{attendeeId}` `{checkInStatus:"not-checked-in"}` | PROVEN | No dedicated route and no UI. Reverts status, metrics and the feed row. A re-check-in gets a **new** `checkedInAt` (the first is lost) and **does not re-fire `event_check_in`**. PUT `checkInStatus:"checked-in"` sets the status with **no `checkedInAt`** but does fire the trigger |
| Per-day check-in | — | IMPOSSIBLE | One `checkedInAt` per attendee. On an event with 3 separate `dates[]`, a second check-in (manual or QR, with `date` / `dateIndex` / `dayIndex` / `occurrenceId` / `checkInDate`) returns `alreadyCheckedIn`. Sessions have no check-in. **Workaround: one event per day** |
| Web pass scanner | `check-in/scan/{code}`, `check-in/redeem`, `check-in/override`, `check-in/manual-lookup` | NOT DEPLOYED | Full scanner UI in the bundle (rejection reasons `eventNotStarted`, `eventEnded`, `fullyRedeemed`, `refunded`, `voided`, `wrongEvent`; methods qr, addon-qr, manual, walkin, override), but every route 404s on both hosts. Worth re-probing at GA |
| Feed / staff / metrics | GET `/events-management/check-in/feed` · `/check-in/staff` · `/check-in/metrics` | UI-CAPTURED | Staff includes `walkinCount`. Metrics are per hour, not per date |
| Backdating | — | IMPOSSIBLE | `checkedInAt` and `createdAt` ignore any supplied value, so historical imports land with the import time |

## 6. Reads

- **Roster:** POST `/events-management/attendees/list` (PROVEN). `filters{registrationStatus, paymentStatus}`; `meta{contacts, tickets, orders}`.
- **Export:** GET `/events-management/attendees/export` (PROVEN) returns CSV of **ids only** (contactId, ticketId, statuses, checkedInAt, createdAt).
- **Metrics:** GET `/events-management/attendees/metrics` (PROVEN). 9 keys; revenue is **net**; `checkedIn` keeps counting cancelled attendees.
- **Contact filter:** the smart-list "Event information" group sends **separate** nested `event_registrations` clauses (event, check-in status) to `services` `contacts/search/2`. Cancelled registrations match unless filtered. Cross-event matching across clauses is possible in principle (untested).

## 7. Workflow triggers (payloads read from execution logs)

Method: dump workflows ended in a webhook step aimed at a `.invalid` host, so nothing left GHL. The raw trigger payload is the
`added_to_workflow` row's `meta.extraMeta`; rendered merge tags come from the logged webhook URL.

- **No Events actions exist.** The Events Management app has two triggers and no actions; 8 action-picker searches found nothing that registers a contact.
- **`event_registration` fires 3× per ticketed sign-up:** `pending` (at prepare, before any order, including abandoned checkouts) → `processing` → `succeeded`. RSVP goes `processing` → `succeeded`. Workflows that should act once **must filter on `succeeded`**. `registrationStatus` is a single-select required filter.
- **Build gotcha:** marketplace-trigger select filters need `operator: "=="`, or the validator refuses ("Invalid value for the 'In Event' filter").
- **`bookedBy`:** `{type:"user", id}` for admin adds; `{type:"customer"}` for public sign-ups.
- **Guests:** one enrolment per attendee (`attendeeType:"guest"`, own QR), but `{{event.ticket.count}}` is order-level. The same-email guest seat never reaches `succeeded`.
- **Cancel** fires `cancelled` (keeps check-in data; `ticket.names/ids` render empty). **Refunds and deletes fire no `event_registration`.**
- **`event_check_in`:** manual sends `method:"manual"`, QR sends `"qr"`, PATCH sends **no method**. Undo + re-check-in doesn't re-fire.
- **`payment_received` fires on every Events order, including £0.** Payload: `source:"events_management"`, `globalProductIds` = the event product, `globalProductPriceIds` = the tier, `couponCode`, `eventsManagement{id, name}`. `{{event.*}}` render empty in this trigger.
- **`order_submission`** fires only for orders created already settled. It did not fire for admin paid orders settled via `record-manual-payment`. Its payload misspells **`ineItemGlobalPriceIds`**.
- **Marketplace `refund` trigger fires on Events refunds** (partial and full). Payload: refund id, amount, `transaction{id, status, entitySourceType:"events_management"}`. No event or attendee id, so join on the attendee's `transactionId`.
- `coupon_code_redeemed` did not fire for an admin coupon order paid in cash.
- **Latency:** ~1–3 s from state change to enrolment, plus ~1.5 s per step.

## 8. Server access (no browser)

- **No Events scope** exists in the Private Integration picker (164 scopes) or the platform OAuth scope catalogue (`/oauth/static/scopes`, 175). With a PIT, every `/events-management` route returns **401 "The token is not authorized for this scope."**, and public `/contacts/search` rejects the `event_registrations` filter (400).
- **A PIT can read Events money:** `/payments/orders` (`sourceType:"events_management"`, `sourceId` = eventId, `sourceMeta.guests[]` per seat) and `/payments/transactions` (`entitySourceType:"events_management"`).
- **The internal token can be held server-side:** hourly `GET /oauth/2/login/current` while live, and cold start via `POST /oauth/2/login/token` with the 30-day refresh token, which **rotates on every use**. A no-browser renewal was observed live. It is a user session, not an API credential: it dies after 30 days idle and logged out once under rapid repeated renewals. Logout, password-change and 2FA effects weren't tested.
- **A workflow mirror** covers registration, cancel, check-in, payment and refund, but is blind to deletes, undo, edits and the same-email guest seat, so it needs periodic reconciliation.

## 9. Permissions and other gaps

- No Events permission in sub-account user roles; Events access rides the broad Memberships "View & manage membership" permission.
- Custom notifications: 400 "Events App access is required" on the test account.
- Event page slug: POST `/events-management/settings/{eventId}/validate-slug` (PROVEN).

## 10. Suggested follow-ups (maintainer's call)

1. Fix the host and the public-vs-admin registration flow in `skills/ghl-events` (a minimal edit is included in this PR).
2. Add overlay notes: `dateMode` single-only; settings GET side effect; `qrRevokeFailures`; refund ≠ registration status; undo via PUT.
3. Corpus pages for check-in (QR verdict table), triggers (3× fire, payloads) and server access (scopes).
4. Re-probe the web scanner routes and scopes at Events GA.
