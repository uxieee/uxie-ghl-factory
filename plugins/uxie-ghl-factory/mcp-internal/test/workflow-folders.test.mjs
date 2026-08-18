// The workflow ORGANISATION rail: folders, duplication, filing.
//
// The assertions that matter most here are the ones that pin an upstream quirk the tools
// exist to hide, because each one was a real dead end before it was measured:
//   - folders list under `type=directory`, never `type=folder`
//   - the BATCH move cannot reach root, so root moves must fan out
//   - a move endpoint that answers "Updated successfully" is not evidence of a move
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);

const FOLDERS = [
  { id: 'fold-1', _id: 'fold-1', type: 'directory', name: 'WA staging', parentId: null },
  { id: 'fold-2', _id: 'fold-2', type: 'directory', name: 'Archive', parentId: null },
];

const workflow = (over = {}) => ({
  _id: 'w1', id: 'w1', name: 'Lead intake', status: 'draft', version: 3, parentId: null,
  workflowData: { templates: [{ id: 's1' }, { id: 's2' }] }, ...over,
});

function gateway({
  workflows = { w1: workflow() },
  triggers = {},
  folders = FOLDERS,
  createFolderResponse,
  duplicateResponse = { status: 200, ok: true, json: { id: 'w-new' } },
  moveResponse = { status: 200, ok: true, json: { msg: 'Updated successfully', error: false } },
  applyMoves = true,
} = {}) {
  const calls = [];
  const store = structuredClone(workflows);
  const dirs = structuredClone(folders);
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.startsWith('/workflow/LOC/list')) {
        const url = new URL(`https://x${path}`);
        const parentId = url.searchParams.get('parentId');
        if (url.searchParams.get('type') === 'directory') {
          return { status: 200, ok: true, json: { rows: structuredClone(dirs), count: dirs.length } };
        }
        if (parentId) {
          const rows = Object.values(store).filter((w) => w.parentId === parentId);
          const folder = dirs.find((d) => d.id === parentId);
          return { status: 200, ok: true, json: { rows: structuredClone(rows), count: rows.length, folderName: folder?.name ?? null, folderPerm: 380 } };
        }
        return { status: 200, ok: true, json: { rows: [], count: 0 } };
      }
      if (method === 'GET' && path.startsWith('/workflow/LOC/trigger')) {
        const id = new URL(`https://x${path}`).searchParams.get('workflowId');
        return { status: 200, ok: true, json: { triggers: structuredClone(triggers[id] ?? []) } };
      }
      if (method === 'GET' && /^\/workflow\/LOC\/[^/?]+\?/.test(path)) {
        const id = path.split('/')[3].split('?')[0];
        if (!store[id]) return { status: 404, ok: false, json: { message: 'not found' } };
        return { status: 200, ok: true, json: structuredClone(store[id]) };
      }
      if (method === 'POST' && path === '/workflow/LOC/directory') {
        if (createFolderResponse) return structuredClone(createFolderResponse);
        const id = `fold-${dirs.length + 1}`;
        dirs.push({ id, _id: id, type: 'directory', name: body.name, parentId: body.parentId ?? null });
        return { status: 200, ok: true, json: { id } };
      }
      if (method === 'POST' && path === '/workflow/LOC') {
        const response = structuredClone(duplicateResponse);
        const id = response.json?.id;
        if (id) {
          store[id] = workflow({
            _id: id, id, name: body.new_workflow_name, status: 'draft', version: 1,
            parentId: body.parentId ?? null, originType: 'duplicate-workflow',
          });
          triggers[id] = (triggers[body.workflow_id] ?? []).map((t) => ({ ...t, active: false }));
        }
        return response;
      }
      if (method === 'PUT' && path === '/workflow/LOC/move') {
        if (applyMoves) for (const id of body.workflowIds) if (store[id]) store[id].parentId = body.parentId;
        return structuredClone(moveResponse);
      }
      if (method === 'PUT' && path.startsWith('/workflow/LOC/move-directory/')) {
        const id = path.split('/').at(-1);
        if (applyMoves && store[id]) store[id].parentId = body.parentId ?? null;
        return structuredClone(moveResponse);
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  };
  return { gw, calls, store: () => store, dirs: () => dirs };
}

const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });
const wrote = (calls) => calls.filter(({ method }) => method !== 'GET');

// --- list_workflow_folders --------------------------------------------------------------

test('list_workflow_folders asks for type=directory, never type=folder', async () => {
  const { gw, calls } = gateway();
  const result = await tool('list_workflow_folders').handler({ locationId: 'LOC' }, deps(gw));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.folders.map((f) => f.name), ['WA staging', 'Archive']);
  const listCall = calls.find(({ path }) => path.includes('/list'));
  assert.match(listCall.path, /type=directory/);
  assert.doesNotMatch(listCall.path, /type=folder/,
    'type=folder returns an empty set upstream and reads exactly like "no folders exist"');
});

test('list_workflow_folders with parentId returns the folder NAME and its contents', async () => {
  const { gw } = gateway({ workflows: { w1: workflow({ parentId: 'fold-1' }) } });
  const result = await tool('list_workflow_folders').handler({ locationId: 'LOC', parentId: 'fold-1' }, deps(gw));
  assert.equal(result.ok, true);
  assert.equal(result.data.folderName, 'WA staging');
  assert.deepEqual(result.data.contents.map((row) => row.id), ['w1']);
});

// --- create_workflow_folder -------------------------------------------------------------

test('create_workflow_folder previews without writing', async () => {
  const { gw, calls } = gateway();
  const result = await tool('create_workflow_folder').handler({ locationId: 'LOC', name: 'New' }, deps(gw));
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(wrote(calls), []);
});

test('create_workflow_folder writes the directory body and verifies by read-back', async () => {
  const { gw, calls } = gateway();
  const result = await tool('create_workflow_folder').handler(
    { locationId: 'LOC', name: 'WA staging 2', confirm: true }, deps(gw));
  assert.equal(result.ok, true);
  assert.equal(result.data.verified, true);
  assert.equal(result.data.folder.name, 'WA staging 2');
  const post = calls.find(({ method, path }) => method === 'POST' && path === '/workflow/LOC/directory');
  assert.deepEqual(post.body, { type: 'directory', name: 'WA staging 2', updatedBy: 'USER', parentId: null });
});

test('create_workflow_folder fails loudly when the create returns no id', async () => {
  const { gw } = gateway({ createFolderResponse: { status: 200, ok: true, json: {} } });
  const result = await tool('create_workflow_folder').handler(
    { locationId: 'LOC', name: 'X', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.match(result.remediation, /would create a second one/);
});

test('create_workflow_folder refuses a blank name', async () => {
  const { gw, calls } = gateway();
  const result = await tool('create_workflow_folder').handler(
    { locationId: 'LOC', name: '   ', confirm: true }, deps(gw));
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.deepEqual(wrote(calls), []);
});

// --- duplicate_workflow -----------------------------------------------------------------

test('duplicate_workflow previews the source without writing', async () => {
  const { gw, calls } = gateway({ triggers: { w1: [{ type: 'appointment', active: true }] } });
  const result = await tool('duplicate_workflow').handler(
    { locationId: 'LOC', workflowId: 'w1', newName: 'Copy' }, deps(gw));
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.equal(result.data.preview.source.triggers, 1);
  assert.equal(result.data.preview.creates.status, 'draft');
  assert.deepEqual(wrote(calls), []);
});

test('duplicate_workflow posts only the three fields the endpoint needs', async () => {
  const { gw, calls } = gateway();
  const result = await tool('duplicate_workflow').handler(
    { locationId: 'LOC', workflowId: 'w1', newName: 'Copy', confirm: true }, deps(gw));
  assert.equal(result.ok, true);
  const post = calls.find(({ method, path }) => method === 'POST' && path === '/workflow/LOC');
  // company_id/company_age are accepted upstream but NOT required — verified live by
  // omitting both. The caller is never asked for them and no read is spent fetching them.
  assert.deepEqual(post.body, { new_workflow_name: 'Copy', parentId: null, workflow_id: 'w1' });
});

test('duplicate_workflow returns the clone as a RECORD, not the bare id it is handed', async () => {
  const { gw } = gateway();
  const result = await tool('duplicate_workflow').handler(
    { locationId: 'LOC', workflowId: 'w1', newName: 'Copy', confirm: true }, deps(gw));
  assert.equal(result.data.workflowId, 'w-new');
  assert.equal(result.data.verified, true);
  assert.deepEqual(result.data.workflow, {
    id: 'w-new', name: 'Copy', status: 'draft', version: 1, parentId: null,
    originType: 'duplicate-workflow', steps: 2,
  });
});

test('duplicate_workflow reports that cloned triggers arrive INACTIVE', async () => {
  const { gw } = gateway({ triggers: { w1: [{ type: 'appointment', active: true }] } });
  const result = await tool('duplicate_workflow').handler(
    { locationId: 'LOC', workflowId: 'w1', newName: 'Copy', confirm: true }, deps(gw));
  assert.deepEqual(result.data.triggers, {
    source: 1, clone: 1, match: true, inactive: 1,
    note: 'Cloned triggers land active:false. They fire only after the clone is published.',
  });
});

test('duplicate_workflow can land the clone straight into a folder', async () => {
  const { gw } = gateway();
  const result = await tool('duplicate_workflow').handler(
    { locationId: 'LOC', workflowId: 'w1', newName: 'Copy', parentId: 'fold-1', confirm: true }, deps(gw));
  assert.equal(result.data.workflow.parentId, 'fold-1');
});

test('duplicate_workflow surfaces a missing source before writing', async () => {
  const { gw, calls } = gateway();
  const result = await tool('duplicate_workflow').handler(
    { locationId: 'LOC', workflowId: 'nope', newName: 'Copy', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.deepEqual(wrote(calls), []);
});

// --- move_workflows ---------------------------------------------------------------------

test('move_workflows requires exactly one destination', async () => {
  const { gw, calls } = gateway();
  const none = await tool('move_workflows').handler({ locationId: 'LOC', workflowIds: ['w1'] }, deps(gw));
  assert.equal(none.code, 'VALIDATION_FAILED');
  const both = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: ['w1'], parentId: 'fold-1', toRoot: true }, deps(gw));
  assert.equal(both.code, 'VALIDATION_FAILED');
  assert.deepEqual(wrote(calls), []);
});

test('move_workflows refuses a folder id that does not exist, and lists the real ones', async () => {
  const { gw, calls } = gateway();
  const result = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: ['w1'], parentId: 'fold-nope', confirm: true }, deps(gw));
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.deepEqual(result.data.knownFolders.map((f) => f.name), ['WA staging', 'Archive']);
  assert.deepEqual(wrote(calls), []);
});

test('the preview names the destination FOLDER, not just its id', async () => {
  const { gw, calls } = gateway();
  const result = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: ['w1'], parentId: 'fold-1' }, deps(gw));
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.equal(result.data.preview.destination.name, 'WA staging',
    'a folder id the caller cannot see the name of is how things get filed into the wrong folder');
  assert.deepEqual(wrote(calls), []);
});

test('move_workflows refuses a PUBLISHED workflow unless allowPublished is passed', async () => {
  const { gw, calls } = gateway({ workflows: { w1: workflow({ status: 'published', name: 'LIVE intake' }) } });
  const result = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: ['w1'], parentId: 'fold-1', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.match(result.detail, /PUBLISHED/);
  assert.match(result.detail, /LIVE intake/);
  assert.deepEqual(wrote(calls), [], 'nothing may be written while a published workflow is in the batch');
});

test('allowPublished + confirm lets a published move through', async () => {
  const { gw, store } = gateway({ workflows: { w1: workflow({ status: 'published' }) } });
  const result = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: ['w1'], parentId: 'fold-1', allowPublished: true, confirm: true }, deps(gw));
  assert.equal(result.ok, true);
  assert.equal(store().w1.parentId, 'fold-1');
});

test('a folder move is ONE batch call', async () => {
  const { gw, calls } = gateway({ workflows: { w1: workflow(), w2: workflow({ id: 'w2', _id: 'w2' }) } });
  const result = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: ['w1', 'w2'], parentId: 'fold-1', confirm: true }, deps(gw));
  assert.equal(result.ok, true);
  const moves = calls.filter(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/move');
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].body, { parentId: 'fold-1', type: 'workflow', updatedBy: 'USER', workflowIds: ['w1', 'w2'] });
  assert.equal(calls.some(({ path }) => path.includes('/move-directory/')), false);
});

test('a ROOT move fans out to move-directory — the batch route cannot reach root', async () => {
  const { gw, calls, store } = gateway({
    workflows: { w1: workflow({ parentId: 'fold-1' }), w2: workflow({ id: 'w2', _id: 'w2', parentId: 'fold-1' }) },
  });
  const result = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: ['w1', 'w2'], toRoot: true, confirm: true }, deps(gw));
  assert.equal(result.ok, true);
  assert.equal(calls.some(({ method, path }) => method === 'PUT' && path === '/workflow/LOC/move'), false,
    'the batch move 404s on parentId null, "" and "root" — it must never be used for a root move');
  const fanned = calls.filter(({ path }) => path.includes('/move-directory/'));
  assert.deepEqual(fanned.map(({ path }) => path.split('/').at(-1)), ['w1', 'w2']);
  assert.deepEqual(fanned.map(({ body }) => body), [{ parentId: null }, { parentId: null }]);
  assert.equal(store().w1.parentId, null);
  assert.equal(store().w2.parentId, null);
  assert.deepEqual(result.data.verified.map((row) => row.parentIdAfter), [null, null]);
});

test('a move that acknowledges but does not land fails closed', async () => {
  // "Updated successfully" with nothing actually moved: the exact reason every move is
  // verified by reading parentId back rather than trusting the response.
  const { gw } = gateway({ applyMoves: false });
  const result = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: ['w1'], parentId: 'fold-1', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.equal(result.data.failed.length, 1);
  assert.equal(result.data.verified[0].parentIdAfter, null);
});

test('move_workflows reports before/after parentId for every id it touched', async () => {
  const { gw } = gateway({ workflows: { w1: workflow({ parentId: 'fold-2' }) } });
  const result = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: ['w1'], parentId: 'fold-1', confirm: true }, deps(gw));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.verified, [{
    id: 'w1', name: 'Lead intake', parentIdBefore: 'fold-2', parentIdAfter: 'fold-1',
    readable: true, moved: true,
  }]);
  assert.equal(result.data.movedCount, 1);
});

test('move_workflows refuses an empty id list', async () => {
  const { gw, calls } = gateway();
  const result = await tool('move_workflows').handler(
    { locationId: 'LOC', workflowIds: [], parentId: 'fold-1', confirm: true }, deps(gw));
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.deepEqual(wrote(calls), []);
});

// --- the rail never deletes -------------------------------------------------------------

test('no tool on this rail issues a DELETE', () => {
  for (const name of ['list_workflow_folders', 'create_workflow_folder', 'duplicate_workflow', 'move_workflows']) {
    const methods = (tool(name).capabilities ?? []).map((c) => c.method);
    assert.equal(methods.includes('DELETE'), false, `${name} must not declare a DELETE capability`);
  }
});
