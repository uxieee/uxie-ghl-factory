# Websites, global sections and section libraries

Everything in [`authoring-and-design.md`](authoring-and-design.md) applies unchanged: **a website IS
a funnel document** with `type: "website"` — same steps, same page builder, same element vocabulary.
A key-set diff against populated funnels finds nothing website-specific in either direction. Only the
things below differ, and each one is a way to be wrong while every API call returns success.

## The list `type` is a UI TAB, not the document type

```
GET /funnels/funnel/list?locationId=&type=&category=all&offset=&limit=
```

`funnel`, `website` and `store` filter. **`funnel-website`, `blog`, `all` and omitted return
EVERYTHING, unfiltered** — an unrecognised value is not rejected. A `store` is a `website`-typed
document that the store tab selects. Never infer a count from a filter you have not proven filters.

## 🔴 Global sections resolve PER SECTION ID

A section flagged `isGlobal: true` exists twice: inline in every page's `sections[]`, and once per
funnel in Firebase (`globalSectionsUrl`, path `funnel/<id>/global-sections-<n>`, a bare array of whole
sections).

> The funnel-level file wins **where it carries that section id**. Where it does not, the page's
> **inline copy renders** as a fallback.

So the two operations are asymmetric:

- **Edit** a global section → one call, funnel-level. Every page picks it up, no per-page save.
- **Delete** one → **two calls**. Drop it from the file AND from every page's `sections[]`, or the
  pages fall back to their inline copies and keep rendering it.

Editing the inline copy through `builder/autosave` returns `201`, reads back with the change stored,
and renders nowhere while the file still carries that id. `auditPageData()` flags any `isGlobal`
section for exactly this reason.

```
POST /funnels/builder/global-sections/{funnelId}
{ "sectionData": [ …whole sections… ], "version": <n> }   → 201 {globalSectionsPath, globalSectionsDownloadUrl}
```

🔴 **Take `version` from the numeric suffix of `globalSectionsPath`, never from
`globalSectionVersion`.** They are separate counters that drift — sending `5`/`6`/`7` produced version
fields `1`/`2`/`3`. The path is what `globalSectionsUrl` serves and what the pages render; keying off
the version field picks a number that already exists and silently overwrites that file.

## Section libraries: three sidebar entries, one API

| sidebar | type written |
|---|---|
| Section templates / Prebuilt sections | `template` |
| **Universal sections** | `sync` |
| Global sections | the per-funnel file above |

```
GET  /funnels/builder/prebuilt-section?locationId=          → {prebuiltSections[], count, access[]}
GET  /funnels/builder/prebuilt-section/{collectionId}/template?locationId=&prebuiltSectionTemplateType=&page=&limit=
POST /funnels/builder/prebuilt-section/{collectionId}/template
POST /funnels/builder/prebuilt-section/sync/changes         { pageId, pageData }
```

`limit` **must not exceed 20** (`limit=50` → `422`, whose body is easy to misread as an empty list).
A create with too thin a body answers **`401`**, which here is validation, not auth.

Creating a synced section takes `sectionData` as **ONE section object** — the opposite of
`global-sections`, which takes an array. The page↔template link is
**`section.metaData.prebuiltSectionTemplate`**, an embedded object one level BELOW the section, so a
scan of section top-level keys will not find it.

**The `access: []` write gate is real at the COLLECTION level**: creating a template inside an
existing collection succeeds, creating a new collection returns `401` however the body is shaped.

## Routing: no domain, no routes

Lookup rows are minted **when a domain is attached**, not when a step is created. Before the attach
`GET /funnels/lookup/type/{id}` 404s for pageId, stepId and funnelId alike — on a website and on a
plain funnel.

After it, **each step has TWO lookup rows and both serve, as aliases**: the step id carries the clean
path (`/home`), the page id carries a suffixed one (`/home-page443958-4238`). A page record whose
`url` disagrees with its step's `url` is normal and needs no repair.

```
/home                   200   steps live at the domain ROOT
/saas                   200   funnel.url serves the FIRST step only
/saas/home              404   funnel.url is NOT a path prefix
/                       404
/preview/{pageId}       404   🔴 preview serves on the AGENCY domain only, never a custom one
```

## Page meta: the write lands, the read-back lies

`POST /funnels/funnel/funnel-page/{pageId}` with `{name, url, meta:{title, description, …}}` returns
`201` and the rendered `<title>` changes — while `GET /funnels/page/{pageId}` **has no `meta` key at
all**. Verify page meta on the RENDER; a read-back through the page record reports every page as
untouched. That record is metadata-only in general: the page BODY lives behind `pageDataDownloadUrl`.

Merge tags resolve server-side in page content and in `<title>`. A tag that came back **consumed and
empty** means the pass ran and found no value; a literal `{{…}}` surviving is the negative result.

## `update-settings` is a full REPLACE

It rejects a partial body, naming one more required field per attempt. The whole payload:

```jsonc
{ locationId, funnelId, funnelPath, funnelName, domainId, faviconUrl,
  headTrackingCode, bodyTrackingCode, allowPaymentModeOption, paymentMode,
  chatWidget, imageOptimization, isGdprCompliant, isOptimisePageLoad }
```

🔴 **`isStoreActive` is not one of its fields, and sending it returns `201` and changes nothing.** It
is written by the store-creation flow. The endpoint has a fixed whitelist: unknown keys are accepted
and discarded.

## References to other assets are `{value, text}`

`form.extra.formId` is `{"value": "<formId>", "text": "<form name>"}` — never a bare string. A scan
for `"formId":"<id>"` matches nothing on a page that carries a live reference; match on
`extra.formId.value` or on `element.meta === "form"`. `auditPageData()` refuses the bare-string shape.

🔴 **Every form embed that arrives with a template points at the SOURCE account's form.** Swept
live 2026-09-10: 49 of 51 embedded ids on a template-built account did not exist there, and the page
renders the literal **"Unable to find form"**. The `text` field carries the CORRECT form name beside
the wrong id, so a visual check and a name-based grep both pass. Three shapes fail the same way: a
foreign id, the literal `"none"` (what the AI generator writes when the account has no forms), and an
unsubstituted `"{{ webinar_formId }}"`. Clone and snapshot remap form OBJECTS but not page embeds.

**Before any launch on a template-derived site**, collect
`[...JSON.stringify(pageData).matchAll(/"formId":\{"value":"([^"]*)"/g)]` for every page and diff
against the account's own form ids. Anything not in that set is dead lead capture. The same node
also carries `action` + `visitWebsite.url` for the post-submit redirect — check it in the same pass.

A **partial snapshot push** remaps ids for the assets included in the push and leaves references to
**excluded** assets pointing at the source account — the page renders "Unable to find form" while
every API read looks clean. Pushing `funnels` without `forms` is the common case.
