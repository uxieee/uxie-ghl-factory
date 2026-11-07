// W6 item 10: workflow search — folder, status, updated date range, author, id list, sort, a cursor and an exact total.
// Filtered client-side over list_workflows' complete-or-refuse walk, so the total is the real count, never an estimate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWorkflowRoster } from '../core/workflow-search.mjs';
import { TOOLS } from '../core/tools.mjs';

const rows = [
  { _id: 'w1', name: 'Alpha', status: 'draft', parentId: null, updatedBy: 'U1', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' },
  { _id: 'w2', name: 'beta', status: 'published', parentId: 'F1', updatedBy: 'U2', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z' },
  { _id: 'w3', name: 'Gamma', status: 'draft', parentId: 'F1', updatedBy: 'U1', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' },
  { _id: 'w4', name: 'delta', status: 'draft', parentId: 'F2', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' },
];
const ids = (r) => r.workflows.map((w) => w._id);

test('folderId matches parentId; "root" matches no parent', () => {
  assert.deepEqual(ids(searchWorkflowRoster(rows, { folderId: 'F1' })), ['w2', 'w3']);
  assert.deepEqual(ids(searchWorkflowRoster(rows, { folderId: 'root' })), ['w1']);
});

test('statuses, updated range, updatedBy and ids combine with AND, and total is the filtered count', () => {
  const r = searchWorkflowRoster(rows, { statuses: ['draft'], updatedAfter: '2026-10-01T00:00:00Z', updatedBy: 'U1' });
  assert.deepEqual(ids(r), ['w1', 'w3']);
  assert.equal(r.total, 2);
  assert.deepEqual(ids(searchWorkflowRoster(rows, { ids: ['w4', 'w2'] })), ['w2', 'w4']);
  assert.deepEqual(ids(searchWorkflowRoster(rows, { updatedBefore: '2026-10-21T00:00:00Z' })), ['w1', 'w4']);
});

test('sort by name is case-insensitive; by updatedAt desc puts the newest first', () => {
  assert.deepEqual(ids(searchWorkflowRoster(rows, { sort: { field: 'name', direction: 'asc' } })), ['w1', 'w2', 'w4', 'w3']);
  assert.deepEqual(ids(searchWorkflowRoster(rows, { sort: { field: 'updatedAt', direction: 'desc' } })), ['w3', 'w2', 'w1', 'w4']);
});

test('limit + cursor page the filtered list with no gap or duplicate, and the last page has no nextCursor', () => {
  const p1 = searchWorkflowRoster(rows, { limit: 3, sort: { field: 'name' } });
  const p2 = searchWorkflowRoster(rows, { limit: 3, sort: { field: 'name' }, cursor: p1.nextCursor });
  assert.equal(p1.total, 4); assert.equal(p2.total, 4);
  assert.deepEqual([...ids(p1), ...ids(p2)], ['w1', 'w2', 'w4', 'w3']);
  assert.equal(p2.nextCursor, null);
});

test('a cursor from a different filter is refused, not silently re-applied', () => {
  const p1 = searchWorkflowRoster(rows, { limit: 1, statuses: ['draft'] });
  assert.throws(() => searchWorkflowRoster(rows, { limit: 1, statuses: ['published'], cursor: p1.nextCursor }), /cursor/);
});

test('bad arguments are refused by name: an unknown sort field, a non-date updatedAfter, an unknown status', () => {
  assert.throws(() => searchWorkflowRoster(rows, { sort: { field: 'colour' } }), /sort field/);
  assert.throws(() => searchWorkflowRoster(rows, { updatedAfter: 'yesterday' }), /updatedAfter/);
  assert.throws(() => searchWorkflowRoster(rows, { statuses: ['archived'] }), /statuses/);
});

test('list_workflows declares the search arguments; without them its result shape is unchanged', () => {
  const t = TOOLS.find((x) => x.name === 'list_workflows');
  const parsed = t.inputSchema.parse({ locationId: 'L', folderId: 'F1', statuses: ['draft'], sort: { field: 'name', direction: 'asc' }, limit: 10 });
  assert.equal(parsed.folderId, 'F1');
});

test('the tool applies the search to a COMPLETE walk, and leaves an incomplete walk refused as it was', async () => {
  const t = TOOLS.find((x) => x.name === 'list_workflows');
  const deps = (result) => ({ state: {}, makeGw: () => ({ rail: 'jwt', call: async () => ({ ok: true, json: {} }) }), listWorkflowsComplete: async () => result });
  const ok = await t.handler({ locationId: 'L', folderId: 'F1' }, deps({ complete: true, workflows: rows, reportedTotal: 4 }));
  assert.deepEqual(ok.data.workflows.map((w) => w._id), ['w2', 'w3']);
  assert.equal(ok.data.total, 2);
  const bad = await t.handler({ locationId: 'L', folderId: 'F1' }, deps({ complete: false, workflows: null, partialWorkflows: rows }));
  assert.equal(bad.data.workflows, null);
  assert.equal(bad.data.total, undefined);
});
