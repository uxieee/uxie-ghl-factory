// create_custom_field_folder.
//
// Two upstream facts drive most of these: the write lives on the AI HOST but on the plain
// Bearer rail (no token-id), and folder reads answer under `customFieldFolders` — reading
// the sibling `customFields` key makes a folder that WAS created look like it never was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = () => TOOLS.find((candidate) => candidate.name === 'create_custom_field_folder');
const AI_BASE = 'https://services.leadconnectorhq.com';

const folder = (id, name, model = 'contact') => ({
  id, model, name, placeholder: '', position: 400, documentType: 'folder',
  locationId: 'LOC', dateAdded: '2026-08-18T19:20:07.100Z', standard: false, scopes: [],
});

function gateway({ existing = [], createResponse, applyCreate = true } = {}) {
  const calls = [];
  const store = [...existing];
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path, body, options) => {
      calls.push({ method, path, body, base: options?.base });
      if (method === 'GET' && path.includes('/customFields/search')) {
        const model = new URL(`https://x${path}`).searchParams.get('model');
        const rows = store.filter((row) => model === 'all' || row.model === model);
        return { status: 200, ok: true, json: { customFieldFolders: rows, totalItems: rows.length } };
      }
      if (method === 'POST' && path === '/locations/LOC/customFields') {
        if (createResponse) return structuredClone(createResponse);
        const created = folder(`fold-${store.length + 1}`, body.name, body.model);
        if (applyCreate) store.push(created);
        return { status: 201, ok: true, json: { customFieldFolder: created } };
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  };
  return { gw, calls, store: () => store };
}

const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });
const wrote = (calls) => calls.filter(({ method }) => method !== 'GET');

test('the write goes to the AI HOST', async () => {
  const { gw, calls } = gateway();
  const result = await tool().handler({ locationId: 'LOC', name: 'Leak Calculator', confirm: true }, deps(gw));
  assert.equal(result.ok, true);
  const post = calls.find(({ method }) => method === 'POST');
  assert.equal(post.base, AI_BASE);
  assert.equal(post.path, '/locations/LOC/customFields');
});

test('the payload is exactly documentType/model/name', async () => {
  const { gw, calls } = gateway();
  await tool().handler({ locationId: 'LOC', name: 'Leak Calculator', confirm: true }, deps(gw));
  const post = calls.find(({ method }) => method === 'POST');
  assert.deepEqual(post.body, { documentType: 'folder', model: 'contact', name: 'Leak Calculator' });
});

test('it runs on the plain Bearer rail — never the dual-credential ai rail', async () => {
  // The captured browser call carried a token-id, but the endpoint accepts Bearer alone
  // (verified live by removing the header). Asking for rail:'ai' would demand an
  // agency-admin credential this write never needed and lock out every JWT-only caller.
  const seen = [];
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path) => (method === 'GET' && path.includes('/customFields/search')
      ? { status: 200, ok: true, json: { customFieldFolders: [] } }
      : { status: 201, ok: true, json: { customFieldFolder: folder('f1', 'X') } }),
  };
  await tool().handler({ locationId: 'LOC', name: 'X', confirm: true },
    { state: {}, makeGw: (opts) => { seen.push(opts); return gw; } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].rail, undefined, 'must not request the ai rail');
});

test('model defaults to contact and opportunity is accepted', async () => {
  const { gw, calls } = gateway();
  await tool().handler({ locationId: 'LOC', name: 'A', confirm: true }, deps(gw));
  assert.equal(calls.find(({ method }) => method === 'POST').body.model, 'contact');

  const second = gateway();
  await tool().handler({ locationId: 'LOC', name: 'B', model: 'opportunity', confirm: true }, deps(second.gw));
  assert.equal(second.calls.find(({ method }) => method === 'POST').body.model, 'opportunity');
});

test('any other model is refused locally, before a write is spent', async () => {
  const { gw, calls } = gateway();
  const result = await tool().handler(
    { locationId: 'LOC', name: 'A', model: 'business', confirm: true }, deps(gw));
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.match(result.detail, /"contact" or "opportunity"/);
  assert.deepEqual(calls, [], 'a bad model must not cost a request at all');
});

test('a blank name is refused', async () => {
  const { gw, calls } = gateway();
  const result = await tool().handler({ locationId: 'LOC', name: '   ', confirm: true }, deps(gw));
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.deepEqual(wrote(calls), []);
});

test('preview lists the existing folders and writes nothing', async () => {
  const { gw, calls } = gateway({ existing: [folder('f1', 'General Info'), folder('f2', 'Deal Data', 'opportunity')] });
  const result = await tool().handler({ locationId: 'LOC', name: 'Leak Calculator' }, deps(gw));
  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(result.data.preview.creates, { name: 'Leak Calculator', model: 'contact', documentType: 'folder' });
  assert.deepEqual(result.data.preview.existingFolders.map((f) => f.name), ['General Info']);
  assert.deepEqual(wrote(calls), []);
});

test('a duplicate name is caught BEFORE the write, and names the existing id', async () => {
  const { gw, calls } = gateway({ existing: [folder('fold-9', 'Leak Calculator')] });
  const result = await tool().handler({ locationId: 'LOC', name: 'Leak Calculator', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.match(result.detail, /already exists \(id fold-9\)/);
  assert.deepEqual(result.data.preview.alreadyExists, { id: 'fold-9', name: 'Leak Calculator', model: 'contact' });
  assert.deepEqual(wrote(calls), [], 'a known collision must not be sent');
});

test('the same name under a DIFFERENT model is not a collision', async () => {
  const { gw } = gateway({ existing: [folder('fold-9', 'Leak Calculator', 'opportunity')] });
  const result = await tool().handler(
    { locationId: 'LOC', name: 'Leak Calculator', model: 'contact', confirm: true }, deps(gw));
  assert.equal(result.ok, true);
});

test('a server-side uniqueness loss still reports the existing id, not a bare 400', async () => {
  // The pre-check can lose a race; the server is the authority and hands back existingId.
  const { gw } = gateway({
    createResponse: {
      status: 400, ok: false,
      json: { statusCode: 400, message: 'Folder already exists', meta: { existingId: 'fold-race' } },
    },
  });
  const result = await tool().handler({ locationId: 'LOC', name: 'Leak Calculator', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.match(result.detail, /already exists \(id fold-race\)/);
  assert.equal(result.data.existingId, 'fold-race');
});

test('the created record is returned and verified by read-back', async () => {
  const { gw } = gateway();
  const result = await tool().handler({ locationId: 'LOC', name: 'Leak Calculator', confirm: true }, deps(gw));
  assert.equal(result.ok, true);
  assert.equal(result.data.verified, true);
  assert.equal(result.data.folderId, 'fold-1');
  assert.equal(result.data.folder.name, 'Leak Calculator');
  assert.equal(result.data.folder.documentType, 'folder');
});

test('a create that does not land on read-back is reported, not claimed', async () => {
  const { gw } = gateway({ applyCreate: false });
  const result = await tool().handler({ locationId: 'LOC', name: 'Leak Calculator', confirm: true }, deps(gw));
  assert.equal(result.ok, true);
  assert.equal(result.data.verified, false);
  assert.match(result.data.note, /did not appear/);
});

test('a 2xx with no record fails loudly rather than inventing an id', async () => {
  const { gw } = gateway({ createResponse: { status: 201, ok: true, json: {} } });
  const result = await tool().handler({ locationId: 'LOC', name: 'Leak Calculator', confirm: true }, deps(gw));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ENGINE_ABORT');
  assert.match(result.remediation, /second folder of the same name/);
});

test('folder reads use customFieldFolders, not the sibling customFields key', async () => {
  // Reading `customFields` for a folder query returns an empty array, which reads exactly
  // like "the folder was never created". This cost a wrong conclusion during capture.
  const gw = {
    loc: 'LOC',
    uid: 'USER',
    call: async (method, path) => {
      if (method === 'GET' && path.includes('/customFields/search')) {
        return { status: 200, ok: true, json: { customFields: [], customFieldFolders: [folder('f1', 'Existing')] } };
      }
      return { status: 201, ok: true, json: { customFieldFolder: folder('f2', 'New') } };
    },
  };
  const result = await tool().handler({ locationId: 'LOC', name: 'New' }, deps(gw));
  assert.deepEqual(result.data.preview.existingFolders.map((f) => f.name), ['Existing'],
    'the folder list was read from the wrong response key');
});

test('the tool declares no DELETE capability', () => {
  assert.equal((tool().capabilities ?? []).some((c) => c.method === 'DELETE'), false);
});
