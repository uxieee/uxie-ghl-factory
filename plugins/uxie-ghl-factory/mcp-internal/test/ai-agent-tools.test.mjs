import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);
const convai = { name: 'Preview ConvAI', mode: 'suggestive', channels: ['SMS'], goal: 'Use only test data.' };
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
  // All three AI create rows are now live-runtime in the matrix (proven end-to-end).
  for (const name of ['create_convai_agent', 'create_voiceai_agent', 'create_studio_agent']) {
    assert.match(tool(name).description, /live-runtime|live-proven/i, name);
    assert.doesNotMatch(tool(name).description, /NOT live-proven/i, name);
  }
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

// T9 (2026-09-28). Live: a new Managed Agent carries the Default plugin with every CRM skill unless told
// otherwise; a schedule runs in the LOCATION's timezone (a once-schedule labelled 17:30 "UTC" fired at 17:30
// Europe/London); a new Voice AI agent saves each call summary as a note on the caller and emails all admins.
test('create_studio_agent preview names the plugin default, and plugins:[] when given (control)', async () => {
  const deps = { state: {}, makeGw: () => { throw new Error('preview must not create gateway'); } };
  const dflt = await tool('create_studio_agent').handler({ locationId: 'L', companyId: 'A', spec: studio }, deps);
  assert.match(dflt.data.preview.defaults.plugins, /ALL built-in CRM skills/);
  const none = await tool('create_studio_agent').handler({ locationId: 'L', companyId: 'A', spec: { ...studio, plugins: [] } }, deps);
  assert.match(none.data.preview.defaults.plugins, /^none/);
});

test('create_studio_agent refuses a schedule labelled with a timezone other than the location\'s, before any write', async () => {
  const calls = [];
  const gw = { call: async (m, p) => { calls.push(`${m} ${p}`); return { ok: true, status: 200, json: { location: { timezone: 'Europe/London' } } }; }, stream: async () => { throw new Error('must not build'); } };
  const deps = { state: {}, makeGw: () => gw };
  const spec = { ...studio, plugins: [], triggers: [{ type: 'schedule', config: { schedule: { mode: 'once', startDate: '2026-12-31', startTime: '17:30', timezone: 'UTC' } } }] };
  const r = await tool('create_studio_agent').handler({ locationId: 'L', companyId: 'A', spec, confirm: true }, deps);
  assert.equal(r.code, 'SCHEDULE_TIMEZONE_MISMATCH');
  assert.match(r.detail, /Europe\/London/);
  assert.deepEqual(calls, ['GET /locations/L']);
});

test('create_studio_agent lets a schedule in the location\'s own timezone through to the build (control)', async () => {
  const calls = [];
  const gw = { call: async (m, p) => { calls.push(`${m} ${p}`); return { ok: true, status: 200, json: { location: { timezone: 'Europe/London' } } }; }, stream: async () => { calls.push('STREAM build'); throw new Error('stop here'); } };
  const deps = { state: {}, makeGw: () => gw };
  const spec = { ...studio, plugins: [], triggers: [{ type: 'schedule', config: { schedule: { mode: 'once', startDate: '2026-12-31', startTime: '17:30', timezone: 'Europe/London' } } }] };
  const r = await tool('create_studio_agent').handler({ locationId: 'L', companyId: 'A', spec, confirm: true }, deps);
  assert.notEqual(r.code, 'SCHEDULE_TIMEZONE_MISMATCH');
  assert.ok(calls.includes('STREAM build') || calls.some((c) => c.startsWith('POST')), JSON.stringify(calls));
});

test('create_voiceai_agent preview names the post-call defaults, and an explicit false when given (control)', async () => {
  const deps = { state: {}, makeGw: () => { throw new Error('preview must not create gateway'); } };
  const dflt = await tool('create_voiceai_agent').handler({ locationId: 'L', spec: voiceai }, deps);
  assert.match(dflt.data.preview.defaults.saveCallSummaryAsNote, /default ON/);
  assert.match(dflt.data.preview.defaults.sendPostCallNotificationTo, /all admins/);
  const off = await tool('create_voiceai_agent').handler({ locationId: 'L', spec: { ...voiceai, postCall: { saveCallSummaryAsNote: false } } }, deps);
  assert.equal(off.data.preview.defaults.saveCallSummaryAsNote, 'false');
});

test('create_studio_agent does not verify a triggerMessage it did not write, and the preview names the default (control: a written one is verified)', async () => {
  const none = compileAiAgentPlan('studio', { locationId: 'L', companyId: 'A', spec: { name: 'S', systemPrompt: 'p', plugins: [], triggers: [{ type: 'chat' }] } });
  assert.equal('triggerMessage' in none.verifyExpected.config.triggers[0], false);
  const given = compileAiAgentPlan('studio', { locationId: 'L', companyId: 'A', spec: { name: 'S', systemPrompt: 'p', plugins: [], triggers: [{ type: 'chat', triggerMessage: 'Hi.' }] } });
  assert.equal(given.verifyExpected.config.triggers[0].triggerMessage, 'Hi.');
  const deps = { state: {}, makeGw: () => { throw new Error('preview must not create gateway'); } };
  const p = await tool('create_studio_agent').handler({ locationId: 'L', companyId: 'A', spec: { name: 'S', systemPrompt: 'p', plugins: [], triggers: [{ type: 'chat' }] } }, deps);
  assert.match(p.data.preview.defaults.triggerMessage, /per-type default/);
});

test('t22: every AI create tool refuses an unapplied spec key with confirm:true, naming the IR code, and builds no gateway', async () => {
  let gatewayConstructed = false;
  const deps = { state: {}, makeGw: () => { gatewayConstructed = true; throw new Error('a refusal must not create a gateway'); } };
  const cases = [
    ['create_convai_agent', { locationId: 'L', confirm: true, spec: { ...convai, emailSettings: {} } }],
    ['create_voiceai_agent', { locationId: 'L', confirm: true, spec: { ...voiceai, voiceId: 'v' } }],
    ['create_studio_agent', { locationId: 'L', companyId: 'A', confirm: true, spec: { ...studio, folderId: 'f' } }],
  ];
  for (const [name, args] of cases) {
    const result = await tool(name).handler(args, deps);
    assert.equal(result.ok, false, name);
    assert.equal(result.code, 'ENGINE_ABORT', name);
    assert.match(result.detail, /create rejected \(SPEC_KEY_UNAPPLIED\)/, name);
    assert.equal(result.data.irCode, 'SPEC_KEY_UNAPPLIED', name);
  }
  assert.equal(gatewayConstructed, false);
  // CONTROL: the same specs without the stray key reach the confirm gate
  const ok = await tool('create_convai_agent').handler({ locationId: 'L', spec: convai }, deps);
  assert.equal(ok.code, 'CONFIRM_REQUIRED');
});
