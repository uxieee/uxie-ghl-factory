import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSuperAgentIR,
  IRError,
  DEFAULT_MODEL,
  TOOLS,
  VERIFIED_TRIGGER_TYPES,
} from './studio-ir.mjs';

const validIR = () => ({
  name: 'TEST-CAP-STUDIO',
  systemPrompt: 'You are TEST-CAP-STUDIO, a test-only AI agent created for API research and experimentation.',
  description: 'A non-production test agent for API research, experimentation, and response validation.',
});

test('valid IR passes through unchanged (plus model default)', () => {
  const out = parseSuperAgentIR(validIR());
  assert.equal(out.name, 'TEST-CAP-STUDIO');
  assert.equal(out.systemPrompt, validIR().systemPrompt);
  assert.equal(out.model, DEFAULT_MODEL);
});

test('DEFAULT_MODEL matches the literal observed in both studio-create.json and studio-update.json', () => {
  assert.equal(DEFAULT_MODEL, 'anthropic/claude-sonnet-4-6');
});

test('explicit model overrides the default', () => {
  const ir = validIR();
  ir.model = 'anthropic/claude-opus-4-6';
  const out = parseSuperAgentIR(ir);
  assert.equal(out.model, 'anthropic/claude-opus-4-6');
});

test('missing name rejected', () => {
  const ir = validIR(); delete ir.name;
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('empty-string name rejected', () => {
  const ir = validIR(); ir.name = '';
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('missing systemPrompt rejected', () => {
  const ir = validIR(); delete ir.systemPrompt;
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('empty-string systemPrompt rejected', () => {
  const ir = validIR(); ir.systemPrompt = '';
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

// --- tools[] enum -----------------------------------------------------------------

test('TOOLS enum is the 7 capability ids stored and read back live (2026-09-28)', () => {
  assert.deepEqual(TOOLS, ['web_search', 'kb_search', 'web_fetch', 'image_generation', 'tts_generation', 'video_generation', 'mcp']);
});

test('the three newer capability ids pass; a made-up one is still refused (control)', () => {
  const ir = validIR(); ir.tools = ['web_fetch', 'tts_generation', 'video_generation', 'mcp'];
  assert.deepEqual(parseSuperAgentIR(ir).tools, ['web_fetch', 'tts_generation', 'video_generation', 'mcp']);
  const bad = validIR(); bad.tools = ['bogus_tool_x'];
  assert.throws(() => parseSuperAgentIR(bad), (e) => e instanceof IRError && e.code === 'BAD_TOOL');
});

test('valid tools[] passes', () => {
  const ir = validIR();
  ir.tools = ['web_search', 'image_generation'];
  const out = parseSuperAgentIR(ir);
  assert.deepEqual(out.tools, ['web_search', 'image_generation']);
});

test('bad tools[] entry rejected', () => {
  const ir = validIR();
  ir.tools = ['web_search', 'code_interpreter'];
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'BAD_TOOL');
});

test('non-array tools rejected', () => {
  const ir = validIR();
  ir.tools = 'web_search';
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

// --- triggers ---------------------------------------------------------------------

test('VERIFIED_TRIGGER_TYPES is the 13 types the picker offers, each read back live', () => {
  assert.equal(VERIFIED_TRIGGER_TYPES.length, 13);
  for (const t of ['chat', 'form', 'tag', 'schedule', 'appointment_booked', 'appointment_status', 'contact_created', 'opportunity_created', 'opportunity_status_changed', 'survey_submission', 'facebook_lead_gen', 'facebook_comment', 'workflows']) assert.ok(VERIFIED_TRIGGER_TYPES.includes(t), t);
});

test('single trigger object passes (chat, matching studio-create.json default)', () => {
  const ir = validIR();
  ir.trigger = { type: 'chat', name: 'Chat Started', triggerMessage: 'A new chat conversation has started with a contact. Begin the intake flow.' };
  const out = parseSuperAgentIR(ir);
  assert.equal(out.trigger.type, 'chat');
});

test('single trigger object passes (contact_created, matching studio-update.json variant 2)', () => {
  const ir = validIR();
  ir.trigger = { type: 'contact_created', name: 'Contact created' };
  const out = parseSuperAgentIR(ir);
  assert.equal(out.trigger.type, 'contact_created');
});

test('unverified trigger type passes through (not rejected)', () => {
  const ir = validIR();
  ir.trigger = { type: 'form_submitted', name: 'Form submitted' };
  const out = parseSuperAgentIR(ir);
  assert.equal(out.trigger.type, 'form_submitted');
});

test('trigger missing type rejected', () => {
  const ir = validIR();
  ir.trigger = { name: 'Contact created' };
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('trigger as an array (instead of a single object) rejected — use `triggers`', () => {
  const ir = validIR();
  ir.trigger = [{ type: 'tag' }];
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('several non-chat triggers pass (live: tag + schedule stored and fired)', () => {
  const ir = validIR();
  ir.triggers = [{ type: 'tag', config: { tagIds: ['x'], tagNames: ['x'], tagAction: 'added' } }, { type: 'schedule', config: { schedule: { mode: 'once', startDate: '2026-12-31', startTime: '10:00', timezone: 'Europe/London' } } }, { type: 'workflows' }];
  assert.equal(parseSuperAgentIR(ir).triggers.length, 3);
});

test('chat mixed with a non-chat trigger is refused (the server 400s it); chat + workflows passes (control)', () => {
  const bad = validIR(); bad.triggers = [{ type: 'chat' }, { type: 'contact_created' }];
  assert.throws(() => parseSuperAgentIR(bad), (e) => e instanceof IRError && e.code === 'TRIGGER_MIX');
  const ok = validIR(); ok.triggers = [{ type: 'chat' }, { type: 'workflows' }];
  assert.equal(parseSuperAgentIR(ok).triggers.length, 2);
});

test('a schedule trigger needs config.schedule with a known mode', () => {
  const ir = validIR(); ir.triggers = [{ type: 'schedule', config: {} }];
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
  const ir2 = validIR(); ir2.triggers = [{ type: 'schedule', config: { schedule: { mode: 'weekly' } } }];
  assert.throws(() => parseSuperAgentIR(ir2), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('plugins: [] passes, a plugin without slug is refused', () => {
  const ir = validIR(); ir.plugins = [];
  assert.deepEqual(parseSuperAgentIR(ir).plugins, []);
  const bad = validIR(); bad.plugins = [{ name: 'x' }];
  assert.throws(() => parseSuperAgentIR(bad), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('imageGeneration.quality must be low|medium|high', () => {
  const ir = validIR(); ir.imageGeneration = { quality: 'low' };
  assert.equal(parseSuperAgentIR(ir).imageGeneration.quality, 'low');
  const bad = validIR(); bad.imageGeneration = { quality: 'ultra' };
  assert.throws(() => parseSuperAgentIR(bad), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('single-element `triggers` array passes (alternate input shape)', () => {
  const ir = validIR();
  ir.triggers = [{ type: 'contact_created', name: 'Contact created' }];
  const out = parseSuperAgentIR(ir);
  assert.equal(out.triggers.length, 1);
});

test('empty `triggers` array passes (no trigger configured)', () => {
  const ir = validIR();
  ir.triggers = [];
  const out = parseSuperAgentIR(ir);
  assert.deepEqual(out.triggers, []);
});

test('specifying both `trigger` and `triggers` rejected', () => {
  const ir = validIR();
  ir.trigger = { type: 'chat' };
  ir.triggers = [{ type: 'contact_created' }];
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

// --- other optional sections --------------------------------------------------------

test('knowledgeBaseIds must be an array', () => {
  const ir = validIR();
  ir.knowledgeBaseIds = 'kb1';
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('valid knowledgeBaseIds array passes', () => {
  const ir = validIR();
  ir.knowledgeBaseIds = ['tJdoJJkFGwqhsWKmHLEd'];
  const out = parseSuperAgentIR(ir);
  assert.deepEqual(out.knowledgeBaseIds, ['tJdoJJkFGwqhsWKmHLEd']);
});

test('starterPrompts must be an array of {label, prompt} objects', () => {
  const ir = validIR();
  ir.starterPrompts = [{ label: 'Test API Prompt', prompt: 'Help me design a safe test prompt.' }];
  const out = parseSuperAgentIR(ir);
  assert.equal(out.starterPrompts[0].label, 'Test API Prompt');
});

test('starterPrompts entry missing prompt rejected', () => {
  const ir = validIR();
  ir.starterPrompts = [{ label: 'Test API Prompt' }];
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('reasoningEffort must be a string', () => {
  const ir = validIR();
  ir.reasoningEffort = 42;
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('description must be a string when present', () => {
  const ir = validIR();
  ir.description = 123;
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});
