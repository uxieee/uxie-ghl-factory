// restore_workflow_version asNewWorkflowName = the drawer's "Create new workflow from this version"
// (use-create-new-from-version.ts:54-69). A stateful fake keeps the read-back real; the blank create is
// injected (deps.orchestrate) so the test sees exactly what the tool sends after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { triggerFromVersion } from '../core/version-restore.mjs';

const tool = () => TOOLS.find((t) => t.name === 'restore_workflow_version');
const tA = { id: 's1', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['a'] } };
const tB = { id: 's1', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['b'] } };
const hook = { id: 'H-old', _id: 'H-old', type: 'inbound_webhook', name: 'Hook', workflow_id: 'W', status: 'published', conditions: [], actions: [{ type: 'add_to_workflow', workflow_id: 'W' }] };

function fake({ listed = [{ _id: 'W', name: 'TEST wf' }], sourceStatus = 'published', counts = [{ currentStepId: 's1', total: 3 }], putMangles = false } = {}) {
  const wfs = { W: { _id: 'W', name: 'TEST wf', status: sourceStatus, version: 4, updatedBy: 'U', companyId: 'CO', companyAge: 9, workflowData: { templates: [tB] }, meta: null } };
  let triggers = { W: [structuredClone(hook)] }; let n = 0;
  const version3 = { _id: 'W-3', version: 3, status: 'published', name: 'TEST wf', timezone: 'account', workflowData: { templates: [tA] }, triggersData: [hook], meta: {} };
  const calls = [];
  const gw = { call: async (method, path, body) => {
    calls.push({ method, path, body });
    const m = path.match(/^\/workflow\/LOC\/([^/?]+)(?:\?|$)/);
    if (method === 'GET' && /\/history-by-number\/3$/.test(path)) return { ok: true, status: 200, json: structuredClone(version3) };
    if (method === 'GET' && path.startsWith('/workflow/LOC/list?')) return { ok: true, status: 200, json: { rows: listed.filter((r) => r.name.toLowerCase().includes(new URLSearchParams(path.split('?')[1]).get('search').toLowerCase())) } };
    if (method === 'GET' && path.startsWith('/workflows/status/search/count-per-step')) return { ok: true, status: 200, json: { data: counts } };
    if (method === 'GET' && path.includes('/trigger?')) { const w = new URLSearchParams(path.split('?')[1]).get('workflowId'); return { ok: true, status: 200, json: structuredClone(triggers[w] ?? []) }; }
    if (method === 'GET' && m && wfs[m[1]]) return { ok: true, status: 200, json: structuredClone(wfs[m[1]]) };
    if (method === 'POST' && path === '/workflow/LOC/trigger') { const id = `T-new-${++n}`; (triggers[body.workflowId] ??= []).push({ ...body, id, _id: id }); return { ok: true, status: 200, json: { id } }; }
    if (method === 'PUT' && m && wfs[m[1]]) { const w = wfs[m[1]]; wfs[m[1]] = { ...w, name: putMangles ? 'other' : body.name, status: body.status, version: w.version + 1, workflowData: body.workflowData, meta: body.meta }; return { ok: true, status: 200, json: {} }; }
    return { ok: false, status: 404, json: {} };
  } };
  const builds = [];
  const orchestrate = async (spec) => { builds.push(spec); wfs.N = { _id: 'N', name: spec.name, status: 'draft', version: 2, updatedBy: 'ME', companyId: 'CO', companyAge: 9, workflowData: { templates: [] }, meta: null }; return { wid: 'N' }; };
  return { calls, builds, deps: { state: {}, makeGw: () => gw, orchestrate }, wfs: () => wfs, triggers: () => triggers };
}
const writes = (f) => f.calls.filter((c) => c.method !== 'GET');
const args = (o = {}) => ({ locationId: 'LOC', workflowId: 'W', workflowName: 'TEST wf', version: 3, asNewWorkflowName: 'TEST copy', ...o });

test('without confirm it previews and writes NOTHING (no blank create either)', async () => {
  const f = fake();
  const r = await tool().handler(args(), f.deps);
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.equal(r.data.preview.mode, 'createFromVersion'); assert.equal(r.data.preview.newName, 'TEST copy'); assert.equal(r.data.preview.landsAs, 'draft');
  assert.equal(writes(f).length, 0); assert.equal(f.builds.length, 0);
});

test('a taken name is refused (exact, case- and space-insensitive), and a wrong source name too — nothing sent', async () => {
  for (const [f, a, re] of [
    [fake({ listed: [{ _id: 'W', name: 'TEST wf' }, { _id: 'Z', name: 'test COPY ' }] }), args({ confirm: true }), /already exists/],
    [fake(), args({ asNewWorkflowName: 'TEST wf', confirm: true }), /already exists/],
    [fake(), args({ workflowName: 'nope', confirm: true }), /target proof failed/],
    [fake(), args({ asNewWorkflowName: '   ', confirm: true }), /empty/],
  ]) {
    const r = await tool().handler(a, f.deps);
    assert.equal(r.ok, false); assert.match(JSON.stringify(r), re);
    assert.equal(writes(f).length, 0); assert.equal(f.builds.length, 0);
  }
});

test('a name that only CONTAINS the new name is not a clash', async () => {
  const f = fake({ listed: [{ _id: 'W', name: 'TEST wf' }, { _id: 'Z', name: 'TEST copy 2' }] });
  const r = await tool().handler(args({ confirm: true }), f.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('confirm: the source may be published and busy; blank created, triggers recreated on the NEW id (no predeterminedId), PUT as draft, read back, source untouched', async () => {
  const f = fake();
  const r = await tool().handler(args({ confirm: true }), f.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.verified, true); assert.equal(r.data.sourceUntouched, true);
  assert.deepEqual(f.builds, [{ name: 'TEST copy', triggers: [], graph: [] }]);
  const w = writes(f);
  assert.deepEqual(w.map((c) => `${c.method} ${c.path.split('?')[0]}`), ['POST /workflow/LOC/trigger', 'PUT /workflow/LOC/N'], 'nothing is written to the source');
  assert.equal(w[0].body.workflowId, 'N'); assert.equal(w[0].body.predeterminedId, undefined, 'a new workflow gets a NEW webhook URL');
  assert.equal(w[0].body.active, false); assert.equal(w[0].body.status, 'draft');
  assert.deepEqual(w[0].body.actions, [{ type: 'add_to_workflow', workflow_id: 'N' }]);
  const put = w[1].body;
  assert.equal(put.name, 'TEST copy'); assert.equal(put.status, 'draft'); assert.equal(put.version, 2); assert.equal(put.isRestoreRequest, true);
  assert.equal(put.meta.versionRestore.restoredFromVersion, 'W-3'); assert.equal(put.meta.versionRestore.restoredBy, 'ME');
  assert.deepEqual(f.wfs().N.workflowData.templates, [tA]);
  assert.equal(f.wfs().W.version, 4); assert.deepEqual(f.wfs().W.workflowData.templates, [tB]);
  assert.equal(r.data.to.workflowId, 'N'); assert.equal(r.data.to.triggers.length, 1);
});

test('a read-back that does not match is VERIFY_FAILED, not ok', async () => {
  const f = fake({ putMangles: true });
  const r = await tool().handler(args({ confirm: true }), f.deps);
  assert.equal(r.ok, false); assert.equal(r.code, 'VERIFY_FAILED'); assert.equal(r.data.to.workflowId, 'N');
});

test('triggerFromVersion: sameWorkflow keeps a webhook id, a new workflow drops it (even one carried in the version)', () => {
  assert.equal(triggerFromVersion(hook, { workflowId: 'W' }).predeterminedId, 'H-old');
  assert.equal(triggerFromVersion(hook, { workflowId: 'N', sameWorkflow: false }).predeterminedId, undefined);
  assert.equal(triggerFromVersion({ ...hook, predeterminedId: 'P' }, { workflowId: 'N', sameWorkflow: false }).predeterminedId, undefined);
});
