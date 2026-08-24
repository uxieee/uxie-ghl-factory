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

test('D1: a nested authored key absent from the re-read is unverified, not a mismatch', async () => {
  const gw = {
    call: async (method, path) => {
      if (path === '/ai-employees/employees') return callResponse({ id: 'conv-1' }, 201);
      if (path === '/ai-employees/employees/conv-1') return callResponse({ config: { name: 'X' } });
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  const result = await executeAgentPlan({
    gw,
    plan: { create: { method: 'POST', path: '/ai-employees/employees', body: {} } },
    verifyExpected: { config: { name: 'X', systemPrompt: 'Y' } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.verification.verified, true);
  assert.deepEqual(result.verification.confirmed, ['config.name']);
  assert.deepEqual(result.verification.unverified, ['config.systemPrompt']);
  assert.deepEqual(result.verification.mismatches, []);
});

test('D3: created but re-read confirms nothing is inconclusive, not a success', async () => {
  const gw = {
    call: async (method, path) => {
      if (path === '/ai-employees/employees') return callResponse({ id: 'conv-1' }, 201);
      if (path === '/ai-employees/employees/conv-1') return callResponse({ unrelated: true });
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  const result = await executeAgentPlan({
    gw,
    plan: { create: { method: 'POST', path: '/ai-employees/employees', body: {} } },
    verifyExpected: { name: 'X', systemPrompt: 'Y' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AGENT_VERIFY_INCONCLUSIVE');
  assert.equal(result.agentId, 'conv-1');
  assert.equal(result.verification.verified, false);
  assert.deepEqual(result.verification.confirmed, []);
});

test('D2: recovers the Studio id from agent_saved when the terminal done frame omits it', () => {
  const response = {
    terminal: { event: 'done', data: { durationMs: 16553, mode: 'build' } },
    events: [
      { event: 'conversation_started', data: { conversationId: 'c-1' } },
      { event: 'agent_saved', data: { id: 'studio-42' } },
      { event: 'done', data: { durationMs: 16553, mode: 'build' } },
    ],
  };
  assert.equal(extractAgentId('studio', response), 'studio-42');
});

test('D2: AGENT_ID_MISSING reports a payload-free event map for cleanup', async () => {
  const gw = {
    call: async () => callResponse({}, 200),
    stream: async () => ({
      status: 200,
      ok: true,
      terminal: { event: 'done', data: {} },
      events: [
        { event: 'output_delta', data: 'a generated prompt fragment that must not leak' },
        { event: 'done', data: { mode: 'build' } },
      ],
    }),
  };
  const result = await executeAgentPlan({
    gw,
    plan: { create: { method: 'POST', path: '/agent-studio/super-agents/build', body: {} } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AGENT_ID_MISSING');
  assert.deepEqual(result.events, [
    { event: 'output_delta', id: null },
    { event: 'done', id: null },
  ]);
});

// ── Voice AI: flat write, nested read ────────────────────────────────────────────────────
// LIVE 2026-08-25: a create->update->verify run that persisted every field reported 22
// confirmed / 37 unverified, because the PUT is flat and the GET nests under `agentSettings`.
// The shapes below are copied from that live re-read.
test('voiceai verify sees fields nested under agentSettings', async () => {
  const gw = { call: async (method, path) => {
    if (path === '/voice-ai/agents') return callResponse({ _id: 'agent1' }, 201);
    return callResponse({
      _id: 'agent1', agentName: 'Probe', locationId: 'loc1',
      agentSettings: {
        voice: { voiceId: 'g6xIsTj2HwM6VR4iXFCw', name: 'Jessica', provider: 'RETELL' },
        language: { code: 'en-US', name: 'English' },
        voiceModel: 'auto', responsiveness: 1, interruptionSensitivity: 0.75,
        sttMode: 'accurate', ringDurationMs: 5000, maxCallDuration: 900,
      },
    });
  } };
  const plan = {
    create: { method: 'POST', path: '/voice-ai/agents', body: { locationId: 'loc1' } },
    followUps: [], actions: [],
    verifyExpected: {
      agentName: 'Probe',
      voiceId: 'g6xIsTj2HwM6VR4iXFCw',   // sent flat, read as agentSettings.voice.voiceId
      language: 'en-US',                  // sent flat, read as agentSettings.language.code
      voiceModel: 'auto',                 // sent flat, read under agentSettings
      responsiveness: 1,
      sttMode: 'accurate',
      ringDurationSeconds: 5,             // sent in SECONDS, read as ringDurationMs 5000
      maxCallDuration: 900,
    },
  };
  const out = await executeAgentPlan({ plan, gw });
  assert.equal(out.ok, true);
  assert.deepEqual(out.verification.mismatches, []);
  assert.deepEqual(out.verification.unverified, [],
    'every flat field must resolve against the nested read — none may fall through to unverified');
  for (const k of ['voiceId', 'language', 'voiceModel', 'responsiveness', 'sttMode',
                   'ringDurationSeconds', 'maxCallDuration']) {
    assert.ok(out.verification.confirmed.includes(k), `${k} should be confirmed, not unverified`);
  }
});

test('a genuinely wrong nested value is now a mismatch, not an unverified', async () => {
  // The point of normalising: a real failure in those 37 fields must be VISIBLE. Before the
  // fix it was reported as `unverified`, indistinguishable from "the read does not expose it".
  const gw = { call: async (method, path) => {
    if (path === '/voice-ai/agents') return callResponse({ _id: 'agent1' }, 201);
    return callResponse({ _id: 'agent1', agentName: 'Probe',
                          agentSettings: { voiceModel: 'auto', sttMode: 'fast' } });
  } };
  const plan = {
    create: { method: 'POST', path: '/voice-ai/agents', body: { locationId: 'loc1' } },
    followUps: [], actions: [],
    verifyExpected: { agentName: 'Probe', sttMode: 'accurate' },  // server says 'fast'
  };
  const out = await executeAgentPlan({ plan, gw });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'AGENT_VERIFICATION_FAILED');
  assert.ok(out.verification.mismatches.includes('sttMode'),
    'a wrong nested value must surface as a mismatch');
});

test('normalising is voiceai-only — convai reads are untouched', async () => {
  const gw = { call: async (method, path) => {
    if (path === '/ai-employees/employees') return callResponse({ id: 'emp1' }, 201);
    return callResponse({ id: 'emp1', name: 'Bot', agentSettings: { voiceModel: 'auto' } });
  } };
  const plan = {
    create: { method: 'POST', path: '/ai-employees/employees', body: { locationId: 'loc1' } },
    followUps: [], actions: [],
    verifyExpected: { name: 'Bot', voiceModel: 'auto' },
  };
  const out = await executeAgentPlan({ plan, gw });
  assert.ok(out.verification.unverified.includes('voiceModel'),
    'convai must NOT be flattened — its agentSettings is not the same contract');
});
