# GHL workflow types — index

Generated from `catalog/type-cards.json` by the plugin's sync step. **Do not edit** — regenerate.
One line per step and trigger type. For the full card (fields, allowed values, validator,
gotchas) run `node scripts/types.mjs <type-key>`, or `describe_step_type` if the
uxie-ghl-factory plugin is installed — same data.

293 types: 145 native, 148 marketplace. Status is each card's floor: 
`proven-live` > `source-derived` > `inferred`; `deprecated` means do not build on it.

## Triggers (native) (59)

| type | status | summary |
|---|---|---|
| `affiliate_created` | source-derived | Fires when a new affiliate record is created in Affiliate Manager. |
| `affiliate_new_lead` | source-derived | Fires when a new lead is created on a configured affiliate campaign. |
| `appointment` | source-derived | Fires on appointment events (booked / status changes) in the chosen calendar. |
| `birthday_reminder` | source-derived | Fires on each contact's birthday at a configured offset (before/after N days). |
| `call_status` | source-derived | Fires when an inbound or outbound call hits a configured call-status state. |
| `category_completed` | source-derived | Fires when a contact completes a course category. |
| `category_started` | source-derived | Fires when a contact starts a course category. |
| `contact_changed` | source-derived | Fires when one or more chosen contact fields are updated. |
| `contact_created` | source-derived | Fires the moment a new contact is created in the location. |
| `contact_tag` | source-derived | Fires when a tag is added to a contact (the canonical entry-point trigger). |
| `conv_ai_autonomous_trigger` | proven-live | Fires from an autonomous conversation AI bot action — treated as a 'goto' jump trigger. |
| `conv_ai_trigger` | proven-live | Fires when a conversation AI bot session starts for a contact. |
| `custom_date_reminder` | source-derived | Fires N days before or after a configured custom date field on the contact. |
| `custom_object_changed` | source-derived | Fires when a custom-object record is updated. |
| `custom_object_created` | source-derived | Fires when a custom-object record is created. |
| `customer_appointment` | source-derived | Fires on customer-side appointment events (booked by the contact). |
| `customer_reply` | source-derived | Fires when a contact replies to a workflow message on a chosen channel. |
| `dnd_contact` | source-derived | Fires when a contact's DND state changes on a given channel. |
| `facebook_comment_on_post` | source-derived | Fires when a Facebook page receives a comment on a post. |
| `facebook_lead_gen` | source-derived | Fires when a Facebook Lead Ads lead is captured on a configured page. |
| `form_submission` | source-derived | Fires when a contact submits the configured form. |
| `ig_comment_on_post` | source-derived | Fires when an Instagram business account receives a comment on a post. |
| `inbound_trigger` | source-derived | Fires on an inbound email matching configured email-address / subject / body / attachment filters. NOT the generic webhook — that is `inbound_webhook`. |
| `inbound_webhook` | source-derived | Fires when an inbound JSON webhook is POSTed to the workflow's webhook URL. |
| `invoice` | source-derived | Fires on invoice status transitions (sent, paid, voided, etc.). |
| `ivr_incoming_call` | source-derived | Fires on an incoming call to a configured IVR-routed number. |
| `lesson_completed` | source-derived | Fires when a contact completes a course lesson. |
| `lesson_started` | source-derived | Fires when a contact starts a course lesson. |
| `mailgun_email_event` | source-derived | Fires on a Mailgun email event (delivered, opened, clicked, etc.) within the workflow's emails. |
| `membership_contact_created` | source-derived | Fires when a contact registers as a membership user. |
| `note_add` | source-derived | Fires when a note is added to a contact. |
| `note_changed` | source-derived | Fires when an existing contact note is modified. |
| `offer_access_granted` | source-derived | Fires when a contact is granted access to a membership offer. |
| `offer_access_removed` | source-derived | Fires when a contact's offer access is revoked. |
| `opportunity_changed` | source-derived | Fires when an opportunity is updated (any field change). |
| `opportunity_created` | source-derived | Fires when an opportunity is created. |
| `opportunity_decay` | source-derived | Fires after an opportunity has been inactive for the configured duration. |
| `opportunity_status_changed` | source-derived | Fires when an opportunity moves from one status to another. |
| `order_submission` | source-derived | Fires when an order is submitted on a funnel page. |
| `payment_received` | source-derived | Fires when a payment is received from a configured source (calendar / form / product). |
| `pipeline_stage_updated` | source-derived | Fires when an opportunity is moved between pipeline stages. |
| `product_access_granted` | source-derived | Fires when a contact is granted access to a membership product. |
| `product_access_removed` | source-derived | Fires when a contact's product access is revoked. |
| `product_completed` | source-derived | Fires when a contact completes a membership product. |
| `product_started` | source-derived | Fires when a contact starts a membership product (progress crosses the configured percentage). |
| `proposal_estimate_update` | source-derived | Fires when a Documents & Contracts proposal/estimate transitions status (SENT, VIEWED, SIGNED, COMPLETED, etc.). |
| `scheduler_trigger` | source-derived | Fires on a cron-like schedule (hourly / daily / weekly / monthly / cron). |
| `shopify_abandoned_cart` | source-derived | Fires after a Shopify cart has been abandoned for the configured duration. |
| `shopify_order_fulfilled` | source-derived | Fires when a Shopify order is marked fulfilled. |
| `shopify_order_placed` | source-derived | Fires when a Shopify order is placed. |
| `survey_submission` | source-derived | Fires when a contact submits the configured survey. |
| `task_added` | source-derived | Fires when a task is added to a contact. |
| `task_due_date_reminder` | source-derived | Fires before or after a task's due date by the configured number of days. |
| `tik_tok_form_submitted` | source-derived | Fires when a TikTok lead-form submission is received. |
| `trigger_link` | source-derived | Fires when a contact clicks a configured trigger link. |
| `two_step_form_submission` | source-derived | Fires when a contact submits a two-step order form on a funnel page. |
| `user_log_in` | source-derived | Fires when a membership user logs in. |
| `validation_error` | source-derived | Fires when a Twilio validation error is raised (a system / failure trigger). |
| `video_event` | source-derived | Fires on a video-watch event in a funnel video at a configured percentage watched. |

## Steps (native) (86)

| type | status | summary |
|---|---|---|
| `add_appointment_booking_ai_bot` | source-derived | Hand the contact off to an AI bot that books an appointment on a specified calendar via conversational flow. |
| `add_contact_tag` | source-derived | Apply one or more tags to the running contact. |
| `add_notes` | source-derived | Attach an HTML note to the contact, optionally with title and color. |
| `add_to_affiliate_campaign` | source-derived | Add the contact to a specific affiliate campaign. |
| `add_to_affiliate_manager` | source-derived | Add the contact to the location's Affiliate Manager (becomes an affiliate). |
| `add_to_workflow` | source-derived | Enroll the running contact into another published workflow. |
| `ai_agent` | source-derived | LLM agent step that runs a prompt against a model and (optionally) emits structured output or invokes tools. |
| `array_functions` | source-derived | Apply an array operation (find, filter, math, line-item construction, find-by-index) to a source array. The README also references this as `array_formatter`. |
| `assign_user` | source-derived | Assign the contact to one or more users from a list, optionally with traffic-split weights or via a handlebar-resolved user ID. |
| `call` | source-derived | Place an outbound call to the contact, optionally with a whisper message for the agent. |
| `chatgpt` | source-derived | Call OpenAI's GPT model with a prompt and instructions, returning a `response` for downstream consumption. |
| `clear_custom_object_fields` | source-derived | Clear (set to null/empty) one or more fields on an existing custom-object record. Resolved from `!ident:CustomObjectActionTypes.CLEAR_FIELDS`. |
| `conversation_ai` | source-derived | Conversation AI handoff step — typically used to invoke a conversational AI agent within the workflow. Resolved from `!ident:CONVERSATION_AI`. |
| `conversationai_ai_message` | proven-live | Have the bot compose and send a message from an instruction, in its own words. |
| `conversationai_ai_splitter` | proven-live | Let the model choose a branch from a natural-language description of each one. |
| `conversationai_book_appointment` | proven-live | Hand the conversation to the booking flow for one calendar, then branch on the outcome. |
| `conversationai_continue` | proven-live | Return the contact to the bot’s general conversation, driven by the global prompt and knowledge base. |
| `conversationai_custom_message` | proven-live | Send an exact message, verbatim, with no model rewriting. |
| `conversationai_end` | proven-live | Stop the bot replying to this contact for a configured period, and reset the flow. |
| `conversationai_objective` | proven-live | Ask the contact for one piece of information and store the answer on a contact field. |
| `conversationai_services_booking` | source-derived | Book a commerce **service** (rather than a calendar) from inside the conversation. |
| `conversationai_transfer_bot` | proven-live | Hand the conversation to another AI employee. |
| `copy_contact_to_subaccount` | source-derived | Replicate the current contact (and optionally tags, custom fields) into one or more other sub-account locations. |
| `create_custom_object` | source-derived | Create a new custom-object record on the contact's location. Resolved from `!ident:CustomObjectActionTypes.CREATE`. |
| `create_opportunity` | source-derived | Create or update an opportunity record on a pipeline+stage for the running contact. |
| `create_update_contact` | source-derived | Create a contact (or update if one matches on email/phone) by writing one or more field values. |
| `custom_code` | source-derived | Execute user-supplied JavaScript and yield an `output` object that downstream steps can reference (e.g. `{{custom_code.<order>.output.<key>}}`). |
| `custom_webhook` | source-derived | Premium HTTP request action — POST/GET/PUT/DELETE to an external URL with JSON or form-encoded body, headers, query parameters, and an event-classification tag. Distinct from the simpler `webhook` action by supporting authorization, parameters, response capture, and event metadata. |
| `datetime_formatter` | source-derived | Reformat or operate on a date/datetime value — convert between formats, compare two dates, or extract components. |
| `dnd_contact` | source-derived | Toggle the contact's "Do Not Disturb" flag globally, per-channel, or per-direction. |
| `drip` | source-derived | Throttle downstream execution into batches with an inter-batch delay. The `drip` step itself is a control wrapper — downstream actions execute under the batch schedule it defines. |
| `email` | source-derived | Send a transactional/marketing email to the contact, with either an inline HTML body or a referenced template. |
| `event_start_date` | source-derived | Set or reference the workflow's "event start date" anchor — used as a base for subsequent date-based waits or scheduling. |
| `facebook_add_to_custom_audience` | source-derived | Add the contact to a Facebook (Meta) custom audience for ad targeting. |
| `facebook_conversion_api` | source-derived | Send a server-side conversion event to Meta via the Conversion API (CAPI), bypassing browser-side pixel tracking. |
| `facebook_remove_from_custom_audience` | source-derived | Remove the contact from a Facebook (Meta) custom audience. |
| `fb_interactive_messenger` | source-derived | Send an interactive Facebook Messenger message (buttons, quick-replies, structured payload). Resolved from `!ident:FB_INTERACTIVE_MESSENGER`. |
| `find_contact` | source-derived | Look up a contact by one or more field values; branch into "Contact Found" / "Contact Not Found" paths. |
| `find_opportunity` | source-derived | Multi-path search: look up an opportunity matching a filter spec; branches to `"Opportunity Found"` or `"Opportunity Not Found"`. |
| `gmb` | source-derived | Send a Google Business Profile (formerly Google My Business / GMB) message to the contact via the connected GBP integration. |
| `google_adword` | source-derived | Send a conversion event to Google Ads (Adwords), optionally with custom click-ID mapping. README also references this as `add_to_google_adword`. |
| `google_analytics` | source-derived | Send an event to Google Analytics (GA4 or legacy UA). The README also references this as `add_to_google_analytics`. |
| `google_sheets` | source-derived | Write a row to a connected Google Sheet. Routes through the location's OAuth integration with Google. |
| `goto` | source-derived | Jump execution to another step in the **same workflow**. Used to close loops or merge branches back together. |
| `if_else` | proven-live | Multi-path container that routes execution by evaluating segment-and-condition groups against contact/runtime state. |
| `ig_interactive_messenger` | source-derived | Send an interactive Instagram DM with buttons or quick-replies. Resolved from `!ident:IG_INTERACTIVE_MESSENGER`. |
| `instagram-dm` | source-derived | Send an Instagram direct message via the connected Instagram-business integration. |
| `internal_create_opportunity` | source-derived | Internal helper that creates an opportunity. Used by AI-driven and migration paths — different attribute shape from the user-facing [`create_opportunity`](./create_opportunity.md). |
| `internal_notification` | source-derived | Send an alert to staff (not to the contact) via one of four channels: email, SMS, WhatsApp, or in-app notification. The `type` field discriminates which channel-specific sub-object is required. |
| `internal_update_opportunity` | source-derived | Internal helper that updates an existing opportunity. Used by AI-driven and migration paths — different attribute shape from the user-facing [`create_opportunity`](./create_opportunity.md). |
| `ivr_collect_voicemail` | source-derived | IVR widget: record a voicemail from the caller. Validator key is `ivrRecordValidator`. |
| `ivr_connect_call` | source-derived | IVR widget: bridge the inbound call to one or more users or custom phone numbers. |
| `ivr_gather` | source-derived | IVR widget: gather DTMF (keypad) input from the caller, branching on the digit pressed. |
| `ivr_hangup` | source-derived | IVR widget: terminate the call. |
| `ivr_say` | source-derived | IVR widget: speak a TTS message to the caller, or play a pre-recorded audio file. |
| `manual-call` | source-derived | Create a queued call task for a user — they manually initiate the call. Differs from `call` (auto-dial). |
| `manual-sms` | source-derived | Queue an SMS draft for a user to manually review and send. Differs from `sms` (automatic send). |
| `math_operation` | source-derived | Apply arithmetic to a numeric field and (optionally) write the result to another field. Per registry, the OG name is `math_operation`; the README also references it as `number_formatter`. |
| `membership_grant_offer` | source-derived | Grant the contact a specific membership offer (course access, community membership, etc.). |
| `membership_revoke_offer` | source-derived | Revoke a membership offer from the contact. |
| `messenger` | source-derived | Send a Facebook Messenger message via the connected Facebook page integration. |
| `number_formatter` | source-derived | Numeric operations: string-to-number parsing, currency / phone formatting, random number generation, and arithmetic. The corpus calls this `math_operation` (legacy type slug); the registry's canonical type is `number_formatter`. |
| `remove_assigned_user` | source-derived | Unassign the currently-assigned user from the contact. No configurable attributes. |
| `remove_contact_tag` | source-derived | Remove one or more tags from the running contact (or all tags via `removeAll`). |
| `remove_from_affiliate_campaign` | source-derived | Remove the contact from an affiliate campaign. |
| `remove_from_workflow` | source-derived | Drop the running contact from one or more other workflows (or all of them). |
| `remove_opportunity` | source-derived | Delete opportunities tied to the contact within a specified pipeline (all, or just the previously-referenced one). |
| `respond_on_comment` | source-derived | Respond to a social-media comment that triggered the workflow (e.g. a comment-trigger flow on Facebook/Instagram). |
| `review_request` | source-derived | Send a review-request prompt (Google or Facebook) to the contact via SMS or email. |
| `send_to_eliza` | source-derived | Send the contact's conversation context to the Eliza service (GHL's conversational AI back-end), optionally targeting a specific user. |
| `slack_message` | source-derived | Send a message via a connected Slack integration to a public channel, private channel, or as a direct message. |
| `sms` | source-derived | Send an SMS (or MMS via `attachments` / `urlAttachments`) to the contact. |
| `stripe_one_time_charge` | source-derived | Charge a Stripe customer a one-time amount in a given currency. |
| `task-notification` | source-derived | Create a task assigned to a user, due relative to "now" or a fixed time. Note: registry exposes neither `task_notification` nor `task-notification` — the corpus uses both. Step row's `type` value is `task-notification` (with hyphen); inner `attributes.type` is `task_notification` (with underscore). |
| `text_formatter` | source-derived | Apply a text-manipulation function (length, case, trim, replace, etc.) to an input string. |
| `transition` | source-derived | Internal bookkeeping row that represents a branch's "outbound edge label" on multi-path parents. Not user-authored — created and maintained by the builder. |
| `update_affiliate` | source-derived | Update an existing affiliate's state (active/inactive). |
| `update_appointment_status` | source-derived | Update the status of an appointment, service booking, or rental booking associated with the contact. |
| `update_contact_field` | source-derived | Write one or more standard or custom contact fields. Supports update or clear actions per the `actionType` discriminator. |
| `update_custom_object` | source-derived | Update fields on an existing custom-object record. Resolved from `!ident:CustomObjectActionTypes.UPDATE`. |
| `update_custom_value` | source-derived | Update a location-scoped custom value (a global string variable) to a new value. |
| `voicemail` | source-derived | Drop a pre-recorded voicemail to the contact's number. |
| `wait` | source-derived | Pause execution until a time elapses, a condition becomes true, an event fires, or a reply arrives — discriminated by `attributes.type`. |
| `webhook` | source-derived | Simple outbound HTTP request — POST or GET — with custom key/value data and headers. Lighter-weight than [`custom_webhook`](./custom_webhook.md) (no auth, no body content-type, no response capture). |
| `workflow_goal` | source-derived | Define a goal (set of conditions) that, when met, can exit the contact from the workflow or trigger a goal-branch action. |
| `workflow_split` | source-derived | Multi-path randomizer / A/B-test splitter. Routes incoming contacts across N paths via weight-distributed random selection. |

## Triggers (marketplace apps) (102)

| type | title | status |
|---|---|---|
| `abandoned_checkout` | abandoned_checkout (Marketplace) | source-derived |
| `affiliate_campaign_enroll` | affiliate_campaign_enroll (Marketplace) | source-derived |
| `affiliate_new_lead` | affiliate_new_lead (Marketplace) | source-derived |
| `affiliate_sales` | affiliate_sales (Marketplace) | source-derived |
| `airtable_new_record_created` | airtable_new_record_created (Marketplace) | source-derived |
| `airtable_record_updated` | airtable_record_updated (Marketplace) | source-derived |
| `apify_actor_run_finished` | apify_actor_run_finished (Marketplace) | source-derived |
| `apify_task_run_finished` | apify_task_run_finished (Marketplace) | source-derived |
| `asana_it_asana_attachment_added_to_task` | asana_it_asana_attachment_added_to_task (Marketplace) | source-derived |
| `asana_it_asana_comment_on_task` | asana_it_asana_comment_on_task (Marketplace) | source-derived |
| `asana_it_asana_new_subtask` | asana_it_asana_new_subtask (Marketplace) | source-derived |
| `asana_it_asana_project_created` | asana_it_asana_project_created (Marketplace) | source-derived |
| `asana_it_asana_tag_added_to_task` | asana_it_asana_tag_added_to_task (Marketplace) | source-derived |
| `asana_it_asana_task_created` | asana_it_asana_task_created (Marketplace) | source-derived |
| `asana_it_asana_task_deleted` | asana_it_asana_task_deleted (Marketplace) | source-derived |
| `asana_it_asana_task_moved_to_section` | asana_it_asana_task_moved_to_section (Marketplace) | source-derived |
| `asana_it_asana_task_updated` | asana_it_asana_task_updated (Marketplace) | source-derived |
| `basecamp_new_activity` | basecamp_new_activity (Marketplace) | source-derived |
| `basecamp_new_comment_added` | basecamp_new_comment_added (Marketplace) | source-derived |
| `basecamp_new_document` | basecamp_new_document (Marketplace) | source-derived |
| `basecamp_new_message_posted` | basecamp_new_message_posted (Marketplace) | source-derived |
| `basecamp_new_todo_created` | basecamp_new_todo_created (Marketplace) | source-derived |
| `basecamp_new_todo_list` | basecamp_new_todo_list (Marketplace) | source-derived |
| `basecamp_project_created` | basecamp_project_created (Marketplace) | source-derived |
| `certificates_issued_workflow` | certificates_issued_workflow (Marketplace) | source-derived |
| `clickup_comment_created` | clickup_comment_created (Marketplace) | source-derived |
| `clickup_new_folder` | clickup_new_folder (Marketplace) | source-derived |
| `clickup_new_list` | clickup_new_list (Marketplace) | source-derived |
| `clickup_new_task` | clickup_new_task (Marketplace) | source-derived |
| `clickup_new_time_entry` | clickup_new_time_entry (Marketplace) | source-derived |
| `clickup_task_updated` | clickup_task_updated (Marketplace) | source-derived |
| `contact_engagement_score` | contact_engagement_score (Marketplace) | source-derived |
| `coupon_code_applied` | coupon_code_applied (Marketplace) | source-derived |
| `coupon_code_expired` | coupon_code_expired (Marketplace) | source-derived |
| `coupon_code_redeemed` | coupon_code_redeemed (Marketplace) | source-derived |
| `coupon_redemption_limit_reached` | coupon_redemption_limit_reached (Marketplace) | source-derived |
| `ecommerce_order_fulfilled_trigger` | ecommerce_order_fulfilled_trigger (Marketplace) | source-derived |
| `estimate_update` | estimate_update (Marketplace) | source-derived |
| `external_tracking` | external_tracking (Marketplace) | source-derived |
| `funnel_website_pageview` | funnel_website_pageview (Marketplace) | source-derived |
| `google_contacts_contact_created` | google_contacts_contact_created (Marketplace) | source-derived |
| `google_contacts_new_group` | google_contacts_new_group (Marketplace) | source-derived |
| `google_lead_form_submitted` | google_lead_form_submitted (Marketplace) | source-derived |
| `group_access_granted` | group_access_granted (Marketplace) | source-derived |
| `group_access_revoked` | group_access_revoked (Marketplace) | source-derived |
| `ig_follower_added` | ig_follower_added (Marketplace) | source-derived |
| `imessage_t` | imessage_t (Marketplace) | source-derived |
| `lc_cal_com_booking_cancelled` | lc_cal_com_booking_cancelled (Marketplace) | source-derived |
| `lc_cal_com_booking_created` | lc_cal_com_booking_created (Marketplace) | source-derived |
| `lc_cal_com_booking_rescheduled` | lc_cal_com_booking_rescheduled (Marketplace) | source-derived |
| `lc_cal_com_meeting_ended` | lc_cal_com_meeting_ended (Marketplace) | source-derived |
| `lc_cal_com_ooo_created` | lc_cal_com_ooo_created (Marketplace) | source-derived |
| `lc_cal_com_recording_ready` | lc_cal_com_recording_ready (Marketplace) | source-derived |
| `lc_cu_task_changes_internal` | lc_cu_task_changes_internal (Marketplace) | source-derived |
| `lc_fathom_new_recording` | lc_fathom_new_recording (Marketplace) | source-derived |
| `lc_gforms_new_updated_response` | lc_gforms_new_updated_response (Marketplace) | source-derived |
| `lc_hubspot_contact_created` | lc_hubspot_contact_created (Marketplace) | source-derived |
| `lc_linear_new_customer` | lc_linear_new_customer (Marketplace) | source-derived |
| `lc_linear_new_customer_need` | lc_linear_new_customer_need (Marketplace) | source-derived |
| `lc_linear_new_document_comment` | lc_linear_new_document_comment (Marketplace) | source-derived |
| `lc_linear_new_initiative_update` | lc_linear_new_initiative_update (Marketplace) | source-derived |
| `lc_linear_new_issue` | lc_linear_new_issue (Marketplace) | source-derived |
| `lc_linear_new_issue_comment` | lc_linear_new_issue_comment (Marketplace) | source-derived |
| `lc_linear_new_project` | lc_linear_new_project (Marketplace) | source-derived |
| `lc_linear_new_project_update` | lc_linear_new_project_update (Marketplace) | source-derived |
| `lc_linear_updated_customer` | lc_linear_updated_customer (Marketplace) | source-derived |
| `lc_linear_updated_customer_need` | lc_linear_updated_customer_need (Marketplace) | source-derived |
| `lc_linear_updated_issue` | lc_linear_updated_issue (Marketplace) | source-derived |
| `lc_linear_updated_project_update` | lc_linear_updated_project_update (Marketplace) | source-derived |
| `lc_manus_new_task_created` | lc_manus_new_task_created (Marketplace) | source-derived |
| `lc_manus_task_stopped` | lc_manus_task_stopped (Marketplace) | source-derived |
| `lc_monday_any_column_value_changed` | lc_monday_any_column_value_changed (Marketplace) | source-derived |
| `lc_monday_board_created` | lc_monday_board_created (Marketplace) | source-derived |
| `lc_monday_item_moved_to_any_group` | lc_monday_item_moved_to_any_group (Marketplace) | source-derived |
| `lc_monday_new_item_created` | lc_monday_new_item_created (Marketplace) | source-derived |
| `lc_monday_new_subitem_created` | lc_monday_new_subitem_created (Marketplace) | source-derived |
| `lc_monday_new_update_in_board` | lc_monday_new_update_in_board (Marketplace) | source-derived |
| `lc_monday_user_added_to_board` | lc_monday_user_added_to_board (Marketplace) | source-derived |
| `leadgen_ecommerce_review_submitted` | leadgen_ecommerce_review_submitted (Marketplace) | source-derived |
| `linkedin_form_submitted` | linkedin_form_submitted (Marketplace) | source-derived |
| `messaging_errors` | messaging_errors (Marketplace) | source-derived |
| `new_prospect_received_workflow` | new_prospect_received_workflow (Marketplace) | source-derived |
| `notion_comment_added` | notion_comment_added (Marketplace) | source-derived |
| `notion_new_database_item` | notion_new_database_item (Marketplace) | source-derived |
| `notion_page_updated` | notion_page_updated (Marketplace) | source-derived |
| `notion_updated_database_item` | notion_updated_database_item (Marketplace) | source-derived |
| `private_channel_access_granted` | private_channel_access_granted (Marketplace) | source-derived |
| `private_channel_access_revoked` | private_channel_access_revoked (Marketplace) | source-derived |
| `proposal_estimate_update` | proposal_estimate_update (Marketplace) | source-derived |
| `quiz_submitted` | quiz_submitted (Marketplace) | source-derived |
| `refund` | refund (Marketplace) | source-derived |
| `rental_booking` | rental_booking (Marketplace) | source-derived |
| `reputation_review_received` | reputation_review_received (Marketplace) | source-derived |
| `service_booking` | service_booking (Marketplace) | source-derived |
| `subscription` | subscription (Marketplace) | source-derived |
| `survey_monkey_it_response_completed` | survey_monkey_it_response_completed (Marketplace) | source-derived |
| `task_completed` | task_completed (Marketplace) | source-derived |
| `tiktok_comment_on_post` | tiktok_comment_on_post (Marketplace) | source-derived |
| `transcript_generated` | transcript_generated (Marketplace) | source-derived |
| `typeform_new_entry` | typeform_new_entry (Marketplace) | source-derived |
| `user_group_gamification_level_changed` | user_group_gamification_level_changed (Marketplace) | source-derived |
| `whatsapp_referral` | whatsapp_referral (Marketplace) | source-derived |

## Steps (marketplace apps) (46)

| type | title | status |
|---|---|---|
| `affiliate` | Marketplace — affiliate | source-derived |
| `agent-studio` | Marketplace — Agent Studio | source-derived |
| `ai-actions` | Marketplace — AI Actions | source-derived |
| `airtable` | Marketplace — Airtable | source-derived |
| `apify` | Marketplace — Apify | source-derived |
| `appointments` | Marketplace — appointments | source-derived |
| `asana` | Marketplace — Asana | source-derived |
| `associations` | Marketplace — Associations | source-derived |
| `basecamp` | Marketplace — BaseCamp | source-derived |
| `blooio` | Marketplace — Blooio | source-derived |
| `cal-com` | Marketplace — Cal.com | source-derived |
| `certificates` | Marketplace — certificates | source-derived |
| `clickup` | Marketplace — ClickUp | source-derived |
| `communication` | Marketplace — communication | source-derived |
| `communities` | Marketplace — Communities | source-derived |
| `company` | Marketplace — Company | source-derived |
| `contact` | Marketplace — contact | source-derived |
| `conversation-ai` | Marketplace — Conversation AI | source-derived |
| `customobjects` | Marketplace — customObjects | source-derived |
| `eliza` | Marketplace — eliza | source-derived |
| `fathom` | Marketplace — Fathom | source-derived |
| `google-contacts` | Marketplace — Google Contacts | source-derived |
| `google-forms` | Marketplace — Google Forms | source-derived |
| `google-slides` | Marketplace — Google Slides | source-derived |
| `google-tasks` | Marketplace — Google Tasks | source-derived |
| `hubspot` | Marketplace — HubSpot | source-derived |
| `internal` | Marketplace — internal | source-derived |
| `ivr` | Marketplace — ivr | source-derived |
| `linear` | Marketplace — Linear | source-derived |
| `manus-ai` | Marketplace — Manus AI | source-derived |
| `marketing` | Marketplace — marketing | source-derived |
| `mistral-ai` | Marketplace — Mistral AI | source-derived |
| `monday-com` | Marketplace — Monday.com | source-derived |
| `mycrmsim-sms-imessage-whatsapp` | Marketplace — myCRMSIM - SMS, iMessage & WhatsApp | source-derived |
| `notion` | Marketplace — Notion | source-derived |
| `openrouter` | Marketplace — OpenRouter | source-derived |
| `opportunity` | Marketplace — opportunity | source-derived |
| `payment` | Marketplace — payment | source-derived |
| `send-data` | Marketplace — send_data | source-derived |
| `staging-test` | Marketplace — Staging Test | source-derived |
| `survey-monkey` | Marketplace — Survey Monkey | source-derived |
| `todoist` | Marketplace — Todoist | source-derived |
| `typeform` | Marketplace — Typeform | source-derived |
| `vapi-ai` | Marketplace — Vapi.ai | source-derived |
| `voice-ai` | Marketplace — Voice AI | source-derived |
| `workflow-ai` | Marketplace — workflow_ai | source-derived |
