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

test('TOOLS enum matches captured values', () => {
  assert.deepEqual(TOOLS, ['web_search', 'image_generation', 'kb_search']);
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

// --- single-trigger constraint ------------------------------------------------------

test('VERIFIED_TRIGGER_TYPES matches the two live-captured trigger types', () => {
  assert.deepEqual(VERIFIED_TRIGGER_TYPES, ['chat', 'contact_created']);
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

test('trigger as an array (instead of a single object) rejected', () => {
  const ir = validIR();
  ir.trigger = [{ type: 'chat' }];
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'TOO_MANY_TRIGGERS');
});

test('2+ triggers via the `triggers` array rejected', () => {
  const ir = validIR();
  ir.triggers = [{ type: 'chat', name: 'Chat Started' }, { type: 'contact_created', name: 'Contact created' }];
  assert.throws(() => parseSuperAgentIR(ir), (e) => e instanceof IRError && e.code === 'TOO_MANY_TRIGGERS');
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
