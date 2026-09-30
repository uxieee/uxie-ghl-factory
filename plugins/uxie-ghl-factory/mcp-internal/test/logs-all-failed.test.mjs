// get_workflow_logs eventType 'all_failed': the builder's Execution Logs choice, unknown to the server (answers [] for it, live 2026-09-30).
// The tool expands it into the five failure statuses as REPEATED eventType parameters on logs/v2 (ORed upstream) and leaves the roster unfiltered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, ALL_FAILED_EVENT_TYPES } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'get_workflow_logs');
function fixture() {
  const calls = [];
  const gw = { loc: 'L', uid: 'u', call: async (method, path) => {
    calls.push(path);
    if (path.startsWith('/workflows/logs/v2')) return { status: 200, ok: true, json: [] };
    if (path.startsWith('/workflows/status/search/count-per-step')) return { status: 200, ok: true, json: { counts: [] } };
    if (path.startsWith('/workflows/status/search/workflow-with-filter')) return { status: 200, ok: true, json: { rows: [] } };
    return { status: 404, ok: false, json: {} };
  } };
  return { calls, deps: { state: { tokenFile: '/x' }, makeGw: () => gw } };
}
const q = (path) => new URLSearchParams(path.split('?')[1]);

test('all_failed becomes repeated eventType parameters on logs/v2, and the roster is not sent the pseudo-type', async () => {
  const f = fixture();
  const r = await tool().handler({ locationId: 'L', workflowId: 'w', eventType: 'all_failed' }, f.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  const logs = f.calls.find((p) => p.startsWith('/workflows/logs/v2'));
  assert.deepEqual(q(logs).getAll('eventType'), ALL_FAILED_EVENT_TYPES);
  for (const p of f.calls.filter((c) => c.includes('workflow-with-filter'))) assert.equal(q(p).has('eventType'), false);
});

test('control: any other eventType is sent unchanged, once', async () => {
  const f = fixture();
  await tool().handler({ locationId: 'L', workflowId: 'w', eventType: 'failed' }, f.deps);
  const logs = f.calls.find((p) => p.startsWith('/workflows/logs/v2'));
  assert.deepEqual(q(logs).getAll('eventType'), ['failed']);
});
