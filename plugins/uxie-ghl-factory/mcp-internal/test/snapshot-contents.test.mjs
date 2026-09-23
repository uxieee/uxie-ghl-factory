// get_snapshot_contents (bl-133): the snapshot's OWN contents, from GET /snapshots/{id}/assets on the AI
// rail with companyId; empty categories are named, never dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

test('get_snapshot_contents reads the snapshot on the AI rail with companyId, and names empty categories', async () => {
  const calls = [];
  const gw = (rail) => ({ companyId: null, call: async (m, p) => {
    calls.push({ rail, p });
    if (p.startsWith('/locations/')) return { ok: true, status: 200, json: { location: { companyId: 'CO1' } } };
    if (p.startsWith('/snapshots/S1/assets')) return { ok: true, status: 200, json: { workflow: [{ id: 'w1', name: 'A' }, { id: 'f1', name: 'F', type: 'directory' }], tags: [{ id: 't1', name: 'x' }], pipelines: [] } };
    return { ok: false, status: 404, json: {} };
  } });
  const r = await TOOLS.find((t) => t.name === 'get_snapshot_contents').handler({ locationId: 'L', snapshotId: 'S1' }, { makeGw: (o) => gw(o.rail ?? 'jwt'), state: {} });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.categories, [{ category: 'workflow', count: 2 }, { category: 'tags', count: 1 }]);
  assert.deepEqual(r.data.emptyCategories, ['pipelines']);
  assert.equal(r.data.totalAssets, 3);
  assert.ok(calls.some((c) => c.rail === 'ai' && c.p === '/snapshots/S1/assets?companyId=CO1'));
});
