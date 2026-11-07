// bl-393: a large edit had to be pasted inline. edit_workflow takes opsPath — an absolute JSON file holding the ops array
// (or {ops}) — the same way repair_workflow takes templatesPath.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'edit_workflow');
const DOC = { _id: 'W', id: 'W', name: 'WF', status: 'draft', version: 3, workflowData: { templates: [
  { id: 's1', type: 'add_contact_tag', name: 'Head', next: null, parentKey: null, order: 0, attributes: { tags: ['a'] } }] } };
const gw = () => ({ loc: 'L', uid: 'U', call: async (m, p) => {
  if (m === 'GET' && /\/workflow\/L\/W(\?|$)/.test(p)) return { ok: true, status: 200, json: structuredClone(DOC) };
  if (m === 'GET') return { ok: true, status: 200, json: {} };
  return { ok: true, status: 200, json: { valid: true } };
} });
const run = (args) => tool.handler({ locationId: 'L', workflowId: 'W', ...args }, { state: {}, makeGw: () => gw() });
const OPS = [{ op: 'renameStep', stepId: 's1', name: 'Head renamed' }];
const file = (content) => { const d = mkdtempSync(join(tmpdir(), 'ops-')); const p = join(d, 'ops.json'); writeFileSync(p, JSON.stringify(content)); return p; };
const strip = (r) => JSON.parse(JSON.stringify(r).replace(/"(capturedAt|at|readAt)":"[^"]*"/g, ''));

test('opsPath (a bare array or {ops}) previews exactly what the same ops inline preview', async () => {
  const inline = strip(await run({ ops: OPS }));
  assert.deepEqual(strip(await run({ opsPath: file(OPS) })), inline);
  assert.deepEqual(strip(await run({ opsPath: file({ ops: OPS }) })), inline);
});

test('opsPath refuses: both ops and opsPath, a relative path, a file with no ops array', async () => {
  assert.match(JSON.stringify(await run({ ops: OPS, opsPath: file(OPS) })), /either ops .* or opsPath/);
  assert.match(JSON.stringify(await run({ opsPath: 'ops.json' })), /opsPath must be an absolute file path/);
  assert.match(JSON.stringify(await run({ opsPath: file({ nope: 1 }) })), /opsPath holds no ops array/);
});

test('the schema accepts opsPath without ops', () => {
  assert.doesNotThrow(() => tool.inputSchema.parse({ locationId: 'L', workflowId: 'W', opsPath: '/x.json' }));
});

test('edit_workflow previews insertAfter {steps} (the tool path, not just applyOps) — found live 2026-10-30', async () => {
  const r = await run({ ops: [{ op: 'insertAfter', afterId: 's1', steps: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['a'] } },
    { ref: 'b', kind: 'action', type: 'add_contact_tag', name: 'B', attributes: { tags: ['b'] } }] }] });
  assert.equal(r.code, 'CONFIRM_REQUIRED', JSON.stringify(r).slice(0, 300));
  assert.equal(r.data.preview.diff.createdSteps.length, 2);
});
