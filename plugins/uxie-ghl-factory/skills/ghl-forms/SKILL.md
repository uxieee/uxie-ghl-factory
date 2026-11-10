---
name: ghl-forms
description: GoHighLevel forms, surveys and quizzes — the builders under Sites. Use when a task involves listing, reading, creating, editing, duplicating, foldering or embedding a form, when a form_submission trigger needs the form's real field tags, or when someone asks why a form edit lost fields, why a survey is not on the forms list, or what a form's public URL is. Also use before writing to any form by raw_request — the save merges at formData.form, so send only the keys you change.
---

# Forms, surveys and quizzes

The builders under **Sites → Forms / Surveys**. Corpus: `knowledge/corpus/forms/`, mapped and
live-proven 2026-09-06 across 133 saved probes.

**Three products, two collections.** Forms and quizzes share `/forms/*` and differ only by
`productType`; surveys have their own `/surveys/*` collection but call the **forms** routes for
delete, duplicate, share, folders and move-to-folder — and the survey list app ALSO calls the survey spellings of
duplicate, share, delete, folders and move-to-folder directly (mined 2026-09-08 and again 2026-09-29; see the forms
corpus page on surveys and quizzes). Both families exist; neither is run by a typed tool.

**Five typed tools cover the rail** — `list_forms`, `get_form`, `create_form`,
`update_form_data`, `list_form_submissions` — all live-fired on the sandbox 2026-09-07, thirteen
assertions including the one that matters: a `formAction`-only edit left `fields` and `style`
intact. Prefer them over `raw_request`, which carries none of the four traps below.

## The four traps, and why the tools exist

**1. The save MERGES at `formData.form`: a key you omit is kept, not deleted.** Measured 2026-09-08 (corpus `forms/40-rules/validators-and-quirks.md`, proven-live): a save that sent `formData.form = {fields}` alone kept `formAction`, `style`, `formSchedule`, `emailNotificationsConfig`, `autoResponderConfig`, `opportunitySettings` and `contactAssociationSettings`, read back on a separate request. To CLEAR a key, send it explicitly empty; leaving it out does not remove it. There is no patch — `PUT` and `PATCH` both 404. A raw `raw_request` that sends only the key you changed does not delete the rest of the form. `update_form_data` reads the current document, merges, writes the whole thing back, and its
preview lists the keys it is preserving so you can see what a raw write would have destroyed.

**2. A save issued too soon after a create returns 404.** `POST /forms/{id}` sent immediately after
the `POST /forms/` that made it answers `404 Form does not exist or is deleted` — seven times out
of seven. The identical body succeeds once the id is a few seconds old. A human in the builder
never hits it because a human is slower than the replica. `create_form` runs the save as a polled
retry rather than a bare call.

**3. Reads lag writes by seconds.** A `GET` right after a save returns the PREVIOUS document, and a
`GET` on a just-duplicated id answers `400 "Form does not exist"`. Both are current about four
seconds later. **A read-back is not proof until it shows the value you just sent** — the tools poll
until the tags match rather than reading once and declaring success.

**4. Two keys are renamed on write.** `formAction.redirect_url` → `redirectUrl` and
`style.ac_branding` → `acBranding`. Send either spelling; compare read-backs on the camelCase one.
A verifier that compares on what it sent reports a mismatch on a perfectly good save.

## Things that will catch you out

| | |
|---|---|
| **There is no draft state** | A form is live at its public widget URL the moment it is created. Nothing is staged, nothing is published. |
| **`formData` is world-readable** | `GET /forms/data/{id}` answers with **no credentials at all** — it is what the widget renders from. Every `versionHistory[].formDataDownloadUrl` is public too. Never put anything private in a form document. |
| **Unknown id → 400, not 404** | `{"message": "Form does not exist"}`. On the save path the same cause answers 404 with different wording — two validators, one cause. |
| **`type=form` is the row-kind switch** | Any other value, including omitting it, returns forms **and folders** in one array. `type` selects the row kind, not the `productType` — and the UI never sends one without the other: forms go as `type:"form"` + `productType:"form"`, quizzes as `type:"quiz"` + `productType:"quiz"`. `list_forms` sends them the same way: `productType: "quiz"` lists quizzes (includeFolders leaves `type` out). |
| **`count` counts folders too** | Three forms plus one folder answers 4. It will not agree with the number of rows you listed. |
| **Nothing inside `formData` is validated on save** | An invented key is stored and read back, and the builder's 2026-10 error detection (≈14 blocking rules) runs only in the browser, so an API save skips all of it. **The submit does validate**: an opportunity field left empty answers 400 `Opportunity Name is required but no value provided`. What the widget cannot render, it ignores. Validate on your side. |
| **CRM object fields (2026-10)** | The builder's Add Object Fields tab puts Opportunity / Company / custom-object fields on a form. An opportunity field is `type: "standard_field"` with `model: "opportunity"` and `fieldKey: "opportunity.name"` (tag = the field id); a company field is a plain `text` element with `model: "business"`. `update_form_data` passes these through unchanged. The pipeline, stage and value live in `form.opportunitySettings` (its `payload` holds the ids — and is **public** on the form-data read). The "no contact needed" behaviour is a server allow-list beta (`featureFlags.location.opportunities.decoupling`, no Labs card); off it, the widget renders **no input** for `standard_field` and the form cannot be submitted. A form mixes contact fields with ONE other object only. |
| **A field with no `type` is saved and never shown** | The widget renders each element by `type`. `{tag, label}` reads back fine and renders no label and no input; a form left with only its typed button shows the button alone. `create_form` and `update_form_data` complete a built-in tag sent without `type` the builder's way (listed under `completed`) and refuse any other untyped or unknown-type field by name. |
| **The builder's types, not the obvious ones** | An image is `type:"img"` with a `url` (`"image"` is never rendered). Country is a `select` dropdown. The address group is `{tag:"group_address", type:"group"}` plus `form.address` settings, with the street/city/state/country/postal-code elements saved right after it — the tools build all of that from a bare `{tag:"group_address"}` (your own copy of a child wins). A custom-field question takes its field's renderer (`large_text`, `phone`, `number`, …); `score` renders only with `dataType:"SCORE"`. Rendered live 2026-09-29: the old `image`/`group_address` types dropped the image and the whole address group. |
| **The form BUILDER reads more than the widget** | The public widget renders from `type` alone, but the builder's canvas needs every key it writes when a tile is dropped: a Submit element with only `type/tag/label` makes the builder open the form EMPTY ("Drag and drop components"), and its next Save writes that empty canvas over your fields. `create_form` and `update_form_data` now give every built-in element the builder's keys (`typeLabel`, `active`, `fieldWidthPercentage`, `placeholder`, the button's whole styling, …) — reported as `builderShape` — and leave what you sent alone. **A form an earlier `create_form` (before 1.36.0) made opens EMPTY in the builder; `update_form_data` repairs it when you pass its `fields` back** (live: 5/6/6/5 keys → 9/10/10/23, the builder then shows all four fields and the button); an update that names no `fields` does not touch them. A question on a custom field (tag = the field id) is not completed: name every key you want. The first builder Save re-themes the Submit (Inter, 8px radius) and adds the form-level theme keys, so the public look changes once at that Save. |
| **Edits are verified by value** | `update_form_data` (and `create_form`) re-read until every value sent is stored under GHL's names — a label-only edit keeps the same tags, so a presence check passes on the PREVIOUS document. |
| **Side-effect writes in the builder (2026-10)** | Opening **Integrate → Share** creates a published **QR** code and a **wallet pass** for the form. Saving with **Billing Address** on fires a location-level `billing-address` call ("Enabling billing address field"; on a fresh location it presumably creates the billing-address contact fields — not observed). **Create New Quiz** in the funnel page builder creates a quiz at once, even if no element is placed. None of these is undone by closing the screen. |
| **A blank submit is accepted** | With no required input, pressing submit stores an empty submission and creates a contact with no name, email or phone, and form-submission workflows fire on it. The tools warn under `blankSubmit`; make `email` required. |
| **Query shapes are strict** | `forms-list` wants `formIds=a,b,c` as one comma-joined string (repeated params 422). `submissions` pages with `page`, not `skip`. `submissions-count` takes a date range and refuses `formId`. |
| **`list_form_submissions` date window (`startAt`, `endAt`) narrows the rows** | Pass both as ISO timestamps. A window that covers the form's submission dates returns rows; a window before them (January 2026, against a form whose submissions are in November 2026) returns none. So an empty result can mean the window missed, not that the form has no submissions. Widen the window before you report "no submissions". |
| **A quiz's score-range logic is not captured (bl-830, bl-773)** | The sandbox quiz TEST-CONF-W5-forms-quiz has one slide with NO questions and `conditionalLogic: []`, so no score-based redirect has been seen stored. `list_forms` returns quizzes only with `productType: "quiz"`. Do not describe a score-range redirect as working until a question-bearing quiz is captured. |
| **An unknown `productType` becomes `form`** | `"banana"` is accepted and stored as `form`. Only `form` and `quiz` live on this collection. |
| **Both hosts serve it** | `services` and `backend` answer every path, with `token-id` alone, Bearer alone, or both. The builder sends services; the typed tools use the backend Bearer rail. Recorded in the host-parity ledger, not a contradiction. |

## Building a form

1. **Folder first, if you want one** — `POST /forms/folder/` `{locationId, name, productType}`.
2. **Custom-field questions need the field to exist already.** Get its `fieldKey`, `dataType` and
   `picklistOptions` from the location's custom fields; the element's `tag` is the custom field id.
   The create endpoint **prefixes `contact.` itself** — send the key bare or you get
   `contact.contactmy_key`, and the key is immutable afterwards.
3. **`create_form`** with the elements, `formAction` and `style`. Every element needs a `tag`: it is
   what the widget renders and what the read-back compares on. Standard fields use their name
   (`first_name`, `email`, `phone`), and a submit button is `{tag: "button", type: "submit"}`.
4. **`formAction.actionType: "2"`** with an empty `redirect_url` shows `thankyouText`; put a URL in
   `redirect_url` to redirect instead.
5. **Verify by rendering**, not only by reading: `GET https://api.leadconnectorhq.com/widget/form/{id}`
   with no auth returns the rendered form; look for `<input name="<tag>">` per field. The label text alone
   is not proof: the page's data payload carries every stored field, rendered or not. The Integrate tab's
   embed code uses the agency's white-label domain (`https://<domain>/widget/form/{id}`); both hosts render.

## Editing one

Always `update_form_data`. Pass only the top-level keys of `formData.form` you are changing —
`fields`, `formAction`, `style` — and read the preview's `preservedKeys` before confirming. A form last
saved by the builder carries 2026-10 keys you did not write (`showRecommendationsBeforeSaving`,
`opportunitySettings.payload`, `billingAddressEnabled` on the payment element, the integration keys as
`null`); the merge keeps them. `showRecommendationsBeforeSaving` is the per-form Settings switch "Show
form recommendations" — safe to write. If you
must go through `raw_request`, send only the keys you change under `formData.form`: the save merges,
so an omitted key is kept. A key you DO send overwrites its old value, so sending `fields` replaces the
whole field list; `GET` the document first and send the complete `fields` array.

**After a template install or snapshot that brought forms:** run `audit_site` on the funnels that embed them. A `formId` that the account does not hold is a HIGH dangling reference, and it displays the correct form name beside the wrong id.

## Which rail, per job

Both rails list the same forms; the internal list carries the whole form, the public one its id and name.

<!-- rail-ledger:forms -->
_generated from knowledge/catalog/rail-ledger.json — do not edit; the whole ledger is `ghl-orientation/references/rail-ledger.md`._

| Job | Decision | Routed today | Internal | Public |
|---|---|---|---|---|
| read | pool-internal | internal | `list_forms`, `list_form_submissions` | `forms-v3__get-forms`, `forms__get-forms`, `forms-v3__get-forms-submissions`, `forms__get-forms-submissions`, `surveys-v3__get-surveys`, `surveys__get-surveys` |

- **read:** The forms skill reads on the internal rail beside its writes; these list paths are shared.

Internal only: create; formData write (merges at formData.form; an omitted key is kept); folders; versions.
Public only: upload to a submission.
<!-- /rail-ledger:forms -->

## Conditional logic, the merge caveat, and what is UI-only in W9

**Conditional logic is writable through `update_form_data`** (the `conditionalLogic` key). A rule is a list of conditions, each with a field, an operation, a value and an outcome. Live-proven on a TEST-CONF form: each one was stored and read back on a separate GET.
- **Operators (15):** is equal to, is not equal to, contains, does not contain, starts with, ends with, is empty, is filled, before, after, greater than, less than, between, is checked, is not checked.
- **Outcomes (6):** redirect to a URL, show or hide fields, display a message, disqualify, jump to a step, free roam.
- **Product conditions (3 shapes on a product):** is selected, is not selected, and a bump-product target. These are written on the product's key, not a field key.

**Merge caveat (bl-1004).** A save merges into the stored document, so a key cannot be removed by leaving it out. To restore an absent key, set it explicitly to `null` or `[]`. The batch 3 TEST form kept residue for this reason, recorded in bl-1004.

**Setting write keys.** These settings are proven write keys under the form's `formAction` object, which `update_form_data` writes:
- footer HTML: `formAction.footerHtml`
- disqualify after submit: `formAction.endsurveyType`
- one question at a time (survey mode): `formAction.fieldPerPage`. Set it to `1` through `update_form_data` with the rest of `formAction` preserved. It is turned off by setting it to `null`, because the merge can only null a key, not delete it (bl-1004). Set to 1, it reads back as 1 on a separate GET. Restoring it leaves it null, which is the merge caveat above: a key that was already null stays null.
- background blur on the message styling: `style.blur` is accepted and stored by the write, but it is NOT yet confirmed as the builder's background-blur key (the UI does not prove the mapping). Do not rely on it until forms confirms it; its UI-only status is still held open, so it is not in the list below.

**UI-only in W9 (42 units, no tool writes them).** Each is a toggle, text or tab in the builder's Settings, Layout, Schedule or Integrate tab. `update_form_data` writes only `fields`, `formAction`, `style`, `conditionalLogic` and `name` of the stored document, and these items are stored and rendered outside those keys, so no W9 tool writes them. Do them in the GHL UI.
- **Settings (bl-1002, 9 items):** sticky contact; timezone capture; the GDPR font; save progress and the exit confirmation; create a contact on a partial submission; create a conversation on submission; generate the submission PDF; full screen; cookie consent.
- **Integrations and the Integrate tab (bl-1003, 21 items):** the Facebook pixel ID and events; opportunity creation and setup; contact association and the association picker; the email notification; the auto responder; the Integrate tab (embed code and its modal, embed type and button, the embed preview, embedding in Funnels or Websites, the basic embed, the share link and social share, email connections and templates, linked workflows, the post-save panel).
- **Layout (bl-1008, 9 items):** inline form; popup (trigger and activation); popup deactivation (after N, after lead, never); polite slide-in; sticky sidebar; single or two columns; image placement; survey navigation (back button, disable animation, scroll to top); survey footer (next, previous and submit buttons, progress bar).
- **Schedule (bl-1008, 3 items):** open and close window; redirect when closed; closed page appearance.
- Survey mode (one question at a time or all on one page) is not in the Layout list. It is the `formAction.fieldPerPage` write key above.
- **Embed layout (inline, popup, polite slide-in, sticky sidebar, and the popup deactivation setting) is not stored on the form record.** The builder's Integrate tab writes it into the embed snippet: the iframe id (`inline-`, `popup-`, `sticky-sidebar-left-`, `polite-slide-in-…-`) plus the `data-layout`, `data-trigger-type`, `data-activation-type` and `data-deactivation-type` / `data-deactivation-value` attributes (`LayoutType.vue`, `getIframeDataAttributes`). The snippet is read from the builder's Copy embed code, and no W9 tool reads or writes it, so these units are E-excluded. Rendered differences of a snippet are the only proof: a local page with the snippet shows a fixed overlay for popup and a fixed container for sticky sidebar, and a `deactivateAfter` value hides it at load.

## Form-level fields a raw_request can write (proven live)

Every row below is written the same way: `raw_request` `POST /forms/{id}` with the body `{"name": <current name>, "formData": <the formData from a GET, with the key under formData.form changed>}`. Read it back with `GET /forms/{id}` on a separate request and compare the key at the path shown. The save merges at `formData.form`, so the proof sent the full read-back `formData` with only the listed keys changed. Each row was set, read back on a separate request and restored.

| Field | Key path | Notes |
|---|---|---|
| Sticky contact | `formData.form.stickyContact` | boolean |
| Enable timezone capture | `formData.form.enableTimezone` | boolean |
| GDPR-compliant font | `formData.form.isGDPRCompliant` | boolean |
| Save-and-exit confirmation | `formData.form.enableSaveExitConfirmation` | boolean |
| Create contact on partial submission | `formData.form.enablePartialContactCreation` | boolean |
| Show submission in conversations | `formData.form.showSubmissionInConversationsFeed` | boolean |
| Generate submission PDF | `formData.form.generateSubmissionDocument` | boolean |
| Full-screen mode | `formData.form.fullScreenMode` | boolean |
| Submit message styling | `formData.form.submitMessageStyle` | object |
| Footer HTML | `formData.form.formAction.footerHtml` | string |
| Facebook Pixel ID | `formData.form.fbPixelId` | string |
| Facebook Pixel events | `formData.form.formSubmissionEvent`, `formData.form.pageViewEvent` | strings |
| Contact association | `formData.form.contactAssociationSettings` | object, takes the association id from the location |
| Opportunity settings | `formData.form.opportunitySettings` | object; its `payload` is public on the form-data read |
| Email notifications | `formData.form.emailNotificationsConfig` | object; send no addresses in a test |
| Auto-responder | `formData.form.autoResponderConfig` | object; send no addresses in a test |
| Schedule visibility | `formData.form.formSchedule` | enabled flag and open/close windows |
| Schedule, closed state redirect | `formData.form.formSchedule.states.before` | mode `redirect` with a URL |
| Schedule appearance | `formData.form.formSchedule.appearance` | colours, corner radius, width, shadow, padding, margin |
| Layout: single or two columns | `formData.form.layout` (desktop), `formData.form.mobileLayout` (mobile) | `1` one column, `2` two columns |
| Image: show, desktop and mobile layout | `formData.form.showImage`, `formData.form.desktopImageLayout`, `formData.form.mobileImageLayout` | |
| Survey mode (quiz, one question per page) | `formData.form.formAction.fieldPerPage` | boolean, on a quiz |
| Quiz footer style | `formData.form.footerStyle` | object (`fontFamily`, `height`), on a quiz |
| Background colour | `formData.form.style.background` | string |
| Form padding and field spacing | `formData.form.style.padding`, `formData.form.style.fieldSpacing` | padding is an object (see the merge caveat below) |
| Label colour, placeholder colour, input border colour and width, font size and weight | `formData.form.style.labelColor`, `placeholderColor`, `borderColor`, `borderWidth`, `fontSize`, `fontWeight` | set through `update_form_data` (the same save) |
| Label alignment | `formData.form.fieldStyle.labelAlignment` | string |
| Primary colour and button colour mapping | `formData.form.fieldStyle.primaryColor`, `formData.form.fieldStyle.mapPrimaryColorToButtonColor` | |
| Input border | `formData.form.fieldStyle.border` | object |
| Leading-icon input padding | `formData.form.fieldStyle.padding.left` | nested, see the merge caveat |
| Theme | `formData.form.currentThemeId` | take the id from `GET /forms/themes` |
| Submit: open a URL | `formData.form.formAction.actionType` = `"1"`, `formData.form.formAction.redirect_url` | read back as `redirectUrl` (trap 4 above) |
| Submit: order confirmation | `formData.form.formAction.actionType` = `"3"` | |
| Submit: thank-you message | `formData.form.formAction.actionType` = `"2"`, `formData.form.formAction.thankyouText` | |

**Caveats from the proofs:**

- Nested objects merge as well as the top level. `style.padding`, `fieldStyle.padding` and `fieldStyle.border` keep the keys you did not send. Send every nested key you need, and restore a nested value by setting its keys back explicitly, not by omitting them.
- An empty `redirect_url` does not clear a stored URL, and the builder ignores `redirectUrl` unless `actionType` is `"1"`.
- Not in this table: the survey navigation keys and the default colour swatches. Neither has a whole-document save proof yet.

## Out of scope, and why

Never executed on any account, so no tool exposes them and the corpus marks them unproven:
`POST /forms/share/{id}` copies the form **to another account**; `DELETE /forms/{id}`;
`POST /forms/image` (multipart); `POST /forms/schedule-form-export`. A quiz save was executed live once,
through the builder (2026-10-29: the ordinary form save with `slides[]`, `logic`, `resultTemplate`,
`category`, `categoryCustomFields` instead of `form.fields[]`); no tool writes one, and a survey save is
still unexecuted. **What a submission creates depends on the fields**: a contact form creates a contact;
with an opportunity field it also creates an opportunity (source FORM, linked); an opportunity-only form
created a blank contact; a company-only form created a company and **`contactId: null`** — no contact.
Each fires its own triggers (`form_submission`, opportunity and company triggers), so never submit on a
client account to test. (corpus `forms/70-research/2026-10-29-forms-wave.md`)

**Location Forms settings are a UI-only job on purpose.** Forms → Settings holds six location-wide switches (create conversation on submission, submission PDF, sticky contact,
save progress, capture timezone, GDPR font), each with Enable all / Disable all over EVERY form, survey and quiz of the location, plus a per-form override (Manage individual forms).
No tool writes them: the bulk switch reaches every form on the account, other people's included, and cannot be undone in one step. The routes are known
(`POST /forms/update-conversation-on-submission {locationId, showSubmissionInConversationsFeed}`; `update-generate-submission-document`, `update-sticky-contact`, `update-save-progress`,
`update-capture-timezone`, `update-gdpr-font` each `{locationId, value, productType}`; a per-form override adds `formId` — proven live on an own form), so when a user asks for one, tell
them it lives at **Forms → Settings** (per form: Manage individual forms) and, if they want it scripted, that `raw_request` reaches it with the body above.
Also: dropping a question tile in the form builder (dropdown, checkbox, radio, number, date, signature, file upload, rating…) creates a real contact custom field at once, not at Save.
