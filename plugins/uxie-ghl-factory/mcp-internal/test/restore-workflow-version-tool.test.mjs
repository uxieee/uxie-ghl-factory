// restore_workflow_version replays the builder's version-drawer restore (apply-version-to-workflow.ts). A stateful fake
// of the routes keeps the read-back REAL: the tool must see what it wrote, not an echo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { triggerFromVersion, restoreBody, diffVersion } from '../core/version-restore.mjs';

const tool = () => TOOLS.find((t) => t.name === 'restore_workflow_version');
const tA = { id: 's1', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['a'] } };
const tB = { id: 's1', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['b'] } };
const trig = { id: 'T-old', _id: 'T-old', type: 'contact_tag', name: 'On tag', workflow_id: 'W', status: 'draft', conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'x' }], actions: [{ type: 'add_to_workflow', workflow_id: 'W' }] };

function fake({ status = 'draft', name = 'TEST wf', counts = [], version3 = { _id: 'W-3', version: 3, status: 'published', name: 'TEST wf', timezone: 'account', workflowData: { templates: [tA] }, triggersData: [trig], meta: {} } } = {}) {
  let wf = { _id: 'W', name, status, version: 4, updatedBy: 'U', companyId: 'CO', companyAge: 9, timezone: 'account', workflowData: { templates: [tB] }, meta: null };
  let triggers = [structuredClone(trig)]; let n = 0;
  const calls = [];
  const gw = { call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && /\/history-by-number\/3$/.test(path)) return { ok: true, status: 200, json: structuredClone(version3) };
    if (method === 'GET' && /\/history-by-number\//.test(path)) return { ok: false, status: 404, json: {} };
    if (method === 'GET' && path.startsWith('/workflows/status/search/count-per-step')) return { ok: true, status: 200, json: { data: counts } };
    if (method === 'GET' && path.includes('/trigger?')) return { ok: true, status: 200, json: structuredClone(triggers) };
    if (method === 'GET' && /\/workflow\/LOC\/W\?/.test(path)) return { ok: true, status: 200, json: structuredClone(wf) };
    if (method === 'DELETE' && path.includes('/trigger/')) { const id = path.split('/trigger/')[1].split('?')[0]; triggers = triggers.filter((t) => t.id !== id); return { ok: true, status: 200, json: {} }; }
    if (method === 'POST' && path.endsWith('/trigger')) { const id = `T-new-${++n}`; triggers.push({ ...body, id, _id: id }); return { ok: true, status: 200, json: { id } }; }
    if (method === 'PUT' && path === '/workflow/LOC/W') { wf = { ...wf, name: body.name, status: body.status, version: wf.version + 1, workflowData: body.workflowData, meta: body.meta }; return { ok: true, status: 200, json: {} }; }
    return { ok: false, status: 404, json: {} };
  } };
  return { calls, deps: { state: {}, makeGw: () => gw }, wf: () => wf, triggers: () => triggers };
}
const writes = (f) => f.calls.filter((c) => c.method !== 'GET');
const args = (o = {}) => ({ locationId: 'LOC', workflowId: 'W', workflowName: 'TEST wf', version: 3, ...o });

test('without confirm it previews the version, the step diff and the trigger change, and writes NOTHING', async () => {
  const f = fake();
  const r = await tool().handler(args(), f.deps);
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.equal(r.data.preview.restoreVersion, 3);
  assert.equal(r.data.preview.landsAs, 'draft');
  assert.deepEqual(r.data.preview.diff.steps.changed.map((s) => s.id), ['s1']);
  assert.equal(writes(f).length, 0);
});

test('target proof: a wrong name is refused before anything is sent', async () => {
  const f = fake();
  const r = await tool().handler(args({ workflowName: 'other', confirm: true }), f.deps);
  assert.equal(r.ok, false); assert.match(r.error?.message ?? r.message ?? JSON.stringify(r), /target proof failed/);
  assert.equal(writes(f).length, 0);
});

test('the builder\'s own refusals: a PUBLISHED workflow, active contacts, and the current version', async () => {
  for (const [f, a, re] of [[fake({ status: 'published' }), args({ confirm: true }), /PUBLISHED/], [fake({ counts: [{ currentStepId: 's1', total: 2 }] }), args({ confirm: true }), /active/], [fake(), args({ version: 4, confirm: true }), /already on/]]) {
    const r = await tool().handler(a, f.deps);
    assert.equal(r.ok, false); assert.match(JSON.stringify(r), re);
    assert.equal(writes(f).length, 0);
  }
});

test('confirm: triggers deleted then recreated from the version (camel workflowId, inactive draft), document restored as DRAFT, read back verified', async () => {
  const f = fake();
  const r = await tool().handler(args({ confirm: true }), f.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.verified, true);
  const order = writes(f).map((c) => c.method);
  assert.deepEqual(order, ['DELETE', 'POST', 'PUT'], 'the builder\'s order: delete, recreate, then save');
  const post = writes(f)[1].body;
  assert.equal(post.workflowId, 'W'); assert.equal(post.workflow_id, undefined, 'R-95: the create binds from camelCase only');
  assert.equal(post.status, 'draft'); assert.equal(post.active, false); assert.equal(post.id, undefined);
  assert.deepEqual(post.actions, [{ type: 'add_to_workflow', workflow_id: 'W' }]);
  const put = writes(f)[2].body;
  assert.equal(put.isRestoreRequest, true); assert.equal(put.status, 'draft'); assert.equal(put.version, 4);
  assert.equal(put.meta.versionRestore.restoredFromVersion, 'W-3'); assert.equal(put.meta.versionRestore.versionBeforeRestore, 4);
  assert.deepEqual(f.wf().workflowData.templates, [tA]);
});

test('helpers: an inbound webhook keeps its URL (predeterminedId = old id); the diff reports added/removed; the body carries the builder keys', () => {
  const hook = triggerFromVersion({ id: 'H1', type: 'inbound_webhook', workflow_id: 'X' }, { workflowId: 'W' });
  assert.equal(hook.predeterminedId, 'H1'); assert.equal(hook.id, undefined);
  const d = diffVersion({ workflowData: { templates: [{ id: 'a', type: 'x' }] } }, { workflowData: { templates: [{ id: 'b', type: 'y' }] }, triggersData: [] }, []);
  assert.deepEqual(d.steps.added.map((s) => s.id), ['b']); assert.deepEqual(d.steps.removed.map((s) => s.id), ['a']);
  const b = restoreBody({ _id: 'V', workflowData: { templates: [] } }, { name: 'n', targetVersion: 7, userId: 'U', restoredAt: '2026-09-28T00:00:00Z' });
  for (const k of ['isRestoreRequest', 'status', 'workflowData', 'updatedBy', 'version', 'oldTriggers', 'newTriggers', 'triggersChanged', 'modifiedSteps', 'deletedSteps', 'createdSteps', 'meta']) assert.ok(k in b, k);
});
