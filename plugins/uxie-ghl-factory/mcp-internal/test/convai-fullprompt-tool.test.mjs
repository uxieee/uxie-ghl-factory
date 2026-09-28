// Handler tests for update_convai_agent's fullPrompt rule (t19): the refusal returns the stored prompt and sends NO PUT;
// a fullPrompt write is PUT whole, read back, and the result names the owner. The compiler side is in convai-compiler.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'update_convai_agent');
const RECORD = { id: 'A1', locationId: 'L', name: 'Bot', botType: 'PROMPT_BASED_BOT', mode: 'off', channels: ['SMS'], personality: 'p', goal: 'g', instructions: 'old',
  fullPrompt: '## Instructions\n\nold' };
function deps(record) {
  let stored = structuredClone(record); const calls = [];
  const gw = { loc: 'L', uid: 'u', call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') return { ok: true, status: 200, json: structuredClone(stored) };
    // The measured server: with a fullPrompt stored, the three fields do not move.
    if (method === 'PUT') { const frozen = stored.fullPrompt ? { personality: stored.personality, goal: stored.goal, instructions: stored.instructions } : {}; stored = { ...stored, ...body, ...frozen, name: body.employeeName ?? stored.name }; return { ok: true, status: 200, json: { success: true } }; }
    return { ok: false, status: 405, json: {} };
  } };
  return { calls, d: { makeGw: () => gw, state: {} } };
}

test('three fields on a fullPrompt agent: FULLPROMPT_OWNS_PROMPT, currentFullPrompt returned, one GET and no PUT', async () => {
  const { calls, d } = deps(RECORD);
  const out = await tool.handler({ locationId: 'L', agentId: 'A1', spec: { instructions: 'new' }, confirm: true }, d);
  assert.equal(out.code, 'FULLPROMPT_OWNS_PROMPT'); assert.equal(out.data.currentFullPrompt, RECORD.fullPrompt);
  assert.deepEqual(calls.map((c) => c.method), ['GET']);
});

test('spec.fullPrompt: PUT whole, read back verified, promptOwner fullPrompt', async () => {
  const { calls, d } = deps(RECORD);
  const out = await tool.handler({ locationId: 'L', agentId: 'A1', spec: { fullPrompt: '## Instructions\n\nnew' }, confirm: true }, d);
  assert.equal(out.ok, true, JSON.stringify(out)); assert.equal(out.data.promptOwner, 'fullPrompt');
  const put = calls.find((c) => c.method === 'PUT'); assert.equal(put.body.fullPrompt, '## Instructions\n\nnew');
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PUT', 'GET']);
});

test('CONTROL: an agent without fullPrompt still takes instructions, promptOwner fields', async () => {
  const { fullPrompt, ...rec } = RECORD; const { d } = deps(rec);
  const out = await tool.handler({ locationId: 'L', agentId: 'A1', spec: { instructions: 'new' }, confirm: true }, d);
  assert.equal(out.ok, true, JSON.stringify(out)); assert.equal(out.data.promptOwner, 'fields');
});
