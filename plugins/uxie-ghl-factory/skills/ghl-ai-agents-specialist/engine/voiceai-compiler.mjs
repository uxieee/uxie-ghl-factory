// Deterministic compiler: Voice AI IR -> GHL internal /voice-ai/* payloads. See
// research/ai-agents-internal/voice-ai-internal.md and
// captures/voiceai-{create,update-identity,update-behavior-transcription-voice,
// action,delete}.json + captures/voiceai-actions-all.json (the 6 additional action
// types) for the ground truth this traces to. This module produces request
// DESCRIPTORS ({method, path, body}) — it never makes a live call. Auth is
// `token-id` (same header as ConvAI/KB, NOT `Authorization: Bearer`); the caller is
// responsible for attaching the header value.
//
// ============================================================================
// Merge semantics: FULL REPLACE (differs from Conversation AI's PUT, which merges)
// ============================================================================
// Every Save in the Voice AI builder issues the SAME PUT
// `/voice-ai/agents/:id?publishAgent=true&mode=update` with the COMPLETE agent
// object — untouched fields are re-sent unchanged, there is no partial-patch. That
// shapes this module's two entrypoints:
//
//   - compileVoiceAiAgent(ir, opts) -> POST /voice-ai/agents. Per voiceai-create.json,
//     this call accepts almost nothing — just `{ locationId }`. The backend
//     auto-generates a default agent (name, prompt, welcome message, agentSettings)
//     server-side and returns its id; the IR's rich fields CANNOT be sent here
//     because the create endpoint doesn't accept them. This function still
//     validates the full IR up front (so a bad IR fails before any request is
//     issued) and compiles any ir.actions[] (agentId left null — see
//     compileVoiceAiAction below).
//   - compileVoiceAiUpdate(fullIr, opts) -> PUT
//     /voice-ai/agents/:agentId?publishAgent=true&mode=update. Because the backend
//     does a full replace, the real-world workflow is: create -> GET the returned
//     default agent -> reconcile the desired config into it -> PUT the WHOLE
//     document back. This compiler has no network access, so it cannot perform that
//     GET step itself: it takes a FULL Voice AI IR (not a partial) and emits the
//     complete replacement body the PUT expects, filling any field the IR omits
//     with the stable literal default observed across BOTH update captures. It is
//     the caller's/executor's responsibility to have already reconciled the IR with
//     the server's current document (e.g. by seeding IR fields from a prior GET)
//     before calling this function — passing a partial IR here will silently
//     overwrite live fields with these defaults, which is exactly the footgun a
//     full-replace update endpoint creates.
import { parseVoiceAiIR, IRError } from './voiceai-ir.mjs';

export const AUTH_HEADER = 'token-id';

// Stable defaults: values that appear UNCHANGED across BOTH update captures
// (voiceai-update-identity.json and voiceai-update-behavior-transcription-voice.json).
// Instance-specific data (agentName, agentPrompt, welcomeMessage, businessName,
// timezone, locationId) is never defaulted here — it always comes from the IR/opts.
const DEFAULTS = {
  voiceId: 'g6xIsTj2HwM6VR4iXFCw',
  voiceModel: 'auto',
  language: 'en-US',
  inboundPhoneNumber: null,
  inboundNumbers: [],
  numberPoolId: null,
  callEndWorkflowIds: [],
  advancedSettingsEnabled: true,
  sendPostCallNotificationTo: { admins: true, allUsers: false, contactAssignedUser: false, specificUsers: [], customEmails: [] },
  agentWorkingHours: [],
  maxCallDuration: 900,
  voiceTemperature: 0.15,
  voiceSpeed: 0.33,
  voiceVolume: 0.5,
  modelTemperature: 0,
  backgroundSound: null,
  reminderFrequency: 1,
  sendUserIdleReminders: true,
  reminderAfterIdleTimeSeconds: 4,
  interruptionSensitivity: 0.75,
  isAgentAsBackupDisabled: true,
  llmModel: 'gpt-4.1',
  knowledgeBaseIds: null,
  knowledgeBasePrompt: 'Use this knowledge base if the user asks any questions about the business, services, products, contact details, or other relevant information that requires accessing the business wiki to provide accurate and up-to-date information.',
  provider: 'RETELL', // Retell is the only backing voice provider observed; not IR-settable.
  translation: { enabled: false, language: null },
  beginMessageDelayMs: 0,
  welcomeMessageMode: 'ai_custom',
  responsiveness: 1,
  endCallAfterSilenceMs: 15000,
  ringDurationSeconds: 5,
  sttMode: 'accurate',
  customSttConfig: null,
  normalizeForSpeech: true,
  ambientSoundVolume: 1,
  enableDynamicVoiceSpeed: false,
  enableDynamicResponsiveness: false,
  vocabSpecialization: 'general',
  boostedKeywords: [],
  pronunciationDictionary: [],
  enableBackchannel: false,
  backchannelFrequency: null,
  backchannelWords: [],
  denoisingMode: 'noise-cancellation',
  voicemailOption: null,
  ivrOption: null,
  aiDisclaimerConfiguration: {
    disclaimerEnabled: true,
    outboundIntentMessage: '',
    outboundDisclaimerType: 'concise',
    outboundDisclaimerMessage: "Hi {{contact.first_name}}, this is GROM Digital AU's AI assistant. You can say, 'Don't call me again,' to opt out.",
    playDisclaimerOnEveryCall: true,
  },
  prompts: {},
  noResponseConfig: { enabled: false, keywords: [] },
  welcomeMessage: '',
  businessName: '',
  timezone: '',
};

// NOTE on `contactFieldActions`: voiceai-update-identity.json's requestBody includes
// a top-level `contactFieldActions: []` key that voiceai-update-behavior-
// transcription-voice.json's requestBody does NOT include (all 54 other keys are
// identical between the two captures). Actions are documented as a wholly separate
// resource (POST /voice-ai/actions — see voiceai-action.json's followUpAgentSave
// note: the agent PUT "contains no action-related fields at all"), so this
// inconsistent, action-shaped key is treated as non-canonical noise from the builder
// UI rather than a required part of the wire body, and is intentionally NOT emitted
// by buildUpdateBody below.

// Build the full PUT body for /voice-ai/agents/:agentId?publishAgent=true&mode=update.
// Field names/nesting trace 1:1 to the flat top-level keys shared by BOTH update
// captures. `ir` must already be normalized (parseVoiceAiIR).
function buildUpdateBody(ir, { locationId } = {}) {
  const voice = ir.voice ?? {};
  const behavior = ir.behavior ?? {};
  const transcription = ir.transcription ?? {};
  const callSettings = ir.callSettings ?? {};
  const postCall = ir.postCall ?? {};
  const outbound = ir.outbound ?? {};
  const kb = ir.knowledgeBase ?? {};
  const translation = ir.translation ?? {};
  const noResponseConfig = ir.noResponseConfig ?? {};

  const enableBackchannel = behavior.enableBackchannel ?? DEFAULTS.enableBackchannel;
  // backchannelFrequency has no UI slider: per voiceai-update-behavior-
  // transcription-voice.json's note, the frontend assigns a fixed 0.8 the moment
  // enableBackchannel is toggled on (it was null before). Replicate that so an IR
  // that just sets behavior.enableBackchannel=true matches what the real builder
  // would have sent.
  const backchannelFrequency = behavior.backchannelFrequency ?? (enableBackchannel ? 0.8 : DEFAULTS.backchannelFrequency);

  return {
    agentName: ir.agentName,
    welcomeMessage: ir.welcomeMessage ?? DEFAULTS.welcomeMessage,
    voiceId: voice.voiceId ?? DEFAULTS.voiceId,
    voiceModel: voice.voiceModel ?? DEFAULTS.voiceModel,
    language: callSettings.language ?? DEFAULTS.language,
    locationId,
    businessName: ir.businessName ?? DEFAULTS.businessName,
    inboundPhoneNumber: outbound.inboundPhoneNumber ?? DEFAULTS.inboundPhoneNumber,
    inboundNumbers: outbound.inboundNumbers ?? DEFAULTS.inboundNumbers,
    numberPoolId: outbound.numberPoolId ?? DEFAULTS.numberPoolId,
    agentPrompt: ir.agentPrompt,
    callEndWorkflowIds: postCall.callEndWorkflowIds ?? DEFAULTS.callEndWorkflowIds,
    advancedSettingsEnabled: ir.advancedSettingsEnabled ?? DEFAULTS.advancedSettingsEnabled,
    sendPostCallNotificationTo: postCall.sendPostCallNotificationTo ?? DEFAULTS.sendPostCallNotificationTo,
    agentWorkingHours: ir.agentWorkingHours ?? DEFAULTS.agentWorkingHours,
    maxCallDuration: callSettings.maxCallDuration ?? DEFAULTS.maxCallDuration,
    voiceTemperature: voice.voiceTemperature ?? DEFAULTS.voiceTemperature,
    voiceSpeed: voice.voiceSpeed ?? DEFAULTS.voiceSpeed,
    voiceVolume: voice.voiceVolume ?? DEFAULTS.voiceVolume,
    modelTemperature: behavior.modelTemperature ?? DEFAULTS.modelTemperature,
    backgroundSound: voice.backgroundSound ?? DEFAULTS.backgroundSound,
    reminderFrequency: callSettings.reminderFrequency ?? DEFAULTS.reminderFrequency,
    sendUserIdleReminders: callSettings.sendUserIdleReminders ?? DEFAULTS.sendUserIdleReminders,
    reminderAfterIdleTimeSeconds: callSettings.reminderAfterIdleTimeSeconds ?? DEFAULTS.reminderAfterIdleTimeSeconds,
    interruptionSensitivity: behavior.interruptionSensitivity ?? DEFAULTS.interruptionSensitivity,
    isAgentAsBackupDisabled: ir.isAgentAsBackupDisabled ?? DEFAULTS.isAgentAsBackupDisabled,
    timezone: ir.timezone ?? DEFAULTS.timezone,
    llmModel: ir.llmModel ?? DEFAULTS.llmModel,
    knowledgeBaseIds: kb.knowledgeBaseIds ?? DEFAULTS.knowledgeBaseIds,
    knowledgeBasePrompt: kb.knowledgeBasePrompt ?? DEFAULTS.knowledgeBasePrompt,
    provider: DEFAULTS.provider,
    translation: {
      enabled: translation.enabled ?? DEFAULTS.translation.enabled,
      language: translation.language ?? DEFAULTS.translation.language,
    },
    beginMessageDelayMs: ir.beginMessageDelayMs ?? DEFAULTS.beginMessageDelayMs,
    welcomeMessageMode: ir.welcomeMessageMode ?? DEFAULTS.welcomeMessageMode,
    responsiveness: behavior.responsiveness ?? DEFAULTS.responsiveness,
    endCallAfterSilenceMs: callSettings.endCallAfterSilenceMs ?? DEFAULTS.endCallAfterSilenceMs,
    ringDurationSeconds: callSettings.ringDurationSeconds ?? DEFAULTS.ringDurationSeconds,
    sttMode: transcription.sttMode ?? DEFAULTS.sttMode,
    customSttConfig: transcription.customSttConfig ?? DEFAULTS.customSttConfig,
    normalizeForSpeech: voice.normalizeForSpeech ?? DEFAULTS.normalizeForSpeech,
    ambientSoundVolume: voice.ambientSoundVolume ?? DEFAULTS.ambientSoundVolume,
    enableDynamicVoiceSpeed: voice.enableDynamicVoiceSpeed ?? DEFAULTS.enableDynamicVoiceSpeed,
    enableDynamicResponsiveness: behavior.enableDynamicResponsiveness ?? DEFAULTS.enableDynamicResponsiveness,
    vocabSpecialization: transcription.vocabSpecialization ?? DEFAULTS.vocabSpecialization,
    boostedKeywords: transcription.boostedKeywords ?? DEFAULTS.boostedKeywords,
    pronunciationDictionary: transcription.pronunciationDictionary ?? DEFAULTS.pronunciationDictionary,
    enableBackchannel,
    backchannelFrequency,
    backchannelWords: behavior.backchannelWords ?? DEFAULTS.backchannelWords,
    denoisingMode: voice.denoisingMode ?? DEFAULTS.denoisingMode,
    voicemailOption: outbound.voicemailOption ?? DEFAULTS.voicemailOption,
    ivrOption: outbound.ivrOption ?? DEFAULTS.ivrOption,
    aiDisclaimerConfiguration: outbound.aiDisclaimerConfiguration ?? DEFAULTS.aiDisclaimerConfiguration,
    prompts: ir.prompts ?? DEFAULTS.prompts,
    noResponseConfig: {
      enabled: noResponseConfig.enabled ?? DEFAULTS.noResponseConfig.enabled,
      keywords: noResponseConfig.keywords ?? DEFAULTS.noResponseConfig.keywords,
    },
  };
}

// --- Verified actionType actionParameters builders --------------------------------
// Ground truth: research/ai-agents-internal/captures/voiceai-actions-all.json
// (captured 2026-07-11, POST /voice-ai/actions against a real test agent). CALL_TRANSFER
// (already live-verified pre-existing) stays pure passthrough below; each of these 6
// newly-captured types validates its capture-required fields and merges the caller's
// actionParameters over any capture-grounded defaults.

function assertRequiredParam(v, field, type) {
  if (typeof v !== 'string' || v.length === 0) {
    throw new IRError(
      'SCHEMA',
      `${type} action.actionParameters.${field} is required (API-required per voiceai-actions-all.json), got: ${JSON.stringify(v)}`,
    );
  }
}

// WORKFLOW_TRIGGER ("Trigger a workflow"): all 4 fields travel together in the capture's
// fullCapturedRequestBody and are called out as required by the task spec — none has a
// sane default (they're all user-authored trigger copy or a specific workflow id).
function buildWorkflowTriggerParams(p) {
  assertRequiredParam(p.workflowId, 'workflowId', 'WORKFLOW_TRIGGER');
  assertRequiredParam(p.triggerPrompt, 'triggerPrompt', 'WORKFLOW_TRIGGER');
  assertRequiredParam(p.triggerMessage, 'triggerMessage', 'WORKFLOW_TRIGGER');
  assertRequiredParam(p.triggerMessageType, 'triggerMessageType', 'WORKFLOW_TRIGGER');
  return { ...p };
}

// SMS ("Send SMS"): messageBody is the capture's one required-fields-list entry beyond
// name (top-level, already validated).
function buildSmsParams(p) {
  assertRequiredParam(p.messageBody, 'messageBody', 'SMS');
  return { ...p };
}

// DATA_EXTRACTION ("Update contact field"): contactFieldId/contactFieldKey identify the
// field to write; contactFieldDataType distinguishes STANDARD_FIELD vs (presumably)
// CUSTOM_FIELD. No defaults observed — all three are tied to whichever field the caller
// picked, nothing sane to default.
function buildDataExtractionParams(p) {
  assertRequiredParam(p.contactFieldId, 'contactFieldId', 'DATA_EXTRACTION');
  assertRequiredParam(p.contactFieldKey, 'contactFieldKey', 'DATA_EXTRACTION');
  assertRequiredParam(p.contactFieldDataType, 'contactFieldDataType', 'DATA_EXTRACTION');
  return { ...p };
}

// APPOINTMENT_BOOKING: only calendarId gated the "Pick a Calendar" step per the capture's
// requiredFields. Every other field is a booking/appointment-management toggle, defaulted
// to its captured value.
const APPOINTMENT_BOOKING_PARAM_DEFAULTS = {
  calendarIds: null,
  aiDescription: null,
  fallbackCalendar: false,
  fallbackCalendarId: null,
  calendarActionType: 'single',
  daysOfOfferingDates: 3,
  slotsPerDay: 3,
  hoursBetweenSlots: 3,
  collectName: false,
  collectEmail: true,
  collectAddress: false,
  collectAdditionalNotes: false,
  collectPhoneNumber: false,
  onlyShareBookingLink: false,
  respectCalendarAutoConfirm: false,
  cancelEnabled: false,
  rescheduleEnabled: false,
  timezoneSelection: 'userAgent',
  fallbackTimezone: 'askUser',
};

// Multi-calendar (intent-based routing). GROUND TRUTH:
// research/ai-agents-internal/captures/voice-multi-calendar-shape.json (live UI
// multi-select save, 2026-07-18). Ticking a 2nd calendar flips the action single->multiple:
// calendarId becomes null; calendarIds becomes an ARRAY OF OBJECTS {id, triggerCondition}
// (one routing condition per calendar — NOT Conversation AI's flat id array); aiDescription
// is the overall intent-routing text; fallbackCalendar/fallbackCalendarId pick the calendar
// for the no-match case. The server echoes back a per-item `slug` (and the public
// voice-ai-v3 MCP additionally demands a `name` per item) — the internal PUT this compiler
// targets wants NEITHER, so each item is normalized to exactly {id, triggerCondition}.
function normalizeCalendarItem(c, i) {
  if (!c || typeof c !== 'object' || Array.isArray(c))
    throw new IRError('SCHEMA', `APPOINTMENT_BOOKING calendarIds[${i}] must be an object { id, triggerCondition }, got: ${JSON.stringify(c)}`);
  if (typeof c.id !== 'string' || c.id.length === 0)
    throw new IRError('SCHEMA', `APPOINTMENT_BOOKING calendarIds[${i}].id is required (non-empty string)`);
  if (typeof c.triggerCondition !== 'string' || c.triggerCondition.length === 0)
    throw new IRError('SCHEMA', `APPOINTMENT_BOOKING calendarIds[${i}].triggerCondition is required (non-empty string, <=80 chars)`);
  if (c.triggerCondition.length > 80)
    throw new IRError('SCHEMA', `APPOINTMENT_BOOKING calendarIds[${i}].triggerCondition must be <=80 chars, got ${c.triggerCondition.length}`);
  return { id: c.id, triggerCondition: c.triggerCondition };   // drop server-added slug/name
}

function buildMultiCalendarBooking(p) {
  if (!Array.isArray(p.calendarIds) || p.calendarIds.length < 2)
    throw new IRError('SCHEMA',
      `APPOINTMENT_BOOKING multi-calendar (calendarActionType:'multiple') requires calendarIds: an array of >=2 { id, triggerCondition } items, got: ${JSON.stringify(p.calendarIds)}`);
  const calendarIds = p.calendarIds.map(normalizeCalendarItem);
  assertRequiredParam(p.aiDescription, 'aiDescription', 'APPOINTMENT_BOOKING');
  if (p.aiDescription.length > 500)
    throw new IRError('SCHEMA', `APPOINTMENT_BOOKING aiDescription must be <=500 chars, got ${p.aiDescription.length}`);
  const fallbackCalendar = p.fallbackCalendar ?? false;
  let fallbackCalendarId = p.fallbackCalendarId ?? null;
  if (fallbackCalendar === true) {
    assertRequiredParam(p.fallbackCalendarId, 'fallbackCalendarId', 'APPOINTMENT_BOOKING');
    const ids = calendarIds.map((c) => c.id);
    if (!ids.includes(p.fallbackCalendarId))
      throw new IRError('SCHEMA',
        `APPOINTMENT_BOOKING fallbackCalendarId '${p.fallbackCalendarId}' must be one of the calendarIds ids [${ids.join(', ')}]`);
    fallbackCalendarId = p.fallbackCalendarId;
  }
  return {
    ...APPOINTMENT_BOOKING_PARAM_DEFAULTS,
    ...p,
    calendarId: null,
    calendarIds,
    calendarActionType: 'multiple',
    aiDescription: p.aiDescription,
    fallbackCalendar,
    fallbackCalendarId,
  };
}

function buildAppointmentBookingParams(p) {
  // Multi mode is signalled by calendarActionType:'multiple' OR simply a non-empty
  // calendarIds array; single mode still gates on calendarId as before.
  const isMulti = p.calendarActionType === 'multiple' || (Array.isArray(p.calendarIds) && p.calendarIds.length > 0);
  if (isMulti) return buildMultiCalendarBooking(p);
  assertRequiredParam(p.calendarId, 'calendarId', 'APPOINTMENT_BOOKING');
  return { ...APPOINTMENT_BOOKING_PARAM_DEFAULTS, ...p };
}

// CAP ("Custom Action 2.0" / Custom Action Plugin): capActionId references a separately-
// created custom-action resource; triggerPrompt/triggerMessage are the two other
// required-fields-list entries. The capture's Save button additionally requires a
// successful test-webhook run (not something this offline compiler can verify), and the
// endpoint must be https — validated here on the one field this compiler can see
// (schemaValues.requestBodyValues.webhookUrl.value). capActionName is a fixed literal for
// this action family, defaulted below when omitted.
function buildCapParams(p) {
  assertRequiredParam(p.capActionId, 'capActionId', 'CAP');
  assertRequiredParam(p.triggerPrompt, 'triggerPrompt', 'CAP');
  assertRequiredParam(p.triggerMessage, 'triggerMessage', 'CAP');
  const webhookUrl = p.schemaValues?.requestBodyValues?.webhookUrl?.value;
  if (typeof webhookUrl !== 'string' || !webhookUrl.startsWith('https://')) {
    throw new IRError(
      'SCHEMA',
      `CAP action.actionParameters.schemaValues.requestBodyValues.webhookUrl.value must be an https:// URL (API-required per voiceai-actions-all.json), got: ${JSON.stringify(webhookUrl)}`,
    );
  }
  return { capActionName: 'customApi', ...p };
}

// AGENT_TRANSFER_CHILD ("Agent Transfer"): destinationAgentMongoId (the target Voice AI
// agent) + triggerPrompt are the capture's requiredFields. speakDuringExecution /
// triggerWorkflowsPostCall default to the capture's observed values.
function buildAgentTransferChildParams(p) {
  assertRequiredParam(p.destinationAgentMongoId, 'destinationAgentMongoId', 'AGENT_TRANSFER_CHILD');
  assertRequiredParam(p.triggerPrompt, 'triggerPrompt', 'AGENT_TRANSFER_CHILD');
  return {
    speakDuringExecution: false,
    triggerWorkflowsPostCall: true,
    ...p,
  };
}

// Dispatch on actionType. CALL_TRANSFER and any other unlisted actionType (e.g. the
// unverified "Add MCP (Beta)") stay pure passthrough — no defaults injected.
function buildActionParameters(action) {
  const p = action.actionParameters ?? {};
  switch (action.actionType) {
    case 'WORKFLOW_TRIGGER': return buildWorkflowTriggerParams(p);
    case 'SMS': return buildSmsParams(p);
    case 'DATA_EXTRACTION': return buildDataExtractionParams(p);
    case 'APPOINTMENT_BOOKING': return buildAppointmentBookingParams(p);
    case 'CAP': return buildCapParams(p);
    case 'AGENT_TRANSFER_CHILD': return buildAgentTransferChildParams(p);
    default: return p;
  }
}

// POST /voice-ai/actions — body: {agentId, actionType, locationId, name,
// actionParameters} (voiceai-action.json's createAction.requestBody). `agentId`
// defaults to null: at the point compileVoiceAiAgent() assembles these, the agent
// does not exist yet (its id is server-assigned on the create response) — the
// orchestrator must patch the real id into each action body after issuing the
// create request, before POSTing the actions. Call this directly with a known
// `agentId` to compile an action against an already-existing agent (e.g. when
// adding an action during an update flow).
export function compileVoiceAiAction(action, { agentId = null, locationId } = {}) {
  if (!action || typeof action !== 'object') throw new IRError('SCHEMA', 'action must be an object');
  if (typeof action.actionType !== 'string' || !action.actionType) throw new IRError('SCHEMA', 'action.actionType is required');
  if (typeof action.name !== 'string' || !action.name) throw new IRError('SCHEMA', 'action.name is required');
  if (action.actionParameters !== undefined && (typeof action.actionParameters !== 'object' || action.actionParameters === null))
    throw new IRError('SCHEMA', 'action.actionParameters must be an object when present');
  const body = {
    agentId,
    actionType: action.actionType,
    locationId,
    name: action.name,
    actionParameters: buildActionParameters(action),
  };
  return { method: 'POST', path: '/voice-ai/actions', body };
}

// POST /voice-ai/agents — create. Per voiceai-create.json the body is JUST
// `{ locationId }`; the backend auto-generates the default agent doc and returns
// its id. Returns the create descriptor plus the (agentId-less) action descriptors
// for anything in ir.actions[] — the caller must patch in the real agentId (from
// the create response) before POSTing each action, then follow up with
// compileVoiceAiUpdate to push the rest of the IR's configuration via full-replace.
export function compileVoiceAiAgent(ir, { locationId } = {}) {
  const norm = parseVoiceAiIR(ir);
  const create = { method: 'POST', path: '/voice-ai/agents', body: { locationId } };
  const actions = (norm.actions ?? []).map((a) => compileVoiceAiAction(a, { agentId: null, locationId }));
  return { create, actions, authHeader: AUTH_HEADER };
}

// PUT /voice-ai/agents/:agentId?publishAgent=true&mode=update — FULL REPLACE (see
// the module header). `fullIr` must be a complete Voice AI IR, not a partial one:
// any field it omits is filled with the stable default from DEFAULTS above, which
// will silently clobber a differing live value. Reconciling the IR with the
// server's current document (via a prior GET) is the caller's responsibility.
export function compileVoiceAiUpdate(fullIr, { agentId, locationId } = {}) {
  if (!agentId) throw new IRError('MISSING_FIELD', 'compileVoiceAiUpdate requires agentId');
  const norm = parseVoiceAiIR(fullIr);
  const body = buildUpdateBody(norm, { locationId });
  return {
    method: 'PUT',
    path: `/voice-ai/agents/${agentId}?publishAgent=true&mode=update`,
    body,
    authHeader: AUTH_HEADER,
  };
}
