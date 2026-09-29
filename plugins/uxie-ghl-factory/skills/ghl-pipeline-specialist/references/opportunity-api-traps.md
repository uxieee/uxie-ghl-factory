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
- **Deleting a pipeline deletes its opportunities,** and the cards get no DELETED audit row of their
  own. Restore the **pipeline** instead: Settings › Audit logs › Pipeline · Deleted › Restore
  (`POST /opportunities/pipelines/{id}/restore {}`). That brought back the pipeline and its card four
  days after the delete. A single-opportunity delete is restored from its own row.
- **Deleting a contact deletes its opportunities.** Each card gets its own Opportunity · Deleted audit row.
  Restoring a card from that row (`PUT /opportunities/{id}/restore {forceRestore:true}`) brings the card
  back **and restores the deleted contact with it**. Warn before deleting a contact that holds deals.
- **Deleting an opportunity unlinks its notes and tasks; it does not delete them.** The notes keep their
  contact relation (the opportunity relation is soft-deleted), and the tasks stay readable by id. Restoring the
  card relinks both. The app's warning that a delete "removes linked notes and tasks" overstates it.
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
- **The edit form's Business name, Primary email and Primary phone belong to the CONTACT.** A save sends
  `PUT /contacts/{contactId}` with just those keys, so the change shows everywhere that contact appears. The
  public opportunity update never touches them. To change them from a script, update the contact
  (the public contacts tools) and say it changes the contact, not only this deal.
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

- **A linked invoice can quote the deal.** With `opportunityDetails.opportunityId` set, its text takes
  `{{ opportunity.name }}` and the rest of the Opportunity Details group (pipeline, stage, status, value, owner,
  source, lost reason, close date, probability, custom fields). The tag is stored raw and renders only on the
  hosted invoice page (⋮ › Preview, or when sent). The editor's own preview shows it blank.

- **A lost reason typed into the edit form is created the moment you pick it** (`POST
  /opportunities/lost-reason`), even if the form is then cancelled. Stray reasons stay in the list.
- **Rename or delete a lost reason** with `PUT /opportunities/lost-reason/{id} {name, locationId}` and
  `DELETE /opportunities/lost-reason/{id}` (internal `raw_request`); the public API only lists them. In the app this is
  Settings › Custom Fields › Opportunity › Lost reason › Define lost reason options. A deleted reason answers 404
  `LOST_REASON_NOT_FOUND` by id.

## Account settings

- **Owners are synced both ways by default.** Changing an opportunity's owner also changes its
  contact's owner, and the reverse. Only "Allow different owners of Contacts and their
  Opportunities" (decoupling) stops it.
- Follower sync (a new owner becomes a follower of the linked contact or opportunity) can only be
  switched on while decoupling is on.
- "Allow more than one opportunity per contact in the same pipeline" is on a different screen
  (Settings › Objects › Opportunities) and a different key (`allowDuplicateOpportunity`, top level
  of the location write).
- **Searchable fields are one list per object for the whole account**: `GET /objects/` →
  `searchableProperties`, written by `PUT /objects/{objectKey}` (objectKey `opportunity`, body
  `{locationId, searchableProperties}`). The write is a full replace: a field taken out of the list stops
  matching at once, for every user. To undo a change, write back the list you read first. "Reset to
  default" gives GHL's defaults, which may not be what the account had.
- Once the settings screen has been saved, the UI cannot return the settings to "never set". It
  writes explicit `false` instead, which behaves the same.

## Forecast

- The four report endpoints are POSTs that answer 201 and store nothing.
- Stage and owner rows are labelled with their UUIDs; join the names yourself.
- Slippage "medium risk" differs by caller: the server default is "1+ times AND 7+ days", while the
  UI sends "OR". Read the returned `rule` strings.
- The app's **Adjust risk settings is not saved**: it only re-reads slippage with new thresholds, and a reload
  goes back to 2|14, 1|7, 1|1. Pass `riskThresholds` on every call if the user wants their own bands.
- The "Fix your forecast data" lists (missing close date, missing value) can be bulk edited only with ONE pipeline
  selected; the edit is an ordinary bulk job (`POST /bulk-actions/request`, bulk-edit) listed under Bulk Actions.

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

## Board display

- Card layout (Default / Compact / Unlabeled), card fields and quick actions are saved only on a **saved
  view** (`/lists/dynamic`, `cardConfig` plus `columns`). "Apply" in Customize card changes the screen and
  saves nothing. The built-in "Open opportunities" view cannot be overwritten.

## Bulk actions (UI)

- Bulk edit and bulk delete run as jobs listed under Opportunities › Bulk Actions.
- A bulk delete can be undone there (Restore) or per card. A bulk edit cannot be undone.
- A bulk edit REPLACES a field's value, and a field added to the edit but left EMPTY **clears** it
  (`customFields:[{id, field_value:null}]`). Value must be a number >= 0 once it is added; Name is not editable.
- **Dragging a card to LOST is not safe to cancel.** With no stored reason the app asks for one, but Cancel still saves
  `status:"lost"` with `lostReasonId:null`. With a reason already stored it does not ask, and it wipes the reason.
  Move a lost card back with `status:"open"` (an open card drops its reason), and re-set the reason yourself.
- **A primary-contact swap or an additional-contact add is refused when that contact already holds a card in the same
  pipeline** and duplicates are off (`OPPORTUNITY_NO_DUPLICATE` on the PUT, "duplicate opportunity relation" on
  `POST /associations/relations/`). The app's edit form shows no error: it just stays open, unsaved. Read the card back.
- **A blank Opportunities board or Forecast can be a third-party agency script, not an outage.** The console error
  `Module "./vue3" does not exist in container.` with the GoGHL script (`api.goghl.ai`) installed; blocking that host in
  the browser makes the screens render. The fix belongs to whoever owns the script.
- A CSV import is a background job (`bulk-import-v2`) that can sit at "processing 0/N" for minutes before
  it runs. A `Source` column is written to both the contact and the opportunity.

## Contacts into a pipeline in one job (`bulk-ops-v2`)

This is the job behind Contacts › select › **Manage opportunities**. Call it with `raw_request`, host `ai`, `confirm:true`:

```
POST /bulk-actions/request
{"bulkActionType":"bulk-ops-v2","title":"<name>","locationId":"{loc}","documentSource":"search","scheduleType":"NOW",
 "documentIds":["{contactId}", "…"],
 "opSpecs":{"opType":"bulk-ops-v2","note":"<name>","pipelineId":"{pipelineId}","pipelineStageId":"{stageId}",
            "description":"Pipeline: <name> | Stage: <name>","name":"…","monetaryValue":0,"status":"open","customFields":[]}}
```

- `documentIds` are **contact** ids. List them explicitly and show the user the count first. The app sends a
  filter (`documentSourceQuery`) for "select all", and that runs against whatever matches when the job starts.
- 🔴 **It is an upsert.** A contact that already has a card in that pipeline has that card updated; it does
  not get a second card. Say so before running it on contacts that already have cards. This was
  proven with "Allow more than one opportunity per contact in the same pipeline" off (Settings › Objects ›
  Opportunities). With it on, the result is untested: read the setting first.
- Other fields go in `opSpecs` by their own key: assignedTo, followers, source, lostReasonId. Custom fields
  go in `customFields:[{id, field_value}]`.
- It answers `201 {bulkRequest:{id, status:"processing"}}`. Poll `GET /bulk-actions/request/{id}` until
  `bulkRequest.status` is `complete`, then check that `stats.processed` equals the number of ids. Read the cards
  back with the public opportunity search.
- Undo is not proven for this job type (Restore is offered on delete jobs). Treat it as irreversible.
- Every card it creates or moves can fire that pipeline's opportunity triggers. Check them first (see
  reference-pipelines.md, "Before any bulk card move").
