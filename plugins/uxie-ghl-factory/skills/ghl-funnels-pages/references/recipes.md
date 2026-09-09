# Recipes — GHL internal funnels/pages API

Host: `https://backend.leadconnectorhq.com` (paths below are relative to this
host — e.g. `/funnels/funnel/create` means
`POST https://backend.leadconnectorhq.com/funnels/funnel/create`).

Source: `ghl-workflow-api-docs/docs/superpowers/specs/2026-07-11-pipelines-funnels-html-injection.md`
(sections 2–3) and the dev scripts in that repo's
`skills/create-ghl-workflow/dev/`: `build-funnel-page.mjs`, `fullbleed.mjs`,
`page-trackingcode.mjs`, `seo.mjs` (probed via `probe.mjs`). Every payload
below is copied from those two sources — nothing invented.

> ⚠️ **Auth on this rail: BOTH credentials work.** `token-id` and `Authorization: Bearer` each
> returned 200 on identical `/funnels/*` calls, re-measured with negative controls 2026-09-10 (a
> bad token 401s, no header 401s, and a `/vibe-ai` control still refuses `token-id` — so the header
> is genuinely being checked and the two are interchangeable *here*, not everywhere).
>
> An earlier revision of this line said Bearer was **rejected**. That was true when measured in
> July; the platform moved. 🔴 **So a 401 on this rail is not proof the credential is dead — try the
> other rail before re-capturing.** Auth facts on this product carry an expiry date.

Auth headers on every call: see `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`
**§9** (funnels rail — `token-id` + `channel`/`source`/`version`/`accept`, and a
capture procedure that must hook `fetch`/`XHR` *before* SPA navigation). §1 of
that doc is the **workflow-builder** rail and does not apply here. Every write in
this file must first pass both gates in
`${CLAUDE_PLUGIN_ROOT}/docs/write-rails.md`.

> ⚠️ **`autosave` saves a DRAFT — it does not publish.** Every write recipe here
> lands on the draft, while the **public URL keeps serving the previous content**.
> Publishing is a SEPARATE call — recipe 7. See "Draft vs published" below before
> reporting any page live.

> 🟢 **Adding a step + page to an EXISTING funnel works end to end.** Proven live
> 2026-08-10 on a real client funnel with a real custom domain attached — not a
> probe funnel. The full order, all six steps required:
>
> `create-step` (§2) → `builder/autosave` (§4) → `builder/get-versions` (§7) →
> `builder/publish-version` (§7) → **§10's THREE path calls** → verify the **public URL**.
>
> **§10 is not optional, and it is not one call.** The public URL is resolved from the
> `funnel_lookup` routing table, not from the page doc — so setting the page doc's url
> alone leaves the live route on the old path, silently. §10 has the model and the
> sequence. This supersedes the previous banner, which claimed an API-created page
> "can never be published"; that was wrong (§2, §9).

> ✅ **`funnel/create` (§1) retested 2026-08-10 — the spinner-hang did NOT reproduce.**
> The funnel opened in the UI instantly and fully interactive. Failure-to-reproduce is
> not proof the original was false (§1 states the limit), but there is no longer a known
> reason to route funnel creation to the UI.

## 0. Draft vs published — read before reporting a page shipped

`POST /funnels/builder/autosave/{pageId}` returns `201` and writes the **draft**.
That is the full extent of what every write recipe in this file does *except*
recipes 7 and 10.

- `https://<funnel-domain>/<funnel-path>/<page-path>` (the **public** URL) →
  keeps serving the OLD content until you publish.

This is a genuine publish gate, **not CDN cache**: the public URL was polled with
cache-busted requests for 4+ minutes and never changed (observed live 2026-07-21).

Confirmed at the data layer 2026-07-19: an `autosave` creates a version stamped
**`pageType: "draft"`** (visible via `GET /funnels/builder/get-versions?pageId=`).
Publishing flips that same version to **`pageType: "live"`**.

**Therefore:** a `201` from `autosave` means *"the draft is correct"*, NOT *"the
customer sees it"*. Finish the job with recipe 7, or say plainly that publishing is
outstanding.

### 🔴 `/preview/{pageId}` is not a verification route on a domained funnel

`https://<funnel-domain>/preview/{pageId}` **does not serve the page.** Observed twice on
2026-08-10, with two different failure shapes on two different accounts: a **301 to the
funnel's first step** on one, and a plain **404** on GROM AU (`aus.gromdigital.com` and
`go.gromdigital.com`, both for pages that were serving fine on their public URL). Either
way it is not a verification route. Earlier revisions of this file told you to verify
against `/preview/`; on a domained funnel that produces a **false failure report**.

**Verify on the public URL** (`https://<domain>/<funnel-path>/<page-path>`), and make
sure the page path is the one you think it is — recipe 10.

The old preview-vs-public split still describes the *draft* state on a funnel with no
domain, but do not build a verification step on it.

---

## 7. Publish a page (draft → live)

**Purpose:** make the saved draft the version the public URL serves. This is the
API equivalent of the builder's Publish action.

**Status: live-proven 2026-07-19** (GROM AU, throwaway funnel, since deleted).
Found by reading the page-builder bundle
(`page-builder.leadconnectorhq.com` → `FunnelServices.publishVersion`), then
executing the full sequence.

**Sequence — publishing targets a VERSION, not a page:**

1. `POST /funnels/builder/autosave/{pageId}` (recipe 4) → creates a version.
2. `GET /funnels/builder/get-versions?pageId={pageId}` → array of
   `{version_id, page_download_path, page_download_url, updated_at, updated_by,
   userName, integrations, pageType}`. `pageType` is `"draft"` or `"live"`.
   Take the `version_id` you want live (newest first after a save).
3. `POST /funnels/builder/publish-version`
   ```json
   { "pageId": "<pageId>", "versionId": "<version_id>", "userId": "<uid>" }
   ```
   `→ 201 { "status": true }`

`userId` is the acting user's id (the JWT's `authClassId`; it is also what comes
back as `updated_by` on the version). It is **required** — omitting it 422s.

**Verification:** re-`GET /funnels/builder/get-versions?pageId=` and confirm that
`version_id` now reads `pageType: "live"`. The page doc
(`GET /funnels/page/{pageId}`) mirrors it under `versionHistory[].pageType`.

**Known limits:**
- ✅ **Serving from the public URL is CONFIRMED** (2026-08-10, on a funnel with a
  real custom domain attached) — **conditional on the page path being right
  (recipe 10)**. This closes the 2026-07-19 "no domain attached,
  serving not confirmed" caveat that stood here.
- Publishing is **not** the last step. A published page whose page path still carries
  the `create-step` `-page` suffix is unreachable at the URL you expect. Run recipe 10,
  then fetch the public URL.
- Do **not** verify with `/preview/{pageId}` on a domained funnel — it 404s or 301s
  depending on the account, even for a known-good page (§0).
- Related endpoints on the same service, seen in the bundle but NOT exercised:
  `POST /funnels/builder/restore-version` (same `{pageId, versionId, userId}` shape)
  and `POST /funnels/builder/delete-version-history-data`.

---

## 10. Set a page's public path — THREE calls, not one

**Purpose:** change the path the public URL serves a page at.

**Status: live-proven on GROM AU 2026-08-10**, captured from the UI's own requests
(gear on the control thumbnail → "Edit page details" → Save) with a full non-GET
network observer. ⚠️ **This recipe was published on 2026-08-10 with only the third call
and was WRONG** — the page doc updated and the public URL did not move. Corrected the
same day.

### The routing model — read this first

The public URL is **not** resolved from the page doc's `url` field. It is resolved from
a separate routing collection, `funnel_lookup`, which holds **one row per entity**:

```
GET /funnels/lookup/type/{entityId}
  → { data: { _id, path, pathLowercase, type, typeId, domain, funnelId, locationId, steps[], ... } }
```

Live on one funnel, all three rows on the same domain:

| `type` | `typeId` | `path` | serves? |
|---|---|---|---|
| `funnel` | funnelId | `/zz-test-chat` | 200 |
| `step`   | stepId (the uuid you generated) | `/chat` | 200 |
| `page`   | pageId | `/chat-final` | 200 |

**So the step url and the page path are BOTH live aliases for the same page** — they are
independent rows, and both 200. A path with no row 404s (`/bogus-zz-9999` → 404, so the
domain is not a catch-all).

> ⚠️ An earlier version of this section said "the PAGE path is the one the public URL
> resolves, not the step url". That is **not** what a settled funnel shows: on an
> untouched two-step funnel, step `/pilotprogram/book` and page `/book/pilotprogram-page`
> both returned 200 with the **same** `<title>`. Treat them as aliases.

### The sequence

1. **Read the lookup row** to get its id:
   `GET /funnels/lookup/type/{pageId}` → `data._id` is the `lookupId`.
2. **Move the route** — this is the call that changes what the public URL serves:
   `PUT /funnels/lookup/{lookupId}` body `{"path":"/new-path"}` → `200`
3. **Update the page doc** so the builder and page metadata agree:
   `POST /funnels/funnel/funnel-page/{pageId}` body `{"url":"/new-path","name":"<page name>"}` → `201`

🔴 **Step 3 alone is the trap.** Firing only the POST updates `GET /funnels/page/{pageId}`
to the new url while the public URL **keeps serving the old path** — proven by polling
for 2 minutes: page doc read `/chat-page`, the live 200 was still the previous path, and
`/chat-page` itself returned 404 the whole time. The page doc and the live route diverge
**silently**, and nothing in the response tells you.

### Availability pre-check — and the `ok` trap

```
GET /funnels/funnel/funnel-step-page-url?name=<name>&path=<urlencoded>&type=page&domain=<funnel domain>
  → 200 { "uniqueUrl": "/what-you-will-actually-get", "ok": true, "traceId": "..." }
```

🔴 **`ok: true` does NOT mean the path is free.** It came back `true` for a path that was
already taken. The real signal is **whether `uniqueUrl` equals the path you asked for**:

| asked | `uniqueUrl` | meaning |
|---|---|---|
| `/definitely-free-xyz-123` | `/definitely-free-xyz-123` | free |
| `/chat` (taken) | `/chat-359115` | taken — server offers a suffixed alternative |
| `/zz-probe-path` (taken) | `/zz-probe-path-974500` | taken |

The dedup suffix is a **random 6-digit number**, not `-page`. A real funnel carries
`/book/pilotprogram-page-147917`, which is this mechanism's fingerprint. This is a
**different** mechanism from `create-step`'s `-page` suffix (§2) — do not conflate them.

**Required IDs:** `pageId`, plus the `lookupId` from step 1. Neither funnelId nor
locationId appears in any of the three bodies.

**Verification:** fetch the **public URL** and confirm `200` plus your content. ⚠️ The
page doc read-back is **stale for a few seconds** after the POST — an immediate
`GET /funnels/page/{pageId}` returned the OLD url, and the correct one seconds later.
Do not conclude the write failed from one immediate read (same trap as `funnel/list`
after a delete, §8). Do **not** verify with `/preview/{pageId}` (§0).

**Known limits:**
- Proven for the CONTROL variation. Split-test variations were not exercised.
- Only `path` was sent to the PUT, and only `url` + `name` to the POST. Other fields on
  either document were not exercised — don't invent keys.
- Retiring a path is not instant: a replaced path kept serving `200` for a short window
  before going `404`. Don't treat an old URL still answering as a failed change.
- A page in a funnel with **no domain attached** has **no lookup row at all**
  (`GET /funnels/lookup/type/{pageId}` → `404`). Routing rows appear to be created per
  domain, so this recipe only applies once the funnel has a domain.

---

## 8. Delete a funnel

**Endpoint:** `POST /funnels/funnel/delete`
```json
{ "funnelId": "<id>", "locationId": "<loc>", "userId": "<uid>" }
```
`→ 201 { "domains": [], "paths": [] }`; the funnel disappears from
`/funnels/funnel/list`.

⚠️ **`funnel/list` is briefly STALE after a delete.** Immediately after a
successful `201`, the list still returned the deleted funnel; seconds later it
was correctly absent. Do **not** conclude the delete failed from one immediate
read, and above all **do not fire the delete a second time**. Re-read after a
short pause instead. Live-observed on AU 2026-07-25.

`userId` is **required** (omitting it returns `422 "userId should not be empty"`).
There is no `DELETE` verb on this resource — `DELETE /funnels/funnel/{id}` and
`DELETE /funnels/funnel/delete/{id}` both 404. Live-proven 2026-07-19 on the
throwaway probe funnel.

IDs: `LOC` = locationId. `funnelId` = returned by funnel creation. `pageId`
= server-assigned when a step is created. `step.id` = a **client**-generated
uuid v4 (you generate this before calling create-step — the server does not).

---

## 1. Create a funnel

**Purpose:** create the funnel container that pages/steps live under.

**Endpoint:** `POST /funnels/funnel/create`

**Payload:**
```json
{ "locationId": "<loc>", "name": "My Funnel", "type": "funnel" }
```

**Response:** `{ "ok": true, "id": "<funnelId>", "name": "..." }`

**Required IDs:** `locationId` only (from the account/session). Produces
`funnelId`, needed by every other recipe in this file.

**Verification:** `GET /funnels/funnel/fetch/{funnelId}?locationId={loc}` →
confirm the funnel doc exists with the name you set.

**Known limits:**
- ✅ **RETESTED 2026-08-10 — the UI spinner-hang does NOT reproduce.** A funnel created
  by this call on GROM AU opened in the UI **instantly and fully interactive**: title,
  Steps/Stats/Sales/Security/Events/Settings tabs, the step list, the CONTROL panel with
  "Use existing"/"Create from blank", and the correct "Please add a domain in the
  settings to see your Funnel live!" notice. A step created into it via §2 also rendered.
  The 2026-07-25 observation that this endpoint yields a funnel the UI cannot render is
  therefore **not reproducible today**.
  - Honest limit: a failure to reproduce is **not** proof the original observation was
    false. Whether GHL fixed it, or it was environmental, or the original was a caller
    artefact, is **unknown**. What is established is that `funnel/create` +
    `create-step` produced a fully usable funnel on 2026-08-10.
  - Test artefact kept per instruction, NOT deleted:
    `ZZ TEST funnel-create probe 2026-08-10 (safe to keep)`.
- `type` is only proven as `"funnel"` — no other value was tested; don't
  invent alternatives (e.g. a `"website"` type).
- Proven live on GROM Digital AU (funnel `RipeI1dmKTAtdKQSbBVy`) — "proven" here
  means the document is created, NOT that the result is usable (see above).

---

## 2. Add a step (creates the page)

**Purpose:** add a step to a funnel — this is what actually creates the page
document.

**Endpoint:** `POST /funnels/funnel/create-step`

**Payload:**
```json
{ "step": { "id": "<client-uuidv4>", "name": "TEST Landing", "url": "test-landing",
            "pages": [], "type": "optin_funnel_page", "split": false, "control_traffic": 100 },
  "funnelId": "<funnelId>" }
```

**Response:** creates the page doc server-side (Firestore
`funnel_pages/{pageId}`, `page_version:1`, `section_version:1`); the created
page object comes back with a server-assigned `_id` — that is your `pageId`.

**Required IDs:**
- `funnelId` — from recipe 1.
- `step.id` — **you generate this** (uuid v4) before calling; the server
  generates the page id, not the step id.

**Verification:** `GET /funnels/page/{pageId}` (page metadata) and/or
`GET /funnels/funnel/fetch/{funnelId}?locationId={loc}` and confirm the new
step appears in the funnel's `steps[]` array (`{id,name,pages:[pageId],sequence,type,url}`).

🔴 **`step.url` is NOT the page's path.** `create-step` **auto-appends `-page`** to the
page path it derives from `step.url`. Re-proven from scratch 2026-08-10: sent
`step.url: "followup"` → funnel doc step url `/followup`, page doc url **`/followup-page`**.
Two other funnels in the same account show the same fingerprint (`/chat` → `/chat-page`).
The suffix is the literal string `-page`, NOT the random dedup number from §10.

**Every `create-step` whose page must answer on a chosen path must be followed by
recipe 10 — all THREE of its calls.** The page doc's url alone does not route.

**Known limits:**
- `step.type` `"optin_funnel_page"` and `"store"` are proven; `"blog-post"` 404s
  (a blog container comes from a template load, not from `create-step`).
- `step.pages: ["<existingPageId>"]` is **ignored** — a new step always mints a new
  blank page. You cannot point a step at an existing page.
- 🔴 **Omitting `step.id` mints an UNREPAIRABLE step.** It returns `201` and mints a
  page, but the page gets no `stepId`, `PUT /funnels/funnel/step/{funnelId}` then
  answers `400 "Funnel Step not found!"` forever, there is no step-delete endpoint
  (only whole-funnel delete), and domain attach mints no routing row for it. Always
  generate the uuid v4 yourself. `GET /funnels/page?locationId=&funnelId=&limit=20`
  returns `stepId` per page and detects id-less steps already in an account (`limit`
  is capped at 20).
- Proven live (page `pWOizhNP5hBqHtVNLgfu`; re-proven end to end 2026-08-10 on a
  client funnel with a real custom domain).
- ✅ **The page this creates CAN be saved to and published.** This corrects the
  previous entry here, which said `autosave` 422s on an API-created page — including
  on an unmodified echo of its own `page/data` — and concluded that **"an API-created
  page can never be published"**. That conclusion was **wrong**.
  - The 422 is a plain **body-shape** error, and its message says so:
    `pageData should not be empty, pageVersion should not be empty`.
  - `autosave` does **not** accept a `page/data` response directly. It wants the
    **recipe-4 envelope**: `{funnelId, pageData:{sections, settings, general,
    pageStyles, trackingCode, fontsForPreview, popups, popupsList},
    pageVersion:<int>, pageType:"draft", manualSave:true, integrations:{…}}`.
    A raw `page/data` echo fails because **the wrapper is missing**, not because the
    page is malformed.
  - Wrapped correctly, `autosave` returns `201` on a page created **seconds earlier**
    by `create-step`. Live-proven 2026-08-10.
- Consequently the old advice that a content source "must be a known-good EXISTING
  page, and the target must be one the UI created" is **withdrawn**. The new page's own
  `page/data` is a fine source — wrap it before you send it.
- Still unexercised: the freshly created page's *default* section/row/col skeleton as
  a basis for building content from nothing. The 2026-08-10 proof wrapped real
  `pageData`; "build a page's content from nothing but this recipe" remains unproven.

---

## 3. Read current page/funnel state (used before every write in recipes 4–6)

**Purpose:** every content write below (full-bleed HTML, page-level tracking
code, SEO re-render) is a **full-replacement** save — you must read the
current `pageData` first, mutate only the piece you care about, and save the
whole thing back. These GETs are also the recon/verification reads.

**Endpoints (all read-only; `token-id` auth per §9, not Bearer):**
- `GET /funnels/funnel/list?locationId=&type=funnel&category=all&offset=&limit=` — list funnels (recon).
- `GET /funnels/funnel/fetch/{funnelId}?locationId=` — funnel doc: `_id, name, steps[], trackingCodeHead, trackingCodeBody, url, domainId, globalSectionsUrl, orderFormVersion, ...`.
- `GET /funnels/page/{pageId}` — page metadata: name, url, funnelId, stepId, `meta` (SEO), `pageDataUrl`/`pageDataDownloadUrl`, versions. **Content is NOT inline here.**
- `GET /funnels/page/list?funnelId=&locationId=` — list pages in a funnel.
- `GET /funnels/builder/page/data?pageId=` — the actual working content:
  `{sections, settings, general, pageStyles, trackingCode, popups, funnelId, stepId, locationId, pageId}`. This is what you clone/mutate/send back to `builder/autosave`.

**Known limits:**
- None of these GETs return an obvious authoritative "current save version"
  counter that the proven scripts read and increment — see the `pageVersion`
  gotcha under recipe 4.

---

## 4. Full-bleed custom-HTML page (element injection + edge-to-edge layout)

**Purpose:** build a page whose entire content is one raw HTML/CSS/JS block
(a `c-custom-code` element), with GHL's default section/row/col padding and
the 1170px content cap removed so the HTML fills the viewport edge-to-edge.

**The `c-custom-code` element** (lives inside `pageData.sections[].elements[]`,
nested under row → col in a real page tree):
```jsonc
{ "id": "custom-code-<rand>", "type": "element", "meta": "custom-code", "tagName": "c-custom-code",
  "title": "Custom Code", "tag": "", "child": [], "class": {}, "styles": {}, "customCss": [],
  "wrapper": { /* margins + width/height: auto */ },
  "extra": { "nodeId": "ccustom-code-<rand>",
             "visibility": { "value": { "hideDesktop": false, "hideMobile": false } },
             "customCode": { "value": { "rawCustomCode": "<YOUR RAW HTML STRING>" } },
             "customClass": { "value": [] } } }
```

**Endpoint (the save):** `POST /funnels/builder/autosave/{pageId}`
```jsonc
{ "funnelId": "<fid>",
  "pageData": {
    "sections": [ /* cloned from an existing page's GET, with the target element's
                     extra.customCode.value.rawCustomCode replaced by your HTML */ ],
    "settings": {}, "general": {}, "pageStyles": "…",
    "trackingCode": { "headerCode": "…", "footerCode": "…" },
    "fontsForPreview": [], "popups": [], "popupsList": [] },
  "pageVersion": <int>, "pageType": "draft", "manualSave": true,
  "integrations": { "videoBackground": false, "blogMeta": { "selectedBlogCategories": [], "categoryNavigationList": [] },
                     "customCode": <count of customCode elements>, "popup": false } }
```
`→ 201 { pageDataUrl, pageDataDownloadUrl }`. GHL persists to Firestore +
Firebase Storage and re-renders the **preview** server-side.

> ⚠️ **This is a DRAFT save.** The `201` means the draft took, not that the page
> is live — the public URL still serves the old content until someone clicks
> Publish in the builder UI. See §0.

**Full-bleed CSS zeroing** (apply to every section before the same
`autosave` call — either at build time, or as a retrofit on an existing
page): for each `section` in `pageData.sections`:
- zero `paddingTop/Bottom/Left/Right` and `marginTop/Bottom/Left/Right` on
  `section.metaData.styles` and on every `section.elements[].styles`
  (`{unit:"px", value:0}`).
- zero `marginTop/Bottom/Left/Right` on `section.metaData.wrapper` and each
  element's `wrapper`.
- **also rewrite the compiled CSS string** at `section.general.sectionStyles`:
  `padding:...` → `padding:0`, `margin:0 auto` → `margin:0`,
  `max-width:1170px` → `max-width:100%`. The render uses `sectionStyles`
  directly, so zeroing the element-style fields alone is not enough.

**Required IDs:** `pageId`, `funnelId` (both from recipes 1–2); a source
`pageData` to clone (either the new page's own current data, or an existing
known-good page's structure) — **wrapped in the envelope above**, which is the
whole of what the old "API-created pages 422" finding actually was (§2).

**Verification:** publish first (recipe 7), set the page path (recipe 10), then fetch
the **public URL** `https://<domain>/<funnel-path>/<page-path>?z=<cache-bust>` and
confirm (a) your HTML/marker is present in the response, and (b) the section/content
elements measure `0,0` padding (i.e. edge-to-edge).

🔴 **Do not verify with `https://<funnel-domain>/preview/{pageId}`.** Earlier revisions
of this recipe told you to, and on a **domained** funnel that is a false-failure trap:
preview **301s to the funnel's first step** even for a known-good published page
(live-observed 2026-08-10, §0).

If you have only saved the draft and not published, say so plainly — an unchanged public
URL at that point is expected, not a failure (§0). Do not report the page as shipped off
the `201`.

**Known limits:**
- Proven end-to-end for a page whose entire body is a single `c-custom-code`
  element (real GROM example: a 55KB full `<!DOCTYPE html>` doc in one
  element). Multi-element/multi-column full-bleed layouts weren't
  separately exercised.
- **`pageVersion` gotcha:** the proven scripts send different hardcoded
  integers across separate runs (seen: 1, 2, 4, 5) rather than reading a
  current version and incrementing it. The exact required semantics of this
  field are not nailed down by the source material — read whatever version
  information the page exposes before you save, and don't assume "always
  send 1" is safe for a page that's been saved before.
- With `general`/`settings` too thin (e.g. omitting a section's `general`
  block), the proven scripts default it from the cloned template
  (`s.general ??= tpl.general?.general ?? tpl.general ?? {}`) — always carry
  forward the source page's `general`/`settings`/`pageStyles`/`fontsForPreview`/
  `popups`/`popupsList` verbatim except for the piece you're intentionally
  changing.

---

## 5. Tracking code (head/body HTML injection)

Two different vectors, two different endpoints, two different scopes. Don't
conflate them.

### 5a. Funnel-level (applies to EVERY page in the funnel)

**Purpose:** inject raw HTML/JS into `<head>`/before `</body>` on every page
of a funnel at once (analytics snippets, global custom markup).

**Endpoint:** `POST /funnels/funnel/update-settings`
```json
{ "locationId": "<loc>", "funnelId": "<id>", "funnelPath": "/path", "funnelName": "...",
  "domainId": "", "faviconUrl": "",
  "headTrackingCode": "<script>...</script><meta ...>",
  "bodyTrackingCode": "<!-- ... -->",
  "allowPaymentModeOption": true, "paymentMode": true, "chatWidgetId": "",
  "imageOptimization": true, "isGdprCompliant": false, "isOptimisePageLoad": true,
  "stopAllSplitTestsAndReset": null, "requireCreditCard": true, "storeCurrencyFormatting": false }
```
- `headTrackingCode` persists as the funnel's `trackingCodeHead` field;
  `bodyTrackingCode` persists as `trackingCodeBody`.

**Required IDs:** `funnelId`, `locationId`.

**Verification:** `GET /funnels/funnel/fetch/{funnelId}?locationId={loc}` and
confirm `trackingCodeHead`/`trackingCodeBody` match verbatim what you sent
(these two field names come directly from the funnel-doc shape documented in
recipe 3) — or fetch any **published** page of the funnel at its **public URL** and
confirm the markup appears in `<head>`/before `</body>`. Do not use `/preview/{pageId}`
on a domained funnel (§0).

**Known limits:**
- 🔴 **Empty strings ARE applied, and they CLEAR the field. This is a
  whole-settings write, not a patch.** `faviconUrl`, `headTrackingCode` and
  `bodyTrackingCode` each stored a canary and each came back empty after a
  subsequent `""`, proven in the order set → read → clear → read
  (live 2026-09-09). **Never send the payload above as-is on a real funnel:**
  its `""` defaults will wipe that funnel's tracking codes and favicon and
  detach its chat widget. Read the funnel with the fetch GET first, fill every
  field you do not intend to change, then send. A `201` tells you nothing —
  the write you wanted succeeds while the collateral damage is invisible.
- **It DOES attach and detach the chat widget** (live 2026-09-09). Send
  `chatWidgetId`; the server flips `isChatWidgetLive` to `true` on its own.
  `chatWidgetId: ""` detaches and sets it `false`. **Never send
  `isChatWidgetLive`** — it is derived. List widgets with
  `GET /chat-widget/list?limit=&offset=&locationId=`.
- **`locationId` must be in the BODY** — omitting it is
  `422 ["locationId should not be empty","locationId must be a string"]`.
- A funnel whose settings have never been saved returns these keys **absent**,
  not empty; the first `update-settings` materialises all ten at once.
- Applies to **every page in the funnel**, not one page — if you only want
  one page affected, use 5b instead.
- With `isOptimisePageLoad: true` (the default in the proven payload),
  custom JS/HTML is lazy-loaded — don't assume it executes at first paint.
- Proven via a real round-trip: injected
  `<script>window.__API_INJECTED__=true;</script><meta name="built-by" ...>`
  and read it back verbatim.

### 5b. Page-level (applies to ONE page only)

**Purpose:** per-page head/footer HTML, independent of the funnel-level
injection above.

**Endpoint:** same content-save endpoint as recipe 4 —
`POST /funnels/builder/autosave/{pageId}`, setting:
```json
{ "pageData": { "trackingCode": { "headerCode": "<meta/script>", "footerCode": "<script>" }, "...": "rest of pageData unchanged, see recipe 3" } }
```
`headerCode` renders in `<head>`; `footerCode` renders before `</body>`, on
that page only.

**Required IDs:** `pageId`, `funnelId`. Read the page's current `pageData`
first (recipe 3) and only replace `trackingCode`; leave `sections`, `settings`,
etc. as read.

**Verification:** publish (recipe 7), confirm the page path (recipe 10), then fetch the
**public URL** and confirm the injected markers are present in `<head>` and before
`</body>` respectively — the check the proven script runs is
`indexOf(marker) < indexOf("</head>")` / `< lastIndexOf("</body>")`.

⚠️ That script polled the **preview** URL, which was valid on the domainless probe
funnel it was written against but is a **false-failure trap on a domained funnel**
(§0). Point the same assertion at the public URL.

**Known limits:** same `pageVersion` gotcha as recipe 4.

---

## 6. Page `meta` (SEO title and description)

**Purpose:** set a page's SEO title and description.

```
POST /funnels/funnel/funnel-page/{pageId}   { name, url, meta: { title, description, … } }
```

→ `201`, and the rendered page carries the new `<title>` `[proven-live, 2026-09-10]`. This is the
same route recipe 10 uses for `{url, name}` — the bundle calls it `updatePageData`. There is no
separate meta endpoint and **no Firestore call is involved.**

🔴 **Verify on the RENDER, never on the page record.** `GET /funnels/page/{pageId}` does not return
`meta` at all — the key is absent even immediately after the `201` that set it — so a read-back
through the record reports every page as untouched.

Merge tags resolve in `<title>`: `{{custom_values.company_name}}` came back **consumed** — the tag
gone, the substitution empty on an account with no such value. Consumed-to-empty is the positive
result; a literal `{{…}}` surviving is the negative one.

> ⚠️ **This recipe previously ran to ~64 lines saying SEO was BLOCKED** — "there is no `token-id`
> REST endpoint for it" — and routed callers into the Firestore REST API with a separate Firebase
> credential. That was wrong, and it was disproved twice over: by the endpoint above, and by
> recipe 10, which had been calling that very route on the token-id rail the whole time. The
> Firestore material is provenance for how GHL's own builder does it and is kept in the corpus,
> not here.

**Not exercised:** `schemaMarkup` (the manual override) and `robotsTxtCode`. 🔴 And note that the
AUTO-generated schema.org block is pinned to a page's first publish and never regenerates — see the
publish-freeze rule in SKILL.md.


## 9. Create the FUNNEL in the UI; create its STEPS and PAGES via the API

**API-created funnels work.** `POST /funnels/funnel/create` produces a funnel that opens
instantly and is fully interactive, and an API-created step in it renders correctly — no
known reason remains to route funnel creation through the UI. `POST
/funnels/builder/autosave/{pageId}` needs the **recipe-4 envelope**: a raw, unwrapped
`page/data` echo 422s (`pageData should not be empty, pageVersion should not be empty`);
wrapped in the recipe-4 envelope, it `201`s on a page created seconds earlier by
`create-step`. The full sequence §2 → §4 → §7 → §10 → public URL is live-proven on a
domained funnel, so an API-created page CAN be published. `POST
/funnels/funnel/update-settings` DOES clear a field with an empty string, and does attach
and detach a chat widget (live 2026-09-09) — treat it as a whole-settings write and fill
every field you do not mean to change.

A 4xx that names the missing body fields in its own message is a **caller** defect until
the body is proven correct — read the error text before concluding the platform is broken.

Other defects in the funnel/page routing layer:

| # | Defect | Effect |
|---|---|---|
| 1 | A step's `url` and its CONTROL page's Path are **two independent rows**, and `create-step` derives the page path as `<step.url>-page` (plus a numeric suffix on collision). | Both rows serve — they are aliases, not competitors — but the page path you get is not the one you would have chosen, and it is not derived from the funnel path. **Rename with recipe 10.** |
| 2 | `/preview/{pageId}` does not serve — **301** to the first step on one account, **404** on another, both for pages serving fine publicly. | Preview-based verification reports a **false failure**. Verify on the public URL (§0). |
| 3 | The public URL resolves from the **`funnel_lookup`** routing table (one row per funnel/step/page), NOT from the page doc's `url`. | `POST funnel-page/{pageId}` alone updates the page doc while the live route keeps the old path, **silently**. Recipe 10 needs all three calls. |
| 4 | `funnel-step-page-url` returns **`ok: true` for a path that is already taken**. | Reading `ok` as availability is always wrong; compare `uniqueUrl` to what you asked (§10). |

### The UI path for the funnel container (optional — API-created funnels render fine)

Still the safest route if you want a human to pick the domain. The minimum:

`Sites → Funnels → New funnel → From blank`
→ funnel renders correctly
→ funnel `Settings` tab → pick **Domain** from the dropdown → pick **Chat widget** → Save

Once a healthy funnel exists, **every step and page under it can be built via the API**:
`create-step` (§2) → `autosave` (§4) → `get-versions` + `publish-version` (§7) →
`funnel-page/{pageId}` (§10) → verify the public URL. Live-proven 2026-08-10.

The rest of the old click-path is still the correct **manual** route if you want it:
`Add new step or import` (name + path) → step `Overview` → `Create from blank` → opens
`/location/{loc}/page-builder/{pageId}` (an iframe named `funnel-builder`) → Publish.
The gear on the control thumbnail → **"Edit page details"** is the UI equivalent of
recipe 10, and is where that endpoint was captured.

### Chat widgets

- The funnel doc carries **`chatWidgetId`** and **`isChatWidgetLive`**. Funnel Settings
  has a native **Chat widget** selector backed by those two fields — that is the correct
  way to put a widget on a funnel.
- ⚠️ `https://api.gohighlevel.com/message/get_chat_widget/{locationId}` is a **DEMO
  PREVIEW, not a working widget.** Its panel is pre-populated with placeholder content
  (an agent called "Jane Doe", canned lines, messages timestamped "20m ago" that were
  never sent) and **submissions there go nowhere** — no contact is created and no
  workflow enrolls. To test a widget you need it embedded on a real published page.
- 🔴 **The widget's `Chat type` must MATCH the agent's channel.** An agent on `Live_Chat`
  needs a **Live Chat** widget. Chat type is a property of the widget (Sites → Chat
  Widget), not of the funnel. A mismatch produces **silence with no error anywhere**.
- ⚠️ **Widget names carry no information.** On AU, "Chat Widget 1" was a `Voice AI`
  widget and "Chat widget 2" was `SMS / Email chat` — neither was Live Chat. Read the
  list's **`Chat type` column**, never the name.

### Publishing an empty page does not take

Publishing a page with **no content** via the builder's Publish button left the public
URL still serving the pre-publish shell (`stcdn.leadconnectorhq.com/_preview/…`, body
length 0), containing **no chat-widget reference at all** despite the widget being
attached at funnel level.

UNRESOLVED — either publish silently no-ops on an empty page, or funnel-level widget
injection requires `isChatWidgetLive`. **Put at least one real element on the page
before publishing**, and check `isChatWidgetLive` on the funnel doc. Do not report a page
as live off a Publish click alone; fetch the public URL and confirm non-empty content
(§0 applies here too).


---

## 11. Attach a domain, and what the four public URLs are

`GET /funnels/domain/?locationId=` lists what the account owns:

```jsonc
{ "domains": [ { "id": "<domainId>", "url": "<the hostname>", "defaultDomain": true,
                 "defaultPage": "<a step uuid>", "nameServer": "…", "provider": "…",
                 "robotsTxtCode": "", "steps": [], "locationId": "…", "companyId": "…",
                 "deleted": false } ] }
```

Attachment is a **funnel setting**, not a domain call:

```
POST /funnels/funnel/update-settings
{ "locationId", "funnelId", "funnelName", "funnelPath", "domainId",
  "allowPaymentModeOption": false,          // ← REQUIRED, and not in the form's own payload
  "faviconUrl", "chatWidgetId", "headTrackingCode", "bodyTrackingCode",
  "imageOptimization", "isGdprCompliant", "isOptimisePageLoad" }
```

🔴 Omit `allowPaymentModeOption` and the whole write is refused —
`422 ["allowPaymentModeOption should not be empty","allowPaymentModeOption must be a boolean value"]` —
so the `domainId` silently does not attach while the funnel still reads back fine on every other
field. Verify with `GET /funnels/funnel/fetch/{funnelId}` and check `domainId` is non-empty.

Remember this is a **whole-settings write**: read the funnel first and fill every field you do not
mean to change, or you clear its tracking codes and favicon and detach its chat widget.

### The four URLs

| What | Shape |
|---|---|
| funnel URL | `https://<domain><funnel.url>` — serves the first step |
| step URL | `https://<domain><lookup.path for the step uuid>` |
| page URL | `https://<domain><lookup.path for the pageId>` |
| variation URL | **does not exist** — a split variation has no lookup row |

All three that exist return `200` with the same `<title>`.

🔴 **Attach the domain BEFORE creating steps.** Routing rows are minted per domain and stamped from
the funnel path as it stood at that moment. Steps created first get flat rows (`/alpha`) instead of
nesting under the funnel path (`/<funnel>/alpha`). Fixable with recipe 10, but cheaper to order the
calls correctly.

`POST /funnels/funnel/create` **derives `url` from `name`** — a funnel named `"TEST-CAP Domain
Probe"` comes back at `/test-cap-domain-probe` with no path ever supplied.

Path matching is **case-insensitive** (the lookup row carries `pathLowercase` beside `path`).

### Verifying a public page measures Cloudflare unless you defeat it

```
cache-control: max-age=60, stale-while-revalidate=30, stale-if-error=1800
vary: Accept-Encoding
```

🔴 The **query string is not in the cache key**, so `?cb=<random>` does not bust it, and a
request-side `cache-control: no-cache` is ignored — 26 samples nine seconds apart all returned
`cf-cache-status: HIT`. Read `cf-cache-status` on every sample. Get a fresh key from **path shape**
(`/Alpha` is a distinct key that serves the same row) or by moving the row with
`PUT /funnels/lookup/{lookupId}`.

---

## 12. Split tests — configured by API, and inert

```
POST /funnels/funnel/clone-control-page/
{ "locationId", "pageId": "<control pageId>", "stepName": "<step name>", "domainName": "<any non-empty string>" }
→ 201 { pageId }        // copies the control's content, same stepId

PUT /funnels/funnel/step/{funnelId}
{ "stepId", "pages": ["<control>", "<variation>"], "split": true, "control_traffic": 50,
  "split_started_at": "<ignored — the server stamps its own>", "split_ended_at": null,
  "route_all_requests": false, "additional_routes": [] }
→ 200
```

🔴 **Neither create route puts its page on the step** — `pages[]` is seeded by `create-step` and
thereafter maintained only by this `PUT`. Clone a variation and stop, and you have made a page the
funnel does not know about.

🔴 **Write keys are snake_case; the read returns camelCase** — `control_traffic` → `controlTraffic`,
`route_all_requests` → `routeAllRequests`, `split_started_at` → `splitStartedAt`.

🔴 **And it routes nothing.** On a funnel with a real domain, `split: true`, `control_traffic: 0`,
`route_all_requests: false` and **both pages published `live`**, 43 genuine origin decisions all
served the control. The variation has **no routing row** (`GET /funnels/lookup/type/{variationPageId}`
→ `404`, `path: null`), so there is nothing to link to or preview. Two explanations were tested and
rejected: publishing (no change) and a client-side assignment (a real browser rendered the control,
no redirect, no variant cookie, the variation's `pageId` absent from the document).

Not proven impossible — something the builder UI does was not reproduced, and no split-arming
endpoint exists in the funnels surface or the page-builder bundle to imitate. **Do not tell a user
their A/B test is running** off these two calls: say it is configured and unverified, or set it up
in the UI.

---

## 13. Publish — the version list is a bare array

```
GET  /funnels/builder/get-versions?pageId=&locationId=     → [ { version_id, pageType, updated_at, … }, … ]
POST /funnels/builder/publish-version { pageId, versionId, userId }   → 201
```

🔴 **The response is a BARE ARRAY**, not `{versions: […]}`, and each row's id is snake_case
**`version_id`** — not `versionId`, which is the name `publish-version` takes in its own *body*. A
caller that reads `.versions` or `row.versionId` gets `undefined`, publishes nothing, and sees no
error. Verify by re-reading `get-versions` and confirming a row now reads `pageType: "live"`.
