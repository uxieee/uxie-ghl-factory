# Capabilities index — every step & trigger the engine can build

> GENERATED from `engine/catalog.data.json` — do not hand-edit.
> Regenerate: `node scripts/query-catalog-cli.mjs --md > references/capabilities.md`
> Look one type up (full shape card): `node scripts/query-catalog-cli.mjs <term>`

**385 step types / 204 trigger types.** This index — not your recall of "what GHL supports" — is the capability truth. NEVER tell the user a step or trigger "isn't supported", and never substitute a webhook/custom-code workaround for a native action, without searching here first.

**Native pause (every step type):** set IR `disabled: true` to emit top-level `advanceCanvasMeta.isDisabled: true`. This is the same per-action pause used by GHL's ⏸ button; it preserves the step config and skips that step at runtime.

Legend: ✅ verified-live (round-tripped against a live account) · ◐ bundle-derived · ▫ live-schema (marketplace) · ⚑ recon-fields (field structure captured; not yet commit-verified).

## Native steps — by section (with authorable attribute keys)

### affiliate
- ◐ `add_to_affiliate_campaign` — attrs: `name`, `campaign_id`
- ◐ `add_to_affiliate_manager`
- ◐ `remove_from_affiliate_campaign` — attrs: `name`, `campaign_id`
- ◐ `update_affiliate` — attrs: `name`, `affiliate_state`

### appointments
- ✅ `update_appointment_status` — attrs: `category`, `type`, `status_type`

### communication
- ✅ `call` — attrs: `timeout`, `whisper_message`, `disable_detect_voicemail`, `call_connect`
- ◐ `conversation_ai`
- ✅ `email` — attrs: `html`, `from_name`, `from_email`, `subject`, `attachments`, `preHeader`, `template_id`, `cc`, `bcc`, `templatesource`, `to`, `testEmails` +18 more (see card)
- ◐ `fb_interactive_messenger`
- ◐ `gmb`
- ◐ `ig_interactive_messenger`
- ◐ `instagram-dm` — attrs: `body`, `template_id`, `attachments`, `urlAttachments`, `to`, `testPhones`, `userType`, `selectedUser`, `assignedUser`, `standardAssignedUser`, `customAssignedUser`, `assignedOwners` +2 more (see card)
- ✅ `internal_notification` — attrs: `type`, `sms`, `email`, `whatsapp`, `notification`, `userType`, `selectedUser`
- ✅ `manual-call` — attrs: `assignedUser`, `standardAssignedUser`
- ✅ `manual-sms` — attrs: `body`, `assignedUser`, `standardAssignedUser`, `attachments`
- ◐ `messenger` — attrs: `body`, `template_id`, `attachments`, `urlAttachments`, `to`, `testPhones`, `userType`, `selectedUser`, `assignedUser`, `standardAssignedUser`, `customAssignedUser`, `assignedOwners` +2 more (see card)
- ◐ `respond_on_comment`
- ✅ `review_request` — attrs: `type`, `review_type`, `overrideReviewLink`
- ✅ `slack_message` — attrs: `action`, `integration`, `channel`, `text`, `type`, `userSource`; premium
- ✅ `sms` — attrs: `body`, `attachments`, `template_id`, `urlAttachments`, `to`, `testPhones`, `userType`, `selectedUser`, `assignedUser`, `standardAssignedUser`, `customAssignedUser`, `assignedOwners` +2 more (see card)
- ✅ `voice_ai_outbound_call` — attrs: `agentId`, `fromPhoneNumber`, `outboundGuidelines`, `type`, `__customInputs__`
- ✅ `voicemail` — attrs: `attachment`

### contact
- ✅ `add_contact_tag` — attrs: `tags`, `removeAll`, `customTags`
- ✅ `add_notes` — attrs: `html`, `type`, `title`, `color`
- ✅ `assign_user` — attrs: `only_unassigned_contact`, `total_index`, `traffic_split`, `traffic_weightage`, `traffic_index`, `user_list`, `type`, `customUserList`
- ✅ `copy_contact_to_subaccount` — attrs: `type`, `newLocations`, `withTags`, `withCustomFields`, `tags`, `updateIfExists`, `customTags`; premium
- ✅ `create_update_contact` — attrs: `type`, `fields`
- ✅ `dnd_contact` — attrs: `type`, `dnd_contact`, `specific_channels`, `dnd_direction`
- ✅ `find_contact` — attrs: `type`, `fields`, `convertToMultipath`, `name`, `cat`, `isHybridAction`, `hybridActionType`, `transitions`; container → IR kind `find_contact (onFound/onNotFound)`
- ✅ `remove_assigned_user` — attrs: `type`
- ✅ `remove_contact_tag` — attrs: `tags`, `type`, `removeAll`, `customTags`
- ✅ `update_contact_field` — attrs: `type`, `actionType`, `fields`

### conversation_ai
- ✅ `conversationai_book_appointment` — attrs: `promptInstructions`, `calendarId`, `type`, `__customInputs__`, `cat`, `convertToMultipath`, `transitions`, `__name__`; container → IR kind `conversationai_book_appointment`
- ✅ `conversationai_continue` — attrs: `instructions`, `type`, `__customInputs__`
- ✅ `conversationai_end` — attrs: `message`, `sleepEnabled`, `sleepDuration`, `sleepUnit`, `type`, `__customInputs__`
- ⚑ `conversationai_services_booking` — attrs: `conversationai_services`, `conversationai_booking_description`, `type`, `__customInputs__`

### customObjects
- ◐ `clear_custom_object_fields`
- ◐ `create_custom_object`
- ◐ `update_custom_object`

### eliza
- ◐ `add_appointment_booking_ai_bot` — attrs: `calendar_id`, `timeout_time`, `send_first_message`, `no_confirmation_message`, `send_success_message`, `success_message`, `success_message_template_id`, `first_message`, `template_id`
- ◐ `send_to_eliza`

### external_ai_models
- ✅ `chatgpt` — attrs: `type`, `apiKey`, `event`, `model`, `temperature`, `promptText`, `actionType`, `actionParams`, `memoryKey`, `excludeFromHistory`, `excludeInstructionsFromHistory`, `instructions`; premium

### internal
- ✅ `add_to_workflow` — attrs: `input_trigger_params`, `type`, `workflow_id`
- ◐ `array_functions` — attrs: `name`, `action`, `referenceObject`, `referenceMappings`, `referencePath`, `format_as_text`, `selectedArray`
- ✅ `custom_code` — attrs: `code`, `language`, `inputData`, `output`; premium
- ✅ `datetime_formatter` — attrs: `type`, `action`, `format`; premium
- ✅ `drip` — attrs: `batchSize`, `interval`, `type`
- ✅ `event_start_date` — attrs: `type`, `event_start_type`, `value`, `recurring_type`, `recurring_time`
- ✅ `goto` — attrs: `targetNodeId`, `type`, `loopIdentified`
- ✅ `if_else` — attrs: `else`; container → IR kind `if_else`
- ◐ `loop`
- ✅ `math_operation` — attrs: `selectField`, `selectFieldtype`, `sourceCustomValueId`, `updateField`, `updateFieldType`, `targetCustomValueId`, `operators`, `operator`, `value`
- ◐ `number_formatter` — attrs: `action`
- ✅ `remove_from_workflow` — attrs: `type`, `workflow_id`, `includeCurrent`, `allWorkflows`
- ✅ `text_formatter` — attrs: `type`, `extras`, `formatterType`, `field`; premium
- ◐ `update_custom_value` — attrs: `name`, `custom_value_id`, `current_value`, `new_value`
- ✅ `wait` — attrs: `type`, `startAfter`, `window`, `condition`, `appointmentStartAfter`, `appointmentCondition`, `appointmentSpecificStep`, `reply`, `replyLabel`, `emailEventSteps`, `emailEventStepsLabel`, `emailEventTypes` +45 more (see card)
- ✅ `workflow_goal` — attrs: `op`, `segments`, `type`, `action`
- ✅ `workflow_split` — attrs: `name`, `cat`, `transitions`, `type`, `paths`, `condition`, `extras`, `distributionType`; container → IR kind `split`

### ivr
- ◐ `ivr_collect_voicemail`
- ◐ `ivr_connect_call` — attrs: `timeout`, `timeLimit`, `record`, `detectVoicemail`, `isSayPlayOn`, `sayPlayAttributes`, `userId`, `users`, `customNumbers`
- ◐ `ivr_gather`
- ◐ `ivr_hangup`
- ◐ `ivr_say`

### marketing
- ✅ `facebook_add_to_custom_audience` — attrs: `type`, `facebook_account_id`, `facebook_custom_audience_id`
- ✅ `facebook_conversion_api` — attrs: `type`, `event_type`, `access_token`, `currency`, `connection_type`, `customMapping`, `isCustomMappingEnabled`, `pixel_id`, `stage_name`, `event_name`, `value`, `facebook_page` +2 more (see card)
- ◐ `facebook_remove_from_custom_audience`
- ◐ `google_adword` — attrs: `conversion_type`, `conversion_name`, `conversion_action_id`, `isCustomMappingEnabled`, `customMapping`, `conversion_value`, `currency`
- ◐ `google_analytics` — attrs: `action_type`, `event_action`, `event_category`, `event_label`, `event_value`, `ga4_event_value`, `tracking_id`, `measurement_id`, `event`, `api_secret`

### membership
- ✅ `membership_grant_offer` — attrs: `type`, `offer_id`
- ◐ `membership_revoke_offer` — attrs: `offer_id`

### opportunity
- ✅ `create_opportunity` — attrs: `type`, `pipeline_id`, `opportunity_status`, `opportunity_name`, `opportunity_source`, `monetary_value`, `pipeline_stage_id`, `lostReasonId`, `allow_backward`, `allow_multiple`, `fields`
- ✅ `remove_opportunity` — attrs: `type`, `opportunity_to_be_found`, `pipeline_id`

### other
- ✅ `appointment_booking` — attrs: `calendarId`, `startDateTime`, `ignoreFreeSlots`, `type`, `__customInputs__`; premium
- ✅ `contact_email_verification` — attrs: `type`, `__customInputs__`
- ✅ `contact_engagement_score` — attrs: `operator`, `points`, `type`, `__customInputs__`
- ✅ `conversationai_ai_message` — attrs: `message`, `waitForReply`, `type`, `__customInputs__`
- ✅ `conversationai_ai_splitter` — attrs: `description`, `type`, `__customInputs__`, `cat`, `convertToMultipath`, `transitions`, `__name__`; container → IR kind `conversationai_ai_splitter`
- ✅ `conversationai_custom_message` — attrs: `message`, `waitForReply`, `type`, `__customInputs__`
- ✅ `conversationai_objective` — attrs: `objective`, `contactField`, `instructions`, `responseExample`, `skipIfFilled`, `maxAttempts`, `proceedIfNotMet`, `type`, `__customInputs__`; premium
- ✅ `conversationai_transfer_bot` — attrs: `assignedEmployeeId`, `type`, `__customInputs__`
- ✅ `edit_conversation` — attrs: `read`, `type`, `__customInputs__`
- ✅ `find_opportunity` — attrs: `sorting`, `type`, `__customInputFields__`, `__customInputs__`, `cat`, `convertToMultipath`, `transitions`, `__name__`; container → IR kind `find_opportunity (onFound/onNotFound)`
- ✅ `find_or_create_contact` — attrs: `emailLabel`, `emailAddress`, `namePrefix`, `names`, `middleName`, `lastName`, `nameSuffix`, `organizationName`, `jobTitle`, `phoneLabel`, `phoneNumber`, `addressLabel` +8 more (see card); premium
- ✅ `internal_create_opportunity` — attrs: `pipelineId`, `type`, `__customInputs__`, `__customInputFields__`
- ✅ `internal_update_opportunity` — attrs: `allowBackward`, `type`, `__customInputFields__`, `__customInputs__`
- ✅ `internal-add-contact-followers` — attrs: `users`, `type`, `__customInputs__`
- ✅ `internal-add-opportunity-owner` — attrs: `user`, `onlyUnAssigned`, `type`, `__customInputs__`
- ✅ `internal-delete-contact` — attrs: `type`, `__customInputs__`
- ✅ `internal-remove-contact-followers` — attrs: `isRemoveAllOpportunityFollowers`, `type`, `__customInputs__`
- ✅ `lc_merge_contact` — attrs: `match_by`, `type`, `__customInputs__`, `cat`, `convertToMultipath`, `transitions`, `__name__`; container → IR kind `lc_merge_contact (onFound/onNotFound)`
- ✅ `live_chat_response` — attrs: `liveChatResponse`, `type`, `__customInputs__`
- ✅ `proposals_estimates_send_document` — attrs: `userId`, `templateId`, `sendDocument`, `type`, `__customInputs__`
- ✅ `task-notification` — attrs: `type`, `title`, `assignedTo`, `dueDate`, `body`
- ✅ `transition`
- ✅ `update_conversation_ai_status` — attrs: `assignedEmployeeId`, `status`, `type`, `__customInputs__`
- ✅ `workflow_ai_decision_maker` — attrs: `instructions`, `information`, `type`, `__customInputs__`, `cat`, `convertToMultipath`, `transitions`, `__name__`; container → IR kind `ai_decision`

### payment
- ◐ `stripe_one_time_charge` — attrs: `amount`, `currency`, `description`, `stripe_customer_id`

### send_data
- ✅ `custom_webhook` — attrs: `event`, `method`, `url`, `body`, `headers`, `parameters`, `authorization`, `saveResponse`, `webhookResponse`, `runSingleAction`; premium
- ✅ `google_sheets` — attrs: `type`, `action`, `account`, `drive`, `spreadsheet`, `sheet`, `columnRange`, `values`, `sheetHeaders`, `options`, `targetRow`, `rowCount`; premium
- ✅ `webhook` — attrs: `method`, `url`, `customData`, `headers`

### workflow_ai
- ✅ `ai_agent` — attrs: `prompt`, `structuredResponse`, `model`, `tools`, `outputFormat`, `outputDescription`, `memoryEnabled`; premium
- ◐ `workflow_ai_generate_image` — attrs: `model`, `prompt`, `additionalSettings`; premium

## Containers / control flow (IR node kinds)

| IR kind | step type | shape |
|---|---|---|
| `if_else` | `if_else` | N≥2 branches, one optional `else: true` |
| `split` | `workflow_split` | weighted/random branches |
| `ai_decision` | `workflow_ai_decision_maker` | Default + N LLM branches |
| `wait` | `wait` | plain wait, or multipath on outcomes |
| `goto` | `goto` | must be last node in its branch |
| `onFound`/`onNotFound` | `find_contact`, `find_opportunity`, `lc_merge_contact` | pre-set 2-branch finders |
| `onBooked`/`onNotBooked` | `conversationai_book_appointment` | flow-builder 2-branch booking (Booked/Not-booked) |
| `branches`/`default` | `conversationai_ai_splitter` | flow-builder LLM router: named branches + "No condition met" fallback |

## Marketplace steps (▫ live-schema — build fine, RUN only if the app is installed)

`add_associated_records_to_workflow`, `add_contact_tag_tool`, `add_contact_to_groups`, `add_person_to_project`, `agent_studio_execution`, `airtable_create_record`, `airtable_delete_record`, `airtable_find_record_by_id`, `airtable_retrieve_record`, `airtable_update_record`, `am-add-lead`, `am-add-manual-commission`, `appointment_booking_conversation_ai`, `asana_ia_asana_add_task_to_section`, `asana_ia_asana_create_comment`, `asana_ia_asana_create_project`, `asana_ia_asana_create_section`, `asana_ia_asana_create_subtask`, `asana_ia_asana_create_task`, `asana_ia_asana_find_task_by_id`, `asana_ia_asana_get_task`, `asana_ia_asana_update_task`, `asana_ia_find_all_tasks_from_project`, `asana_ia_find_comment_from_task_id`, `asana_ia_find_comment_from_task`, `asana_ia_find_task_in_project`, `assign_to_user_tool`, `associate_records`, `basecamp_create_campfire_message`, `basecamp_create_comment_on_message`, `basecamp_create_comment_on_todo`, `basecamp_create_document`, `basecamp_create_message`, `basecamp_create_project_from_template`, `basecamp_create_schedule_entry`, `basecamp_create_todo_list`, `basecamp_create_todo`, `basecamp_find_document`, `basecamp_find_person`, `basecamp_find_project`, `basecamp_find_to_do_list`, `basecamp_find_to_do`, `basecamp_get_todo`, `basecamp_update_todo`, `basecamp_upload_file`, `bulk_email_verification`, `calendars_create_appointment_note`, `calendars_generate_one_time_booking_link`, `clear_associated_company_fields`, `clickup_add_comment`, `clickup_archive_task`, `clickup_create_list`, `clickup_ia_create_folder`, `clickup_ia_create_space`, `clickup_ia_create_sub_task`, `clickup_ia_create_task`, `clickup_ia_delete_task`, `clickup_ia_update_task`, `clickup_new_checklist`, `create_and_associate_company`, `create_basecamp_project`, `create_new_document_page`, `create_new_document`, `create_recurring_invoice`, `create_task_attachment`, `custom-push-notification`, `edit_document_page`, `find-notion-page-by-title`, `find_all_tasks`, `find_associated_record`, `find_custom_fields`, `find_documents`, `find_notion_comment`, `find_task_by_id`, `generate_marketing_audit_report`, `googlecontact_create_contact`, `googlecontacts_create_contact_group`, `googlecontacts_find`, `googlecontacts_update_contact`, `grant-group-access`, `grant-private-channel-access`, `grant_user_group_gamification_points`, `imessage_a`, `internal-add-opportunities-followers`, `internal-remove-opportunities-followers`, `internal-remove-opportunity-owner`, `issue_certificates_workflow`, `kb_search`, `lc_apify_run_a_actor`, `lc_browse_ai_bulk_run_tasks`, `lc_browse_ai_get_bulk_run`, `lc_browse_ai_get_task`, `lc_browse_ai_run_task`, `lc_cal_com_cancel_booking`, `lc_cal_com_create_booking`, `lc_cal_com_find_booking`, `lc_cal_com_reschedule_booking`, `lc_custom_apify_fetch_dataset_items`, `lc_custom_apify_fetch_key_value_store_record`, `lc_custom_apify_find_last_actor_run`, `lc_custom_apify_find_last_task_run`, `lc_custom_apify_run_task`, `lc_custom_apify_scrape_single_url`, `lc_custom_apify_set_key_value_store_record`, `lc_custom_asana_find_project`, `lc_custom_asana_find_section`, `lc_custom_asana_get_project_by_id`, `lc_custom_calendly_book_meeting_for_invitee`, `lc_custom_calendly_cancel_event`, `lc_custom_calendly_create_contact`, `lc_custom_calendly_create_one_off_meeting`, `lc_custom_calendly_find_contact`, `lc_custom_calendly_find_event`, `lc_custom_calendly_find_user`, `lc_custom_calendly_mark_invitee_no_show`, `lc_custom_calendly_update_contact`, `lc_custom_jira_create_issue_with_comment`, `lc_fathom_fetch_summary`, `lc_fathom_fetch_transcript`, `lc_fathom_list_recordings`, `lc_gform_find_responses`, `lc_gforms_find_form_by_id`, `lc_gforms_find_forms_by_name`, `lc_gforms_find_response_by_id`, `lc_google_tasks_create_task_list`, `lc_google_tasks_create_task`, `lc_google_tasks_find_task`, `lc_google_tasks_get_tasks_by_list`, `lc_google_tasks_update_task`, `lc_gs_create_presentation_from_template`, `lc_gs_find_presentation`, `lc_gs_refresh_charts`, `lc_housecall_pro_create_customer_address`, `lc_housecall_pro_create_customer`, `lc_housecall_pro_create_estimate`, `lc_housecall_pro_create_job_appointment`, `lc_housecall_pro_create_job`, `lc_housecall_pro_create_lead`, `lc_housecall_pro_find_customers`, `lc_housecall_pro_get_customer_address`, `lc_housecall_pro_get_customer`, `lc_housecall_pro_get_estimate`, `lc_housecall_pro_get_job`, `lc_housecall_pro_get_jobs`, `lc_housecall_pro_get_lead`, `lc_housecall_pro_update_customer`, `lc_housecall_pro_update_job_appointment`, `lc_hubspot_create_contact`, `lc_hubspot_find_contact`, `lc_hubspot_get_crm_object_by_id`, `lc_hubspot_get_custom_object_by_id`, `lc_jira_add_attachment_to_issue`, `lc_jira_add_comment`, `lc_jira_add_watcher_to_issue`, `lc_jira_add_work_log_to_issue`, `lc_jira_create_issue`, `lc_jira_find_issues`, `lc_jira_find_projects`, `lc_jira_find_users`, `lc_jira_link_issue`, `lc_jira_move_issue_to_sprint`, `lc_jira_update_issue`, `lc_klaviyo_add_profile_to_list`, `lc_klaviyo_add_tag_to_list`, `lc_klaviyo_add_tag_to_segment`, `lc_klaviyo_create_list`, `lc_klaviyo_create_profile`, `lc_klaviyo_find_campaigns`, `lc_klaviyo_find_list`, `lc_klaviyo_find_profile`, `lc_klaviyo_find_segment`, `lc_klaviyo_find_tags`, `lc_klaviyo_remove_profile_from_list`, `lc_klaviyo_remove_tag_from_list`, `lc_klaviyo_remove_tag_from_segment`, `lc_klaviyo_send_campaign`, `lc_klaviyo_subscribe_profile`, `lc_klaviyo_unsubscribe_profile`, `lc_klaviyo_update_profile`, `lc_linear_add_label_to_issue`, `lc_linear_create_attachment`, `lc_linear_create_comment`, `lc_linear_create_customer_need`, `lc_linear_create_customer`, `lc_linear_create_issue`, `lc_linear_create_project`, `lc_linear_find_customer`, `lc_linear_find_issue_by_id`, `lc_linear_find_issues`, `lc_linear_find_project_by_id`, `lc_linear_remove_label`, `lc_linear_update_issue`, `lc_manus_continue_task`, `lc_manus_create_task`, `lc_manus_delete_task`, `lc_manus_fetch_task`, `lc_manus_get_task`, `lc_manus_update_task`, `lc_mistral_ai_analyze_image_vision`, `lc_mistral_ai_create_chat_completion`, `lc_mistral_ai_create_embeddings`, `lc_monday_archieve_board`, `lc_monday_archive_group`, `lc_monday_create_board`, `lc_monday_create_column`, `lc_monday_create_group`, `lc_monday_create_item`, `lc_monday_create_subitem`, `lc_monday_delete_group`, `lc_monday_delete_item`, `lc_monday_find_by_column`, `lc_monday_find_items_by_id`, `lc_monday_get_items`, `lc_monday_update_item`, `lc_monday_update_subitem`, `lc_openrouter_generate_response`, `lc_tf_create_form`, `lc_todoist_add_comment_to_project`, `lc_todoist_add_comment_to_task`, `lc_todoist_complete_task`, `lc_todoist_create_project`, `lc_todoist_create_task`, `lc_todoist_find_project`, `lc_todoist_find_task`, `lc_todoist_find_user`, `lc_todoist_get_project_collaborators`, `lc_todoist_invite_user_to_project`, `lc_todoist_move_task_to_section`, `lc_todoist_update_task`, `lc_vapi_create_call`, `lc_vapi_create_chat`, `lc_vapi_delete_call_data`, `lc_vapi_delete_chat`, `lc_vapi_delete_file`, `lc_vapi_find_call`, `lc_vapi_update_call`, `lc_vapi_upload_file`, `log-external-call`, `notion_add_comment`, `notion_add_content_to_page`, `notion_create_database_item`, `notion_create_page`, `notion_find_database_item`, `notion_get_page_and_children`, `notion_get_page_comments`, `notion_restore_database_item`, `notion_retrieve_page`, `notion_update_database_item`, `payments_create_estimate`, `payments_create_invoice`, `rcs_interactive_message`, `react_to_last_message`, `remove_associated_record`, `remove_associated_records_from_workflow`, `remove_contact_tag_tool`, `revoke-group-access`, `revoke-private-channel-access`, `send-rcs`, `send_messenger_optin`, `send_rcs`, `send_smart_message`, `send_whatsapp_flow`, `send_whatsapp_message`, `survey_monkey_ia_create_contact`, `survey_monkey_ia_delete_survey`, `survey_monkey_ia_inputs`, `survey_monkey_ia_search_contact`, `survey_monkey_ia_send_survey`, `test_compilation`, `tiktok-dm`, `typeform_create_form`, `typeform_duplicate_existing_form`, `typeform_search_responses`, `update_associated_company`, `whatsapp_24h_window`, `whatsapp_interactive_messages`, `whatsapp_media`, `whatsapp_v2`, `workflow_ai_extract_data`, `workflow_ai_intent_detection`, `workflow_ai_summarize_text`, `workflow_ai_translate_content`

## Triggers — by category (with filterable fields)

### Airtable
- ▫ `airtable_new_record_created` (internal) — filters: Base (`base_id`), Table (`table_id`)
- ▫ `airtable_record_updated` (internal) — filters: Base (`base_id`), Table (`table_id`)

### Apify
- ▫ `apify_actor_run_finished` (internal) — filters: Actor (`actor_id`), Status (`eventType`)
- ▫ `apify_task_run_finished` (internal) — filters: Task (`task_id`), Status (`eventType`)

### Asana
- ▫ `asana_it_asana_attachment_added_to_task` (internal) — filters: Workspace (`workspace_id`), Project (`project_id`)
- ▫ `asana_it_asana_comment_on_task` (internal) — filters: Workspace (`workspace_id`), Project (`project_id`), Task (`target.gid`), Comment Text (`comment_text`), Commenter Name (`created_by.name`)
- ▫ `asana_it_asana_new_subtask` (internal) — filters: Workspace (`workspace_id`), Project (`project_id`), Task (`parent.gid`)
- ▫ `asana_it_asana_project_created` (internal) — filters: Workspace (`workspace_id`)
- ▫ `asana_it_asana_tag_added_to_task` (internal) — filters: Workspace (`workspace_id`), Project (`project_id`), Tags (`tag_gid`)
- ▫ `asana_it_asana_task_created` (internal) — filters: Workspace (`workspace_id`), Project (`project_id`)
- ▫ `asana_it_asana_task_deleted` (internal) — filters: Workspace (`workspace_id`), Project (`project_id`)
- ▫ `asana_it_asana_task_moved_to_section` (internal) — filters: Workspace (`workspace_id`), Project (`project_id`), Sections (`section_gids`)
- ▫ `asana_it_asana_task_updated` (internal) — filters: Workspace (`workspace_id`), Project (`project_id`), Status (`completed`), Fields Changed (`field`)

### BaseCamp
- ▫ `basecamp_new_activity` (internal) — filters: Account (`account_id`), Project (`project_id`), Types (`activity_type`), Events (`events`)
- ▫ `basecamp_new_comment_added` (internal) — filters: Account (`account_id`), Project (`project_id`)
- ▫ `basecamp_new_document` (internal) — filters: Account (`account_id`), Project (`project_id`), Folder (`parent_id`)
- ▫ `basecamp_new_message_posted` (internal) — filters: Account (`account_id`), Project (`project_id`)
- ▫ `basecamp_new_todo_created` (internal) — filters: Account (`account_id`), Project (`project_id`), Todo Set (`to_do_set`), Todo List (`todolist_id`)
- ▫ `basecamp_new_todo_list` (internal) — filters: Account (`account_id`), Project (`project_id`), Todo Set (`parent_id`)
- ▫ `basecamp_project_created` (internal) — filters: Account (`account_id`), Name (`name`)

### Browse AI
- ▫ `lc_browse_ai_new_task` (internal) — filters: Robot (`robot_id`), Event Type (`eventType`)

### Cal.com
- ▫ `lc_cal_com_booking_cancelled` (internal)
- ▫ `lc_cal_com_booking_created` (internal)
- ▫ `lc_cal_com_booking_rescheduled` (internal)
- ▫ `lc_cal_com_meeting_ended` (internal)
- ▫ `lc_cal_com_ooo_created` (internal)
- ▫ `lc_cal_com_recording_ready` (internal)

### Calendly
- ▫ `ankit_test_invitee_created` (internal) — filters: Webhook Subscription Scope (`scope`)
- ▫ `calendly_event_cancelled` (internal) — filters: Organization (`organization`)
- ▫ `calendly_invitee_canceled` (internal) — filters: Webhook Subscription Scope (`scope`)
- ▫ `calendly_invitee_created` (internal) — filters: Webhook Subscription Scope (`scope`)
- ▫ `calendly_invitee_no_show_created` (internal) — filters: Webhook Subscription Scope (`scope`)
- ▫ `lc_calendly_new_routing_form_submission` (internal)

### ClickUp
- ▫ `clickup_comment_created` (internal) — filters: Workspace (`team_id`), Space (`space_id`), Folders (`folder_id`), List (`list_id`), Task (`task_id`)
- ▫ `clickup_new_folder` (internal) — filters: Workspace (`team_id`), Space (`space_id`)
- ▫ `clickup_new_list` (internal) — filters: WorkSpace (`team_id`), Space (`space_id`), Folders (`folder_id`)
- ▫ `clickup_new_task` (internal) — filters: Workspace (`team_id`), Space (`space_id`), Folders (`folder_id`), List (`list_id`)
- ▫ `clickup_new_time_entry` (internal) — filters: Workspace (`team_id`), Space (`space_id`), Folders (`folder_id`), List (`list_id`), Task (`task_id`)
- ▫ `clickup_task_updated` (internal) — filters: WorkSpace (`team_id`), Space (`space_id`), Folders (`folder_id`), List (`list_id`), Status (`status`), Priority (`priority`)
- ▫ `lc_cu_task_changes_internal` (internal) — filters: WorkSpace (`team_id`), Space (`space_id`), Folders (`folder_id`), List (`list_id`), Status (`status`), Priority (`priority`)

### Ecommerce Stores
- ▫ `abandoned_checkout` (internal) — filters: Cart Value (`cartValue`), Order Source (`orderSource`), Sub Source (`subSource`), Duration (in mins) (`duration`), Global Products (`globalProductIds`), Country (`country`), Store Name (`storeId`)
- ▫ `ecommerce_order_fulfilled_trigger` (internal) — filters: Cart Value (`cartValue`), Fulfilled Products (`globalProductIds`), Tracking Number (`trackingNumber`), Shipping Carrier (`shippingCarrier`), Order Source (`order.source`), Order Sub Source (`order.sub_source`)
- ▫ `leadgen_ecommerce_review_submitted` (internal) — filters: Review Headline (`headline`), Review Comment (`comment`), User Name (`customer.name`), User email  (`customer.email`), Global Product (`global_product.id`), Store Name (`storeId`), Review Rating (star) (`rating`)

### Fathom
- ▫ `lc_fathom_new_recording` (internal) — filters: Triggers on (`triggers_on`)

### Google Ads
- ▫ `google_lead_form_submitted` (internal) — filters: Ad Account Is (`adAccountId`)

### Google Contacts
- ▫ `google_contacts_contact_created` (internal) — filters: Name (`name`), First Name (`firstName`), Last Name (`lastName`)
- ▫ `google_contacts_new_group` (internal) — filters: Name (`name`), Group Type (`groupType`)

### Google Forms
- ▫ `lc_gforms_new_updated_response` (internal) — filters: Form (`form_id`)

### Housecall Pro
- ▫ `lc_housecall_pro_customer_created` (internal)
- ▫ `lc_housecall_pro_estimate_created` (internal)
- ▫ `lc_housecall_pro_estimate_finished` (internal)
- ▫ `lc_housecall_pro_estimate_scheduled` (internal)
- ▫ `lc_housecall_pro_job_canceled` (internal)
- ▫ `lc_housecall_pro_job_created` (internal)
- ▫ `lc_housecall_pro_job_finished` (internal)
- ▫ `lc_housecall_pro_job_scheduled` (internal)
- ▫ `lc_housecall_pro_lead_created` (internal)

### HubSpot
- ▫ `lc_hubspot_company_recently_created_or_updated` (internal)
- ▫ `lc_hubspot_contact_created` (internal)
- ▫ `lc_hubspot_contact_recently_created_or_updated` (internal)
- ▫ `lc_hubspot_crm_object_recently_created` (internal) — filters: Object Type (`object_type`)
- ▫ `lc_hubspot_crm_object_recently_created_or_updated` (internal) — filters: Object Type (`object_type`)
- ▫ `lc_hubspot_custom_object_recently_created` (internal) — filters: Custom Object Type (`object_type`)
- ▫ `lc_hubspot_custom_object_recently_created_or_updated` (internal) — filters: Custom Object Type (`object_type`)
- ▫ `lc_hubspot_deal_recently_created_or_updated` (internal)
- ▫ `lc_hubspot_new_company` (internal)
- ▫ `lc_hubspot_new_deal` (internal)
- ▫ `lc_hubspot_new_engagement` (internal) — filters: Engagement Type (`engagement_type`)
- ▫ `lc_hubspot_new_product` (internal)
- ▫ `lc_hubspot_new_ticket` (internal)
- ▫ `lc_hubspot_product_recently_created_or_updated` (internal)
- ▫ `lc_hubspot_ticket_recently_created_or_updated` (internal)

### Jira
- ▫ `lc_jira_issue_created` (internal) — filters: Cloud Site (`cloud_site`), Project (`project_id`), Issue Type (`issue_type_id`), Assignee (`assignee_id`), Status (`status_id`)
- ▫ `lc_jira_issue_update` (internal) — filters: Cloud Site (`cloud_site`), Project (`project_id`), Issue Type (`issue_type_id`), Assignee (`assignee_id`), Status (`status_id`)

### Klaviyo
- ▫ `lc_klaviyo_new_event` (internal) — filters: Metric (`metric_id`)
- ▫ `lc_klaviyo_new_profile_created` (internal)
- ▫ `lc_klaviyo_profile_added_to_list` (internal) — filters: List (`list_id`)
- ▫ `lc_klaviyo_profile_added_to_segment` (internal) — filters: Segment (`segment_id`)

### Linear
- ▫ `lc_linear_new_customer` (internal) — filters: Team (`team_id`)
- ▫ `lc_linear_new_customer_need` (internal) — filters: Team (`team_id`), Customer (`customer.id`)
- ▫ `lc_linear_new_document_comment` (internal) — filters: Team (`team_id`), Creator (`user.id`)
- ▫ `lc_linear_new_initiative_update` (internal) — filters: Team (`team_id`), Status (`health`), Creator (`user.id`)
- ▫ `lc_linear_new_issue` (internal) — filters: Team (`team_id`), Status (`state.id`), Creator (`creator.id`), Assignee (`assignee.id`), Priority (`priority`), Label (`label_ids`), Project (`project.id`), Project Milestone (`projectMilestone.id`)
- ▫ `lc_linear_new_issue_comment` (internal) — filters: Team (`team_id`), Issue (`issue.id`), Creator (`user.id`)
- ▫ `lc_linear_new_project` (internal) — filters: Team (`team_id`), Project Lead (`lead.id`), Status (`state`)
- ▫ `lc_linear_new_project_update` (internal) — filters: Team (`team_id`), Project (`project.id`), Creator (`user.id`)
- ▫ `lc_linear_updated_customer` (internal) — filters: Team (`team_id`)
- ▫ `lc_linear_updated_customer_need` (internal) — filters: Team (`team_id`), Customer (`customer.id`)
- ▫ `lc_linear_updated_issue` (internal) — filters: Team (`team_id`), Status (`state.id`), Creator (`creator.id`), Assignee (`assignee.id`), Priority (`priority`), Label (`label_ids`), Project (`project.id`), Project Milestone (`projectMilestone.id`)
- ▫ `lc_linear_updated_project_update` (internal) — filters: Team (`team_id`), Status (`health`), Lead (`project.lead.id`)

### Manus AI
- ▫ `lc_manus_new_task_created` (internal)
- ▫ `lc_manus_task_stopped` (internal)

### Monday.com
- ▫ `lc_monday_any_column_value_changed` (internal) — filters: Board Id (`board_id`), Column (`column_id`)
- ▫ `lc_monday_board_created` (internal)
- ▫ `lc_monday_item_moved_to_any_group` (internal) — filters: Board Id (`board_id`), Group Id (`group_id`)
- ▫ `lc_monday_new_item_created` (internal) — filters: Board Id (`board_id`)
- ▫ `lc_monday_new_subitem_created` (internal) — filters: Board Id (`board_id`)
- ▫ `lc_monday_new_update_in_board` (internal) — filters: Board Id (`board_id`)
- ▫ `lc_monday_user_added_to_board` (internal)

### Notion
- ▫ `notion_comment_added` (internal) — filters: Page ID (`id`)
- ▫ `notion_new_database_item` (internal) — filters: Database ID (`database_id`)
- ▫ `notion_page_updated` (internal) — filters: Page ID (`id`)
- ▫ `notion_updated_database_item` (internal) — filters: Database ID (`database_id`)

### Survey Monkey
- ▫ `survey_monkey_it_response_completed` (internal) — filters: Survey Id (`survey_id`)

### Todoist
- ▫ `lc_todoist_new_project` (internal)
- ▫ `lc_todoist_new_task` (internal) — filters: Project (`project_id`)
- ▫ `lc_todoist_task_completed` (internal) — filters: Project (`project_id`)

### Typeform
- ▫ `typeform_new_entry` (internal) — filters: Form (`form_id`), Submission Type (`event_type`)

### affiliate
- ▫ `affiliate_campaign_enroll` (internal) — filters: Campaign (`campaign.id`)
- ▫ `affiliate_sales` (internal) — filters: Campaign (`campaign`), Affiliate (`affiliateId`), W8/W9 Form (`taxForm`), Payout Method (`payoutMethod`)

### affiliates
- ◐ `affiliate_created` (highlevel) — filters: In campaign (`campaign.id`), Has Tag (`contact.tags`), Doesn (`contact.tags`)

### appointments
- ✅ `appointment` (highlevel) — filters: In calendar (`calendar.id`), Appointment status is (`appointment.status`), Has Tag (`contact.tags`), Event Type (`appointment.eventType`), Created By/Modified By (`appointment.modifiedBy`)
- ✅ `customer_appointment` (highlevel) — filters: In calendar (`calendar.id`), Has Tag (`contact.tags`)
- ▫ `rental_booking` (internal) — filters: Has Tag (`contact.tags`), Created By / Modified By (`modifiedBy`), Booking Status (`status`), In Listing (`listings`), In Rental Categories (`listingCategories`)
- ▫ `service_booking` (internal) — filters: In Service (`services`), In Service Category (`serviceCategories`), Appointment Status (`status`), Has Tag (`contact.tags`), Created By / Modified By (`modifiedBy`), In Service Locations (`serviceLocations`)

### certificates
- ▫ `certificates_issued_workflow` (internal) — filters: Templates (`templateId`)

### communication
- ▫ `conversations_sla` (internal) — filters: SLA status (`slaStatus`), Message channel (`messageChannel`), Tags (`tags`), Owner (`owner`), Avoid repeated triggers (`avoidRepeatedTriggers`)
- ▫ `ig_follower_added` (internal) — filters: Account Is (`instagram.pageId`)
- ▫ `tiktok_comment_on_post` (internal) — filters: Account is (`tiktok.pageId`)
- ▫ `transcript_generated` (internal) — filters: Type (`call_type`), Duration (seconds) (`call_duration`)

### communities
- ▫ `group_access_granted` (internal) — filters: Group (`groupId`)
- ▫ `group_access_revoked` (internal) — filters: Group (`groupId`)
- ▫ `group_comment_created` (internal) — filters: Group (`groupId`), Post Title (`postTitle`), Post Content (`postContent`), Comment content (`commentContent`)
- ▫ `group_event_rsvp_created` (internal) — filters: Group (`groupId`), Event title  (`eventTitle`)
- ▫ `group_membership_rejected` (internal) — filters: Group (`groupId`)
- ▫ `group_post_created` (internal) — filters: Group (`groupId`), Post title (`postTitle`), Post content (`postContent`)
- ▫ `private_channel_access_granted` (internal) — filters: Group (`groupId`)
- ▫ `private_channel_access_revoked` (internal) — filters: Group (`groupId`)
- ▫ `user_group_gamification_level_changed` (internal) — filters: Group (`groupId`), Level (`level`)

### contact
- ◐ `birthday_reminder` (highlevel) — filters: Month is (`contact.birthMonth`), Day is (`contact.birthDay`), Before no. of days (`contact.dateOfBirth`), After no. of days (`contact.dateOfBirth`)
- ✅ `contact_changed` (highlevel) — filters: Tags (`contact.tags`), DND (`contact.dnd`), Assigned User (`contact.assignedTo`), Phone (`contact.phone`), Email (`contact.email`), Contact Type (`contact.type`), Street Address (`contact.address1`), City (`contact.city`), State (`contact.state`), Country (`contact.country`), Postal Code (`contact.postalCode`), Website (`contact.website`)
- ✅ `contact_created` (highlevel) — filters: Tag (`tagsAdded`), Phone (`contact.phone`), Email (`contact.email`), Contact Type (`contact.type`)
- ▫ `contact_engagement_score` (internal) — filters: Score (`score`)
- ✅ `contact_tag` (highlevel) — filters: tag_added (`tagsAdded`), tag_removed (`tagsRemoved`)
- ◐ `custom_date_reminder` (highlevel)
- ◐ `dnd_contact` (highlevel) — filters: DND direction is (`contact.dnd_direction`), DND flag is (`contact.dnd`), Tag (`contact.tags`)
- ◐ `note_add` (highlevel) — filters: Has Tag (`contact.tags`), Doesn (`contact.tags`)
- ◐ `note_changed` (highlevel) — filters: Has Tag (`contact.tags`), Doesn (`contact.tags`)
- ✅ `task_added` (highlevel) — filters: assigned_user (`task.assignedTo`)
- ▫ `task_completed` (internal) — filters: Assigned User (`task.assignedTo`)
- ✅ `task_due_date_reminder` (highlevel) — filters: before_no_of_days (`task.dueDate`), after_no_of_days (`task.dueDate`)

### courses
- ✅ `category_completed` (highlevel) — filters: Product (`membership.product.id`)
- ◐ `category_started` (highlevel) — filters: Product (`membership.product.id`)
- ✅ `lesson_completed` (highlevel) — filters: Product (`membership.product.id`)
- ✅ `lesson_started` (highlevel) — filters: Product (`membership.product.id`)
- ◐ `membership_contact_created` (highlevel)
- ◐ `offer_access_granted` (highlevel) — filters: Offer (`offer.id`)
- ◐ `offer_access_removed` (highlevel) — filters: Offer (`offer.id`)
- ◐ `product_access_granted` (highlevel) — filters: Select Product (`product.id`)
- ◐ `product_access_removed` (highlevel) — filters: Select Product (`product.id`)
- ◐ `product_completed` (highlevel) — filters: Product (`membership.product.id`)
- ◐ `product_started` (highlevel) — filters: Select Product (`product.id`)
- ◐ `user_log_in` (highlevel)

### custom_object
- ◐ `custom_object_changed` (highlevel)
- ◐ `custom_object_created` (highlevel)

### events
- ✅ `call_status` (highlevel) — filters: Call Status (`call_status`), Custom Disposition (`custom_disposition`), Call Direction (`message.direction`), In Workflow (`workflow.id`)
- ◐ `conv_ai_autonomous_trigger` (highlevel)
- ✅ `conv_ai_trigger` (highlevel)
- ✅ `customer_reply` (highlevel) — filters: Replied to Workflow (`workflow.id`), Reply channel (`message.type`), Contains phrase (`message.body`), Exact match phrase (`message.body`), Intent type (`message.body`), Has Tag (`contact.tags`), Doesn (`contact.tags`)
- ▫ `external_tracking` (internal)
- ✅ `facebook_lead_gen` (highlevel) — filters: Page Is (`facebook.pageId`)
- ✅ `form_submission` (highlevel) — filters: Form is (`form.id`), terms_and_conditions (`formData.termsAndConditions`)
- ▫ `funnel_website_pageview` (internal) — filters: Funnel/Website (`funnelId`)
- ◐ `inbound_trigger` (highlevel) — filters: contact_tag (`contact.tags`)
- ✅ `inbound_webhook` (highlevel)
- ▫ `linkedin_form_submitted` (internal)
- ✅ `mailgun_email_event` (highlevel) — filters: In workflow (`workflow.id`), Event (`mailgun.event`)
- ▫ `messaging_errors` (internal) — filters: Error Code (`errorCode`)
- ▫ `new_prospect_received_workflow` (internal) — filters: Prospect Source (`prospect_source`), Prospect Conversion Score (`prospect_conversion_score`)
- ▫ `quiz_submitted` (internal) — filters: Quiz Name (`quizId`), Overall Score (`overallScore`)
- ▫ `reputation_review_received` (internal) — filters: Review Rating (`review.rating`), Is Review Spam (`review.isSpam`), Review Source (`review.source`)
- ✅ `scheduler_trigger` (highlevel) — filters: Interval (`scheduler.interval`)
- ✅ `survey_submission` (highlevel) — filters: survey_is (`survey.id`), disqualified (`surveySubmission.disqualified`), terms_and_conditions (`surveyData.termsAndConditions`)
- ◐ `tik_tok_form_submitted` (highlevel) — filters: in_form (`tikTok.formId`)
- ✅ `trigger_link` (highlevel) — filters: trigger_link (`link.id`)
- ▫ `user_replied` (internal) — filters: Contact tags (`contact.tags`), Message body (`message.body`), Message channel (`message.type`), Replied By (`message.user_type_selection`), Has attachments (`message.hasAttachments`)
- ◐ `validation_error` (highlevel)
- ◐ `video_event` (highlevel) — filters: funnel (`video.funnelId`), video (`video.videoId`), video_duration_percent (`video.duration`)
- ▫ `whatsapp_referral` (internal) — filters: Ad / Post URL (`source_url`), Source Type (`source_type`), Ad / Post Id (`source_id`), Head Line of Ad / Post (`headline`)

### fb_ig_events
- ◐ `facebook_comment_on_post` (highlevel) — filters: Page Is (`undefined`)
- ◐ `ig_comment_on_post` (highlevel) — filters: Page Is (`undefined`)

### ivr
- ◐ `ivr_incoming_call` (highlevel) — filters: In Phone Number (`inbound_number`)

### membership
- ▫ `client_portal_file_uploaded` (internal)

### opportunities
- ✅ `opportunity_changed` (highlevel) — filters: In pipeline (`opportunity.pipelineId`), Tag (`contact.tags`), Assigned to (`opportunity.assignedTo`), Lead value (`opportunity.monetaryValue`), Expected Close Date (`opportunity.forecastExpectedCloseDate`), Forecast Probability (`opportunity.forecastProbability`), Status (`opportunity.status`), Lost Reason (`opportunity.lostReasonId`)
- ✅ `opportunity_created` (highlevel) — filters: In pipeline (`opportunity.pipelineId`), Tag (`contact.tags`), Assigned to (`opportunity.assignedTo`), Lead value (`opportunity.monetaryValue`), Expected Close Date (`opportunity.forecastExpectedCloseDate`), Forecast Probability (`opportunity.forecastProbability`), Status (`opportunity.status`), Lost Reason (`opportunity.lostReasonId`)
- ✅ `opportunity_decay` (highlevel) — filters: In pipeline (`opportunity.pipelineId`), Duration in days (`opportunity.lastActionDate`), Has Tag (`contact.tags`), Doesn (`contact.tags`), Assigned to (`opportunity.assignedTo`), Lead value (`opportunity.monetaryValue`), Expected Close Date (`opportunity.forecastExpectedCloseDate`), Forecast Probability (`opportunity.forecastProbability`), Status (`opportunity.status`), Lost Reason (`opportunity.lostReasonId`)
- ✅ `opportunity_status_changed` (highlevel) — filters: Moved from status (`opportunity.oldStatus`), Moved to status (`opportunity.status`), In pipeline (`opportunity.pipelineId`), Tag (`contact.tags`), Assigned to (`opportunity.assignedTo`), Lead value (`opportunity.monetaryValue`), Expected Close Date (`opportunity.forecastExpectedCloseDate`), Forecast Probability (`opportunity.forecastProbability`), Lost Reason (`opportunity.lostReasonId`)
- ✅ `pipeline_stage_updated` (highlevel) — filters: In pipeline (`opportunity.pipelineId`), Tag (`contact.tags`), Assigned to (`opportunity.assignedTo`), Lead value (`opportunity.monetaryValue`), Expected Close Date (`opportunity.forecastExpectedCloseDate`), Forecast Probability (`opportunity.forecastProbability`), Status (`opportunity.status`), Lost Reason (`opportunity.lostReasonId`)

### other
- ✅ `affiliate_new_lead` (internal) — filters: In campaign (`campaign.id`), Has Tag (`contact.tags`), Doesn (`contact.tags`)
- ✅ `proposal_estimate_update` (internal) — filters: Status (`status`), Value (`value`), Recipient type (`recipientType`), Template (`documentCreatedByTemplateId`), [Deprecated]Document Type (`document_type`)

### payments
- ▫ `coupon_code_applied` (internal) — filters: Coupon Code (`code`), Source (`source`), Product Type (`productType`), Order Value (Before Discount) (`orderValueBeforeDiscount`), Coupon Value (`discountValue`), Product(s) in Order (`productsInOrder`), Product Collection (`productCollections`), Coupon Type (`discountType`), Coupon Name (`name`)
- ▫ `coupon_code_expired` (internal) — filters: Coupon Code (`code`), Coupon Type (`discountType`), Coupon Name (`name`)
- ▫ `coupon_code_redeemed` (internal) — filters: Coupon Code (`code`), Source (`source`), Product Type (`productType`), Order Value (Before Discount) (`orderValueBeforeDiscount`), Coupon Value (`discountValue`), Product(s) in Order (`productsInOrder`), Product Collection (`productCollections`), Contact Email ID (`contactEmailId`), Contact Tag (`contactTags`), Coupon Type (`discountType`), Coupon Name (`name`), Redemption Count (per coupon) (`redemptionCount`)
- ▫ `coupon_redemption_limit_reached` (internal) — filters: Coupon Code (`code`), Coupon Type (`discountType`), Coupon Name (`name`), Redemption Limit (`redemptionLimit`)
- ▫ `estimate_update` (internal) — filters: Estimate Status (`status`), Estimate Value (`value`), Template (`documentCreatedByTemplateId`)
- ◐ `invoice` (highlevel) — filters: Invoice Status (`invoice.status`), Tag (`contact.tags`)
- ✅ `order_submission` (highlevel) — filters: Order Source (`order.source`)
- ◐ `payment_received` (highlevel) — filters: Source (`payment.source`), Payment Status (`payment.payment_status`), Global Product (`payment.global_product_ids`)
- ▫ `refund` (internal) — filters: Status (`status`), Amount (`amount`), Type (`transaction.status`), Source (`transaction.entitySourceType`)
- ▫ `subscription` (internal) — filters: Status (`status`), Global Products (`global_product.id`)
- ◐ `two_step_form_submission` (highlevel) — filters: in_funnel_website (`twoStepOrderForm.funnelId`), submission_type (`twoStepOrderForm.submissionType`)

### shopify
- ◐ `shopify_abandoned_cart` (highlevel) — filters: Duration (minutes) (`duration`), Cart Value (`cart_value`)
- ◐ `shopify_order_fulfilled` (highlevel) — filters: Cart Value (`cart_value`)
- ◐ `shopify_order_placed` (highlevel) — filters: Cart Value (`cart_value`)
