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
> lands on the draft and is served by the `/preview/{pageId}` URL, while the
> **public URL keeps serving the previous content**. Publishing is a SEPARATE
> call — recipe 7. See "Draft vs published" below before reporting any page live.

## 0. Draft vs published — read before reporting a page shipped

`POST /funnels/builder/autosave/{pageId}` returns `201` and writes the **draft**.
That is the full extent of what every write recipe in this file does *except*
recipe 7.

- `https://<funnel-domain>/preview/{pageId}` → serves your new content immediately.
- `https://<funnel-domain>/<funnel-path>/<page-path>` (the **public** URL) →
  keeps serving the OLD content.

This is a genuine publish gate, **not CDN cache**: the public URL was polled with
cache-busted requests for 4+ minutes and never changed (observed live 2026-07-21).

Confirmed at the data layer 2026-07-19: an `autosave` creates a version stamped
**`pageType: "draft"`** (visible via `GET /funnels/builder/get-versions?pageId=`).
Publishing flips that same version to **`pageType: "live"`**.

**Therefore:** a `201` from `autosave` plus a green `/preview/` check means *"the
draft is correct"*, NOT *"the customer sees it"*. Verifying only the preview URL
is how a push gets reported as succeeded while the customer still sees the old
page. Finish the job with recipe 7, or say plainly that publishing is outstanding.

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
- Proven at the DATA layer: the version flips `draft → live` and the page doc
  agrees. The probe funnel had **no domain attached**, so serving-from-the-public-URL
  was NOT separately confirmed. Verify the public URL on a funnel that has a domain
  before telling a client the page is live.
- Related endpoints on the same service, seen in the bundle but NOT exercised:
  `POST /funnels/builder/restore-version` (same `{pageId, versionId, userId}` shape)
  and `POST /funnels/builder/delete-version-history-data`.

---

## 8. Delete a funnel

**Endpoint:** `POST /funnels/funnel/delete`
```json
{ "funnelId": "<id>", "locationId": "<loc>", "userId": "<uid>" }
```
`→ 201 { "domains": [], "paths": [] }`; the funnel disappears from
`/funnels/funnel/list`.

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
- `type` is only proven as `"funnel"` — no other value was tested; don't
  invent alternatives (e.g. a `"website"` type).
- Proven live on GROM Digital AU (funnel `RipeI1dmKTAtdKQSbBVy`).

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

**Known limits:**
- `"optin_funnel_page"` is the only proven `step.type`. `pages: []` is sent
  empty in every proven call — its purpose beyond that isn't explored;
  don't invent contents for it.
- Proven live (page `pWOizhNP5hBqHtVNLgfu`).
- The freshly created page's *default* section/row/col skeleton was not
  independently exercised — the proven build path (recipe 3) reads an
  **existing** page's `pageData` as a structural template and clones it
  rather than hand-building a section tree from scratch. Treat "build a
  page's content from nothing but this recipe" as unproven; always start
  from a real `GET /funnels/builder/page/data?pageId=` response (either the
  new page's own, or a known-good existing page) and edit that.

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
known-good page's structure).

**Verification:** fetch the live rendered preview,
`https://<funnel-domain>/preview/{pageId}?z=<cache-bust>`, and confirm (a)
your HTML/marker is present in the response, and (b) the section/content
elements measure `0,0` padding (i.e. edge-to-edge).

This verifies the **draft only**. To report on what the customer sees, fetch the
**public** URL too and state the result explicitly — an unchanged public URL is
expected here, not a failure (§0).

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
recipe 3) — or fetch any page in the funnel's rendered preview and confirm
the markup appears in `<head>`/before `</body>`.

**Known limits:**
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

**Verification:** fetch the page's rendered preview and confirm the
injected markers are present in `<head>` and before `</body>` respectively
(the proven script polls the live preview URL and checks
`indexOf(marker) < indexOf("</head>")` / `< lastIndexOf("</body>")`).

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

**Verification (if ever run):** fetch the rendered preview and confirm
title/description/keywords appear in the served `<head>`.

**Known limits:**
- Genuinely needs two different tokens — the only recipe in this file that
  does.
- The autosave step alone does nothing for SEO; skipping step 1 above and
  only doing step 2 leaves `meta` unchanged.
