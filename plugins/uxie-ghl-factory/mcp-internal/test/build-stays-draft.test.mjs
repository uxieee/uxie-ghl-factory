// bl-1028 (orchestrator 2026-11-10, SAFETY): build_workflow must leave EVERY flow type in draft, checked on a separate GET, and never
// publish without the two-step gate. Measured 2026-11-10: a TEST-CONF agent-type flow (workflowType 'agent', one unbound conv_ai_trigger)
// built by build_workflow read back as PUBLISHED straight after the build. Our create and autosave bodies say status 'draft'; GHL
// publishes the agent-type flow on save. The fake gateway below models that measured behaviour: an autosave with workflowType 'agent'
// reads back published, and a change-status to draft clears it. The plain build is the control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const buildTool = () => TOOLS.find((candidate) => candidate.name === 'build_workflow');

function gateway() {
  const state = { status: 'draft', templates: [], workflowType: undefined, triggers: [], calls: [] };
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path, body) => {
      state.calls.push({ method, path });
      if (path.includes('/opportunities/pipelines')) return { status: 200, ok: true, json: { pipelines: [] } };
      if (path.includes('/calendars/')) return { status: 200, ok: true, json: { calendars: [] } };
      if (path.includes('/users/')) return { status: 200, ok: true, json: { users: [] } };
      if (path.includes('/forms/')) return { status: 200, ok: true, json: { forms: [] } };
      if (path.includes('/customFields/search')) return { status: 200, ok: true, json: { customFields: [] } };
      if (path.includes('/voice-ai/agents') || path.includes('/ai-employees/agents')) return { status: 404, ok: false, json: {} };
      if (method === 'GET' && path === '/locations/LOC/tags') return { status: 200, ok: true, json: { tags: [{ name: 'existing-tag' }] } };
      if (method === 'POST' && path === '/workflow/LOC') return { status: 201, ok: true, json: { id: 'WID_1', status: 'draft' } };
      if (method === 'PUT' && path === '/workflow/LOC/WID_1/auto-save') {
        state.templates = body.workflowData.templates;
        state.workflowType = body.workflowType;
        // The measured behaviour: an agent-type flow is published by GHL on save.
        if (body.workflowType === 'agent') state.status = 'published';
        return { status: 200, ok: true, json: {} };
      }
      if (method === 'POST' && path === '/workflow/LOC/trigger') {
        state.triggers.push(body);
        return { status: 201, ok: true, json: { id: `tr-${state.triggers.length}` } };
      }
      if (method === 'GET' && path === '/workflow/LOC/trigger?workflowId=WID_1') return { status: 200, ok: true, json: { triggers: state.triggers } };
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID_1?')) {
        return { status: 200, ok: true, json: { _id: 'WID_1', id: 'WID_1', name: 'x', status: state.status, version: 2, workflowType: state.workflowType,
          workflowData: { templates: state.templates } } };
      }
      if (method === 'PUT' && path === '/workflow/LOC/change-status') {
        if (body.status === 'draft') state.status = 'draft';
        return { status: 200, ok: true, json: {} };
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  };
  return { gw, state };
}
const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });

const plainSpec = () => ({
  name: 'Plain draft', triggers: [],
  graph: [{ ref: 'tag', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['existing-tag'] } }],
});
const agentSpec = () => ({
  name: 'Agent draft', workflowType: 'agent',
  triggers: [{ ref: 'ft', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [] }],
  graph: [{ ref: 'm', kind: 'action', type: 'conversationai_custom_message', name: 'Conformance message',
    attributes: { message: 'draft check', waitForReply: false } }],
});

test('control: a plain build reads back draft on a separate GET', async () => {
  const { gw } = gateway();
  const r = await buildTool().handler({ locationId: 'LOC', spec: plainSpec(), ignoreUnresolved: false }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const after = await gw.call('GET', '/workflow/LOC/WID_1?includeScheduledPauseInfo=true');
  assert.equal(after.json.status, 'draft');
});

test('bl-1028: an agent-type build leaves the flow in DRAFT, checked on a separate GET', async () => {
  const { gw } = gateway();
  const r = await buildTool().handler({ locationId: 'LOC', spec: agentSpec(), ignoreUnresolved: false }, deps(gw));
  assert.equal(r.ok, true, `precondition: the agent-type build must succeed: ${JSON.stringify(r).slice(0, 300)}`);
  const after = await gw.call('GET', '/workflow/LOC/WID_1?includeScheduledPauseInfo=true');
  assert.equal(after.json.status, 'draft', 'build_workflow must not leave an agent-type flow published: it has no publish step and never publishes');
});
