# `edit_funnel` — every op, with its arguments and traps

The tool description names the ops. This page holds the detail. Claude Code cuts every tool description at
2,048 characters.

One op per call. Preview by default; `confirm: true` writes and reads back on a separate request.

## Ops

| op | arguments | what to know |
|---|---|---|
| `settings` | `settings {…}` — only the fields to change; `resetSplitTests: true` for a domain change | sends the UI's FULL `update-settings` body from a fresh read, every unnamed value DERIVED as the Settings page derives it (an absent `autoGenerateSchema` is `false`; the Live/Test payment option only when the funnel stores a mode or the location has no Stripe key). After the write EVERY settings key is re-read: a field you did not name that changed fails the call (`unrequestedChanges`). 🔴 Changing or removing the domain of a FUNNEL that has one stops every split test, ARCHIVES the variation pages and clears split stats — refused unless `resetSplitTests: true` (the page builder asks the same). Without it GHL would leave a split running on a funnel with no domain. A domain carrying a regex/wildcard redirect, or not on the location, is refused |
| `create-step` | `step {name, url, type?}` | refused when the funnel has no domain: such a step gets no lookup row and 404s. `type` is `optin_funnel_page` / `sales_funnel_page` / `misc_funnel_page`. `url` follows the builder's rule: `/` + lowercase letters, digits, `-`, `_`, `/`; at most 5 segments; the reserved runs (`/store/account`, `/b`, `/c`, `/product`, `/collections`, `/post`, `/category`, `/author`, `/tag`) are refused. The same rule guards `update-step` |
| `update-step` | `stepId`, `name?`, `url?` | one PUT moves the live route, and renames the step's page record as the UI does. Cloudflare may serve the old path for minutes, so it never retries |
| `reorder-steps` | `order` — every step id, in the new order | the route replaces the steps array, so a partial list is refused; each step goes back as its FULL stored object (a split step keeps its split keys) with `sequence` renumbered; a funnel with store pages is refused (they follow a fixed order — the builder does not let them be dragged) |
| `clone-step` | `stepId` | |
| `delete-step` | `stepId` + `expectName` (its current name) | target check |
| `publish-page` / `unpublish-page` | `pageId`; unpublish takes `redirect? {type: "404" \| "url" \| "step", url?, stepId?}` (`step` = "Choose from existing steps in this funnel": `action:"funnel"`, target = the step id; the step must have a domain attached) | the builder's own route, `PUT /funnels/lookup/multiple`, on the step and page rows. Unpublish answers 404, or 301 to a URL. No version is created: to publish CONTENT, use `build_funnel_page publish:true` |
| `add-header` | `header {key, value}` — a custom response header | applies to the EXACT-CASE path only |
| `edit-header` | `header {key, value}` | `PUT /funnels/funnel/headers`; only the value changes (the key is locked); the key matches case-insensitively and is sent as stored |
| `delete-header` | `header {key, expectValue}` | `POST /funnels/funnel/headers/delete {locationId, funnelId, key}`. A header has no id, so the target check is the EXACT key AND its current value — a wrong value refuses, nothing sent |
| `add-event` | `event {pixelId, level: funnel \| page, events[], pageIds?}` | Meta Pixel event (Events tab): events from `page_view view_content initiate_checkout add_payment_info purchase`; the Conversions API stays OFF (its access token is a credential the tool layer refuses — set it on the Events screen); a duplicate pixel+level is refused |
| `edit-event` | `event {eventId, expectPixelId, …changes}` | `PATCH /funnels/event/{id}`; id AND pixel proven; an event that sends via the Conversions API is refused (its token is unreadable and the PATCH would blank it) unless `conversionApi:false` |
| `delete-event` | `event {eventId, expectPixelId}` | `DELETE /funnels/event/{id}`; id AND pixel proven. Event writes also call `POST /funnels/domain/invalidate-cache` as the screen does — without it the public page kept the old pixel for 5+ minutes (measured) |
| `split-test` | `action` + its argument | `add-variation {variationPath}`: a draft copy of the control on its own path, pre-checked. `start {controlTraffic, routeAdditional?}`: changes live traffic; when the step is also served at other domains or paths it refuses until `routeAdditional` (true = route them through the split, as the modal's question) is answered. `declare-winner {winnerPageId}`: the other page is archived and the split ends. EXACT-CASE path only |
| `delete-funnel` | `funnelId` + `expectName` | refused while any page still serves, so unpublish first. The edge can serve the deleted page for ~70 s |
| `clone-funnel` | `{name}` | a copy in THIS location. The route returns no id, so the name must be unused and the copy is found by it. The copy has NO domain and NO public paths, and keeps the source's step urls. Attaching the source's domain renames each colliding path with a numeric suffix |
| `archive-page` | `{pageId, expectName}` | what the UI calls "delete — permanently": the page is ARCHIVED and can be restored. Refused on the only page of a step and on a running split |
| `restore-page` | `{pageId}` | puts an archived page back on its step. It gets a NEW public path minted from the page name; the old path stays 404 |
| `import-page` | `{stepId, sourceFunnelId, sourceStepId, sourcePageIndex}` | a copy of another step's page, as the target step's second page. Products are NOT imported |
| `add-store` | — | 5 store steps on fixed domain-level paths, pre-checked. GHL creates the pages EMPTY, so each is then filled with its store element. 🔴 LOCATION-WIDE side effect: saving the checkout in the builder creates a "Billing Info" contact-field folder and 7 billing fields |
| `add-step-product` | `{stepId, expectName, productId, priceId, displayText?, quantity? {max, allowMultiple}, bump?}` | the step's Products tab: what its order form lists and what a one-click up/down-sell button sells. Target check on the step id AND name. The price must be one of that product's prices. An identical product+price already on the step is refused. Returns `stepProductId`, the id a sell-product button stores as `productId {id}`. |
| `edit-step-product` | `{stepId, stepProductId, expectName, displayText?, quantity?, bump?, authorizeAmount?}` (product and price stay as stored) | `PUT /funnels/order-form/products/{id}`; target check on the step product id AND name; read back and compared. `quantity.max` 1–999, a bump is always 1 unit |
| `delete-step-product` | `{stepId, stepProductId, expectName}` | `DELETE /funnels/order-form/products/{id}`; target check id AND name; the reread must no longer list it |

## Not offered — and where it is done

- **Sharing a funnel.** Opening the Share modal creates a link anyone can import, and below the $497 plan it
  cannot be narrowed or removed. Read a share with `get_funnel` view `share`. Create one in Sites → ⋮ → Share,
  and only on purpose.
- **Page-level settings.** Page SEO, tracking code, custom CSS and background are PAGE writes: use
  `build_funnel_page` edit mode (`seo`, op `page`).
- **A bare extra page** (`create-page`). It makes an ORPHAN page on no step. `create-step` makes a step with its
  page, and `split-test add-variation` adds a second page.
- **Funnel FOLDERS** (create, rename, move). They are organisational only, and are left to the Sites screen.

## Siblings

- `create_funnel` makes the document.
- `get_funnel` reads it.
- `build_funnel_page` writes page content.
- `audit_site` audits.
