import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeAgentPlan, extractAgentId } from './driver.mjs';

const callResponse = (json, status = 200) => ({ status, ok: status >= 200 && status < 300, json });

test('extracts the live-recorded create id shapes for ConvAI, VoiceAI, and Studio SSE', () => {
  assert.equal(extractAgentId('convai', callResponse({ id: 'conv-1' })), 'conv-1');
  assert.equal(extractAgentId('voiceai', callResponse({ _id: 'voice-1' })), 'voice-1');
  assert.equal(extractAgentId('studio', { terminal: { data: { agentId: 'studio-1' } } }), 'studio-1');
});

test('executes create and actions, then re-reads and compares persisted state', async () => {
  const calls = [];
  const gw = {
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path === '/ai-employees/employees') return callResponse({ id: 'conv-1' }, 201);
      if (path === '/ai-employees/actions') return callResponse({ id: `action-${calls.length}` }, 201);
      if (path === '/ai-employees/employees/conv-1') return callResponse({ locationId: 'L', employeeName: 'Agent', mode: 'suggestive' });
      throw new Error('unexpected call');
    },
  };
  const result = await executeAgentPlan({
    gw,
    plan: {
      create: { method: 'POST', path: '/ai-employees/employees', body: { locationId: 'L', employeeName: 'Agent', mode: 'suggestive' } },
      actions: [{ method: 'POST', path: '/ai-employees/actions', body: { employeeId: null, name: 'handover' } }],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.agentId, 'conv-1');
  assert.deepEqual(result.actionIds, ['action-2']);
  assert.equal(calls[1].body.employeeId, 'conv-1');
  assert.equal(calls.at(-1).method, 'GET');
});

test('preserves the created agent and ids for completed actions when a later action fails', async () => {
  let actionCalls = 0;
  const gw = {
    call: async (_method, path) => {
      if (path === '/voice-ai/agents') return callResponse({ _id: 'voice-1' }, 201);
      actionCalls++;
      if (actionCalls <= 3) return callResponse({ id: `action-${actionCalls}` }, 201);
      return callResponse({ message: 'action rejected' }, 422);
    },
  };
  const result = await executeAgentPlan({
    gw,
    plan: {
      create: { method: 'POST', path: '/voice-ai/agents', body: { locationId: 'L' } },
      actions: ['first', 'second', 'third', 'fourth', 'fifth'].map((name) => ({ method: 'POST', path: '/voice-ai/actions', body: { agentId: null, name } })),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, 'action');
  assert.equal(result.agentId, 'voice-1');
  assert.deepEqual(result.actionIds, ['action-1', 'action-2', 'action-3']);
  assert.deepEqual(result.actions.at(-1), { index: 3, path: '/voice-ai/actions', status: 422, id: null });
});
