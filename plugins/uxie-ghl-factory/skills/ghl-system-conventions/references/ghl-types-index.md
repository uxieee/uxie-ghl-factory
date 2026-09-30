# GHL workflow types — index

Generated from `catalog/type-cards.json` by the plugin's sync step. **Do not edit** — regenerate.
One line per step and trigger type. For the full card (fields, allowed values, validator,
gotchas) run `node scripts/types.mjs <type-key>`, or `describe_step_type` if the
uxie-ghl-factory plugin is installed — same data.

558 types: 152 native, 406 marketplace. Status is each card's floor: 
`proven-live` > `source-derived` > `inferred`; `deprecated` means do not build on it.

## Triggers (native) (62)

| type | status | summary |
|---|---|---|
| `added_to_campaign` | proven-live | A legacy trigger key: the recovered registry lists it, the trigger picker does not offer it (the picker's own entries for this area are the marketplace-internal triggers, see [`../triggers-marketplace/`](../triggers-marketplace/)). `build_workflow` still authors it and GHL stores it. |
| `affiliate_created` | source-derived | Fires when a new affiliate record is created in Affiliate Manager. |
| `affiliate_new_lead` | source-derived | Fires when a new lead is created on a configured affiliate campaign. |
| `appointment` | source-derived | Fires on appointment events (booked / status changes) in the chosen calendar. |
| `appointment_v3` | proven-live | A legacy trigger key: the recovered registry lists it, the trigger picker does not offer it (the picker's own entries for this area are the marketplace-internal triggers, see [`../triggers-marketplace/`](../triggers-marketplace/)). `build_workflow` still authors it and GHL stores it. |
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
| `customer_appointment_v3` | proven-live | A legacy trigger key: the recovered registry lists it, the trigger picker does not offer it (the picker's own entries for this area are the marketplace-internal triggers, see [`../triggers-marketplace/`](../triggers-marketplace/)). `build_workflow` still authors it and GHL stores it. |
| `customer_reply` | source-derived | Fires on an inbound message from the contact, on a chosen channel or any. With no filter it fires on **every** inbound message, not only on replies to a workflow's own message: a first live-chat message from a brand-new contact was evaluated against it `[proven-live 2026-09-25]`. |
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
| `mailgun_email_event` | source-derived | Fires on an email event (opened, clicked, unsubscribed, complained, bounced) on emails sent by the chosen workflow. |
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
| `user_log_in` | source-derived | Fires on each successful client-portal login. It is now an INTERNAL marketplace trigger (section "Client Portal"), not a native builder trigger. [source-derived 2026-09-26 — sniffs/workflows-domain-recon-2026-09-25/marketplace-assets-2026-09-25.json (`key: user_log_in`)] |
| `validation_error` | source-derived | Fires when a Twilio validation error is raised (a system / failure trigger). |
| `video_event` | source-derived | Fires on a video-watch event in a funnel video at a configured percentage watched. |

## Steps (native) (90)

| type | status | summary |
|---|---|---|
| `add_appointment_booking_ai_bot` | source-derived | Hand the contact off to an AI bot that books an appointment on a specified calendar via conversational flow. |
| `add_contact_tag` | source-derived | Apply one or more tags to the running contact. |
| `add_notes` | source-derived | Attach an HTML note to the contact, optionally with a title and color. In an object-based workflow the card reads "Adds a note to the {objectName} record" and the drawer offers no title or color. |
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
| `create_opportunity` | source-derived | Create or update an opportunity record on a pipeline+stage for the running contact. The builder shows a deprecation banner on this step: "The Create/Update Action will soon be deprecated. Existing Workflows will be unaffected; however, the new Create Opportunity and Update Opportunity actions will b |
| `create_update_contact` | source-derived | Create a contact (or update if one matches on email/phone) by writing one or more field values. |
| `custom_code` | source-derived | Execute user-supplied JavaScript or Python and yield an `output` object that downstream steps can reference (e.g. `{{custom_code.<order>.output.<key>}}`). |
| `custom_webhook` | source-derived | Premium HTTP request action: POST, GET, PUT, DELETE, PATCH, HEAD or OPTIONS to an external URL, with a JSON or form-encoded body, headers, query parameters and an Event preset (`CUSTOM`, `POST` or `GET`) that sets which of those the drawer offers. It differs from the simpler `webhook` action in havi |
| `datetime_formatter` | source-derived | "Date/Time Formatter": reformat a date, reformat a date-and-time, or count the days between two dates, and hand the result to later steps as a merge tag. |
| `dnd_contact` | source-derived | Toggle the contact's "Do Not Disturb" flag globally, per-channel, or per-direction. |
| `drip` | source-derived | Throttle downstream execution into batches with an inter-batch delay. The `drip` step itself is a control wrapper — downstream actions execute under the batch schedule it defines. |
| `edit_conversation` | proven-live | "Edit Conversation": marks the enrolled contact's conversation as read or unread, and archives it or moves it back to the Recents tab. |
| `email` | source-derived | Send a transactional/marketing email to the contact, with either an inline HTML body or a referenced template. |
| `event_start_date` | source-derived | Set or reference the workflow's "event start date" anchor — used as a base for subsequent date-based waits or scheduling. |
| `facebook_add_to_custom_audience` | source-derived | Add the contact to a Facebook (Meta) custom audience for ad targeting. |
| `facebook_conversion_api` | source-derived | Send a server-side conversion event to Meta via the Conversion API (CAPI), bypassing browser-side pixel tracking. |
| `facebook_remove_from_custom_audience` | source-derived | Remove the contact from a Facebook (Meta) custom audience. |
| `fb_interactive_messenger` | source-derived | Send an interactive Facebook Messenger message with buttons and/or quick replies, branching on the contact's choice. Resolved from `!ident:FB_INTERACTIVE_MESSENGER`. |
| `find_contact` | source-derived | Look up a contact by one or more field values; branch into "Contact found" / "Contact not found" paths. |
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
| `internal_notification` | source-derived | Send an alert to staff (not to the contact) on ONE channel per step — email, SMS, WhatsApp or in-app notification, picked by the single `type` switch. To alert on two channels, use two steps `[source-derived 2026-09-26 — models/actions/InternalNotification.ts:359-362; utils/validators/communication- |
| `internal_update_opportunity` | source-derived | Internal helper that updates an existing opportunity. Used by AI-driven and migration paths — different attribute shape from the user-facing [`create_opportunity`](./create_opportunity.md). |
| `ivr_collect_voicemail` | source-derived | IVR widget: record a voicemail from the caller. Validator key is `ivrRecordValidator`. |
| `ivr_connect_call` | source-derived | IVR widget: bridge the inbound call to one or more users or custom phone numbers. |
| `ivr_gather` | source-derived | IVR widget: gather DTMF (keypad) input from the caller, branching on the digit pressed. |
| `ivr_hangup` | source-derived | IVR widget: terminate the call. |
| `ivr_say` | source-derived | IVR widget: speak a TTS message to the caller, or play a pre-recorded audio file. |
| `loop` | source-derived | A container step that runs the steps inside its body once per item of a list, one item after another. |
| `manual-call` | source-derived | Create a queued call task for a user — they manually initiate the call. Differs from `call` (auto-dial). |
| `manual-sms` | source-derived | Queue an SMS draft for a user to manually review and send. Differs from `sms` (automatic send). |
| `math_operation` | source-derived | Apply arithmetic to a numeric field and (optionally) write the result to another field. This is NOT `number_formatter` — that is a separate current step type (text↔number, phone, currency, random; see [`number_formatter`](./number_formatter.md)) `[source-derived 2026-09-25: both are members of Workf |
| `membership_grant_offer` | source-derived | Grant the contact access to the course product behind a membership offer. The builder names it "Course grant offer" and describes it as "Grant contact access to a specific course product". |
| `membership_revoke_offer` | source-derived | Revoke a membership offer from the contact. |
| `messenger` | source-derived | Send a Facebook Messenger message via the connected Facebook page integration. |
| `number_formatter` | source-derived | "Number Formatter": turn text into a number, format a number, a phone number or a currency amount, or generate a random number — and hand the result to later steps as `{{number_formatter.N.result}}`. |
| `remove_assigned_user` | source-derived | Unassign the currently-assigned user from the contact. No configurable attributes. |
| `remove_contact_tag` | source-derived | Remove one or more tags from the running contact (or all tags via `removeAll`). |
| `remove_from_affiliate_campaign` | source-derived | Remove the contact from an affiliate campaign. |
| `remove_from_workflow` | source-derived | Drop the running contact from one or more other workflows (or all of them). |
| `remove_opportunity` | source-derived | Delete opportunities tied to the contact within a specified pipeline (all, or just the previously-referenced one). |
| `respond_on_comment` | source-derived | Respond to a social-media comment that triggered the workflow (e.g. a comment-trigger flow on Facebook/Instagram). |
| `review_request` | source-derived | Send a review-request prompt (Google or Facebook) to the contact via SMS, email or WhatsApp. The step itself only schedules the request with the Reputation service; the message, and whether one goes out, is governed by the sub-account's Reputation settings and review links. |
| `router` | source-derived | Multi-branch step that sends the contact down **every** branch whose conditions match, one branch after another, left to right. Unlike `if_else` it does not stop at the first match. Beta: hidden from the action picker unless the session is on staging / internal GHL or an allowlisted agency or locati |
| `send_to_eliza` | source-derived | Send the contact to the **Eliza Agent Platform** — a separately purchased product the sub-account must be added to — optionally targeting a specific Eliza user `[source-derived 2026-09-26 — components/actions/crm/SendToEliza.vue:85-90; i18n 3237-3239]`. |
| `slack_message` | source-derived | Send a message via a connected Slack integration to a public channel, private channel, or as a direct message. |
| `sms` | source-derived | Send an SMS (or MMS via `attachments` / `urlAttachments`) to the contact. |
| `stripe_one_time_charge` | source-derived | Charge a Stripe customer a one-time amount in a given currency. |
| `task-notification` | source-derived | Create a task assigned to a user, due relative to "now" or a fixed time. Note: registry exposes neither `task_notification` nor `task-notification` — the corpus uses both. Step row's `type` value is `task-notification` (with hyphen); inner `attributes.type` is `task_notification` (with underscore). |
| `text_formatter` | source-derived | "Text Formatter": apply one text operation (case, trim, replace, find, split, extract…) to an input string and hand the result to later steps as `{{text_formatter.N.result}}`. |
| `transition` | source-derived | Internal bookkeeping row that represents a branch's "outbound edge label" on multi-path parents. Not user-authored — created and maintained by the builder. |
| `update_affiliate` | source-derived | Update an existing affiliate's state (active/inactive). |
| `update_appointment_status` | source-derived | Update the status of an appointment, service booking, or rental booking associated with the contact. |
| `update_contact_field` | source-derived | Write one or more standard or custom contact fields. Three modes per the `actionType` discriminator: update (replace), add (append to a multi-value field) or clear `[source-derived 2026-09-26 — models/actions/ContactField.ts:8]`. |
| `update_custom_object` | source-derived | Update fields on an existing custom-object record. Resolved from `!ident:CustomObjectActionTypes.UPDATE`. |
| `update_custom_value` | source-derived | Update a location-scoped custom value (a global string variable) to a new value. |
| `voicemail` | source-derived | Drop a pre-recorded voicemail to the contact's number. |
| `wait` | source-derived | Pause execution until a time elapses, a condition becomes true, an event fires, or a reply arrives — discriminated by `attributes.type`. |
| `webhook` | source-derived | Simple outbound HTTP request — POST or GET — with custom key/value data and headers. Lighter-weight than [`custom_webhook`](./custom_webhook.md) (no auth, no body content-type, no response capture). |
| `workflow_ai_generate_image` | source-derived | "AI image generation": generates one image from a text prompt (optionally with reference images) using an OpenAI or Google (Vertex) image model, and exposes the image URL and file to later steps. |
| `workflow_goal` | source-derived | A goal is a jump target. When a contact anywhere in the workflow meets any of the goal's conditions, they jump straight to the goal step and continue from it. `action` only governs a contact who reaches the goal step by walking the path without having met it. |
| `workflow_split` | source-derived | Multi-path randomizer / A/B-test splitter. Routes incoming contacts across N paths via weight-distributed random selection. |

## Triggers (marketplace apps) (120)

| type | title | status |
|---|---|---|
| `abandoned_checkout` | abandoned_checkout (Marketplace) | source-derived |
| `affiliate_campaign_enroll` | affiliate_campaign_enroll (Marketplace) | source-derived |
| `affiliate_new_lead` | affiliate_new_lead (Marketplace) | source-derived |
| `affiliate_sales` | affiliate_sales (Marketplace) | source-derived |
| `ai_studio_form_submitted` | ai_studio_form_submitted (Marketplace) | proven-live |
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
| `badges_issued_workflow` | badges_issued_workflow (Marketplace) | proven-live |
| `basecamp_new_activity` | basecamp_new_activity (Marketplace) | source-derived |
| `basecamp_new_comment_added` | basecamp_new_comment_added (Marketplace) | source-derived |
| `basecamp_new_document` | basecamp_new_document (Marketplace) | source-derived |
| `basecamp_new_message_posted` | basecamp_new_message_posted (Marketplace) | source-derived |
| `basecamp_new_todo_created` | basecamp_new_todo_created (Marketplace) | source-derived |
| `basecamp_new_todo_list` | basecamp_new_todo_list (Marketplace) | source-derived |
| `basecamp_project_created` | basecamp_project_created (Marketplace) | source-derived |
| `business_changed` | Company Changed (business_changed) | source-derived |
| `business_created` | Company Created (business_created) | source-derived |
| `certificates_issued_workflow` | certificates_issued_workflow (Marketplace) | source-derived |
| `clickup_comment_created` | clickup_comment_created (Marketplace) | source-derived |
| `clickup_new_folder` | clickup_new_folder (Marketplace) | source-derived |
| `clickup_new_list` | clickup_new_list (Marketplace) | source-derived |
| `clickup_new_task` | clickup_new_task (Marketplace) | source-derived |
| `clickup_new_time_entry` | clickup_new_time_entry (Marketplace) | source-derived |
| `clickup_task_updated` | clickup_task_updated (Marketplace) | source-derived |
| `client_portal_file_uploaded` | client_portal_file_uploaded (Marketplace) | proven-live |
| `contact_engagement_score` | contact_engagement_score (Marketplace) | source-derived |
| `conversations_sla` | conversations_sla (Marketplace) | proven-live |
| `coupon_code_applied` | coupon_code_applied (Marketplace) | source-derived |
| `coupon_code_expired` | coupon_code_expired (Marketplace) | source-derived |
| `coupon_code_redeemed` | coupon_code_redeemed (Marketplace) | source-derived |
| `coupon_redemption_limit_reached` | coupon_redemption_limit_reached (Marketplace) | source-derived |
| `ecommerce_order_fulfilled_trigger` | ecommerce_order_fulfilled_trigger (Marketplace) | source-derived |
| `estimate_update` | estimate_update (Marketplace) | source-derived |
| `event_check_in` | event_check_in (Marketplace) | proven-live |
| `event_registration` | event_registration (Marketplace) | proven-live |
| `external_tracking` | external_tracking (Marketplace) | source-derived |
| `funnel_website_pageview` | funnel_website_pageview (Marketplace) | source-derived |
| `google_contacts_contact_created` | google_contacts_contact_created (Marketplace) | source-derived |
| `google_contacts_new_group` | google_contacts_new_group (Marketplace) | source-derived |
| `google_lead_form_submitted` | google_lead_form_submitted (Marketplace) | source-derived |
| `group_access_granted` | group_access_granted (Marketplace) | source-derived |
| `group_access_revoked` | group_access_revoked (Marketplace) | source-derived |
| `group_comment_created` | group_comment_created (Marketplace) | proven-live |
| `group_event_rsvp_created` | group_event_rsvp_created (Marketplace) | proven-live |
| `group_membership_rejected` | group_membership_rejected (Marketplace) | proven-live |
| `group_post_created` | group_post_created (Marketplace) | proven-live |
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
| `leadgen_ecommerce_add_to_cart` | leadgen_ecommerce_add_to_cart (Marketplace) | source-derived |
| `leadgen_ecommerce_product_viewed` | leadgen_ecommerce_product_viewed (Marketplace) | source-derived |
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
| `reputation_video_testimonials_received` | reputation_video_testimonials_received (Marketplace) | proven-live |
| `requested_to_join_group` | requested_to_join_group (Marketplace) | proven-live |
| `service_booking` | service_booking (Marketplace) | source-derived |
| `social_planner_post_trigger_event` | social_planner_post_trigger_event (Marketplace) | proven-live |
| `subscription` | subscription (Marketplace) | source-derived |
| `survey_monkey_it_response_completed` | survey_monkey_it_response_completed (Marketplace) | source-derived |
| `task_completed` | task_completed (Marketplace) | source-derived |
| `tiktok_comment_on_post` | tiktok_comment_on_post (Marketplace) | source-derived |
| `transcript_generated` | transcript_generated (Marketplace) | source-derived |
| `typeform_new_entry` | typeform_new_entry (Marketplace) | source-derived |
| `user_group_gamification_level_changed` | user_group_gamification_level_changed (Marketplace) | source-derived |
| `user_replied` | user_replied (Marketplace) | proven-live |
| `whatsapp_referral` | whatsapp_referral (Marketplace) | source-derived |

## Steps (marketplace apps) (286)

| type | title | status |
|---|---|---|
| `add_associated_records_to_workflow` | Add associated records to workflow | source-derived |
| `add_contact_tag_tool` | Add Contact Tag | proven-live |
| `add_contact_to_groups` | Add Contact To Groups | source-derived |
| `add_person_to_project` | Add Person to Project | source-derived |
| `affiliate` | Marketplace — affiliate | source-derived |
| `agent-studio` | Marketplace — Agent Studio | source-derived |
| `ai-actions` | Marketplace — AI Actions | source-derived |
| `airtable` | Marketplace — Airtable | source-derived |
| `airtable_create_record` | Create Record | source-derived |
| `airtable_delete_record` | Delete Record | source-derived |
| `airtable_find_record_by_id` | Find Record By ID | source-derived |
| `airtable_retrieve_record` | Find Record | source-derived |
| `airtable_update_record` | Update Record | source-derived |
| `am-add-lead` | Add Leads under an Affiliate | source-derived |
| `am-add-manual-commission` | Add manual sales for an Affiliate | proven-live |
| `apify` | Marketplace — Apify | source-derived |
| `appointment_booking` | Book Appointment | undefined |
| `appointment_booking_conversation_ai` | Appointment Booking Conversation AI Bot | undefined |
| `appointments` | Marketplace — appointments | source-derived |
| `asana` | Marketplace — Asana | source-derived |
| `asana_ia_asana_add_task_to_section` | Add Task To Section Of Project | source-derived |
| `asana_ia_asana_create_comment` | Create Comment/story | source-derived |
| `asana_ia_asana_create_project` | Create Project | source-derived |
| `asana_ia_asana_create_section` | Create Section | source-derived |
| `asana_ia_asana_create_subtask` | Create Subtask | source-derived |
| `asana_ia_asana_create_task` | Create Task | source-derived |
| `asana_ia_asana_find_task_by_id` | Find Task By Id | source-derived |
| `asana_ia_asana_get_task` | Find Task | source-derived |
| `asana_ia_asana_update_task` | Update Task | source-derived |
| `asana_ia_find_all_tasks_from_project` | Find All Tasks From Project | source-derived |
| `asana_ia_find_comment_from_task` | Find Comment(s) From Task | source-derived |
| `asana_ia_find_comment_from_task_id` | Find Comments(s) by Task Id | source-derived |
| `asana_ia_find_task_in_project` | Find Task In Project | source-derived |
| `assign_to_user_tool` | Assign To User | proven-live |
| `associate_records` | Associate Records | source-derived |
| `associate_records` | Associate Records | proven-live |
| `associations` | Marketplace — Associations | source-derived |
| `badges` | Marketplace — badges (Issue badge) | proven-live |
| `basecamp` | Marketplace — BaseCamp | source-derived |
| `basecamp_create_campfire_message` | Create Campfire Message | source-derived |
| `basecamp_create_comment_on_message` | Create Comment On Message | source-derived |
| `basecamp_create_comment_on_todo` | Create Comment On Todo | source-derived |
| `basecamp_create_document` | Create Document | source-derived |
| `basecamp_create_message` | Create Message | source-derived |
| `basecamp_create_project_from_template` | Create Project From Template | source-derived |
| `basecamp_create_schedule_entry` | Create Schedule Entry | source-derived |
| `basecamp_create_todo` | Create To-do | source-derived |
| `basecamp_create_todo_list` | Create To-do List | source-derived |
| `basecamp_find_document` | Find Document | source-derived |
| `basecamp_find_person` | Find Person | source-derived |
| `basecamp_find_project` | Find Project | source-derived |
| `basecamp_find_to_do` | Find To-Do | source-derived |
| `basecamp_find_to_do_list` | Find To-do List | source-derived |
| `basecamp_get_todo` | Get To-do | source-derived |
| `basecamp_update_todo` | Update To-do | source-derived |
| `basecamp_upload_file` | Upload File | source-derived |
| `blooio` | Marketplace — Blooio | source-derived |
| `cal-com` | Marketplace — Cal.com | source-derived |
| `calendars_create_appointment_note` | Create Appointment / Booking Note | proven-live |
| `calendars_generate_one_time_booking_link` | Generate One Time Booking Link | proven-live |
| `certificates` | Marketplace — certificates | source-derived |
| `clear_associated_company_fields` | Clear Associated Company Fields | proven-live |
| `clickup` | Marketplace — ClickUp | source-derived |
| `clickup_add_comment` | Add Comment To Task | source-derived |
| `clickup_archive_task` | Archive Task | source-derived |
| `clickup_create_list` | Create List | source-derived |
| `clickup_ia_create_folder` | Create Folder | source-derived |
| `clickup_ia_create_space` | Create Space | source-derived |
| `clickup_ia_create_sub_task` | Create Sub Task | source-derived |
| `clickup_ia_create_task` | Create Task | source-derived |
| `clickup_ia_delete_task` | Delete Task | source-derived |
| `clickup_ia_update_task` | Update Task | source-derived |
| `clickup_new_checklist` | Add Checklist To Task | source-derived |
| `communication` |  | undefined |
| `communities` | Marketplace — Communities | source-derived |
| `company` | Marketplace — Company | source-derived |
| `contact` |  | undefined |
| `contact_email_verification` | Email Verification | proven-live |
| `conversation-ai` | Marketplace — Conversation AI | source-derived |
| `create_and_associate_company` | Create And Associate Company | proven-live |
| `create_basecamp_project` | Create Project | source-derived |
| `create_new_document` | Create New Document | source-derived |
| `create_new_document_page` | Create New Document Page | source-derived |
| `create_recurring_invoice` | Send Recurring Invoice | proven-live |
| `create_task_attachment` | Post Attachment | source-derived |
| `custom-push-notification` | Smart Push Notification | source-derived |
| `customobjects` | Marketplace — customObjects | source-derived |
| `edit_document_page` | Edit Document Page | source-derived |
| `eliza` | Marketplace — eliza | source-derived |
| `fathom` | Marketplace — Fathom | source-derived |
| `find_all_tasks` | Find Tasks | source-derived |
| `find_associated_record` | Find Associated Record | proven-live |
| `find_custom_fields` | Find Custom Fields | source-derived |
| `find_documents` | Find Documents | source-derived |
| `find_notion_comment` | Find Comment | source-derived |
| `find_or_create_contact` | Find Or Create Contact | source-derived |
| `find_task_by_id` | Find Task By Id | source-derived |
| `find-notion-page-by-title` | Find Page By Title | source-derived |
| `generate_marketing_audit_report` | Generate Marketing Audit Report | proven-live |
| `google-contacts` | Marketplace — Google Contacts | source-derived |
| `google-forms` | Marketplace — Google Forms | source-derived |
| `google-slides` | Marketplace — Google Slides | source-derived |
| `google-tasks` | Marketplace — Google Tasks | source-derived |
| `googlecontact_create_contact` | Create Contact | source-derived |
| `googlecontacts_create_contact_group` | Create Contact Group | source-derived |
| `googlecontacts_find` | Find Contact | source-derived |
| `googlecontacts_update_contact` | Update Contact | source-derived |
| `grant_user_group_gamification_points` | Grant Community Group Leaderboard Points | proven-live |
| `grant-group-access` | Grant Group Access | source-derived |
| `grant-private-channel-access` | Grant Private Channel Access | source-derived |
| `hubspot` | Marketplace — HubSpot | source-derived |
| `imessage_a` | Send iMessage | source-derived |
| `internal` | Marketplace — internal | source-derived |
| `internal_comment_action` | Marketplace step — internal_comment_action | proven-live |
| `internal-add-contact-followers` | Add Contact Followers | proven-live |
| `internal-add-opportunities-followers` | Add Follower(s) to Opportunity | proven-live |
| `internal-add-opportunity-owner` | Add Owner to Opportunity | proven-live |
| `internal-delete-contact` | Delete Contact | proven-live |
| `internal-remove-contact-followers` | Remove Contact Followers | proven-live |
| `internal-remove-opportunities-followers` | Remove Follower(s) from Opportunity | proven-live |
| `internal-remove-opportunity-owner` | Remove Owner from Opportunity | proven-live |
| `issue_badge_workflow` | Marketplace step — issue_badge_workflow | proven-live |
| `issue_certificates_workflow` | Issue certificate | source-derived |
| `ivr` | Marketplace — ivr | source-derived |
| `kb_search` | Marketplace step — kb_search | proven-live |
| `lc_apify_run_a_actor` | Run A Actor | source-derived |
| `lc_cal_com_cancel_booking` | Cancel booking | source-derived |
| `lc_cal_com_create_booking` | Create booking | source-derived |
| `lc_cal_com_find_booking` | Find booking | source-derived |
| `lc_cal_com_reschedule_booking` | Reschedule booking | source-derived |
| `lc_custom_apify_fetch_dataset_items` | Fetch Dataset Items | source-derived |
| `lc_custom_apify_fetch_key_value_store_record` | Fetch Key-Value Store Record | source-derived |
| `lc_custom_apify_find_last_actor_run` | Find Last Actor Run | source-derived |
| `lc_custom_apify_find_last_task_run` | Find Last Task Run | source-derived |
| `lc_custom_apify_run_task` | Run a Task | source-derived |
| `lc_custom_apify_scrape_single_url` | Scrape Single URL | source-derived |
| `lc_custom_apify_set_key_value_store_record` | Set Key-Value Store Record | source-derived |
| `lc_custom_asana_find_section` | Find Section | source-derived |
| `lc_custom_asana_get_project_by_id` | Find Project | source-derived |
| `lc_fathom_fetch_summary` | Fetch summary | source-derived |
| `lc_fathom_fetch_transcript` | Fetch transcript | source-derived |
| `lc_fathom_list_recordings` | List recordings | source-derived |
| `lc_gform_find_responses` | Find Responses | source-derived |
| `lc_gforms_find_form_by_id` | Find Form By ID | source-derived |
| `lc_gforms_find_forms_by_name` | Find Forms By Name | source-derived |
| `lc_gforms_find_response_by_id` | Find Response By ID | source-derived |
| `lc_google_tasks_create_task` | Create Task | source-derived |
| `lc_google_tasks_create_task_list` | Create Task List | source-derived |
| `lc_google_tasks_find_task` | Find Task | source-derived |
| `lc_google_tasks_get_tasks_by_list` | Get Tasks By List | source-derived |
| `lc_google_tasks_update_task` | Update Task | source-derived |
| `lc_gs_create_presentation_from_template` | Create Presentation From Template | source-derived |
| `lc_gs_find_presentation` | Find Presentation | source-derived |
| `lc_gs_refresh_charts` | Refresh charts synced to google sheets | source-derived |
| `lc_hubspot_create_contact` | Create Contact | source-derived |
| `lc_hubspot_find_contact` | Find Contact | source-derived |
| `lc_linear_add_label_to_issue` | Add label to issue | source-derived |
| `lc_linear_create_attachment` | Create issue attachment | source-derived |
| `lc_linear_create_comment` | Create comment | source-derived |
| `lc_linear_create_customer` | Create customer | source-derived |
| `lc_linear_create_customer_need` | Create customer need | source-derived |
| `lc_linear_create_issue` | Create issue | source-derived |
| `lc_linear_create_project` | Create project | source-derived |
| `lc_linear_find_customer` | Find customer | source-derived |
| `lc_linear_find_issue_by_id` | Get issue | source-derived |
| `lc_linear_find_issues` | Find issues | source-derived |
| `lc_linear_find_project_by_id` | Find project | source-derived |
| `lc_linear_remove_label` | Remove label from issue | source-derived |
| `lc_linear_update_issue` | Update issue | source-derived |
| `lc_manus_continue_task` | Continue Task With Prompt | source-derived |
| `lc_manus_create_task` | Create Task | source-derived |
| `lc_manus_delete_task` | Delete Task | source-derived |
| `lc_manus_fetch_task` | Fetch Tasks | source-derived |
| `lc_manus_get_task` | Get Task | source-derived |
| `lc_manus_update_task` | Update Task | source-derived |
| `lc_merge_contact` | Merge Contact | undefined |
| `lc_mistral_ai_analyze_image_vision` | Analyze Image (Vision) | source-derived |
| `lc_mistral_ai_create_chat_completion` | Create Chat Completion | source-derived |
| `lc_mistral_ai_create_embeddings` | Create Embeddings | source-derived |
| `lc_monday_archieve_board` | Archive Board | source-derived |
| `lc_monday_archive_group` | Archive Group | source-derived |
| `lc_monday_create_board` | Create New Board | source-derived |
| `lc_monday_create_column` | Create New Column For Board | source-derived |
| `lc_monday_create_group` | Create New Group For Board | source-derived |
| `lc_monday_create_item` | Create New Item | source-derived |
| `lc_monday_create_subitem` | Create New SubItem | source-derived |
| `lc_monday_delete_group` | Delete Group | source-derived |
| `lc_monday_delete_item` | Delete Item | source-derived |
| `lc_monday_find_by_column` | Find Items By Column Value | source-derived |
| `lc_monday_find_items_by_id` | Find Item By ID | source-derived |
| `lc_monday_get_items` | Get Board Items | source-derived |
| `lc_monday_update_item` | Update Item | source-derived |
| `lc_monday_update_subitem` | Update SubItem | source-derived |
| `lc_openrouter_generate_response` | Generate Response | source-derived |
| `lc_tf_create_form` | Create Empty Form | source-derived |
| `lc_todoist_add_comment_to_project` | Add comment to project | source-derived |
| `lc_todoist_add_comment_to_task` | Add comment to task | source-derived |
| `lc_todoist_complete_task` | Mark task as completed | source-derived |
| `lc_todoist_create_project` | Create project | source-derived |
| `lc_todoist_create_task` | Create task | source-derived |
| `lc_todoist_find_project` | Find Project | source-derived |
| `lc_todoist_find_task` | Find Task | source-derived |
| `lc_todoist_find_user` | Find User | source-derived |
| `lc_todoist_get_project_collaborators` | Get project collaborators | source-derived |
| `lc_todoist_invite_user_to_project` | Invite user to project | source-derived |
| `lc_todoist_move_task_to_section` | Move task to section | source-derived |
| `lc_todoist_update_task` | Update task | source-derived |
| `lc_vapi_create_call` | Create Call | source-derived |
| `lc_vapi_create_chat` | Create Chat | source-derived |
| `lc_vapi_delete_call_data` | Delete Call Data | source-derived |
| `lc_vapi_delete_chat` | Delete Chat Data | source-derived |
| `lc_vapi_delete_file` | Delete File | source-derived |
| `lc_vapi_find_call` | Find Call | source-derived |
| `lc_vapi_update_call` | Update Call Name | source-derived |
| `lc_vapi_upload_file` | Upload File | source-derived |
| `linear` | Marketplace — Linear | source-derived |
| `live_chat_response` | Send Live Chat Message | proven-live |
| `log-external-call` | Log External Call | undefined |
| `manus-ai` | Marketplace — Manus AI | source-derived |
| `marketing` | Marketplace — marketing | source-derived |
| `membership_course_grant_access` | Marketplace step — membership_course_grant_access | proven-live |
| `membership_default_course_revoke` | Marketplace step — membership_default_course_revoke | proven-live |
| `mistral-ai` | Marketplace — Mistral AI | source-derived |
| `monday-com` | Marketplace — Monday.com | source-derived |
| `mycrmsim-sms-imessage-whatsapp` | Marketplace — myCRMSIM - SMS, iMessage & WhatsApp | source-derived |
| `notion` | Marketplace — Notion | source-derived |
| `notion_add_comment` | Add Comment | source-derived |
| `notion_add_content_to_page` | Add Content To Page | source-derived |
| `notion_create_database_item` | Create Database Item | source-derived |
| `notion_create_page` | Create Page | source-derived |
| `notion_find_database_item` | Find Database Item | source-derived |
| `notion_get_page_and_children` | Get Page And Children | source-derived |
| `notion_get_page_comments` | Get Page Comments | source-derived |
| `notion_restore_database_item` | Restore Database Item | source-derived |
| `notion_retrieve_page` | Retrieve Page | source-derived |
| `notion_update_database_item` | Update Database Item | source-derived |
| `openrouter` | Marketplace — OpenRouter | source-derived |
| `opportunity` | Marketplace — opportunity | source-derived |
| `payment` | Marketplace — payment | source-derived |
| `payments_create_estimate` | Send Estimate | source-derived |
| `payments_create_invoice` | Send Invoice | source-derived |
| `proposals_estimates_send_document` | Send Documents & Contracts | source-derived |
| `rcs_interactive_message` | Marketplace step — rcs_interactive_message | proven-live |
| `react_to_last_message` | React To Last Message | source-derived |
| `remove_associated_record` | Remove Associated Record | source-derived |
| `remove_associated_records_from_workflow` | Remove Associated Records From Workflow | source-derived |
| `remove_contact_tag_tool` | Remove Contact Tags | proven-live |
| `revoke-group-access` | Revoke Group Access | source-derived |
| `revoke-private-channel-access` | Revoke Private Channel Access | source-derived |
| `send_rcs` | Marketplace step — send_rcs | proven-live |
| `send_smart_message` | Send Message - Blooio.com | source-derived |
| `send_whatsapp_flow` | WhatsApp: Send Flows | undefined |
| `send_whatsapp_message` | WhatsApp | undefined |
| `send-data` | Marketplace — send_data | source-derived |
| `staging-test` | Marketplace — Staging Test | source-derived |
| `survey_monkey_ia_create_contact` | Create Contact | source-derived |
| `survey_monkey_ia_delete_survey` | Delete Survey | source-derived |
| `survey_monkey_ia_inputs` | Find Collector | source-derived |
| `survey_monkey_ia_search_contact` | Search Contact | source-derived |
| `survey_monkey_ia_send_survey` | Send Survey | source-derived |
| `survey-monkey` | Marketplace — Survey Monkey | source-derived |
| `test_compilation` | test compilation | source-derived |
| `tiktok-dm` | TikTok Interactive Messenger | proven-live |
| `todoist` | Marketplace — Todoist | source-derived |
| `typeform` | Marketplace — Typeform | source-derived |
| `typeform_create_form` | Create Empty Form | source-derived |
| `typeform_duplicate_existing_form` | Duplicate Existing Form | source-derived |
| `typeform_search_responses` | Search Responses in a form | source-derived |
| `update_associated_company` | Update Associated Company | proven-live |
| `update_conversation_ai_status` | Update Conversation AI Bot and Status | undefined |
| `update_inventory` | Marketplace step — update_inventory | proven-live |
| `vapi-ai` | Marketplace — Vapi.ai | source-derived |
| `voice_ai_outbound_call` | Voice AI Outbound Call | proven-live |
| `voice-ai` | Marketplace — Voice AI | source-derived |
| `whatsapp_24h_window` | WhatsApp: Customer Service Window Check | undefined |
| `whatsapp_interactive_messages` | WhatsApp Interactive Messages | undefined |
| `whatsapp_media` | WhatsApp Media | undefined |
| `whatsapp_v2` | WhatsApp | undefined |
| `workflow_ai_analyze_image` | workflow_ai_analyze_image | proven-live |
| `workflow_ai_decision_maker` | workflow_ai_decision_maker | proven-live |
| `workflow_ai_email_parser` | workflow_ai_email_parser | source-derived |
| `workflow_ai_extract_data` | workflow_ai_extract_data | proven-live |
| `workflow_ai_intent_detection` | workflow_ai_intent_detection | proven-live |
| `workflow_ai_summarize_text` | workflow_ai_summarize_text | proven-live |
| `workflow_ai_translate_content` | workflow_ai_translate_content | proven-live |
| `workflow-ai` | Marketplace — workflow_ai | source-derived |
