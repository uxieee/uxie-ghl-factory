import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSuperAgentUpdate, compileSuperAgentCreate, AUTH_HEADER, BUILD_MODES } from './studio-compiler.mjs';
import { IRError, DEFAULT_MODEL } from './studio-ir.mjs';

const LOCATION_ID = 'wdzEoUZnXO9tB3PPzcot';
const COMPANY_ID = 'BCqxfm3jdo0x68BKwafn';
const AGENT_ID = 'd7150b42-6480-47ef-aee7-20b50ee43d3f';

// --- compileSuperAgentUpdate (PUT /agent-studio/super-agent/agents/:id) -----------

test('compileSuperAgentUpdate: full IR compiles to a full-replace PUT descriptor', () => {
  const ir = {
    name: 'TEST-CAP-STUDIO',
    description: 'A non-production test agent for API research, experimentation, and response validation.',
    systemPrompt: 'You are TEST-CAP-STUDIO, a test-only AI agent created for API research and experimentation.',
    tools: ['web_search'],
    trigger: { type: 'chat', name: 'Chat Started', triggerMessage: 'A new chat conversation has started with a contact. Begin the intake flow.' },
    starterPrompts: [
      { label: 'Test API Prompt', prompt: 'Help me design a safe test prompt for evaluating API response quality using only synthetic data.' },
    ],
  };
  const { method, path, body, authHeader } = compileSuperAgentUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.equal(method, 'PUT');
  assert.equal(path, `/agent-studio/super-agent/agents/${AGENT_ID}`);
  assert.equal(authHeader, 'ai');
  assert.equal(AUTH_HEADER, 'ai');

  // body shape: matches studio-update.json's captured request_body -- {locationId,
  // config} ONLY. No `id` key in the body (the agent id lives in the URL path only).
  assert.deepEqual(Object.keys(body).sort(), ['config', 'locationId']);
  assert.equal(body.locationId, LOCATION_ID);
  assert.equal('id' in body, false);

  assert.equal(body.config.name, 'TEST-CAP-STUDIO');
  assert.equal(body.config.systemPrompt, ir.systemPrompt);
  assert.equal(body.config.model, DEFAULT_MODEL);
  assert.deepEqual(body.config.tools, ['web_search']);
  assert.deepEqual(body.config.triggers, [
    { type: 'chat', name: 'Chat Started', enabled: true, config: {}, triggerMessage: 'A new chat conversation has started with a contact. Begin the intake flow.' },
  ]);
  assert.deepEqual(body.config.contextManagement, { strategy: 'summarize', keepRecentTurns: 10, compactionThreshold: 0.9 });
  assert.deepEqual(body.config.reasoning, { effort: 'medium' });
  assert.deepEqual(body.config.plugins, [{ slug: 'default', name: 'Default', description: 'Built-in crm skills for your agent', skills: [], allSkills: true }]);
  assert.deepEqual(body.config.starterPrompts, ir.starterPrompts);
  assert.equal(body.config.knowledgeBaseIds, null);
  assert.deepEqual(body.config.actions, []);
});

// Reproduces studio-update.json variant 2's "Add Trigger" behavior: selecting a new
// trigger type REPLACES the triggers array -- our IR's single `trigger` field always
// lands as exactly a 1-element array.
test('compileSuperAgentUpdate: the single trigger lands as a 1-element triggers[] (variant 2: contact_created)', () => {
  const ir = {
    name: 'TEST-CAP-STUDIO',
    systemPrompt: 'placeholder prompt',
    tools: ['web_search'],
    trigger: { type: 'contact_created', name: 'Contact created', triggerMessage: 'A new contact ({{contactName}}) was just created. Process this new contact automatically.' },
  };
  const { body } = compileSuperAgentUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.equal(body.config.triggers.length, 1);
  assert.deepEqual(body.config.triggers[0], {
    type: 'contact_created',
    name: 'Contact created',
    enabled: true,
    config: {},
    triggerMessage: 'A new contact ({{contactName}}) was just created. Process this new contact automatically.',
  });
});

test('compileSuperAgentUpdate: no trigger configured -> empty triggers[]', () => {
  const ir = { name: 'X', systemPrompt: 'Y' };
  const { body } = compileSuperAgentUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.config.triggers, []);
});

// Reproduces studio-update.json variant 4's "Attach Knowledge Base" behavior: tools[]
// gains 'kb_search' automatically once knowledgeBaseIds is non-empty.
test('compileSuperAgentUpdate: attaching a knowledge base auto-adds kb_search to tools[] (variant 4)', () => {
  const ir = {
    name: 'TEST-CAP-STUDIO',
    systemPrompt: 'placeholder prompt',
    tools: ['image_generation', 'web_search'],
    knowledgeBaseIds: ['tJdoJJkFGwqhsWKmHLEd'],
  };
  const { body } = compileSuperAgentUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.config.tools, ['image_generation', 'web_search', 'kb_search']);
  assert.deepEqual(body.config.knowledgeBaseIds, ['tJdoJJkFGwqhsWKmHLEd']);
});

test('compileSuperAgentUpdate: kb_search is not force-added when knowledgeBaseIds is empty/absent', () => {
  const ir = { name: 'X', systemPrompt: 'Y', tools: ['web_search'] };
  const { body } = compileSuperAgentUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID });
  assert.deepEqual(body.config.tools, ['web_search']);
  assert.equal(body.config.knowledgeBaseIds, null);
});

test('compileSuperAgentUpdate: requires agentId', () => {
  assert.throws(() => compileSuperAgentUpdate({ name: 'X', systemPrompt: 'Y' }, { locationId: LOCATION_ID }),
    (e) => e.code === 'MISSING_FIELD');
});

test('compileSuperAgentUpdate: rejects invalid IR (missing systemPrompt)', () => {
  assert.throws(() => compileSuperAgentUpdate({ name: 'X' }, { agentId: AGENT_ID, locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileSuperAgentUpdate: rejects invalid IR (bad tool enum)', () => {
  const ir = { name: 'X', systemPrompt: 'Y', tools: ['bogus_tool'] };
  assert.throws(() => compileSuperAgentUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID }),
    (e) => e.code === 'BAD_TOOL');
});

test('compileSuperAgentUpdate: rejects invalid IR (2+ triggers)', () => {
  const ir = {
    name: 'X',
    systemPrompt: 'Y',
    triggers: [{ type: 'chat' }, { type: 'contact_created' }],
  };
  assert.throws(() => compileSuperAgentUpdate(ir, { agentId: AGENT_ID, locationId: LOCATION_ID }),
    (e) => e.code === 'TOO_MANY_TRIGGERS');
});

// --- compileSuperAgentCreate (POST /agent-studio/super-agents/build) --------------

test('compileSuperAgentCreate: emits the build POST matching studio-create.json request_body shape', () => {
  const { method, path, body, authHeader } = compileSuperAgentCreate(
    { buildPrompt: 'a test agent for API research purposes only. Do not use in production.', name: 'TEST-CAP-STUDIO' },
    { locationId: LOCATION_ID, companyId: COMPANY_ID },
  );
  assert.equal(method, 'POST');
  assert.equal(path, '/agent-studio/super-agents/build');
  assert.equal(authHeader, 'ai');
  assert.deepEqual(body, {
    message: 'TEST-CAP-STUDIO: a test agent for API research purposes only. Do not use in production.',
    locationId: LOCATION_ID,
    context: { companyId: COMPANY_ID },
    mode: 'fast',
  });
});

test('compileSuperAgentCreate: BUILD_MODES matches the only observed value', () => {
  assert.deepEqual(BUILD_MODES, ['fast']);
});

test('compileSuperAgentCreate: name is optional -- message is just buildPrompt verbatim when omitted', () => {
  const { body } = compileSuperAgentCreate({ buildPrompt: 'Build me a scheduling assistant.' }, { locationId: LOCATION_ID });
  assert.equal(body.message, 'Build me a scheduling assistant.');
});

test('compileSuperAgentCreate: mode is overridable', () => {
  const { body } = compileSuperAgentCreate({ buildPrompt: 'X' }, { locationId: LOCATION_ID, mode: 'thorough' });
  assert.equal(body.mode, 'thorough');
});

test('compileSuperAgentCreate: companyId defaults to null when omitted', () => {
  const { body } = compileSuperAgentCreate({ buildPrompt: 'X' }, { locationId: LOCATION_ID });
  assert.equal(body.context.companyId, null);
});

test('compileSuperAgentCreate: rejects missing buildPrompt', () => {
  assert.throws(() => compileSuperAgentCreate({}, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileSuperAgentCreate: rejects empty-string buildPrompt', () => {
  assert.throws(() => compileSuperAgentCreate({ buildPrompt: '' }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileSuperAgentCreate: rejects empty-string name when present', () => {
  assert.throws(() => compileSuperAgentCreate({ buildPrompt: 'X', name: '' }, { locationId: LOCATION_ID }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});
