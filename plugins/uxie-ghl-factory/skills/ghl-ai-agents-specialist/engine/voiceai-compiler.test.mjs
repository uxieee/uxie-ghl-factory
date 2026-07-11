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
