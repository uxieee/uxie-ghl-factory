// W6 item 11: the folder tools read ONE page asking limit=200 — a folder past the first page was "not found". They now
// share the engine's complete folder walk (folders.mjs readAllFolders).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const folders = Array.from({ length: 150 }, (_, i) => ({ _id: `F${i}`, name: `Folder ${i}`, type: 'directory', parentId: null }));
const gw = () => ({ loc: 'L', uid: 'U', readBackUntil: async (fn) => ({ hit: await fn() }), call: async (m, p) => {
  if (m === 'GET' && p.includes('type=directory')) {
    const q = new URLSearchParams(p.split('?')[1]);
    const off = Number(q.get('offset') ?? 0), lim = Math.min(Number(q.get('limit') ?? 100), 100);   // the list serves ≤100 a page
    return { ok: true, status: 200, json: { rows: folders.slice(off, off + lim), count: folders.length } };
  }
  if (m === 'GET') return { ok: true, status: 200, json: { _id: 'W1', name: 'W', status: 'draft', parentId: null } };
  return { ok: true, status: 200, json: {} };
} });

test('move_workflows finds a target folder past the first page', async () => {
  const t = TOOLS.find((x) => x.name === 'move_workflows');
  const r = await t.handler({ locationId: 'L', workflowIds: ['W1'], parentId: 'F149' }, { state: {}, makeGw: gw });
  assert.doesNotMatch(JSON.stringify(r), /destination folder id does not exist/, JSON.stringify(r).slice(0, 300));
});
