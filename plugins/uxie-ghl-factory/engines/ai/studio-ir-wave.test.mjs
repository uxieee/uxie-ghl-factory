// W5b Task 3: the 2026-10 Managed Agents wave (knowledge/sniffs/managed-agents-wave-2026-10-30/UI-WALK-FINDINGS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuperAgentIR, refuseUnappliedStudioKeys, IRError, TOOLS, SERVER_TRIGGER_TYPES, SUBAGENT_MODELS } from './studio-ir.mjs';
import { compileSuperAgentUpdate, templateOverrides } from './studio-compiler.mjs';

const base = () => ({ name: 'TEST-CONF-W5b', systemPrompt: 'test agent' });
const code = (c) => (e) => e instanceof IRError && e.code === c;

test('the three triggers the 2026-10 server vocabulary added validate', () => {
  for (const type of ['customer_reply', 'inbound_webhook', 'api']) {
    assert.ok(SERVER_TRIGGER_TYPES.includes(type), type);
    parseSuperAgentIR({ ...base(), triggers: [{ type }] });
  }
  assert.equal(SERVER_TRIGGER_TYPES.length, 16, '13 verified + 3 from the server 400');
  assert.throws(() => parseSuperAgentIR({ ...base(), triggers: [{ type: 'date_reminder' }] }), code('BAD_TRIGGER'), 'a "coming soon" picker entry is not a type');
});

test('api, like workflows, combines with chat; tag still does not', () => {
  parseSuperAgentIR({ ...base(), triggers: [{ type: 'chat' }, { type: 'api' }] });
  parseSuperAgentIR({ ...base(), triggers: [{ type: 'chat' }, { type: 'workflows' }, { type: 'api' }] });
  assert.throws(() => parseSuperAgentIR({ ...base(), triggers: [{ type: 'chat' }, { type: 'tag' }] }), code('TRIGGER_MIX'));
});

test('subagents: shape checked, model must be on the server roster', () => {
  parseSuperAgentIR({ ...base(), subagents: [] });
  parseSuperAgentIR({ ...base(), subagents: [{ name: 'summariser', description: 'sums up', systemPrompt: 'summarise' }] });
  parseSuperAgentIR({ ...base(), subagents: [{ name: 's', description: 'd', systemPrompt: 'p', model: 'openrouter/z-ai/glm-5.3-flash' }] });
  assert.throws(() => parseSuperAgentIR({ ...base(), subagents: [{ name: 's', description: 'd' }] }), code('SCHEMA'));
  assert.throws(() => parseSuperAgentIR({ ...base(), subagents: [{ name: 'x', description: 'd', systemPrompt: 'p', model: 'anthropic/claude-haiku-4-5' }] }),
    (e) => e.code === 'BAD_MODEL' && /subagents\[0\] \(x\)/.test(e.message));
  assert.ok(SUBAGENT_MODELS.includes('anthropic/claude-sonnet-4-6'));
});

test('a subagent model the server accepts but fails at run time is refused with the reason', () => {
  assert.throws(() => parseSuperAgentIR({ ...base(), subagents: [{ name: 'word-counter', description: 'd', systemPrompt: 'p', model: 'openrouter/google/gemini-3.8-flash' }] }),
    (e) => e.code === 'BAD_MODEL' && /word-counter/.test(e.message) && /run time/.test(e.message));
});

test('an unknown parent model is refused (the server stores any string)', () => {
  assert.throws(() => parseSuperAgentIR({ ...base(), model: 'anthropic/claude-bogus-0-0' }), code('BAD_MODEL'));
  parseSuperAgentIR({ ...base(), model: 'anthropic/claude-sonnet-5-5' });
  parseSuperAgentIR({ ...base(), model: 'anthropic/claude-sonnet-4-6' });
});

test('Computer and Wait & follow up are switches; their tool ids are not set by hand', () => {
  assert.throws(() => parseSuperAgentIR({ ...base(), tools: ['sandbox_exec'] }), code('BAD_TOOL'));
  assert.throws(() => parseSuperAgentIR({ ...base(), tools: ['wait_until'] }), code('BAD_TOOL'));
  assert.ok(!TOOLS.includes('sandbox_browser'));
  assert.throws(() => parseSuperAgentIR({ ...base(), computer: true }), code('SCHEMA'));
  parseSuperAgentIR({ ...base(), computer: { enabled: true }, followUp: { enabled: true } });
});

test('the compiler emits subagents, the Computer tools and wait_until as the editor saves them', () => {
  const c = compileSuperAgentUpdate({ ...base(), tools: ['web_fetch'], computer: { enabled: true }, followUp: { enabled: true },
    subagents: [{ name: 's', description: 'd', systemPrompt: 'p' }] }, { agentId: 'A1', locationId: 'L' }).body.config;
  assert.deepEqual(c.tools, ['web_fetch', 'sandbox_browser', 'sandbox_file', 'sandbox_exec', 'wait_until']);
  assert.equal(c.computer, null, 'the editor sends computer:null; the server stamps approvalRevision');
  assert.deepEqual(c.subagents, [{ name: 's', description: 'd', systemPrompt: 'p' }]);
  assert.equal(c.model, 'anthropic/claude-sonnet-5-5');
});

test('omitting subagents leaves them out of the PUT (the server keeps omitted keys)', () => {
  const c = compileSuperAgentUpdate(base(), { agentId: 'A1', locationId: 'L' }).body.config;
  assert.equal('subagents' in c, false);
  assert.equal('computer' in c, false);
  assert.deepEqual(compileSuperAgentUpdate({ ...base(), subagents: [] }, { agentId: 'A1', locationId: 'L' }).body.config.subagents, []);
});

test('Computer off sends the tools without the sandbox ids', () => {
  const c = compileSuperAgentUpdate({ ...base(), tools: ['web_fetch'], computer: { enabled: false } }, { agentId: 'A1', locationId: 'L' }).body.config;
  assert.deepEqual(c.tools, ['web_fetch']);
});

test('create accepts subagents, computer, followUp and memoryEnabled (bl-716: proven live 2026-11-08)', () => {
  refuseUnappliedStudioKeys({ ...base(), subagents: [], computer: { enabled: false }, followUp: { enabled: false }, memoryEnabled: true });
  assert.throws(() => refuseUnappliedStudioKeys({ ...base(), notAKey: true }), code('SPEC_KEY_UNAPPLIED'));
});

test('a template create overlays subagents and the switches too', () => {
  const o = templateOverrides({ ...base(), subagents: [], computer: { enabled: true }, tools: ['web_fetch'] });
  assert.deepEqual(o.subagents, []);
  assert.deepEqual(o.tools, ['web_fetch', 'sandbox_browser', 'sandbox_file', 'sandbox_exec']);
});
