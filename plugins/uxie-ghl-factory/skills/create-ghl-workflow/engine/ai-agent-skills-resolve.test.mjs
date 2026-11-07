// w6c-7 QA follow-up 2 (plan Task 7): an AI Agent step's skill ids must resolve through the library read when the build has a gateway.
// A non-existent id refuses the build naming it; the service answering success:false or 404 is "unavailable", never "unresolved".
// The dry run carries the agent questions as check.openQuestions (no tools.mjs hunk). RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orchestrate } from './orchestrate.mjs';
import { collectSkillIds, resolveAgentSkills } from './agent-skills.mjs';
import { aiAgentOpenQuestions } from './ai-agent-questions.mjs';

// Same shape as orchestrate-check-first.test.mjs: a recorded call log, empty GET lists, stateless validators.
function mockGateway({ resolve }) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/skills/resolve')) return resolve(path);
    if (method === 'GET' && path.includes('/opportunities/pipelines')) return { ok: true, json: { pipelines: [] } };
    if (method === 'GET' && path.match(/\/tags$/)) return { ok: true, json: { tags: [] } };
    if (method === 'POST' && path.includes('/validate-assets')) return { ok: true, status: 200, json: { errors: [], warnings: [] } };
    if (method === 'POST' && path.includes('/validate-workflows')) return { ok: true, status: 200, json: { valid: true } };
    if (method === 'POST' && path.match(/\/workflow\/[^/]+$/)) return { ok: true, json: { id: 'WID_1' } };
    if (method === 'GET' && path.includes('/workflow/')) return { ok: true, json: { name: 'W', workflowData: { templates: [] } } };
    return { ok: true, json: {} };
  };
  return { gw: { call, loc: 'LOC', uid: 'UID' }, calls };
}
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && !/validate-assets$|validate-workflows$|run-test$/.test(c.path));
const skill = (id) => ({ id, name: `S ${id}` });
const agentSpec = (skills) => ({ name: 'W7 skills', triggers: [{ ref: 't', type: 'contact_tag', name: 'Tag', filters: [{ field: 'tagsAdded', value: 'x' }] }],
  graph: [{ ref: 'a', kind: 'action', type: 'ai_agent', name: 'Agent', attributes: { prompt: 'Answer', outputFormat: 'text', nativeTools: [], model: 'm', skills } }] });

test('collectSkillIds finds every skill id on every ai_agent, at any depth, once each', () => {
  const ir = { graph: [
    { ref: 'a', type: 'ai_agent', attributes: { skills: [skill('d1'), skill('d2')] } },
    { ref: 'b', kind: 'if_else', branches: [{ then: [{ ref: 'c', type: 'ai_agent', attributes: { skills: [skill('d2')] } }] }] },
  ] };
  assert.deepEqual(collectSkillIds(ir).sort(), ['d1', 'd2']);
});

test('resolveAgentSkills: an id the library does not return is unresolved; the rest resolve', async () => {
  const { gw } = mockGateway({ resolve: () => ({ ok: true, status: 200, json: { success: true, data: { skills: [skill('d1')], libraryTotal: 1 } } }) });
  const r = await resolveAgentSkills(agentSpec([skill('d1'), skill('d9')]), gw.call, 'LOC');
  assert.deepEqual(r.unresolved, ['d9']);
  assert.equal(r.unavailable, null);
});

test('resolveAgentSkills: resolves in batches of ten', async () => {
  const seen = [];
  const { gw } = mockGateway({ resolve: (path) => { seen.push(decodeURIComponent(path.split('ids=')[1]).split(',').length);
    return { ok: true, status: 200, json: { success: true, data: { skills: [], libraryTotal: 0 } } }; } });
  const ids = Array.from({ length: 11 }, (_, i) => `d${i}`);
  const r = await resolveAgentSkills(agentSpec(ids.map(skill)), gw.call, 'LOC');
  assert.deepEqual(seen, [10, 1]);
  assert.equal(r.unresolved.length, 11);
});

test('resolveAgentSkills: success:false or a 404 is UNAVAILABLE, never unresolved', async () => {
  for (const resp of [{ ok: true, status: 200, json: { success: false, message: 'Not found' } }, { ok: false, status: 404, json: { success: false, message: 'Not found' } }]) {
    const { gw } = mockGateway({ resolve: () => resp });
    const r = await resolveAgentSkills(agentSpec([skill('d1')]), gw.call, 'LOC');
    assert.ok(r.unavailable, 'reported as unavailable');
    assert.deepEqual(r.unresolved, [], 'and not as unresolved');
  }
});

test('resolveAgentSkills: a spec with no skills makes no call', async () => {
  let n = 0;
  const { gw } = mockGateway({ resolve: () => { n += 1; return { ok: true, json: {} }; } });
  await resolveAgentSkills(agentSpec([]), gw.call, 'LOC');
  assert.equal(n, 0);
});

test('a build with an unresolved skill id is REFUSED before any write, naming the id (failurePhase agent_skills)', async () => {
  const { gw, calls } = mockGateway({ resolve: () => ({ ok: true, status: 200, json: { success: true, data: { skills: [], libraryTotal: 0 } } }) });
  const report = await orchestrate(agentSpec([skill('d9')]), gw, {});
  assert.match(report.aborted ?? '', /unresolved AI Agent skill.*d9/);
  assert.equal(report.failurePhase, 'agent_skills');
  assert.deepEqual(writes(calls), [], 'no workflow, template or tag written');
});

test('a dry run with an unresolved skill id reports it as a failed check (AGENT_SKILLS), with no write', async () => {
  const { gw, calls } = mockGateway({ resolve: () => ({ ok: true, status: 200, json: { success: true, data: { skills: [], libraryTotal: 0 } } }) });
  const report = await orchestrate(agentSpec([skill('d9')]), gw, { dryRun: true });
  assert.equal(report.check.valid, false);
  assert.ok(report.check.errors.some((e) => e.code === 'AGENT_SKILLS'), JSON.stringify(report.check.errors));
  assert.deepEqual(writes(calls), []);
});

test('a dry run whose skill ids all resolve is not refused by the skills check', async () => {
  const { gw } = mockGateway({ resolve: () => ({ ok: true, status: 200, json: { success: true, data: { skills: [skill('d1')], libraryTotal: 1 } } }) });
  const report = await orchestrate(agentSpec([skill('d1')]), gw, { dryRun: true });
  assert.ok(!(report.check.errors ?? []).some((e) => e.code === 'AGENT_SKILLS'), JSON.stringify(report.check.errors));
});

test('the dry-run check carries openQuestions for an agent that names neither web search nor a model', async () => {
  const { gw } = mockGateway({ resolve: () => ({ ok: true, status: 200, json: { success: true, data: { skills: [], libraryTotal: 0 } } }) });
  const spec = agentSpec([]);
  delete spec.graph[0].attributes.nativeTools; delete spec.graph[0].attributes.model;
  const report = await orchestrate(spec, gw, { dryRun: true });
  assert.deepEqual(report.check.openQuestions.map((q) => q.field).sort(), ['model', 'webSearch']);
  assert.deepEqual(aiAgentOpenQuestions(spec).map((q) => q.field).sort(), ['model', 'webSearch']);
});
