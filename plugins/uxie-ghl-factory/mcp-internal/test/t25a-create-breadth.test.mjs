// t25a (2026-09-29): creation breadth — CAI email settings at create, the CAI model roster, Managed Agents from a template /
// into a folder / with the Custom API switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, compileAiAgentPlan } from '../core/tools.mjs';
import { executeAgentPlan } from '../../engines/ai/driver.mjs';
import { mergeTemplateConfig } from '../../engines/ai/studio-compiler.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const L = 'loc-1';
const EMAIL = { emailWaitTime: 7, emailWaitTimeUnit: 'minutes', emailSettings: { senderDetails: { fromName: 'X' }, replyBehavior: { greetingPersonalization: 'Hi', waitTimeType: 'custom', customWaitTime: 7, customWaitTimeUnit: 'minutes' }, emailFormat: 'plain_text', signature: '--', templateId: '' } };
const cai = (extra) => ({ locationId: L, spec: { name: 'A', mode: 'off', channels: ['SMS', 'Email'], goal: 'g', ...extra } });
const refusedWith = (fn, code) => { try { fn(); } catch (e) { assert.equal(e.code, code, e.message); return e; } assert.fail('expected a refusal'); };

test('create_convai_agent: email keys ride the create body and the verify, only with "Email" in channels', () => {
  const plan = compileAiAgentPlan('convai', cai(EMAIL));
  assert.equal(plan.create.body.emailWaitTime, 7);
  assert.equal(plan.create.body.emailWaitTimeUnit, 'minutes');
  assert.deepEqual(plan.create.body.emailSettings, EMAIL.emailSettings);
  assert.deepEqual(plan.verifyExpected.emailSettings, EMAIL.emailSettings);
  // control: without them the body carries none
  assert.equal('emailSettings' in compileAiAgentPlan('convai', cai({})).create.body, false);
  refusedWith(() => compileAiAgentPlan('convai', { locationId: L, spec: { ...cai(EMAIL).spec, channels: ['SMS'] } }), 'SPEC_KEY_UNAPPLIED');
});

test('create_convai_agent: the editor\'s email-wait ranges and shape are enforced before anything is sent', () => {
  refusedWith(() => compileAiAgentPlan('convai', cai({ ...EMAIL, emailWaitTime: 361 })), 'SCHEMA'); // the server stored 361; the editor refuses
  compileAiAgentPlan('convai', cai({ ...EMAIL, emailWaitTime: 360 }));
  refusedWith(() => compileAiAgentPlan('convai', cai({ ...EMAIL, emailWaitTimeUnit: 'days' })), 'SCHEMA');
  refusedWith(() => compileAiAgentPlan('convai', cai({ emailWaitTime: 5 })), 'SCHEMA'); // unit missing
  refusedWith(() => compileAiAgentPlan('convai', cai({ emailSettings: { bogus: 1 } })), 'SCHEMA');
  refusedWith(() => compileAiAgentPlan('convai', cai({ emailSettings: { emailFormat: 'html' } })), 'SCHEMA');
  refusedWith(() => compileAiAgentPlan('convai', cai({ emailSettings: { replyBehavior: { greetingPersonalization: 5 } } })), 'SCHEMA');
});

test('get_ai_agent_options product:conversation_ai reads the CAI roster on the ai rail; the default still reads the workflow step', async () => {
  const calls = [];
  const deps = { state: {}, makeGw: ({ rail }) => ({ call: async (m, p) => { calls.push({ rail, p });
    if (p === '/ai-employees/employees/models') return { ok: true, status: 200, json: { models: [{ value: 'gpt-4.1', provider: 'openai', inputPrice: 2, outputPrice: 8, priceUnit: '$', costTier: 3, recommended: true, default: true, deprecation: null }, { value: 'gpt-5', provider: 'openai', deprecation: { effectiveAt: 'x', replacement: 'gpt-5.1' } }] } };
    return { ok: true, status: 200, json: { success: true, data: { models: [] } } }; } }) };
  const r = await tool('get_ai_agent_options').handler({ locationId: L, product: 'conversation_ai' }, deps);
  assert.equal(r.ok, true);
  assert.equal(r.data.models.defaultModelId, 'gpt-4.1');
  assert.deepEqual(r.data.models.models.map((m) => m.id), ['gpt-4.1', 'gpt-5']);
  assert.deepEqual(r.data.models.models[1].deprecation, { effectiveAt: 'x', replacement: 'gpt-5.1' });
  assert.deepEqual(calls, [{ rail: 'ai', p: '/ai-employees/employees/models' }]);
  calls.length = 0;
  await tool('get_ai_agent_options').handler({ locationId: L }, deps);
  assert.ok(calls.every((c) => c.p.startsWith('/workflow/agent/')), JSON.stringify(calls));
});

const TEMPLATE_CFG = { name: 'Customer Support Agent', systemPrompt: 'TEMPLATE PROMPT', tools: ['kb_search', 'web_search'],
  plugins: [{ slug: 'default', allSkills: true }], triggers: [{ type: 'chat', name: 'Chat Started', enabled: true, config: {} }], starterPrompts: [{ label: 'a', prompt: 'b' }] };

test('create_studio_agent templateId: from-template (JSON, never the SSE build), then a PUT of the TEMPLATE config with the spec on top', async () => {
  const plan = compileAiAgentPlan('studio', { locationId: L, spec: { templateId: 'knowledge-base-assistant', name: 'TEST-X', plugins: [], triggers: [], customApiEnabled: true, folderId: 'F1', folderName: 'Fold' } });
  assert.equal(plan.create.path, '/agent-studio/super-agent/agents/from-template');
  assert.deepEqual(plan.create.body, { templateId: 'knowledge-base-assistant', locationId: L, folderId: 'F1', folderName: 'Fold' });
  let putBody = null; let stored = null;
  const gw = { loc: L,
    stream: async () => { throw new Error('the template door must not stream'); },
    call: async (m, p, b) => {
      if (m === 'POST') return { ok: true, status: 201, json: { id: 'AG1', status: 'draft', config: TEMPLATE_CFG } };
      if (m === 'PUT') { putBody = b; stored = b.config; return { ok: true, status: 200, json: { id: 'AG1', config: b.config } }; }
      return { ok: true, status: 200, json: { id: 'AG1', config: stored } };
    } };
  const report = await executeAgentPlan({ plan, gw });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.agentId, 'AG1');
  assert.equal(putBody.config.systemPrompt, 'TEMPLATE PROMPT'); // kept, not rebuilt from defaults
  assert.deepEqual(putBody.config.starterPrompts, TEMPLATE_CFG.starterPrompts);
  assert.equal(putBody.config.name, 'TEST-X');
  assert.deepEqual(putBody.config.plugins, []);
  assert.equal(putBody.config.customApiEnabled, true);
  assert.deepEqual(putBody.config.triggers, [{ ...TEMPLATE_CFG.triggers[0], enabled: false }]); // [] = disable, since [] is ignored
  assert.ok(report.verification.confirmed.some((k) => k.includes('triggers')), JSON.stringify(report.verification));
});

test('template verify is real: a server that keeps the trigger enabled (the [] trap) fails the create loudly', async () => {
  const plan = compileAiAgentPlan('studio', { locationId: L, spec: { templateId: 'knowledge-base-assistant', name: 'TEST-X', triggers: [] } });
  const gw = { loc: L, stream: async () => { throw new Error('no'); },
    call: async (m, p, b) => (m === 'POST' ? { ok: true, status: 201, json: { id: 'AG1', config: TEMPLATE_CFG } }
      : m === 'PUT' ? { ok: true, status: 200, json: {} } : { ok: true, status: 200, json: { id: 'AG1', config: { ...TEMPLATE_CFG, name: 'TEST-X' } } }) };
  const report = await executeAgentPlan({ plan, gw });
  assert.equal(report.ok, false);
  assert.equal(report.code, 'AGENT_VERIFICATION_FAILED');
});

test('template spec refusals: unknown id, buildPrompt, a missing name, folderName without folderId', () => {
  const s = (extra) => ({ locationId: L, spec: { templateId: 'knowledge-base-assistant', name: 'N', ...extra } });
  refusedWith(() => compileAiAgentPlan('studio', s({ templateId: 'nope' })), 'SCHEMA');
  refusedWith(() => compileAiAgentPlan('studio', s({ buildPrompt: 'x' })), 'SPEC_KEY_UNAPPLIED');
  refusedWith(() => compileAiAgentPlan('studio', { locationId: L, spec: { templateId: 'knowledge-base-assistant' } }), 'SCHEMA');
  refusedWith(() => compileAiAgentPlan('studio', s({ folderName: 'x' })), 'SCHEMA');
});

test('build door: folderId/folderName ride the build body, customApiEnabled rides the PUT and the verify', () => {
  const plan = compileAiAgentPlan('studio', { locationId: L, spec: { name: 'N', systemPrompt: 'p', folderId: 'F1', folderName: 'Fold', customApiEnabled: true } });
  assert.equal(plan.create.path, '/agent-studio/super-agents/build');
  assert.equal(plan.create.body.folderId, 'F1');
  assert.equal(plan.create.body.folderName, 'Fold');
  assert.equal(plan.followUps[0].body.config.customApiEnabled, true);
  assert.equal(plan.verifyExpected.config.customApiEnabled, true);
  assert.deepEqual(plan.folder, { folderId: 'F1', folderName: 'Fold' });
  const plain = compileAiAgentPlan('studio', { locationId: L, spec: { name: 'N', systemPrompt: 'p' } });
  assert.equal('folderId' in plain.create.body, false);
  assert.equal('customApiEnabled' in plain.followUps[0].body.config, false);
});

test('create_studio_agent: a folder that does not list the new agent fails AGENT_FOLDER_UNVERIFIED', async () => {
  let stored = null;
  const deps = { state: {}, makeGw: () => ({ loc: L, stream: async () => { throw new Error('no'); },
    call: async (m, p, b) => {
      if (m === 'POST') return { ok: true, status: 201, json: { id: 'AG1', config: TEMPLATE_CFG } };
      if (m === 'PUT') { stored = b.config; return { ok: true, status: 200, json: {} }; }
      if (p.startsWith('/agent-studio/super-agent/agents?')) return { ok: true, status: 200, json: { agents: [] } };
      return { ok: true, status: 200, json: { id: 'AG1', config: stored } };
    } }) };
  const r = await tool('create_studio_agent').handler({ locationId: L, confirm: true, spec: { templateId: 'knowledge-base-assistant', name: 'N', folderId: 'F1' } }, deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AGENT_FOLDER_UNVERIFIED');
  assert.equal(r.data.template.templateId, 'knowledge-base-assistant');
  assert.match(r.data.template.note, /ENABLED/);
});

test('mergeTemplateConfig: overrides win, untouched template keys stay, disable maps every trigger', () => {
  const m = mergeTemplateConfig(TEMPLATE_CFG, { name: 'N' }, { disableTriggers: true });
  assert.equal(m.name, 'N'); assert.equal(m.systemPrompt, 'TEMPLATE PROMPT');
  assert.ok(m.triggers.every((t) => t.enabled === false));
  assert.equal(TEMPLATE_CFG.triggers[0].enabled, true); // not mutated
});
