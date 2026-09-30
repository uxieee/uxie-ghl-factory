# Appointment-family waits, the deprecated event start date, trigger toggle rows, runtime reads

Measured on a live sandbox on 2026-09-28 to 2026-09-30. Where a line says *source*, it was read from the builder's source and not run.

## Appointment-family waits

`appointment`, `service_booking`, `rental_booking`, `attendee_event_date` and `overdue` are one family: each needs `appointmentStartAfter {when, type, value, distributed}` and takes `appointmentCondition` (`next`, `specific-step`, `exit` or `skip`, with a hyphen). A missing `appointmentCondition` is only a warning. None of the five can branch. `describe_step_type` gives the exact keys.

- The drawer names the source trigger for each: *Rental booking* and *Service booking* appear only when the location has the rentals or services calendar module. *Event date* (`attendee_event_date`) is offered only when the workflow has an event-registration trigger. *Invoice due date* (`overdue`) belongs to an invoice trigger.
- `build_workflow` stores all five as written and reads them back. Whether a run of `rental_booking`, `attendee_event_date` or `overdue` releases at the right time was not run: they need a rental booking, an event registration or an overdue invoice.

## The deprecated event start date setting

`settings.eventStartDate` is an ISO instant that GHL has deprecated in favour of the `event_start_date` step. It is stored and read back unchanged. Once a value is stored the Settings tab shows a card marked "[Deprecated]: please use event start date action", but the date input on that card reads blank. Read the stored document (`get_workflow`), not the tab, to see the value. Whether a run uses the setting as the anchor for an appointment wait was not measured.

## Trigger toggle rows and deprecated operators

- Some toggles in a trigger's drawer are hidden filter rows (*source*): "Trigger only for new email conversations" is the row `email.isReply == false`. To get the toggle, write the row.
- On 14 trigger types (opportunity, payments and courses among them) a string custom-field row hides the operators `matches_intent` and `string-matches-any-of`. A stored one still loads and saves: the canvas card reads "matches intent" and the drawer shows *Select operator* with an empty value. The compiler warns `TRIGGER_OPERATOR_DEPRECATED`; do not author them. Whether a run evaluates a stored one was not measured.
- The builder refuses an empty filter row and the API stores one, so do not write an empty row.

## Reading what a workflow did

- `get_workflow_logs`: execution logs. `executionId` traces one run; `includeAgentTrace: true` adds an AI Agent step's message trace. `eventType=all_failed` is expanded by the tool into the five failure statuses because the server answers it with an empty list; repeated `eventType` parameters are ORed and a comma list returns an empty list. `added_to_workflow` is the only proof a trigger fired.
- `get_workflow_stats`: the Stats view's per-email-step Delivered, Opened, Clicked, Replied and Bounced counts for the last days asked for. A workflow with no email or SMS step returns no steps.
- `get_contacts_at_step`: who is parked where.

## Runtime notes on the builder's Save version

With the location's auto-save on, drawer edits go to the auto-save route and the Version history panel shows the current version as *Auto-Saved* with a **Save version** button. That button commits the auto-save and leaves the version number unchanged. The plugin's `build_workflow` and `edit_workflow` already write through the auto-save route and do not need it. `list_workflow_versions`, `get_workflow_version` and `restore_workflow_version` read and restore history: a restore lands as a draft and its triggers come back inactive with new ids.
