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

test('AI create descriptions disclose proof status without overstating unproven creates', () => {
  assert.match(tool('create_convai_agent').description, /live-roundtrip/i);
  assert.match(tool('create_voiceai_agent').description, /NOT live-proven/i);
  assert.match(tool('create_studio_agent').description, /NOT live-proven/i);
});
