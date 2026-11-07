// W6a item 4: build_workflow {dryRun:true} and validate_workflow {spec} (no workflowId) run every check a build runs —
// resolve, compile, the offline gate, validate-assets, engine references — and create nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const STATELESS_POST = /\/validate-assets$|\/workflow\/custom-code\/run-test$/;

function gwStub({ assets = { errors: [], warnings: [] } } = {}) {
  const calls = [];
  return {
    calls,
    loc: 'L', uid: 'U',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.match(/\/tags$/)) return { ok: true, status: 200, json: { tags: [] } };
      if (method === 'POST' && path.endsWith('/validate-assets')) return { ok: true, status: 200, json: assets };
      if (method === 'GET') return { ok: true, status: 200, json: {} };
      return { ok: true, status: 200, json: { id: 'SHOULD_NOT_HAPPEN' } };
    },
  };
}
const SPEC = { name: 'W', triggers: [], graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['brand-new'] } }] };
const ASSET_ERR = { ruleId: 'ASSET_USER_NOT_FOUND', assetType: 'user', assetId: 'GONE', message: 'Referenced User does not exist or does not belong to this location.', severity: 'error', stepId: 'S1', stepName: 'Assign', stepType: 'assign_user' };
const writes = (calls) => calls.filter((c) => c.method !== 'GET' && !STATELESS_POST.test(c.path));

test('build_workflow dryRun: a clean spec answers valid:true and makes no write', async () => {
  const gw = gwStub();
  const res = await tool('build_workflow').handler({ locationId: 'L', spec: structuredClone(SPEC), dryRun: true }, { state: {}, makeGw: () => gw });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(writes(gw.calls), []);
  assert.equal(res.data.valid, true);
  assert.equal(res.data.server, 'not run (no workflow)');
  assert.deepEqual(res.data.wouldCreate, { tags: ['brand-new'], templates: [] });
  assert.equal(res.data.workflowId, null);
});

test('build_workflow dryRun: a refused spec is a RESULT (ok, valid:false, errors[]), not a tool error', async () => {
  const gw = gwStub({ assets: { errors: [ASSET_ERR], warnings: [] } });
  const res = await tool('build_workflow').handler({ locationId: 'L', spec: structuredClone(SPEC), dryRun: true }, { state: {}, makeGw: () => gw });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.valid, false);
  assert.deepEqual(res.data.errors.map((e) => [e.code, e.path, e.stage]), [['ASSET_USER_NOT_FOUND', 'S1', 'validate_assets']]);
  assert.deepEqual(writes(gw.calls), []);
});

test('validate_workflow {spec} with no workflowId runs the same dry run', async () => {
  const gw = gwStub();
  const res = await tool('validate_workflow').handler({ locationId: 'L', spec: structuredClone(SPEC) }, { state: {}, makeGw: () => gw });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.valid, true);
  assert.equal(res.data.server, 'not run (no workflow)');
  assert.deepEqual(writes(gw.calls), []);
});

test('validate_workflow refuses neither and both of workflowId / spec', async () => {
  const gw = gwStub();
  const neither = await tool('validate_workflow').handler({ locationId: 'L' }, { state: {}, makeGw: () => gw });
  assert.equal(neither.ok, false);
  assert.match(JSON.stringify(neither), /workflowId or spec/);
  const both = await tool('validate_workflow').handler({ locationId: 'L', workflowId: 'W', spec: SPEC }, { state: {}, makeGw: () => gw });
  assert.equal(both.ok, false);
  assert.deepEqual(gw.calls, []);
});

test('schemas: dryRun on build_workflow, workflowId optional and spec on validate_workflow', () => {
  assert.equal(tool('build_workflow').inputSchema.parse({ locationId: 'L', spec: {}, dryRun: true }).dryRun, true);
  assert.doesNotThrow(() => tool('validate_workflow').inputSchema.parse({ locationId: 'L', spec: { name: 'x' } }));
});

// Security review 2026-10-30: validate_workflow is classified READ-ONLY (location-binding.mjs), and the custom-code
// sandbox runs the step's code, which can make HTTP calls. Spec mode must never reach it.
const CODE_SPEC = { name: 'W', triggers: [], graph: [{ ref: 'c', kind: 'action', type: 'custom_code', name: 'Code',
  attributes: { language: 'javascript', code: 'output = { ok: true }', inputData: {}, output: { ok: true } } }] };

test('validate_workflow {spec} never runs the custom-code sandbox, and does not declare it', async () => {
  const gw = gwStub();
  const res = await tool('validate_workflow').handler({ locationId: 'L', spec: structuredClone(CODE_SPEC) }, { state: {}, makeGw: () => gw });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(gw.calls.some((c) => c.path.includes('/custom-code/run-test')), false);
  assert.equal(tool('validate_workflow').capabilities.some((c) => c.path.includes('/custom-code/run-test')), false);
});

test('CONTROL: build_workflow dryRun (a write-classified tool) still runs the sandbox unless skipCustomCodeTest', async () => {
  const gw = gwStub();
  await tool('build_workflow').handler({ locationId: 'L', spec: structuredClone(CODE_SPEC), dryRun: true }, { state: {}, makeGw: () => gw });
  assert.equal(gw.calls.some((c) => c.path.includes('/custom-code/run-test')), true);
});
