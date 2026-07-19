# GHL Internal-API Auth: Canonical Reference

> The ONLY file in this plugin permitted to contain auth header/format details.
> All skills/commands/agents reference this file; none embed copies.

## 1. Current auth format (since 2026-07)

GHL's internal workflow-builder API (`backend.leadconnectorhq.com`) authenticates every call with a short-lived JWT sent as a `Authorization: Bearer` header. This superseded an older header scheme in 2026-07 — see the Migration history (§5) if you find a doc that still teaches the old scheme.

Required headers on every call:

```
authorization:   Bearer <JWT>
channel:         APP
source:          WEB_USER
version:         2021-07-28
accept:          application/json, text/plain, */*
content-type:    application/json     (POST/PUT only)
```

- `version: 2021-07-28` is a GHL API version pin — unrelated to a workflow body's own `version`/`dataVersion` fields.
- The token must be scoped to the workflow-builder **iframe origin** (`client-app-automation-workflows.leadconnectorhq.com`). A token captured from a request whose `referer` is `https://app.gohighlevel.com/` is unscoped and returns `401` on every workflow endpoint — reject it and re-capture (§2).
- Writes (`POST`/`PUT`/`PATCH`/`DELETE`) are additionally CORS-enforced to the iframe origin. Send:
  ```
  origin:   https://client-app-automation-workflows.leadconnectorhq.com
  referer:  https://client-app-automation-workflows.leadconnectorhq.com/
  ```
  From a Playwright browser already navigated to that origin these are set automatically. Reads (`GET`) have been observed to tolerate other origins, but treat that as undocumented behavior, not a guarantee.

## 2. Capturing the JWT (Playwright procedure)

Preconditions: the user is logged into GHL in a browser profile you can automate, and has access to the target location/workflow.

1. **Parse the target IDs** from the workflow URL:
   ```
   https://app.gohighlevel.com/location/{LOCATION_ID}/workflow/{WORKFLOW_ID}
   ```
2. **Navigate** the automated browser to that same parent URL (`browser_navigate`). Wait a few seconds for the cross-origin workflow iframe to load:
   ```
   https://client-app-automation-workflows.leadconnectorhq.com/location/{LOCATION_ID}/workflow/{WORKFLOW_ID}
   ```
3. **Inspect network requests** with request headers enabled (`browser_network_requests`, `requestHeaders: true`), filtered to:
   ```
   workflow/{LOCATION_ID}/{first-8-chars-of-WORKFLOW_ID}
   ```
   Find the `200` workflow response whose request headers include:
   ```
   authorization: Bearer eyJ...
   referer: https://client-app-automation-workflows.leadconnectorhq.com/
   channel: APP
   version: 2021-07-28
   ```
   Copy the `authorization` value and strip the leading `Bearer ` — the `eyJ...` remainder is the JWT (`TOKEN`). Reject any candidate whose `referer` is `https://app.gohighlevel.com/` (see §1).

   If no `authorization: Bearer` header appears, ask the user to reload the workflow page (or open the workflow manually in their logged-in browser), then inspect again.
4. **Switch the automated browser to the iframe origin** (same URL as step 2) so subsequent `fetch()` calls satisfy CORS. The page may render blank — that is expected.
5. **Throttle before every fetch.** Run the project's throttle guard (e.g. `throttle.py wait`) before each backend call. If a response returns `429` or `403`, immediately record the rejection (`throttle.py reject <status>`) and stop — do not retry in the same turn.
6. **Fetch from the browser context** (`browser_evaluate` / equivalent), attaching the headers from §1:
   ```javascript
   async () => {
     const res = await fetch(URL, {
       method: "GET",
       headers: {
         "authorization": "Bearer " + TOKEN,
         "channel": "APP",
         "source": "WEB_USER",
         "version": "2021-07-28",
         "accept": "application/json, text/plain, */*"
       }
     });
     const text = await res.text();
     let body;
     try { body = JSON.parse(text); } catch { body = text; }
     return { status: res.status, ok: res.ok, url: res.url, body };
   }
   ```
   For writes, add `origin`/`referer` per §1 and `content-type: application/json`, and send the body as the `fetch` payload.

## 3. Deriving UID and CID

The current JWT payload (decode locally, e.g. via jwt.io — it decodes client-side and doesn't transmit the token) carries:

```json
{
  "authClass": "User",
  "authClassId": "CpTT7UCqUcPNfWgg3ArU",
  "sourceId": "CpTT7UCqUcPNfWgg3ArU",
  "channel": "APP",
  "source": "WEB_USER",
  "jti": "...",
  "iat": 1783680823,
  "exp": 1783684423
}
```

- **UID** (user id) = the `authClassId` claim. Send this as `updatedBy` on workflow writes.
- **CID** (company/agency id) is **not** in the current token — the payload no longer carries `company_id` or a `locations[]` claim. Derive it from any row of `GET /workflow/{LOCATION_ID}/list` (the `companyId` field), using the same Bearer auth from §1.

> Note on provenance: the capture procedure in §2 and the header format in §1 come from this plugin's Bearer-verified export skill (2026-07-11). The exact JWT claim names above were cross-checked against `ghl-workflow-api-docs/docs/02-auth.md` (verified 2026-07-10, same auth migration) because the export skill's runbook documents capturing the token but not decoding UID/CID from it.

## 4. Token lifetime & re-auth contract

- The JWT expires **~1 hour** after issue (`exp - iat` ≈ 3600s).
- **Contract:** any long-running flow must checkpoint its state to disk before the token can plausibly expire, so a fresh capture can resume from that checkpoint rather than repeating work.
- **On a `401`:** STOP immediately. Do not retry-loop the same call. Re-run the capture procedure (§2) to obtain a fresh token, then resume from the last checkpoint.
- The same discipline applies to `429`/`403` from the throttle guard (§2 step 5): stop, record the rejection, and only continue after the caller has addressed it (fresh token and/or backoff) — never blind-retry within the same turn.

## 5. Migration history

- **2026-07:** GHL migrated the internal builder API's auth header from `token-id` (a Firebase-issued JWT) to `Authorization: Bearer <JWT>` (a LeadConnector-issued JWT with different claims — see §3). Requests using the old `token-id` header now return `401` unconditionally.
- Any skill, runbook, or doc still teaching a `token-id` header is stale and must be corrected to reference this file instead of carrying its own copy.

## 6. Scope of use

- **`get-ghl-workflow-json`** (export) — read-only `GET` calls only. Uses this doc's §1–§4 in full; never issues writes.
- **`create-ghl-workflow`** and **`ghl-funnels-pages`** — issue writes (`POST`/`PUT`/`PATCH`) against the internal API. They use this doc's §1–§4 for auth *and* must additionally satisfy `${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md` (owned-account check + one-time ToS disclosure) before any write executes.
- **`ghl-ai-agents-specialist`** — issues writes against the **AI internal services** (Conversation AI, Voice AI, Agent Studio, Knowledge Base). Those use a DIFFERENT header — see §7. Write rails (`${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md`) still apply.
- **`ghl-memberships`** — issues writes against the **Memberships / client-portal** surface. Auth is §1 **plus a `sourceid` header**, and the member-facing rail uses a different token class entirely — see §8. Write rails still apply.
- No other plugin component should embed JWT header formats, capture steps, or UID/CID derivation — they point here instead.

## 7. AI-services auth (`token-id`) — SERVICE-DEPENDENT

The internal auth scheme is **not uniform**. §1–§4 above cover the **workflow-builder** surface
(`backend.leadconnectorhq.com/workflow/...`, `workflows-marketplace/...`), which uses
`Authorization: Bearer <JWT>`. But the **AI services** on `services.leadconnectorhq.com` —
`ai-employees` (Conversation AI), `voice-ai`, `agent-studio`, `knowledge-base` — authenticate with a
**`token-id`** header instead, carrying a Google securetoken RS256 JWT
(`iss: securetoken.google.com/highlevel-backend`; claims `user_id`, `company_id`, `role`, `locations[]`).
Sending a `Bearer` token to these services, or a `token-id` to the workflow API, fails.

**Capture procedure (token-id):**
1. Have an authenticated `app.gohighlevel.com` browser session (Playwright MCP). Navigate into the
   sub-account (deep links 404 — click through from `/`; the AI area is under "AI Agents").
2. Trigger any authenticated AI call — e.g. open the Conversation AI / Voice AI / Agent Studio list,
   which fires a `GET services.leadconnectorhq.com/ai-employees/...` (or `/voice-ai/...`, `/agent-studio/...`).
3. Read that request's headers via `browser_network_request` and copy the **`token-id`** value. Also
   present and worth replaying: `channel: APP`, `source: WEB_USER`, `version: <date>`, `content-type: application/json`.
4. **Never store the token.** It is a ~1 hr session JWT; capture a fresh one each session (a stale one
   returns `401 … E003`). Re-capture from a fresh authenticated request on expiry.

**Executing a write:** run the compiled request descriptor from the engine
(`ghl-ai-agents-specialist/engine/*-compiler.mjs` emit `{method, path, body, authHeader:'token-id'}`),
POST/PUT to `https://services.leadconnectorhq.com<path>` with the `token-id` header + the headers above.
Conversation AI PUT **merges**; Voice AI and Agent Studio PUT **full-replace** (GET → mutate whole doc → PUT).
KB rich-text (`POST /knowledge-base/rich-text/`) processes async — poll `.../:id/status` until `trained`.

## 8. Memberships auth — TWO RAILS (admin + member)

The Memberships / client-portal surface splits into an **admin rail** and a **member rail** with
different tokens, headers, and lifetimes. Getting the rails crossed returns a misleading `401 Bad Request`
on endpoints that plainly work in the browser.

### 8.1 Admin rail

Same LC JWT as §1, **plus `sourceid`**:

```
authorization: Bearer <LC JWT>
channel:       APP
source:        WEB_USER
sourceid:      <locationId>      # REQUIRED on membership/* — absent from §1
version:       2021-07-28
```

Covers `backend…/membership/*`, `backend…/courses/*`, `backend…/certificates/*`,
`backend…/assets-drm/*`, and `services…/communities/*`.

- **`clientclub/*` needs NO `sourceid`** (invite, magic-link, portal-settings, search-users). Looser again.
- Materially **looser than the workflow builder**: a parent-frame token works, and writes need no
  `origin`/`referer`. Do NOT port the workflow CORS handling here.
- No `token-id` anywhere on this surface.

### 8.2 Member rail (client portal)

Member-scoped endpoints live on `services…/clientportal-middleware/*` and require a **portal token**,
not an admin token:

```
authorization:      Bearer <PORTAL JWT>   # authClass ClientPortalUser,
                                          # clientPortalMeta:{contactId, locationId}
channel:            APP
source:             PORTAL_USER           # NOT WEB_USER
version:            2023-02-21            # NOT 2021-07-28
x-location-id:      <locationId>
x-group-id:         <groupId>             # communities calls
x-platform-details: web
x-app-version:      web
```

- **TTL is ~24 h** (vs ~1 h admin) — materially friendlier for member-side automation.
- **Obtain it headlessly:** `POST services…/clientclub/{loc}/tokens/send-magic-link`
  `{locationId, email:[…], sendEmail:false, showMagicLink:true, source:"clientportal_builder_v1"}`
  returns `[{magicLink}]`. Open it, then read the `authorization` header off any portal XHR.
  Requires an **existing** portal user — an invited-only address returns 400.
- **You cannot spoof the rail.** The JWT encodes its own `source`; overriding the header 401s.
  Community group internals (`/groups/{id}`, `/channels`, `/posts`) are PORTAL_USER-scoped and return
  `403 "WEB_USER source is restricted by this endpoint"` to an admin token — by design, not a permission bug.

### 8.3 Provisioning constraint

Portal signup is **OTP-gated** (`clientportal-middleware/clientclub/v2/{loc}/auth/signup` needs an emailed
code), so a member cannot be fully provisioned headlessly. However the clientclub **user record is created
before the OTP is verified** — a failed signup leaves a password-less user, after which magic-link +
`/set-password` completes provisioning without inbox access. Plan onboarding around "the member must
*attempt* signup once", not "must complete the whole flow".

⚠️ **Deleting a contact does NOT invalidate an active portal session.** Combined with the 24 h TTL, contact
deletion is not a safe offboarding control.
