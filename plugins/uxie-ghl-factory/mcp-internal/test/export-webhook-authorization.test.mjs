// bl-112 (orchestrator 2026-11-10, w9-wf2): export_workflow puts the placeholder on a custom_webhook's authorization KEY, the measured
// NONE/null shape too, so validate and repair can restore it from the stored step. Measured shape: live GET of a TEST-CONF draft in the sandbox (version 4), its custom_webhook step, read 2026-11-10: attributes.authorization = {"type":"NONE","data":null};
// raw capture in the w9-wf2 scratchpad, e97275e4-raw-GET.json, sha256 fd190d3ebcff88ee9cf8d4cab3d0bb0e88fd41cb9d32ce9390683121305679ca.
// The Bearer fixture is NOT measured: a Bearer write is blocked (bl-1024). It stands in for a credential the stored step holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../core/tools.mjs';
import { REDACTED } from '../core/errors.mjs';
import { restoreRedactedForValidation } from '../core/raw-request-guards.mjs';
import { tempDir } from './_tmp.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const SECRET = 'TOKEN-abcdefgh12345678';
const hook = (id, authorization) => ({
  id, name: 'Hook', type: 'custom_webhook', next: null, parent: null, parentKey: null, order: 0,
  attributes: { type: 'custom_webhook', url: 'https://example.com/hook', method: 'POST', ...(authorization === undefined ? {} : { authorization }) },
});
const MEASURED = hook('measured-step', { type: 'NONE', data: null });
const BEARER = hook('h1', { type: 'Bearer', data: SECRET });

// A fake gateway: GET returns the stored document at version 4; PUT records the written body and bumps the version.
function gateway(stored) {
  const current = { _id: 'WID', id: 'WID', name: 'Flow', status: 'draft', version: 4, workflowData: { templates: structuredClone(stored) } };
  let put = null;
  const gw = {
    uid: 'UID',
    call: async (method, path, body) => {
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { ok: true, status: 200, json: structuredClone(current) };
      if (method === 'GET' && path.includes('sticky-notes-all')) return { ok: true, status: 200, json: { data: [], count: 0 } };
      if (method === 'GET' && path.includes('/trigger')) return { ok: true, status: 200, json: { triggers: [] } };
      if (method === 'GET' && path.includes('/customFields/search')) return { ok: true, status: 200, json: { customFields: [] } };
      if (method === 'GET' && path.includes('/customValues')) return { ok: true, status: 200, json: { customValues: [] } };
      if (method === 'GET' && path.includes('/tags')) return { ok: true, status: 200, json: { tags: [] } };
      if (method === 'POST' && path.endsWith('/validate-assets')) return { ok: true, status: 200, json: { errors: [], warnings: [] } };
      if (method === 'PUT' && path === '/workflow/LOC/WID') { put = structuredClone(body); return { ok: true, status: 200, json: { ...current, ...structuredClone(body), version: 5 } }; }
      return { ok: true, status: 200, json: {} };
    },
  };
  return { gw, written: () => put };
}
const deps = (gw) => ({ makeGw: () => gw, state: { tokenFile: join(tempDir('ghl-bl112-'), 'tok.txt') } });
const stepOf = (templates, id) => templates.find((t) => t?.id === id);
const exportOf = async (gw) => tool('export_workflow').handler({ locationId: 'LOC', workflowId: 'WID', format: 'document' }, deps(gw));

test('bl-112: export puts the placeholder on the authorization key for the measured NONE/null shape', async () => {
  const { gw } = gateway([MEASURED]);
  const r = await exportOf(gw);
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const step = stepOf(r.data.workflow.workflowData.templates, 'measured-step');
  assert.equal(step.attributes.authorization, REDACTED,
    'the measured NONE/null authorization must carry the placeholder on its key, so validate and repair can restore it from the stored step');
});

test('bl-112: export puts the placeholder on the key for a set credential, and the credential never leaves the export', async () => {
  const { gw } = gateway([BEARER]);
  const r = await exportOf(gw);
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.ok(!JSON.stringify(r.data).includes(SECRET), 'the credential must not leave in the export');
  assert.equal(stepOf(r.data.workflow.workflowData.templates, 'h1').attributes.authorization, REDACTED);
});

test('bl-112: the validation restore fills the key placeholder from the stored step (measured shape)', () => {
  const exported = [{ ...MEASURED, attributes: { ...MEASURED.attributes, authorization: REDACTED } }];
  const out = restoreRedactedForValidation(exported, [MEASURED]);
  assert.deepEqual(stepOf(out.templates, 'measured-step').attributes.authorization, { type: 'NONE', data: null });
  assert.ok(out.restored.some((x) => x.path === 'attributes.authorization'), JSON.stringify(out.restored));
});

test('bl-112: repair restores the stored NONE/null from the key placeholder and writes it, no refusal', async () => {
  const { gw, written } = gateway([MEASURED]);
  const r = await exportOf(gw);
  const path = join(tempDir('ghl-bl112-file-'), 'export.json');
  writeFileSync(path, JSON.stringify({ templates: r.data.workflow.workflowData.templates }));
  const out = await tool('repair_workflow').handler({ locationId: 'LOC', workflowId: 'WID', templatesPath: path, confirm: true, expectedVersion: 4 }, deps(gw));
  assert.equal(out.ok, true, `repair must restore the placeholder it can resolve: ${JSON.stringify(out).slice(0, 400)}`);
  assert.deepEqual(stepOf(written().workflowData.templates, 'measured-step').attributes.authorization, { type: 'NONE', data: null });
});

test('bl-112: repair round trip for a set credential writes the stored credential, not the placeholder', async () => {
  const { gw, written } = gateway([BEARER]);
  const r = await exportOf(gw);
  const path = join(tempDir('ghl-bl112-file-'), 'export.json');
  writeFileSync(path, JSON.stringify({ templates: r.data.workflow.workflowData.templates }));
  const out = await tool('repair_workflow').handler({ locationId: 'LOC', workflowId: 'WID', templatesPath: path, confirm: true, expectedVersion: 4 }, deps(gw));
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 400));
  assert.deepEqual(stepOf(written().workflowData.templates, 'h1').attributes.authorization, { type: 'Bearer', data: SECRET });
});

test('bl-112: repair refuses, naming the step and the path, when the stored step has no authorization to restore from', async () => {
  const { gw } = gateway([hook('h2', undefined)]);
  const path = join(tempDir('ghl-bl112-file-'), 'export.json');
  writeFileSync(path, JSON.stringify({ templates: [hook('h2', REDACTED)] }));
  const out = await tool('repair_workflow').handler({ locationId: 'LOC', workflowId: 'WID', templatesPath: path, confirm: true, expectedVersion: 4 }, deps(gw));
  assert.equal(out.ok, false, 'a placeholder with nothing stored to restore from must be refused');
  const text = JSON.stringify(out);
  assert.ok(text.includes('h2') && text.includes('attributes.authorization'), `the refusal must name the step and the path: ${text.slice(0, 300)}`);
});
