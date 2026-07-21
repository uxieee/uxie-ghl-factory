import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);
const convai = { name: 'Preview ConvAI', mode: 'suggestive', channels: ['SMS'] };
const voiceai = { agentName: 'Preview VoiceAI', agentPrompt: 'Use only test data.' };
const studio = { name: 'Preview Studio', systemPrompt: 'Use only test data.', buildPrompt: 'Build a test-only agent.' };

test('all AI create tools preview compiled plans without constructing a gateway or writing', async () => {
  let gatewayConstructed = false;
  const deps = { state: {}, makeGw: () => { gatewayConstructed = true; throw new Error('preview must not create gateway'); } };
  const cases = [
    ['create_convai_agent', { locationId: 'L', spec: convai }],
    ['create_voiceai_agent', { locationId: 'L', spec: voiceai }],
    ['create_studio_agent', { locationId: 'L', companyId: 'A', spec: studio }],
  ];
  for (const [name, args] of cases) {
    const result = await tool(name).handler(args, deps);
    assert.equal(result.ok, false, name);
    assert.equal(result.code, 'CONFIRM_REQUIRED', name);
    assert.ok(result.data.preview.create.path.startsWith('/'), name);
    assert.ok(Array.isArray(result.data.preview.followUps), name);
  }
  assert.equal(gatewayConstructed, false);
});

test('AI create descriptions disclose proof status honestly (all three live-proven 2026-07-21)', () => {
  assert.match(tool('create_convai_agent').description, /live-roundtrip/i);
  assert.match(tool('create_voiceai_agent').description, /live-proven end-to-end/i);
  assert.match(tool('create_studio_agent').description, /live-proven end-to-end/i);
});

// Studio verification must assert ONLY identity fields (name, systemPrompt), never the
// AI-generated triggers/actions. LIVE-CAUGHT 2026-07-21 (GROM AU): a Studio agent is built
// by the AI from `buildPrompt`, so the server keeps AI-generated triggers (expected [],
// persisted 1) and stores no `actions` key — verifying the whole config produced false
// `config.triggers`/`config.actions` mismatches on a correctly created agent.
import { compileAiAgentPlan } from '../core/tools.mjs';

test('studio verifyExpected is narrowed to identity fields, not AI-owned config', () => {
  const plan = compileAiAgentPlan('studio', {
    locationId: 'L', companyId: 'A',
    spec: { name: 'S', systemPrompt: 'You are a canary.', buildPrompt: 'Build a greeter.' },
  });
  assert.deepEqual(Object.keys(plan.verifyExpected.config).sort(), ['name', 'systemPrompt']);
  assert.equal(plan.verifyExpected.config.name, 'S');
  assert.equal('triggers' in plan.verifyExpected.config, false, 'must not assert AI-generated triggers');
  assert.equal('actions' in plan.verifyExpected.config, false, 'must not assert a non-persisted actions key');
  // The follow-up PUT still sends the FULL config — we just do not verify what we did not author.
  assert.ok(plan.followUps[0].body.config, 'follow-up still carries the full config');
});

// Studio must accept EITHER buildPrompt or systemPrompt alone — requiring both, with an
// error naming the omitted one, read as contradictory (2026-07-21). Both roles preserved
// when both are supplied.
test('studio compiles from buildPrompt alone (systemPrompt derived)', () => {
  const plan = compileAiAgentPlan('studio', { locationId: 'L', companyId: 'A',
    spec: { name: 'S', buildPrompt: 'Build a greeter.' } });
  assert.ok(plan.create.body.message.includes('Build a greeter.'));
  assert.equal(plan.verifyExpected.config.systemPrompt, 'Build a greeter.');
});

test('studio compiles from systemPrompt alone (buildPrompt derived)', () => {
  const plan = compileAiAgentPlan('studio', { locationId: 'L', companyId: 'A',
    spec: { name: 'S', systemPrompt: 'You are a greeter.' } });
  assert.ok(plan.create.body.message.includes('You are a greeter.'));
  assert.equal(plan.verifyExpected.config.systemPrompt, 'You are a greeter.');
});

test('studio keeps both distinct when both supplied', () => {
  const plan = compileAiAgentPlan('studio', { locationId: 'L', companyId: 'A',
    spec: { name: 'S', buildPrompt: 'Build a greeter.', systemPrompt: 'You are a greeter.' } });
  assert.ok(plan.create.body.message.includes('Build a greeter.'));
  assert.equal(plan.verifyExpected.config.systemPrompt, 'You are a greeter.');
});
