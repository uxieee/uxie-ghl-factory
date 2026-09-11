// GENERATED from a read-only census of STORED, WORKING workflows (knowledge/sniffs/step-key-census-2026-09-11).
// 162 workflows, 2602 steps across GROM Sandbox (mostly engine-built) and GROM
// Digital AU (UI-built), measured 2026-09-11. KEYS ONLY: no values, ids or names.
//
// Evidence that a key is REAL. Absence here is not evidence a key is invented: document-gate.mjs also
// consults the type cards, the source models and the required fields. The census found that the cards'
// attrKeys alone would have refused working workflows (every stored if_else carries branches/operator/
// if/conditionName; the card lists only `else`), and that an allowlist built from the engine-built
// account alone would have refused every workflow a human made on the advanced canvas
// (advanceCanvasMeta, 93 steps on the UI-built account, none on the engine-built one).
//
// RE-CALIBRATED 2026-09-12 over a WIDER corpus — 184 workflows, 3,293 steps across three accounts
// (`knowledge/sniffs/step-key-census-2026-09-11-2`, run by the committed `sniffs/step-key-census.mjs`):
// no new top-level key, no new attribute key on any known type, no new inner type. The allowlists
// below are current. The one type the wider sweep added, `wait_step`, is GoGHL's marketplace action
// and every stored one carries isMarketplaceAction:true, which document-gate.mjs skips by design.
//
// It also measured the CANVAS layer's calibration: 93 steps carry advanceCanvasMeta and ZERO steps
// or triggers carry hasErrors:true, so refusing a publish on that flag refuses nothing that exists.
export const OBSERVED_TOP_LEVEL_KEYS = Object.freeze(["advanceCanvasMeta", "attributes", "cat", "comments", "id", "incompleteData", "isMarketplaceAction", "name", "next", "nodeType", "order", "parent", "parentKey", "sibling", "stepIndex", "type", "version", "workflowsActionType"]);

export const OBSERVED_ATTRIBUTE_KEYS = Object.freeze({
  "add_contact_tag": [
    "tags",
    "type"
  ],
  "add_notes": [
    "color",
    "html",
    "title",
    "type"
  ],
  "add_to_workflow": [
    "input_trigger_params",
    "type",
    "workflow_id"
  ],
  "array_functions": [
    "action",
    "math_functions",
    "referencePath"
  ],
  "assign_user": [
    "only_unassigned_contact",
    "total_index",
    "traffic_index",
    "traffic_split",
    "traffic_weightage",
    "type",
    "user_list"
  ],
  "chatgpt": [
    "actionParams",
    "actionType",
    "apiKey",
    "event",
    "excludeFromHistory",
    "excludeInstructionsFromHistory",
    "memoryKey",
    "model",
    "promptText",
    "temperature",
    "type"
  ],
  "conversationai_ai_message": [
    "__customInputs__",
    "message",
    "type",
    "waitForReply"
  ],
  "conversationai_ai_splitter": [
    "__customInputs__",
    "__name__",
    "cat",
    "convertToMultipath",
    "description",
    "transitions",
    "type"
  ],
  "conversationai_book_appointment": [
    "__customInputs__",
    "__name__",
    "calendarId",
    "cat",
    "convertToMultipath",
    "promptInstructions",
    "transitions",
    "type"
  ],
  "conversationai_continue": [
    "__customInputs__",
    "instructions",
    "type"
  ],
  "conversationai_custom_message": [
    "__customInputs__",
    "message",
    "type",
    "waitForReply"
  ],
  "conversationai_end": [
    "__customInputs__",
    "message",
    "sleepDuration",
    "sleepEnabled",
    "sleepUnit",
    "type"
  ],
  "conversationai_objective": [
    "__customInputs__",
    "closingMessage",
    "contactField",
    "instructions",
    "maxAttempts",
    "objective",
    "proceedIfNotMet",
    "responseExample",
    "skipIfFilled",
    "type"
  ],
  "conversationai_services_booking": [
    "__customInputs__",
    "type"
  ],
  "conversationai_transfer_bot": [
    "__customInputs__",
    "assignedEmployeeId",
    "type"
  ],
  "custom_code": [
    "code",
    "inputData",
    "language",
    "output"
  ],
  "custom_webhook": [
    "authorization",
    "body",
    "event",
    "headers",
    "method",
    "parameters",
    "saveResponse",
    "url",
    "webhookResponse"
  ],
  "datetime_formatter": [
    "action",
    "compare",
    "type"
  ],
  "dnd_contact": [
    "dnd_contact",
    "type"
  ],
  "email": [
    "attachments",
    "bcc",
    "conditions",
    "createdAt",
    "fieldDefaults",
    "from_email",
    "from_name",
    "html",
    "htmlDefaults",
    "isCloned",
    "preHeader",
    "previewUrl",
    "subject",
    "syncEnabled",
    "templateCreationMode",
    "template_id",
    "templatesource",
    "trackingOptions",
    "updatedAt"
  ],
  "facebook_conversion_api": [
    "access_token",
    "connection_type",
    "currency",
    "customMapping",
    "event_type",
    "isCustomMappingEnabled",
    "pixel_id",
    "stage_name",
    "type"
  ],
  "find_opportunity": [
    "__customInputFields__",
    "__customInputs__",
    "__name__",
    "cat",
    "convertToMultipath",
    "sorting",
    "transitions",
    "type"
  ],
  "goto": [
    "targetNodeId",
    "type"
  ],
  "if_else": [
    "branches",
    "conditionName",
    "currentRecipeType",
    "else",
    "if",
    "instructions",
    "noneBranchName",
    "operator",
    "version"
  ],
  "internal_create_opportunity": [
    "__customInputFields__",
    "__customInputs__",
    "pipelineId",
    "type"
  ],
  "internal_notification": [
    "email",
    "notification",
    "sms",
    "type"
  ],
  "internal_update_opportunity": [
    "__customInputFields__",
    "__customInputs__",
    "allowBackward",
    "pipeline",
    "stage",
    "type"
  ],
  "loop": [
    "items",
    "limit",
    "mode",
    "type"
  ],
  "manual-call": [
    "assignedUser",
    "standardAssignedUser"
  ],
  "math_operation": [
    "operators",
    "selectField",
    "selectFieldtype",
    "sourceCustomValueId",
    "targetCustomValueId",
    "updateField",
    "updateFieldType"
  ],
  "membership_grant_offer": [
    "offer_id",
    "type"
  ],
  "remove_contact_tag": [
    "tags",
    "type"
  ],
  "remove_from_workflow": [
    "type",
    "workflow_id"
  ],
  "send_outbound_whatsapp_message": [
    "__customInputs__",
    "__dynamicAttachments__",
    "attachment",
    "connected_phone",
    "message",
    "type"
  ],
  "sms": [
    "attachments",
    "body",
    "template_id"
  ],
  "task-notification": [
    "__customInputs__",
    "assignedTo",
    "body",
    "dueDate",
    "title",
    "type"
  ],
  "transition": [
    "description",
    "type"
  ],
  "update_appointment_status": [
    "category",
    "status_type",
    "type"
  ],
  "update_contact_field": [
    "actionType",
    "fields",
    "type"
  ],
  "update_custom_value": [
    "custom_value_id",
    "name",
    "new_value"
  ],
  "wait": [
    "appointmentCondition",
    "appointmentSpecificStep",
    "appointmentStartAfter",
    "cat",
    "condition",
    "convertToMultipath",
    "dynamicSpecificDate",
    "hybridActionType",
    "isHybridAction",
    "name",
    "reply",
    "replyLabel",
    "specificDate",
    "specificDateInputMode",
    "specificDateOffsetDays",
    "specificDateOffsetHours",
    "specificDateOffsetMinutes",
    "specificDatePassed",
    "specificDateProceed",
    "startAfter",
    "timePeriodInputMode",
    "transitions",
    "type",
    "unitInputMode",
    "window",
    "windowCondition"
  ],
  "webhook": [
    "customData",
    "headers",
    "method",
    "url"
  ],
  "workflow_ai_decision_maker": [
    "__customInputs__",
    "cat",
    "convertToMultipath",
    "information",
    "instructions",
    "transitions",
    "type"
  ],
  "workflow_ai_intent_detection": [
    "__customInputs__",
    "__name__",
    "cat",
    "convertToMultipath",
    "inputText",
    "transitions",
    "type"
  ],
  "workflow_goal": [
    "action",
    "op",
    "segments",
    "type"
  ],
  "workflow_split": [
    "cat",
    "condition",
    "extras",
    "name",
    "paths",
    "transitions",
    "type"
  ]
});

// attributes.type values stored per step type, same census (knowledge/sniffs/step-key-census-2026-09-11/
// inner-type-values.json). 31 types MIRROR the row type on every stored step; wait carries its mode,
// internal_notification its channel, transition its wait branch, task-notification the underscore spelling.
export const OBSERVED_INNER_TYPES = Object.freeze({
  "add_contact_tag": [
    "add_contact_tag"
  ],
  "add_notes": [
    "add_notes"
  ],
  "add_to_workflow": [
    "add_to_workflow"
  ],
  "assign_user": [
    "assign_user"
  ],
  "chatgpt": [
    "chatgpt"
  ],
  "conversationai_ai_message": [
    "conversationai_ai_message"
  ],
  "conversationai_ai_splitter": [
    "conversationai_ai_splitter"
  ],
  "conversationai_book_appointment": [
    "conversationai_book_appointment"
  ],
  "conversationai_continue": [
    "conversationai_continue"
  ],
  "conversationai_custom_message": [
    "conversationai_custom_message"
  ],
  "conversationai_end": [
    "conversationai_end"
  ],
  "conversationai_objective": [
    "conversationai_objective"
  ],
  "conversationai_services_booking": [
    "conversationai_services_booking"
  ],
  "conversationai_transfer_bot": [
    "conversationai_transfer_bot"
  ],
  "datetime_formatter": [
    "datetime_formatter"
  ],
  "dnd_contact": [
    "dnd_contact"
  ],
  "facebook_conversion_api": [
    "facebook_conversion_api"
  ],
  "find_opportunity": [
    "find_opportunity"
  ],
  "goto": [
    "goto"
  ],
  "internal_create_opportunity": [
    "internal_create_opportunity"
  ],
  "internal_notification": [
    "email",
    "notification",
    "sms"
  ],
  "internal_update_opportunity": [
    "internal_update_opportunity"
  ],
  "loop": [
    "loop"
  ],
  "membership_grant_offer": [
    "membership_grant_offer"
  ],
  "remove_contact_tag": [
    "remove_contact_tag"
  ],
  "remove_from_workflow": [
    "remove_from_workflow"
  ],
  "send_outbound_whatsapp_message": [
    "send_outbound_whatsapp_message"
  ],
  "task-notification": [
    "task_notification"
  ],
  "transition": [
    "wait_condition",
    "wait_reply",
    "wait_timeout"
  ],
  "update_appointment_status": [
    "update_appointment_status"
  ],
  "update_contact_field": [
    "update_contact_field"
  ],
  "wait": [
    "appointment",
    "condition",
    "reply",
    "specific_date",
    "time"
  ],
  "workflow_ai_decision_maker": [
    "workflow_ai_decision_maker"
  ],
  "workflow_ai_intent_detection": [
    "workflow_ai_intent_detection"
  ],
  "workflow_goal": [
    "workflow_goal"
  ],
  "workflow_split": [
    "workflow_split"
  ]
});
