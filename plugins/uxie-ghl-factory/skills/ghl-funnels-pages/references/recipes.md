# Recipes — GHL internal funnels/pages API

Host: `https://backend.leadconnectorhq.com` (paths below are relative to this
host — e.g. `/funnels/funnel/create` means
`POST https://backend.leadconnectorhq.com/funnels/funnel/create`).

Source: `ghl-workflow-api-docs/docs/superpowers/specs/2026-07-11-pipelines-funnels-html-injection.md`
(sections 2–3) and the dev scripts in that repo's
`skills/create-ghl-workflow/dev/`: `build-funnel-page.mjs`, `fullbleed.mjs`,
`page-trackingcode.mjs`, `seo.mjs` (probed via `probe.mjs`). Every payload
below is copied from those two sources — nothing invented.

> ⚠️ **Auth: `/funnels/*` uses `token-id`, NOT `Authorization: Bearer`.** Every
> recipe below previously said "Bearer JWT"; that was wrong and the endpoints
> reject it. The 2026-07 migration to `Bearer` was **workflow-builder-only** —
> funnels still run the older scheme. Corrected 2026-07-21 after a live build.

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
> `builder/publish-version` (§7) → **`funnel/funnel-page/{pageId}` (§10)** →
> verify the **public URL**.
>
> **§10 is not optional** — without it the page is live, correct and unreachable
> (see the two-paths warning in §10). This supersedes the previous banner here, which
> claimed an API-created page "can never be published". That was wrong; §2 and §9
> explain what the 422 actually was.

> ⚠️ **`funnel/create` (§1) is still unproven** — the 2026-07-25 spinner-hang was
> never re-tested. Create the **funnel** in the UI (§9 click-path); create its
> **steps and pages** via these recipes.

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

`https://<funnel-domain>/preview/{pageId}` **301s to the funnel's first step** — even
for a page that is published, correct and serving fine on its public URL. Live-observed
2026-08-10. Earlier revisions of this file told you to verify against `/preview/`; on a
domained funnel that produces a **false failure report**.

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
- Do **not** verify with `/preview/{pageId}` on a domained funnel — it 301s to the
  funnel's first step even for a known-good page (§0).
- Related endpoints on the same service, seen in the bundle but NOT exercised:
  `POST /funnels/builder/restore-version` (same `{pageId, versionId, userId}` shape)
  and `POST /funnels/builder/delete-version-history-data`.

---

## 10. Set the PAGE path (required — the public URL resolves this, not the step url)

**Purpose:** set the path the public URL actually serves the page at. **This is a
required final step of every create sequence**, not optional polish.

**Status: live-proven 2026-08-10** on a real client funnel with a real custom domain
attached. Endpoint captured from the UI's own request (gear on the control thumbnail →
"Edit page details" → Save), not guessed.

### 🔴 A funnel step has TWO paths

| Thing | Where its path lives | Edited in the UI via |
|---|---|---|
| the **step** | `step.url`, set in the `create-step` payload (§2) | step settings |
| the **page** (the CONTROL variation) | its own separate **Path** field | gear on the control thumbnail → "Edit page details" |

**The PAGE path is the one the public URL resolves.** And `create-step`
**auto-appends `-page`** to the page path it derives from `step.url`.

So a step created with `url: "followup"` yields a page path of **`/followup-page`**,
while **`/followup` 301s to the funnel's first step**. The page is live, correct and
unreachable — a correct build that looks exactly like a broken publish.

Corroborating evidence on the same funnel: the attendance step's `url` is
`/attend-pagee` while its page path is `/attend` — and **`/attend` is the URL that
serves**. The two drift apart freely; never infer one from the other.

**Endpoint:** `POST /funnels/funnel/funnel-page/{pageId}`
```json
{ "url": "/followup", "name": "Follow-Up" }
```
`→ 201`

**Required IDs:** `pageId` (server-assigned by `create-step`, §2). Note the funnel id
and location id are **not** in this body — the path param carries the whole address.

**Availability pre-check (what the UI does first):**
```
GET /funnels/funnel/funnel-step-page-url?name=&path=&type=page&domain=<funnel domain>
```
The UI fires this before the POST as an availability check. Captured as a request only —
its **response shape was not recorded**, so do not branch on it. It is safe to skip the
pre-check and rely on the POST, but if you do call it, treat any parse of its body as
unverified.

**Verification:** fetch the **public URL** `https://<domain>/<funnel-path>/<new-path>`
and confirm your content (and that it is a `200`, not a `301` to the first step).
`GET /funnels/page/{pageId}` also reflects the new `url`. **Do not verify with
`/preview/{pageId}`** — §0.

**Known limits:**
- Proven for the CONTROL variation of a step. Split-test variations
  (`split: true`, non-control pages) were not exercised — don't assume the same call
  addresses them.
- Only `url` and `name` were sent. Other "page details" fields the UI form exposes were
  not captured; don't invent keys for them.
- Whether this call needs a leading `/` is not independently tested — the captured
  request sent `"/followup"`, with the slash. Send it the way the UI did.

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
- ⚠️ **The funnel this creates could not be opened in the UI** — the detail view hung
  on a spinner indefinitely, while UI-created funnels in the same account opened
  instantly. The call returns `201` and the funnel doc exists, so this looks like
  success and is not. Live-observed on AU 2026-07-25 and **never re-tested since**.
  **Create funnels through the UI (§9)** and use these recipes to write into them.
  - Scope note (2026-08-10): the *other* half of the old conclusion — that the page
    could then never be saved or published — **was wrong**, and was a body-shape
    error in the caller (§2, §9). That correction does **not** clear this defect.
    Whether the spinner-hang was the same caller mistake, a real malformed funnel
    doc, or since fixed by GHL is **unknown**. Treat `funnel/create` as unproven
    until someone re-runs it and opens the result in the UI.
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

🔴 **`step.url` is NOT the page's public path.** `create-step` **auto-appends `-page`**
to the page path it derives from `step.url` — a step created with `url: "followup"`
yields a page at `/followup-page`, and `/followup` 301s to the funnel's first step.
**Every `create-step` must be followed by recipe 10** to set the real page path, or the
page ships live, correct and unreachable.

**Known limits:**
- `"optin_funnel_page"` is the only proven `step.type`. `pages: []` is sent
  empty in every proven call — its purpose beyond that isn't explored;
  don't invent contents for it.
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
- 🔴 **Empty strings are IGNORED, not applied.** Sending `domainId: ""` and
  `bodyTrackingCode: ""` returns `201` and changes nothing — the previous values
  are still there on read-back. So this endpoint can SET a field but cannot
  CLEAR one, and a `201` is not evidence the payload took. Always verify with
  the fetch GET below. Deleting the funnel was the only removal that worked.
  Live-confirmed on AU 2026-07-25.
- Consequence for the payload above: `domainId: ""`, `faviconUrl": ""` and
  `chatWidgetId: ""` are **inert filler** — they neither set nor clear those
  fields. In particular this payload does **not** attach a chat widget, and
  cannot detach one. The funnel doc carries `chatWidgetId` and
  `isChatWidgetLive`; attach a widget through the funnel's Settings tab in the
  UI (§9), which is the only proven path.
- Because empty strings are dropped, you can safely send the full payload
  without wiping fields you did not mean to touch — but you also cannot rely
  on it to reset anything.
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

## 6. SEO metadata — EXPERIMENTAL, not fully covered by this plugin's auth doc

**Purpose:** set a page's SEO title/description/keywords/image/author/language.

**Status: proven live by the source investigation, but excluded from the
single-token flow this skill otherwise relies on.** Include this recipe only
with that caveat surfaced to the user before attempting it.

> Note: the 2026-07-21 auth correction (funnels are `token-id`, not Bearer)
> does **not** dissolve this recipe's problem — it renames one of the two
> tokens. SEO still needs a genuinely different credential class.

**Why it's different:** SEO metadata lives on the page's Firestore doc
(`funnel_pages/{pageId}.meta`), not in `pageData`. The `builder/autosave`
endpoint (`token-id`, same as every other recipe here) **ignores a
top-level `meta` key** — verified twice in the source investigation. There
is no `token-id` REST endpoint for SEO; GHL's own builder writes `meta`
directly to Firestore using a **separate Firebase ID token** (obtained via a
`signInWithCustomToken` exchange during the builder's page load, itself
minted by `POST /oauth/users/{uid}/sessions/token`). **This plugin's
canonical auth doc (`${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md`)
documents the workflow Bearer rail (§1), the AI `token-id` rail (§7), the
memberships rails (§8) and the funnels `token-id` rail (§9) — but not this
Firebase ID token.** That gap is the reason this recipe is experimental
here rather than a first-class recipe: don't attempt it without first
extending the auth capture procedure (and getting that reviewed), and never
improvise a token format in its place.

**Shape, for reference (source-faithful, not to be run without the missing
auth step above):**
1. Write `meta` on the Firestore page doc — a PATCH to the Firestore REST API
   (`firestore.googleapis.com`, project `highlevel-backend`, database
   `(default)`, document `funnel_pages/{pageId}`, field mask `meta`), body
   `{"fields":{"meta":{"mapValue":{"fields":{"title":{...},"description":{...},"keywords":{...},"imageUrl":{...},"author":{...},"language":{...},"canonicalMeta":{...},"customMeta":{...}}}}}}`
   — authenticated with the Firebase ID token described above (not the
   funnels `token-id`).
2. Trigger a normal `POST /funnels/builder/autosave/{pageId}` (`token-id`,
   current `pageData` unchanged) to force GHL to re-render the preview,
   which reads `meta` fresh at render time.

**Verification (if ever run):** fetch the published page at its **public URL** and
confirm title/description/keywords appear in the served `<head>`. (`/preview/{pageId}`
is not reliable on a domained funnel — §0.)

**Known limits:**
- Genuinely needs two different tokens — the only recipe in this file that
  does.
- The autosave step alone does nothing for SEO; skipping step 1 above and
  only doing step 2 leaves `meta` unchanged.

---

## 9. Create the FUNNEL in the UI; create its STEPS and PAGES via the API

**Superseded in part on 2026-08-10.** This section previously read "🔴 API-created
funnels are MALFORMED" and asserted four compounding defects. **Two of the four were
wrong** — they were one body-shape mistake in the caller, restated twice. The corrected
status:

| # | Original claim (2026-07-25) | Status |
|---|---|---|
| 1 | `POST /funnels/funnel/create` produces a funnel the UI cannot render — detail view hangs on a spinner indefinitely, while UI-created funnels open instantly. | ⚠️ **STANDS, un-retested.** Not reproduced or refuted since. Create funnels in the UI. |
| 2 | `POST /funnels/builder/autosave/{pageId}` **422s** on a new page, even on an unmodified echo of its own `page/data`. | ❌ **WRONG.** The 422 is a body-shape error (`pageData should not be empty, pageVersion should not be empty`) — `autosave` needs the **recipe-4 envelope**, and a raw `page/data` echo lacks the wrapper. Wrapped, it `201`s on a page created seconds earlier by `create-step`. |
| 3 | No autosave → no version → **"an API-created page can never be published."** | ❌ **WRONG**, and downstream of #2. The full sequence §2 → §4 → §7 → §10 → public URL is live-proven 2026-08-10 on a domained funnel. |
| 4 | `POST /funnels/funnel/update-settings` silently ignores empty strings (recipe 5a). | ✅ **STANDS.** Fields cannot be cleared; `chatWidgetId: ""` never attaches or detaches a widget. |

**The lesson worth keeping:** #2 and #3 were shipped as a hard "impossible" on the
strength of a 422 whose own message named the cause. A 4xx that names two missing body
fields is a **caller** defect until the body is proven correct — read the error text
before concluding the platform is broken.

New defects found 2026-08-10, not in the original table:

| # | Defect | Effect |
|---|---|---|
| 5 | A step's `url` and its CONTROL page's Path are **two different paths**, and `create-step` auto-appends `-page` to the page path. | The public URL 301s to the funnel's first step. Page is live, correct, unreachable. **Fix with recipe 10.** |
| 6 | `/preview/{pageId}` 301s to the funnel's first step on a **domained** funnel, even for a known-good page. | Preview-based verification reports a **false failure**. Verify on the public URL (§0). |

### The UI path for the funnel container (defect 1 stands)

Only the funnel container needs this. The minimum:

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
