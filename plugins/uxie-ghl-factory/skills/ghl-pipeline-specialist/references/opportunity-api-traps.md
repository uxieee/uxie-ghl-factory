# Opportunities & pipelines — what GHL does silently

Every item was executed on the designated test sub-account and read back on a separate request
(2026-09-25 to 2026-09-28). The full evidence is in the knowledge corpus,
`pipelines-opportunities/20-api/` (`pipelines.md`, `opportunities.md`, `forecast.md`,
`smart-views.md`, `smart-filters.md`, `settings.md`, `bulk-actions.md`) and `pipelines-opportunities/40-rules/smart-tags.md`. Read the relevant line before writing.

## Pipelines and stages

- **The stages array is a full replace.** A stage left out of an update is deleted, and its cards
  land in the pipeline's FIRST stage, with no warning and no audit row. Use `edit_pipeline`, which
  refuses that unless you say where the cards go.
- **One stage without `stageWinProbability` rewrites them all** to an even ramp,
  `(i + 1) / (n + 1) * 100`, and still answers 201.
- **A stage rename keeps its id,** so workflows (which reference stages by id) keep working. A
  rename fires no stage-changed trigger; moving a card fires everything.
- **Deleting a pipeline deletes its opportunities,** with no DELETED audit row, so they cannot be
  restored from Settings › Audit logs. A single-opportunity delete can be restored.
- **`PATCH …/position` with an empty body moves the pipeline.** `raw_request` refuses it without
  `targetPosition`.
- The update body is the GET row with `id`, `position`, `dateAdded`, `dateUpdated`, `locationId`
  removed at the top level. The permissions update needs `locationId` and refuses `pipelineId`,
  the reverse of the pipeline update.

## Searching opportunities (`POST /opportunities/search`)

A wrong value shape can answer **201 with zero rows**. Always run a baseline and a known-zero control.

- `name` `contains` needs a **scalar** string. An array answers zero rows.
- `source` is a keyword: `eq`/`contains` with an array holding the **exact full value** only. A
  partial value answers zero rows; a scalar answers 400.
- Numbers: use `operator:"range"` with `{gt|gte|lt|lte}`. `operator:"gt"` is refused (422) although
  it is in the operator list.
- `page` together with `searchAfter` answers 400.
- Read back through `GET /opportunities/{id}`, not search: the search index lags a write by up to
  a couple of seconds.
- Lost reason and custom-field values appear only on search rows, not on the detail read.

## Records

- The public update stores `source`, `forecastExpectedCloseDate` and `forecastProbability`, although its
  published spec lists none of them (proven through the public tools). A lost reason goes through the
  public status route: `status:"lost"` with `lostReasonId`.
- A second opportunity for the same contact in the same pipeline is refused while duplicates are
  off (`OPPORTUNITY_NO_DUPLICATE`, with the blocking card's id in `meta.existingId`).
- **Additional contacts are association relations, not a field.** The relation reads from the
  CONTACT side only: `relations/record/{opportunityId}` answers empty, and the edit form's
  Associated objects tab shows "No association found" for a card that has two contacts. To list an
  opportunity's contacts, use the search row's `relations[]` (`includeTopRelations:true`). The
  definition allows 25 contacts; the form stops at 10.
- **A note on an opportunity also belongs to its primary contact, so it fires the contact's
  "Note added" workflow trigger.** Check the published `note_add` triggers before writing notes
  from a script.
- A task on an opportunity is two calls: create the task, then associate it
  (`TASK_OPPORTUNITY_ASSOCIATION` + `TASK_CONTACT_ASSOCIATION`). Without the second call it is not
  on the card.
- **An invoice linked to an opportunity** is saved, even as a draft, by `POST /invoices/finalize`.
  The name does not mean sent: it read back as a draft, not sent. It needs the contact's email and
  an E.164 phone. Without them it answers 422 while the UI shows nothing.

## Account settings

- **Owners are synced both ways by default.** Changing an opportunity's owner also changes its
  contact's owner, and the reverse. Only "Allow different owners of Contacts and their
  Opportunities" (decoupling) stops it.
- Follower sync (a new owner becomes a follower of the linked contact or opportunity) can only be
  switched on while decoupling is on.
- "Allow more than one opportunity per contact in the same pipeline" is on a different screen
  (Settings › Objects › Opportunities) and a different key (`allowDuplicateOpportunity`, top level
  of the location write).
- Once the settings screen has been saved, the UI cannot return the settings to "never set". It
  writes explicit `false` instead, which behaves the same.

## Forecast

- The four report endpoints are POSTs that answer 201 and store nothing.
- Stage and owner rows are labelled with their UUIDs; join the names yourself.
- Slippage "medium risk" differs by caller: the server default is "1+ times AND 7+ days", while the
  UI sends "OR". Read the returned `rule` strings.

## Smart tags (`/opportunities/smart-filters`, `filterType:"smarttag"`)

- **A smart tag exists only in the browser.** The app evaluates each tag's rule on every card it
  draws. Nothing is stored on the opportunity, search cannot filter by it, and no workflow trigger
  or condition can see it. To act on "has tag X", repeat the tag's conditions in the workflow.
- **A rule that throws matches nothing, silently.** Check a rule written through the API on the board.
- **Date conditions are `operator:"range"` with `{gte, lte, selection}`.** For a preset (`thisWeek`,
  `last3Days`…) the window is recomputed from `selection` each time the board draws, in the
  location's timezone (a week is Monday to Sunday). The stored `gte`/`lte` are the day it was saved.
- The UI's four **Prebuilt tags** (High Value, New Lead, Unassigned Deal, Hot Deal) are presets. They
  save through the same create call, with no marker, and can be renamed before saving.
- 60 tags per pipeline, enforced by the server. Every new tag is saved with `position: 1`.

## Bulk actions (UI)

- Bulk edit and bulk delete run as jobs listed under Opportunities › Bulk Actions.
- A bulk delete can be undone there (Restore) or per card. A bulk edit cannot be undone.
