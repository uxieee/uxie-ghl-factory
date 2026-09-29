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

// The server's enum, quoted from its 422 on the designated test sub-account (2026-09-28, nothing written on refusal):
// no-denoise | noise-cancellation | noise-and-background-speech-cancellation. The builder offers the same three
// (voiceAiApp a90e8b1f: NO_DENOISE / NOISE_CANCELLATION / NOISE_AND_BACKGROUND_SPEECH_CANCELLATION).
export const DENOISING_MODES = ['no-denoise', 'noise-cancellation', 'noise-and-background-speech-cancellation'];

// voice-ai-internal.md: "sttMode (`accurate`/`fast`/custom)".
export const STT_MODES = ['accurate', 'fast', 'custom'];

// The server's enum (422 "welcomeMessageMode must be one of: ai_custom | user_first", 2026-09-28). user_first waits for
// the caller to speak; the builder then also sends userFirstFallback {enabled} and beginAfterUserSilenceMs (default 200)
// (voiceAiApp 2cd393ea@120431).
export const WELCOME_MESSAGE_MODES = ['ai_custom', 'user_first'];
export const USER_FIRST_SILENCE_DEFAULT_MS = 200;

// Speech-to-speech models: the builder's own set (voiceAiApp 2cd393ea, module 2835). Choosing one makes GHL switch the
// agent's provider RETELL → "lc" (live 2026-09-28), and only such an agent carries s2sBehaviour.
export const S2S_MODELS = ['gpt-realtime-2', 'gpt-realtime-2.1', 'gemini-3.1-flash-live-preview', 'gpt-live-1'];
export const isS2sModel = (m) => typeof m === 'string' && S2S_MODELS.includes(m);

// After-call spam blocking (spamConfig.postCallAnalysis), as the builder normalises it on save (2cd393ea@121361).
export const SPAM_NOTIFY_MODES = ['admin', 'custom'];

// CALL_TRANSFER was the first live-verified type (voiceai-action.json's captured POST
// /voice-ai/actions call). The other 6 captured builder menu items — Trigger a workflow
// (WORKFLOW_TRIGGER), Send SMS (SMS), Update contact field (DATA_EXTRACTION), Appointment
// Booking (APPOINTMENT_BOOKING), Custom Action 2.0 (CAP), Agent Transfer
// (AGENT_TRANSFER_CHILD) — are now ALSO verified, per
// research/ai-agents-internal/captures/voiceai-actions-all.json (captured 2026-07-11
// against a real test agent). Only "Add MCP (Beta)" remains unverified (its OAuth-connect
// flow is out of scope, see the capture's `_skipped` note) — it passes through as
// accepted-but-unverified, same as any other unlisted actionType.
export const VERIFIED_ACTION_TYPES = [
  'CALL_TRANSFER',
  'WORKFLOW_TRIGGER',
  'SMS',
  'DATA_EXTRACTION',
  'APPOINTMENT_BOOKING',
  'CAP',
  'AGENT_TRANSFER_CHILD',
];

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
  if (cs.languages !== undefined && (!Array.isArray(cs.languages) || !cs.languages.length
    || cs.languages.some((x) => typeof x !== 'string' || !x.trim()))) {
    throw new IRError('SCHEMA', 'callSettings.languages must be a non-empty array of language codes (the builder\'s multi-select)');
  }
  assertStringIfPresent(cs.patienceLevel, 'callSettings.patienceLevel');
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
  assertBooleanIfPresent(pc.saveCallSummaryAsNote, 'postCall.saveCallSummaryAsNote');
}

function checkOutbound(ob) {
  if (ob === undefined) return;
  assertObject(ob, 'outbound');
  if (ob.aiDisclaimerConfiguration !== undefined) assertObject(ob.aiDisclaimerConfiguration, 'outbound.aiDisclaimerConfiguration');
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
// create call. Only actionType + name are required at the IR level — per-type
// actionParameters validation (required fields, defaults) lives in
// voiceai-compiler.mjs's buildActionParameters, for the types listed in
// VERIFIED_ACTION_TYPES above.
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

// THE KEYS create_voiceai_agent APPLIES, per section. Anything else is refused before a request is sent: the compiler
// used to copy only the keys it knew, so a misspelt or unsupported key was dropped and the create still reported success.
export const SECTION_KEYS = {
  voice: ['voiceId', 'voiceModel', 'voiceSpeed', 'voiceVolume', 'voiceTemperature', 'normalizeForSpeech', 'ambientSoundVolume',
    'enableDynamicVoiceSpeed', 'denoisingMode', 'backgroundSound'],
  behavior: ['responsiveness', 'interruptionSensitivity', 'modelTemperature', 'enableBackchannel', 'backchannelFrequency',
    'backchannelWords', 'enableDynamicResponsiveness'],
  transcription: ['sttMode', 'customSttConfig', 'vocabSpecialization', 'boostedKeywords', 'pronunciationDictionary'],
  callSettings: ['maxCallDuration', 'language', 'languages', 'patienceLevel', 'sendUserIdleReminders', 'reminderAfterIdleTimeSeconds',
    'reminderFrequency', 'endCallAfterSilenceMs', 'ringDurationSeconds'],
  postCall: ['callEndWorkflowIds', 'sendPostCallNotificationTo', 'saveCallSummaryAsNote'],
  outbound: ['voicemailOption', 'ivrOption', 'aiDisclaimerConfiguration'],
  knowledgeBase: ['knowledgeBaseIds', 'knowledgeBasePrompt'],
  translation: ['enabled', 'language'],
  noResponseConfig: ['enabled', 'keywords'],
};
export const TOP_KEYS = ['agentName', 'agentPrompt', 'businessName', 'timezone', 'llmModel', 'welcomeMessage', 'welcomeMessageMode',
  'userFirstFallback', 'beginAfterUserSilenceMs', 'beginMessageDelayMs', 'agentWorkingHours', ...Object.keys(SECTION_KEYS),
  'advancedSettingsEnabled', 'isAgentAsBackupDisabled', 'actions', 'prompts', 'disabledPrompts', 'sessionVariables',
  's2sBehaviour', 'endCallConfig', 'spamConfig', 'folderId'];
const NUMBERS = 'numbers are assigned on the Voice AI deploy screen, which is location-wide; this tool does not assign them';
const ELSEWHERE = {
  provider: 'the provider follows llmModel (a speech-to-speech model makes GHL switch it to "lc")',
  inboundPhoneNumber: NUMBERS, inboundNumbers: NUMBERS, numberPoolId: NUMBERS,
  mcpServers: 'MCP servers are their own resource (/voice-ai/mcp/*)',
};
const WHERE = Object.fromEntries(Object.entries(SECTION_KEYS).flatMap(([sec, keys]) => keys.map((k) => [k, sec])));

function refuseUnapplied(ir) {
  const problems = [];
  for (const k of Object.keys(ir)) {
    if (TOP_KEYS.includes(k)) continue;
    if (k in ELSEWHERE) problems.push(`${k}: ${ELSEWHERE[k]}`);
    else if (k in WHERE) problems.push(`${k}: in create_voiceai_agent it is ${WHERE[k]}.${k}`);
    else problems.push(`${k}: not a field this tool writes`);
  }
  for (const [sec, keys] of Object.entries(SECTION_KEYS)) {
    const v = ir[sec];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const k of Object.keys(v)) {
      if (keys.includes(k)) continue;
      if (sec === 'outbound' && k in ELSEWHERE) problems.push(`outbound.${k}: ${ELSEWHERE[k]}`);
      else problems.push(`${sec}.${k}: not a field this tool writes (${sec} takes ${keys.join(', ')})`);
    }
  }
  if (problems.length) {
    throw new IRError('SPEC_KEY_UNAPPLIED', `create_voiceai_agent refuses spec key(s) it cannot apply, rather than creating an agent `
      + `without them: ${problems.join('; ')}. Nothing was sent.`);
  }
}

function checkWelcome(ir) {
  if (ir.welcomeMessageMode !== undefined && !WELCOME_MESSAGE_MODES.includes(ir.welcomeMessageMode))
    throw new IRError('BAD_WELCOME_MESSAGE_MODE', `welcomeMessageMode must be one of ${WELCOME_MESSAGE_MODES.join(', ')}, got: ${JSON.stringify(ir.welcomeMessageMode)}`);
  const userFirst = ir.welcomeMessageMode === 'user_first';
  for (const k of ['userFirstFallback', 'beginAfterUserSilenceMs']) {
    if (ir[k] !== undefined && !userFirst) throw new IRError('SCHEMA', `${k} applies only with welcomeMessageMode "user_first" (the builder sends it only then)`);
  }
  if (ir.userFirstFallback !== undefined) {
    assertObject(ir.userFirstFallback, 'userFirstFallback');
    if (Object.keys(ir.userFirstFallback).some((k) => k !== 'enabled') || typeof ir.userFirstFallback.enabled !== 'boolean') {
      throw new IRError('SCHEMA', 'userFirstFallback must be { enabled: boolean }');
    }
  }
  if (ir.beginAfterUserSilenceMs !== undefined && (typeof ir.beginAfterUserSilenceMs !== 'number' || ir.beginAfterUserSilenceMs < 0)) {
    throw new IRError('SCHEMA', 'beginAfterUserSilenceMs must be a non-negative number of milliseconds');
  }
}

function checkEndCallConfig(v) {
  if (v === undefined) return;
  assertObject(v, 'endCallConfig');
  const keys = ['instruction', 'spamDetectionEnabled', 'spamDetectionInstruction'];
  const other = Object.keys(v).filter((k) => !keys.includes(k));
  if (other.length) throw new IRError('SPEC_KEY_UNAPPLIED', `endCallConfig.${other.join(', ')} is not a field (endCallConfig takes ${keys.join(', ')})`);
  assertStringIfPresent(v.instruction, 'endCallConfig.instruction');
  assertBooleanIfPresent(v.spamDetectionEnabled, 'endCallConfig.spamDetectionEnabled');
  assertStringIfPresent(v.spamDetectionInstruction, 'endCallConfig.spamDetectionInstruction');
}

function checkSpamConfig(v) {
  if (v === undefined) return;
  assertObject(v, 'spamConfig');
  if (Object.keys(v).some((k) => k !== 'postCallAnalysis')) throw new IRError('SPEC_KEY_UNAPPLIED', 'spamConfig takes only postCallAnalysis');
  const p = v.postCallAnalysis;
  assertObject(p, 'spamConfig.postCallAnalysis');
  const keys = ['enabled', 'blockThreshold', 'notifyModes', 'notifyEmails'];
  const other = Object.keys(p).filter((k) => !keys.includes(k));
  if (other.length) throw new IRError('SPEC_KEY_UNAPPLIED', `spamConfig.postCallAnalysis.${other.join(', ')} is not a field (it takes ${keys.join(', ')})`);
  assertBooleanIfPresent(p.enabled, 'spamConfig.postCallAnalysis.enabled');
  assertNumberIfPresent(p.blockThreshold, 'spamConfig.postCallAnalysis.blockThreshold');
  if (p.notifyModes !== undefined && (!Array.isArray(p.notifyModes) || !p.notifyModes.length || p.notifyModes.some((m) => !SPAM_NOTIFY_MODES.includes(m)))) {
    throw new IRError('SCHEMA', `spamConfig.postCallAnalysis.notifyModes must be a non-empty array of ${SPAM_NOTIFY_MODES.join(', ')}`);
  }
  if (p.notifyEmails !== undefined && (!Array.isArray(p.notifyEmails) || p.notifyEmails.some((e) => typeof e !== 'string' || !e.trim()))) {
    throw new IRError('SCHEMA', 'spamConfig.postCallAnalysis.notifyEmails must be an array of email addresses');
  }
  if ((p.notifyEmails ?? []).length && !(p.notifyModes ?? []).includes('custom')) {
    throw new IRError('SCHEMA', 'spamConfig.postCallAnalysis.notifyEmails needs notifyModes to include "custom" (the builder drops them otherwise)');
  }
}

// Full validation — required: agentName, agentPrompt (non-empty strings). This is the create tool's IR; the create
// sends it as one builder-save PUT after the POST. (The Voice AI PUT MERGES a partial body at the top level —
// measured 2026-09-28 — and update_voiceai_agent uses that with its own flat spec, engines/ai/voiceai-update.mjs.)
export function parseVoiceAiIR(ir) {
  if (!ir || typeof ir !== 'object') throw new IRError('SCHEMA', 'IR must be an object');
  refuseUnapplied(ir);
  assertNonEmptyString(ir.agentName, 'agentName');
  assertNonEmptyString(ir.agentPrompt, 'agentPrompt');
  assertStringIfPresent(ir.businessName, 'businessName');
  assertStringIfPresent(ir.timezone, 'timezone');
  assertStringIfPresent(ir.llmModel, 'llmModel');
  assertStringIfPresent(ir.welcomeMessage, 'welcomeMessage');
  checkWelcome(ir);
  assertNumberIfPresent(ir.beginMessageDelayMs, 'beginMessageDelayMs');
  assertArrayIfPresent(ir.agentWorkingHours, 'agentWorkingHours');
  if (ir.folderId !== undefined && (typeof ir.folderId !== 'string' || !ir.folderId)) throw new IRError('SCHEMA', 'folderId must be a Voice AI folder id');
  checkVoice(ir.voice);
  checkBehavior(ir.behavior);
  checkTranscription(ir.transcription);
  checkCallSettings(ir.callSettings);
  checkPostCall(ir.postCall);
  checkOutbound(ir.outbound);
  checkKnowledgeBase(ir.knowledgeBase);
  checkTranslation(ir.translation);
  checkNoResponseConfig(ir.noResponseConfig);
  checkEndCallConfig(ir.endCallConfig);
  checkSpamConfig(ir.spamConfig);
  assertBooleanIfPresent(ir.advancedSettingsEnabled, 'advancedSettingsEnabled');
  assertBooleanIfPresent(ir.isAgentAsBackupDisabled, 'isAgentAsBackupDisabled');
  const s2s = isS2sModel(ir.llmModel);
  if (ir.s2sBehaviour !== undefined && !s2s) {
    throw new IRError('SPEC_KEY_UNAPPLIED', `s2sBehaviour applies only to a speech-to-speech agent: llmModel must be one of `
      + `${S2S_MODELS.join(', ')} (got ${JSON.stringify(ir.llmModel)}). Nothing was sent.`);
  }
  if (ir.noResponseConfig !== undefined && s2s) {
    throw new IRError('SPEC_KEY_UNAPPLIED', 'noResponseConfig belongs to a Retell (text-model) agent; the builder never sends it for a speech-to-speech model. Nothing was sent.');
  }
  checkActions(ir.actions);
  return { ...ir };
}
