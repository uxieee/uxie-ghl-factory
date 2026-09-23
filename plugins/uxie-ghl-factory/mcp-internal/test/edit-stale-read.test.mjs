// The stale-read gate (editing.md, "The stale-read window") refuses an edit authored against a graph
// that has moved since this project last read it. Two false refusals, both measured live 2026-09-23:
//   - a VERSION that moved while the GRAPH did not (publish, unpublish, a settings save, this plugin's
//     own writes) refused the agent's next edit, though the commit carries the current document and
//     nothing anyone wrote could be lost;
//   - re-reading with export_workflow, which the docs name as a read, left the old snapshot in place,
//     so the remediation "re-read it" never cleared the refusal.
// The refusal itself must survive both fixes: a graph that DID move is still PREVIEW_STALE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS } from '../core/tools.mjs';
import { readCache } from '../core/read-cache.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const TAG = (tags) => ({ id: 't1', type: 'add_contact_tag', name: 'Tag', next: null, parent: null, parentKey: null, order: 0,
  attributes: { type: 'add_contact_tag', tags } });

function gateway(templates, version) {
  let current = { _id: 'WID', id: 'WID', name: 'Flow', status: 'published', version, workflowData: { templates: structuredClone(templates) } };
  const calls = [];
  const gw = {
    uid: 'UID',
    call: async (method, path, body) => {
      calls.push({ method, path });
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { ok: true, status: 200, json: structuredClone(current) };
      if (method === 'GET' && path.includes('sticky-notes-all')) return { ok: true, status: 200, json: { data: [], count: 0 } };
      if (method === 'GET' && path.includes('/trigger')) return { ok: true, status: 200, json: { triggers: [] } };
      if (method === 'GET' && path.includes('/customFields/search')) return { ok: true, status: 200, json: { customFields: [] } };
      if (method === 'GET' && path.includes('/customValues')) return { ok: true, status: 200, json: { customValues: [] } };
      if (method === 'GET' && path.includes('/tags')) return { ok: true, status: 200, json: { tags: [] } };
      if (method === 'POST' && path.endsWith('/validate-assets')) return { ok: true, status: 200, json: { errors: [], warnings: [] } };
      if (method === 'PUT' && path === '/workflow/LOC/WID') {
        current = { ...current, ...structuredClone(body), version: current.version + 1 };
        return { ok: true, status: 200, json: structuredClone(current) };
      }
      return { ok: true, status: 200, json: {} };
    },
  };
  return { gw, calls, put: () => calls.filter((c) => c.method === 'PUT').length };
}
const project = () => ({ tokenFile: join(mkdtempSync(join(tmpdir(), 'ghl-stale-')), 'tok.txt') });
const edit = (gw, state, extra = {}) => tool('edit_workflow').handler({ locationId: 'LOC', workflowId: 'WID', confirm: true,
  ops: [{ op: 'modifyStep', stepId: 't1', attrPatch: { tags: ['after'] } }], ...extra }, { makeGw: () => gw, state });

test('a version that moved while no step did is NOT stale: the edit proceeds and says why', async () => {
  const state = project();
  readCache(state).write('LOC', 'WID', { version: 3, templates: [TAG(['before'])], triggers: [] });
  const { gw, put } = gateway([TAG(['before'])], 5);
  const r = await edit(gw, state);
  assert.equal(r.ok, true, `${r.code} ${String(r.detail).slice(0, 300)}`);
  assert.equal(put(), 1);
  assert.ok((r.data?.warnings ?? []).some((w) => /VERSION MOVED 3 -> 5/.test(w)), JSON.stringify(r.data?.warnings));
});

test('a graph that DID move since the last read is still PREVIEW_STALE, and nothing is written', async () => {
  const state = project();
  readCache(state).write('LOC', 'WID', { version: 3, templates: [TAG(['before'])], triggers: [] });
  const { gw, put } = gateway([TAG(['someone-else'])], 5);
  const r = await edit(gw, state);
  assert.equal(r.code, 'PREVIEW_STALE');
  assert.deepEqual(r.data.driftSinceLastRead.modified, ['t1']);
  assert.equal(put(), 0);
});

test('re-reading with export_workflow clears it, as the remediation says', async () => {
  const state = project();
  readCache(state).write('LOC', 'WID', { version: 3, templates: [TAG(['before'])], triggers: [] });
  const { gw, put } = gateway([TAG(['someone-else'])], 5);
  assert.equal((await edit(gw, state)).code, 'PREVIEW_STALE', 'CONTROL: stale before the re-read');
  const ex = await tool('export_workflow').handler({ locationId: 'LOC', workflowId: 'WID' }, { makeGw: () => gw, state });
  assert.equal(ex.ok, true);
  assert.equal(readCache(state).read('LOC', 'WID').version, 5, 'the export recorded what it read');
  const r = await edit(gw, state);
  assert.equal(r.ok, true, `${r.code} ${String(r.detail).slice(0, 300)}`);
  assert.equal(put(), 1);
});

test('with no recorded graph there is nothing to compare, so a moved version still refuses', async () => {
  const state = project();
  readCache(state).write('LOC', 'WID', { version: 3 });
  const { gw, put } = gateway([TAG(['before'])], 5);
  const r = await edit(gw, state);
  assert.equal(r.code, 'PREVIEW_STALE');
  assert.equal(put(), 0);
});
