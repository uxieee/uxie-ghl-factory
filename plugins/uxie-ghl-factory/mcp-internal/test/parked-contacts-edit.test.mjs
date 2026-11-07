// W6a Task 4 (item 8): on a PUBLISHED workflow an edit that modifies a step contacts are parked on, or inserts a step right
// after one, changes what those contacts do next. Only deletes were warned about; repair warned about nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const STEP = (id, next, parentKey, order, tags) => ({ id, type: 'add_contact_tag', name: `Step ${id}`, next, parentKey, order, attributes: { type: 'add_contact_tag', tags } });
const TEMPLATES = () => [STEP('s1', 's2', null, 0, ['a']), STEP('s2', null, 's1', 1, ['b'])];
function gateway(status, counts) {
  let current = { _id: 'WID', id: 'WID', name: 'Flow', status, version: 3, workflowData: { templates: TEMPLATES() } };
  const calls = [];
  const gw = { uid: 'UID', call: async (method, path, body) => {
    calls.push({ method, path });
    if (path.includes('count-per-step')) return { ok: true, status: 200, json: { counts } };
    if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { ok: true, status: 200, json: structuredClone(current) };
    if (method === 'GET' && path.includes('sticky-notes-all')) return { ok: true, status: 200, json: { data: [], count: 0 } };
    if (method === 'GET' && path.includes('/trigger')) return { ok: true, status: 200, json: { triggers: [] } };
    if (method === 'GET' && path.includes('/customFields/search')) return { ok: true, status: 200, json: { customFields: [] } };
    if (method === 'GET' && path.includes('/customValues')) return { ok: true, status: 200, json: { customValues: [] } };
    if (method === 'GET' && path.includes('/tags')) return { ok: true, status: 200, json: { tags: [] } };
    if (method === 'POST' && path.endsWith('/validate-assets')) return { ok: true, status: 200, json: { errors: [], warnings: [] } };
    if (method === 'PUT') { current = { ...current, ...structuredClone(body), version: current.version + 1 }; return { ok: true, status: 200, json: structuredClone(current) }; }
    return { ok: true, status: 200, json: {} };
  } };
  return { gw, calls };
}
const state = () => ({ tokenFile: join(mkdtempSync(join(tmpdir(), 'ghl-parked-')), 'tok.txt') });
const warningsOf = (r) => [...(r.data?.preview?.warnings ?? []), ...(r.data?.warnings ?? [])];

test('modifying a step contacts are parked on warns EDIT_TOUCHES_PARKED_CONTACTS with the count', async () => {
  const { gw } = gateway('published', [{ currentStepId: 's1', total: 2 }]);
  const r = await tool('edit_workflow').handler({ locationId: 'LOC', workflowId: 'WID',
    ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { tags: ['changed'] } }] }, { makeGw: () => gw, state: state() });
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.ok(warningsOf(r).some((w) => /EDIT_TOUCHES_PARKED_CONTACTS: 2 contact\(s\)/.test(w)), JSON.stringify(warningsOf(r)));
  assert.deepEqual(r.data.preview.parkedOnTouchedSteps, [{ stepId: 's1', name: 'Step s1', parked: 2, why: 'modified' }]);
});

test('inserting right after a parked step warns too', async () => {
  const { gw } = gateway('published', [{ currentStepId: 's1', total: 1 }]);
  const r = await tool('edit_workflow').handler({ locationId: 'LOC', workflowId: 'WID',
    ops: [{ op: 'insertAfter', afterId: 's1', step: { type: 'add_contact_tag', name: 'New', attributes: { tags: ['n'] } } }] }, { makeGw: () => gw, state: state() });
  assert.ok((r.data?.preview?.parkedOnTouchedSteps ?? []).some((p) => p.stepId === 's1' && p.why === 'insert after'), JSON.stringify(r.data?.preview?.parkedOnTouchedSteps ?? r.detail));
});

test('a draft makes no count-per-step read and gets no warning', async () => {
  const { gw, calls } = gateway('draft', [{ currentStepId: 's1', total: 5 }]);
  const r = await tool('edit_workflow').handler({ locationId: 'LOC', workflowId: 'WID',
    ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { tags: ['changed'] } }] }, { makeGw: () => gw, state: state() });
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.equal(calls.some((c) => c.path.includes('count-per-step')), false);
});

test('repair on a published workflow warns about parked contacts on modified and deleted steps', async () => {
  const { gw } = gateway('published', [{ currentStepId: 's1', total: 3 }, { currentStepId: 's2', total: 1 }]);
  const t = TEMPLATES(); t[0] = { ...t[0], next: null, attributes: { ...t[0].attributes, tags: ['changed'] } };
  const r = await tool('repair_workflow').handler({ locationId: 'LOC', workflowId: 'WID', templates: [t[0]] }, { makeGw: () => gw, state: state() });
  const w = warningsOf(r);
  assert.ok(w.some((x) => /EDIT_TOUCHES_PARKED_CONTACTS: 3/.test(x)), JSON.stringify(w));
  assert.ok(w.some((x) => /DELETE_EJECTS_PARKED_CONTACTS: 1/.test(x)), JSON.stringify(w));
});
