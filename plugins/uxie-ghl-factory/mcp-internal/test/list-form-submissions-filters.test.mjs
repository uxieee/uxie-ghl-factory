// list_form_submissions sends the Submissions tab's own filters (captured from the tab: startAt, endAt, limit, page, productType, q, formId).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'list_form_submissions');
const seen = [];
const deps = { state: {}, makeGw: () => ({ call: async (method, path) => { seen.push({ method, path }); return { ok: true, status: 200, json: { submissions: [], meta: { total: 0 } } }; } }) };

test('the filters go on the query string, in the names the tab uses; unnamed ones are not sent', async () => {
  seen.length = 0;
  const r = await tool.handler({ locationId: 'LOC', formId: 'F1', startAt: '2026-09-01T00:00:00+00:00', endAt: '2026-09-30T22:59:59+00:00', q: 'jane', productType: 'form', page: 2, limit: 5 }, deps);
  assert.equal(r.ok, true);
  const u = new URL(`http://x${seen[0].path}`);
  assert.equal(u.pathname, '/forms/submissions');
  assert.deepEqual(Object.fromEntries(u.searchParams), { locationId: 'LOC', page: '2', limit: '5', formId: 'F1', startAt: '2026-09-01T00:00:00+00:00', endAt: '2026-09-30T22:59:59+00:00', q: 'jane', productType: 'form' });
  seen.length = 0; await tool.handler({ locationId: 'LOC' }, deps);
  assert.deepEqual([...new URL(`http://x${seen[0].path}`).searchParams.keys()].sort(), ['limit', 'locationId', 'page']);
});

test('productType is one of form / survey / quiz', () => {
  const shape = tool.inputSchema.shape ?? tool.inputSchema._def?.shape?.();
  assert.throws(() => shape.productType.parse('webinar'));
  assert.equal(shape.productType.parse('quiz'), 'quiz');
});
