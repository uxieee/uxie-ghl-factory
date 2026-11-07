// W6 item 9: get_workflow_logs read ONE logs/v2 page (limit default 20) and said nothing when more rows existed — silent
// truncation. A full page now says logsComplete:false and names the tools that walk the whole log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'get_workflow_logs');
const gwWith = (n) => ({ loc: 'L', uid: 'U', call: async (m, p) => {
  if (p.startsWith('/workflows/logs/v2')) return { ok: true, status: 200, json: { logs: Array.from({ length: n }, (_, i) => ({ _id: `r${i}`, status: 'success', type: 'sms', createdAt: '2026-10-29T00:00:00Z' })) } };
  return { ok: true, status: 200, json: {} };
} });
const run = (n, limit) => tool.handler({ locationId: 'L', workflowId: 'W', limit }, { state: {}, makeGw: () => gwWith(n) });

test('a full page (rows == limit) is flagged logsComplete:false with a pointer to the full walk', async () => {
  const r = await run(5, 5);
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
  assert.equal(r.data.logsComplete, false);
  assert.match(r.data.logsNote, /get_workflow_runtime_window|get_workflow_step_counts/);
});

test('a short page is logsComplete:true', async () => {
  const r = await run(3, 5);
  assert.equal(r.data.logsComplete, true);
});

test('logs/v2 caps a page at 100 rows whatever limit asks (live 2026-10-30): 100 rows at limit 500 is NOT complete', async () => {
  const r = await run(100, 500);
  assert.equal(r.data.logsComplete, false);
});
