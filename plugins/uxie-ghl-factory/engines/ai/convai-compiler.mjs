// Deterministic compiler: Conversation AI IR -> GHL internal /ai-employees/* payloads.
// See research/ai-agents-internal/conversation-ai-internal.md and
// captures/convai-{create,update,action,kb}.json + captures/convai-actions-all.json
// (the 6 additional action types) for the ground truth this traces to. This module
// produces request DESCRIPTORS ({method, path, body}) — it never makes a live call.
// Auth uses the gateway's `ai` rail: Bearer JWT and Firebase token-id together.
import { parseConvaiIR, parseConvaiPartialIR, IRError } from './convai-ir.mjs';

export const AUTH_HEADER = 'ai';

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
    // NO customFieldId here: the captured create body does not carry one, and inventing a key on
    // every create is the failure class this engine exists to prevent. An author who wants a
    // summary written to a contact field supplies summary.customFieldId and the spread carries it.
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
    tones: ir.tones ?? [],
    botType: ir.botType ?? 'PROMPT_BASED_BOT',
    knowledgeBaseIds: ir.knowledgeBaseIds ?? [],
    knowledgeBaseTriggers: [],
    summary: { ...defaultSummary(), ...(ir.summary ?? {}) },
    respondToImages: ir.respondToImages ?? false,
    respondToAudio: ir.respondToAudio ?? false,
    // Flow-Based Builder linkage. A FLOW_BUILDER_BOT's logic lives in a workflow whose
    // conv_ai_trigger is bound to this agent; once that workflow exists, the agent is
    // linked via objectiveBuilderWorkflowId + isObjectiveBuilderEnabled:true (usually a
    // follow-up PUT — see compileLinkFlowWorkflow / compileFlowBuilderBot). Emitting them
    // here too lets a caller create an already-linked agent when the workflow id is known.
    objectiveBuilderWorkflowId: ir.objectiveBuilderWorkflowId ?? '',
    isObjectiveBuilderEnabled: ir.isObjectiveBuilderEnabled ?? false,
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
// Third live-verified 422 gap (found 2026-07-15): the API now also REQUIRES
// `details.handoverType` (enum below) on humanHandOver — the first POST without it 422'd.
// It classifies WHY the bot hands off. Default 'custom' pairs with the always-present
// free-text triggerCondition (the bot's own decision text); override per intent.
export const HANDOVER_TYPES = ['contactRequest', 'lackOfInformation', 'failedToResolveIssue', 'custom'];
const HUMAN_HANDOVER_DETAIL_DEFAULTS = {
  enabled: true,
  reactivateEnabled: false,
  sleepTime: 8,
  sleepTimeUnit: 'hours',
  handoverType: 'custom',
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
  if (details.handoverType !== undefined && !HANDOVER_TYPES.includes(details.handoverType)) {
    throw new IRError(
      'SCHEMA',
      `humanHandOver action.details.handoverType must be one of ${HANDOVER_TYPES.join(', ')} (API-required; live-verified 422 without it, 2026-07-15), got: ${JSON.stringify(details.handoverType)}`,
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
// THE UI-SAVE RULE TABLE — the tier between "the API 422s" and "the API accepts but the write is
// inert". These bodies are accepted over the API and the UI then REFUSES to save the agent, so an
// operator who opens it can change nothing until the missing field is supplied. Ported verbatim
// from the shipped validator strings (conversation-ai-2026-08-25/i18n/cai-validators.json).
//
// The tone rule is bot-type-split because the bundle carries BOTH
//   "Personality, Instructions, and Goal should not be empty."
//   "Personality, Instructions, Goal, and Tone should not be empty."
// Only the second names Tone, so an empty tone list is a hard block for the flow builder and an
// advisory everywhere else until a live differential says otherwise.
const WAIT_BOUNDS = { seconds: [1, 21600], minutes: [1, 360], hours: [1, 6] };

export function uiSaveViolations(body, botType) {
  const v = [];
  const push = (field, rule, msg) => v.push({ field, rule, msg });
  if (!Array.isArray(body.channels) || !body.channels.length) push('channels', 'selectChannel', 'Please select at least one channel');
  for (const f of ['personality', 'goal', 'instructions']) {
    if (typeof body[f] !== 'string' || !body[f].trim()) {
      push(f, 'notEmpty', 'Personality, Instructions, and Goal should not be empty.');
    }
  }
  if (!Array.isArray(body.tones) || !body.tones.length) {
    push('tones', 'toneEmpty', 'Personality, Instructions, Goal, and Tone should not be empty.');
  }
  if (Array.isArray(body.tones) && body.tones.length > 3) push('tones', 'errorMaxTones', 'You can select maximum of 3 tones.');
  const unit = body.waitTime?.unit ?? body.wait?.unit;
  const value = body.waitTime?.value ?? body.wait?.value;
  const bounds = WAIT_BOUNDS[unit];
  if (bounds && typeof value === 'number' && (value < bounds[0] || value > bounds[1])) {
    push('waitTime', `${unit}Error`, `Wait time must be between ${bounds[0]} and ${bounds[1]} ${unit}`);
  }
  return v;
}

// A violation is fatal only where it is PROVEN fatal. Everything else warns, because refusing a
// body the UI would in fact accept is its own kind of wrong.
const FATAL_FOR_FLOW_BOT = new Set(['toneEmpty', 'errorMaxTones', 'selectChannel']);

export function compileConvaiAgent(ir, { locationId, warn, allowUiUnsaveable } = {}) {
  const norm = parseConvaiIR(ir);
  const body = buildCreateBody(norm, { locationId });
  const violations = uiSaveViolations(body, body.botType);
  const fatal = body.botType === 'FLOW_BUILDER_BOT' ? violations.filter((x) => FATAL_FOR_FLOW_BOT.has(x.rule)) : [];
  if (fatal.length && allowUiUnsaveable !== true) {
    throw new IRError('UI_SAVE_BLOCKED',
      `this agent would be created over the API and then be UNSAVEABLE from the UI: `
      + fatal.map((x) => `${x.field} — ${x.msg}`).join('; ')
      + '. Fix the field, or pass allowUiUnsaveable:true to create it anyway.');
  }
  for (const x of violations) {
    if (fatal.includes(x)) continue;
    warn?.(`UI_SAVE: ${x.field} — ${x.msg} (the API accepts this body; the UI will refuse to save the agent)`);
  }
  const create = { method: 'POST', path: '/ai-employees/employees', body };
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
  tones: 'tones',
  summary: 'summary',
  respondToImages: 'respondToImages',
  respondToAudio: 'respondToAudio',
  botType: 'botType',
  isObjectiveBuilderEnabled: 'isObjectiveBuilderEnabled',
  objectiveBuilderWorkflowId: 'objectiveBuilderWorkflowId',
};

// PUT /ai-employees/employees/:agentId — this is a PARTIAL-BODY PUT. Whether the backend merges
// is NOT proven: the one capture behind the old "MERGES" claim (convai-kb.json) had
// cancelEnabled/rescheduleEnabled already false, so a reset-to-false was invisible in it; a live
// partial PUT on 2026-08-28 did reset both agent-level toggles (F5-04). Until the read-merge-write
// update lands (Phase-5 plan 3), callers must resend every agent-level field they care about and
// read the echo back. Only keys present on `partialIr` are emitted; no defaults (unlike create).
// THE UI'S OWN PRE-PUT CLEANUP, ported verbatim from useAIEmployee's `eo`
// (conversation-ai-2026-08-25/js/ai-employees.9a1987ebd670b158.js):
//
//   botType !== FLOW_BUILDER_BOT  -> delete cancelEnabled, rescheduleEnabled, tones
//   botType === FORM_BASED_BOT    -> delete personality, goal
//   otherwise                     -> delete skipIfAlreadyFilled, botInitialMessage, steps,
//                                    notificationSettings, brandId; prune empty llm.primary /
//                                    llm.secondary, and drop llm entirely when both are empty
//
// Sending a field the UI strips for this bot type is the same off-dialect guess that produced
// every other accepted-but-inert defect in this programme.
const FLOW_ONLY_KEYS = ['cancelEnabled', 'rescheduleEnabled', 'tones'];
const NON_FORM_KEYS = ['skipIfAlreadyFilled', 'botInitialMessage', 'steps', 'notificationSettings', 'brandId'];
// Keys GET returns that the update DTO REFUSES. The first eight are ordinary server metadata; the
// last three are the ones that made a read-merge-write impossible. `employeeType` and `errors`
// come back on every agent GET and 422 the PUT, so replaying them meant update_convai_agent could
// not touch a FLOW_BUILDER_BOT at all -- it failed safely, having written nothing, and the update
// had to be done by hand (R-21; the record shape re-read live 2026-09-02). `isDeleted` is the same
// class and is NOT covered by `deleted`.
// `rootParentAgentId` is minted by the UI's Duplicate and is likewise read-only (R-59).
const SERVER_KEYS = new Set(['id', '_id', 'dateAdded', 'dateUpdated', 'createdAt', 'updatedAt', 'deleted', 'traceId',
  'employeeType', 'errors', 'isDeleted', 'rootParentAgentId']);

export function applyBotTypeCleanup(body) {
  const b = { ...body };
  if (b.botType !== 'FLOW_BUILDER_BOT') for (const k of FLOW_ONLY_KEYS) delete b[k];
  if (b.botType === 'FORM_BASED_BOT') {
    delete b.personality; delete b.goal;
  } else {
    for (const k of NON_FORM_KEYS) delete b[k];
    if (b.llm) {
      const llm = { ...b.llm };
      if (!llm.primary) delete llm.primary;
      if (!llm.secondary) delete llm.secondary;
      if (!llm.primary && !llm.secondary) delete b.llm; else b.llm = llm;
    }
  }
  return b;
}

// READ-MERGE-WRITE. `PUT /ai-employees/employees/:agentId` takes a partial body, and the old
// claim that it MERGES came from a capture whose at-risk booleans were already false — so a
// reset could not have been seen. A live partial PUT reset cancelEnabled and rescheduleEnabled
// (2026-08-28, F5-04). The UI never sends a partial: it PUTs the whole record. So do we.
//
// `collateralKeys` is every writable key this update does NOT set — the keys the caller must
// prove unchanged after the write, which is the only way to know a reset did not happen.
export function compileConvaiUpdateFromRecord(current, partialIr, { agentId, locationId } = {}) {
  if (!agentId) throw new IRError('MISSING_FIELD', 'compileConvaiUpdateFromRecord requires agentId');
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new IRError('SCHEMA',
      'compileConvaiUpdateFromRecord requires the CURRENT record — GET it first. A partial PUT '
      + 'resets omitted agent-level booleans (measured live 2026-08-28).');
  }
  const norm = parseConvaiPartialIR(partialIr);
  const body = {};
  for (const [k, v] of Object.entries(current)) if (!SERVER_KEYS.has(k) && k !== 'name') body[k] = v;
  body.locationId = locationId ?? current.locationId;
  body.employeeName = current.employeeName ?? current.name;

  const setKeys = new Set(['locationId']);
  for (const [irKey, wireKey] of Object.entries(UPDATE_FIELD_MAP)) {
    if (norm[irKey] !== undefined) { body[wireKey] = norm[irKey]; setKeys.add(wireKey); }
  }
  if (norm.name !== undefined) { body.employeeName = norm.name; setKeys.add('employeeName'); }
  // Actions are their own resource; the record PUT always sends null, as the UI does.
  body.actions = null;
  setKeys.add('actions');

  const cleaned = applyBotTypeCleanup(body);
  const collateralKeys = Object.keys(cleaned).filter((k) => !setKeys.has(k));
  return {
    method: 'PUT',
    path: `/ai-employees/employees/${agentId}`,
    body: cleaned,
    authHeader: AUTH_HEADER,
    collateralKeys,
  };
}

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

// --- Flow-Based Builder (FLOW_BUILDER_BOT) ---------------------------------------
// A flow bot's logic IS a workflow: a create-ghl-workflow with a conv_ai_trigger bound
// to the agent (convTriggerBotId = agentId), whose steps are the conversationai_* nodes
// (+ custom_webhook to the worker). The agent is then linked to that workflow via a PUT
// setting isObjectiveBuilderEnabled:true + objectiveBuilderWorkflowId = the workflow id.
// Verified live 2026-07-14 (flow-builder-recon.md). Agent CRUD uses `token-id`; the flow
// workflow uses the create-ghl-workflow recipe (Authorization: Bearer) — two different
// auth rails, so this driver keeps the agent + workflow steps as separate descriptors.

// PUT that links an existing FLOW_BUILDER_BOT agent to its (now-created) flow workflow.
export function compileLinkFlowWorkflow(agentId, workflowId, { locationId } = {}) {
  if (!agentId) throw new IRError('MISSING_FIELD', 'compileLinkFlowWorkflow requires agentId');
  if (!workflowId) throw new IRError('MISSING_FIELD', 'compileLinkFlowWorkflow requires workflowId');
  return compileConvaiUpdate(
    { isObjectiveBuilderEnabled: true, objectiveBuilderWorkflowId: workflowId },
    { agentId, locationId },
  );
}

// Build a FLOW_BUILDER_BOT end to end. Returns an ordered PLAN of descriptors/factories —
// it makes no live calls (agentId + workflowId are runtime values the caller threads in):
//   1. createAgent          — POST the agent as FLOW_BUILDER_BOT (token-id).
//   2. flowWorkflow(agentId)— the flow workflow bound to the agent id. If a
//      `compileWorkflow` fn (create-ghl-workflow's compile) + `workflowCtx` are injected,
//      returns its compiled descriptors; otherwise returns the workflow IR for the caller
//      to compile. The conv_ai_trigger carries convTriggerBotId = agentId.
//   3. linkWorkflow(agentId, workflowId) — PUT linking the agent to the created workflow.
//
// `ir.flow` is a create-ghl-workflow IR (triggers optional — a conv_ai_trigger is injected/
// bound automatically). Its graph is the conversationai_* + custom_webhook steps.
export function compileFlowBuilderBot(ir, { locationId, compileWorkflow, workflowCtx } = {}) {
  const agentIr = { ...ir, botType: 'FLOW_BUILDER_BOT' };
  delete agentIr.flow;
  const createAgent = compileConvaiAgent(agentIr, { locationId });

  const flowWorkflow = (agentId) => {
    if (!agentId) throw new IRError('MISSING_FIELD', 'flowWorkflow requires the created agentId');
    const flow = ir.flow ?? { name: ir.name, triggers: [], graph: [] };
    // Bind (or inject) the conv_ai_trigger to this agent. A caller-supplied conv_ai_trigger
    // is honored; otherwise one is added. convTriggerBotId is what ties the workflow to the
    // agent so the flow builder opens it as the agent's canvas.
    const triggers = [...(flow.triggers ?? [])];
    const existing = triggers.find((t) => t.type === 'conv_ai_trigger');
    if (existing) {
      existing.convTriggerBotId = agentId;
    } else {
      triggers.unshift({ ref: 'conv_ai', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [], convTriggerBotId: agentId });
    }
    const workflowIr = { ...flow, triggers, workflowType: 'agent' };
    if (typeof compileWorkflow === 'function') return compileWorkflow(workflowIr, workflowCtx);
    return workflowIr;
  };

  return {
    createAgent,
    flowWorkflow,
    linkWorkflow: (agentId, workflowId) => compileLinkFlowWorkflow(agentId, workflowId, { locationId }),
    authHeader: AUTH_HEADER,
  };
}
