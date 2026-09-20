import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, registerTools } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'get_workflow_logs');
const T1 = '01JABCDEFGHJKMNPQRSTVWXYZ0:3f6c1c1e-0000-4000-8000-000000000001:1758300000000';
const T2 = '01JABCDEFGHJKMNPQRSTVWXYZ1:3f6c1c1e-0000-4000-8000-000000000002:1758300000001';
const LOGS = [
  { _id: 'l1', type: 'ai_agent', stepId: 's1', stepName: 'Agent', status: 'success', meta: { actionFrom: { response: { threadId: T1 } } } },
  { _id: 'l2', type: 'ai_agent', stepId: 's2', stepName: 'Agent 2', status: 'waiting', meta: { data: { meta: { threadId: T2 } } } },
  { _id: 'l3', type: 'add_contact_tag', stepId: 's3', status: 'success', meta: { actionFrom: { response: { threadId: 'not-an-agent-row' } } } },
  { _id: 'l4', type: 'ai_agent', stepId: 's4', status: 'failed', meta: {} },
];
function fixture({ trace = { status: 200, ok: true, json: { spans: [{ name: 'llm' }] } } } = {}) {
  const calls = [];
  const gw = { loc: 'L', uid: 'u', call: async (method, path) => {
    calls.push(path);
    if (path.startsWith('/workflows/logs/v2')) return { status: 200, ok: true, json: { logs: LOGS } };
    if (path.startsWith('/workflows/status/search/count-per-step')) return { status: 200, ok: true, json: { counts: [] } };
    if (path.startsWith('/workflows/status/search/workflow-with-filter')) return { status: 200, ok: true, json: { rows: [] } };
    if (path.includes('/agent/L/trace/')) return trace;
    return { status: 404, ok: false, json: {} };
  } };
  return { calls, deps: { state: { tokenFile: '/x' }, makeGw: () => gw } };
}
const traceCalls = (f) => f.calls.filter((p) => p.includes('/trace/'));

test('DEFAULT: ai_agent rows yield agentThreads with the threadId from either location — and NO trace call is made', async () => {
  const f = fixture();
  const r = await tool().handler({ locationId: 'L', workflowId: 'w' }, f.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.agentThreads, [
    { logId: 'l1', stepId: 's1', stepName: 'Agent', status: 'success', threadId: T1 },
    { logId: 'l2', stepId: 's2', stepName: 'Agent 2', status: 'waiting', threadId: T2 },
  ]);
  assert.equal(traceCalls(f).length, 0);
});

test('CONTROL: a non-agent row that happens to carry a threadId is ignored, and an agent row without one is not invented', async () => {
  const r = await tool().handler({ locationId: 'L', workflowId: 'w' }, fixture().deps);
  assert.equal(r.data.agentThreads.some((t) => t.logId === 'l3' || t.logId === 'l4'), false);
});

test('includeAgentTrace WITHOUT executionId is refused before any call', async () => {
  const f = fixture();
  const r = await tool().handler({ locationId: 'L', workflowId: 'w', includeAgentTrace: true }, f.deps);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.equal(f.calls.length, 0);
});

test('includeAgentTrace + executionId fetches one trace per thread, with the thread id path-encoded', async () => {
  const f = fixture();
  const r = await tool().handler({ locationId: 'L', workflowId: 'w', executionId: 'e1', includeAgentTrace: true }, f.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(traceCalls(f), [`/workflow/agent/L/trace/${encodeURIComponent(T1)}`, `/workflow/agent/L/trace/${encodeURIComponent(T2)}`]);
  assert.deepEqual(r.data.agentThreads[0].trace, { spans: [{ name: 'llm' }] });
});

test('a trace that 404s is recorded on that thread as traceError; the logs still return', async () => {
  const f = fixture({ trace: { status: 404, ok: false, json: { message: 'Trace not found for the given thread ID' } } });
  const r = await tool().handler({ locationId: 'L', workflowId: 'w', executionId: 'e1', includeAgentTrace: true }, f.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.agentThreads[0].traceError, { status: 404, message: 'Trace not found for the given thread ID' });
  assert.equal(Object.hasOwn(r.data.agentThreads[0], 'trace'), false);
  assert.equal(r.data.logs.length, 4);
});

test('a workflow with no ai_agent rows has NO agentThreads key — the response shape is unchanged for everyone else', async () => {
  const gw = { loc: 'L', call: async (m, p) => ({ status: 200, ok: true, json: p.startsWith('/workflows/logs/v2') ? { logs: [LOGS[2]] } : (p.includes('count-per-step') ? { counts: [] } : { rows: [] }) }) };
  const r = await tool().handler({ locationId: 'L', workflowId: 'w' }, { state: { tokenFile: '/x' }, makeGw: () => gw });
  assert.equal(Object.hasOwn(r.data, 'agentThreads'), false);
});

// The guard that makes `includeAgentTrace` REACHABLE. Every test above calls tool.handler()
// directly, which bypasses validateRegisteredArgs — so deleting the zod line would leave them all
// green while a real MCP caller got VALIDATION_FAILED. This is the only test that goes through
// registerTools, which is the path the server actually uses.
const viaRegistration = (name, deps) => {
  let wrapped;
  registerTools({ registerTool: (_n, _meta, fn) => { wrapped = fn; } }, deps, [tool()]);
  return async (args) => JSON.parse((await wrapped(args)).content[0].text);
};

test('includeAgentTrace is a DECLARED argument — a real MCP caller can switch it on', async () => {
  const f = fixture();
  const call = viaRegistration('get_workflow_logs', f.deps);
  const r = await call({ locationId: 'L', workflowId: 'w', executionId: 'e1', includeAgentTrace: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.agentThreads[0].trace, { spans: [{ name: 'llm' }] });
  // CONTROL: the unknown-key guard really is running on this path, so the pass above is the
  // schema declaring the key — not the guard being absent.
  const bad = await call({ locationId: 'L', workflowId: 'w', includeAgentTracez: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'VALIDATION_FAILED');
});
