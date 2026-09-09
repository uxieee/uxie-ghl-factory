# Which READ verifies which WRITE

On this rail, **for every write you need to know which read confirms it, and it is rarely the
obvious one.** Several of the obvious reads actively lie: they return `200` with a shape that looks
like confirmation and is not. This page is that mapping.

Every row was established by executing the write and then reading it back on a separate request.

| the write | the read that VERIFIES it | 🔴 the read that LIES |
|---|---|---|
| `POST /funnels/funnel/create-step` | `GET /funnels/page?locationId=&funnelId=&limit=20` — each page carries `stepId`; a page with none means the step was minted without an id | `GET /funnels/funnel/fetch/{id}` — an id-less step appears in `steps[]` looking perfectly well-formed. The defect is an **absence**, and absences do not catch the eye |
| `POST /funnels/builder/autosave/{pageId}` | `GET /funnels/builder/page/data?pageId=` — compare the section ids you sent against those stored | the `201`. Autosave is a blind store: an invented `meta` and a node missing declared props both round-trip exactly like a real one |
| `POST /funnels/builder/publish-version` | `GET /funnels/builder/get-versions?pageId=` — assert **that** version now reads `pageType: "live"` | the publish `201`; and a **bare array** whose id key is snake_case `version_id`, so a caller reading `.versions` or `row.versionId` gets `undefined`, publishes nothing, and sees no error |
| the public page after any write | fetch the URL **and** read `publishState`/`get-versions` first | the public fetch alone. A page pinned to a published version serves THAT version — your write is stored, correct, and invisible |
| `POST /funnels/funnel/funnel-page/{pageId}` with `meta` | **the rendered page** — check `<title>` | `GET /funnels/page/{pageId}` — it omits `meta` entirely, so every SEO write reads back as never made |
| `POST /funnels/funnel/update-settings` | `GET /funnels/funnel/fetch/{id}` — compare every field you sent | the `201`. It has a fixed field whitelist: an unknown key (`isStoreActive`) is accepted and discarded, and `chatWidget: true` is accepted and ignored — the widget attaches by `chatWidgetId` |
| a path move (`PUT /funnels/lookup/{lookupId}`) | `GET /funnels/lookup/type/{id}`, then fetch the public URL | the page document's `url`. Writing it updates what the builder shows while the live route keeps serving the old path |
| a domain attach | `GET /funnels/lookup/list?funnelId=&locationId=`, then fetch **every** step URL | `pathsUpdated: true` — the whole report. It silently renames a colliding step and mints **no row at all** for a held path |
| `POST /funnels/builder/global-sections/{funnelId}` | the numeric suffix of **`globalSectionsPath`** | `globalSectionVersion` — a separate counter that drifts from the path. Keying off it overwrites a file that already exists |
| a split test | the **`Location` header of a `302`** | comparing rendered bodies. The router redirects; a probe that follows redirects sees the control forever |
| attaching a chat widget | the served HTML contains the widget id | the `201` from a page-builder payload carrying `chatWidget: <bool>` |
| republishing with new copy | the JSON-LD block in the render | the body alone — generated schema.org markup is pinned to the FIRST publish and never regenerates |

## Two habits that make these reads trustworthy

**Read back on a SEPARATE request.** A response body echoing your own input proves the request
parsed, nothing more.

**Poll through non-200s, and poll for something unique to THIS write.** The compile is asynchronous:
the first request after a save can serve the previous compile, so returning on the first `500`
reports the previous version's error as this run's. A freshly minted node id is the marker.

🔴 And when the read is a public URL, remember the query string is **not** in Cloudflare's cache key.
`?cb=<random>` measures the cache. Vary the path's CASING instead — matching is case-insensitive, so
`/Alpha` is a fresh cache key onto the same routing row.
