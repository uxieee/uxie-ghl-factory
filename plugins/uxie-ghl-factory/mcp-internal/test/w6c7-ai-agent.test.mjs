// w6c-7 (plan Task 7, bl-787): the build_workflow preview lists an AI Agent step's unanswered questions (web search, model) as
// openQuestions, and build_workflow accepts a workflow_ab_test spec end to end (the 1bb117e6 gap, QA follow-up). RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const LOC = 'TEST_LOCATION_ID';
const agentSpec = (attrs) => ({ name: 'W7 agent', triggers: [{ ref: 't', type: 'contact_tag', name: 'Tag', filters: [{ field: 'tagsAdded', value: 'x' }] }],
  graph: [{ ref: 'a', kind: 'action', type: 'ai_agent', name: 'Agent', attributes: { prompt: 'Answer', outputFormat: 'text', ...attrs } }] });

test('aiAgentOpenQuestions: a step that names neither web search nor a model lists both as openQuestions', async () => {
  const mod = await import('../../skills/create-ghl-workflow/engine/ai-agent-questions.mjs');
  const qs = mod.aiAgentOpenQuestions(agentSpec({}));
  assert.deepEqual(qs.map((q) => q.field).sort(), ['model', 'webSearch']);
  assert.ok(qs.every((q) => q.step === 'a'), 'each question names its step');
  assert.match(qs.find((q) => q.field === 'webSearch').question, /1¢/);
});

test('aiAgentOpenQuestions: an answered step (nativeTools [] = web search off, and a model) lists nothing', async () => {
  const mod = await import('../../skills/create-ghl-workflow/engine/ai-agent-questions.mjs');
  assert.deepEqual(mod.aiAgentOpenQuestions(agentSpec({ nativeTools: [], model: 'gpt-5-mini' })), []);
  const web = { id: 'web_search', toolName: 'web_search', description: 'Search the web', attributes: {} };
  assert.deepEqual(mod.aiAgentOpenQuestions(agentSpec({ nativeTools: [web], model: 'gpt-5-mini' })), []);
});

test('aiAgentOpenQuestions: an ai_agent nested in a branch is found too', async () => {
  const mod = await import('../../skills/create-ghl-workflow/engine/ai-agent-questions.mjs');
  const spec = { name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [
    { ref: 'b', kind: 'if_else', name: 'Split', branches: [{ ref: 'y', name: 'Yes', conditions: [], then: [
      { ref: 'a', kind: 'action', type: 'ai_agent', name: 'Agent', attributes: { prompt: 'x', outputFormat: 'text' } }] }] }] };
  assert.deepEqual(mod.aiAgentOpenQuestions(spec).map((q) => q.step), ['a', 'a']);
});

test('the build_workflow dry-run preview lists the agent questions as openQuestions', async () => {
  const tool = TOOLS.find((t) => t.name === 'build_workflow');
  const gw = { call: async (method) => (method === 'GET' ? { ok: true, status: 200, json: [] } : { ok: true, status: 200, json: {} }) };
  const out = await tool.handler({ locationId: LOC, spec: agentSpec({}), dryRun: true }, { makeGw: () => gw, state: { allowedLocations: new Set([LOC]) } });
  assert.ok(Array.isArray(out.data?.openQuestions), 'the preview carries an openQuestions list');
  assert.deepEqual(out.data.openQuestions.map((q) => q.field).sort(), ['model', 'webSearch']);
});

test('build_workflow dry run accepts a workflow_ab_test spec end to end: no STEP_TYPE, no abort (the 1bb117e6 gap)', async () => {
  const tool = TOOLS.find((t) => t.name === 'build_workflow');
  const gw = { call: async (method) => (method === 'GET' ? { ok: true, status: 200, json: [] } : { ok: true, status: 200, json: {} }) };
  const abSpec = { name: 'AB tool entry', triggers: [{ ref: 't', type: 'contact_tag', name: 'Tag added',
    filters: [{ field: 'tagsAdded', value: 'TEST-CONF-W6C-ab-entry-' }] }], graph: [{ ref: 'ab', kind: 'ab_test', name: 'A/B Test',
    paths: [{ ref: 'p0', then: [] }, { ref: 'p1', then: [] }, { ref: 'p2', then: [] }],
    metric: { kind: 'event', goal: 'form_submission', goalExtras: { formIds: ['TEST_FORM_ID'] } },
    endCondition: { type: 'contacts', numberOfContacts: 200 }, afterEnd: 'route_to_winner' }] };
  const out = await tool.handler({ locationId: LOC, spec: abSpec, dryRun: true }, { makeGw: () => gw, state: { allowedLocations: new Set([LOC]) } });
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 400));
  const findings = JSON.stringify(out.data?.validation ?? {});
  assert.doesNotMatch(findings, /STEP_TYPE|not a known step type/);
});

// list_ai_agent_skills (plan Task 7): a COMPLETE walk of the skill library (pages of at most 100), and resolve by ids (at most ten).
// Route: GET /workflow/agent/{loc}/skills (paged: ?page&limit&search -> {items, total, page, limit}) and .../skills/resolve?ids=a,b
// (-> {skills, libraryTotal}). Every response is wrapped {success, data}; success:false can arrive with a 2xx. A walk that does not finish
// is reported complete:false, never counted as the whole library.
const skillsTool = () => TOOLS.find((t) => t.name === 'list_ai_agent_skills');
const wrap = (data) => ({ ok: true, status: 200, json: { success: true, data } });
const summary = (i) => ({ id: `doc${i}`, name: `Skill ${i}`, description: 'd', isBuiltin: false });

test('list_ai_agent_skills walks every page (limit 100) and reports the whole library as complete', async () => {
  assert.ok(skillsTool(), 'the tool is registered');
  const calls = [];
  const gw = { call: async (method, path) => {
    calls.push(path);
    const page = Number(new URL(`http://x${path}`).searchParams.get('page') ?? 1);
    const start = (page - 1) * 100;
    const items = Array.from({ length: Math.min(100, 150 - start) }, (_, i) => summary(start + i));
    return wrap({ items, total: 150, page, limit: 100 });
  } };
  const out = await skillsTool().handler({ locationId: LOC }, { makeGw: () => gw, state: {} });
  assert.equal(out.ok, true);
  assert.equal(out.data.skills.length, 150);
  assert.equal(out.data.complete, true);
  assert.ok(calls.every((p) => /limit=100/.test(p)), 'every page asks for 100');
});

test('list_ai_agent_skills reports complete:false when the walk stops short (never a partial count as the whole)', async () => {
  const gw = { call: async (method, path) => {
    const page = Number(new URL(`http://x${path}`).searchParams.get('page') ?? 1);
    return wrap({ items: page === 1 ? Array.from({ length: 100 }, (_, i) => summary(i)) : [], total: 150, page, limit: 100 });
  } };
  const out = await skillsTool().handler({ locationId: LOC }, { makeGw: () => gw, state: {} });
  assert.equal(out.data.complete, false);
  assert.equal(out.data.skills.length, 100);
  assert.equal(out.data.total, 150);
});

test('list_ai_agent_skills resolves at most ten ids; eleven are refused with no call', async () => {
  let calls = 0;
  const gw = { call: async () => { calls += 1; return wrap({ skills: [], libraryTotal: 0 }); } };
  const ids = Array.from({ length: 11 }, (_, i) => `doc${i}`);
  const out = await skillsTool().handler({ locationId: LOC, ids }, { makeGw: () => gw, state: {} });
  assert.equal(out.ok, false);
  assert.equal(calls, 0, 'no request for more than ten ids');
});

test('list_ai_agent_skills resolve: a resolved id is returned; an id GHL does not return is unresolved', async () => {
  const gw = { call: async (method, path) => {
    assert.match(path, /\/skills\/resolve\?ids=doc1%2Cdoc9|\/skills\/resolve\?ids=doc1,doc9/);
    return wrap({ skills: [summary(1)], libraryTotal: 150 });
  } };
  const out = await skillsTool().handler({ locationId: LOC, ids: ['doc1', 'doc9'] }, { makeGw: () => gw, state: {} });
  assert.deepEqual(out.data.resolved.map((s) => s.id), ['doc1']);
  assert.deepEqual(out.data.unresolved, ['doc9']);
});

test('list_ai_agent_skills: a success:false inside a 2xx is a failure, not an empty library', async () => {
  const gw = { call: async () => ({ ok: true, status: 200, json: { success: false, message: 'Not found' } }) };
  const out = await skillsTool().handler({ locationId: LOC }, { makeGw: () => gw, state: {} });
  assert.equal(out.ok, false);
});

// QA follow-up 3 (plan Task 7): the step card says the builder turns web search ON by default for steps made in the UI, at about 1¢ per
// search (1.4¢ on Gemini), and that the engine's default is OFF. The corpus card (type-cards.json) does not carry that; the engine's
// docNote does, and describe_step_type attaches it as engineNote.
test('describe_step_type ai_agent carries the web-search default and its cost in engineNote', async () => {
  const tool = TOOLS.find((t) => t.name === 'describe_step_type');
  const out = await tool.handler({ type: 'ai_agent' }, { makeGw: () => ({}), state: {} });
  assert.equal(out.ok, true);
  const note = out.data?.engineNote ?? '';
  assert.match(note, /turns web search ON by default for steps made in the UI/, 'the UI default is stated');
  assert.match(note, /about 1¢ per search/, 'the cost is stated');
  assert.match(note, /1\.4¢ on Gemini/, 'the Gemini cost is stated');
  assert.match(note, /engine's default is OFF/, 'the engine default is stated');
});
