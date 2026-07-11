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

test('verified action types is CALL_TRANSFER only', () => {
  assert.deepEqual(VERIFIED_ACTION_TYPES, ['CALL_TRANSFER']);
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
  ir.actions = [{ actionType: 'WORKFLOW_TRIGGER', name: 'Notify team' }];
  const out = parseVoiceAiIR(ir);
  assert.equal(out.actions[0].actionType, 'WORKFLOW_TRIGGER');
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
