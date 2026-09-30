# Merge tags in a workflow: what renders, and how to write the helpers

Measured on a live sandbox on 2026-09-30 by running one published workflow and reading its notes back on a separate request. Use this when a step's text needs data from a trigger, a list, a date or a fallback value.

## Trigger data

An `inbound_webhook` trigger's payload is read as `{{inboundWebhookRequest.<path>}}`, one path per leaf of the pinned sample (`pin_webhook_sample`). A trigger-context namespace is meant for that trigger's own run: the corpus page on merge-tag rendering lists which namespaces resolve where.

## Lists: `formatList`

```
{{formatList (pluck inboundWebhookRequest.<path>.items "<field>") format="comma_separated"}}
{{formatList (pluck … "<field>") format="numbered_list"}}
{{formatList (pluck … "<field>") format="custom_separator" separator=" | "}}
```

Read back from a run: `alpha, beta, gamma`; three lines `1. alpha` `2. beta` `3. gamma`; `alpha | beta | gamma`. This is the formula the builder's *Insert as text* action writes for an array.

## Dates

The **Right now** family renders in the location's time zone: `{{right_now.middle_endian_date}}` (month/day/year), `{{right_now.time_ampm}}`, `{{right_now.year}}`, and further entries the picker lists. They are plain merge tags, not date-format helpers.

## Fallbacks

`{{default <tag> "<value>"}}` works in any step and renders the value when the tag is empty. An email body needs the inline default attribute instead (see the email step's type card).

## What the engine checks

`build_workflow` refuses a token that is neither a picker tag nor one of the location's custom fields (`MERGE_TAG_UNKNOWN`, for example nested square brackets in `{{contact.[a[b]]}}`) and warns on unbalanced braces (`MERGE_TAG_SOFT`). GHL's own validator accepts both and stores them unchanged, and the builder shows the first as a red error chip. What either renders at run time was not measured, so do not author them.

## Picking in the editor

The editor's merge-tag picker (tag icon) lists Contact, Company, User, Appointment, Calendar, Message, Account, Right now, Phone Call, Client Portal Contact, Attribution, Voice AI, Conversation AI and Custom Values, plus one family per trigger that has a pinned sample. The SMS editor also has a lightning icon for trigger links. A marketplace step's rich-text field has an **@** Mention tool instead, and no lightning icon. `search_merge_tags` searches the picker's tags.

## Custom-object workflows

In a workflow that belongs to a custom object, the picker offers only two families, **Custom Object** and **Custom Values**, and the editor shows a `contact.*` chip in red. A run still rendered `{{right_now.year}}`, `{{location.name}}` and `{{default … "x"}}`; `{{contact.first_name}}` and `{{workflow.name}}` came back empty (an object workflow has no contact, and `workflow` is a namespace the picker does not list). Put an *Update record* step after a 1-minute wait, not straight after the trigger: without the wait it failed with "No records were found".

## Voice AI tags

`{{voice_ai.duration}}`, `{{voice_ai.summary}}`, `{{voice_ai.transcript}}` and `{{voice_ai.formattedTranscript}}` store as written and render EMPTY in a run that no Voice AI call started. What they hold when a call starts the run, and the format of the formatted transcript, was not measured.
