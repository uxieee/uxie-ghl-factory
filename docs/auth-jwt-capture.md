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

> Note on provenance: the capture procedure in §2 and the header format in §1 come from this plugin's Bearer-verified export skill (2026-07-11). The exact JWT claim names above were cross-checked against `ghl-workflow-api-docs/docs/02-auth.md` (verified 2026-07-10, same auth migration) because the export skill's runbook documents capturing the token but not decoding UID/CID from it — see the Task 2 report for detail.

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
- No other plugin component should embed JWT header formats, capture steps, or UID/CID derivation — they point here instead.
