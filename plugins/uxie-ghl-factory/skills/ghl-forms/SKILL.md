---
name: ghl-forms
description: GoHighLevel forms, surveys and quizzes — the builders under Sites. Use when a task involves listing, reading, creating, editing, duplicating, foldering or embedding a form, when a form_submission trigger needs the form's real field tags, or when someone asks why a form edit lost fields, why a survey is not on the forms list, or what a form's public URL is. Also use before writing to any form by raw_request — the save replaces the whole document and there is no undo.
---

# Forms, surveys and quizzes

The builders under **Sites → Forms / Surveys**. Corpus: `knowledge/corpus/forms/`, mapped and
live-proven 2026-09-06 across 133 saved probes.

**Three products, two collections.** Forms and quizzes share `/forms/*` and differ only by
`productType`; surveys have their own `/surveys/*` collection but call the **forms** routes for
delete, duplicate, share, folders and move-to-folder. So `POST /surveys/duplicate/{id}`,
`GET /surveys/folder` and `POST /surveys/move-to-folder` are paths nothing in the product calls,
and whether they exist server-side is unknown.

**Five typed tools cover the rail** — `list_forms`, `get_form`, `create_form`,
`update_form_data`, `list_form_submissions` — all live-fired on the sandbox 2026-09-07, thirteen
assertions including the one that matters: a `formAction`-only edit left `fields` and `style`
intact. Prefer them over `raw_request`, which carries none of the four traps below.

## The four traps, and why the tools exist

**1. The save is a whole-document REPLACE.** `POST /forms/{id}` stores whatever `formData` arrives;
every key you did not send is gone. There is no patch — `PUT` and `PATCH` both 404. A bare
`raw_request` that sends only the key you changed silently deletes the rest of the form.
`update_form_data` reads the current document, merges, writes the whole thing back, and its
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
| **`type=form` is the row-kind switch** | Any other value, including omitting it, returns forms **and folders** in one array. `type` selects the row kind, not the `productType`. |
| **`count` counts folders too** | Three forms plus one folder answers 4. It will not agree with the number of rows you listed. |
| **Nothing inside `formData` is validated** | An invented key is stored and read back. The only guard is the widget: what it cannot render, it ignores. Validate on your side. |
| **Query shapes are strict** | `forms-list` wants `formIds=a,b,c` as one comma-joined string (repeated params 422). `submissions` pages with `page`, not `skip`. `submissions-count` takes a date range and refuses `formId`. |
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
   with no auth returns HTML containing your labels. That is the same URL the Integrate panel embeds.

## Editing one

Always `update_form_data`. Pass only the top-level keys of `formData.form` you are changing —
`fields`, `formAction`, `style` — and read the preview's `preservedKeys` before confirming. If you
must go through `raw_request`, `GET` the document first and send it back whole; there is no other
safe shape.

## Out of scope, and why

Never executed on any account, so no tool exposes them and the corpus marks them unproven:
`POST /forms/share/{id}` copies the form **to another account**; `DELETE /forms/{id}`;
`POST /forms/image` (multipart); `POST /forms/schedule-form-export`. Quiz and survey **saves** were
never executed either — their `formData` carries `slides[]`, `logic`, `resultTemplate`, `category`
and `categoryCustomFields` instead of `form.fields[]`, read from the builder's source and never
written. A submission through the widget creates a contact and fires `form_submitted` triggers on
any published workflow filtered to that form, so never submit on a client account to test.
