import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVoiceAiIR,
  IRError,
  DENOISING_MODES,
  STT_MODES,
  WELCOME_MESSAGE_MODES,
  VERIFIED_ACTION_TYPES,
} from './voiceai-ir.mjs';

const validIR = () => ({
  agentName: 'TEST-CAP-VOICEAI',
  agentPrompt: 'You are a helpful voice agent for Acme Co.',
  businessName: 'Acme Co',
  timezone: 'Australia/Perth',
  voice: { voiceId: 'g6xIsTj2HwM6VR4iXFCw', denoisingMode: 'noise-cancellation' },
  transcription: { sttMode: 'accurate' },
});

test('valid IR passes through unchanged', () => {
  const out = parseVoiceAiIR(validIR());
  assert.equal(out.agentName, 'TEST-CAP-VOICEAI');
  assert.equal(out.agentPrompt, 'You are a helpful voice agent for Acme Co.');
  assert.equal(out.voice.denoisingMode, 'noise-cancellation');
});

test('missing agentName rejected', () => {
  const ir = validIR(); delete ir.agentName;
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('empty-string agentName rejected', () => {
  const ir = validIR(); ir.agentName = '';
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('missing agentPrompt rejected', () => {
  const ir = validIR(); delete ir.agentPrompt;
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('empty-string agentPrompt rejected', () => {
  const ir = validIR(); ir.agentPrompt = '';
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('bad voice.denoisingMode rejected', () => {
  const ir = validIR(); ir.voice.denoisingMode = 'echo-cancellation';
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'BAD_DENOISING_MODE');
});

test('denoisingMode enum matches captured values', () => {
  assert.deepEqual(DENOISING_MODES, ['noise-cancellation']);
});

test('bad transcription.sttMode rejected', () => {
  const ir = validIR(); ir.transcription.sttMode = 'ultra-fast';
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'BAD_STT_MODE');
});

test('sttMode enum matches documented values', () => {
  assert.deepEqual(STT_MODES, ['accurate', 'fast', 'custom']);
});

test('bad welcomeMessageMode rejected', () => {
  const ir = validIR(); ir.welcomeMessageMode = 'human_recorded';
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'BAD_WELCOME_MESSAGE_MODE');
});

test('welcomeMessageMode enum matches captured values', () => {
  assert.deepEqual(WELCOME_MESSAGE_MODES, ['ai_custom']);
});

test('verified action types cover all 7 captured voice-ai action types', () => {
  assert.deepEqual(VERIFIED_ACTION_TYPES, [
    'CALL_TRANSFER',
    'WORKFLOW_TRIGGER',
    'SMS',
    'DATA_EXTRACTION',
    'APPOINTMENT_BOOKING',
    'CAP',
    'AGENT_TRANSFER_CHILD',
  ]);
});

test('action missing actionType rejected', () => {
  const ir = validIR(); ir.actions = [{ name: 'Transfer' }];
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('action missing name rejected', () => {
  const ir = validIR(); ir.actions = [{ actionType: 'CALL_TRANSFER' }];
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('valid CALL_TRANSFER action passes', () => {
  const ir = validIR();
  ir.actions = [{ actionType: 'CALL_TRANSFER', name: 'TEST Transfer', actionParameters: { transferToValue: '+15551234567' } }];
  const out = parseVoiceAiIR(ir);
  assert.equal(out.actions[0].actionType, 'CALL_TRANSFER');
});

test('unverified action type passes through (not rejected)', () => {
  const ir = validIR();
  // MCP ("Add MCP (Beta)") is the one captured menu item explicitly skipped — it needs
  // a third-party OAuth connect flow before an action can be configured, out of scope
  // per the capture's `_skipped` note. It's the only remaining genuinely-unverified type.
  ir.actions = [{ actionType: 'MCP', name: 'Connect MCP server' }];
  const out = parseVoiceAiIR(ir);
  assert.equal(out.actions[0].actionType, 'MCP');
});

test('multi-calendar APPOINTMENT_BOOKING action passes IR (no calendarId demanded at the IR level)', () => {
  // Per-type actionParameters validation lives in voiceai-compiler.mjs, not the IR —
  // the IR only requires actionType + name + an object actionParameters. The multi shape
  // (calendarActionType:'multiple' + calendarIds:[{id,triggerCondition}], no calendarId)
  // must round-trip through parseVoiceAiIR untouched. Ground truth: voice-multi-calendar-shape.json.
  const ir = validIR();
  ir.actions = [{
    actionType: 'APPOINTMENT_BOOKING',
    name: 'Book',
    actionParameters: {
      calendarActionType: 'multiple',
      calendarIds: [{ id: 'a', triggerCondition: 'treatment' }, { id: 'b', triggerCondition: 'course' }],
      aiDescription: 'Route treatment vs course.',
    },
  }];
  const out = parseVoiceAiIR(ir);
  assert.equal(out.actions[0].actionParameters.calendarActionType, 'multiple');
  assert.equal('calendarId' in out.actions[0].actionParameters, false);
});

test('voice section: non-object rejected', () => {
  const ir = validIR(); ir.voice = 'loud';
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('behavior section: bad type rejected', () => {
  const ir = validIR(); ir.behavior = { responsiveness: 'high' };
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('postCall.callEndWorkflowIds must be an array', () => {
  const ir = validIR(); ir.postCall = { callEndWorkflowIds: 'wf1' };
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('knowledgeBase.knowledgeBaseIds must be an array', () => {
  const ir = validIR(); ir.knowledgeBase = { knowledgeBaseIds: 'kb1' };
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('advancedSettingsEnabled must be a boolean', () => {
  const ir = validIR(); ir.advancedSettingsEnabled = 'yes';
  assert.throws(() => parseVoiceAiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});
