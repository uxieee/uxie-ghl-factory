import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuperAgentIR, refuseUnappliedStudioKeys, CREATE_KEYS, IRError } from './studio-ir.mjs';
import { compileSuperAgentUpdate, templateOverrides } from './studio-compiler.mjs';

// bl-716 (2026-11-08 differential): a config PUT carrying memoryEnabled:true switches memory on, read back on a separate
// GET, so create_studio_agent accepts memoryEnabled and writes it into the config PUT.

const base = () => ({ name: 'TEST-CONF-W9-COURSES-memory', systemPrompt: 'test agent' });
const code = (c) => (e) => e instanceof IRError && e.code === c;

test('memoryEnabled is a create key', () => {
  assert.ok(CREATE_KEYS.includes('memoryEnabled'));
});

test('create accepts memoryEnabled (no SPEC_KEY_UNAPPLIED)', () => {
  refuseUnappliedStudioKeys({ ...base(), memoryEnabled: true });
  refuseUnappliedStudioKeys({ ...base(), memoryEnabled: false });
});

test('memoryEnabled must be a boolean', () => {
  assert.throws(() => parseSuperAgentIR({ ...base(), memoryEnabled: 'yes' }), code('SCHEMA'));
});

test('a template create overlays memoryEnabled into the config', () => {
  assert.equal(templateOverrides({ ...base(), memoryEnabled: true }).memoryEnabled, true);
  assert.equal(templateOverrides({ ...base(), memoryEnabled: false }).memoryEnabled, false);
});

test('a template create without memoryEnabled leaves the key out of the overlay', () => {
  assert.equal('memoryEnabled' in templateOverrides(base()), false);
});

test('a from-scratch config PUT carries memoryEnabled only when the spec sets it', () => {
  const on = compileSuperAgentUpdate({ ...base(), memoryEnabled: true }, { agentId: 'A1', locationId: 'L' }).body.config;
  assert.equal(on.memoryEnabled, true);
  const none = compileSuperAgentUpdate(base(), { agentId: 'A1', locationId: 'L' }).body.config;
  assert.equal('memoryEnabled' in none, false);
});

// QA FAIL #2 (w9-m1): a read-back that does not carry memoryEnabled true must NOT report verified:true. Driven through
// executeAgentPlan with a stub gateway: the build saves agent ag-1, the config PUT is accepted, and the separate GET
// reads memory OFF.
import { executeAgentPlan } from './driver.mjs';
import { compileAiAgentPlan } from '../../mcp-internal/core/tools.mjs';

test('from-scratch studio create: a read-back with memory off is verified:false (memoryEnabled true authored)', async () => {
  const plan = compileAiAgentPlan('studio', {
    locationId: 'L', companyId: 'A',
    spec: { name: 'S', systemPrompt: 'You are a canary.', buildPrompt: 'Build a greeter.', memoryEnabled: true },
  });
  const done = [{ event: 'agent_saved', data: { id: 'ag-1' } }, { event: 'done', data: {} }];
  const readOff = { id: 'ag-1', status: 'draft', config: { name: 'S', systemPrompt: 'You are a canary.', memoryEnabled: false, tools: [], triggers: [], plugins: [] } };
  const gw = {
    loc: 'L',
    stream: async () => ({ ok: true, status: 200, events: done, terminal: done.at(-1) }),
    call: async (method) => (method === 'GET' ? { ok: true, status: 200, json: readOff } : { ok: true, status: 200, json: {} }),
  };
  const result = await executeAgentPlan({ plan, gw });
  assert.equal(result.verification?.verified, false, JSON.stringify(result.verification));
  assert.ok(result.verification.mismatches.some((m) => /memoryEnabled/.test(m)), JSON.stringify(result.verification.mismatches));
});

test('from-scratch studio create: a read-back with memory on is verified:true on memoryEnabled (control)', async () => {
  const plan = compileAiAgentPlan('studio', {
    locationId: 'L', companyId: 'A',
    spec: { name: 'S', systemPrompt: 'You are a canary.', buildPrompt: 'Build a greeter.', memoryEnabled: true },
  });
  const done = [{ event: 'agent_saved', data: { id: 'ag-1' } }, { event: 'done', data: {} }];
  const readOn = { id: 'ag-1', status: 'draft', config: { name: 'S', systemPrompt: 'You are a canary.', memoryEnabled: true } };
  const gw = {
    loc: 'L',
    stream: async () => ({ ok: true, status: 200, events: done, terminal: done.at(-1) }),
    call: async (method) => (method === 'GET' ? { ok: true, status: 200, json: readOn } : { ok: true, status: 200, json: {} }),
  };
  const result = await executeAgentPlan({ plan, gw });
  assert.ok(result.verification.confirmed.some((c) => /memoryEnabled/.test(c)), JSON.stringify(result.verification));
});
