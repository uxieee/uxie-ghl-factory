// IR (intermediate representation) parser + invariant validator for Voice AI agents
// (Retell-backed phone agents). Traces to the captured schema in:
//   research/ai-agents-internal/voice-ai-internal.md
//   research/ai-agents-internal/captures/voiceai-{create,update-identity,
//     update-behavior-transcription-voice,action,delete}.json
// (ghl-workflow-api-docs repo). Field names here are a clean, section-grouped input
// shape (identity, voice, behavior, transcription, callSettings, postCall, outbound,
// knowledgeBase, translation); voiceai-compiler.mjs flattens them onto the exact GHL
// wire field names (agentName, voiceId, sttMode, etc). Mirrors convai-ir.mjs
// conventions — no deps, and the SAME IRError class (imported, not redefined) so
// callers can catch one error type across the whole engine.
import { IRError } from './convai-ir.mjs';
export { IRError };

// Only value ever observed live (voiceai-update-identity.json and
// voiceai-update-behavior-transcription-voice.json both send this same string).
// Not proven to be the only value the server accepts, but it's the only one this
// engine can vouch for — same epistemic stance as convai-ir.mjs's MODES/CHANNELS.
export const DENOISING_MODES = ['noise-cancellation'];

// voice-ai-internal.md: "sttMode (`accurate`/`fast`/custom)".
export const STT_MODES = ['accurate', 'fast', 'custom'];

// Only value ever observed live, on both update captures.
export const WELCOME_MESSAGE_MODES = ['ai_custom'];

// Only CALL_TRANSFER is live-verified (voiceai-action.json's captured POST
// /voice-ai/actions call). The other 7 builder menu items (Trigger a workflow, Send
// SMS, Update contact field, Appointment Booking, Custom Action 2.0, Agent Transfer,
// Add MCP) are NOT rejected here — they pass through as accepted-but-unverified, per
// voice-ai-internal.md's "Open items before engine build" note (#1: capture the
// remaining 7 action types).
export const VERIFIED_ACTION_TYPES = ['CALL_TRANSFER'];

function assertNonEmptyString(v, field) {
  if (typeof v !== 'string' || v.length === 0) throw new IRError('SCHEMA', `${field} must be a non-empty string`);
}

function assertObject(v, field) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new IRError('SCHEMA', `${field} must be an object`);
}

function assertStringIfPresent(v, field) {
  if (v !== undefined && v !== null && typeof v !== 'string') throw new IRError('SCHEMA', `${field} must be a string`);
}

function assertNumberIfPresent(v, field) {
  if (v !== undefined && v !== null && typeof v !== 'number') throw new IRError('SCHEMA', `${field} must be a number`);
}

function assertBooleanIfPresent(v, field) {
  if (v !== undefined && typeof v !== 'boolean') throw new IRError('SCHEMA', `${field} must be a boolean`);
}

function assertArrayIfPresent(v, field) {
  if (v !== undefined && v !== null && !Array.isArray(v)) throw new IRError('SCHEMA', `${field} must be an array`);
}

function checkVoice(voice) {
  if (voice === undefined) return;
  assertObject(voice, 'voice');
  assertStringIfPresent(voice.voiceId, 'voice.voiceId');
  assertStringIfPresent(voice.voiceModel, 'voice.voiceModel');
  assertNumberIfPresent(voice.voiceSpeed, 'voice.voiceSpeed');
  assertNumberIfPresent(voice.voiceVolume, 'voice.voiceVolume');
  assertNumberIfPresent(voice.voiceTemperature, 'voice.voiceTemperature');
  assertBooleanIfPresent(voice.normalizeForSpeech, 'voice.normalizeForSpeech');
  assertNumberIfPresent(voice.ambientSoundVolume, 'voice.ambientSoundVolume');
  assertBooleanIfPresent(voice.enableDynamicVoiceSpeed, 'voice.enableDynamicVoiceSpeed');
  if (voice.denoisingMode !== undefined && !DENOISING_MODES.includes(voice.denoisingMode))
    throw new IRError('BAD_DENOISING_MODE', `voice.denoisingMode must be one of ${DENOISING_MODES.join(', ')}, got: ${JSON.stringify(voice.denoisingMode)}`);
}

function checkBehavior(behavior) {
  if (behavior === undefined) return;
  assertObject(behavior, 'behavior');
  assertNumberIfPresent(behavior.responsiveness, 'behavior.responsiveness');
  assertNumberIfPresent(behavior.interruptionSensitivity, 'behavior.interruptionSensitivity');
  assertNumberIfPresent(behavior.modelTemperature, 'behavior.modelTemperature');
  assertBooleanIfPresent(behavior.enableBackchannel, 'behavior.enableBackchannel');
  assertNumberIfPresent(behavior.backchannelFrequency, 'behavior.backchannelFrequency');
  assertArrayIfPresent(behavior.backchannelWords, 'behavior.backchannelWords');
  assertBooleanIfPresent(behavior.enableDynamicResponsiveness, 'behavior.enableDynamicResponsiveness');
}

function checkTranscription(transcription) {
  if (transcription === undefined) return;
  assertObject(transcription, 'transcription');
  if (transcription.sttMode !== undefined && !STT_MODES.includes(transcription.sttMode))
    throw new IRError('BAD_STT_MODE', `transcription.sttMode must be one of ${STT_MODES.join(', ')}, got: ${JSON.stringify(transcription.sttMode)}`);
  assertStringIfPresent(transcription.vocabSpecialization, 'transcription.vocabSpecialization');
  assertArrayIfPresent(transcription.boostedKeywords, 'transcription.boostedKeywords');
  assertArrayIfPresent(transcription.pronunciationDictionary, 'transcription.pronunciationDictionary');
}

function checkCallSettings(cs) {
  if (cs === undefined) return;
  assertObject(cs, 'callSettings');
  assertNumberIfPresent(cs.maxCallDuration, 'callSettings.maxCallDuration');
  assertStringIfPresent(cs.language, 'callSettings.language');
  assertBooleanIfPresent(cs.sendUserIdleReminders, 'callSettings.sendUserIdleReminders');
  assertNumberIfPresent(cs.reminderAfterIdleTimeSeconds, 'callSettings.reminderAfterIdleTimeSeconds');
  assertNumberIfPresent(cs.reminderFrequency, 'callSettings.reminderFrequency');
  assertNumberIfPresent(cs.endCallAfterSilenceMs, 'callSettings.endCallAfterSilenceMs');
  assertNumberIfPresent(cs.ringDurationSeconds, 'callSettings.ringDurationSeconds');
}

function checkPostCall(pc) {
  if (pc === undefined) return;
  assertObject(pc, 'postCall');
  if (pc.sendPostCallNotificationTo !== undefined) assertObject(pc.sendPostCallNotificationTo, 'postCall.sendPostCallNotificationTo');
  assertArrayIfPresent(pc.callEndWorkflowIds, 'postCall.callEndWorkflowIds');
}

function checkOutbound(ob) {
  if (ob === undefined) return;
  assertObject(ob, 'outbound');
  if (ob.aiDisclaimerConfiguration !== undefined) assertObject(ob.aiDisclaimerConfiguration, 'outbound.aiDisclaimerConfiguration');
  assertArrayIfPresent(ob.inboundNumbers, 'outbound.inboundNumbers');
}

function checkKnowledgeBase(kb) {
  if (kb === undefined) return;
  assertObject(kb, 'knowledgeBase');
  assertArrayIfPresent(kb.knowledgeBaseIds, 'knowledgeBase.knowledgeBaseIds');
  assertStringIfPresent(kb.knowledgeBasePrompt, 'knowledgeBase.knowledgeBasePrompt');
}

function checkTranslation(t) {
  if (t === undefined) return;
  assertObject(t, 'translation');
  assertBooleanIfPresent(t.enabled, 'translation.enabled');
}

function checkNoResponseConfig(nrc) {
  if (nrc === undefined) return;
  assertObject(nrc, 'noResponseConfig');
  assertBooleanIfPresent(nrc.enabled, 'noResponseConfig.enabled');
  assertArrayIfPresent(nrc.keywords, 'noResponseConfig.keywords');
}

// Actions are a separate resource (POST /voice-ai/actions, see voiceai-compiler.mjs)
// but travel with the IR so compileVoiceAiAgent can compile them alongside the
// create call. Only actionType + name are required at the IR level; actionParameters
// shape is passed through as-is (only CALL_TRANSFER's shape is verified — see
// VERIFIED_ACTION_TYPES above).
function checkActions(actions) {
  if (actions === undefined) return;
  if (!Array.isArray(actions)) throw new IRError('SCHEMA', 'actions must be an array');
  for (const a of actions) {
    if (!a || typeof a !== 'object') throw new IRError('SCHEMA', 'each action must be an object');
    assertNonEmptyString(a.actionType, 'action.actionType');
    assertNonEmptyString(a.name, 'action.name');
    if (a.actionParameters !== undefined && (typeof a.actionParameters !== 'object' || a.actionParameters === null))
      throw new IRError('SCHEMA', 'action.actionParameters must be an object when present');
  }
}

// Full validation — required: agentName, agentPrompt (non-empty strings). Unlike
// Conversation AI, Voice AI has NO partial-IR path: the PUT is full-replace (see
// voice-ai-internal.md's "Merge semantics: FULL REPLACE" section), so both compiler
// entrypoints (create and update) validate this same full shape — there is no
// parseVoiceAiPartialIR counterpart to convai-ir.mjs's parseConvaiPartialIR.
export function parseVoiceAiIR(ir) {
  if (!ir || typeof ir !== 'object') throw new IRError('SCHEMA', 'IR must be an object');
  assertNonEmptyString(ir.agentName, 'agentName');
  assertNonEmptyString(ir.agentPrompt, 'agentPrompt');
  assertStringIfPresent(ir.businessName, 'businessName');
  assertStringIfPresent(ir.timezone, 'timezone');
  assertStringIfPresent(ir.llmModel, 'llmModel');
  assertStringIfPresent(ir.welcomeMessage, 'welcomeMessage');
  if (ir.welcomeMessageMode !== undefined && !WELCOME_MESSAGE_MODES.includes(ir.welcomeMessageMode))
    throw new IRError('BAD_WELCOME_MESSAGE_MODE', `welcomeMessageMode must be one of ${WELCOME_MESSAGE_MODES.join(', ')}, got: ${JSON.stringify(ir.welcomeMessageMode)}`);
  assertNumberIfPresent(ir.beginMessageDelayMs, 'beginMessageDelayMs');
  assertArrayIfPresent(ir.agentWorkingHours, 'agentWorkingHours');
  checkVoice(ir.voice);
  checkBehavior(ir.behavior);
  checkTranscription(ir.transcription);
  checkCallSettings(ir.callSettings);
  checkPostCall(ir.postCall);
  checkOutbound(ir.outbound);
  checkKnowledgeBase(ir.knowledgeBase);
  checkTranslation(ir.translation);
  checkNoResponseConfig(ir.noResponseConfig);
  assertBooleanIfPresent(ir.advancedSettingsEnabled, 'advancedSettingsEnabled');
  assertBooleanIfPresent(ir.isAgentAsBackupDisabled, 'isAgentAsBackupDisabled');
  checkActions(ir.actions);
  return { ...ir };
}
