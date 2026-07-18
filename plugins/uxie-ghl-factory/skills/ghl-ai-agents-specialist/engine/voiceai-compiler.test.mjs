import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileVoiceAiAgent, compileVoiceAiAction, compileVoiceAiUpdate, AUTH_HEADER } from './voiceai-compiler.mjs';
import { IRError } from './voiceai-ir.mjs';

const LOCATION_ID = 'wdzEoUZnXO9tB3PPzcot';
const AGENT_ID = '6a5222c8dd665059e500fa6c';

// --- compileVoiceAiAgent (POST /voice-ai/agents) ---------------------------------

test('compileVoiceAiAgent: create body matches voiceai-create.json exactly ({ locationId } only)', () => {
  const ir = { agentName: 'Placeholder', agentPrompt: 'Placeholder prompt.' };
  const { create, authHeader } = compileVoiceAiAgent(ir, { locationId: LOCATION_ID });
  assert.equal(create.method, 'POST');
  assert.equal(create.path, '/voice-ai/agents');
  assert.deepEqual(create.body, { locationId: LOCATION_ID });
  assert.equal(authHeader, 'token-id');
  assert.equal(AUTH_HEADER, 'token-id');
});

test('compileVoiceAiAgent: rejects invalid IR even though create body barely uses it (missing agentPrompt)', () => {
  assert.throws(() => compileVoiceAiAgent({ agentName: 'X' }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileVoiceAiAgent: action list compiled into separate actions[] descriptors with agentId null', () => {
  const ir = {
    agentName: 'Placeholder',
    agentPrompt: 'Placeholder prompt.',
    actions: [{ actionType: 'CALL_TRANSFER', name: 'TEST Transfer', actionParameters: { transferToValue: '+15551234567' } }],
  };
  const { create, actions } = compileVoiceAiAgent(ir, { locationId: LOCATION_ID });
  assert.deepEqual(create.body, { locationId: LOCATION_ID });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].method, 'POST');
  assert.equal(actions[0].path, '/voice-ai/actions');
  assert.equal(actions[0].body.agentId, null);
  assert.equal(actions[0].body.locationId, LOCATION_ID);
});

// --- compileVoiceAiAction (POST /voice-ai/actions) -------------------------------

// Matches captures/voiceai-action.json's createAction.requestBody field-for-field.
test('compileVoiceAiAction: CALL_TRANSFER matches voiceai-action.json shape', () => {
  const action = {
    actionType: 'CALL_TRANSFER',
    name: 'TEST Transfer',
    actionParameters: {
      triggerPrompt: 'If the caller asks to speak with a human agent',
      triggerMessage: 'Please hold while I transfer your call.',
      triggerMessageType: 'static_text',
      transferToType: 'number',
      transferToValue: '+15551234567',
      hearWhisperMessage: false,
    },
  };
  const { method, path, body } = compileVoiceAiAction(action, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.equal(method, 'POST');
  assert.equal(path, '/voice-ai/actions');
  assert.deepEqual(body, {
    agentId: AGENT_ID,
    actionType: 'CALL_TRANSFER',
    locationId: LOCATION_ID,
    name: 'TEST Transfer',
    actionParameters: action.actionParameters,
  });
});

test('compileVoiceAiAction: rejects missing actionType/name', () => {
  assert.throws(() => compileVoiceAiAction({ name: 'X' }, { locationId: LOCATION_ID }), (e) => e.code === 'SCHEMA');
  assert.throws(() => compileVoiceAiAction({ actionType: 'CALL_TRANSFER' }, { locationId: LOCATION_ID }), (e) => e.code === 'SCHEMA');
});

test('compileVoiceAiAction: actionParameters defaults to {} when omitted', () => {
  const { body } = compileVoiceAiAction({ actionType: 'CALL_TRANSFER', name: 'X' }, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.actionParameters, {});
});

test('compileVoiceAiAction: unverified actionType (MCP) stays pure passthrough', () => {
  const { body } = compileVoiceAiAction(
    { actionType: 'MCP', name: 'Connect MCP', actionParameters: { someField: 'x' } },
    { agentId: AGENT_ID, locationId: LOCATION_ID },
  );
  assert.deepEqual(body.actionParameters, { someField: 'x' });
});

// --- Newly verified action types: voiceai-actions-all.json -----------------------

// WORKFLOW_TRIGGER
test('compileVoiceAiAction: WORKFLOW_TRIGGER matches voiceai-actions-all.json shape', () => {
  const action = {
    actionType: 'WORKFLOW_TRIGGER',
    name: 'Test Workflow Trigger',
    actionParameters: {
      triggerPrompt: 'User asks to test the workflow trigger',
      triggerMessage: 'I have triggered the test workflow.',
      triggerMessageType: 'static_text',
      workflowId: '76b6ce98-dd6e-4e4d-aaff-bd58369fe18b',
    },
  };
  const { body } = compileVoiceAiAction(action, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.actionParameters, action.actionParameters);
});

test('compileVoiceAiAction: WORKFLOW_TRIGGER rejects missing workflowId', () => {
  assert.throws(
    () => compileVoiceAiAction(
      { actionType: 'WORKFLOW_TRIGGER', name: 'Trigger', actionParameters: { triggerPrompt: 'x', triggerMessage: 'y', triggerMessageType: 'static_text' } },
      { locationId: LOCATION_ID },
    ),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

// SMS
test('compileVoiceAiAction: SMS matches voiceai-actions-all.json shape', () => {
  const action = {
    actionType: 'SMS',
    name: 'Test Send SMS',
    actionParameters: {
      triggerPrompt: 'User asks for a test SMS',
      triggerMessage: 'I have sent you a test SMS.',
      triggerMessageType: 'static_text',
      messageBody: 'This is a test SMS message.',
    },
  };
  const { body } = compileVoiceAiAction(action, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.actionParameters, action.actionParameters);
});

test('compileVoiceAiAction: SMS rejects missing messageBody', () => {
  assert.throws(
    () => compileVoiceAiAction({ actionType: 'SMS', name: 'Send SMS', actionParameters: {} }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

// DATA_EXTRACTION
test('compileVoiceAiAction: DATA_EXTRACTION matches voiceai-actions-all.json shape', () => {
  const action = {
    actionType: 'DATA_EXTRACTION',
    name: 'Test Update Contact Field',
    actionParameters: {
      contactFieldId: 'UEmlm3vvvvht5bybXxTv',
      description: 'The company name of the caller',
      contactFieldName: 'Business Name',
      contactFieldDataType: 'STANDARD_FIELD',
      contactFieldKey: 'contact.company_name',
      actionType: 'DATA_EXTRACTION',
      examples: ['Acme Corporation', 'Tech Solutions Inc'],
      overwriteExistingValue: false,
      saveAsAdditional: true,
    },
  };
  const { body } = compileVoiceAiAction(action, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.actionParameters, action.actionParameters);
});

test('compileVoiceAiAction: DATA_EXTRACTION rejects missing contactFieldKey', () => {
  assert.throws(
    () => compileVoiceAiAction(
      { actionType: 'DATA_EXTRACTION', name: 'Update field', actionParameters: { contactFieldId: 'f1', contactFieldDataType: 'STANDARD_FIELD' } },
      { locationId: LOCATION_ID },
    ),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

// APPOINTMENT_BOOKING
test('compileVoiceAiAction: APPOINTMENT_BOOKING matches voiceai-actions-all.json shape', () => {
  const action = {
    actionType: 'APPOINTMENT_BOOKING',
    name: 'Appointment Booking Action',
    actionParameters: { calendarId: '3KIkHmnkrlhfpN9nORu4' },
  };
  const { body } = compileVoiceAiAction(action, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.actionParameters, {
    calendarId: '3KIkHmnkrlhfpN9nORu4',
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
  });
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING rejects missing calendarId', () => {
  assert.throws(
    () => compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: {} }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

// APPOINTMENT_BOOKING — native multi-calendar (intent-based routing).
// GROUND TRUTH: factory-findings-2026-07-18/voice-multi-calendar-shape.json (live UI
// multi-select save, network-sniffed PUT). Multi mode sends calendarId:null +
// calendarActionType:'multiple' + calendarIds:[{id,triggerCondition}] + aiDescription
// + optional fallbackCalendar/fallbackCalendarId. The two calendarIds strings below are
// the exact triggerConditions from the capture.
const MULTI_CAL_INPUT = {
  calendarActionType: 'multiple',
  calendarIds: [
    { id: 'SHVoCOKWiXBHBgluDEm6', triggerCondition: 'Booking the BioRePeel and microneedling treatment session or appointment' },
    { id: 'tICTbR20mIua5ijoa5gJ', triggerCondition: 'Joining the Advanced Skin Specialist training course, the two-day cohort' },
  ],
  aiDescription: 'Route treatment bookings to the treatment calendar and course enrolments to the course cohort calendar.',
  fallbackCalendar: true,
  fallbackCalendarId: 'SHVoCOKWiXBHBgluDEm6',
};

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi-calendar byte-matches voice-multi-calendar-shape.json', () => {
  const action = { actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: MULTI_CAL_INPUT };
  const { body } = compileVoiceAiAction(action, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.actionParameters, {
    calendarId: null,
    calendarIds: [
      { id: 'SHVoCOKWiXBHBgluDEm6', triggerCondition: 'Booking the BioRePeel and microneedling treatment session or appointment' },
      { id: 'tICTbR20mIua5ijoa5gJ', triggerCondition: 'Joining the Advanced Skin Specialist training course, the two-day cohort' },
    ],
    aiDescription: 'Route treatment bookings to the treatment calendar and course enrolments to the course cohort calendar.',
    fallbackCalendar: true,
    fallbackCalendarId: 'SHVoCOKWiXBHBgluDEm6',
    calendarActionType: 'multiple',
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
  });
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi mode is entered by a non-empty calendarIds array even without calendarActionType', () => {
  const p = { ...MULTI_CAL_INPUT };
  delete p.calendarActionType;
  const { body } = compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.equal(body.actionParameters.calendarActionType, 'multiple');
  assert.equal(body.actionParameters.calendarId, null);
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi does NOT require calendarId', () => {
  assert.doesNotThrow(() =>
    compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: MULTI_CAL_INPUT }, { agentId: AGENT_ID, locationId: LOCATION_ID }));
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi strips the server-added slug/name from each calendarIds item', () => {
  const p = {
    ...MULTI_CAL_INPUT,
    calendarIds: MULTI_CAL_INPUT.calendarIds.map((c, i) => ({ ...c, slug: `slug_${i}`, name: `Name ${i}` })),
  };
  const { body } = compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.actionParameters.calendarIds, MULTI_CAL_INPUT.calendarIds);
  for (const c of body.actionParameters.calendarIds) assert.deepEqual(Object.keys(c), ['id', 'triggerCondition']);
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi rejects fewer than 2 calendars', () => {
  const p = { calendarActionType: 'multiple', calendarIds: [MULTI_CAL_INPUT.calendarIds[0]], aiDescription: 'x' };
  assert.throws(() => compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi rejects an empty or missing triggerCondition', () => {
  const p = { calendarActionType: 'multiple', aiDescription: 'x', calendarIds: [{ id: 'a', triggerCondition: '' }, { id: 'b', triggerCondition: 'ok' }] };
  assert.throws(() => compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi rejects a triggerCondition over 80 chars', () => {
  const p = { calendarActionType: 'multiple', aiDescription: 'x', calendarIds: [{ id: 'a', triggerCondition: 'y'.repeat(81) }, { id: 'b', triggerCondition: 'ok' }] };
  assert.throws(() => compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi rejects a missing aiDescription', () => {
  const p = { calendarActionType: 'multiple', calendarIds: MULTI_CAL_INPUT.calendarIds };
  assert.throws(() => compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi rejects an aiDescription over 500 chars', () => {
  const p = { calendarActionType: 'multiple', calendarIds: MULTI_CAL_INPUT.calendarIds, aiDescription: 'z'.repeat(501) };
  assert.throws(() => compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi rejects fallbackCalendar:true with no fallbackCalendarId', () => {
  const p = { ...MULTI_CAL_INPUT }; delete p.fallbackCalendarId;
  assert.throws(() => compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi rejects a fallbackCalendarId not among the calendarIds', () => {
  const p = { ...MULTI_CAL_INPUT, fallbackCalendarId: 'NOT_IN_LIST' };
  assert.throws(() => compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileVoiceAiAction: APPOINTMENT_BOOKING multi without fallback leaves fallbackCalendar:false', () => {
  const p = { calendarActionType: 'multiple', calendarIds: MULTI_CAL_INPUT.calendarIds, aiDescription: 'Route bookings.' };
  const { body } = compileVoiceAiAction({ actionType: 'APPOINTMENT_BOOKING', name: 'Book', actionParameters: p }, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.equal(body.actionParameters.fallbackCalendar, false);
  assert.equal(body.actionParameters.fallbackCalendarId, null);
});

// CAP
test('compileVoiceAiAction: CAP matches voiceai-actions-all.json shape', () => {
  const action = {
    actionType: 'CAP',
    name: 'test_custom_action',
    actionParameters: {
      capActionId: 'I0WfHWKUfajTT9akCbsM',
      triggerPrompt: 'When the user asks to test the custom action',
      triggerMessage: 'Please wait while I test this action.',
      schemaValues: {
        paramsValues: {},
        requestBodyValues: {
          webhookUrl: { value: 'https://httpbin.org/post', mode: 'manual' },
          httpMethod: { value: 'POST', mode: 'manual' },
          headers: { value: { 'Content-Type': 'application/json' }, mode: 'manual' },
          apiTimeout: { value: 10, mode: 'manual' },
          retryOnFailure: { value: false, mode: 'manual' },
        },
      },
    },
  };
  const { body } = compileVoiceAiAction(action, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.equal(body.actionParameters.capActionName, 'customApi');
  assert.equal(body.actionParameters.capActionId, 'I0WfHWKUfajTT9akCbsM');
  assert.deepEqual(body.actionParameters.schemaValues, action.actionParameters.schemaValues);
});

test('compileVoiceAiAction: CAP rejects missing capActionId', () => {
  assert.throws(
    () => compileVoiceAiAction(
      {
        actionType: 'CAP', name: 'test_custom_action',
        actionParameters: {
          triggerPrompt: 'x', triggerMessage: 'y',
          schemaValues: { requestBodyValues: { webhookUrl: { value: 'https://httpbin.org/post' } } },
        },
      },
      { locationId: LOCATION_ID },
    ),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

test('compileVoiceAiAction: CAP rejects a non-https webhookUrl', () => {
  assert.throws(
    () => compileVoiceAiAction(
      {
        actionType: 'CAP', name: 'test_custom_action',
        actionParameters: {
          capActionId: 'cap1', triggerPrompt: 'x', triggerMessage: 'y',
          schemaValues: { requestBodyValues: { webhookUrl: { value: 'http://insecure.example.com' } } },
        },
      },
      { locationId: LOCATION_ID },
    ),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

// AGENT_TRANSFER_CHILD
test('compileVoiceAiAction: AGENT_TRANSFER_CHILD matches voiceai-actions-all.json shape', () => {
  const action = {
    actionType: 'AGENT_TRANSFER_CHILD',
    name: 'transfer_finn_0',
    actionParameters: {
      destinationAgentMongoId: '69f8484fee4ecaa5d657c45d',
      triggerPrompt: 'If the user asks to speak with Finn, transfer the call.',
    },
  };
  const { body } = compileVoiceAiAction(action, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.actionParameters, {
    speakDuringExecution: false,
    triggerWorkflowsPostCall: true,
    destinationAgentMongoId: '69f8484fee4ecaa5d657c45d',
    triggerPrompt: 'If the user asks to speak with Finn, transfer the call.',
  });
});

test('compileVoiceAiAction: AGENT_TRANSFER_CHILD rejects missing destinationAgentMongoId', () => {
  assert.throws(
    () => compileVoiceAiAction(
      { actionType: 'AGENT_TRANSFER_CHILD', name: 'transfer', actionParameters: { triggerPrompt: 'x' } },
      { locationId: LOCATION_ID },
    ),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

test('compileVoiceAiAction: AGENT_TRANSFER_CHILD lets caller override speakDuringExecution', () => {
  const { body } = compileVoiceAiAction(
    {
      actionType: 'AGENT_TRANSFER_CHILD', name: 'transfer',
      actionParameters: { destinationAgentMongoId: 'agent2', triggerPrompt: 'x', speakDuringExecution: true },
    },
    { agentId: AGENT_ID, locationId: LOCATION_ID },
  );
  assert.equal(body.actionParameters.speakDuringExecution, true);
});

// --- compileVoiceAiUpdate (PUT /voice-ai/agents/:id?publishAgent=true&mode=update) --

// Reproduces captures/voiceai-update-identity.json's requestBody exactly, MINUS
// `contactFieldActions` — that key appears in this capture but not in
// voiceai-update-behavior-transcription-voice.json's, so it's treated as
// non-canonical noise (see the compiler's comment) and intentionally not emitted.
test('compileVoiceAiUpdate: full-replace body matches voiceai-update-identity.json (minus contactFieldActions)', () => {
  const ir = {
    agentName: 'TEST-CAP-VOICEAI',
    agentPrompt: '<full system+role prompt text, unchanged from create-time default>',
    welcomeMessage: 'Hey, you have reached GROM Digital AU. How can I help you today?',
    businessName: 'GROM Digital AU',
    timezone: 'Australia/Perth',
  };
  const { method, path, body, authHeader } = compileVoiceAiUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.equal(method, 'PUT');
  assert.equal(path, `/voice-ai/agents/${AGENT_ID}?publishAgent=true&mode=update`);
  assert.equal(authHeader, 'token-id');
  assert.deepEqual(body, {
    agentName: 'TEST-CAP-VOICEAI',
    welcomeMessage: 'Hey, you have reached GROM Digital AU. How can I help you today?',
    voiceId: 'g6xIsTj2HwM6VR4iXFCw',
    voiceModel: 'auto',
    language: 'en-US',
    locationId: LOCATION_ID,
    businessName: 'GROM Digital AU',
    inboundPhoneNumber: null,
    inboundNumbers: [],
    numberPoolId: null,
    agentPrompt: '<full system+role prompt text, unchanged from create-time default>',
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
    timezone: 'Australia/Perth',
    llmModel: 'gpt-4.1',
    knowledgeBaseIds: null,
    knowledgeBasePrompt: 'Use this knowledge base if the user asks any questions about the business, services, products, contact details, or other relevant information that requires accessing the business wiki to provide accurate and up-to-date information.',
    provider: 'RETELL',
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
  });
  assert.equal('contactFieldActions' in body, false);
});

// Reproduces captures/voiceai-update-behavior-transcription-voice.json's
// requestBodyFull EXACTLY (all 54 keys, zero exceptions) — this capture is the
// second Save after toggling Enable Backchanneling + typing a boosted keyword, so
// it also exercises the backchannelFrequency auto-default (0.8 on enable) and the
// boostedKeywords passthrough.
test('compileVoiceAiUpdate: full-replace body matches voiceai-update-behavior-transcription-voice.json exactly', () => {
  const ir = {
    agentName: 'TEST-CAP-VOICEAI',
    agentPrompt: '<unchanged full prompt text>',
    welcomeMessage: 'Hey, you have reached GROM Digital AU. How can I help you today?',
    businessName: 'GROM Digital AU',
    timezone: 'Australia/Perth',
    transcription: { boostedKeywords: ['GROM Digital'] },
    behavior: { enableBackchannel: true },
  };
  const { body } = compileVoiceAiUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body, {
    agentName: 'TEST-CAP-VOICEAI',
    welcomeMessage: 'Hey, you have reached GROM Digital AU. How can I help you today?',
    voiceId: 'g6xIsTj2HwM6VR4iXFCw',
    voiceModel: 'auto',
    language: 'en-US',
    locationId: LOCATION_ID,
    businessName: 'GROM Digital AU',
    inboundPhoneNumber: null,
    inboundNumbers: [],
    numberPoolId: null,
    agentPrompt: '<unchanged full prompt text>',
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
    timezone: 'Australia/Perth',
    llmModel: 'gpt-4.1',
    knowledgeBaseIds: null,
    knowledgeBasePrompt: 'Use this knowledge base if the user asks any questions about the business, services, products, contact details, or other relevant information that requires accessing the business wiki to provide accurate and up-to-date information.',
    provider: 'RETELL',
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
    boostedKeywords: ['GROM Digital'],
    pronunciationDictionary: [],
    enableBackchannel: true,
    backchannelFrequency: 0.8,
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
  });
});

test('compileVoiceAiUpdate: backchannelFrequency stays null when enableBackchannel is not set', () => {
  const ir = { agentName: 'X', agentPrompt: 'Y' };
  const { body } = compileVoiceAiUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.equal(body.enableBackchannel, false);
  assert.equal(body.backchannelFrequency, null);
});

test('compileVoiceAiUpdate: explicit backchannelFrequency overrides the auto-default', () => {
  const ir = { agentName: 'X', agentPrompt: 'Y', behavior: { enableBackchannel: true, backchannelFrequency: 0.5 } };
  const { body } = compileVoiceAiUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.equal(body.backchannelFrequency, 0.5);
});

test('compileVoiceAiUpdate: requires agentId', () => {
  assert.throws(() => compileVoiceAiUpdate({ agentName: 'X', agentPrompt: 'Y' }, { locationId: LOCATION_ID }),
    (e) => e.code === 'MISSING_FIELD');
});

test('compileVoiceAiUpdate: rejects invalid IR (missing agentPrompt)', () => {
  assert.throws(() => compileVoiceAiUpdate({ agentName: 'X' }, { agentId: AGENT_ID, locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileVoiceAiUpdate: rejects invalid IR (bad denoisingMode) even in full-replace body', () => {
  const ir = { agentName: 'X', agentPrompt: 'Y', voice: { denoisingMode: 'bogus' } };
  assert.throws(() => compileVoiceAiUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID }),
    (e) => e.code === 'BAD_DENOISING_MODE');
});
