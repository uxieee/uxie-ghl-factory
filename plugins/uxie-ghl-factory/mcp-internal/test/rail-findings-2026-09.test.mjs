// The 2026-09-06 rail findings, tool side (backlog 10, 21, 23, 26, 27, 29, 30). Each test names the
// finding it pins; the engine-side halves live beside the engine (edit-op-strictness.test.mjs,
// field-caps.test.mjs, edit.test.mjs, lints/*.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

const tool = (name) => TOOLS.find((candidate) => candidate.name === name);
const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw, now: '2026-09-06T10:00:00.000Z' });

const templates = () => [
  { id: 's1', type: 'add_contact_tag', name: 'Head', next: 's2', parentKey: null, order: 0, attributes: { tags: ['a'] } },
  { id: 's2', type: 'wait', name: 'Wait a day', next: 's3', parentKey: 's1', order: 1, attributes: { type: 'time', startAfter: { type: 'days', value: 1, when: 'after' } } },
  { id: 's3', type: 'add_contact_tag', name: 'Tail', next: null, parentKey: 's2', order: 2, attributes: { tags: ['b'] } },
];
const workflow = ({ status = 'published', version = 3 } = {}) => ({
  _id: 'WID', id: 'WID', name: 'Flow', status, version, workflowData: { templates: templates() },
});

// A route-keyed stub with a live workflow document behind the GET/PUT pair.
function gwStub(routes = {}, { initial = workflow() } = {}) {
  const calls = [];
  let current = structuredClone(initial);
  const gw = {
    calls, loc: 'LOC', uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      for (const [fragment, response] of Object.entries(routes)) {
        if (!path.includes(fragment)) continue;
        const r = typeof response === 'function' ? response(path, body, method) : response;
        return r && typeof r === 'object' && 'ok' in r ? r : { status: 200, ok: true, json: r };
      }
      if (method === 'GET' && path.includes('/customFields/search')) return { status: 200, ok: true, json: { customFields: [] } };
      if (method === 'GET' && path.endsWith('/customValues')) return { status: 200, ok: true, json: { customValues: [] } };
      if (method === 'GET' && path.endsWith('/tags')) return { status: 200, ok: true, json: { tags: [] } };
      if (method === 'GET' && path.includes('/trigger')) return { status: 200, ok: true, json: { triggers: [] } };
      if (method === 'GET' && path.includes('/sticky-notes-all')) return { status: 200, ok: true, json: { data: [] } };
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { status: 200, ok: true, json: structuredClone(current) };
      if (method === 'PUT' && path === '/workflow/LOC/WID') {
        current = { ...current, ...structuredClone(body), version: current.version + 1 };
        return { status: 200, ok: true, json: { id: 'WID' } };
      }
      return { status: 404, ok: false, json: { message: `no stub for ${method} ${path}` } };
    },
    current: () => current,
  };
  return gw;
}

// ── Backlog 10 (R-95): a trigger POST in the STORED shape mints an orphan ────────────────────
test('raw_request refuses a trigger POST carrying root workflow_id without workflowId, before the confirm gate', async () => {
  const gw = gwStub();
  const r = await tool('raw_request').handler({
    locationId: 'LOC', method: 'POST', path: '/workflow/LOC/trigger', confirm: true,
    body: { workflow_id: 'WID', type: 'contact_tag', name: 'Cloned', conditions: [] },
  }, deps(gw));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail, /ORPHAN/);
  assert.match(r.remediation, /workflowId/);
  assert.deepEqual(gw.calls, [], 'nothing was sent');
  // the WRITE shape passes the guard (and reaches the gateway)
  const ok = await tool('raw_request').handler({
    locationId: 'LOC', method: 'POST', path: '/workflow/LOC/trigger', confirm: true,
    body: { workflowId: 'WID', type: 'contact_tag', name: 'Cloned', conditions: [], actions: [{ workflow_id: 'WID', type: 'add_to_workflow' }] },
  }, deps(gwStub({ '/workflow/LOC/trigger': { id: 'tr-new' } })));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  // a per-trigger PUT takes the stored shape and is untouched
  const put = await tool('raw_request').handler({
    locationId: 'LOC', method: 'PUT', path: '/workflow/LOC/trigger/tr1', confirm: true, body: { workflow_id: 'WID', name: 'x' },
  }, deps(gwStub({ '/workflow/LOC/trigger/tr1': { id: 'tr1' } })));
  assert.equal(put.ok, true, JSON.stringify(put));
});

// ── Backlog 26 (R-150, D-84): conv-AI triggers keep no stats ─────────────────────────────────
test('get_trigger_logs flags conv_ai_trigger / conv_ai_autonomous_trigger as noStats and says where the proof is', async () => {
  const gw = gwStub({
    '/workflow/LOC/trigger?': [
      { id: 't1', name: 'Chat Initiated', type: 'conv_ai_trigger', active: true },
      { id: 't2', name: 'Wants to book', type: 'conv_ai_autonomous_trigger', active: true },
      { id: 't3', name: 'Tag', type: 'contact_tag', active: true },
    ],
    '/workflows/trigger/logs/count-by-triggerId': [{ total: '0', matched: '0' }],
    '/workflows/trigger/logs/triggerId': [],
    '/workflows/trigger/logs/top-failed-reasons': [],
  });
  const r = await tool('get_trigger_logs').handler({ locationId: 'LOC', workflowId: 'WID' }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [a, b, c] = r.data.triggers;
  assert.equal(a.noStats, true); assert.match(a.note, /added_to_workflow/);
  assert.equal(b.noStats, true);
  assert.equal(c.noStats, undefined);
  assert.match(r.data.note, /conv_ai_trigger/);
});

// ── Backlog 23 (D-83): deleting a step with parked contacts ejects them ──────────────────────
test('a deleteStep on a PUBLISHED workflow counts the contacts parked on it and warns before the confirm gate', async () => {
  const gw = gwStub({ '/workflows/status/search/count-per-step': { counts: [{ currentStepId: 's2', total: 4 }, { currentStepId: 's3', total: 0 }] } });
  const preview = await tool('edit_workflow').handler({ locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true, ops: [{ op: 'deleteStep', stepId: 's2' }] }, deps(gw));
  assert.equal(preview.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(preview.data.preview.parkedOnDeletedSteps, [{ stepId: 's2', name: 'Wait a day', parked: 4 }]);
  assert.ok(preview.data.warnings.some((w) => /^DELETE_EJECTS_PARKED_CONTACTS: 4 contact/.test(w) && /step_was_deleted_by_user/.test(w)), preview.data.warnings.join('\n'));
  assert.equal(gw.calls.filter((c) => c.path.includes('count-per-step')).length, 1);
  // a draft workflow has no runs — no read, no warning
  const draft = gwStub({}, { initial: workflow({ status: 'draft' }) });
  const p2 = await tool('edit_workflow').handler({ locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true, ops: [{ op: 'deleteStep', stepId: 's2' }] }, deps(draft));
  assert.equal(p2.code, 'CONFIRM_REQUIRED');
  assert.equal(draft.calls.filter((c) => c.path.includes('count-per-step')).length, 0);
  // an unreadable count is said, not silently zero
  const blind = gwStub({ '/workflows/status/search/count-per-step': { status: 503, ok: false, json: {} } });
  const p3 = await tool('edit_workflow').handler({ locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true, ops: [{ op: 'deleteStep', stepId: 's2' }] }, deps(blind));
  assert.ok(p3.data.warnings.some((w) => /^DELETE_PARKED_UNKNOWN/.test(w)));
});

// ── Backlog 29 (D-86): field ids differ per account, standard fields included ────────────────
test('replaceFieldId refuses a NEW id that does not resolve on this account, and reports both ids when it does', async () => {
  const doc = workflow({ status: 'draft' });
  doc.workflowData.templates[0] = { ...doc.workflowData.templates[0], type: 'update_contact_field', attributes: { fields: [{ field: 'OLDFIELD0000000001', value: 'x' }] } };
  const lookups = { '/locations/LOC/customFields/OLDFIELD0000000001': { customField: { id: 'OLDFIELD0000000001', fieldKey: 'contact.last_name', dataType: 'STANDARD_FIELD' } } };
  const bad = gwStub({ ...lookups, '/locations/LOC/customFields/FOREIGN00000000001': { status: 404, ok: false, json: { message: 'not found' } } }, { initial: doc });
  const r = await tool('edit_workflow').handler({ locationId: 'LOC', workflowId: 'WID', confirm: true, acknowledgeDrift: true,
    ops: [{ op: 'replaceFieldId', oldId: 'OLDFIELD0000000001', newId: 'FOREIGN00000000001' }] }, deps(bad));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNRESOLVED_DEPS');
  assert.match(r.detail, /does not resolve on this account/);
  assert.match(r.detail, /contact\.last_name/);
  assert.deepEqual(bad.calls.filter((c) => c.method === 'PUT'), [], 'nothing written');
  const good = gwStub({ ...lookups, '/locations/LOC/customFields/NEWFIELD0000000001': { customField: { id: 'NEWFIELD0000000001', fieldKey: 'contact.last_name', dataType: 'STANDARD_FIELD' } } }, { initial: structuredClone(doc) });
  const ok = await tool('edit_workflow').handler({ locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true,
    ops: [{ op: 'replaceFieldId', oldId: 'OLDFIELD0000000001', newId: 'NEWFIELD0000000001' }] }, deps(good));
  assert.equal(ok.code, 'CONFIRM_REQUIRED', JSON.stringify(ok));
  assert.ok(ok.data.warnings.some((w) => /replaceFieldId: 'OLDFIELD0000000001' \(contact\.last_name\) → 'NEWFIELD0000000001'/.test(w)), ok.data.warnings.join('\n'));
});

// ── Backlog 27 + 21: read-back and repair through files ──────────────────────────────────────
test('export_workflow narrows to stepIds and can write the scrubbed export to a file; repair_workflow reads that file back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rail-findings-'));
  const out = join(dir, 'export.json');
  const gw = gwStub({}, { initial: workflow({ status: 'draft' }) });
  const narrowed = await tool('export_workflow').handler({ locationId: 'LOC', workflowId: 'WID', stepIds: ['s2', 'ghost'] }, deps(gw));
  assert.equal(narrowed.ok, true, JSON.stringify(narrowed));
  assert.deepEqual(narrowed.data.workflow.workflowData.templates.map((t) => t.id), ['s2']);
  assert.deepEqual(narrowed.data.workflow.exportFilter, { stepIds: ['s2', 'ghost'], totalSteps: 3, missing: ['ghost'] });

  const written = await tool('export_workflow').handler({ locationId: 'LOC', workflowId: 'WID', writeTo: out }, deps(gw));
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(written.data.writtenTo, out);
  assert.equal(written.data.stepCount, 3);
  assert.equal(existsSync(out), true);
  const file = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(file.workflow.workflowData.templates.length, 3);

  const relative = await tool('export_workflow').handler({ locationId: 'LOC', workflowId: 'WID', writeTo: 'export.json' }, deps(gw));
  assert.equal(relative.code, 'VALIDATION_FAILED');

  // repair from the export file: rename the tail, write the file back, repair from it
  file.workflow.workflowData.templates[2].name = 'Tail renamed';
  writeFileSync(out, JSON.stringify(file));
  const repaired = await tool('repair_workflow').handler({ locationId: 'LOC', workflowId: 'WID', templatesPath: out, confirm: true }, deps(gw));
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  assert.equal(gw.current().workflowData.templates[2].name, 'Tail renamed');
  const both = await tool('repair_workflow').handler({ locationId: 'LOC', workflowId: 'WID', templatesPath: out, templates: [], confirm: true }, deps(gw));
  assert.equal(both.code, 'VALIDATION_FAILED');
  const bare = join(dir, 'bare.json');
  writeFileSync(bare, JSON.stringify(templates()));
  const fromBare = await tool('repair_workflow').handler({ locationId: 'LOC', workflowId: 'WID', templatesPath: bare }, deps(gw));
  assert.equal(fromBare.code, 'CONFIRM_REQUIRED', JSON.stringify(fromBare));
});

// ── Backlog 30 (D-86, D-90): the refused objective write is only visible in one log field ───
test('get_workflow_logs labels an objective row whose field write the AI service refused, counts them, and can write to a file', async () => {
  const rows = [
    { _id: 'r1', type: 'conversationai_objective', stepName: 'Surname if missing', status: 'success',
      meta: { actionFrom: { response: { msg: 'Objective met but field update failed - proceeding due to allowPartialSuccess' } } } },
    { _id: 'r2', type: 'conversationai_objective', stepName: 'First name if missing', status: 'success',
      meta: { actionFrom: { response: { msg: 'Objective met and field updated successfully' } } } },
    { _id: 'r3', type: 'sms', stepName: 'Nudge', status: 'success' },
  ];
  const gw = gwStub({
    '/workflows/logs/v2': { logs: rows },
    '/workflows/status/search/count-per-step': { counts: [] },
    '/workflows/status/search/workflow-with-filter': { rows: [] },
  });
  const r = await tool('get_workflow_logs').handler({ locationId: 'LOC', workflowId: 'WID' }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.logs[0].objectiveWriteFailed, true);
  assert.match(r.data.logs[0].objectiveWriteNote, /REFUSED the field write/);
  assert.equal(r.data.logs[1].objectiveWriteFailed, undefined);
  assert.equal(r.data.objectiveWriteFailures, 1);

  const dir = mkdtempSync(join(tmpdir(), 'rail-findings-logs-'));
  const out = join(dir, 'logs.json');
  const w = await tool('get_workflow_logs').handler({ locationId: 'LOC', workflowId: 'WID', writeTo: out }, deps(gw));
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(w.data.logCount, 3);
  assert.equal(w.data.objectiveWriteFailures, 1);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).logs.length, 3);
});
