// W6 item 11: folder placement at build time — spec keys folderPath (outermost first) and createFolderIfMissing.
// GHL honours parentId on the create POST (live 2026-10-30, knowledge sniffs/workflows-w6b-2026-10-30), so the build files
// the workflow there; the auto-save body carries the same parentId so the save cannot move it back to the root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orchestrate } from './orchestrate.mjs';
import { resolveFolderPath } from './folders.mjs';

const FOLDERS = [
  { _id: 'A', name: 'Clients', type: 'directory', parentId: null },
  { _id: 'B', name: 'Acme', type: 'directory', parentId: 'A' },
  { _id: 'C', name: 'Dup', type: 'directory', parentId: 'A' },
  { _id: 'D', name: 'Dup', type: 'directory', parentId: 'A' },
];

function mock({ folders = FOLDERS, pageSize = 100 } = {}) {
  const calls = [];
  let n = 0;
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/list?') && path.includes('type=directory')) {
      const q = new URLSearchParams(path.split('?')[1]);
      const off = Number(q.get('offset') ?? 0), lim = Number(q.get('limit') ?? pageSize);
      return { ok: true, status: 200, json: { rows: folders.slice(off, off + Math.min(lim, pageSize)), count: folders.length } };
    }
    if (method === 'POST' && path.endsWith('/directory')) { n += 1; return { ok: true, status: 200, json: { id: `NEW${n}` } }; }
    if (method === 'POST' && /\/workflow\/LOC$/.test(path)) return { ok: true, status: 200, json: { id: 'WID' } };
    if (method === 'POST' && path.includes('/validate-workflows')) return { ok: true, status: 200, json: { valid: true } };
    if (method === 'GET' && path.match(/\/tags$/)) return { ok: true, status: 200, json: { tags: [] } };
    return { ok: true, status: 200, json: {} };
  };
  return { gw: { call, loc: 'LOC', uid: 'UID' }, calls };
}
const spec = (extra) => ({ name: 'W', triggers: [], graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'T', attributes: { tags: ['x'] } }], ...extra });
const posts = (calls, re) => calls.filter((c) => c.method === 'POST' && re.test(c.path));

test('resolveFolderPath: exact names level by level; missing tail reported; duplicate name at one level refused', () => {
  assert.deepEqual(resolveFolderPath(FOLDERS, ['Clients', 'Acme']), { ids: ['A', 'B'], missing: [] });
  assert.deepEqual(resolveFolderPath(FOLDERS, ['Clients', 'New', 'Deeper']), { ids: ['A'], missing: ['New', 'Deeper'] });
  assert.throws(() => resolveFolderPath(FOLDERS, ['Clients', 'Dup']), (e) => e.code === 'FOLDER_AMBIGUOUS' && /C, D/.test(e.message));
});

test('an existing path files the workflow by parentId on create AND on the auto-save, creating no folder', async () => {
  const { gw, calls } = mock();
  const r = await orchestrate(spec({ folderPath: ['Clients', 'Acme'] }), gw);
  assert.equal(r.aborted, null);
  assert.equal(posts(calls, /\/directory$/).length, 0);
  assert.equal(posts(calls, /\/workflow\/LOC$/)[0].body.parentId, 'B');
  assert.equal(calls.find((c) => c.method === 'PUT' && c.path.includes('/auto-save')).body.parentId, 'B');
  assert.deepEqual(r.folder, { path: ['Clients', 'Acme'], id: 'B', created: [] });
});

test('a missing segment without createFolderIfMissing is refused before ANY write', async () => {
  const { gw, calls } = mock();
  const r = await orchestrate(spec({ folderPath: ['Clients', 'New'] }), gw);
  assert.equal(r.failurePhase, 'folder_resolution');
  assert.match(r.aborted, /FOLDER_MISSING.*New/);
  assert.equal(calls.some((c) => c.method !== 'GET'), false);
});

test('createFolderIfMissing creates the missing levels in order, after every check, nested under the last existing one', async () => {
  const { gw, calls } = mock();
  const r = await orchestrate(spec({ folderPath: ['Clients', 'New', 'Deeper'], createFolderIfMissing: true }), gw);
  const dirs = posts(calls, /\/directory$/);
  assert.deepEqual(dirs.map((c) => [c.body.name, c.body.parentId, c.body.type]), [['New', 'A', 'directory'], ['Deeper', 'NEW1', 'directory']]);
  const idx = (re) => calls.findIndex((c) => c.method === 'POST' && re.test(c.path));
  assert.ok(idx(/\/directory$/) > idx(/\/validate-assets$/), 'folders after the reference check');
  assert.equal(posts(calls, /\/workflow\/LOC$/)[0].body.parentId, 'NEW2');
  assert.deepEqual(r.folder.created, [{ name: 'New', id: 'NEW1' }, { name: 'Deeper', id: 'NEW2' }]);
});

test('an ambiguous path is refused before any write; a dry run reports the folders it would create and makes none', async () => {
  const a = mock();
  const r1 = await orchestrate(spec({ folderPath: ['Clients', 'Dup'] }), a.gw);
  assert.match(r1.aborted, /FOLDER_AMBIGUOUS/);
  assert.equal(a.calls.some((c) => c.method !== 'GET'), false);
  const b = mock();
  const r2 = await orchestrate(spec({ folderPath: ['Clients', 'New'], createFolderIfMissing: true }), b.gw, { dryRun: true });
  assert.deepEqual(r2.check.wouldCreate.folders, ['New']);
  assert.equal(posts(b.calls, /\/directory$/).length, 0);
});

test('the folder list is walked past one page (the old read stopped at 200 rows)', async () => {
  const many = [...Array.from({ length: 250 }, (_, i) => ({ _id: `F${i}`, name: `Folder ${i}`, type: 'directory', parentId: null })),
    { _id: 'LAST', name: 'Target', type: 'directory', parentId: null }];
  const { gw } = mock({ folders: many, pageSize: 100 });
  const r = await orchestrate(spec({ folderPath: ['Target'] }), gw);
  assert.equal(r.folder.id, 'LAST');
});

test('folderPath is validated: 1–10 non-empty strings, createFolderIfMissing boolean', async () => {
  for (const bad of [[], [''], Array(11).fill('x'), 'Clients']) {
    const r = await orchestrate(spec({ folderPath: bad }), mock().gw);
    assert.match(String(r.aborted), /folderPath/, JSON.stringify(bad));
  }
});
