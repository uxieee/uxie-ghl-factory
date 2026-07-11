// Deterministic compiler: Conversation AI IR -> GHL internal /ai-employees/* payloads.
// See research/ai-agents-internal/conversation-ai-internal.md and
// captures/convai-{create,update,action,kb}.json + captures/convai-actions-all.json
// (the 6 additional action types) for the ground truth this traces to. This module
// produces request DESCRIPTORS ({method, path, body}) — it never makes a live call.
// Auth is `token-id` (NOT `Authorization: Bearer`) per the capture notes; the caller
// is responsible for attaching the header value.
import { parseConvaiIR, parseConvaiPartialIR, IRError } from './convai-ir.mjs';

export const AUTH_HEADER = 'token-id';

// Static defaults exactly as captured in convai-create.json's request_body (the "Start
// from Scratch" preset) — used whenever the IR omits the corresponding optional field.
const DEFAULT_WAIT = { value: 2, unit: 'seconds' };
const DEFAULT_SLEEP = { enabled: false, onManualMessage: false, onWorkflowMessage: false, time: 2, timeUnit: 'hours' };
const DEFAULT_AUTOPILOT_MAX_MESSAGES = 75;

// summary{} default — identical shape/values to convai-create.json (no IR-level knobs for
// this yet; not part of the documented input shape).
function defaultSummary() {
  return {
    enabled: false,
    inactivity: { value: 15, unit: 'minutes' },
    minimumMessages: 3,
    workflowIds: [],
    emailNotifications: { admins: false, allUsers: false, contactAssignedUser: false, specificUsers: [], customEmail: '' },
  };
}

// Build the full create-body. Field names, order, and static defaults trace 1:1 to
// convai-create.json's `request_body`.
function buildCreateBody(ir, { locationId }) {
  const wait = ir.wait ?? {};
  const sleep = ir.sleep ?? {};
  return {
    locationId,
    employeeName: ir.name,
    businessName: '',
    mode: ir.mode,
    channels: ir.channels,
    isPrimary: false,
    waitTime: wait.value ?? DEFAULT_WAIT.value,
    waitTimeUnit: wait.unit ?? DEFAULT_WAIT.unit,
    sleepEnabled: sleep.enabled ?? DEFAULT_SLEEP.enabled,
    sleepOnManualMessage: sleep.onManualMessage ?? DEFAULT_SLEEP.onManualMessage,
    sleepOnWorkflowMessage: sleep.onWorkflowMessage ?? DEFAULT_SLEEP.onWorkflowMessage,
    sleepTime: sleep.time ?? DEFAULT_SLEEP.time,
    sleepTimeUnit: sleep.timeUnit ?? DEFAULT_SLEEP.timeUnit,
    autoPilotMaxMessages: ir.autoPilotMaxMessages ?? DEFAULT_AUTOPILOT_MAX_MESSAGES,
    // actions are a separate resource (POST /ai-employees/actions, see compileConvaiAction
    // below) — they require the employeeId this create call returns, so the create body
    // itself always carries an empty array (matches convai-create.json's request_body).
    actions: [],
    personality: ir.personality ?? '',
    goal: ir.goal ?? '',
    instructions: ir.instructions ?? '',
    botType: 'PROMPT_BASED_BOT',
    knowledgeBaseIds: ir.knowledgeBaseIds ?? [],
    knowledgeBaseTriggers: [],
    summary: defaultSummary(),
    respondToImages: ir.respondToImages ?? false,
    respondToAudio: ir.respondToAudio ?? false,
    objectiveBuilderWorkflowId: '',
    isObjectiveBuilderEnabled: false,
    aiResponseLengthEnabled: false,
    responseLength: 'balanced',
  };
}

// Live-verified 422 gap: POSTing a humanHandOver action without `details.enabled` /
// `details.triggerCondition` / `details.reactivateEnabled` is rejected by the API even
// though convai-action.json's request_body carries them. Defaults below match the
// capture's values for the two boolean flags; `triggerCondition` has no sane default (it's
// the bot's own decision trigger text) so it's required and length-validated instead.
//
// Second live-verified 422 gap (found re-testing the fix above, 2026-07-11): the API also
// requires `details.sleepTime` / `details.sleepTimeUnit` (number 1-30 / enum
// days|hours|minutes) for humanHandOver, even though it's unrelated to the handover
// semantics — it was present in convai-action.json's request_body all along
// (sleepTime: 8, sleepTimeUnit: "hours") but had been dropped from the defaults here.
const HUMAN_HANDOVER_DETAIL_DEFAULTS = {
  enabled: true,
  reactivateEnabled: false,
  sleepTime: 8,
  sleepTimeUnit: 'hours',
};
const TRIGGER_CONDITION_MIN = 10;
const TRIGGER_CONDITION_MAX = 500;

function buildHumanHandOverDetails(details) {
  const triggerCondition = details.triggerCondition;
  if (
    typeof triggerCondition !== 'string' ||
    triggerCondition.length < TRIGGER_CONDITION_MIN ||
    triggerCondition.length > TRIGGER_CONDITION_MAX
  ) {
    throw new IRError(
      'SCHEMA',
      `humanHandOver action.details.triggerCondition must be a string between ${TRIGGER_CONDITION_MIN} and ${TRIGGER_CONDITION_MAX} chars (API-required; live-verified 422 without it), got: ${JSON.stringify(triggerCondition)}`,
    );
  }
  return { ...HUMAN_HANDOVER_DETAIL_DEFAULTS, ...details };
}

// --- Verified action-type detail builders ---------------------------------------
// Ground truth: research/ai-agents-internal/captures/convai-actions-all.json
// (captured 2026-07-11, POST /ai-employees/actions against a real test agent). Each
// builder validates the fields the capture's `requiredFieldsUI` (or, where the UI ships
// a pre-built default scenario needing only its enable toggle, the task's explicit
// required-field list) marks required, then merges the caller's details over the
// capture's literal default values for every optional field.

// appointmentBooking: only calendarId gated the modal's Proceed button (no asterisk
// shown, but functionally required — see the capture's requiredFieldsUI note). Every
// other field is an advanced-options toggle, defaulted to its captured off/null value.
const APPOINTMENT_BOOKING_DETAIL_DEFAULTS = {
  calendarActionType: 'single',
  onlySendLink: false,
  triggerWorkflow: false,
  workflowIds: null,
  sleepAfterBooking: false,
  sleepTimeUnit: null,
  sleepTime: null,
  transferBot: false,
  transferEmployee: null,
  cancelEnabled: false,
  rescheduleEnabled: false,
};

function buildAppointmentBookingDetails(details) {
  if (typeof details.calendarId !== 'string' || details.calendarId.length === 0) {
    throw new IRError(
      'SCHEMA',
      `appointmentBooking action.details.calendarId is required (gates the calendar-selection step; convai-actions-all.json), got: ${JSON.stringify(details.calendarId)}`,
    );
  }
  return { ...APPOINTMENT_BOOKING_DETAIL_DEFAULTS, ...details };
}

// triggerWorkflow: workflowIds + triggerCondition are both marked required-with-asterisk
// in the capture (`name (Action name *)`, `workflowIds *`, `triggerCondition *`). name is
// the top-level action.name, already validated by compileConvaiAction. No optional
// fields observed for this type — nothing to default.
function buildTriggerWorkflowDetails(details) {
  if (!Array.isArray(details.workflowIds) || details.workflowIds.length === 0) {
    throw new IRError(
      'SCHEMA',
      `triggerWorkflow action.details.workflowIds must be a non-empty array (API-required per convai-actions-all.json), got: ${JSON.stringify(details.workflowIds)}`,
    );
  }
  if (typeof details.triggerCondition !== 'string' || details.triggerCondition.length === 0) {
    throw new IRError(
      'SCHEMA',
      `triggerWorkflow action.details.triggerCondition is required (API-required per convai-actions-all.json), got: ${JSON.stringify(details.triggerCondition)}`,
    );
  }
  return { ...details };
}

// updateContactField ("Contact Info" in the UI): contactFieldId + description are both
// marked required-with-asterisk in the capture. contactUpdateExamples is an array left
// empty by default; contactFieldName/contactFieldDataType/contactFieldKey are UI-derived
// from the picked field and passed through as given (no sane default — they describe
// whichever field the caller picked).
const UPDATE_CONTACT_FIELD_DETAIL_DEFAULTS = {
  contactUpdateExamples: [],
};

function buildUpdateContactFieldDetails(details) {
  if (typeof details.contactFieldId !== 'string' || details.contactFieldId.length === 0) {
    throw new IRError(
      'SCHEMA',
      `updateContactField action.details.contactFieldId is required (API-required per convai-actions-all.json), got: ${JSON.stringify(details.contactFieldId)}`,
    );
  }
  if (typeof details.description !== 'string' || details.description.length === 0) {
    throw new IRError(
      'SCHEMA',
      `updateContactField action.details.description is required (API-required per convai-actions-all.json), got: ${JSON.stringify(details.description)}`,
    );
  }
  return { ...UPDATE_CONTACT_FIELD_DETAIL_DEFAULTS, ...details };
}

// stopBot: the capture's only required-with-asterisk field is `name` (the top-level
// action.name, already validated). GHL ships this action with one pre-built, pre-filled
// scenario ("Goodbye Detection") that only needs its enable toggle switched on — these
// defaults reproduce that pre-built scenario's literal values.
const STOP_BOT_DETAIL_DEFAULTS = {
  stopBotDetectionType: 'Goodbye',
  stopBotTriggerCondition: 'When the contact says goodbye or similar phrases ',
  finalMessage: 'Thank you for your time, Have a nice day.',
  reactivateEnabled: true,
  sleepTimeUnit: 'hours',
  sleepTime: 24,
  stopBotExamples: ['Bye', 'Goodbye', 'Thank you! have a nice day'],
  enabled: true,
  tags: ['stop bot'],
};

function buildStopBotDetails(details) {
  return { ...STOP_BOT_DETAIL_DEFAULTS, ...details };
}

// transferBot: the capture's UI-required-with-asterisk field is only `name`, but
// transferToBot (the target bot's employeeId) is what makes the action functional at
// all — the task spec calls it out as required, so it's validated here even though the
// UI didn't mark it with a visible asterisk (GHL ships it pre-filled with the location's
// primary bot, same "pre-built default scenario" pattern as stopBot).
const TRANSFER_BOT_DETAIL_DEFAULTS = {
  transferBotExamples: [],
  transferBotType: 'Default',
  enabled: true,
  transferBotTriggerCondition: "If bot doesn't know the answer",
};

function buildTransferBotDetails(details) {
  if (typeof details.transferToBot !== 'string' || details.transferToBot.length === 0) {
    throw new IRError(
      'SCHEMA',
      `transferBot action.details.transferToBot is required (target bot employeeId; convai-actions-all.json), got: ${JSON.stringify(details.transferToBot)}`,
    );
  }
  return { ...TRANSFER_BOT_DETAIL_DEFAULTS, ...details };
}

// advancedFollowup ("Auto Followup" in the UI): the capture's only required-with-asterisk
// field is `name` (top-level, already validated). Ships with a pre-built
// "Contact Stopped Replying" scenario (one followupSequence step, AI-authored message)
// that only needs its enable toggle switched on.
const ADVANCED_FOLLOWUP_DETAIL_DEFAULTS = {
  enabled: true,
  scenarioId: 'contactStoppedReplying',
  followupSequence: [
    { id: 1, followupTime: 15, followupTimeUnit: 'minutes', aiEnabledMessage: true, customMessage: null, workflowId: null, triggerWorkflow: false },
  ],
};

function buildAdvancedFollowupDetails(details) {
  return { ...ADVANCED_FOLLOWUP_DETAIL_DEFAULTS, ...details };
}

// Dispatch on action.type. Merges user-provided `details` over API-required/capture-
// grounded defaults for every VERIFIED_ACTION_TYPES entry (convai-ir.mjs). Any other
// (unlisted) type has no capture backing it — it stays pure passthrough rather than risk
// inventing fields the API doesn't expect.
function buildActionDetails(action) {
  const details = action.details ?? {};
  switch (action.type) {
    case 'humanHandOver': return buildHumanHandOverDetails(details);
    case 'appointmentBooking': return buildAppointmentBookingDetails(details);
    case 'triggerWorkflow': return buildTriggerWorkflowDetails(details);
    case 'updateContactField': return buildUpdateContactFieldDetails(details);
    case 'stopBot': return buildStopBotDetails(details);
    case 'transferBot': return buildTransferBotDetails(details);
    case 'advancedFollowup': return buildAdvancedFollowupDetails(details);
    default: return details; // unverified type — passthrough, no defaults injected
  }
}

// POST /ai-employees/actions — body: {employeeId, locationId, type, name, details}
// (convai-action.json). `agentId` defaults to null: at the point compileConvaiAgent()
// assembles these, the agent does not exist yet (employeeId is server-assigned on the
// create response) — the orchestrator must patch the real id into each action body
// after issuing the create request, before POSTing the actions. Call this directly with
// a known `agentId` to compile an action against an already-existing agent.
export function compileConvaiAction(action, { agentId = null, locationId } = {}) {
  if (!action || typeof action !== 'object') throw new IRError('SCHEMA', 'action must be an object');
  if (typeof action.type !== 'string' || !action.type) throw new IRError('SCHEMA', 'action.type is required');
  if (typeof action.name !== 'string' || !action.name) throw new IRError('SCHEMA', 'action.name is required');
  if (action.details !== undefined && (typeof action.details !== 'object' || action.details === null))
    throw new IRError('SCHEMA', 'action.details must be an object when present');
  const body = {
    employeeId: agentId,
    locationId,
    type: action.type,
    name: action.name,
    details: buildActionDetails(action),
  };
  return { method: 'POST', path: '/ai-employees/actions', body };
}

// POST /ai-employees/employees — full create. Returns the create descriptor plus the
// (employeeId-less) action descriptors for anything in ir.actions[].
export function compileConvaiAgent(ir, { locationId } = {}) {
  const norm = parseConvaiIR(ir);
  const create = { method: 'POST', path: '/ai-employees/employees', body: buildCreateBody(norm, { locationId }) };
  const actions = (norm.actions ?? []).map((a) => compileConvaiAction(a, { agentId: null, locationId }));
  return { create, actions, authHeader: AUTH_HEADER };
}

// IR key -> wire key, for the scalar fields a partial update may touch directly.
const UPDATE_FIELD_MAP = {
  name: 'employeeName',
  mode: 'mode',
  channels: 'channels',
  personality: 'personality',
  goal: 'goal',
  instructions: 'instructions',
  autoPilotMaxMessages: 'autoPilotMaxMessages',
  knowledgeBaseIds: 'knowledgeBaseIds',
  knowledgeBaseTriggers: 'knowledgeBaseTriggers',
  respondToImages: 'respondToImages',
  respondToAudio: 'respondToAudio',
};

// PUT /ai-employees/employees/:agentId — the backend MERGES (confirmed by convai-kb.json,
// which sent only `locationId` + `knowledgeBaseTriggers` and had the rest of the record
// survive untouched). So only keys actually present on `partialIr` are emitted; there are
// no defaults here (unlike the create body).
export function compileConvaiUpdate(partialIr, { agentId, locationId } = {}) {
  if (!agentId) throw new IRError('MISSING_FIELD', 'compileConvaiUpdate requires agentId');
  const norm = parseConvaiPartialIR(partialIr);
  const body = { locationId };
  for (const [irKey, wireKey] of Object.entries(UPDATE_FIELD_MAP)) {
    if (norm[irKey] !== undefined) body[wireKey] = norm[irKey];
  }
  if (norm.wait !== undefined) {
    if (norm.wait.value !== undefined) body.waitTime = norm.wait.value;
    if (norm.wait.unit !== undefined) body.waitTimeUnit = norm.wait.unit;
  }
  if (norm.sleep !== undefined) {
    const s = norm.sleep;
    if (s.enabled !== undefined) body.sleepEnabled = s.enabled;
    if (s.onManualMessage !== undefined) body.sleepOnManualMessage = s.onManualMessage;
    if (s.onWorkflowMessage !== undefined) body.sleepOnWorkflowMessage = s.onWorkflowMessage;
    if (s.time !== undefined) body.sleepTime = s.time;
    if (s.timeUnit !== undefined) body.sleepTimeUnit = s.timeUnit;
  }
  return { method: 'PUT', path: `/ai-employees/employees/${agentId}`, body, authHeader: AUTH_HEADER };
}
