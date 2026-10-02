---
status: proven-live
lastVerified: 2026-10-02
---

# Quizzes (Sites → Quizzes)

Base: services.leadconnectorhq.com

The quiz surface, mapped end to end against a live sub-account on 2026-10-01/02: create, save,
score, brand, gate with consent, branch conditionally, capture attribution, and read the outcome
back off the contact. Every claim below was executed and read back on a separate request unless
it says otherwise.

This page replaces the `ghl-forms` note that *"Quiz and survey saves were never executed"*.

> **Two unrelated things are called "quiz."** This page is the **forms-rail** quiz
> (`/forms/*` with `productType: "quiz"`). The *course assessment* quiz is a different
> collection (`/membership/locations/{locationId}/assessments/quiz`, covered by `build_course`).
> Confusing them is the easiest mistake on this surface.

---

## 1. Routes and hosts

| Thing | Where |
|---|---|
| Quiz list | `/v2/location/{locationId}/quiz-builder/main` |
| Quiz editor | `/v2/location/{locationId}/quiz-builder-v2/{formId}` |
| Public widget | `https://api.leadconnectorhq.com/widget/quiz/{formId}` |

The editor is an **iframe** (`name="quiz-builder-app"`) served from
`leadgen-apps-form-survey-builder.leadconnectorhq.com`. Browser automation must target the iframe:
the top frame's `innerText` is empty.

`/widget/form/{formId}` serves the same quiz. With a domain attached to the sub-account the widget
also serves from it (`https://<custom-domain>/widget/quiz/{formId}` → 200, full content). The
`form_submission` trigger keys on `form.id`, not the URL, so moving to a branded domain does not
affect automation.

**The builder app ships a complete public source map** — `assets/index-*.js.map`, 376 sources. It is
the authoritative model for this surface and beats UI capture. Mine it first.

🔴 **Cosmetic 404s.** A deep link to `/v2/location/…` returns HTTP **404 for the document** while the
SPA routes client-side and renders correctly. The builder iframe's own
`GET /quiz-builder-v2/{formId}` also 404s while the app loads. Neither is a failure.

---

## 2. Lifecycle

### 2.1 List
```
GET /forms/?skip=0&limit=1&locationId={locationId}&query=&type=quiz&productType=quiz
```
`type` AND `productType` are both sent, both `quiz`. The empty-state check uses `limit=1` purely to
probe for existence.

### 2.2 Create
```
POST /forms/   →  201
{"locationId": "{locationId}", "productType": "quiz", "source": "landing_page"}
```
**That is the whole body.** No name, no document, no template choice. The UI's "Create quiz" button
fires it immediately — there is **no modal and no name prompt** — and the quiz is live at its public
widget URL the instant it returns. GHL names it itself (`"Quiz 0"`).

Seeded defaults of note: `form.width: 550`, `form.style.border` dashed/4px,
`form.formAction.actionType: 4` (forms use `2`), plus quiz/survey-only keys
`disqualifiedText/Type/Url`, `endsurveyText/Type/Url`, `fieldPerPage`, `fieldSettingEnable`; and
`slides: [{id, slideName: "Page 1", slideData: []}]`.

### 2.3 Save
```
POST /forms/{formId}   →  201
{"name": "<name>", "formData": { …whole document… }}
```
Whole-document REPLACE, as on the forms rail. **The name travels with the save** — typing in the
builder's name field fires no request at all.

🔴 **The first Save is not idempotent.** With no user edits beyond the name it flipped
`style.acBranding` true→false, `form.width` 550→800, re-themed the border dashed→solid, and ADDED
~20 keys including the entire `resultTemplate`, `formSchedule`, `surveyImageSettings`,
`mobileFooterStyle` and both CSS blobs. **A quiz created by API and never opened in the builder is a
much thinner object than one the builder has saved once.**

---

## 3. `formData` keys

```
fieldCSS   mobileFieldCSS   form      logic     newFooter   slides
category   categoryCustomFields       resultTemplate
emailNotifications   autoResponder    parentFolderId   parentFolderName   language
```

`slides` is a **sibling of `form`**, not nested inside it. `logic` is `{}` and
`categoryCustomFields` `[]` on a fresh quiz.

🔴 **`formData.form` merges server-side; it does not replace.** Keys deleted from it come back on the
next read — observed with `conditionalLogic` and `fieldCSS`. Do not rely on omission to clear a key.

---

## 4. Questions

### 4.1 Element templates (from the builder's own palette)

| Palette item | `tag` | `type` | `dataType` |
|---|---|---|---|
| Single Choice | `radio` | `radio` | `RADIO` |
| Multiple Choice | `checkbox` | `checkbox` | `CHECKBOX` |
| Yes / No | `radio` | `radio` | `RADIO` |
| Single Dropdown | `dropdown` | `single_options` | `SINGLE_OPTIONS` |
| Multi Dropdown | `dropdown_multi` | `multiple_options` | `MULTIPLE_OPTIONS` |
| Number | `text` | `numerical` | `NUMERICAL` |

🔴 **`SINGLE_OPTIONS` is the DROPDOWN, not Single Choice.** Single Choice is `RADIO`.

🔴 **`type` is the widget's renderer; `dataType` is the custom-field type.** An element carrying
`dataType` and no `type` is **stored, returned in the public payload, and silently never rendered**
— `POST` 201, a read-back returning every key exactly as sent, and a widget showing only the submit
button, with **no console error**. On this surface a verified read-back is not proof. **Always render
the widget.**

⚠️ The palette template also carries `category: "quizQuestions" | "choiceElements" | "other"` — that
is the palette's own grouping and has nothing to do with the scoring category. Do not copy it onto a
saved element.

### 4.2 A working question

```json
{
  "uuid": "<uuidv4>",
  "label": "<question text>",
  "tag": "radio", "type": "radio", "dataType": "RADIO",
  "hiddenFieldQueryKey": "radio", "typeLabel": "Single Choice",
  "standard": false, "custom": true,
  "picklistOptions": ["<opt 1>", "<opt 2>", "<opt 3>", "<opt 4>"],
  "required": true, "placeholder": "", "shortLabel": "",
  "hidden": false, "columnsNumber": 1, "spreadColumns": false, "labelAlignment": "top",
  "scoreByCategory": {
    "0": {"category": "<categoryId>", "categoryId": "<categoryId>", "score": 3, "index": 0},
    "1": {"category": "<categoryId>", "categoryId": "<categoryId>", "score": 2, "index": 1},
    "2": {"category": "<categoryId>", "categoryId": "<categoryId>", "score": 1, "index": 2},
    "3": {"category": "<categoryId>", "categoryId": "<categoryId>", "score": 0, "index": 3}
  }
}
```

### 4.3 Slides

`slides` accepts an arbitrary array of `{id: <uuidv4>, slideName, slideData: []}`. Freshly generated
slide ids are fine; the seeded id need not be preserved. `slideName` round-trips non-ASCII intact.
**The widget paginates by slide**, with Submit only on the last one.

### 4.4 🔴 The builder's canvas cannot be driven by automation

Clicking a palette item selects it; clicking the canvas does nothing; Playwright's `dragTo` does not
insert. `slideData` stayed `[]` through all three. Author elements through the API instead.

---

## 5. Scoring

### 5.1 `scoreByCategory`, keyed by option INDEX

```
slides[i].slideData[j].scoreByCategory[<optionIndex>] =
    { category, categoryId, score, index }
```

- **Category and score attach to each ANSWER OPTION, not to the question.** A question whose
  options all belong to one category needs that `categoryId` on every option.
- It is an **object keyed by the option's positional index as a string** — not by label, not by id.
- **Reordering options destroys their scores.** The builder's `category:sort` handler *deletes* both
  the old and the new index keys. Build options in final order.
- Deleting one option deletes the element's **entire** `scoreByCategory` (source-derived).

### 5.2 Categories

```json
"category": [{"id": "overAllScore", "label": "Overall Only", "value": "overAllScore"}]
```
`overAllScore` is a sentinel present by default. Custom categories are appended as
`{label, value, id}`; **free-form string ids are accepted** and GHL imposes no format.

### 5.3 🔴 `calculatedOptions` is a SURVEYS feature, not quiz scoring

An array of `{label, calculatedValue}` gated on `enableCalculations`.
`sanitizeChoiceFieldCalculatedOptionsForSave` **strips it on save** for `RADIO`/`CHECKBOX` when
`enableCalculations` is falsy. Quizzes use `scoreByCategory`. Do not conflate them.

### 5.4 🔴 The percentage formula, and why tiers break

```
category %  =  (sum of that category's option scores)  ÷  (highest single option score)  × 100
overall  %  =  the MEAN of the category percentages
```

Measured both ways:

| Option ladder | A category of 3 questions, all mid-option | Stored |
|---|---|---|
| `3 / 2 / 1 / 0` | sum 6, max option 3 | **200 %** |
| `1 / 0.6667 / 0.3333 / 0` | sum 2.0001, max option 1 | **200.01 %** |

The divisor is the **maximum option score**, so the scale cancels out: with N questions in a
category, a perfect category is always **N × 100 %**. Three questions per category ⇒ 0–300 %.

**Consequences:**

- **Rescaling the option values changes nothing.** Decimal scores ARE accepted and round-trip
  exactly (`[1, 0.6667, 0.3333, 0]` read back verbatim) — but they do not normalise the range.
- Where every category holds the same number of questions, `overall %` equals
  `total points ÷ total questions × 100`.
- 🔴 **The tier editor validates `0–100`, but the runtime produces up to N×100.** Bands above 100
  can only be written by API (`238–300` written and read back fine). A band set in the UI is
  clamped to ≤100, and then **no tier resolves and the results page renders no category text and no
  CTA** — silently, with all content still present in the document. **Do not edit tier bands in the
  builder on a multi-question-per-category quiz.**

### 5.5 Tiers

`resultTemplate.tiers`: `[{id, label, color, fromPercent, toPercent}]`. Ids are short 6-char
alphanumerics, not uuids. Defaults ship **three** tiers; an arbitrary count is accepted.

Content throughout `resultTemplate` is **doubly keyed** — `{<categoryValue>: {<tierId>: value}}` —
with a parallel `staticContent` used when `dynamicContent` is false. **The defaults populate only
the first tier**, so a fresh quiz has an incomplete results page.

---

## 6. Binding to contact custom fields

### 6.1 The binding is three keys on one field

```json
{ "id": "<customFieldId>", "tag": "<customFieldId>", "fieldKey": "contact.<key>",
  "type": "radio", "dataType": "RADIO" }
```

**`tag` changes meaning when an element is bound.** Unbound it is the element kind (`"radio"`);
bound it is the **custom field id**. `type` does not change. Both shapes render identically — only
the binding differs.

Create the field first: `POST /locations/{locationId}/customFields` with
`{name, dataType, model: "contact", options: [...], parentId}` returns the server-generated
`fieldKey`. **Read `fieldKey` back rather than deriving it.** `options` must be a flat array of
strings for `RADIO`/`CHECKBOX`/`SINGLE_OPTIONS`/`MULTIPLE_OPTIONS`.

Contact custom-field **folders** cannot be created on the public rail; the internal
`create_custom_field_folder` does.

### 6.2 🔴 Unbound elements silently lose data

Every unbound element carries `tag: "radio"`, so submission payload keys **collide**:

```
"others": { "radio": "<only the last answer survives>" }
"fieldsOriSequance": ["radio", "radio", "radio"]
```

Three answers, one stored value. **Binding is not optional for any quiz with more than one question
of a type.**

### 6.3 🔴 Key mangling auto-creates duplicate fields

Writing `hiddenFieldQueryKey` derived from the fieldKey tail (`"my_field"` from
`contact.my_field`) caused GHL on save to store
`hiddenFieldQueryKey: "contactmy_field"` and `fieldKey: "contact.contactmy_field"` — a doubled
prefix. That key matched no field, so **GHL silently created a new custom field per element and
rebound `id`/`tag` to it.** Fifteen duplicates appeared in one save, named after the full question
text, outside the folder.

**A short opaque token survives untouched** (`qk01`…`qk16` round-tripped with `fieldKey` intact).
Never use a fieldKey-derived string for `hiddenFieldQueryKey`.

Repair recipe: match elements to their intended fields by **question label**, restore
`id`/`tag`/`fieldKey`, set `hiddenFieldQueryKey` to a short token, save, then assert
`id ∈ intended ids` and `"contact.contact" not in fieldKey`.

### 6.4 The query key can never address one question

The builder sets `hiddenFieldQueryKey` to the element **type** — `radio`, `checkbox`, `first_name`,
`email` — identical across every question of a kind. Any design that keys a condition on it is
wrong by construction.

### 6.5 Hidden fields for attribution

Proven: a bound element with `hidden: true` and `hiddenFieldQueryKey: "<url query key>"` is
invisible in the widget and **populated from the URL query string** on submit. Four such fields
carried their values onto the contact from
`…/widget/quiz/{formId}?utm_source=…&utm_medium=…&utm_campaign=…&utm_content=…`.

---

## 7. Conditional logic

🔴 **The runtime reads `formData.logic`. `formData.form.conditionalLogic` is IGNORED.**

A rule written only into `conditionalLogic` had no effect at runtime — proven by a two-branch test
in which the branch that should have been skipped still displayed. GHL's own builder writes:

```json
"logic": {
  "<SOURCE element uuid>": {
    "<option INDEX as string>": {
      "current": "<SOURCE element uuid>",
      "index": <optionIndex>,
      "jumpTo": "<TARGET element uuid>",
      "option": {"label": "<option label>", "calculatedValue": ""}
    } } }
```

- keyed by the source element's **`uuid`** — not its field id, not its query key
- second level is the option's **positional index**, as a string
- `jumpTo` is a **target element uuid**, NOT a slide id. Jumping to the first element of a later
  slide is how the slides in between are skipped
- `option` is an object, not a bare string

**Verified both ways:** the configured option skipped the intervening slide; every other option fell
through to it.

A rule must be tested in **both** directions. The "shows" case proves nothing when the target is
simply the next slide.

---

## 8. Results page: the `sections[]` schema

The results page migrated to an ordered array. A builder save converts the legacy flat keys into it,
carrying content across (the legacy top-level keys then read empty — the content moved, it was not
lost).

```
sections: [ {id, type, hide, config}, … ]
```

Six types, in order: `headerSettings`, `overallScoreSettings`, `categoryScoreSettings`,
`ctaSettings`, `individualCategorySettings`, `footerSettings`.

**`individualCategorySettings` is the lowest/highest-category section.** Its
`config.displayCategory: "lowestScore"` makes it render whichever category scored lowest, with
per-category content under `config.categoryData[<categoryId>]`:

```json
{ "staticContent": {"heading": "<html>"}, "enableContent": true,
  "enableImageVideo": false, "enableButtonCTA": false, "template": 5 }
```

Its default content is English and ships with a **stock image and a Pixabay stock video**
(`enableImageVideo: true`) plus a blue "Subscribe" button — review before launch.

Merge tags available in that section's text: `{{quiz_tags.lowest_category_name}}`,
`{{quiz_tags.lowest_category_score}}`.

⚠️ `categoryScoreSettings.staticContent.heading` renders **per category block**, not once as a
section heading — text placed there repeats N times.

---

## 9. Outcome mapping → the contact

`formData.categoryCustomFields` holds the mapping. It is authored through a **federated modal**
(Settings → Edit Results Page), which is not in the builder's source map, and that panel has **its
own Save** separate from the page's.

**GHL creates its own fields** rather than letting you point at existing ones, named from the quiz
name. Six are offered:

| Outcome | dataType |
|---|---|
| over all score | NUMERICAL |
| over all score **tier** | TEXT |
| highest category name | TEXT |
| highest category score | NUMERICAL |
| **lowest category name** | TEXT |
| lowest category score | NUMERICAL |

Once mapped, a submission writes them onto the contact — proven: the tier field held the tier's
**label** and the lowest-category field its category label. That is what makes workflow branching
and Smart Lists possible; before mapping, the outcome exists **only** in the submission record and
no workflow can read it.

Prefer these over duplicating the same facts as tags: a tag naming a category duplicates a field
that already holds it.

---

## 10. Submissions

`list_form_submissions` **requires `productType: "quiz"`** — omitting it returned `total: 0` for a
quiz with submissions. Its `q` search does not match payload contents.

`others` carries every answer keyed by custom field id, plus:

```
<categoryId>: <percentage>            (one per category)
overAllScore: <percentage>
highestScoreCategory / highestCategoryId / highestScore
lowestScoreCategory  / lowestCategoryId  / lowestScore
Timezone, fieldsOriSequance, submissionId, signatureHash, ip, eventData, sessionFingerprint
```

🔴 **No tier is stored.** GHL records scores and highest/lowest category, never the matched band.
The tier exists only as the key selecting results-page content and in the mapped contact field.

**The highest/lowest tie-break is arbitrary.** With all categories equal, the same category was
named as both highest and lowest — first in the list. A custom tie-break order is not expressible
and must live in a workflow.

A CHECKBOX answer stores as an **array**. `Timezone` is the submitter's browser zone, not the
account's. `eventData.medium` is `"quiz"`.

🔴 **A partial submit still creates a contact.** `required: true` gates only the **visible page**, so
a submission from page 1 produced a contact with no name, email, phone or custom fields.

---

## 11. Consent (T&C) element

```json
{ "tag": "terms_and_conditions", "type": "terms_and_conditions",
  "hiddenFieldQueryKey": "terms_and_conditions", "required": true, "standard": true,
  "textColor": "<hex>", "linkColor": "<hex>",
  "placeholder": "<p>consent copy, may contain <a href>…</a></p>",
  "preview": "<same html>" }
```

No `dataType`. The copy lives in **`placeholder`** as HTML (with `preview` mirroring it), so links
are allowed. Renders as a checkbox, and the accepted text is stored in the submission — a useful
consent audit trail.

**`required: true` on the LAST slide genuinely blocks submission** (verified: Submit refused, form
stayed put). Contrast §10 — required on an earlier slide does not prevent a partial submit.

🔴 **Its validation message is hardcoded English** ("Please accept the terms and conditions") under
`language: "de-DE"` and `"de"` alike. It is not driven by `formData.form.language`. Make the consent
label itself unambiguous in the target language.

---

## 12. Styling and localisation

`form.fieldStyle` / `form.style` / `form.footerStyle` are the structured source of truth, but
`fieldCSS` and `mobileFieldCSS` (~14 KB each) are **compiled from them by the builder, not the
API**. An API write that changes `fieldStyle` leaves stale CSS in place and the widget keeps the old
look; deleting the CSS keys does not help (the server restores them, §3). **One builder Save
recompiles them** — verified, with every API-written value surviving.

Button labels are plain document values and survive builder saves:
`form.footerStyle.buttonStyle.{nextBtnText, prevBtnText, submitBtnText}` — **and the same keys must
be set on `form.mobileFooterStyle.buttonStyle`**, a separate copy.

`form.language` accepts a bare code (`de`); the builder's locale files are `de.json`, `fr_FR.json`.
Setting it changed nothing observable in the widget — treat it as metadata, not a localisation
lever.

Fonts: the builder ships the full Google Fonts collection (2,999 families), so any of them is
selectable.

---

## 13. 🔴 The builder and the API are a lost-update pair

A builder window open from before an API write will, on its next Save, overwrite that write with
its own stale in-memory copy of the whole document. Measured: a Save reverted a repair made hours
earlier, restoring mangled `fieldKey`s, resetting every `hiddenFieldQueryKey` to the element type,
and **dropping an entire slide**.

There is no patch and no conflict detection on `POST /forms/{formId}` — last writer wins, wholesale.
**Never write via API while a builder window is open on the same form, and re-read before every
write.** After any builder session, re-verify bindings before trusting them.

A Save from a **freshly opened** builder is safe: every API-written value survived.

---

## 14. Transport notes

🔴 **Cloudflare rule 1010 (`browser_signature_banned`) returns 403 to non-browser clients.** A plain
`curl`/`urllib` call with a default User-Agent is rejected with a 403 that reads exactly like an
auth failure. Sending a normal browser `user-agent` (plus `origin`/`referer` of
`app.gohighlevel.com`) fixes it. Both hosts behave identically.

The document is ~44 KB because of the two CSS blobs; drive writes from a script, not by hand.

`update_form_data` cannot reach quiz keys — it accepts `fields`/`formAction`/`style`, which live
under `formData.form`, whereas `slides`, `category`, `resultTemplate`, `logic` and
`categoryCustomFields` sit at `formData` top level.

Unrelated but adjacent: `contacts__search-contacts-advanced` with
`filters:[{field:"email", operator:"eq", …}]` returned 0 for an address that exists; the plain
`query` parameter found it.

---

## 15. 🔴 Privacy: option scores are PUBLIC

`scoreByCategory` — every option's score — is served in the **unauthenticated** widget payload.
The scores are not visible in the rendered UI, but anyone viewing source can read exactly which
answer is worth most. For a scored lead magnet, that means the result can be gamed. Say so to the
client before launch.

The whole `formData` document is world-readable through the widget rail, as on the forms rail.

---

## 16. Not covered

Duplicate, move-to-folder, delete and share for quizzes; folders; the Notifications tab and its
submission/result PDFs; `Versions`; Integrate panel internals; the Styles & Options panel's own
writes; quiz templates (no endpoint found); `individualCategorySettings.template` values other
than `5`; whether overlapping or gapped tier bands are rejected; the Quiz Submitted workflow
trigger's own filter rows beyond `form.id`.
