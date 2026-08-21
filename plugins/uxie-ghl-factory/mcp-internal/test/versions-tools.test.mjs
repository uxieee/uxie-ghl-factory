import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);
function gwStub(routes = {}) {
  const calls = [];
  return {
    calls, loc: 'L', uid: 'u',
    call: async (method, path) => {
      calls.push({ method, path });
      for (const [fragment, response] of Object.entries(routes)) {
        if (!path.includes(fragment)) continue;
        return response && typeof response === 'object' && 'ok' in response ? response : { status: 200, ok: true, json: response };
      }
      return { status: 404, ok: false, json: { message: `no stub for ${path}` } };
    },
  };
}
const deps = (gw) => ({ state: { tokenFile: '/x' }, makeGw: () => gw });

// LIVE shapes (GROM AU 2026-08-22): history/v2 → {data:[record…], nextPage:-1}; history → [record…];
// history-by-number/{n} → the full snapshot incl. workflowData.templates (ids are `{wid}-{n}`).
const rec = (n, extra = {}) => ({ _id: `w1-${n}`, id: `w1-${n}`, workflowId: 'w1', version: n, status: n === 2 ? 'published' : 'draft', name: 'WF', updatedBy: 'U', updatedAt: `2026-08-2${n}T00:00:00.000Z`, createdAt: `2026-08-2${n}T00:00:00.000Z`, filePath: `location/L/workflows/w1/${n}`, ...extra });

test('both version tools exist, are read-only, and declare the four history endpoints', () => {
  const a = tool('list_workflow_versions'), b = tool('get_workflow_version');
  assert.ok(a && b);
  assert.deepEqual(a.capabilities.map((c) => `${c.method} ${c.path}`), ['GET /workflow/{loc}/{wid}/history', 'GET /workflow/{loc}/{wid}/history/v2']);
  assert.deepEqual(b.capabilities.map((c) => `${c.method} ${c.path}`), ['GET /workflow/{loc}/{wid}/history-by-number/{n}', 'GET /workflow/{loc}/{wid}/history/{versionId}']);
});

test('list_workflow_versions pages history/v2 by default and walks /history with all:true', async () => {
  const gw = gwStub({ '/history/v2?limit=20': { data: [rec(2, { meta: { versionRestore: { restoredFromVersion: 1 } } }), rec(1)], nextPage: -1 }, '/history': [rec(2), rec(1)] });
  const r = await tool('list_workflow_versions').handler({ locationId: 'L', workflowId: 'w1' }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.count, 2); assert.equal(r.data.nextPage, -1);
  assert.deepEqual(r.data.versions[0], { versionId: 'w1-2', version: 2, status: 'published', name: 'WF', updatedBy: 'U', updatedAt: '2026-08-22T00:00:00.000Z', createdAt: '2026-08-22T00:00:00.000Z', isRestore: { restoredFromVersion: 1 } });
  assert.match(gw.calls[0].path, /\/workflow\/L\/w1\/history\/v2\?limit=20$/);
  const gw2 = gwStub({ '/history': [rec(1)] });
  const r2 = await tool('list_workflow_versions').handler({ locationId: 'L', workflowId: 'w1', all: true }, deps(gw2));
  assert.equal(r2.ok, true); assert.equal(r2.data.nextPage, null); assert.match(gw2.calls[0].path, /\/history$/);
});

test('get_workflow_version fetches by number (history-by-number) or by id (history/{id}) and returns the snapshot graph + settings', async () => {
  const snap = rec(1, { workflowData: { templates: [{ id: 's1', type: 'sms' }] }, allowMultiple: true, timezone: 'contact', window: { condition: 'when', start: '08:00', end: '17:00', days: [1] } });
  const gw = gwStub({ '/history-by-number/1': snap, '/history/w1-1': snap });
  const r = await tool('get_workflow_version').handler({ locationId: 'L', workflowId: 'w1', version: 1 }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.stepCount, 1); assert.equal(r.data.versionId, 'w1-1'); assert.equal(r.data.settings.timezone, 'contact'); assert.equal(r.data.settings.window.start, '08:00');
  assert.match(gw.calls[0].path, /history-by-number\/1$/);
  const r2 = await tool('get_workflow_version').handler({ locationId: 'L', workflowId: 'w1', versionId: 'w1-1' }, deps(gw));
  assert.equal(r2.ok, true); assert.match(gw.calls[1].path, /history\/w1-1$/);
  const r3 = await tool('get_workflow_version').handler({ locationId: 'L', workflowId: 'w1' }, deps(gw));
  assert.equal(r3.ok, false, 'needs version or versionId');
});
