// rename_workflow: GHL's dedicated rename route, batch, preview-then-confirm, folder refusal, read-back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'rename_workflow');
function fakeGw({ folders = ['F1'], store = { W1: { name: 'Old one', version: 3, status: 'published' }, W2: { name: 'Old two', version: 1, status: 'draft' } }, ignore = new Set() } = {}) {
  const calls = [];
  const gw = {
    uid: 'U',
    async call(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'GET' && /\/list\?type=directory/.test(path)) return { ok: true, status: 200, json: { rows: folders.map((id) => ({ id, name: `folder ${id}`, type: 'directory' })) } };
      const m = /\/workflow\/[^/]+\/([^/?]+)(\?|$)/.exec(path);
      if (method === 'GET' && m && store[m[1]]) return { ok: true, status: 200, json: { _id: m[1], ...store[m[1]] } };
      const r = /\/rename-workflow\/([^/?]+)$/.exec(path);
      if (method === 'PUT' && r) { if (!ignore.has(r[1])) store[r[1]].name = body.name; return { ok: true, status: 200, json: { msg: 'ok' } }; }
      return { ok: false, status: 404, json: 'Not Found' };
    },
  };
  return { gw, calls, store };
}
const run = (args, gw) => tool.handler({ locationId: 'LOC', ...args }, { state: {}, makeGw: () => gw });
const writes = (calls) => calls.filter((c) => c.method !== 'GET');

test('preview by default: old -> new pairs, nothing written', async () => {
  const { gw, calls } = fakeGw();
  const r = await run({ renames: [{ workflowId: 'W1', name: '01 | Lead | New one' }] }, gw);
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(r.data.preview.renames.map((p) => [p.nameBefore, p.nameAfter]), [['Old one', '01 | Lead | New one']]);
  assert.equal(writes(calls).length, 0);
});

test('a FOLDER id is refused by name before anything is sent', async () => {
  const { gw, calls } = fakeGw();
  const r = await run({ renames: [{ workflowId: 'F1', name: 'x' }], confirm: true }, gw);
  assert.equal(r.ok, false);
  assert.match(r.detail, /FOLDERS, not workflows/);
  assert.equal(writes(calls).length, 0);
});

test('an empty or whitespace name is refused locally', async () => {
  const { gw, calls } = fakeGw();
  const r = await run({ renames: [{ workflowId: 'W1', name: '   ' }], confirm: true }, gw);
  assert.equal(r.ok, false);
  assert.match(r.detail, /empty or whitespace/);
  assert.equal(calls.length, 0);
});

test('confirmed: renames through the dedicated route and verifies by read-back', async () => {
  const { gw, calls, store } = fakeGw();
  const r = await run({ renames: [{ workflowId: 'W1', name: 'New one' }, { workflowId: 'W2', name: 'New two' }], confirm: true }, gw);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.renamedCount, 2);
  assert.deepEqual(writes(calls).map((c) => [c.method, c.path, c.body]), [
    ['PUT', '/workflow/LOC/rename-workflow/W1', { name: 'New one' }],
    ['PUT', '/workflow/LOC/rename-workflow/W2', { name: 'New two' }],
  ]);
  assert.equal(store.W1.name, 'New one');
  assert.ok(!writes(calls).some((c) => c.path === '/workflow/LOC/W1'), 'never the full-document PUT');
});

test('a rename that does not read back is reported, and a partial batch says the others landed', async () => {
  const { gw } = fakeGw({ ignore: new Set(['W2']) });
  const r = await run({ renames: [{ workflowId: 'W1', name: 'A' }, { workflowId: 'W2', name: 'B' }], confirm: true }, gw);
  assert.equal(r.ok, false);
  assert.match(r.detail, /1 of 2 .*partial batch/);
  assert.deepEqual(r.data.results.map((x) => x.renamed), [true, false]);
});
